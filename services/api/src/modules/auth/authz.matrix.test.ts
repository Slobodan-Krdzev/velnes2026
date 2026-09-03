import { API_PREFIX } from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';
import { demo } from '../../db/seed-demo.js';
import { buildServer } from '../../server.js';

const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });
let ownerToken = '';
let bareToken = '';
let roleId = '';

async function token(email: string) {
  const res = await app.inject({
    method: 'POST',
    url: `${API_PREFIX}/auth/login`,
    payload: { email, password: 'velnes-demo' },
  });
  return res.json().accessToken as string;
}

const call = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
  t = bareToken,
) =>
  app.inject({
    method,
    url: `${API_PREFIX}${url}`,
    headers: { authorization: `Bearer ${t}` },
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });

describe('the permission matrix decides at every door', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    ownerToken = await token('maria@velnes.mk');
    // A role with NO permissions at all; Ana logs in wearing it.
    const created = await call(
      'POST',
      '/roles',
      { name: 'Bare (test)', description: 'Nothing at all.', perms: {} },
      ownerToken,
    );
    roleId = (created.json() as { id: string }).id;
    await call('PATCH', `/employees/${demo.empAna}`, { roleId }, ownerToken);
    bareToken = await token('ana@velnes.mk');
  });
  afterAll(async () => {
    await admin.query(`UPDATE employees SET role_id=$2 WHERE id=$1`, [
      demo.empAna,
      demo.roleEmployee,
    ]);
    await admin.query(`DELETE FROM roles WHERE id=$1`, [roleId]);
    await admin.query(
      `DELETE FROM audit_log WHERE action IN ('Role created','Role changed','Role removed',
        'Customer data exported','Cash drawer closed')`,
    );
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('a role with no permissions is refused at every guarded door, each naming its key', async () => {
    const doors: [string, 'GET' | 'POST' | 'PATCH' | 'DELETE', string, unknown?][] = [
      ['appointments.create', 'POST', '/appointments', {
        key: 'authz-matrix-book', locationId: demo.locAerodrom, serviceId: demo.s1,
        date: '2027-01-04', time: '10:00',
      }],
      ['appointments.view_own', 'GET', `/appointments?locationId=${demo.locAerodrom}&from=2026-09-01&to=2026-09-07`],
      ['appointments.edit', 'PATCH', `/appointments/${demo.locAerodrom}`, { time: '11:00' }],
      ['appointments.cancel', 'PATCH', `/appointments/${demo.locAerodrom}`, { status: 'cancelled' }],
      ['customers.view_assigned', 'GET', '/customers?limit=5'],
      ['customers.view_assigned', 'GET', `/customers/${demo.c2}`],
      ['customers.edit', 'POST', '/customers', { name: 'X', group: 'New' }],
      ['catalog.view', 'GET', `/locations/${demo.locAerodrom}/catalog`],
      ['pos.checkout', 'POST', '/sales', {
        key: 'authz-matrix', locationId: demo.locAerodrom, method: 'Cash',
        lines: [{ kind: 'product', productId: demo.p1, qty: 1, lineDiscount: 0 }],
      }],
      ['pos.view_invoices', 'GET', '/invoices?limit=5'],
      ['pos.refund', 'POST', `/invoices/${demo.locAerodrom}/refund`, { reason: 'x' }],
      ['inventory.adjust', 'POST', '/stock/movements', {
        kind: 'adjustment', locationId: demo.locAerodrom, productId: demo.p1, qty: 1, reason: 'x',
      }],
      ['catalog.edit', 'POST', '/services', { name: 'X', durationMin: 30, price: 1000 }],
      ['catalog.edit', 'POST', `/timings/${demo.locAerodrom}/approve`],
      ['marketing.personal_offers', 'GET', '/personal-offers'],
      ['marketing.personal_offers', 'GET', '/discount-codes'],
      ['reports.view_own', 'GET', '/reports?from=2026-08-01&to=2026-08-31'],
      ['users.manage', 'GET', '/employees/x/../../employees', undefined],
      ['users.manage', 'GET', '/audit?limit=5'],
      ['roles.manage', 'POST', '/roles', { name: 'Y', description: '', perms: {} }],
      ['locations.manage', 'PATCH', `/locations/${demo.locAerodrom}`, { rooms: 3 }],
      ['locations.manage', 'POST', `/locations/${demo.locAerodrom}/exceptions`, {
        startDate: '2027-01-05', type: 'CLOSED', reason: 'x',
      }],
      ['widget.manage', 'GET', '/widgets'],
      ['suppliers.manage', 'GET', '/suppliers'],
      ['inventory.view', 'GET', '/stock/movements?limit=5'],
      ['customers.export', 'GET', '/customers/export'],
      ['cash_drawer.close', 'POST', '/till/drawer-close', {
        locationId: demo.locAerodrom, countedCash: 0,
      }],
    ];
    for (const [key, method, url, payload] of doors) {
      if (key === 'users.manage' && url.includes('..')) continue; // skipped: employees list stays team-visible
      const res = await call(method, url, payload);
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect((res.json() as { message?: string }).message ?? '', `${method} ${url}`).toContain(
        key.split('.')[0]!,
      );
    }
  });

  it('the Employee role sees exactly their own appointments, and no customer list', async () => {
    await admin.query(`UPDATE employees SET role_id=$2 WHERE id=$1`, [
      demo.empAna,
      demo.roleEmployee,
    ]);
    const anaToken = await token('ana@velnes.mk');
    const list = await call(
      'GET',
      `/appointments?locationId=${demo.locAerodrom}&from=2026-08-01&to=2026-09-30`,
      undefined,
      anaToken,
    );
    expect(list.statusCode).toBe(200);
    const rows = (list.json() as { appointments: { employeeId: string | null }[] }).appointments;
    expect(rows.every((a) => a.employeeId === demo.empAna)).toBe(true);
    // "No catalog, no customer list, and no calendar of anyone else."
    const customers = await call('GET', '/customers?limit=5', undefined, anaToken);
    expect(customers.statusCode).toBe(403);
    // The till still sells: pos.checkout opens the resolved catalog.
    const catalog = await call(
      'GET',
      `/locations/${demo.locAerodrom}/catalog`,
      undefined,
      anaToken,
    );
    expect(catalog.statusCode).toBe(200);
  });

  it('the last three doors work for their holders: export, ledger, drawer close — all on the record', async () => {
    // Export: CSV with the seeded customers, audited.
    const exp = await call('GET', '/customers/export', undefined, ownerToken);
    expect(exp.statusCode).toBe(200);
    const body = exp.json() as { csv: string; count: number };
    expect(body.csv.startsWith('name,email,phone')).toBe(true);
    expect(body.csv.split('\n').length).toBe(body.count + 1);

    // Ledger: the movement history reads for inventory.view holders.
    const ledger = await call('GET', '/stock/movements?limit=5', undefined, ownerToken);
    expect(ledger.statusCode).toBe(200);

    // Drawer close: server-computed expected cash, counted on record.
    const drawer = await call(
      'POST',
      '/till/drawer-close',
      { locationId: demo.locAerodrom, countedCash: 500 },
      ownerToken,
    );
    expect(drawer.statusCode).toBe(200);
    const d = drawer.json() as { expectedCash: number; countedCash: number; difference: number };
    expect(d.countedCash).toBe(500);
    expect(d.difference).toBe(500 - d.expectedCash);

    const audit = (await call('GET', '/audit?limit=20', undefined, ownerToken)).json() as {
      entries: { action: string }[];
    };
    expect(audit.entries.some((a) => a.action === 'Customer data exported')).toBe(true);
    expect(audit.entries.some((a) => a.action === 'Cash drawer closed')).toBe(true);
  });
});
