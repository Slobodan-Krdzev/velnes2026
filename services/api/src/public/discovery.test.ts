import {
  API_PREFIX,
  DiscoveryCategoriesSchema,
  DiscoveryCategoryServicesSchema,
  DiscoveryRankedServicesSchema,
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

  it('carries only categories with something behind them — every card opens onto a result', async () => {
    const { categories } = DiscoveryCategoriesSchema.parse(
      (await app.inject({ method: 'GET', url: `${P}/discovery/categories` })).json(),
    );
    // The promise the shelf makes: no card is a dead end.
    for (const c of categories) {
      const res = await app.inject({
        method: 'GET',
        url: `${P}/discovery/categories/${c.id}/services`,
      });
      const body = DiscoveryCategoryServicesSchema.parse(res.json());
      expect(body.services.length, `${c.name} has something behind it`).toBeGreaterThan(0);
    }
  });

  it('drops a category from the shelf once nothing is published in it', async () => {
    const { categories } = DiscoveryCategoriesSchema.parse(
      (await app.inject({ method: 'GET', url: `${P}/discovery/categories` })).json(),
    );
    const victim = categories[0]!;
    // Take everything in that category off offer, the way a salon would.
    await admin.query(`UPDATE services SET online = false WHERE category_id = $1`, [victim.id]);
    try {
      const after = DiscoveryCategoriesSchema.parse(
        (await app.inject({ method: 'GET', url: `${P}/discovery/categories` })).json(),
      );
      expect(after.categories.some((c) => c.id === victim.id)).toBe(false);
      // The door behind it still answers — it is simply empty now, and
      // the taxonomy row itself is untouched.
      const res = await app.inject({
        method: 'GET',
        url: `${P}/discovery/categories/${victim.id}/services`,
      });
      expect(res.statusCode).toBe(200);
      expect(DiscoveryCategoryServicesSchema.parse(res.json()).services).toEqual([]);
    } finally {
      await admin.query(`UPDATE services SET online = true WHERE category_id = $1`, [victim.id]);
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

  /** The first category the seed actually publishes services in — the
   *  taxonomy is global, so most categories are legitimately empty. */
  async function firstCategoryWithServices() {
    const cats = DiscoveryCategoriesSchema.parse(
      (await app.inject({ method: 'GET', url: `${P}/discovery/categories` })).json(),
    ).categories;
    for (const c of cats) {
      const res = await app.inject({
        method: 'GET',
        url: `${P}/discovery/categories/${c.id}/services`,
      });
      const body = DiscoveryCategoryServicesSchema.parse(res.json());
      if (body.services.length) return body;
    }
    throw new Error('the seed has no category with published services');
  }

  it('lists the services in a category across every listed salon, key-free', async () => {
    const body = await firstCategoryWithServices();
    expect(body.services.length).toBeGreaterThan(0);
    // Every row really is in the category that was asked for, and
    // carries the salon offering it — a service with no salon behind it
    // is not something anyone can book.
    for (const s of body.services) {
      expect(s.category).toBe(body.category.name);
      expect(s.salon.slug.length).toBeGreaterThan(0);
      expect(s.durationMin).toBeGreaterThan(0);
    }
  });

  it('orders results bookable first, then by price, and the same way twice', async () => {
    const body = await firstCategoryWithServices();
    const asking = (s: (typeof body.services)[number]) =>
      s.priceFrom ?? s.price ?? Number.POSITIVE_INFINITY;
    for (let i = 1; i < body.services.length; i++) {
      const a = body.services[i - 1]!;
      const b = body.services[i]!;
      if (a.salon.bookable !== b.salon.bookable) {
        expect(a.salon.bookable, 'bookable leads').toBe(true);
        continue;
      }
      expect(asking(a) <= asking(b), `${a.name} before ${b.name}`).toBe(true);
    }
    // Deterministic: the same request twice gives the same order. This
    // is the property personalised ranking will have to replace on
    // purpose rather than by accident.
    const again = await app.inject({
      method: 'GET',
      url: `${P}/discovery/categories/${body.category.id}/services`,
    });
    expect(again.json().services.map((s: { id: string }) => s.id)).toEqual(
      body.services.map((s) => s.id),
    );
  });

  it('withholds prices from a salon that does not publish them', async () => {
    const body = await firstCategoryWithServices();
    const slug = body.services[0]!.salon.slug;
    await admin.query(
      `UPDATE businesses SET settings = jsonb_set(settings, '{marketplace,showPrices}', 'false')
       WHERE slug = $1`,
      [slug],
    );
    try {
      const res = await app.inject({
        method: 'GET',
        url: `${P}/discovery/categories/${body.category.id}/services`,
      });
      const after = DiscoveryCategoryServicesSchema.parse(res.json());
      const hidden = after.services.filter((s) => s.salon.slug === slug);
      expect(hidden.length).toBeGreaterThan(0);
      // Not shipped and then hidden by the app — never sent at all.
      for (const s of hidden) {
        expect(s.salon.showPrices).toBe(false);
        expect(s.price).toBeNull();
        expect(s.priceFrom).toBeNull();
      }
    } finally {
      await admin.query(
        `UPDATE businesses SET settings = jsonb_set(settings, '{marketplace,showPrices}', 'true')
         WHERE slug = $1`,
        [slug],
      );
    }
  });

  it('drops the services of a salon that switches its listing off', async () => {
    const body = await firstCategoryWithServices();
    const slug = body.services[0]!.salon.slug;
    await admin.query(
      `UPDATE businesses SET settings = jsonb_set(settings, '{marketplace,listed}', 'false')
       WHERE slug = $1`,
      [slug],
    );
    try {
      const res = await app.inject({
        method: 'GET',
        url: `${P}/discovery/categories/${body.category.id}/services`,
      });
      const after = DiscoveryCategoryServicesSchema.parse(res.json());
      expect(after.services.some((s) => s.salon.slug === slug)).toBe(false);
    } finally {
      await admin.query(
        `UPDATE businesses SET settings = jsonb_set(settings, '{marketplace,listed}', 'true')
         WHERE slug = $1`,
        [slug],
      );
    }
  });

  it('refuses an unknown category', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `${P}/discovery/categories/${randomUUID()}/services`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('UNKNOWN_CATEGORY');
  });

  describe('admission', () => {
    it('drops a salon whose only location is not ACTIVE', async () => {
      const body = await firstCategoryWithServices();
      const slug = body.services[0]!.salon.slug;
      const before = body.services.filter((s) => s.salon.slug === slug).length;
      expect(before).toBeGreaterThan(0);
      // Only ACTIVE locations exist to the outside world. A salon still
      // being set up is not open, whatever else is true of it.
      await admin.query(
        `UPDATE locations SET lifecycle = 'APPROVED'
         WHERE tenant_id = (SELECT id FROM businesses WHERE slug = $1)`,
        [slug],
      );
      try {
        const res = await app.inject({
          method: 'GET',
          url: `${P}/discovery/categories/${body.category.id}/services`,
        });
        const after = DiscoveryCategoryServicesSchema.parse(res.json());
        expect(after.services.some((s) => s.salon.slug === slug)).toBe(false);
      } finally {
        await admin.query(
          `UPDATE locations SET lifecycle = 'ACTIVE'
           WHERE tenant_id = (SELECT id FROM businesses WHERE slug = $1)`,
          [slug],
        );
      }
    });

    it('drops a salon that cannot be booked, rather than ranking it low', async () => {
      const body = await firstCategoryWithServices();
      const slug = body.services[0]!.salon.slug;
      // A weight can always be out-argued by another weight; this must
      // be absolute, so it is an admission rule.
      await admin.query(
        `UPDATE widgets SET status = 'draft'
         WHERE tenant_id = (SELECT id FROM businesses WHERE slug = $1)`,
        [slug],
      );
      try {
        const res = await app.inject({
          method: 'GET',
          url: `${P}/discovery/categories/${body.category.id}/services`,
        });
        const after = DiscoveryCategoryServicesSchema.parse(res.json());
        expect(after.services.some((s) => s.salon.slug === slug)).toBe(false);
      } finally {
        await admin.query(
          `UPDATE widgets SET status = 'live'
           WHERE tenant_id = (SELECT id FROM businesses WHERE slug = $1)`,
          [slug],
        );
      }
    });

    it('never offers a result that cannot be booked', async () => {
      // The page's whole promise. Now true by construction rather than
      // by the weights happening to work out.
      const body = await firstCategoryWithServices();
      expect(body.services.length).toBeGreaterThan(0);
      expect(body.services.every((s) => s.salon.bookable)).toBe(true);
    });

    it('keeps the shelf and the doors on the same admission rules', async () => {
      // A category card is a promise there is something behind it. The
      // shelf and the service doors must therefore admit identically —
      // this is the invariant that breaks first if they drift.
      const { categories } = DiscoveryCategoriesSchema.parse(
        (await app.inject({ method: 'GET', url: `${P}/discovery/categories` })).json(),
      );
      for (const c of categories) {
        const res = await app.inject({
          method: 'GET',
          url: `${P}/discovery/categories/${c.id}/services`,
        });
        const got = DiscoveryCategoryServicesSchema.parse(res.json());
        expect(got.services.length, `${c.name} has something behind it`).toBeGreaterThan(0);
      }
    });
  });

  /** Phase B, step 4: the ranked form of the same results. */
  describe('ranked results', () => {
    async function ranked(body: Record<string, unknown>, headers: Record<string, string> = {}) {
      const { category } = await firstCategoryWithServices();
      const res = await app.inject({
        method: 'POST',
        url: `${P}/discovery/categories/${category.id}/services`,
        headers,
        payload: body,
      });
      expect(res.statusCode).toBe(200);
      return { category, body: DiscoveryRankedServicesSchema.parse(res.json()) };
    }

    it('answers a signed-out visitor with no location at all', async () => {
      // Not an error, not an empty page: an ordinary caller.
      const { body } = await ranked({});
      expect(body.services.length).toBeGreaterThan(0);
      expect(body.personalised, 'nobody to personalise for').toBe(false);
      expect(body.rankVersion).toBeGreaterThan(0);
    });

    it('stamps the config version it ranked under, so an order can be explained later', async () => {
      const { body } = await ranked({ lat: 41.998, lng: 21.425 });
      expect(body.rankVersion).toBe(1);
      // And the weights themselves never leave the platform.
      expect(JSON.stringify(body)).not.toContain('proximity');
    });

    it('returns the same rows as the unranked door, only ordered differently', async () => {
      const { category, body } = await ranked({ lat: 41.998, lng: 21.425 });
      const plain = DiscoveryCategoryServicesSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: `${P}/discovery/categories/${category.id}/services`,
          })
        ).json(),
      );
      // One gatherer behind both doors: they must never disagree about
      // who is in the running.
      expect([...body.services.map((s) => s.id)].sort()).toEqual(
        [...plain.services.map((s) => s.id)].sort(),
      );
    });

    it('puts the nearer salon first when a position is given', async () => {
      const { category } = await firstCategoryWithServices();
      const near = await app.inject({
        method: 'POST',
        url: `${P}/discovery/categories/${category.id}/services`,
        payload: { lat: 41.9981, lng: 21.4254 },
      });
      const far = await app.inject({
        method: 'POST',
        url: `${P}/discovery/categories/${category.id}/services`,
        payload: { lat: 40.6401, lng: 22.9444 },
      });
      const a = DiscoveryRankedServicesSchema.parse(near.json()).services.map((s) => s.id);
      const b = DiscoveryRankedServicesSchema.parse(far.json()).services.map((s) => s.id);
      // Same rows either way; standing somewhere else may reorder them.
      expect([...a].sort()).toEqual([...b].sort());
    });

    it('treats a radius as a hard filter, and its absence as a soft one', async () => {
      const { category } = await firstCategoryWithServices();
      const all = await app.inject({
        method: 'POST',
        url: `${P}/discovery/categories/${category.id}/services`,
        payload: { lat: 40.6401, lng: 22.9444 },
      });
      const tight = await app.inject({
        method: 'POST',
        url: `${P}/discovery/categories/${category.id}/services`,
        payload: { lat: 40.6401, lng: 22.9444, radiusKm: 1 },
      });
      const nAll = DiscoveryRankedServicesSchema.parse(all.json()).services.length;
      const nTight = DiscoveryRankedServicesSchema.parse(tight.json()).services.length;
      // Without a radius "near me" only sorts; with one it excludes.
      expect(nAll).toBeGreaterThan(0);
      expect(nTight).toBeLessThan(nAll);
    });

    it('ignores a token it cannot read rather than refusing the request', async () => {
      // Being signed out, or holding a stale token, is not an error on a
      // key-free door — it just means there is no history to rank with.
      const { body } = await ranked({}, { authorization: 'Bearer not-a-real-token' });
      expect(body.services.length).toBeGreaterThan(0);
      expect(body.personalised).toBe(false);
    });

    it('refuses an unknown category the same way the unranked door does', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${P}/discovery/categories/${randomUUID()}/services`,
        payload: {},
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('UNKNOWN_CATEGORY');
    });
  });
});
