import { API_PREFIX, BillingInvoiceListSchema, BillingInvoiceSchema, BillingPaymentListSchema, derivePaymentState } from '@velnes/contracts';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';
import { demo } from '../../db/seed-demo.js';
import { buildServer } from '../../server.js';
import { CURRENT_RENDERER_VERSION, rendererFor } from './renderers.js';

/**
 * The payment ledger (phase 5, 2026-10-07) and the renderer binding
 * (phase 4 follow-up) — docs/INVOICING.md. Sale-origin evidence on
 * issue, manual records with every refusal, the derived state, who
 * may record, immutability, concurrency, and the canonical PDF
 * untouched by any of it.
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
const key = (p = 'p5') => `${p}-${Date.now()}-${++n}`;
const started = new Date();
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const login = async (email: string, password = 'velnes-demo') =>
  (await app.inject({ method: 'POST', url: `${API_PREFIX}/auth/login`, payload: { email, password } })).json().accessToken as string;
const call = (token: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: unknown) =>
  app.inject({ method, url: `${API_PREFIX}${url}`, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });
const sell = async (body: Record<string, unknown> = {}, token = maria) => {
  const res = await call(token, 'POST', '/sales', { key: key('sale'), locationId: demo.locAerodrom, method: 'Card', lines: [{ kind: 'product', productId: demo.p1, qty: 1 }, { kind: 'service', serviceId: demo.s3, qty: 1 }], ...body });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().invoice as { id: string; number: string; total: number; giftAmount?: number };
};
const draftOf = async (saleId: string) => {
  const res = await call(maria, 'POST', '/billing/invoices', { saleId });
  expect(res.statusCode, res.body).toBe(200);
  return BillingInvoiceSchema.parse(res.json());
};
const issue = async (id: string, k = key()) => {
  const res = await call(maria, 'POST', `/billing/invoices/${id}/issue`, { key: k });
  expect(res.statusCode, res.body).toBe(200);
  return BillingInvoiceSchema.parse(res.json());
};
const ledger = async (id: string, token = maria) => BillingPaymentListSchema.parse((await call(token, 'GET', `/billing/invoices/${id}/payments`)).json());
const record = (id: string, body: Record<string, unknown>, token = maria) =>
  call(token, 'POST', `/billing/invoices/${id}/payments`, { method: 'Bank transfer', paidOn: '2026-10-05', key: key('m'), ...body });
const profile = (over: Record<string, unknown> = {}) => ({
  address: 'Partizanski Odredi 14', city: 'Skopje', zip: '1000', country: 'North Macedonia',
  vatRegistered: true, defaultVatRateBp: 1800, bankName: 'Komercijalna', bankAccount: '300000001234567',
  signatoryName: 'Maria Petrovska', contactEmail: 'office@velnes.mk', tradingName: null, logo: null, ...over,
});

/** An issued document with no sale-origin evidence: the sale is unpaid in the ledger's eyes. */
async function unpaidIssued(): Promise<{ id: string; gross: number; number: string }> {
  // A sale whose tender is a method the ledger cannot vouch for would be
  // refused at the till; instead, issue normally and drop the imported
  // rows as the database owner — the only way to get an unpaid document
  // today, since every sale-backed document is paid at the till.
  const d = await issue((await draftOf((await sell()).id)).id);
  await admin.query(`SET session_replication_role = replica`);
  await admin.query(`DELETE FROM billing_payments WHERE invoice_id=$1`, [d.id]);
  await admin.query(`UPDATE billing_invoices SET paid_minor = 0 WHERE id=$1`, [d.id]);
  await admin.query(`SET session_replication_role = DEFAULT`);
  return { id: d.id, gross: d.totals.grossMinor, number: d.number! };
}

describe('the payment ledger', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    maria = await login('maria@velnes.mk');
    ana = await login('ana@velnes.mk');
    stefan = await login('stefan@vitafizio.mk');
    entityId = (await admin.query(`SELECT id FROM legal_entities WHERE tenant_id=$1 AND owner_type='salon' AND is_default`, [demo.business])).rows[0].id;
    expect((await call(maria, 'PUT', `/billing/profiles/${entityId}`, profile())).statusCode).toBe(200);
  });
  afterAll(async () => {
    await admin.query(`SET session_replication_role = replica`);
    await admin.query(`DELETE FROM billing_payments WHERE invoice_id IN (SELECT id FROM billing_invoices WHERE created_at >= $1)`, [started]);
    await admin.query(`DELETE FROM billing_events WHERE invoice_id IN (SELECT id FROM billing_invoices WHERE created_at >= $1)`, [started]);
    await admin.query(`DELETE FROM billing_invoice_lines WHERE invoice_id IN (SELECT id FROM billing_invoices WHERE created_at >= $1)`, [started]);
    await admin.query(`DELETE FROM billing_invoices WHERE created_at >= $1`, [started]);
    await admin.query(`DELETE FROM billing_assets WHERE created_at >= $1`, [started]);
    await admin.query(`DELETE FROM billing_sequences WHERE legal_entity_id = $1`, [entityId]);
    await admin.query(`SET session_replication_role = DEFAULT`);
    await admin.query(`DELETE FROM billing_profiles WHERE legal_entity_id = $1`, [entityId]);
    await admin.end();
    await app.close();
    await closeDb();
  });

  describe('the derivation', () => {
    it('unpaid below one deni, partially paid between, paid at the gross', () => {
      expect(derivePaymentState(100000, 0)).toBe('unpaid');
      expect(derivePaymentState(100000, 1)).toBe('partially_paid');
      expect(derivePaymentState(100000, 99999)).toBe('partially_paid');
      expect(derivePaymentState(100000, 100000)).toBe('paid');
    });
  });

  describe('sale-origin evidence', () => {
    it('a document issued from a paid card sale is paid: one sale row with the method, the amount, the sale day — the tip outside', async () => {
      const sale = await sell({ tip: 100 });
      const issued = await issue((await draftOf(sale.id)).id);
      expect(issued.payment).toEqual({ grossMinor: issued.totals.grossMinor, paidMinor: issued.totals.grossMinor, outstandingMinor: 0, state: 'paid', count: 1 });
      const l = await ledger(issued.id);
      expect(l.payments).toHaveLength(1);
      expect(l.payments[0]).toMatchObject({ amountMinor: (sale.total - 100) * 100, method: 'Card', source: 'sale', originSaleId: sale.id, originSaleNumber: sale.number, currency: 'MKD', reference: sale.number });
      expect(l.payments[0]!.paidOn).toBe(issued.supplyDate);
      expect(issued.events.map((e) => e.kind)).toEqual(['created', 'issued', 'payment']);
      const row = await admin.query(`SELECT paid_minor FROM billing_invoices WHERE id=$1`, [issued.id]);
      expect(Number(row.rows[0].paid_minor)).toBe(issued.totals.grossMinor);
      // The list reads it as paid, and the Paid tab finds it.
      const list = BillingInvoiceListSchema.parse((await call(maria, 'GET', '/billing/invoices?payment=paid')).json());
      expect(list.invoices.find((r) => r.id === issued.id)).toMatchObject({ paymentState: 'paid', paidMinor: issued.totals.grossMinor });
      const unpaidList = BillingInvoiceListSchema.parse((await call(maria, 'GET', '/billing/invoices?payment=unpaid')).json());
      expect(unpaidList.invoices.find((r) => r.id === issued.id)).toBeUndefined();
    });
    it('a gift card redeemed is a payment row of its own beside the cash — the gross stays whole', async () => {
      const gc = (await admin.query(
        `INSERT INTO gift_cards (tenant_id, code, value, remaining) VALUES ($1, $2, 1000, 1000) RETURNING code`,
        [demo.business, `P5-${Date.now()}`],
      )).rows[0].code as string;
      const res = await call(maria, 'POST', '/sales', { key: key('gsale'), locationId: demo.locAerodrom, method: 'Cash', giftCardCode: gc, giftAmount: 1000, lines: [{ kind: 'product', productId: demo.p1, qty: 1 }, { kind: 'service', serviceId: demo.s3, qty: 1 }] });
      expect(res.statusCode, res.body).toBe(200);
      const saleId = res.json().invoice.id as string;
      const sale = { id: saleId, ...((await admin.query(`SELECT gift_amount AS "giftAmount", total FROM invoices WHERE id=$1`, [saleId])).rows[0] as { giftAmount: number; total: number }) };
      expect(sale.giftAmount).toBe(1000);
      const issued = await issue((await draftOf(sale.id)).id);
      const l = await ledger(issued.id);
      expect(l.summary.state).toBe('paid');
      expect(l.payments.map((p) => [p.method, p.amountMinor, p.source])).toEqual(expect.arrayContaining([['Gift card', sale.giftAmount * 100, 'sale'], ['Cash', sale.total * 100, 'sale']]));
      expect(l.payments.reduce((s, p) => s + p.amountMinor, 0)).toBe(issued.totals.grossMinor);
    });
    it('a retry of the issue door does not duplicate the sale rows', async () => {
      const d = await draftOf((await sell()).id);
      const k = key();
      const a = await issue(d.id, k);
      const b = await issue(d.id, k);
      expect(b.payment).toEqual(a.payment);
      expect((await ledger(d.id)).payments).toHaveLength(1);
      const rows = await admin.query(`SELECT count(*)::int AS c FROM billing_payments WHERE invoice_id=$1`, [d.id]);
      expect(rows.rows[0].c).toBe(1);
    });
  });

  describe('recording a payment', () => {
    it('a full manual payment: the row, the summary, the event, the audit; the amount defaults nothing, the server decides', async () => {
      const u = await unpaidIssued();
      expect((await ledger(u.id)).summary).toEqual({ grossMinor: u.gross, paidMinor: 0, outstandingMinor: u.gross, state: 'unpaid', count: 0 });
      const res = await record(u.id, { amountMinor: u.gross, reference: 'MK202610071234', note: 'transfer seen on the statement' });
      expect(res.statusCode, res.body).toBe(200);
      const l = BillingPaymentListSchema.parse(res.json());
      expect(l.summary).toEqual({ grossMinor: u.gross, paidMinor: u.gross, outstandingMinor: 0, state: 'paid', count: 1 });
      expect(l.payments[0]).toMatchObject({ amountMinor: u.gross, method: 'Bank transfer', source: 'manual', reference: 'MK202610071234', note: 'transfer seen on the statement', paidOn: '2026-10-05', currency: 'MKD', provider: null, originSaleId: null });
      expect(l.payments[0]!.recordedBy.name).toBe('Maria Petrovska');
      // Received on the 5th, recorded today: two different facts.
      expect(l.payments[0]!.paidAt.slice(0, 10)).toBe('2026-10-04'); // the 5th at 00:00 Europe/Skopje is the 4th 22:00Z
      expect(l.payments[0]!.createdAt.slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
      const doc = BillingInvoiceSchema.parse((await call(maria, 'GET', `/billing/invoices/${u.id}`)).json());
      expect(doc.payment.state).toBe('paid');
      expect(doc.events.at(-1)).toMatchObject({ kind: 'payment', data: expect.objectContaining({ source: 'manual', amountMinor: u.gross, state: 'paid' }) });
      const audit = await admin.query(`SELECT reason FROM audit_log WHERE action='Payment recorded' AND object=$1 AND ts >= $2`, [`Invoice · ${u.number}`, started]);
      expect(audit.rowCount).toBe(1);
      expect(audit.rows[0].reason).toContain('recorded outside Velnes');
    });
    it('partial payments add up: 40 %, then the remaining 60 %, exactly', async () => {
      const u = await unpaidIssued();
      const forty = Math.round(u.gross * 0.4);
      const a = BillingPaymentListSchema.parse((await record(u.id, { amountMinor: forty, method: 'Cash' })).json());
      expect(a.summary).toMatchObject({ paidMinor: forty, outstandingMinor: u.gross - forty, state: 'partially_paid', count: 1 });
      const b = BillingPaymentListSchema.parse((await record(u.id, { amountMinor: u.gross - forty, method: 'Card' })).json());
      expect(b.summary).toMatchObject({ paidMinor: u.gross, outstandingMinor: 0, state: 'paid', count: 2 });
      expect(b.payments.map((p) => p.method)).toEqual(['Cash', 'Card']);
    });
    it('today\'s payment keeps the moment; a cash record needs no reference; a retry with the same key returns the same row', async () => {
      const u = await unpaidIssued();
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Skopje' }).format(new Date());
      const k = key('m');
      const a = BillingPaymentListSchema.parse((await record(u.id, { amountMinor: 100, method: 'Cash', paidOn: today, key: k })).json());
      expect(a.payments[0]!.reference).toBe('');
      expect(Math.abs(Date.parse(a.payments[0]!.paidAt) - Date.now())).toBeLessThan(60_000);
      const b = BillingPaymentListSchema.parse((await record(u.id, { amountMinor: 100, method: 'Cash', paidOn: today, key: k })).json());
      expect(b.payments).toHaveLength(1);
      expect(b.summary.paidMinor).toBe(100);
    });
    it('refusals: more than outstanding (with the figures), zero, negative, a draft, a wrong currency, a future day, a key used elsewhere', async () => {
      const u = await unpaidIssued();
      expect((await record(u.id, { amountMinor: u.gross - 200000 })).statusCode).toBe(200);
      const over = await record(u.id, { amountMinor: 300000 });
      expect(over.statusCode).toBe(422);
      expect(over.json()).toMatchObject({ error: 'OVERPAYMENT', outstandingMinor: 200000, paidMinor: u.gross - 200000, grossMinor: u.gross });
      expect((await record(u.id, { amountMinor: 0 })).statusCode).toBe(400);
      expect((await record(u.id, { amountMinor: -100 })).statusCode).toBe(400);
      const d = await draftOf((await sell()).id);
      const onDraft = await record(d.id, { amountMinor: 100 });
      expect(onDraft.statusCode).toBe(422);
      expect(onDraft.json().message).toMatch(/issued/);
      const eur = await record(u.id, { amountMinor: 100, currency: 'EUR' });
      expect(eur.statusCode).toBe(422);
      expect(eur.json().message).toMatch(/not converted/);
      expect((await record(u.id, { amountMinor: 100, paidOn: '2099-01-01' })).statusCode).toBe(422);
      const other = await unpaidIssued();
      const k = key('m');
      expect((await record(u.id, { amountMinor: 100, key: k })).statusCode).toBe(200);
      expect((await record(other.id, { amountMinor: 100, key: k })).statusCode).toBe(409);
      // Nothing of that moved the cache past the ledger.
      const l = await ledger(u.id);
      expect(l.summary.paidMinor).toBe(l.payments.reduce((s, p) => s + p.amountMinor, 0));
      expect((await record(u.id, { amountMinor: 200000 - 100 })).statusCode).toBe(200); // the exact remainder
      expect((await ledger(u.id)).summary.state).toBe('paid');
    });
    it('two desks at once against 1,000 outstanding: one succeeds, the other is refused — never an overpayment', async () => {
      const u = await unpaidIssued();
      expect((await record(u.id, { amountMinor: u.gross - 100000 })).statusCode).toBe(200);
      const [a, b] = await Promise.all([record(u.id, { amountMinor: 100000, method: 'Cash' }), record(u.id, { amountMinor: 100000, method: 'Card' })]);
      expect([a.statusCode, b.statusCode].sort()).toEqual([200, 422]);
      const l = await ledger(u.id);
      expect(l.summary).toMatchObject({ paidMinor: u.gross, outstandingMinor: 0, state: 'paid' });
      expect(Number((await admin.query(`SELECT paid_minor FROM billing_invoices WHERE id=$1`, [u.id])).rows[0].paid_minor)).toBe(u.gross);
    });
  });

  describe('who may record', () => {
    it('the Employee kit records at its own location; billing.read alone cannot POST; another salon finds nothing', async () => {
      const u = await unpaidIssued();
      expect((await record(u.id, { amountMinor: 100 }, ana)).statusCode).toBe(200);
      expect((await record(u.id, { amountMinor: 100 }, stefan)).statusCode).toBe(404);
      expect((await call(stefan, 'GET', `/billing/invoices/${u.id}/payments`)).statusCode).toBe(404);
      const role = (await admin.query(`SELECT role_id FROM employees WHERE id=$1`, [demo.empAna])).rows[0].role_id as string;
      const perms = (await admin.query(`SELECT perms FROM roles WHERE id=$1`, [role])).rows[0].perms as Record<string, string>;
      await admin.query(`UPDATE roles SET perms = perms || '{"billing.record_payment":"none"}'::jsonb WHERE id=$1`, [role]);
      try {
        const res = await record(u.id, { amountMinor: 100 }, ana);
        expect(res.statusCode).toBe(403);
        expect(res.json().message).toContain('billing.record_payment');
        expect((await call(ana, 'GET', `/billing/invoices/${u.id}/payments`)).statusCode).toBe(200); // reading stays
      } finally {
        await admin.query(`UPDATE roles SET perms = $2 WHERE id=$1`, [role, JSON.stringify(perms)]);
      }
      // A document at a location that is not the desk's: none exists at Aerodrom for that case, so the reach is proven by the cross-tenant 404 above and in pdf.test.ts.
    });
  });

  describe('immutability', () => {
    it('a payment row cannot be edited or deleted; the document\'s money, lines, hash and renderer binding stay what they were', async () => {
      const u = await unpaidIssued();
      const before = await call(maria, 'GET', `/billing/invoices/${u.id}/pdf`);
      expect(before.statusCode).toBe(200);
      const hashBefore = sha(before.rawPayload);
      const bound = (await admin.query(`SELECT pdf_sha256, pdf_renderer FROM billing_invoices WHERE id=$1`, [u.id])).rows[0];
      expect(bound).toEqual({ pdf_sha256: hashBefore, pdf_renderer: CURRENT_RENDERER_VERSION });
      const l = BillingPaymentListSchema.parse((await record(u.id, { amountMinor: u.gross })).json());
      const pid = l.payments[0]!.id;
      await expect(admin.query(`UPDATE billing_payments SET amount_minor = 1 WHERE id=$1`, [pid])).rejects.toThrow(/append-only/);
      await expect(admin.query(`DELETE FROM billing_payments WHERE id=$1`, [pid])).rejects.toThrow(/append-only/);
      await expect(admin.query(`UPDATE billing_invoices SET gross_minor = gross_minor + 100, net_minor = net_minor + 100 WHERE id=$1`, [u.id])).rejects.toThrow(/frozen/);
      await expect(admin.query(`UPDATE billing_invoice_lines SET gross_minor = gross_minor WHERE invoice_id=$1`, [u.id])).rejects.toThrow(/frozen/);
      // The cache cannot be pushed past the gross, even by hand.
      await expect(admin.query(`UPDATE billing_invoices SET paid_minor = gross_minor + 1 WHERE id=$1`, [u.id])).rejects.toThrow(/paid_within/);
      // The canonical PDF: same bytes after the payment, hash and binding untouched.
      const after = await call(maria, 'GET', `/billing/invoices/${u.id}/pdf`);
      expect(after.statusCode).toBe(200);
      expect(sha(after.rawPayload)).toBe(hashBefore);
      expect(after.rawPayload.equals(before.rawPayload)).toBe(true);
      expect((await admin.query(`SELECT pdf_sha256, pdf_renderer FROM billing_invoices WHERE id=$1`, [u.id])).rows[0]).toEqual(bound);
      const doc = BillingInvoiceSchema.parse((await call(maria, 'GET', `/billing/invoices/${u.id}`)).json());
      expect(doc.payment.state).toBe('paid');
      expect(doc.pdfSha256).toBe(hashBefore);
    });
    it('a payment on a draft is refused at the database too, and so is a foreign currency', async () => {
      const d = await draftOf((await sell()).id);
      await expect(
        admin.query(`INSERT INTO billing_payments (tenant_id, invoice_id, amount_minor, currency, method, source, paid_at, paid_on) VALUES ($1,$2,100,'MKD','Cash','manual',now(),current_date)`, [demo.business, d.id]),
      ).rejects.toThrow(/issued document only/);
      const u = await unpaidIssued();
      await expect(
        admin.query(`INSERT INTO billing_payments (tenant_id, invoice_id, amount_minor, currency, method, source, paid_at, paid_on) VALUES ($1,$2,100,'EUR','Cash','manual',now(),current_date)`, [demo.business, u.id]),
      ).rejects.toThrow(/currency/);
      await expect(
        admin.query(`INSERT INTO billing_payments (tenant_id, invoice_id, amount_minor, currency, method, source, paid_at, paid_on) VALUES ($1,$2,-100,'MKD','Cash','manual',now(),current_date)`, [demo.business, u.id]),
      ).rejects.toThrow(/amount_minor/);
    });
  });

  describe('the renderer binding (phase 4 follow-up)', () => {
    it('a hashed document is bound to its renderer; neither the hash nor the binding can be cleared or changed; an unregistered version cannot render', async () => {
      const u = await unpaidIssued();
      expect((await call(maria, 'GET', `/billing/invoices/${u.id}/pdf`)).statusCode).toBe(200);
      const bound = (await admin.query(`SELECT pdf_sha256, pdf_renderer FROM billing_invoices WHERE id=$1`, [u.id])).rows[0];
      expect(bound.pdf_renderer).toBe(CURRENT_RENDERER_VERSION);
      await expect(admin.query(`UPDATE billing_invoices SET pdf_sha256 = NULL, pdf_renderer = NULL WHERE id=$1`, [u.id])).rejects.toThrow(/permanent/);
      await expect(admin.query(`UPDATE billing_invoices SET pdf_sha256 = 'ab' WHERE id=$1`, [u.id])).rejects.toThrow(/permanent/);
      await expect(admin.query(`UPDATE billing_invoices SET pdf_renderer = '9999.01.01-1' WHERE id=$1`, [u.id])).rejects.toThrow(/permanent/);
      // A hash without a binding, or a binding without a hash, is not a row that can exist.
      const d = await issue((await draftOf((await sell()).id)).id);
      await expect(admin.query(`UPDATE billing_invoices SET pdf_sha256 = 'ab' WHERE id=$1`, [d.id])).rejects.toThrow(/pdf_binding/);
      expect(rendererFor(null).version).toBe(CURRENT_RENDERER_VERSION);
      expect(rendererFor(CURRENT_RENDERER_VERSION).version).toBe(CURRENT_RENDERER_VERSION);
      expect(() => rendererFor('9999.01.01-1')).toThrow(/not registered/);
    });
  });
});
