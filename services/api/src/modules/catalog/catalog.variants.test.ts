import { randomUUID } from 'node:crypto';
import { API_PREFIX } from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';
import { demo } from '../../db/seed-demo.js';
import { buildServer } from '../../server.js';

/**
 * Removing a length in the panel (Alex, 2026-10-01): one that was ever
 * booked is retired — gone from the catalog, kept for its visits; one
 * nothing references is deleted. Removing the standard one leaves none:
 * the service itself is then the standard.
 */
const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });
let H: Record<string, string> = {};
const SVC = randomUUID();
const V_STD = randomUUID();
const V_FREE = randomUUID();
const V_KEEP = randomUUID();
const APPT = randomUUID();

describe('removing a service length', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    const tok = (await app.inject({ method: 'POST', url: `${API_PREFIX}/auth/login`, payload: { email: 'maria@velnes.mk', password: 'velnes-demo' } })).json().accessToken as string;
    H = { authorization: `Bearer ${tok}`, 'content-type': 'application/json' };
    await admin.query(`INSERT INTO services (id, tenant_id, name, duration_min, price, vat, status, pos, online) VALUES ($1, $2, 'Length test', 30, 1000, 18, 'active', true, true)`, [SVC, demo.business]);
    await admin.query(
      `INSERT INTO service_variants (id, tenant_id, service_id, label, duration_min, price, std, sort) VALUES
         ($1, $4, $5, '30 min', 30, 1000, true, 0), ($2, $4, $5, '45 min', 45, 1400, false, 1), ($3, $4, $5, '60 min', 60, 1800, false, 2)`,
      [V_STD, V_FREE, V_KEEP, demo.business, SVC],
    );
    // The standard length was booked once.
    await admin.query(
      `INSERT INTO appointments (id, tenant_id, location_id, date, start_min, duration_min, kind, status, title, service_id, variant_id, variant_label, employee_id, customer_id, price, source)
       VALUES ($1, $2, $3, CURRENT_DATE - 10, 600, 30, 'appointment', 'confirmed', 'Length Tester', $4, $5, '30 min', $6, $7, 1000, 'staff')`,
      [APPT, demo.business, demo.locCentar, SVC, V_STD, demo.empMaria, demo.c1],
    );
  });
  afterAll(async () => {
    await admin.query(`DELETE FROM appointments WHERE id = $1`, [APPT]);
    await admin.query(`DELETE FROM location_catalog_variants WHERE variant_id IN ($1, $2, $3)`, [V_STD, V_FREE, V_KEEP]);
    await admin.query(`DELETE FROM service_variants WHERE service_id = $1`, [SVC]);
    await admin.query(`DELETE FROM location_catalog_services WHERE service_id = $1`, [SVC]);
    await admin.query(`DELETE FROM employee_skills WHERE service_id = $1`, [SVC]).catch(() => undefined);
    await admin.query(`DELETE FROM services WHERE id = $1`, [SVC]);
    await admin.query(`DELETE FROM audit_log WHERE object = 'Service · Length test'`);
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('a booked length is retired and stays on its visit; an unbooked one is deleted; none is promoted to standard', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: `${API_PREFIX}/services/${SVC}`,
      headers: H,
      payload: { name: 'Length test', category: null, durationMin: 30, price: 1000, vat: 18, status: 'active', pos: true, online: true, prepMin: null, resetMin: null, performerIds: null, variants: [{ id: V_KEEP, label: '60 min', durationMin: 60, price: 1800, std: false }], modifiers: [] },
    });
    expect(put.statusCode, put.body).toBe(200);
    const rows = await admin.query(`SELECT id, std, retired_at IS NOT NULL AS retired FROM service_variants WHERE service_id = $1 ORDER BY sort`, [SVC]);
    expect(rows.rows).toEqual(expect.arrayContaining([
      { id: V_STD, std: false, retired: true },
      { id: V_KEEP, std: false, retired: false },
    ]));
    expect(rows.rows.some((r) => r.id === V_FREE)).toBe(false);
    // The visit keeps its length; the catalog no longer offers it.
    const appt = await admin.query(`SELECT variant_id, variant_label FROM appointments WHERE id = $1`, [APPT]);
    expect(appt.rows[0]).toEqual({ variant_id: V_STD, variant_label: '30 min' });
    const cat = (await app.inject({ method: 'GET', url: `${API_PREFIX}/locations/${demo.locCentar}/catalog`, headers: H })).json();
    const svc = (cat.services as { id: string; variants: { id: string }[] }[]).find((s) => s.id === SVC)!;
    expect(svc.variants.map((v) => v.id)).toEqual([V_KEEP]);
  });
});
