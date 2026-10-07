import { API_PREFIX, BillingInvoiceListSchema, BillingInvoiceSchema, BillingLogoSchema, BillingProfileSchema, type AccessClaims } from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, withTenant } from '../../db/index.js';
import { demo } from '../../db/seed-demo.js';
import { buildServer } from '../../server.js';
import { nowAt } from '../scheduling/scheduling.service.js';
import { issueInvoice } from './issue.service.js';

/**
 * Issuing (phase 3, 2026-10-07) — docs/INVOICING.md "Phase 3".
 * The transition draft → issued at Aerodrom (till.test.ts asserts
 * Centar's next receipt number). Maria owns the salon and may issue;
 * Ana is the Employee kit (drafts, cannot issue); Stefan owns another
 * salon; Lumen Beauty's owner issues under a second legal entity in
 * the concurrency test. Every blocked path is checked against the
 * sequence row: a refused issue never consumes a number.
 */
const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });
let maria = '';
let ana = '';
let stefan = '';
let lumen = '';
let entityId = '';
let lumenEntity = '';
let lumenLoc = '';
let lumenSvc = '';
let n = 0;
const key = (p = 'p3') => `${p}-${Date.now()}-${++n}`;
const started = new Date();
const YEAR = Number(nowAt('Europe/Skopje').date.slice(0, 4));
const LOGO1 = `data:image/png;base64,${Buffer.from('logo-one-' + 'x'.repeat(64)).toString('base64')}`;
const LOGO2 = `data:image/png;base64,${Buffer.from('logo-two-' + 'y'.repeat(64)).toString('base64')}`;

const login = async (email: string, password = 'velnes-demo') =>
  (await app.inject({ method: 'POST', url: `${API_PREFIX}/auth/login`, payload: { email, password } })).json().accessToken as string;
const call = (token: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: unknown) =>
  app.inject({ method, url: `${API_PREFIX}${url}`, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });
const sell = async (body: Record<string, unknown> = {}, token = maria) => {
  const res = await call(token, 'POST', '/sales', { key: key('sale'), locationId: demo.locAerodrom, method: 'Card', lines: [{ kind: 'product', productId: demo.p1, qty: 1 }], ...body });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().invoice as { id: string; number: string; total: number };
};
const draft = async (extra: Record<string, unknown> = {}, token = maria) => {
  const sale = await sell({}, token);
  const res = await call(token, 'POST', '/billing/invoices', { saleId: sale.id, ...extra });
  expect(res.statusCode, res.body).toBe(200);
  return BillingInvoiceSchema.parse(res.json());
};
const issue = (id: string, k = key(), token = maria) => call(token, 'POST', `/billing/invoices/${id}/issue`, { key: k });
const get = async (id: string, token = maria) => BillingInvoiceSchema.parse((await call(token, 'GET', `/billing/invoices/${id}`)).json());
const profile = (over: Record<string, unknown> = {}) => ({
  address: 'Partizanski Odredi 14', city: 'Skopje', zip: '1000', country: 'North Macedonia',
  vatRegistered: true, defaultVatRateBp: 1800, bankName: 'Komercijalna', bankAccount: '300000001234567',
  signatoryName: 'Maria Petrovska', contactEmail: 'office@velnes.mk', tradingName: null, logo: LOGO1, ...over,
});
const putProfile = async (over: Record<string, unknown> = {}, token = maria, le = entityId) => {
  const res = await call(token, 'PUT', `/billing/profiles/${le}`, profile(over));
  return res;
};
const lastSeq = async (le = entityId, year = YEAR, series = '') =>
  Number((await admin.query(`SELECT coalesce(max(last_seq),0) AS s FROM billing_sequences WHERE legal_entity_id=$1 AND series=$2 AND year=$3`, [le, series, year])).rows[0].s);
const statusOf = async (id: string) => (await admin.query(`SELECT status, number FROM billing_invoices WHERE id=$1`, [id])).rows[0] as { status: string; number: string | null };
const mariaClaims: AccessClaims = { sub: demo.empMaria, ten: demo.business, acc: 'owner', rol: demo.roleOwner, locs: [demo.locCentar, demo.locAerodrom] };

/** A complete company identity to invoice to. */
async function companyIdentity() {
  const res = await call(maria, 'POST', '/billing/customers', {
    customerId: demo.c3, kind: 'company', name: 'Nova Health DOO Skopje', address: 'Bul. Ilinden 5', city: 'Skopje', zip: '1000', edb: '4030026512399', vatRegNo: 'MK4030026512399',
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().id as string;
}

describe('issuing accounting invoices', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    maria = await login('maria@velnes.mk');
    ana = await login('ana@velnes.mk');
    stefan = await login('stefan@vitafizio.mk');
    lumen = await login('ana@lumen.mk');
    entityId = (await admin.query(`SELECT id FROM legal_entities WHERE tenant_id=$1 AND owner_type='salon' AND is_default`, [demo.business])).rows[0].id;
    lumenEntity = (await admin.query(`SELECT id FROM legal_entities WHERE tenant_id=$1 AND owner_type='salon' AND is_default`, [demo.bizLumen])).rows[0].id;
    lumenLoc = (await admin.query(`SELECT id FROM locations WHERE tenant_id=$1 AND lifecycle='ACTIVE' ORDER BY name LIMIT 1`, [demo.bizLumen])).rows[0].id;
    lumenSvc = (await admin.query(`SELECT id FROM services WHERE tenant_id=$1 ORDER BY name LIMIT 1`, [demo.bizLumen])).rows[0].id;
    expect((await putProfile()).statusCode).toBe(200);
  });
  afterAll(async () => {
    await admin.query(`UPDATE services SET vat = 18, name = 'Follow-up session' WHERE id = $1`, [demo.s3]);
    await admin.query(`UPDATE products SET name = 'Resistance band set' WHERE id = $1 AND name <> 'Resistance band set'`, [demo.p1]);
    await admin.query(`UPDATE locations SET tz = 'Europe/Skopje' WHERE id = $1`, [demo.locAerodrom]);
    // Test documents only: the frozen-row triggers guard real documents,
    // so the cleanup steps around them as the database owner.
    await admin.query(`SET session_replication_role = replica`);
    await admin.query(`DELETE FROM billing_events WHERE invoice_id IN (SELECT id FROM billing_invoices WHERE created_at >= $1)`, [started]);
    await admin.query(`DELETE FROM billing_invoice_lines WHERE invoice_id IN (SELECT id FROM billing_invoices WHERE created_at >= $1)`, [started]);
    await admin.query(`DELETE FROM billing_invoices WHERE created_at >= $1`, [started]);
    await admin.query(`DELETE FROM billing_assets WHERE created_at >= $1`, [started]);
    await admin.query(`DELETE FROM billing_sequences WHERE legal_entity_id = ANY($1::uuid[])`, [[entityId, lumenEntity]]);
    await admin.query(`SET session_replication_role = DEFAULT`);
    await admin.query(`DELETE FROM billing_customers WHERE created_at >= $1`, [started]);
    await admin.query(`DELETE FROM billing_profiles WHERE legal_entity_id = ANY($1::uuid[])`, [[entityId, lumenEntity]]);
    await admin.end();
    await app.close();
    await closeDb();
  });

  describe('the happy path', () => {
    let issuedId = '';
    let firstSeq = 0;
    it('a ready draft becomes an issued document: number, parts, dates in the location day, actor, frozen logo, events, audit', async () => {
      const co = await companyIdentity();
      const d = await draft({ billingCustomerId: co });
      expect(d.issueReadiness.ready, JSON.stringify(d.issueReadiness)).toBe(true);
      expect(d.events.map((e) => e.kind)).toEqual(['created']);
      const before = await lastSeq();
      const k = key();
      const res = await issue(d.id, k);
      expect(res.statusCode, res.body).toBe(200);
      const doc = BillingInvoiceSchema.parse(res.json());
      issuedId = doc.id;
      firstSeq = doc.numberSeq!;
      expect(doc.status).toBe('issued');
      expect(doc.numberSeq).toBe(before + 1);
      expect(doc.series).toBe('');
      expect(doc.year).toBe(YEAR);
      expect(doc.number).toBe(`${YEAR}-${String(doc.numberSeq).padStart(6, '0')}`);
      expect(doc.issueDate).toBe(nowAt('Europe/Skopje').date);
      expect(doc.issuedAt).toBeTruthy();
      expect(doc.issuedBy).toMatchObject({ id: demo.empMaria, name: 'Maria Petrovska' });
      expect(doc.supplyDate).toBe(d.supplyDate);
      expect(doc.totals).toEqual(d.totals);
      expect(doc.lines).toEqual(d.lines);
      expect(doc.issueReadiness).toEqual({ ready: true, problems: [], warnings: [] });
      // The branding it used is frozen by content, apart from the profile.
      expect(doc.issuer.logoSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(doc.issuer.logoMime).toBe('image/png');
      const asset = (await admin.query(`SELECT data, mime FROM billing_assets WHERE sha256=$1`, [doc.issuer.logoSha256])).rows[0];
      expect(asset).toMatchObject({ data: LOGO1, mime: 'image/png' });
      // The timeline and the platform trail.
      expect(doc.events.map((e) => e.kind)).toEqual(['created', 'issued']);
      const ev = doc.events.find((e) => e.kind === 'issued')!;
      expect(ev.actorName).toBe('Maria Petrovska');
      expect(ev.data).toMatchObject({ number: doc.number, issueDate: doc.issueDate, legalEntityId: entityId, locationId: demo.locAerodrom, netMinor: doc.totals.netMinor, vatMinor: doc.totals.vatMinor, grossMinor: doc.totals.grossMinor, issueKey: k });
      const audit = await admin.query(`SELECT object, after FROM audit_log WHERE tenant_id=$1 AND action='Invoice issued' AND object=$2`, [demo.business, `Invoice · ${doc.number}`]);
      expect(audit.rowCount).toBe(1);
      // What the GET door reads back is what the issue door returned.
      expect(await get(doc.id)).toEqual(doc);
      // The list sees it under Issued.
      const list = BillingInvoiceListSchema.parse((await call(maria, 'GET', '/billing/invoices?status=issued')).json());
      expect(list.invoices.find((r) => r.id === doc.id)?.number).toBe(doc.number);
    });

    it('numbers follow one another; the sequence row, not MAX+1, says so', async () => {
      const a = BillingInvoiceSchema.parse((await issue((await draft()).id)).json());
      const b = BillingInvoiceSchema.parse((await issue((await draft()).id)).json());
      expect(a.numberSeq).toBe(firstSeq + 1);
      expect(b.numberSeq).toBe(firstSeq + 2);
      expect(await lastSeq()).toBe(firstSeq + 2);
      expect([a.number, b.number]).toEqual([`${YEAR}-${String(firstSeq + 1).padStart(6, '0')}`, `${YEAR}-${String(firstSeq + 2).padStart(6, '0')}`]);
    });

    it('idempotency: the same key replays the same document; another key against an issued document is a conflict; a key cannot serve two documents', async () => {
      const d = await draft();
      const k = key();
      const first = BillingInvoiceSchema.parse((await issue(d.id, k)).json());
      const before = await lastSeq();
      const again = await issue(d.id, k);
      expect(again.statusCode).toBe(200);
      const replay = BillingInvoiceSchema.parse(again.json());
      expect(replay).toEqual(first);
      expect(replay.events.filter((e) => e.kind === 'issued')).toHaveLength(1);
      const other = await issue(d.id, key());
      expect(other.statusCode).toBe(409);
      expect(other.json().error).toBe('CONFLICT');
      expect(other.json().message).toContain(first.number);
      const reuse = await issue((await draft()).id, k);
      expect(reuse.statusCode).toBe(409);
      expect(await lastSeq()).toBe(before);
      expect((await statusOf(issuedId)).status).toBe('issued');
    });

    it('an issued document refuses the draft doors: no edit, no delete, no way back', async () => {
      const res = await call(maria, 'PATCH', `/billing/invoices/${issuedId}`, { notes: 'later' });
      expect(res.statusCode).toBe(422);
      expect(res.json().message).toMatch(/credit note/);
      const del = await app.inject({ method: 'DELETE', url: `${API_PREFIX}/billing/invoices/${issuedId}`, headers: { authorization: `Bearer ${maria}` } });
      expect(del.statusCode).toBe(404); // no such door exists
    });
  });

  describe('rights and reach', () => {
    it('billing.create is not billing.issue: the Employee kit drafts but gets 403, and no number moves', async () => {
      const d = await draft({}, ana);
      const before = await lastSeq();
      const res = await issue(d.id, key(), ana);
      expect(res.statusCode).toBe(403);
      expect(res.json().message).toContain('billing.issue');
      expect(await lastSeq()).toBe(before);
      expect((await statusOf(d.id)).status).toBe('draft');
    });
    it("another salon's owner finds nothing to issue", async () => {
      const d = await draft();
      expect((await issue(d.id, key(), stefan)).statusCode).toBe(404);
      expect((await statusOf(d.id)).status).toBe('draft');
    });
  });

  describe('refused before a number is touched', () => {
    const blockedWith = async (id: string, expectProblem: { part: string; field: string; reason: string }) => {
      const before = await lastSeq();
      const res = await issue(id);
      expect(res.statusCode, res.body).toBe(422);
      expect(res.json().error).toBe('ISSUE_BLOCKED');
      expect(res.json().problems).toContainEqual(expectProblem);
      expect(await lastSeq()).toBe(before);
      const row = await statusOf(id);
      expect(row).toEqual({ status: 'draft', number: null });
      // The GET door says the same thing, before anyone clicks.
      const d = await get(id);
      expect(d.issueReadiness.ready).toBe(false);
      expect(d.issueReadiness.problems).toContainEqual(expectProblem);
      return res.json() as { problems: unknown[] };
    };

    it('an incomplete issuer (Phase 1 evaluator): the signatory is missing', async () => {
      const d = await draft();
      expect((await putProfile({ signatoryName: '' })).statusCode).toBe(200);
      try {
        await blockedWith(d.id, { part: 'issuer', field: 'signatoryName', reason: 'missing' });
      } finally {
        expect((await putProfile()).statusCode).toBe(200);
      }
      // Restored, the same draft issues.
      expect((await issue(d.id)).statusCode).toBe(200);
    });

    it('an unverified legal entity', async () => {
      const d = await draft();
      await admin.query(`UPDATE legal_entities SET status='pending' WHERE id=$1`, [entityId]);
      try {
        await blockedWith(d.id, { part: 'issuer', field: 'legalName', reason: 'unverified' });
      } finally {
        await admin.query(`UPDATE legal_entities SET status='verified' WHERE id=$1`, [entityId]);
      }
    });

    it('an incomplete company buyer: the ЕДБ is missing, and nothing is invented', async () => {
      const half = (await admin.query(
        `INSERT INTO billing_customers (tenant_id, kind, name, address, city) VALUES ($1,'company','Half DOO','Ul 1','Skopje') RETURNING id`,
        [demo.business],
      )).rows[0].id as string;
      const d = await draft({ billingCustomerId: half });
      await blockedWith(d.id, { part: 'buyer', field: 'edb', reason: 'missing' });
      // The identity is corrected; the issue door refreshes the buyer from it.
      await admin.query(`UPDATE billing_customers SET edb='4030026512388' WHERE id=$1`, [half]);
      const res = await issue(d.id);
      expect(res.statusCode, res.body).toBe(200);
      expect(BillingInvoiceSchema.parse(res.json()).buyer?.edb).toBe('4030026512388');
    });

    it('a document whose stored money no longer reconciles', async () => {
      const d = await draft();
      const line = d.lines[0]!;
      await admin.query(`UPDATE billing_invoice_lines SET vat_minor = vat_minor + 1, net_minor = net_minor - 1 WHERE id=$1`, [line.id]);
      try {
        await blockedWith(d.id, { part: 'money', field: 'line', reason: 'mismatch' });
      } finally {
        await admin.query(`UPDATE billing_invoice_lines SET vat_minor = $2, net_minor = $3 WHERE id=$1`, [line.id, line.vatMinor, line.netMinor]);
      }
    });

    it('a sale that changed since the draft: refunded', async () => {
      const sale = await sell();
      const d = BillingInvoiceSchema.parse((await call(maria, 'POST', '/billing/invoices', { saleId: sale.id })).json());
      const ref = await call(maria, 'POST', `/invoices/${sale.id}/refund`, { reason: 'test' });
      expect(ref.statusCode, ref.body).toBe(200);
      await blockedWith(d.id, { part: 'sale', field: 'status', reason: 'changed' });
    });

    it('a supply date after the issue date, or a due date before it', async () => {
      const d = await draft();
      const late = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
      expect((await call(maria, 'PATCH', `/billing/invoices/${d.id}`, { supplyDate: late })).statusCode).toBe(200);
      await blockedWith(d.id, { part: 'dates', field: 'supplyDate', reason: 'invalid' });
      expect((await call(maria, 'PATCH', `/billing/invoices/${d.id}`, { supplyDate: d.supplyDate, dueDate: '2020-01-01' })).statusCode).toBe(200);
      await blockedWith(d.id, { part: 'dates', field: 'dueDate', reason: 'invalid' });
    });

    it('the till keeps selling while the issuer is incomplete — accounting stands beside it', async () => {
      expect((await putProfile({ signatoryName: '' })).statusCode).toBe(200);
      try {
        const sale = await sell();
        expect(sale.total).toBeGreaterThan(0);
      } finally {
        expect((await putProfile()).statusCode).toBe(200);
      }
    });
  });

  describe('rollback and gaps', () => {
    it('a failure after the number was reserved gives it back: the next issue gets the same number', async () => {
      const d = await draft();
      const before = await lastSeq();
      await expect(
        withTenant(demo.business, async (trx) => {
          const r = await issueInvoice(trx, mariaClaims, { all: true }, d.id, key());
          expect(r.invoice.numberSeq).toBe(before + 1);
          throw new Error('boom after allocation');
        }),
      ).rejects.toThrow('boom after allocation');
      expect(await lastSeq()).toBe(before);
      expect(await statusOf(d.id)).toEqual({ status: 'draft', number: null });
      expect((await admin.query(`SELECT count(*)::int AS c FROM billing_events WHERE invoice_id=$1 AND kind='issued'`, [d.id])).rows[0].c).toBe(0);
      const res = await issue(d.id);
      expect(res.statusCode).toBe(200);
      expect(BillingInvoiceSchema.parse(res.json()).numberSeq).toBe(before + 1);
    });
  });

  describe('concurrency', () => {
    it('nine drafts under two legal entities issued at once: unique, contiguous, ordered sequences per entity; neither blocks the other', async () => {
      // Lumen Beauty's entity, configured and selling for the first time.
      expect((await putProfile({ logo: null, vatRegistered: false, defaultVatRateBp: 0, signatoryName: 'Ana Gjorgieva' }, lumen, lumenEntity)).statusCode).toBe(200);
      const lumenDraft = async () => {
        const s = await call(lumen, 'POST', '/sales', { key: key('lsale'), locationId: lumenLoc, method: 'Cash', lines: [{ kind: 'service', serviceId: lumenSvc, qty: 1 }] });
        expect(s.statusCode, s.body).toBe(200);
        const r = await call(lumen, 'POST', '/billing/invoices', { saleId: s.json().invoice.id });
        expect(r.statusCode, r.body).toBe(200);
        return BillingInvoiceSchema.parse(r.json());
      };
      const mine = await Promise.all(Array.from({ length: 6 }, () => draft()));
      const theirs = await Promise.all(Array.from({ length: 3 }, () => lumenDraft()));
      const base = await lastSeq();
      expect(await lastSeq(lumenEntity)).toBe(0);

      const results = await Promise.all([
        ...mine.map((d) => issue(d.id)),
        ...theirs.map((d) => issue(d.id, key('l'), lumen)),
      ]);
      for (const r of results) expect(r.statusCode, r.body).toBe(200);
      const docs = results.map((r) => BillingInvoiceSchema.parse(r.json()));
      const ours = docs.filter((d) => d.legalEntityId === entityId);
      const lum = docs.filter((d) => d.legalEntityId === lumenEntity);
      expect(ours).toHaveLength(6);
      expect(lum).toHaveLength(3);
      expect(ours.map((d) => d.numberSeq).sort((a, b) => a! - b!)).toEqual([1, 2, 3, 4, 5, 6].map((i) => base + i));
      expect(lum.map((d) => d.numberSeq).sort((a, b) => a! - b!)).toEqual([1, 2, 3]);
      expect(new Set(docs.map((d) => d.number)).size).toBe(9);
      // Numbers were given in the order the issues committed.
      for (const group of [ours, lum]) {
        const byTime = [...group].sort((a, b) => a.issuedAt!.localeCompare(b.issuedAt!));
        expect(byTime.map((d) => d.numberSeq)).toEqual([...byTime.map((d) => d.numberSeq)].sort((a, b) => a! - b!));
      }
      expect(await lastSeq()).toBe(base + 6);
      expect(await lastSeq(lumenEntity)).toBe(3);
      // All nine are frozen.
      for (const d of docs) await expect(admin.query(`UPDATE billing_invoices SET gross_minor = gross_minor + 1, net_minor = net_minor + 1 WHERE id=$1`, [d.id])).rejects.toThrow(/frozen/);
    });
  });

  describe('immutability at the database', () => {
    let id = '';
    let lineId = '';
    beforeAll(async () => {
      const doc = BillingInvoiceSchema.parse((await issue((await draft({ billingCustomerId: await companyIdentity() })).id)).json());
      expect(doc.billingCustomerId).toBeTruthy();
      id = doc.id;
      lineId = doc.lines[0]!.id;
    });
    const frozen = () => [
      `number = 'X-1'`, `series = 'X'`, `year = 1999`, `number_seq = 999999`, `status = 'draft'`, `status = 'void'`,
      `legal_entity_id = '${lumenEntity}'`, `location_id = '${demo.locCentar}'`, `origin_sale_id = NULL`, `origin = '{}'::jsonb`,
      `issuer = '{}'::jsonb`, `buyer = '{"name":"x"}'::jsonb`, `location = '{}'::jsonb`,
      `supply_date = '2020-01-01'`, `issue_date = '2020-01-01'`, `issued_at = now()`, `due_date = '2030-01-01'`,
      `currency = 'EUR'`, `vat_registered = NOT vat_registered`, `prices_include_vat = NOT prices_include_vat`,
      `net_minor = net_minor + 1, gross_minor = gross_minor + 1`, `vat_minor = vat_minor + 1, gross_minor = gross_minor + 1`,
      `discount_minor = discount_minor + 1`, `vat_breakdown = '[]'::jsonb`, `notes = 'edited'`, `billing_customer_id = NULL`,
      `issued_by = NULL`, `issued_by_name = 'someone'`, `issue_key = 'other'`, `kind = 'credit_note'`, `tenant_id = '${demo.bizLumen}'`,
    ];
    it('every legal, financial and snapshot column refuses UPDATE', async () => {
      for (const set of frozen()) {
        let err = '';
        try {
          await admin.query(`UPDATE billing_invoices SET ${set} WHERE id=$1`, [id]);
        } catch (e) {
          err = String(e);
        }
        expect(err, set).toMatch(/frozen/);
      }
    });
    it('the integration and cache columns stay writable — and nothing else', async () => {
      for (const set of [`paid_minor = 1`, `pdf_sha256 = 'abc'`, `fiscal_receipt_ref = 'FR-1'`, `efaktura_euid = 'E-1'`, `efaktura_status = 'sent'`])
        await admin.query(`UPDATE billing_invoices SET ${set} WHERE id=$1`, [id]);
      await admin.query(`UPDATE billing_invoices SET paid_minor = 0, pdf_sha256 = NULL, fiscal_receipt_ref = NULL, efaktura_euid = NULL, efaktura_status = NULL WHERE id=$1`, [id]);
    });
    it('no DELETE, not even for the owner', async () => {
      await expect(admin.query(`DELETE FROM billing_invoices WHERE id=$1`, [id])).rejects.toThrow(/cannot be deleted/);
    });
    it('lines: no update, delete or insert', async () => {
      await expect(admin.query(`UPDATE billing_invoice_lines SET description='x' WHERE id=$1`, [lineId])).rejects.toThrow(/frozen/);
      await expect(admin.query(`DELETE FROM billing_invoice_lines WHERE id=$1`, [lineId])).rejects.toThrow(/frozen/);
      await expect(
        admin.query(
          `INSERT INTO billing_invoice_lines (tenant_id, invoice_id, item_class, description, qty_milli, unit_price_minor, source_amount_minor, vat_rate_bp, net_minor, vat_minor, gross_minor)
           VALUES ($1,$2,'other','x',1000,100,100,0,100,0,100)`,
          [demo.business, id],
        ),
      ).rejects.toThrow(/frozen/);
    });
    it('events and assets are append-only for everyone', async () => {
      const ev = (await admin.query(`SELECT id FROM billing_events WHERE invoice_id=$1 LIMIT 1`, [id])).rows[0].id;
      await expect(admin.query(`UPDATE billing_events SET actor_name='x' WHERE id=$1`, [ev])).rejects.toThrow(/append-only/);
      await expect(admin.query(`DELETE FROM billing_events WHERE id=$1`, [ev])).rejects.toThrow(/append-only/);
      const sha = (await admin.query(`SELECT sha256 FROM billing_assets WHERE tenant_id=$1 LIMIT 1`, [demo.business])).rows[0].sha256;
      await expect(admin.query(`UPDATE billing_assets SET data='x' WHERE sha256=$1`, [sha])).rejects.toThrow(/immutable/);
      await expect(admin.query(`DELETE FROM billing_assets WHERE sha256=$1`, [sha])).rejects.toThrow(/immutable/);
    });
  });

  describe('the snapshot regression', () => {
    it('after issue, every source changes — entity, profile, bank, signatory, brand, logo, identity, service, VAT rate, location — and the issued JSON does not', async () => {
      const co = await companyIdentity();
      const sale = await sell({ lines: [{ kind: 'service', serviceId: demo.s3, qty: 1 }, { kind: 'product', productId: demo.p1, qty: 1 }] });
      const d = BillingInvoiceSchema.parse((await call(maria, 'POST', '/billing/invoices', { saleId: sale.id, billingCustomerId: co })).json());
      const issued = BillingInvoiceSchema.parse((await issue(d.id)).json());
      const logoBefore = BillingLogoSchema.parse((await call(maria, 'GET', `/billing/invoices/${d.id}/logo`)).json());
      expect(logoBefore).toMatchObject({ sha256: issued.issuer.logoSha256, dataUrl: LOGO1 });

      const entity = (await admin.query(`SELECT name, tax_id, vat_reg, embs FROM legal_entities WHERE id=$1`, [entityId])).rows[0];
      const loc = (await admin.query(`SELECT address, city FROM locations WHERE id=$1`, [demo.locAerodrom])).rows[0];
      try {
        await admin.query(`UPDATE legal_entities SET name='Changed DOOEL', tax_id='MK4030026599999', vat_reg='MK4030026599999', embs='7654321' WHERE id=$1`, [entityId]);
        expect((await putProfile({ address: 'New Street 1', city: 'Bitola', zip: '7000', bankName: 'Stopanska', bankAccount: '200000009876543', signatoryName: 'Someone Else', tradingName: 'New Brand', logo: LOGO2, footerText: 'new footer' })).statusCode).toBe(200);
        expect((await call(maria, 'PATCH', `/billing/customers/${co}`, { customerId: demo.c3, kind: 'company', name: 'Renamed DOO', address: 'Other 9', city: 'Ohrid', zip: '6000', edb: '4030026512300', vatRegNo: 'MK4030026512300' })).statusCode).toBe(200);
        await admin.query(`UPDATE services SET name='Renamed service', vat=5 WHERE id=$1`, [demo.s3]);
        await admin.query(`UPDATE products SET name='Renamed product' WHERE id=$1`, [demo.p1]);
        await admin.query(`UPDATE locations SET address='Elsewhere 9', city='Prilep' WHERE id=$1`, [demo.locAerodrom]);

        const again = await get(d.id);
        expect(again).toEqual(issued);
        const logoAfter = BillingLogoSchema.parse((await call(maria, 'GET', `/billing/invoices/${d.id}/logo`)).json());
        expect(logoAfter).toEqual(logoBefore);
        // A fresh draft, by contrast, sees today's world — the proof the sources did change.
        const fresh = await draft({ billingCustomerId: co });
        expect(fresh.issuer).toMatchObject({ legalName: 'Changed DOOEL', address: 'New Street 1', bankAccount: '200000009876543', signatoryName: 'Someone Else', tradingName: 'New Brand' });
        expect(fresh.buyer?.name).toBe('Renamed DOO');
        expect(fresh.location.address).toBe('Elsewhere 9');
        const freshLogo = BillingLogoSchema.parse((await call(maria, 'GET', `/billing/invoices/${fresh.id}/logo`)).json());
        expect(freshLogo).toMatchObject({ sha256: null, dataUrl: LOGO2 });
      } finally {
        await admin.query(`UPDATE legal_entities SET name=$2, tax_id=$3, vat_reg=$4, embs=$5 WHERE id=$1`, [entityId, entity.name, entity.tax_id, entity.vat_reg, entity.embs]);
        await admin.query(`UPDATE services SET name='Follow-up session', vat=18 WHERE id=$1`, [demo.s3]);
        await admin.query(`UPDATE products SET name='Resistance band set' WHERE id=$1`, [demo.p1]);
        await admin.query(`UPDATE locations SET address=$2, city=$3 WHERE id=$1`, [demo.locAerodrom, loc.address, loc.city]);
        expect((await putProfile()).statusCode).toBe(200);
      }
    });
  });

  describe('the issue date is the location day', () => {
    it('a salon far east of UTC is already in the new year while the server is not: the year, the number and the sequence follow the salon', async () => {
      const d = await draft();
      const before2026 = await lastSeq(entityId, 2026);
      await admin.query(`UPDATE locations SET tz = 'Pacific/Kiritimati' WHERE id = $1`, [demo.locAerodrom]);
      try {
        const r = await withTenant(demo.business, (trx) => issueInvoice(trx, mariaClaims, { all: true }, d.id, key(), new Date('2026-12-31T11:00:00Z')));
        expect(r.invoice.issueDate).toBe('2027-01-01');
        expect(r.invoice.year).toBe(2027);
        expect(r.invoice.numberSeq).toBe(1);
        expect(r.invoice.number).toBe('2027-000001');
        expect(r.invoice.location.tz).toBe('Pacific/Kiritimati');
      } finally {
        await admin.query(`UPDATE locations SET tz = 'Europe/Skopje' WHERE id = $1`, [demo.locAerodrom]);
      }
      expect(await lastSeq(entityId, 2027)).toBe(1);
      expect(await lastSeq(entityId, 2026)).toBe(before2026);
    });
    it('a salon far west of UTC is still in the old year when the server is not: the old sequence continues', async () => {
      const d = await draft();
      const before2026 = await lastSeq(entityId, 2026);
      await admin.query(`UPDATE locations SET tz = 'Etc/GMT+12' WHERE id = $1`, [demo.locAerodrom]);
      try {
        const r = await withTenant(demo.business, (trx) => issueInvoice(trx, mariaClaims, { all: true }, d.id, key(), new Date('2027-01-01T05:00:00Z')));
        expect(r.invoice.issueDate).toBe('2026-12-31');
        expect(r.invoice.year).toBe(2026);
        expect(r.invoice.numberSeq).toBe(before2026 + 1);
      } finally {
        await admin.query(`UPDATE locations SET tz = 'Europe/Skopje' WHERE id = $1`, [demo.locAerodrom]);
      }
      expect(await lastSeq(entityId, 2027)).toBe(1);
    });
  });

  describe('numbering configuration', () => {
    it('once the entity has issued, prefix, width and yearly reset are fixed; the profile says so', async () => {
      const p = BillingProfileSchema.parse((await call(maria, 'GET', `/billing/profiles/${entityId}`)).json());
      expect(p.numberingLocked).toBe(true);
      for (const over of [{ invoicePrefix: 'INV-' }, { numberWidth: 5 }, { yearlyReset: false }, { creditPrefix: 'CN-' }]) {
        const res = await putProfile(over);
        expect(res.statusCode, JSON.stringify(over)).toBe(422);
        expect(res.json().message).toMatch(/Numbering cannot change/);
      }
      // The same numbering, other fields changed: fine.
      expect((await putProfile({ footerText: 'Thank you' })).statusCode).toBe(200);
    });
  });

  describe('the logo door', () => {
    it('a draft without a profile logo answers 204; a draft with one shows the current logo unhashed', async () => {
      expect((await putProfile({ logo: null })).statusCode).toBe(200);
      const d = await draft();
      expect((await call(maria, 'GET', `/billing/invoices/${d.id}/logo`)).statusCode).toBe(204);
      expect((await putProfile()).statusCode).toBe(200);
      const l = BillingLogoSchema.parse((await call(maria, 'GET', `/billing/invoices/${d.id}/logo`)).json());
      expect(l).toEqual({ sha256: null, mime: 'image/png', dataUrl: LOGO1 });
    });
  });
});
