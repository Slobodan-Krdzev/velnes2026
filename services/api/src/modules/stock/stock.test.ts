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
let mariaToken = '';
let anaToken = '';

const move = (payload: object, tok: string) =>
  app.inject({
    method: 'POST',
    url: `${API_PREFIX}/stock/movements`,
    headers: { authorization: `Bearer ${tok}` },
    payload,
  });

const stockOf = async (loc: string, pid: string) =>
  (
    await admin.query(
      `SELECT stock FROM location_catalog_products WHERE location_id=$1 AND product_id=$2`,
      [loc, pid],
    )
  ).rows[0]?.stock;

describe('stock door', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    const login = async (email: string) =>
      (
        await app.inject({
          method: 'POST',
          url: `${API_PREFIX}/auth/login`,
          payload: { email, password: 'velnes-demo' },
        })
      ).json().accessToken as string;
    mariaToken = await login('maria@velnes.mk');
    anaToken = await login('ana@velnes.mk');
  });
  afterAll(async () => {
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('requires inventory permissions', async () => {
    const res = await move(
      { kind: 'adjustment', productId: demo.p1, locationId: demo.locCentar, qty: 1 },
      anaToken, // Employee role: no inventory.adjust
    );
    expect(res.statusCode).toBe(403);
  });

  it('adjusts stock and writes the ledger in one transaction', async () => {
    const before = await stockOf(demo.locCentar, demo.p1);
    const res = await move(
      { kind: 'adjustment', productId: demo.p1, locationId: demo.locCentar, qty: 5, note: 'Recount' },
      mariaToken,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().levels[0].stock).toBe(before + 5);
    const ledger = await admin.query(
      `SELECT COALESCE(SUM(qty),0)::int AS total FROM stock_movements WHERE product_id=$1 AND location_id=$2`,
      [demo.p1, demo.locCentar],
    );
    expect(ledger.rows[0].total).toBe(before + 5); // opening 22 + 5, ledger == materialized
  });

  it('transfers atomically between locations with a shared ref', async () => {
    const beforeC = await stockOf(demo.locCentar, demo.p3);
    const res = await move(
      {
        kind: 'transfer',
        productId: demo.p3,
        fromLocationId: demo.locCentar,
        toLocationId: demo.locAerodrom,
        qty: 10,
      },
      mariaToken,
    );
    expect(res.statusCode).toBe(200);
    expect(await stockOf(demo.locCentar, demo.p3)).toBe(beforeC - 10);
    expect(await stockOf(demo.locAerodrom, demo.p3)).toBe(10);
    const pair = await admin.query(
      `SELECT kind, qty FROM stock_movements WHERE product_id=$1 AND kind::text LIKE 'transfer%' ORDER BY qty`,
      [demo.p3],
    );
    expect(pair.rows).toEqual([
      { kind: 'transfer_out', qty: -10 },
      { kind: 'transfer_in', qty: 10 },
    ]);
  });

  it('never lets stock go negative — and a failed transfer leaves NO half-movement', async () => {
    const res = await move(
      {
        kind: 'transfer',
        productId: demo.p4, // 3 at Centar
        fromLocationId: demo.locCentar,
        toLocationId: demo.locAerodrom,
        qty: 99,
      },
      mariaToken,
    );
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('INSUFFICIENT');
    expect(await stockOf(demo.locCentar, demo.p4)).toBe(3);
    expect(await stockOf(demo.locAerodrom, demo.p4)).toBe(0);
    const orphan = await admin.query(
      `SELECT count(*)::int AS n FROM stock_movements WHERE product_id=$1 AND kind::text LIKE 'transfer%'`,
      [demo.p4],
    );
    expect(orphan.rows[0].n).toBe(0);
  });

  it('records own use as a decrement', async () => {
    const before = await stockOf(demo.locCentar, demo.o1);
    const res = await move(
      { kind: 'own_use', productId: demo.o1, locationId: demo.locCentar, qty: 1 },
      mariaToken,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().levels[0].stock).toBe(before - 1);
  });

  it('readiness gate is now fully green for a prepared location — and activation stays owner-only', async () => {
    // Build a ready DRAFT location: entity attached, hours, catalog, staff.
    const loc = '20000000-0000-4000-8000-00000000dddd';
    await admin.query(
      `INSERT INTO locations (id, tenant_id, name, city, address, hours, lifecycle)
       VALUES ($1,$2,'Gjorche','Skopje','Partizanska 10','{"1":[["09:00","20:00"]]}','APPROVED')`,
      [loc, demo.business],
    );
    await admin.query(
      `INSERT INTO legal_entity_locations (tenant_id, legal_entity_id, location_id) VALUES ($1,$2,$3)`,
      [demo.business, demo.leVelnes, loc],
    );
    await admin.query(
      `INSERT INTO employee_locations (tenant_id, employee_id, location_id) VALUES ($1,$2,$3)`,
      [demo.business, demo.empAna, loc], // Ana: active, bookable, skills s1/s4/s5
    );
    const ready = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/locations/${loc}/readiness`,
      headers: { authorization: `Bearer ${mariaToken}` },
    });
    expect(ready.json().ok).toBe(true);

    // Owner-only activation: Bojan (manager access, NOT owner) gets a
    // temporary locations.manage grant — the permission gate passes,
    // the owner gate must still refuse him.
    await admin.query(
      `UPDATE roles SET perms = perms || '{"locations.manage":"business"}' WHERE id=$1`,
      [demo.roleFinance],
    );
    const bojanToken = (
      await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/auth/login`,
        payload: { email: 'bojan@velnes.mk', password: 'velnes-demo' },
      })
    ).json().accessToken as string;
    const denied = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/locations/${loc}/transitions`,
      headers: { authorization: `Bearer ${bojanToken}` },
      payload: { to: 'ACTIVE' },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().message).toContain('Only account-level owners');
    await admin.query(
      `UPDATE roles SET perms = perms - 'locations.manage' || '{"locations.manage":"none"}' WHERE id=$1`,
      [demo.roleFinance],
    );

    const act = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/locations/${loc}/transitions`,
      headers: { authorization: `Bearer ${mariaToken}` },
      payload: { to: 'ACTIVE' },
    });
    expect(act.statusCode).toBe(200);
    expect(act.json().location.lifecycle).toBe('ACTIVE');
    expect(act.json().location.online).toBe(true);

    // Cleanup.
    await admin.query(`DELETE FROM location_lifecycle_log WHERE location_id=$1`, [loc]);
    await admin.query(`DELETE FROM employee_locations WHERE location_id=$1`, [loc]);
    await admin.query(`DELETE FROM legal_entity_locations WHERE location_id=$1`, [loc]);
    await admin.query(`DELETE FROM locations WHERE id=$1`, [loc]);
  });
});
