import { API_PREFIX, LocationSchema } from '@velnes/contracts';
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
const made: string[] = [];
let ownerToken = '';
let staffToken = '';

async function token(email: string) {
  const res = await app.inject({
    method: 'POST',
    url: `${API_PREFIX}/auth/login`,
    payload: { email, password: 'velnes-demo' },
  });
  return res.json().accessToken as string;
}

const base = {
  name: 'Debar Maalo',
  city: 'Skopje',
  address: 'Orce Nikolov 55',
  legal: { mode: 'existing', legalEntityId: demo.leVelnes } as const,
};

describe('the new-location door', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    ownerToken = await token('maria@velnes.mk');
    staffToken = await token('ana@velnes.mk');
  });
  afterAll(async () => {
    for (const id of made) {
      for (const t of [
        'location_lifecycle_log',
        'employee_locations',
        'legal_entity_locations',
        'location_catalog_variants',
        'location_catalog_services',
        'location_catalog_products',
      ])
        await admin.query(`DELETE FROM ${t} WHERE location_id=$1`, [id]);
      await admin.query(`DELETE FROM locations WHERE id=$1`, [id]);
    }
    await admin.query(
      `DELETE FROM payment_accounts WHERE legal_entity_id IN (SELECT id FROM legal_entities WHERE name='Vodno Fizio DOOEL')`,
    );
    await admin.query(`DELETE FROM legal_entities WHERE name='Vodno Fizio DOOEL'`);
    await admin.query(`DELETE FROM audit_log WHERE action='Location created'`);
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('creates a snapshot copy: config travels, stock starts at 0, nothing links back', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/locations`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        ...base,
        mode: 'copy',
        srcLocationId: demo.locCentar,
      },
    });
    expect(res.statusCode).toBe(200);
    const l = LocationSchema.parse(res.json());
    made.push(l.id);
    expect(l.lifecycle).toBe('DRAFT');
    expect(l.invPrefix).toBe('DEB-');

    // The source's per-location price override travelled…
    const src = await admin.query(
      `SELECT service_id, price FROM location_catalog_services WHERE location_id=$1`,
      [demo.locCentar],
    );
    const dst = await admin.query(
      `SELECT service_id, price, active FROM location_catalog_services WHERE location_id=$1`,
      [l.id],
    );
    for (const s of src.rows)
      expect(dst.rows.find((d: { service_id: string }) => d.service_id === s.service_id)?.price).toBe(
        s.price,
      );
    // …and stock did not: it is a transaction, not configuration.
    const stock = await admin.query(
      `SELECT COALESCE(MAX(stock),0) AS m FROM location_catalog_products WHERE location_id=$1`,
      [l.id],
    );
    expect(Number(stock.rows[0].m)).toBe(0);
    // Owners got the door opened; nobody else did.
    const grants = await admin.query(
      `SELECT employee_id FROM employee_locations WHERE location_id=$1`,
      [l.id],
    );
    expect(grants.rows.map((g: { employee_id: string }) => g.employee_id)).toEqual([demo.empMaria]);
  });

  it('from scratch everything starts OFF — never a silent fallback to the default', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/locations`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { ...base, name: 'Vodno', mode: 'scratch', srcLocationId: null },
    });
    const l = LocationSchema.parse(res.json());
    made.push(l.id);
    const active = await admin.query(
      `SELECT COUNT(*) FILTER (WHERE active) AS on, COUNT(*) AS total
       FROM location_catalog_services WHERE location_id=$1`,
      [l.id],
    );
    expect(Number(active.rows[0].on)).toBe(0);
    expect(Number(active.rows[0].total)).toBeGreaterThan(0);
  });

  it('creates a pending legal entity and submits to HQ in the same act', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/locations`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        ...base,
        name: 'Vodno Park',
        mode: 'scratch',
        legal: {
          mode: 'new',
          name: 'Vodno Fizio DOOEL',
          taxId: 'MK4032019904321',
        },
        submit: true,
      },
    });
    expect(res.statusCode).toBe(200);
    const l = LocationSchema.parse(res.json());
    made.push(l.id);
    expect(l.lifecycle).toBe('SUBMITTED');
    const le = await admin.query(`SELECT status FROM legal_entities WHERE name='Vodno Fizio DOOEL'`);
    expect(le.rows[0].status).toBe('pending');
    const pa = await admin.query(
      `SELECT status FROM payment_accounts WHERE legal_entity_id IN (SELECT id FROM legal_entities WHERE name='Vodno Fizio DOOEL')`,
    );
    expect(pa.rows[0].status).toBe('incomplete');
    // …and it is on HQ's intake table.
    const hqLogin = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/hq/auth/login`,
      payload: { email: 'damjan@revelapps.com', password: 'velnes-demo' },
    });
    const queue = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/hq/locations`,
      headers: { authorization: `Bearer ${hqLogin.json().accessToken}` },
    });
    const row = queue.json().locations.find((x: { id: string }) => x.id === l.id);
    expect(row?.legalStatus).toBe('pending');
  });

  it('is gated by locations.manage', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/locations`,
      headers: { authorization: `Bearer ${staffToken}` },
      payload: { ...base, name: 'Nope', mode: 'scratch' },
    });
    expect(res.statusCode).toBe(403);
  });
});
