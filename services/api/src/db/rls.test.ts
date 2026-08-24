import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demo } from './seed-demo.js';

/**
 * The test that makes tenant safety real: connected as the restricted
 * velnes_api role, tenant tables yield nothing without tenant context,
 * only the tenant's own rows with it, and cross-tenant writes fail —
 * even with deliberately unfiltered SQL.
 */

const API_URL =
  process.env.API_DATABASE_URL ?? 'postgres://velnes_api:velnes_api@localhost:5432/velnes_test';
const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const otherTenant = randomUUID();
const otherLoc = randomUUID();

describe('row-level security', () => {
  const api = new pg.Client({ connectionString: API_URL });
  const admin = new pg.Client({ connectionString: ADMIN_URL });

  beforeAll(async () => {
    await api.connect();
    await admin.connect();
    // A second tenant, planted by the RLS-exempt admin.
    await admin.query(
      `INSERT INTO businesses (id, name, country) VALUES ($1, 'Beta Salon', 'North Macedonia')`,
      [otherTenant],
    );
    await admin.query(
      `INSERT INTO locations (id, tenant_id, name, city, address) VALUES ($1, $2, 'Beta One', 'Bitola', 'Wide Street 1')`,
      [otherLoc, otherTenant],
    );
  });

  afterAll(async () => {
    await admin.query(`DELETE FROM locations WHERE tenant_id=$1`, [otherTenant]);
    await admin.query(`DELETE FROM businesses WHERE id=$1`, [otherTenant]);
    await api.end();
    await admin.end();
  });

  it('yields no tenant rows without tenant context', async () => {
    for (const table of [
      'businesses',
      'locations',
      'employees',
      'roles',
      'audit_log',
      'services',
      'service_variants',
      'location_catalog_services',
      'products',
      'location_catalog_products',
      'stock_movements',
      'employee_skills',
    ]) {
      const r = await api.query(`SELECT count(*)::int AS n FROM ${table}`);
      expect(r.rows[0].n, table).toBe(0);
    }
  });

  it('yields only the tenant own rows inside tenant context', async () => {
    await api.query('BEGIN');
    await api.query(`SELECT set_config('app.tenant_id', $1, true)`, [demo.business]);
    const biz = await api.query('SELECT id FROM businesses');
    expect(biz.rows.map((r) => r.id)).toEqual([demo.business]);
    const locs = await api.query('SELECT tenant_id FROM locations');
    expect(locs.rows).toHaveLength(2);
    expect(locs.rows.every((r) => r.tenant_id === demo.business)).toBe(true);
    await api.query('ROLLBACK');
  });

  it('blocks writing into another tenant', async () => {
    await api.query('BEGIN');
    await api.query(`SELECT set_config('app.tenant_id', $1, true)`, [demo.business]);
    await expect(
      api.query(`INSERT INTO locations (tenant_id, name) VALUES ($1, 'Sneaky')`, [otherTenant]),
    ).rejects.toThrow(/row-level security/);
    await api.query('ROLLBACK');
  });

  it('shows platform-level legal entities alongside the tenant own', async () => {
    await api.query('BEGIN');
    await api.query(`SELECT set_config('app.tenant_id', $1, true)`, [demo.business]);
    const r = await api.query('SELECT tenant_id FROM legal_entities ORDER BY tenant_id NULLS LAST');
    expect(r.rows).toHaveLength(3); // own + 2 supplier (platform) entities
    await api.query('ROLLBACK');
  });

  it('keeps audit rows immutable for the API role', async () => {
    await api.query('BEGIN');
    await api.query(`SELECT set_config('app.tenant_id', $1, true)`, [demo.business]);
    const upd = await api.query(`UPDATE audit_log SET reason='tampered'`);
    expect(upd.rowCount).toBe(0); // no UPDATE policy exists
    await api.query('ROLLBACK');
  });
});
