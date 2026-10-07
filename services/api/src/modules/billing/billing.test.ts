import { API_PREFIX, BillingCustomerSchema, BillingProfileListSchema, BillingProfileSchema } from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';
import { demo } from '../../db/seed-demo.js';
import { buildServer } from '../../server.js';

/**
 * Invoicing phase 1 (Alex, 2026-10-06) — docs/INVOICING.md. The issuer
 * profile on the legal entity, billing identities with explicit
 * electronic-invoice consent, the permissions, and — above all — that
 * no tenant can see or touch another's.
 */
const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });
let maria = ''; // owner of the demo salon
let ana = ''; // Employee kit at the demo salon: pos.checkout, nothing else
let stefan = ''; // owner of another salon (Vita Fizio)
let entityId = '';
let otherEntityId = '';
let otherCustomerId = '';
const made: string[] = [];

const login = async (email: string, password = 'velnes-demo') =>
  (await app.inject({ method: 'POST', url: `${API_PREFIX}/auth/login`, payload: { email, password } })).json().accessToken as string;
const call = (token: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: unknown) =>
  app.inject({ method, url: `${API_PREFIX}${url}`, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });

const profileBody = {
  address: 'Partizanski Odredi 14',
  city: 'Skopje',
  zip: '1000',
  country: 'North Macedonia',
  vatRegistered: false,
  defaultVatRateBp: 0,
  embs: '7012345',
  bankName: 'Komercijalna banka',
  bankAccount: '300000001234567',
  signatoryName: 'Maria Petrovska',
  contactEmail: 'office@velnes.mk',
};

describe('invoicing phase 1', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    maria = await login('maria@velnes.mk');
    ana = await login('ana@velnes.mk');
    stefan = (await login('stefan@vitafizio.mk')) || (await login('stefan@vitafizio.mk', 'velnes-fixture'));
    expect(stefan, 'second tenant login').toBeTruthy();
    entityId = (await admin.query(`SELECT id FROM legal_entities WHERE tenant_id=$1 AND owner_type='salon' AND is_default`, [demo.business])).rows[0].id;
    const other = await admin.query(`SELECT id FROM legal_entities WHERE tenant_id=$1 AND owner_type='salon' LIMIT 1`, [demo.bizVita]);
    otherEntityId = other.rows[0]?.id ?? '';
    const oc = await admin.query(`SELECT id FROM customers WHERE tenant_id=$1 LIMIT 1`, [demo.bizVita]);
    otherCustomerId = oc.rows[0]?.id ?? '';
  });
  afterAll(async () => {
    if (made.length) await admin.query(`DELETE FROM billing_customers WHERE id = ANY($1::uuid[])`, [made]);
    await admin.query(`DELETE FROM billing_profiles WHERE legal_entity_id = $1`, [entityId]);
    await admin.query(`UPDATE legal_entities SET embs = NULL WHERE id = $1`, [entityId]);
    await admin.query(`UPDATE roles SET perms = perms - 'billing.create' WHERE tenant_id=$1 AND name='Employee' AND perms->>'billing.create' = 'none'`, [demo.business]);
    await admin.end();
    await app.close();
    await closeDb();
  });

  describe('permissions', () => {
    it('the migration gave the Owner both rights and the Employee kit only billing.create at its till scope', async () => {
      const roles = (await admin.query(`SELECT name, perms FROM roles WHERE tenant_id=$1 AND std`, [demo.business])).rows as { name: string; perms: Record<string, string> }[];
      const owner = roles.find((r) => r.name === 'Owner')!.perms;
      const emp = roles.find((r) => r.name === 'Employee')!.perms;
      expect(owner['billing.settings']).toBe('business');
      expect(owner['billing.create']).toBe('business');
      expect(emp['billing.settings'] ?? 'none').toBe('none');
      expect(emp['billing.create']).toBe(emp['pos.checkout']);
    });
    it('an employee without billing.settings cannot read or write the profile', async () => {
      expect((await call(ana, 'GET', '/billing/profiles')).statusCode).toBe(403);
      expect((await call(ana, 'PUT', `/billing/profiles/${entityId}`, profileBody)).statusCode).toBe(403);
    });
  });

  describe('the issuer profile', () => {
    it('reads the defaults for the legal entity before anything was saved — incomplete, with the gaps named', async () => {
      const res = await call(maria, 'GET', '/billing/profiles');
      expect(res.statusCode, res.body).toBe(200);
      const { profiles } = BillingProfileListSchema.parse(res.json());
      const p = profiles.find((x) => x.legalEntityId === entityId)!;
      expect(p.legalName).toBe('Velnes Studio DOOEL Skopje');
      expect(p.edb).toBe('MK4030026512345');
      expect(p.businessName).toBeTruthy();
      expect(p.locations.length).toBeGreaterThan(0);
      expect(p.locations.every((l) => l.tz)).toBe(true);
      expect(p.completeness.complete).toBe(false);
      expect(p.completeness.missing).toEqual(expect.arrayContaining(['address', 'city', 'zip', 'signatoryName']));
      expect(p.invoicePrefix).toBe('');
      expect(p.creditPrefix).toBe('KO-');
      expect(p.numberWidth).toBe(6);
      expect(p.updatedAt).toBeNull();
    });

    it('a non-VAT salon saves a complete profile without a VAT number; ЕМБС lands on the legal entity', async () => {
      const res = await call(maria, 'PUT', `/billing/profiles/${entityId}`, profileBody);
      expect(res.statusCode, res.body).toBe(200);
      const p = BillingProfileSchema.parse(res.json());
      expect(p.completeness).toEqual({ complete: true, missing: [], invalid: [] });
      expect(p.vatRegistered).toBe(false);
      expect(p.embs).toBe('7012345');
      expect((await admin.query(`SELECT embs FROM legal_entities WHERE id=$1`, [entityId])).rows[0].embs).toBe('7012345');
      // One profile per entity: saving again updates, never duplicates.
      await call(maria, 'PUT', `/billing/profiles/${entityId}`, { ...profileBody, city: 'Скопје' });
      expect((await admin.query(`SELECT count(*)::int AS n, max(city) AS city FROM billing_profiles WHERE legal_entity_id=$1`, [entityId])).rows[0]).toMatchObject({ n: 1, city: 'Скопје' });
      const audit = await admin.query(`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id=$1 AND action='Invoice settings changed'`, [demo.business]);
      expect(audit.rows[0].n).toBeGreaterThanOrEqual(2);
    });

    it('a VAT-registered salon is not complete until its VAT number is there — and the seeded entity already carries one', async () => {
      const res = await call(maria, 'PUT', `/billing/profiles/${entityId}`, { ...profileBody, vatRegistered: true, defaultVatRateBp: 1800 });
      expect(res.statusCode, res.body).toBe(200);
      const p = BillingProfileSchema.parse(res.json());
      // The seed's entity has vat_reg set, so it is complete; a salon
      // whose entity has none would see 'vatRegNo' missing.
      expect(p.vatRegNo).toBe('MK4030026512345');
      expect(p.completeness.complete).toBe(true);
      // Marked registered but with a 0 % default: the evaluator refuses nothing invented either way.
      const odd = BillingProfileSchema.parse((await call(maria, 'PUT', `/billing/profiles/${entityId}`, { ...profileBody, vatRegistered: false, defaultVatRateBp: 1800 })).json());
      expect(odd.completeness.invalid).toContainEqual({ field: 'defaultVatRateBp', reason: 'invalid' });
    });

    it('the VAT number of a verified entity is not rewritten from the salon side', async () => {
      const res = await call(maria, 'PUT', `/billing/profiles/${entityId}`, { ...profileBody, vatRegistered: true, defaultVatRateBp: 1800, vatRegNo: 'MK4030000000001' });
      expect(res.statusCode).toBe(422);
      expect((await admin.query(`SELECT vat_reg FROM legal_entities WHERE id=$1`, [entityId])).rows[0].vat_reg).toBe('MK4030026512345');
    });

    it('refuses bad numbering and identifiers at the door', async () => {
      for (const body of [{ numberWidth: 3 }, { invoicePrefix: 'inv/2026' }, { embs: '12' }, { defaultCurrency: 'denar' }, { issueMode: 'later' }, { contactEmail: 'nope' }])
        expect((await call(maria, 'PUT', `/billing/profiles/${entityId}`, { ...profileBody, ...body })).statusCode, JSON.stringify(body)).toBe(400);
    });

    it('currency and defaults round-trip', async () => {
      const p = BillingProfileSchema.parse(
        (await call(maria, 'PUT', `/billing/profiles/${entityId}`, { ...profileBody, defaultCurrency: 'eur', invoicePrefix: 'inv-', numberWidth: 5, yearlyReset: false, issueMode: 'auto', pricesIncludeVat: true })).json(),
      );
      expect(p).toMatchObject({ defaultCurrency: 'EUR', invoicePrefix: 'INV-', numberWidth: 5, yearlyReset: false, issueMode: 'auto' });
      await call(maria, 'PUT', `/billing/profiles/${entityId}`, profileBody);
    });
  });

  describe('billing identities', () => {
    let companyId = '';
    let personId = '';
    it('a company identity linked to a customer, kept apart from the customer profile', async () => {
      const before = await admin.query(`SELECT name, email, phone FROM customers WHERE id=$1`, [demo.c2]);
      const res = await call(maria, 'POST', '/billing/customers', {
        customerId: demo.c2,
        kind: 'company',
        name: 'Nova Health DOO Skopje',
        address: 'Bul. Ilinden 5',
        city: 'Skopje',
        zip: '1000',
        edb: '4030026512399',
        vatRegNo: 'MK4030026512399',
        email: 'finance@novahealth.mk',
      });
      expect(res.statusCode, res.body).toBe(200);
      const c = BillingCustomerSchema.parse(res.json());
      companyId = c.id;
      made.push(c.id);
      expect(c.kind).toBe('company');
      expect(c.customerId).toBe(demo.c2);
      expect(c.consentElectronicAt).toBeNull();
      // The Velnes customer is untouched.
      expect((await admin.query(`SELECT name, email, phone FROM customers WHERE id=$1`, [demo.c2])).rows[0]).toEqual(before.rows[0]);
      const list = await call(maria, 'GET', `/billing/customers?customerId=${demo.c2}`);
      expect(list.json().customers.map((x: { id: string }) => x.id)).toContain(c.id);
    });

    it('a company without its seat or ЕДБ is refused; a person needs only a name and may stand alone', async () => {
      expect((await call(maria, 'POST', '/billing/customers', { kind: 'company', name: 'Half DOO' })).statusCode).toBe(400);
      const res = await call(maria, 'POST', '/billing/customers', { kind: 'person', name: 'Walk-in Petar' });
      expect(res.statusCode, res.body).toBe(200);
      const p = BillingCustomerSchema.parse(res.json());
      personId = p.id;
      made.push(p.id);
      expect(p.customerId).toBeNull();
    });

    it('a billing identity cannot be linked to a customer the tenant does not have', async () => {
      const res = await call(maria, 'POST', '/billing/customers', { customerId: otherCustomerId || '00000000-0000-4000-8000-000000000000', kind: 'person', name: 'Ghost' });
      expect(res.statusCode).toBe(404);
    });

    it('updates keep the audit trail and the identity id', async () => {
      const res = await call(maria, 'PATCH', `/billing/customers/${personId}`, { kind: 'person', name: 'Petar Petrov', city: 'Bitola' });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().name).toBe('Petar Petrov');
      const audit = await admin.query(`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id=$1 AND action='Billing details changed'`, [demo.business]);
      expect(audit.rows[0].n).toBeGreaterThanOrEqual(1);
    });

    it('electronic invoice consent is explicit, timestamped, withdrawable, and its history stays', async () => {
      const given = BillingCustomerSchema.parse((await call(maria, 'POST', `/billing/customers/${companyId}/consent`, { granted: true, note: 'Signed form 2026-10-06' })).json());
      expect(given.consentElectronicAt).toBeTruthy();
      expect(given.consentHistory).toHaveLength(1);
      expect(given.consentHistory[0]).toMatchObject({ granted: true, note: 'Signed form 2026-10-06', actorName: 'Maria Petrovska' });
      const withdrawn = BillingCustomerSchema.parse((await call(maria, 'POST', `/billing/customers/${companyId}/consent`, { granted: false, note: 'Asked for paper' })).json());
      expect(withdrawn.consentElectronicAt).toBeNull();
      expect(withdrawn.consentHistory.map((h) => h.granted)).toEqual([false, true]);
      // History is append-only for the API role.
      await expect(admin.query(`SET ROLE velnes_api; DELETE FROM billing_consent_events WHERE billing_customer_id=$1; RESET ROLE;`, [companyId])).rejects.toThrow();
      await admin.query(`RESET ROLE`).catch(() => undefined);
    });

    it('the Employee kit may create billing details but not touch invoice settings', async () => {
      const res = await call(ana, 'POST', '/billing/customers', { kind: 'person', name: 'From the desk' });
      expect(res.statusCode, res.body).toBe(200);
      made.push(res.json().id);
      expect((await call(ana, 'GET', '/billing/profiles')).statusCode).toBe(403);
    });
  });

  describe('tenant isolation', () => {
    it("another salon's owner cannot read, write or discover the demo salon's profile or identities", async () => {
      // Their own list never contains the demo entity.
      const mine = BillingProfileListSchema.parse((await call(stefan, 'GET', '/billing/profiles')).json());
      expect(mine.profiles.some((p) => p.legalEntityId === entityId)).toBe(false);
      expect((await call(stefan, 'GET', `/billing/profiles/${entityId}`)).statusCode).toBe(404);
      expect((await call(stefan, 'PUT', `/billing/profiles/${entityId}`, profileBody)).statusCode).toBe(404);
      expect((await admin.query(`SELECT city FROM billing_profiles WHERE legal_entity_id=$1`, [entityId])).rows[0].city).toBe('Skopje');
      // Identities: by id, by list, by linking to a foreign customer.
      const theirs = await call(stefan, 'GET', '/billing/customers');
      expect(theirs.statusCode).toBe(200);
      expect(theirs.json().customers.some((c: { id: string }) => made.includes(c.id))).toBe(false);
      expect((await call(stefan, 'GET', `/billing/customers/${made[0]}`)).statusCode).toBe(404);
      expect((await call(stefan, 'PATCH', `/billing/customers/${made[0]}`, { kind: 'person', name: 'Hijack' })).statusCode).toBe(404);
      expect((await call(stefan, 'POST', `/billing/customers/${made[0]}/consent`, { granted: true })).statusCode).toBe(404);
      expect((await call(stefan, 'POST', '/billing/customers', { customerId: demo.c2, kind: 'person', name: 'Cross' })).statusCode).toBe(404);
      expect((await admin.query(`SELECT name FROM billing_customers WHERE id=$1`, [made[0]])).rows[0].name).not.toBe('Hijack');
      if (otherEntityId) expect((await call(maria, 'GET', `/billing/profiles/${otherEntityId}`)).statusCode).toBe(404);
    });
  });

  describe('nothing else changes', () => {
    it('a sale still goes through with or without a billing profile', async () => {
      await admin.query(`DELETE FROM billing_profiles WHERE legal_entity_id = $1`, [entityId]);
      const res = await call(maria, 'POST', '/sales', { key: `p1-sale-${Date.now()}`, locationId: demo.locAerodrom, method: 'Cash', lines: [{ kind: 'product', productId: demo.p1, qty: 1 }] });
      expect(res.statusCode, res.body).toBe(200);
      await call(maria, 'PUT', `/billing/profiles/${entityId}`, profileBody);
    });
  });
});
