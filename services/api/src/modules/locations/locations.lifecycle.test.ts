import { randomUUID } from 'node:crypto';
import { API_PREFIX, LocationListResponseSchema, ReadinessResponseSchema } from '@velnes/contracts';
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
const draftLoc = randomUUID();

let mariaToken = '';
let anaToken = '';

async function token(email: string) {
  const res = await app.inject({
    method: 'POST',
    url: `${API_PREFIX}/auth/login`,
    payload: { email, password: 'velnes-demo' },
  });
  return res.json().accessToken as string;
}

const transition = (id: string, to: string, tok: string, reason?: string) =>
  app.inject({
    method: 'POST',
    url: `${API_PREFIX}/locations/${id}/transitions`,
    headers: { authorization: `Bearer ${tok}` },
    payload: { to, reason },
  });

describe('location lifecycle doors', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    await admin.query(
      `INSERT INTO locations (id, tenant_id, name, city, address, hours, lifecycle)
       VALUES ($1, $2, 'Debar Maalo', 'Skopje', 'Orce Nikolov 55', '{"1":[["09:00","20:00"]]}', 'DRAFT')`,
      [draftLoc, demo.business],
    );
    mariaToken = await token('maria@velnes.mk');
    anaToken = await token('ana@velnes.mk');
  });

  afterAll(async () => {
    await admin.query(`DELETE FROM location_lifecycle_log WHERE location_id=$1`, [draftLoc]);
    await admin.query(`DELETE FROM locations WHERE id=$1`, [draftLoc]);
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('lists the tenant locations', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/locations`,
      headers: { authorization: `Bearer ${mariaToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = LocationListResponseSchema.parse(res.json());
    expect(body.locations.map((l) => l.name).sort()).toEqual([
      'Aerodrom',
      'Centar',
      'Debar Maalo',
    ]);
  });

  it('refuses transitions to a role without locations.manage', async () => {
    const res = await transition(draftLoc, 'SUBMITTED', anaToken);
    expect(res.statusCode).toBe(403);
  });

  it('walks the legal path DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED', async () => {
    for (const to of ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED']) {
      const res = await transition(draftLoc, to, mariaToken, 'step');
      expect(res.statusCode, to).toBe(200);
      expect(res.json().location.lifecycle).toBe(to);
    }
  });

  it('refuses an illegal edge', async () => {
    const res = await transition(draftLoc, 'DRAFT', mariaToken);
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toContain('is not a legal step');
  });

  it('gates APPROVED → ACTIVE on readiness (catalog checks honestly not-ready in Phase 1)', async () => {
    const ready = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/locations/${draftLoc}/readiness`,
      headers: { authorization: `Bearer ${mariaToken}` },
    });
    const r = ReadinessResponseSchema.parse(ready.json());
    expect(r.ok).toBe(false);
    expect(r.items.find((i) => i.k === 'legal')?.ok).toBe(false); // no entity attached
    expect(r.items.find((i) => i.k === 'address')?.ok).toBe(true);
    expect(r.items.find((i) => i.k === 'hours')?.ok).toBe(true);

    const res = await transition(draftLoc, 'ACTIVE', mariaToken);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('NOT_READY');
  });

  it('suspends and reactivates an ACTIVE location (no readiness gate on that edge)', async () => {
    const s = await transition(demo.locAerodrom, 'SUSPENDED', mariaToken, 'Renovation');
    expect(s.statusCode).toBe(200);
    expect(s.json().location.online).toBe(false);
    const a = await transition(demo.locAerodrom, 'ACTIVE', mariaToken);
    expect(a.statusCode).toBe(200);
    expect(a.json().location.online).toBe(true);
  });

  it('wrote lifecycle log and audit entries through the doors', async () => {
    const log = await admin.query(
      `SELECT from_state, to_state FROM location_lifecycle_log WHERE location_id=$1 ORDER BY at`,
      [draftLoc],
    );
    expect(log.rows.map((r) => r.to_state)).toEqual(['SUBMITTED', 'UNDER_REVIEW', 'APPROVED']);

    const res = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/audit?action=Location lifecycle`,
      headers: { authorization: `Bearer ${mariaToken}` },
    });
    expect(res.statusCode).toBe(200);
    const entries = res.json().entries as { action: string; before: string; after: string }[];
    expect(entries.length).toBeGreaterThanOrEqual(5);
    expect(entries[0]?.action).toBe('Location lifecycle');
  });
});
