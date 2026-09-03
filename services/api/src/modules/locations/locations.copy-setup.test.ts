import { API_PREFIX, LocationCatalogResponseSchema, LocationSchema } from '@velnes/contracts';
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

const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown, t = ownerToken) =>
  app.inject({
    method,
    url: `${API_PREFIX}${url}`,
    headers: { authorization: `Bearer ${t}` },
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });

describe('copy setup between existing locations + the widened location PATCH', () => {
  let target = '';

  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    ownerToken = await token('maria@velnes.mk');
    staffToken = await token('ana@velnes.mk');
    // A throwaway scratch location to copy into — the seeded world
    // stays untouched for the other suites.
    const res = await call('POST', '/locations', {
      name: 'Vodno Copy Target',
      city: 'Skopje',
      address: 'Vodno 1',
      mode: 'scratch',
      legal: { mode: 'existing', legalEntityId: demo.leVelnes },
    });
    target = LocationSchema.parse(res.json()).id;
    made.push(target);
    // Give the target real stock: the copy must never clobber it.
    await admin.query(
      `UPDATE location_catalog_products SET stock=7 WHERE location_id=$1 AND product_id=$2`,
      [target, demo.p1],
    );
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
      `DELETE FROM audit_log WHERE action IN ('Setup copied','Location changed','Location created')`,
    );
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('refuses staff, refuses copying onto itself', async () => {
    const parts = { services: true, products: true, hours: true, payments: true, policy: true, widget: true };
    const denied = await call('POST', `/locations/${demo.locCentar}/copy-setup`, { toLocationId: target, parts }, staffToken);
    expect(denied.statusCode).toBe(403);
    const self = await call('POST', `/locations/${demo.locCentar}/copy-setup`, { toLocationId: demo.locCentar, parts });
    expect(self.statusCode).toBe(409);
  });

  it('copies the chosen parts, preserves target stock, and audits', async () => {
    const res = await call('POST', `/locations/${demo.locCentar}/copy-setup`, {
      toLocationId: target,
      parts: { services: true, products: true, hours: true, payments: true, policy: true, widget: false },
    });
    expect(res.statusCode).toBe(200);

    const locs = (await call('GET', '/locations')).json() as { locations: { id: string; hours: unknown; cancelHours: number; online: boolean }[] };
    const src = locs.locations.find((l) => l.id === demo.locCentar)!;
    const dst = locs.locations.find((l) => l.id === target)!;
    expect(dst.hours).toEqual(src.hours);
    expect(dst.cancelHours).toBe(src.cancelHours);
    // widget part was OFF: a scratch location stays not-bookable.
    expect(dst.online).toBe(false);

    const srcCat = LocationCatalogResponseSchema.parse(
      (await call('GET', `/locations/${demo.locCentar}/catalog`)).json(),
    );
    const dstCat = LocationCatalogResponseSchema.parse(
      (await call('GET', `/locations/${target}/catalog`)).json(),
    );
    const srcSvc = srcCat.services.find((s) => s.id === demo.s1)!;
    const dstSvc = dstCat.services.find((s) => s.id === demo.s1)!;
    expect(dstSvc.config.price).toEqual(srcSvc.config.price);
    expect(dstSvc.config.durationMin).toBe(srcSvc.config.durationMin);
    // Stock is a transaction, never a copy — the 7 survives.
    expect(dstCat.products.find((p) => p.id === demo.p1)!.config.stock).toBe(7);

    const audit = (await call('GET', '/audit?limit=10')).json() as { entries: { action: string; after: string }[] };
    expect(audit.entries.some((a) => a.action === 'Setup copied' && a.after.includes('Centar'))).toBe(true);
  });

  it('the widened PATCH edits the card and audits Location changed', async () => {
    const res = await call('PATCH', `/locations/${target}`, {
      name: 'Vodno Renamed',
      address: 'Vodno 2',
      city: 'Skopje',
      phone: '+389 70 555 111',
      rooms: 4,
      online: false,
      tz: 'Europe/Skopje',
    });
    expect(res.statusCode).toBe(200);
    const l = LocationSchema.parse(res.json());
    expect(l.name).toBe('Vodno Renamed');
    expect(l.address).toBe('Vodno 2');
    expect(l.rooms).toBe(4);
    expect(l.phone).toBe('+389 70 555 111');
    const audit = (await call('GET', '/audit?limit=10')).json() as { entries: { action: string; object: string }[] };
    expect(
      audit.entries.some((a) => a.action === 'Location changed' && a.object.includes('Vodno Renamed')),
    ).toBe(true);
  });
});
