import { randomUUID } from 'node:crypto';
import { API_PREFIX, DuePaymentsSchema } from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';
import { demo } from '../../db/seed-demo.js';
import { buildServer } from '../../server.js';

/**
 * Due payments (Alex, 2026-10-01): past visits never paid, for the
 * till's Due tab. Pinned with visits made here: one owed from a week
 * ago with a deposit taken, one owed from yesterday with products, one
 * tomorrow (not yet due), one cancelled (owes nothing). Settling one at
 * the till takes it off the list.
 */
const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });
const ids = { week: randomUUID(), yday: randomUUID(), tomorrow: randomUUID(), gone: randomUUID() };
let maria = '';
let saleKey = '';

describe('due payments', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    maria = (await app.inject({ method: 'POST', url: `${API_PREFIX}/auth/login`, payload: { email: 'maria@velnes.mk', password: 'velnes-demo' } })).json().accessToken as string;
    const row = (id: string, dayOffset: number, status: string, paid: string, deposit: number) =>
      admin.query(
        `INSERT INTO appointments (id, tenant_id, location_id, date, start_min, duration_min, kind, status, title, service_id, employee_id, customer_id, price, deposit, paid, source)
         VALUES ($1, $2, $3, CURRENT_DATE + ($4)::int, 540, 45, 'appointment', $5, 'Owing Tester', $6, $7, $8, 1800, $9, $10, 'client')`,
        [id, demo.business, demo.locCentar, dayOffset, status, demo.s1, demo.empMaria, demo.c1, deposit, paid],
      );
    await row(ids.week, -7, 'confirmed', 'deposit', 500);
    await row(ids.yday, -1, 'booked', 'unpaid', 0);
    await row(ids.tomorrow, 1, 'booked', 'unpaid', 0);
    await row(ids.gone, -2, 'cancelled', 'unpaid', 0);
    await admin.query(`INSERT INTO appointment_products (tenant_id, appointment_id, product_id, name, qty, unit_price) VALUES ($1, $2, $3, 'Kinesiology tape roll', 1, 550)`, [demo.business, ids.yday, demo.p3]);
  });
  afterAll(async () => {
    const all = Object.values(ids);
    await admin.query(`DELETE FROM checkout_items WHERE checkout_id IN (SELECT id FROM checkouts WHERE invoice_id IN (SELECT id FROM invoices WHERE idempotency_key = $1))`, [saleKey]);
    await admin.query(`DELETE FROM merchant_transactions WHERE checkout_id IN (SELECT id FROM checkouts WHERE invoice_id IN (SELECT id FROM invoices WHERE idempotency_key = $1))`, [saleKey]);
    await admin.query(`DELETE FROM checkouts WHERE invoice_id IN (SELECT id FROM invoices WHERE idempotency_key = $1)`, [saleKey]);
    await admin.query(`DELETE FROM stock_movements WHERE ref IN (SELECT number FROM invoices WHERE idempotency_key = $1)`, [saleKey]);
    await admin.query(`DELETE FROM invoice_lines WHERE invoice_id IN (SELECT id FROM invoices WHERE idempotency_key = $1)`, [saleKey]);
    await admin.query(`DELETE FROM invoices WHERE idempotency_key = $1`, [saleKey]);
    await admin.query(`DELETE FROM loyalty_ledger WHERE customer_id = $1 AND created_at > now() - interval '5 minutes'`, [demo.c1]);
    await admin.query(`DELETE FROM appointment_history WHERE appointment_id = ANY($1)`, [all]);
    await admin.query(`DELETE FROM appointments WHERE id = ANY($1)`, [all]);
    await admin.query(`DELETE FROM audit_log WHERE action = 'Sale' AND actor_name = 'Maria Petrovska' AND ts > now() - interval '5 minutes'`);
    await admin.end();
    await app.close();
    await closeDb();
  });

  const due = async () => {
    const res = await app.inject({ method: 'GET', url: `${API_PREFIX}/till/due?locationId=${demo.locCentar}`, headers: { authorization: `Bearer ${maria}` } });
    expect(res.statusCode, res.body).toBe(200);
    return DuePaymentsSchema.parse(res.json());
  };

  it('lists what past visits still owe — oldest first, the deposit shown, products along — and leaves out tomorrow and the cancelled', async () => {
    const out = await due();
    const mine = out.due.filter((d) => d.customerName === 'Owing Tester');
    expect(mine.map((d) => d.appointmentId)).toEqual([ids.week, ids.yday]);
    expect(mine[0]).toMatchObject({ price: 1800, deposit: 500, due: 1300, daysAgo: 7, serviceName: 'Physiotherapy session', employeeName: 'Maria Petrovska', locationName: 'Centar', start: '09:00', end: '09:45' });
    expect(mine[1]).toMatchObject({ price: 1800, deposit: 0, due: 1800, daysAgo: 1, products: [{ productId: demo.p3, name: 'Kinesiology tape roll', qty: 1, unitPrice: 550 }] });
    expect(out.total).toBe(out.due.reduce((n, d) => n + d.due, 0));
    // The other location's till does not see Centar's debts.
    const other = DuePaymentsSchema.parse((await app.inject({ method: 'GET', url: `${API_PREFIX}/till/due?locationId=${demo.locAerodrom}`, headers: { authorization: `Bearer ${maria}` } })).json());
    expect(other.due.some((d) => d.customerName === 'Owing Tester')).toBe(false);
  });

  it('settling the visit at the till takes it off the list', async () => {
    saleKey = randomUUID();
    const sale = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/sales`,
      headers: { authorization: `Bearer ${maria}` },
      payload: { key: saleKey, locationId: demo.locCentar, method: 'Cash', lines: [{ kind: 'appointment', appointmentId: ids.yday, lineDiscount: 0 }] },
    });
    expect(sale.statusCode, sale.body).toBe(200);
    const out = await due();
    expect(out.due.map((d) => d.appointmentId)).not.toContain(ids.yday);
    expect(out.due.map((d) => d.appointmentId)).toContain(ids.week);
  });
});
