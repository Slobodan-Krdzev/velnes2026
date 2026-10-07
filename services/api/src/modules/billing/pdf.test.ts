import { API_PREFIX, BillingInvoiceSchema } from '@velnes/contracts';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';
import { demo } from '../../db/seed-demo.js';
import { buildServer } from '../../server.js';
import { CURRENT_RENDERER_VERSION } from './renderers.js';

/**
 * The canonical PDF door (phase 4, 2026-10-07) — docs/INVOICING.md
 * "Phase 4". Issued documents at Aerodrom, the hash lifecycle, the
 * language frozen at issue, the regression against every mutable
 * source, the integrity refusal, and who may fetch what.
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
let entityId = '';
let n = 0;
const key = (p = 'p4') => `${p}-${Date.now()}-${++n}`;
const started = new Date();
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const JPEG2 = JPEG.replace('AAD/2wBD', 'AAD/2wBE'); // another logo, byte for byte

const login = async (email: string, password = 'velnes-demo') =>
  (await app.inject({ method: 'POST', url: `${API_PREFIX}/auth/login`, payload: { email, password } })).json().accessToken as string;
const call = (token: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: unknown) =>
  app.inject({ method, url: `${API_PREFIX}${url}`, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });
const sell = async (body: Record<string, unknown> = {}, token = maria) => {
  const res = await call(token, 'POST', '/sales', { key: key('sale'), locationId: demo.locAerodrom, method: 'Card', lines: [{ kind: 'product', productId: demo.p1, qty: 1 }, { kind: 'service', serviceId: demo.s3, qty: 1 }], ...body });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().invoice as { id: string; number: string };
};
const draft = async (extra: Record<string, unknown> = {}, saleBody: Record<string, unknown> = {}) => {
  const sale = await sell(saleBody);
  const res = await call(maria, 'POST', '/billing/invoices', { saleId: sale.id, ...extra });
  expect(res.statusCode, res.body).toBe(200);
  return BillingInvoiceSchema.parse(res.json());
};
const issue = async (id: string) => {
  const res = await call(maria, 'POST', `/billing/invoices/${id}/issue`, { key: key() });
  expect(res.statusCode, res.body).toBe(200);
  return BillingInvoiceSchema.parse(res.json());
};
const pdf = (id: string, token = maria, q = '') => call(token, 'GET', `/billing/invoices/${id}/pdf${q}`);
const profile = (over: Record<string, unknown> = {}) => ({
  address: 'Partizanski Odredi 14', city: 'Skopje', zip: '1000', country: 'North Macedonia',
  vatRegistered: true, defaultVatRateBp: 1800, bankName: 'Komercijalna', bankAccount: '300000001234567',
  signatoryName: 'Maria Petrovska', contactEmail: 'office@velnes.mk', tradingName: null, logo: JPEG, footerText: 'Ви благодариме.', ...over,
});
const putProfile = async (over: Record<string, unknown> = {}) => call(maria, 'PUT', `/billing/profiles/${entityId}`, profile(over));
const storedSha = async (id: string) => (await admin.query(`SELECT pdf_sha256 FROM billing_invoices WHERE id=$1`, [id])).rows[0].pdf_sha256 as string | null;
const pdfEvents = async (id: string) => (await admin.query(`SELECT data FROM billing_events WHERE invoice_id=$1 AND kind='pdf' ORDER BY at`, [id])).rows.map((r) => r.data as Record<string, unknown>);

async function companyIdentity() {
  const res = await call(maria, 'POST', '/billing/customers', {
    customerId: demo.c3, kind: 'company', name: 'Nova Health DOO Skopje', address: 'Bul. Ilinden 5', city: 'Skopje', zip: '1000', edb: '4030026512399', vatRegNo: 'MK4030026512399',
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().id as string;
}

describe('the canonical invoice PDF', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    maria = await login('maria@velnes.mk');
    ana = await login('ana@velnes.mk');
    stefan = await login('stefan@vitafizio.mk');
    entityId = (await admin.query(`SELECT id FROM legal_entities WHERE tenant_id=$1 AND owner_type='salon' AND is_default`, [demo.business])).rows[0].id;
    expect((await putProfile()).statusCode).toBe(200);
  });
  afterAll(async () => {
    await admin.query(`UPDATE services SET vat = 18, name = 'Follow-up session' WHERE id = $1`, [demo.s3]);
    await admin.query(`UPDATE products SET name = 'Resistance band set' WHERE id = $1`, [demo.p1]);
    await admin.query(`SET session_replication_role = replica`);
    await admin.query(`DELETE FROM billing_events WHERE invoice_id IN (SELECT id FROM billing_invoices WHERE created_at >= $1)`, [started]);
    await admin.query(`DELETE FROM billing_invoice_lines WHERE invoice_id IN (SELECT id FROM billing_invoices WHERE created_at >= $1)`, [started]);
    await admin.query(`DELETE FROM billing_invoices WHERE created_at >= $1`, [started]);
    await admin.query(`DELETE FROM billing_assets WHERE created_at >= $1`, [started]);
    await admin.query(`DELETE FROM billing_sequences WHERE legal_entity_id = $1`, [entityId]);
    await admin.query(`SET session_replication_role = DEFAULT`);
    await admin.query(`DELETE FROM billing_customers WHERE created_at >= $1`, [started]);
    await admin.query(`DELETE FROM billing_profiles WHERE legal_entity_id = $1`, [entityId]);
    await admin.end();
    await app.close();
    await closeDb();
  });

  describe('the door and the hash', () => {
    let id = '';
    let bytes: Buffer;
    it('an issued document answers with the PDF, its filename, its hash as ETag, and the hash is written once', async () => {
      const d = await draft({ billingCustomerId: await companyIdentity() });
      expect(d.pdfSha256).toBeNull();
      const issued = await issue(d.id);
      id = issued.id;
      expect(await storedSha(id)).toBeNull();
      const res = await pdf(id);
      expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toBe(`inline; filename="invoice-${issued.number}.pdf"`);
      bytes = res.rawPayload;
      expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
      const h = sha(bytes);
      expect(res.headers.etag).toBe(`"${h}"`);
      expect(res.headers['x-document-sha256']).toBe(h);
      expect(await storedSha(id)).toBe(h);
      expect(await pdfEvents(id)).toEqual([expect.objectContaining({ sha256: h, bytes: bytes.length, lang: 'mk', logo: 'embedded' })]);
      const doc = BillingInvoiceSchema.parse((await call(maria, 'GET', `/billing/invoices/${id}`)).json());
      expect(doc.pdfSha256).toBe(h);
      expect(doc.events.map((e) => e.kind)).toEqual(['created', 'issued', 'payment', 'pdf']); // phase 5: the sale's tender follows the issue
    });
    it('three more renders reproduce the same bytes; download is the same document with another disposition; no new event', async () => {
      for (let i = 0; i < 3; i++) {
        const res = await pdf(id);
        expect(res.statusCode).toBe(200);
        expect(res.rawPayload.equals(bytes)).toBe(true);
      }
      const dl = await pdf(id, maria, '?download=1');
      expect(dl.statusCode).toBe(200);
      expect(dl.headers['content-disposition']).toMatch(/^attachment; filename="invoice-\d{4}-\d{6}\.pdf"$/);
      expect(dl.rawPayload.equals(bytes)).toBe(true);
      expect(await pdfEvents(id)).toHaveLength(1);
    });
    it('a draft has no PDF', async () => {
      const d = await draft();
      const res = await pdf(d.id);
      expect(res.statusCode).toBe(422);
      expect(res.json().message).toMatch(/issued/);
      expect(await storedSha(d.id)).toBeNull();
    });
  });

  describe('the language', () => {
    it('defaults to Macedonian for this salon, follows an explicit choice, can change on the draft and never after issue', async () => {
      const d = await draft();
      expect(d.lang).toBe('mk');
      const sq = await draft({ lang: 'sq' });
      expect(sq.lang).toBe('sq');
      const en = BillingInvoiceSchema.parse((await call(maria, 'PATCH', `/billing/invoices/${sq.id}`, { lang: 'en' })).json());
      expect(en.lang).toBe('en');
      expect(en.events.at(-1)).toMatchObject({ kind: 'edited', data: expect.objectContaining({ fields: ['lang'] }) });
      const issued = await issue(sq.id);
      expect(issued.lang).toBe('en');
      expect((await call(maria, 'PATCH', `/billing/invoices/${sq.id}`, { lang: 'mk' })).statusCode).toBe(422);
      await expect(admin.query(`UPDATE billing_invoices SET lang='mk' WHERE id=$1`, [sq.id])).rejects.toThrow(/frozen/);
      const mkDoc = await issue(d.id);
      const [a, b] = await Promise.all([pdf(sq.id), pdf(mkDoc.id)]);
      expect(a.statusCode).toBe(200);
      expect(b.statusCode).toBe(200);
      expect(sha(a.rawPayload)).not.toBe(sha(b.rawPayload));
    });
    it("follows the buyer's Velnes account language when the customer has one", async () => {
      // A consumer account already linked to one of this salon's customers, or a fresh link.
      let link = (await admin.query(`SELECT client_user_id, customer_id FROM client_customer_links WHERE tenant_id=$1 LIMIT 1`, [demo.business])).rows[0] as { client_user_id: string; customer_id: string } | undefined;
      let inserted = false;
      if (!link) {
        const cu = (await admin.query(`SELECT u.id FROM client_users u WHERE NOT EXISTS (SELECT 1 FROM client_customer_links l WHERE l.client_user_id = u.id AND l.tenant_id = $1) LIMIT 1`, [demo.business])).rows[0]?.id as string | undefined;
        if (!cu) return; // no consumer accounts at all: nothing to follow
        await admin.query(`INSERT INTO client_customer_links (client_user_id, tenant_id, customer_id) VALUES ($1,$2,$3)`, [cu, demo.business, demo.c4]);
        link = { client_user_id: cu, customer_id: demo.c4 };
        inserted = true;
      }
      const before = (await admin.query(`SELECT lang FROM client_users WHERE id=$1`, [link.client_user_id])).rows[0].lang as string;
      await admin.query(`UPDATE client_users SET lang='sq' WHERE id=$1`, [link.client_user_id]);
      try {
        const d = await draft({}, { customerId: link.customer_id });
        expect(d.buyer?.customerId ?? link.customer_id).toBe(link.customer_id);
        expect(d.lang).toBe('sq');
        // The explicit choice still wins.
        expect((await draft({ lang: 'en' }, { customerId: link.customer_id })).lang).toBe('en');
      } finally {
        await admin.query(`UPDATE client_users SET lang=$2 WHERE id=$1`, [link.client_user_id, before]);
        if (inserted) await admin.query(`DELETE FROM client_customer_links WHERE client_user_id=$1 AND tenant_id=$2`, [link.client_user_id, demo.business]);
      }
    });
  });

  describe('the regression: nothing current reaches the page', () => {
    it('after the entity, profile, logo, buyer, business, location, service and product all change, the bytes and the hash are identical', async () => {
      const co = await companyIdentity();
      const issued = await issue((await draft({ billingCustomerId: co })).id);
      const first = await pdf(issued.id);
      expect(first.statusCode).toBe(200);
      const h = sha(first.rawPayload);
      const entity = (await admin.query(`SELECT name, tax_id, vat_reg, embs FROM legal_entities WHERE id=$1`, [entityId])).rows[0];
      const biz = (await admin.query(`SELECT name FROM businesses WHERE id=$1`, [demo.business])).rows[0];
      const loc = (await admin.query(`SELECT name, address, city FROM locations WHERE id=$1`, [demo.locAerodrom])).rows[0];
      try {
        await admin.query(`UPDATE legal_entities SET name='Changed DOOEL', tax_id='MK4030026599999', vat_reg='MK4030026599999', embs='7654321' WHERE id=$1`, [entityId]);
        expect((await putProfile({ address: 'New Street 1', city: 'Bitola', bankAccount: '200000009876543', signatoryName: 'Someone Else', tradingName: 'New Brand', logo: JPEG2, footerText: 'Different footer', paymentInstructions: 'Pay elsewhere' })).statusCode).toBe(200);
        expect((await call(maria, 'PATCH', `/billing/customers/${co}`, { customerId: demo.c3, kind: 'company', name: 'Renamed DOO', address: 'Other 9', city: 'Ohrid', zip: '6000', edb: '4030026512300', vatRegNo: 'MK4030026512300' })).statusCode).toBe(200);
        await admin.query(`UPDATE businesses SET name='Renamed Salon' WHERE id=$1`, [demo.business]);
        await admin.query(`UPDATE locations SET name='Moved', address='Elsewhere 9', city='Prilep' WHERE id=$1`, [demo.locAerodrom]);
        await admin.query(`UPDATE services SET name='Renamed service', vat=5 WHERE id=$1`, [demo.s3]);
        await admin.query(`UPDATE products SET name='Renamed product' WHERE id=$1`, [demo.p1]);
        const again = await pdf(issued.id);
        expect(again.statusCode).toBe(200);
        expect(sha(again.rawPayload)).toBe(h);
        expect(again.rawPayload.equals(first.rawPayload)).toBe(true);
        expect(await storedSha(issued.id)).toBe(h);
      } finally {
        await admin.query(`UPDATE legal_entities SET name=$2, tax_id=$3, vat_reg=$4, embs=$5 WHERE id=$1`, [entityId, entity.name, entity.tax_id, entity.vat_reg, entity.embs]);
        await admin.query(`UPDATE businesses SET name=$2 WHERE id=$1`, [demo.business, biz.name]);
        await admin.query(`UPDATE locations SET name=$2, address=$3, city=$4 WHERE id=$1`, [demo.locAerodrom, loc.name, loc.address, loc.city]);
        await admin.query(`UPDATE services SET name='Follow-up session', vat=18 WHERE id=$1`, [demo.s3]);
        await admin.query(`UPDATE products SET name='Resistance band set' WHERE id=$1`, [demo.p1]);
        expect((await putProfile()).statusCode).toBe(200);
      }
    });
  });

  describe('integrity', () => {
    it('a stored hash the render no longer reproduces is refused, recorded, and never overwritten', async () => {
      // The hash is permanent once set, so the only way to stage a mismatch
      // is a wrong hash written before the first render — as a corrupted
      // or tampered row would carry.
      const issued = await issue((await draft()).id);
      const wrong = 'deadbeef'.repeat(8);
      await admin.query(`UPDATE billing_invoices SET pdf_sha256 = $2, pdf_renderer = $3 WHERE id=$1`, [issued.id, wrong, CURRENT_RENDERER_VERSION]);
      const res = await pdf(issued.id);
      expect(res.statusCode).toBe(500);
      expect(res.json().error).toBe('INTEGRITY');
      expect(res.headers['content-type']).not.toBe('application/pdf');
      expect(await storedSha(issued.id)).toBe(wrong);
      const audit = await admin.query(`SELECT before, after FROM audit_log WHERE tenant_id=$1 AND action='Invoice PDF integrity failure' AND object=$2 AND ts >= $3`, [demo.business, `Invoice · ${issued.number}`, started]);
      expect(audit.rowCount).toBe(1);
      expect(audit.rows[0].before).toBe(wrong);
      expect(audit.rows[0].after).toMatch(/^[0-9a-f]{64}$/);
      expect((await pdfEvents(issued.id)).at(-1)).toMatchObject({ integrity: 'mismatch', expected: wrong });
      // And it stays refused: there is no door, and no UPDATE, that re-establishes a hash.
      await expect(admin.query(`UPDATE billing_invoices SET pdf_sha256 = NULL, pdf_renderer = NULL WHERE id=$1`, [issued.id])).rejects.toThrow(/permanent/);
      expect((await pdf(issued.id)).statusCode).toBe(500);
    });
    it('a missing frozen logo asset is an integrity failure, not a fallback to the current logo', async () => {
      const issued = await issue((await draft()).id);
      expect(issued.issuer.logoSha256).toBeTruthy();
      const row = (await admin.query(`SELECT data, mime, bytes FROM billing_assets WHERE sha256=$1`, [issued.issuer.logoSha256])).rows[0];
      await admin.query(`SET session_replication_role = replica`);
      await admin.query(`DELETE FROM billing_assets WHERE sha256=$1`, [issued.issuer.logoSha256]);
      await admin.query(`SET session_replication_role = DEFAULT`);
      try {
        const res = await pdf(issued.id);
        expect(res.statusCode).toBe(500);
        expect(res.json().error).toBe('INTEGRITY');
      } finally {
        await admin.query(`INSERT INTO billing_assets (tenant_id, sha256, kind, mime, bytes, data) VALUES ($1,$2,'logo',$3,$4,$5)`, [demo.business, issued.issuer.logoSha256, row.mime, row.bytes, row.data]);
      }
      expect((await pdf(issued.id)).statusCode).toBe(200);
    });
  });

  describe('who may fetch', () => {
    it("the location desk with billing.read reaches its own location's document; without the right it is 403; another salon's owner finds nothing", async () => {
      const issued = await issue((await draft()).id);
      expect((await pdf(issued.id, ana)).statusCode).toBe(200);
      expect((await pdf(issued.id, stefan)).statusCode).toBe(404);
      const role = (await admin.query(`SELECT role_id FROM employees WHERE id=$1`, [demo.empAna])).rows[0].role_id as string;
      const perms = (await admin.query(`SELECT perms FROM roles WHERE id=$1`, [role])).rows[0].perms as Record<string, string>;
      await admin.query(`UPDATE roles SET perms = perms || '{"billing.read":"none"}'::jsonb WHERE id=$1`, [role]);
      try {
        expect((await pdf(issued.id, ana)).statusCode).toBe(403);
      } finally {
        await admin.query(`UPDATE roles SET perms = $2 WHERE id=$1`, [role, JSON.stringify(perms)]);
      }
      // A document outside the desk's locations: the demo salon's other location is not Ana's.
      const centar = (await admin.query(`SELECT id FROM billing_invoices WHERE tenant_id=$1 AND location_id=$2 LIMIT 1`, [demo.business, demo.locCentar])).rows[0]?.id as string | undefined;
      if (centar) expect((await pdf(centar, ana)).statusCode).toBe(404);
    });
  });
});
