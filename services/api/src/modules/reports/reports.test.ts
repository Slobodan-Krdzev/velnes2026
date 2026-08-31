import { API_PREFIX, ReportSchema } from '@velnes/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';
import { buildServer } from '../../server.js';

const app = await buildServer();
let ownerToken = '';
let anaToken = '';

const localIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localIso(d);
};

const report = (token: string, from: string, to: string) =>
  app.inject({
    method: 'GET',
    url: `${API_PREFIX}/reports?from=${from}&to=${to}`,
    headers: { authorization: `Bearer ${token}` },
  });

describe('the reports door', () => {
  beforeAll(async () => {
    await app.ready();
    const login = async (email: string) =>
      (
        await app.inject({
          method: 'POST',
          url: `${API_PREFIX}/auth/login`,
          payload: { email, password: 'velnes-demo' },
        })
      ).json().accessToken as string;
    ownerToken = await login('maria@velnes.mk');
    anaToken = await login('ana@velnes.mk');
  });
  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  it('computes a period over the seeded history and stays internally consistent', async () => {
    const res = await report(ownerToken, daysAgo(27), daysAgo(1));
    expect(res.statusCode).toBe(200);
    const r = ReportSchema.parse(res.json());
    // The seeded ten weeks of history give every pane something real.
    expect(r.totals.revenue).toBeGreaterThan(0);
    expect(r.totals.appointments).toBeGreaterThan(0);
    expect(r.totals.prevRevenue).toBeGreaterThan(0);
    expect(r.services.length).toBeGreaterThan(3);
    expect(r.products.length).toBeGreaterThan(0);
    expect(r.employees.length).toBeGreaterThanOrEqual(3);
    expect(r.sources.length).toBeGreaterThanOrEqual(5);
    // Internal consistency: the panes are cuts of the same money.
    const daySum = r.daily.reduce((s, d) => s + d.revenue, 0);
    expect(daySum).toBe(r.totals.revenue);
    // VAT covers every paid line (including legacy 'other' lines), so
    // it reconciles with the invoice revenue itself; the service and
    // product panes are subsets of it.
    const vatGross = r.vat.reduce((s, v) => s + v.gross, 0);
    expect(vatGross).toBe(r.totals.revenue);
    const lineSum =
      r.services.reduce((s, x) => s + x.revenue, 0) +
      r.products.reduce((s, x) => s + x.revenue, 0);
    expect(lineSum).toBeLessThanOrEqual(vatGross);
    for (const v of r.vat) expect(v.net + v.vat).toBe(v.gross);
    const locSum = r.locations.reduce((s, l) => s + l.revenue, 0);
    expect(locSum).toBe(r.totals.revenue);
    // The marketplace charges its cut, own channels do not.
    const mp = r.sources.find((s) => s.source === 'marketplace');
    const own = r.sources.find((s) => s.source === 'staff');
    expect(mp && mp.fee).toBeGreaterThan(0);
    expect(own?.fee).toBe(0);
  });

  it('someone with only their own figures sees exactly those', async () => {
    const mine = await report(anaToken, daysAgo(27), daysAgo(1));
    expect(mine.statusCode).toBe(200);
    const r = ReportSchema.parse(mine.json());
    expect(r.employees.length).toBe(1);
    expect(r.employees[0]?.name).toBe('Ana Dimitrova');
    const all = ReportSchema.parse(
      (await report(ownerToken, daysAgo(27), daysAgo(1))).json(),
    );
    expect(r.totals.revenue).toBeLessThan(all.totals.revenue);
  });
});
