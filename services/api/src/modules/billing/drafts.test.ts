import { API_PREFIX, BillingInvoiceListSchema, BillingInvoiceSchema, allocateDiscount, bp, splitGross } from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';
import { demo } from '../../db/seed-demo.js';
import { buildServer } from '../../server.js';

/**
 * Accounting invoice drafts (phase 2, 2026-10-06) — docs/INVOICING.md.
 * Built from till sales at Aerodrom (till.test.ts asserts Centar's next
 * receipt number); Ana is the Employee kit scoped to Aerodrom, Stefan
 * owns another salon. The demo salon's seeded Centar receipts stand in
 * for "a sale outside Ana's reach".
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
const key = () => `p2-draft-${Date.now()}-${++n}`;
const started = new Date();

const login = async (email: string, password = 'velnes-demo') =>
  (await app.inject({ method: 'POST', url: `${API_PREFIX}/auth/login`, payload: { email, password } })).json().accessToken as string;
const call = (token: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: unknown) =>
  app.inject({ method, url: `${API_PREFIX}${url}`, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });
const sell = async (body: Record<string, unknown>, token = maria) => {
  const res = await call(token, 'POST', '/sales', { key: key(), locationId: demo.locAerodrom, method: 'Card', ...body });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().invoice as { id: string; number: string; total: number };
};
const draft = async (saleId: string, extra: Record<string, unknown> = {}, token = maria) => {
  const res = await call(token, 'POST', '/billing/invoices', { saleId, ...extra });
  return res;
};
const profile = (vatRegistered: boolean) => ({
  address: 'Partizanski Odredi 14', city: 'Skopje', zip: '1000', country: 'North Macedonia',
  vatRegistered, defaultVatRateBp: vatRegistered ? 1800 : 0, bankName: 'Komercijalna', bankAccount: '300000001234567',
  signatoryName: 'Maria Petrovska', contactEmail: 'office@velnes.mk', tradingName: null,
});
const saleRow = async (id: string) =>
  (await admin.query(`SELECT total, tip, service_charge, cart_discount, gift_amount, promo_amount, customer_id FROM invoices WHERE id=$1`, [id])).rows[0] as {
    total: number; tip: number; service_charge: number; cart_discount: number; gift_amount: number; promo_amount: number; customer_id: string | null;
  };
const linesOf = async (id: string) => (await admin.query(`SELECT amount, vat FROM invoice_lines WHERE invoice_id=$1 ORDER BY sort`, [id])).rows as { amount: number; vat: number }[];

/** The invariants every draft keeps. */
function checkInvariants(d: ReturnType<typeof BillingInvoiceSchema.parse>, sale: { total: number; tip: number; service_charge: number; gift_amount: number }) {
  for (const l of d.lines) {
    expect(l.netMinor + l.vatMinor).toBe(l.grossMinor);
    expect(l.grossMinor).toBe(l.sourceAmountMinor - l.allocatedDiscountMinor);
    if (d.vatRegistered) expect([l.netMinor, l.vatMinor]).toEqual([splitGross(l.grossMinor, l.vatRateBp).net, splitGross(l.grossMinor, l.vatRateBp).vat]);
    else expect([l.vatMinor, l.vatRateBp, l.exempt]).toEqual([0, 0, true]);
  }
  const sum = (k: 'netMinor' | 'vatMinor' | 'grossMinor') => d.lines.reduce((s, l) => s + l[k], 0);
  expect(d.totals).toMatchObject({ netMinor: sum('netMinor'), vatMinor: sum('vatMinor'), grossMinor: sum('grossMinor') });
  expect(d.totals.netMinor + d.totals.vatMinor).toBe(d.totals.grossMinor);
  expect(d.totals.discountMinor).toBe(d.lines.reduce((s, l) => s + l.allocatedDiscountMinor, 0));
  for (const row of d.vatBreakdown) {
    const mine = d.lines.filter((l) => l.vatRateBp === row.rateBp);
    expect(row.grossMinor).toBe(mine.reduce((s, l) => s + l.grossMinor, 0));
    expect(row.netMinor + row.vatMinor).toBe(row.grossMinor);
  }
  expect(d.vatBreakdown.reduce((s, r) => s + r.grossMinor, 0)).toBe(d.totals.grossMinor);
  // The reconciliation with the originating sale.
  expect(d.totals.grossMinor).toBe((sale.total - sale.tip - sale.service_charge + sale.gift_amount) * 100);
}

describe('accounting invoice drafts', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    maria = await login('maria@velnes.mk');
    ana = await login('ana@velnes.mk');
    stefan = (await login('stefan@vitafizio.mk')) || (await login('stefan@vitafizio.mk', 'velnes-fixture'));
    entityId = (await admin.query(`SELECT id FROM legal_entities WHERE tenant_id=$1 AND owner_type='salon' AND is_default`, [demo.business])).rows[0].id;
    const res = await call(maria, 'PUT', `/billing/profiles/${entityId}`, profile(true));
    expect(res.statusCode, res.body).toBe(200);
  });
  afterAll(async () => {
    await admin.query(`UPDATE products SET vat = 18 WHERE id = ANY($1::uuid[])`, [[demo.p1, demo.p2]]);
    await admin.query(`UPDATE services SET vat = 18, name = 'Follow-up session' WHERE id = $1`, [demo.s3]);
    // Test rows only: the frozen-row triggers guard real documents, so
    // the cleanup steps around them as the database owner.
    await admin.query(`SET session_replication_role = replica`);
    await admin.query(`DELETE FROM billing_invoice_lines WHERE invoice_id IN (SELECT id FROM billing_invoices WHERE created_at >= $1)`, [started]);
    await admin.query(`DELETE FROM billing_invoices WHERE created_at >= $1`, [started]);
    await admin.query(`SET session_replication_role = DEFAULT`);
    await admin.query(`DELETE FROM billing_customers WHERE created_at >= $1`, [started]);
    await admin.query(`DELETE FROM billing_profiles WHERE legal_entity_id = $1`, [entityId]);
    await admin.end();
    await app.close();
    await closeDb();
  });

  describe('creation and snapshots', () => {
    it('a plain sale becomes a draft: issuer, place and money snapshotted, no number, one VAT row', async () => {
      const sale = await sell({ lines: [{ kind: 'product', productId: demo.p1, qty: 2 }] });
      const res = await draft(sale.id);
      expect(res.statusCode, res.body).toBe(200);
      const d = BillingInvoiceSchema.parse(res.json());
      expect(d.status).toBe('draft');
      expect(d.kind).toBe('invoice');
      expect(d.number).toBeNull();
      expect(d.currency).toBe('MKD');
      expect(d.vatRegistered).toBe(true);
      expect(d.issuer).toMatchObject({ legalName: 'Velnes Studio DOOEL Skopje', edb: 'MK4030026512345', vatRegNo: 'MK4030026512345', address: 'Partizanski Odredi 14', bankAccount: '300000001234567', signatoryName: 'Maria Petrovska' });
      expect(d.issuer.tradingName).toBeTruthy();
      expect(d.location).toMatchObject({ locationId: demo.locAerodrom, tz: 'Europe/Skopje' });
      expect(d.location.name).toBeTruthy();
      expect(d.buyer).toBeNull(); // a walk-in
      expect(d.originSaleId).toBe(sale.id);
      expect(d.origin?.saleNumber).toBe(sale.number);
      expect(d.lines).toHaveLength(1);
      expect(d.lines[0]!.qtyMilli).toBe(2000);
      expect(d.lines[0]!.sourceAmountMinor).toBe(sale.total * 100);
      expect(d.lines[0]!.vatRateBp).toBe(1800);
      expect(d.vatBreakdown.map((r) => r.rateBp)).toEqual([1800]);
      expect(d.createdBy.name).toBe('Maria Petrovska');
      expect(d.supplyDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      checkInvariants(d, await saleRow(sale.id));
    });

    it('a discounted, mixed-rate, multi-quantity sale: the cart discount is spread exactly and deterministically, rates grouped', async () => {
      await admin.query(`UPDATE products SET vat = 5 WHERE id = $1`, [demo.p2]);
      const sale = await sell({
        cartDiscount: 50,
        lines: [
          { kind: 'product', productId: demo.p1, qty: 3, lineDiscount: 100 },
          { kind: 'product', productId: demo.p2, qty: 1 },
          { kind: 'product', productId: demo.p1, qty: 1 },
        ],
      });
      const d = BillingInvoiceSchema.parse((await draft(sale.id)).json());
      const src = await linesOf(sale.id);
      expect(d.lines.map((l) => l.sourceAmountMinor)).toEqual(src.map((l) => Number(l.amount) * 100));
      expect(d.lines.map((l) => l.vatRateBp)).toEqual(src.map((l) => bp(Number(l.vat))));
      const parts = allocateDiscount(5000, src.map((l) => Number(l.amount) * 100));
      expect(d.lines.map((l) => l.allocatedDiscountMinor)).toEqual(parts);
      expect(d.totals.discountMinor).toBe(5000);
      expect(d.vatBreakdown.map((r) => r.rateBp)).toEqual([500, 1800]);
      expect(d.origin).toMatchObject({ cartDiscountMinor: 5000, loyaltyMinor: 0, giftTenderMinor: 0, tipMinor: 0, flags: [] });
      checkInvariants(d, await saleRow(sale.id));
      // Deterministic: the same sale again (as a replay) says the same.
      const again = BillingInvoiceSchema.parse((await draft(sale.id)).json());
      expect(again.lines.map((l) => l.allocatedDiscountMinor)).toEqual(parts);
    });

    it('a tip is a gratuity, not a supply: outside the document, named in its origin', async () => {
      const sale = await sell({ tip: 100, lines: [{ kind: 'product', productId: demo.p1, qty: 1 }] });
      const d = BillingInvoiceSchema.parse((await draft(sale.id)).json());
      expect(d.origin?.tipMinor).toBe(10000);
      expect(d.origin?.flags).toContain('tip_excluded');
      expect(d.totals.grossMinor).toBe((sale.total - 100) * 100);
      checkInvariants(d, await saleRow(sale.id));
    });

    it('a sale with a service charge, or a refunded one, is refused rather than guessed', async () => {
      const sc = await sell({ serviceCharge: 50, lines: [{ kind: 'product', productId: demo.p1, qty: 1 }] });
      expect((await draft(sc.id)).statusCode).toBe(422);
      const r = await sell({ lines: [{ kind: 'product', productId: demo.p1, qty: 1 }] });
      await call(maria, 'POST', `/invoices/${r.id}/refund`, { reason: 'test' });
      expect((await draft(r.id)).statusCode).toBe(422);
    });

    it('a non-VAT issuer invoices without VAT: nothing is invented, and the fact is on the document', async () => {
      await call(maria, 'PUT', `/billing/profiles/${entityId}`, profile(false));
      const sale = await sell({ lines: [{ kind: 'product', productId: demo.p1, qty: 2, lineDiscount: 30 }] });
      const d = BillingInvoiceSchema.parse((await draft(sale.id)).json());
      expect(d.vatRegistered).toBe(false);
      expect(d.totals.vatMinor).toBe(0);
      expect(d.totals.netMinor).toBe(d.totals.grossMinor);
      expect(d.vatBreakdown).toEqual([{ rateBp: 0, netMinor: d.totals.grossMinor, vatMinor: 0, grossMinor: d.totals.grossMinor }]);
      checkInvariants(d, await saleRow(sale.id));
      await call(maria, 'PUT', `/billing/profiles/${entityId}`, profile(true));
    });
  });

  describe('buyers', () => {
    let companyIdentity = '';
    it('a customer with one company identity is invoiced to it; a customer without one by name; an explicit identity wins', async () => {
      const co = await call(maria, 'POST', '/billing/customers', { customerId: demo.c2, kind: 'company', name: 'Nova Health DOO Skopje', address: 'Bul. Ilinden 5', city: 'Skopje', zip: '1000', edb: '4030026512399', vatRegNo: 'MK4030026512399' });
      expect(co.statusCode, co.body).toBe(200);
      companyIdentity = co.json().id;
      const s1 = await sell({ customerId: demo.c2, lines: [{ kind: 'product', productId: demo.p1, qty: 1 }] });
      const d1 = BillingInvoiceSchema.parse((await draft(s1.id)).json());
      expect(d1.buyer).toMatchObject({ billingCustomerId: companyIdentity, kind: 'company', name: 'Nova Health DOO Skopje', edb: '4030026512399' });
      expect(d1.buyerCompleteness.complete).toBe(true);
      const s2 = await sell({ customerId: demo.c3, lines: [{ kind: 'product', productId: demo.p1, qty: 1 }] });
      const d2 = BillingInvoiceSchema.parse((await draft(s2.id)).json());
      expect(d2.buyer?.kind).toBe('person');
      expect(d2.buyer?.customerId).toBe(demo.c3);
      expect(d2.billingCustomerId).toBeNull();
      const s3 = await sell({ lines: [{ kind: 'product', productId: demo.p1, qty: 1 }] });
      const d3 = BillingInvoiceSchema.parse((await draft(s3.id, { billingCustomerId: companyIdentity })).json());
      expect(d3.buyer?.billingCustomerId).toBe(companyIdentity);
    });

    it('a company identity missing its ЕДБ leaves the draft possible but not issuable', async () => {
      const id = (await admin.query(
        `INSERT INTO billing_customers (tenant_id, kind, name, address, city) VALUES ($1,'company','Half DOO','Ul 1','Skopje') RETURNING id`,
        [demo.business],
      )).rows[0].id as string;
      const s = await sell({ lines: [{ kind: 'product', productId: demo.p1, qty: 1 }] });
      const d = BillingInvoiceSchema.parse((await draft(s.id, { billingCustomerId: id })).json());
      expect(d.status).toBe('draft');
      expect(d.buyerCompleteness).toMatchObject({ complete: false, missing: ['edb'] });
    });

    it('a foreign billing identity is unknown here', async () => {
      const theirs = await call(stefan, 'POST', '/billing/customers', { kind: 'person', name: 'Theirs' });
      expect(theirs.statusCode, theirs.body).toBe(200);
      const s = await sell({ lines: [{ kind: 'product', productId: demo.p1, qty: 1 }] });
      expect((await draft(s.id, { billingCustomerId: theirs.json().id })).statusCode).toBe(404);
    });
  });

  describe('history stays', () => {
    it('later edits to the catalog, the identity, the brand or the profile never reach a draft', async () => {
      const co = await call(maria, 'POST', '/billing/customers', { customerId: demo.c6, kind: 'company', name: 'Before DOO', address: 'A 1', city: 'Skopje', edb: '4030026512300' });
      const sale = await sell({ customerId: demo.c6, lines: [{ kind: 'service', serviceId: demo.s3, qty: 1 }] });
      const before = BillingInvoiceSchema.parse((await draft(sale.id)).json());
      expect(before.lines[0]!.description).toContain('Follow-up session');
      await admin.query(`UPDATE services SET name = 'Renamed session', vat = 5 WHERE id = $1`, [demo.s3]);
      await call(maria, 'PATCH', `/billing/customers/${co.json().id}`, { customerId: demo.c6, kind: 'company', name: 'After DOO', address: 'B 2', city: 'Bitola', edb: '4030026512300' });
      await call(maria, 'PUT', `/billing/profiles/${entityId}`, { ...profile(true), bankAccount: '210000009999999', tradingName: 'Renamed Brand' });
      const after = BillingInvoiceSchema.parse((await call(maria, 'GET', `/billing/invoices/${before.id}`)).json());
      expect(after.lines[0]!.description).toBe(before.lines[0]!.description);
      expect(after.lines[0]!.vatRateBp).toBe(1800);
      expect(after.buyer?.name).toBe('Before DOO');
      expect(after.issuer.bankAccount).toBe('300000001234567');
      expect(after.issuer.tradingName).toBe(before.issuer.tradingName);
      expect(after.totals).toEqual(before.totals);
      // A new draft from a new sale sees today's world.
      const fresh = BillingInvoiceSchema.parse((await draft((await sell({ customerId: demo.c6, lines: [{ kind: 'service', serviceId: demo.s3, qty: 1 }] })).id)).json());
      expect(fresh.lines[0]!.description).toContain('Renamed session');
      expect(fresh.lines[0]!.vatRateBp).toBe(500);
      expect(fresh.buyer?.name).toBe('After DOO');
      expect(fresh.issuer.bankAccount).toBe('210000009999999');
      await call(maria, 'PUT', `/billing/profiles/${entityId}`, profile(true));
    });
  });

  describe('one draft per sale', () => {
    it('repeated and concurrent creation return the same document', async () => {
      const sale = await sell({ lines: [{ kind: 'product', productId: demo.p1, qty: 1 }] });
      const first = BillingInvoiceSchema.parse((await draft(sale.id)).json());
      const again = BillingInvoiceSchema.parse((await draft(sale.id)).json());
      expect(again.id).toBe(first.id);
      const sale2 = await sell({ lines: [{ kind: 'product', productId: demo.p1, qty: 1 }] });
      const burst = await Promise.all([draft(sale2.id), draft(sale2.id), draft(sale2.id), draft(sale2.id)]);
      expect(burst.map((r) => r.statusCode)).toEqual([200, 200, 200, 200]);
      expect(new Set(burst.map((r) => r.json().id)).size).toBe(1);
      expect((await admin.query(`SELECT count(*)::int AS n FROM billing_invoices WHERE origin_sale_id=$1`, [sale2.id])).rows[0].n).toBe(1);
    });
  });

  describe('editing a draft', () => {
    it('buyer, dates and notes change; origin, entity, location and money do not', async () => {
      const co = await call(maria, 'POST', '/billing/customers', { kind: 'company', name: 'Switch DOO', address: 'S 1', city: 'Skopje', edb: '4030026512311' });
      const sale = await sell({ customerId: demo.c3, lines: [{ kind: 'product', productId: demo.p1, qty: 2 }] });
      const d = BillingInvoiceSchema.parse((await draft(sale.id)).json());
      const res = await call(maria, 'PATCH', `/billing/invoices/${d.id}`, {
        billingCustomerId: co.json().id, dueDate: '2026-11-15', supplyDate: '2026-10-05', notes: 'Payable within 30 days',
        legalEntityId: '00000000-0000-4000-8000-000000000000', locationId: demo.locCentar, originSaleId: '00000000-0000-4000-8000-000000000000', totals: { grossMinor: 1 },
      });
      expect(res.statusCode, res.body).toBe(200);
      const e = BillingInvoiceSchema.parse(res.json());
      expect(e.buyer?.name).toBe('Switch DOO');
      expect(e.billingCustomerId).toBe(co.json().id);
      expect([e.dueDate, e.supplyDate, e.notes]).toEqual(['2026-11-15', '2026-10-05', 'Payable within 30 days']);
      expect([e.legalEntityId, e.locationId, e.originSaleId]).toEqual([d.legalEntityId, d.locationId, d.originSaleId]);
      expect(e.totals).toEqual(d.totals);
      expect(e.lines).toEqual(d.lines);
      expect(e.updatedBy.name).toBe('Maria Petrovska');
      // Back to the sale's own customer.
      const back = BillingInvoiceSchema.parse((await call(maria, 'PATCH', `/billing/invoices/${d.id}`, { billingCustomerId: null })).json());
      expect(back.buyer?.customerId).toBe(demo.c3);
      expect(back.billingCustomerId).toBeNull();
      expect((await admin.query(`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id=$1 AND action='Accounting draft changed'`, [demo.business])).rows[0].n).toBeGreaterThanOrEqual(2);
    });
  });

  describe('reach', () => {
    let centarSale = '';
    let centarDraft = '';
    it("an owner drafts from a Centar receipt; the Aerodrom desk cannot see, draft or change it, and its list stays at its locations", async () => {
      centarSale = (await admin.query(`SELECT id FROM invoices WHERE tenant_id=$1 AND location_id=$2 AND status='Paid' ORDER BY date DESC LIMIT 1`, [demo.business, demo.locCentar])).rows[0].id;
      expect((await draft(centarSale, {}, ana)).statusCode).toBe(404);
      const own = await draft(centarSale);
      expect(own.statusCode, own.body).toBe(200);
      centarDraft = own.json().id;
      expect((await call(ana, 'GET', `/billing/invoices/${centarDraft}`)).statusCode).toBe(404);
      expect((await call(ana, 'PATCH', `/billing/invoices/${centarDraft}`, { notes: 'x' })).statusCode).toBe(404);
      const anaList = BillingInvoiceListSchema.parse((await call(ana, 'GET', '/billing/invoices')).json());
      expect(anaList.invoices.length).toBeGreaterThan(0);
      expect(anaList.invoices.every((i) => i.locationId === demo.locAerodrom)).toBe(true);
      const mariaList = BillingInvoiceListSchema.parse((await call(maria, 'GET', '/billing/invoices?status=draft')).json());
      expect(mariaList.invoices.some((i) => i.id === centarDraft)).toBe(true);
      // The desk may draft its own location's sale.
      const mine = await sell({ lines: [{ kind: 'product', productId: demo.p1, qty: 1 }] }, ana);
      expect((await draft(mine.id, {}, ana)).statusCode).toBe(200);
    });

    it('the list filters by sale number and status', async () => {
      const list = BillingInvoiceListSchema.parse((await call(maria, 'GET', `/billing/invoices?q=${encodeURIComponent('CEN-')}`)).json());
      expect(list.invoices.length).toBeGreaterThan(0);
      expect(list.invoices.every((i) => i.saleNumber?.startsWith('CEN-'))).toBe(true);
      expect(BillingInvoiceListSchema.parse((await call(maria, 'GET', '/billing/invoices?status=issued')).json()).invoices).toEqual([]);
    });

    it("another salon's owner can neither draft from, read, change nor list the demo salon's documents", async () => {
      expect((await draft(centarSale, {}, stefan)).statusCode).toBe(404);
      expect((await call(stefan, 'GET', `/billing/invoices/${centarDraft}`)).statusCode).toBe(404);
      expect((await call(stefan, 'PATCH', `/billing/invoices/${centarDraft}`, { notes: 'hijack' })).statusCode).toBe(404);
      const theirs = BillingInvoiceListSchema.parse((await call(stefan, 'GET', '/billing/invoices')).json());
      expect(theirs.invoices.some((i) => i.id === centarDraft)).toBe(false);
      expect((await admin.query(`SELECT notes FROM billing_invoices WHERE id=$1`, [centarDraft])).rows[0].notes).toBe('');
    });
  });

  describe('the frozen-row preparation', () => {
    it('an issued row cannot have its money or lines changed, even by the database owner path the API uses', async () => {
      const sale = await sell({ lines: [{ kind: 'product', productId: demo.p1, qty: 1 }] });
      const d = BillingInvoiceSchema.parse((await draft(sale.id)).json());
      await admin.query(`UPDATE billing_invoices SET status='issued', issued_at=now(), number='T-1', series='', year=2026, number_seq=1 WHERE id=$1`, [d.id]);
      await expect(admin.query(`UPDATE billing_invoices SET gross_minor = gross_minor + 100, net_minor = net_minor + 100 WHERE id=$1`, [d.id])).rejects.toThrow(/frozen/);
      await expect(admin.query(`DELETE FROM billing_invoice_lines WHERE invoice_id=$1`, [d.id])).rejects.toThrow(/frozen/);
      await admin.query(`UPDATE billing_invoices SET notes = 'a note may still be added' WHERE id=$1`, [d.id]);
      // Nor can it go back to being a draft.
      await expect(admin.query(`UPDATE billing_invoices SET status='draft' WHERE id=$1`, [d.id])).rejects.toThrow(/frozen/);
    });
  });
});
