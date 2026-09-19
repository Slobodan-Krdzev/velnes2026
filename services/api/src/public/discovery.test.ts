import {
  API_PREFIX,
  DiscoveryCategoriesSchema,
  DiscoverySalonDetailSchema,
  DiscoverySalonsSchema,
} from '@velnes/contracts';
import { randomUUID } from 'node:crypto';
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
    await admin.query(
      `DELETE FROM appointment_history WHERE appointment_id IN (SELECT id FROM appointments WHERE customer_id IN (SELECT id FROM customers WHERE name='Visit Tester'))`,
    );
    await admin.query(
      `DELETE FROM appointments WHERE customer_id IN (SELECT id FROM customers WHERE name='Visit Tester')`,
    );
    await admin.query(`DELETE FROM customers WHERE name='Visit Tester'`);
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

  it('carries a pin on every listed salon, so a results map has something to draw', async () => {
    const res = await app.inject({ method: 'GET', url: `${P}/discovery/salons` });
    const { salons } = DiscoverySalonsSchema.parse(res.json());
    // Pins come from what a salon placed (or a placeholder); never from
    // guessing at the address text.
    for (const s of salons) {
      expect(s.lat === null || (s.lat > 40 && s.lat < 43), `${s.slug} lat`).toBe(true);
      expect(s.lng === null || (s.lng > 20 && s.lng < 23), `${s.slug} lng`).toBe(true);
    }
    expect(salons.every((s) => s.lat !== null && s.lng !== null)).toBe(true);
  });

  it('gives the salon page a pin per location, so an appointment can be mapped', async () => {
    const res = await app.inject({ method: 'GET', url: `${P}/discovery/salons/velnes-fizio` });
    const d = DiscoverySalonDetailSchema.parse(res.json());
    expect(d.lat).not.toBeNull();
    for (const l of d.locations) {
      expect(l.lat, `${l.name} has its own pin`).not.toBeNull();
      expect(l.lng).not.toBeNull();
    }
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

  it('serves the gallery a salon uploads — and keeps tiles that have no photo yet', async () => {
    // The seeded demo salon has named its spaces without uploading
    // photographs: those entries carry a colour, and must survive.
    const seeded = await app.inject({ method: 'GET', url: `${P}/discovery/salons/velnes-fizio` });
    const tiles = DiscoverySalonDetailSchema.parse(seeded.json()).gallery;
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every((g) => g.img !== null || g.tone !== null)).toBe(true);

    // A real uploaded photo comes through whole, and leads the card.
    await admin.query(`UPDATE businesses SET gallery = $1::jsonb WHERE slug = 'velnes-fizio'`, [
      JSON.stringify([
        { id: 'g1', name: 'Reception', img: null, tone: '#6f7357' },
        { id: 'g2', name: 'Room one', img: 'data:image/png;base64,iVBORw0KGgo=', tone: null },
      ]),
    ]);
    try {
      const res = await app.inject({ method: 'GET', url: `${P}/discovery/salons/velnes-fizio` });
      const g = DiscoverySalonDetailSchema.parse(res.json()).gallery;
      expect(g).toHaveLength(2);
      expect(g[1]!.img).toBe('data:image/png;base64,iVBORw0KGgo=');
      // The card picks the first real photograph, not the tile.
      const list = await app.inject({ method: 'GET', url: `${P}/discovery/salons` });
      const card = DiscoverySalonsSchema.parse(list.json()).salons.find((s) => s.slug === 'velnes-fizio');
      expect(card!.photo).toBe('data:image/png;base64,iVBORw0KGgo=');
    } finally {
      await admin.query(`UPDATE businesses SET gallery = $1::jsonb WHERE slug = 'velnes-fizio'`, [
        JSON.stringify(tiles),
      ]);
    }
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

  it('offers and books a visit of several treatments, back to back', async () => {
    const { demo } = await import('../db/seed-demo.js');
    const day = (() => {
      const d = new Date();
      d.setDate(d.getDate() + 16 - ((d.getDay() + 5) % 7));
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })();
    const items = [{ serviceId: demo.s1 }, { serviceId: demo.s2 }];

    const slots = await app.inject({
      method: 'POST',
      url: `${P}/slots`,
      payload: {
        key: 'pk_live_velnes_demo',
        locationId: demo.locAerodrom,
        date: day,
        employeeId: 'any',
        items,
      },
    });
    expect(slots.statusCode).toBe(200);
    const slot = slots.json().slots.find((s: { free: boolean }) => s.free);
    expect(slot, 'a two-treatment visit fits somewhere that day').toBeDefined();

    const res = await app.inject({
      method: 'POST',
      url: `${P}/book`,
      payload: {
        widgetKey: 'pk_live_velnes_demo',
        key: randomUUID(),
        locationId: demo.locAerodrom,
        serviceId: demo.s1,
        date: day,
        time: slot.t,
        employeeId: 'any',
        items,
        name: 'Visit Tester',
        phone: '+389 70 999 222',
      },
    });
    expect(res.statusCode).toBe(200);
    const out = res.json();
    // Two real appointments, and the second starts after the first ends.
    expect(out.items).toHaveLength(2);
    expect(out.items[1].time >= out.items[0].end).toBe(true);
    expect(out.price).toBe(out.items[0].price + out.items[1].price);
    expect(out.end).toBe(out.items[1].end);

    const rows = await admin.query(
      `SELECT count(*)::int AS n FROM appointments WHERE id = ANY($1)`,
      [out.items.map((i: { ref: string }) => i.ref)],
    );
    expect(rows.rows[0].n).toBe(2);
  });

  it('books nothing at all when one treatment in the visit cannot fit', async () => {
    const { demo } = await import('../db/seed-demo.js');
    const before = await admin.query(`SELECT count(*)::int AS n FROM appointments`);
    const res = await app.inject({
      method: 'POST',
      url: `${P}/book`,
      payload: {
        widgetKey: 'pk_live_velnes_demo',
        key: randomUUID(),
        locationId: demo.locAerodrom,
        serviceId: demo.s1,
        date: '2026-12-25',
        // 18:30 leaves no room for a second treatment before closing.
        time: '18:30',
        employeeId: 'any',
        items: [{ serviceId: demo.s1 }, { serviceId: demo.s2 }],
        name: 'Visit Tester',
        phone: '+389 70 999 223',
      },
    });
    expect(res.statusCode).toBe(409);
    // The whole visit rolled back: not even the first treatment stuck.
    const after = await admin.query(`SELECT count(*)::int AS n FROM appointments`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('refuses an unknown salon', async () => {
    const res = await app.inject({ method: 'GET', url: `${P}/discovery/salons/no-such-salon` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('UNKNOWN_SALON');
  });
});
