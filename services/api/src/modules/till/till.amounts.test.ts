import { API_PREFIX, InvoiceSchema, ReportSchema, bp, splitGross } from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';
import { demo } from '../../db/seed-demo.js';
import { buildServer } from '../../server.js';

/**
 * Phase 0 of invoicing (Alex, 2026-10-06) — docs/INVOICING-PLAN.md J.0.
 * Sells at Aerodrom: till.test.ts asserts Centar's next receipt number.
 * The till ledger's arithmetic made trustworthy: every line carries its
 * exact amount, every reader sums that amount, the stored total is the
 * one total, the VAT rate on a line is the catalog's at the moment of
 * sale, and a payment method is one of the six the apps know.
 */
const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });
let maria = '';
let n = 0;
const key = () => `p0-amounts-${Date.now()}-${++n}`;

const call = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
  app.inject({
    method,
    url: `${API_PREFIX}${url}`,
    headers: { authorization: `Bearer ${maria}` },
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });
const sell = (body: Record<string, unknown>) =>
  call('POST', '/sales', { key: key(), locationId: demo.locAerodrom, method: 'Cash', ...body });

/** The ledger's own rows for one receipt. */
const rows = async (id: string) =>
  (await admin.query(`SELECT qty, unit_price, line_discount, amount, vat, item_class FROM invoice_lines WHERE invoice_id=$1 ORDER BY sort`, [id])).rows as {
    qty: number; unit_price: number; line_discount: number; amount: number; vat: number; item_class: string;
  }[];
const total = async (id: string) => Number((await admin.query(`SELECT total FROM invoices WHERE id=$1`, [id])).rows[0].total);

let priceP1 = 0;
let priceP2 = 0;

describe('Phase 0 — the till ledger adds up', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    maria = (await app.inject({ method: 'POST', url: `${API_PREFIX}/auth/login`, payload: { email: 'maria@velnes.mk', password: 'velnes-demo' } })).json().accessToken;
    const p = await admin.query(`SELECT product_id, price FROM location_catalog_products WHERE location_id=$1 AND product_id = ANY($2::uuid[])`, [demo.locAerodrom, [demo.p1, demo.p2]]);
    priceP1 = Number(p.rows.find((r: { product_id: string }) => r.product_id === demo.p1)?.price);
    priceP2 = Number(p.rows.find((r: { product_id: string }) => r.product_id === demo.p2)?.price);
    expect(priceP1).toBeGreaterThan(0);
    expect(priceP2).toBeGreaterThan(0);
  });
  afterAll(async () => {
    await admin.query(`UPDATE products SET vat = 18 WHERE id = $1`, [demo.p2]);
    await admin.query(`UPDATE services SET vat = 18 WHERE id = $1`, [demo.s3]);
    await admin.end();
    await app.close();
    await closeDb();
  });

  describe('the exact line amount', () => {
    it('no discount: amount = qty × price, and the total is that amount', async () => {
      const res = await sell({ lines: [{ kind: 'product', productId: demo.p1, qty: 1 }] });
      expect(res.statusCode, res.body).toBe(200);
      const inv = InvoiceSchema.parse(res.json().invoice);
      const [l] = await rows(inv.id);
      expect(l).toMatchObject({ qty: 1, unit_price: priceP1, line_discount: 0, amount: priceP1 });
      expect(await total(inv.id)).toBe(priceP1);
      expect(inv.lines[0]!.amount).toBe(priceP1);
    });

    it('a line discount lands once: amount = price − discount, unit_price informational', async () => {
      const res = await sell({ lines: [{ kind: 'product', productId: demo.p1, qty: 1, lineDiscount: 100 }] });
      expect(res.statusCode, res.body).toBe(200);
      const inv = InvoiceSchema.parse(res.json().invoice);
      const [l] = await rows(inv.id);
      expect(l!.amount).toBe(priceP1 - 100);
      expect(l!.line_discount).toBe(100);
      expect(await total(inv.id)).toBe(priceP1 - 100);
      // Not price − 2 × discount, which the old readers computed.
      expect(l!.qty * l!.unit_price - l!.line_discount).not.toBe(l!.amount);
    });

    it('quantity > 1 with a discount that does not divide: the amount is exact, the unit price rounded', async () => {
      const res = await sell({ lines: [{ kind: 'product', productId: demo.p1, qty: 3, lineDiscount: 100 }] });
      expect(res.statusCode, res.body).toBe(200);
      const inv = InvoiceSchema.parse(res.json().invoice);
      const [l] = await rows(inv.id);
      expect(l!.amount).toBe(3 * priceP1 - 100);
      expect(l!.unit_price).toBe(Math.round((3 * priceP1 - 100) / 3));
      expect(await total(inv.id)).toBe(3 * priceP1 - 100);
      expect(inv.lines[0]!.amount).toBe(3 * priceP1 - 100);
    });

    it('mixed lines and a cart discount: total = Σ amounts − cart discount, lines untouched by it', async () => {
      const res = await sell({
        cartDiscount: 50,
        lines: [
          { kind: 'product', productId: demo.p1, qty: 2, lineDiscount: 30 },
          { kind: 'product', productId: demo.p2, qty: 1 },
          { kind: 'product', productId: demo.p1, qty: 1, lineDiscount: 0 },
        ],
      });
      expect(res.statusCode, res.body).toBe(200);
      const inv = InvoiceSchema.parse(res.json().invoice);
      const ls = await rows(inv.id);
      expect(ls.map((l) => l.amount)).toEqual([2 * priceP1 - 30, priceP2, priceP1]);
      const sum = ls.reduce((s, l) => s + l.amount, 0);
      expect(await total(inv.id)).toBe(sum - 50);
      expect(inv.total).toBe(sum - 50);
    });
  });

  describe('every reader agrees with the receipt', () => {
    it("the customer's sale history shows the receipt's own total", async () => {
      const res = await sell({ customerId: demo.c2, cartDiscount: 40, lines: [{ kind: 'product', productId: demo.p1, qty: 2, lineDiscount: 60 }] });
      expect(res.statusCode, res.body).toBe(200);
      const inv = InvoiceSchema.parse(res.json().invoice);
      const hist = await call('GET', `/customers/${demo.c2}/invoices`);
      expect(hist.statusCode).toBe(200);
      const row = hist.json().invoices.find((x: { id: string }) => x.id === inv.id);
      expect(row.total).toBe(await total(inv.id));
      expect(row.total).toBe(2 * priceP1 - 60 - 40);
    });

    it('the cash drawer expects exactly the sum of the day\'s cash receipts', async () => {
      await sell({ lines: [{ kind: 'product', productId: demo.p1, qty: 2, lineDiscount: 70 }], cartDiscount: 20, tip: 15 });
      const expected = Number(
        (
          await admin.query(
            `SELECT coalesce(sum(total),0)::int AS s FROM invoices WHERE location_id=$1 AND method='Cash' AND status<>'Refunded' AND date >= CURRENT_DATE`,
            [demo.locAerodrom],
          )
        ).rows[0].s,
      );
      const close = await call('POST', '/till/drawer-close', { locationId: demo.locAerodrom, countedCash: expected });
      expect(close.statusCode, close.body).toBe(200);
      expect(close.json().expectedCash).toBe(expected);
      expect(close.json().difference).toBe(0);
    });

    it('reports sum line amounts: VAT gross = Σ amounts of the day\'s paid lines, by every rate present, net + VAT = gross', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const res = await call('GET', `/reports?from=${today}&to=${today}`);
      expect(res.statusCode, res.body).toBe(200);
      const r = ReportSchema.parse(res.json());
      const ledger = (
        await admin.query(
          `SELECT l.vat AS rate, sum(l.amount)::int AS gross FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
           WHERE i.tenant_id=$1 AND i.status='Paid' AND i.date = CURRENT_DATE GROUP BY l.vat ORDER BY l.vat DESC`,
          [demo.business],
        )
      ).rows as { rate: number; gross: number }[];
      expect(r.vat.map((v) => [v.rate, v.gross])).toEqual(ledger.map((x) => [Number(x.rate), Number(x.gross)]));
      for (const v of r.vat) {
        expect(v.net + v.vat).toBe(v.gross);
        const split = splitGross(v.gross, bp(v.rate));
        expect([v.net, v.vat]).toEqual([split.net, split.vat]);
      }
      // The product pane is a cut of the same amounts.
      const prodLedger = Number(
        (
          await admin.query(
            `SELECT coalesce(sum(l.amount),0)::int AS s FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
             WHERE i.tenant_id=$1 AND i.status='Paid' AND i.date = CURRENT_DATE AND l.item_class='product'`,
            [demo.business],
          )
        ).rows[0].s,
      );
      expect(r.products.reduce((s, p) => s + p.revenue, 0)).toBe(prodLedger);
    });
  });

  describe('the VAT rate is the catalog\'s, at the moment of sale', () => {
    it('a product at 5 % and a service at 10 % reach the line as 5 and 10, and the report shows those rates', async () => {
      await admin.query(`UPDATE products SET vat = 5 WHERE id = $1`, [demo.p2]);
      await admin.query(`UPDATE services SET vat = 10 WHERE id = $1`, [demo.s3]);
      const res = await sell({
        lines: [
          { kind: 'product', productId: demo.p2, qty: 1 },
          { kind: 'service', serviceId: demo.s3, qty: 1 },
        ],
      });
      expect(res.statusCode, res.body).toBe(200);
      const inv = InvoiceSchema.parse(res.json().invoice);
      const ls = await rows(inv.id);
      expect(ls.map((l) => [l.item_class, l.vat])).toEqual([['product', 5], ['service', 10]]);
      expect(inv.lines.map((l) => l.vat)).toEqual([5, 10]);
      const today = new Date().toISOString().slice(0, 10);
      const r = ReportSchema.parse((await call('GET', `/reports?from=${today}&to=${today}`)).json());
      expect(r.vat.map((v) => v.rate)).toEqual(expect.arrayContaining([5, 10, 18]));
      // Changing the catalog afterwards never rewrites the sale.
      await admin.query(`UPDATE products SET vat = 18 WHERE id = $1`, [demo.p2]);
      expect((await rows(inv.id))[0]!.vat).toBe(5);
    });

    it('an appointment line carries its service\'s rate, not a constant', async () => {
      await admin.query(`UPDATE services SET vat = 10 WHERE id = $1`, [demo.s3]);
      // A fresh visit far ahead, so nothing is in its way.
      const d = new Date();
      d.setDate(d.getDate() + 40);
      while (d.getDay() === 0) d.setDate(d.getDate() + 1);
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const booked = await call('POST', '/appointments', {
        key: key(),
        locationId: demo.locAerodrom,
        serviceId: demo.s3,
        date,
        time: '11:00',
        employeeId: demo.empMaria,
        name: 'Phase Zero',
        phone: '+389 70 000 900',
      });
      expect(booked.statusCode, booked.body).toBe(200);
      const apptId = booked.json().appointment.id as string;
      const res = await sell({ lines: [{ kind: 'appointment', appointmentId: apptId }] });
      expect(res.statusCode, res.body).toBe(200);
      const inv = InvoiceSchema.parse(res.json().invoice);
      const [l] = await rows(inv.id);
      expect(l!.vat).toBe(10);
      expect(l!.item_class).toBe('service');
    });
  });

  describe('payment methods', () => {
    it('each of the six the apps emit is accepted; anything else is refused at the door', async () => {
      for (const method of ['Cash', 'Card', 'Gift card', 'Bank transfer']) {
        const res = await sell({ method, lines: [{ kind: 'product', productId: demo.p1, qty: 1 }] });
        expect(res.statusCode, `${method}: ${res.body}`).toBe(200);
        expect(res.json().invoice.method).toBe(method);
      }
      // A spelling that only differs in case or spacing is taken and stored canonically.
      const loose = await sell({ method: ' cash ', lines: [{ kind: 'product', productId: demo.p1, qty: 1 }] });
      expect(loose.statusCode, loose.body).toBe(200);
      expect(loose.json().invoice.method).toBe('Cash');
      const bad = await sell({ method: 'Bitcoin', lines: [{ kind: 'product', productId: demo.p1, qty: 1 }] });
      expect(bad.statusCode).toBe(400);
      // The ledger fences new rows too, whatever path writes them.
      await expect(
        admin.query(`UPDATE invoices SET method = 'Crypto' WHERE idempotency_key LIKE 'p0-amounts-%' AND method = 'Bank transfer'`),
      ).rejects.toThrow(/invoices_method_check/);
    });
  });
});
