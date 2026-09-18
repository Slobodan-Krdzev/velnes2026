import {
  API_PREFIX,
  DiscoveryCategoriesSchema,
  DiscoverySalonDetailSchema,
  DiscoverySalonsSchema,
} from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../db/index.js';
import { buildServer } from '../server.js';

const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });
const P = `${API_PREFIX}/public`;

describe('the consumer discovery surface', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
  });
  afterAll(async () => {
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('serves the HQ taxonomy as browsable cards — key-free', async () => {
    const res = await app.inject({ method: 'GET', url: `${P}/discovery/categories` });
    expect(res.statusCode).toBe(200);
    const { categories } = DiscoveryCategoriesSchema.parse(res.json());
    expect(categories.length).toBeGreaterThan(0);
    // Media is honest: null until HQ dresses the category, never faked.
    for (const c of categories) {
      expect(c.cardImage === null || typeof c.cardImage === 'string').toBe(true);
    }
  });

  it('lists only marketplace-listed salons, with the categories they really serve', async () => {
    const res = await app.inject({ method: 'GET', url: `${P}/discovery/salons` });
    expect(res.statusCode).toBe(200);
    const { salons } = DiscoverySalonsSchema.parse(res.json());
    const velnes = salons.find((s) => s.slug === 'velnes-fizio');
    expect(velnes).toBeDefined();
    // Derived from its active services, not from free text.
    expect(velnes!.serviceCategories.length).toBeGreaterThan(0);
    expect(velnes!.bookable).toBe(true);
  });

  it('hides a salon that switches its marketplace listing off', async () => {
    const before = await app.inject({ method: 'GET', url: `${P}/discovery/salons` });
    expect(before.json().salons.some((s: { slug: string }) => s.slug === 'velnes-fizio')).toBe(true);
    await admin.query(
      `UPDATE businesses SET settings = jsonb_set(settings, '{marketplace,listed}', 'false')
       WHERE slug = 'velnes-fizio'`,
    );
    try {
      const after = await app.inject({ method: 'GET', url: `${P}/discovery/salons` });
      expect(after.json().salons.some((s: { slug: string }) => s.slug === 'velnes-fizio')).toBe(false);
      const detail = await app.inject({ method: 'GET', url: `${P}/discovery/salons/velnes-fizio` });
      expect(detail.statusCode).toBe(404);
    } finally {
      await admin.query(
        `UPDATE businesses SET settings = jsonb_set(settings, '{marketplace,listed}', 'true')
         WHERE slug = 'velnes-fizio'`,
      );
    }
  });

  it('serves the salon page: team, sellable products, live locations and the booking key', async () => {
    const res = await app.inject({ method: 'GET', url: `${P}/discovery/salons/velnes-fizio` });
    expect(res.statusCode).toBe(200);
    const d = DiscoverySalonDetailSchema.parse(res.json());
    expect(d.name).toBe('Velnes Fizio Centar');
    expect(d.locations.map((l) => l.name).sort()).toEqual(['Aerodrom', 'Centar']);
    // The key the booking doors expect, so the app never invents one.
    expect(d.publishableKey).toBe('pk_live_velnes_demo');
    expect(d.team.length).toBeGreaterThan(0);
    // Own-use and zero-priced stock stays out of the consumer shelf.
    expect(d.products.every((p) => p.price > 0)).toBe(true);
  });

  it('honors the salon’s own "show team" switch', async () => {
    await admin.query(
      `UPDATE businesses SET settings = jsonb_set(settings, '{marketplace,showTeam}', 'false')
       WHERE slug = 'velnes-fizio'`,
    );
    try {
      const res = await app.inject({ method: 'GET', url: `${P}/discovery/salons/velnes-fizio` });
      expect(res.json().team).toEqual([]);
    } finally {
      await admin.query(
        `UPDATE businesses SET settings = jsonb_set(settings, '{marketplace,showTeam}', 'true')
         WHERE slug = 'velnes-fizio'`,
      );
    }
  });

  it('refuses an unknown salon', async () => {
    const res = await app.inject({ method: 'GET', url: `${P}/discovery/salons/no-such-salon` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('UNKNOWN_SALON');
  });
});
