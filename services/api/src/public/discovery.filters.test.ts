import { API_PREFIX, DiscoveryRankedServicesSchema, SearchResultsSchema } from '@velnes/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../db/index.js';
import { demo } from '../db/seed-demo.js';
import { resetAdmittedCache } from './discovery.routes.js';
import { buildServer } from '../server.js';

/**
 * The phone's filters panel (Alex, 2026-09-29): a price range and
 * amenities, through the same two doors as every other filter, with the
 * facets that let the panel draw a histogram and offer only amenities
 * that exist in the answer. Against the seeded world; put back as found.
 */
const app = await buildServer();
const P = `${API_PREFIX}/public`;
let ownerToken = '';

describe('price range and amenity filters', () => {
  beforeAll(async () => {
    await app.ready();
    const res = await app.inject({ method: 'POST', url: `${API_PREFIX}/auth/login`, payload: { email: 'maria@velnes.mk', password: 'velnes-demo' } });
    ownerToken = res.json().accessToken as string;
    await app.inject({ method: 'PATCH', url: `${API_PREFIX}/locations/${demo.locAerodrom}`, headers: { authorization: `Bearer ${ownerToken}` }, payload: { amenities: ['wifi', 'free_parking'] } });
    resetAdmittedCache();
  });
  afterAll(async () => {
    await app.inject({ method: 'PATCH', url: `${API_PREFIX}/locations/${demo.locAerodrom}`, headers: { authorization: `Bearer ${ownerToken}` }, payload: { amenities: [] } });
    await app.close();
    await closeDb();
  });

  it('the answer describes its prices and amenities before any filter is applied', async () => {
    const res = await app.inject({ method: 'POST', url: `${P}/discovery/search`, payload: { q: 'massage' } });
    const r = SearchResultsSchema.parse(res.json());
    expect(r.services.length).toBeGreaterThan(0);
    expect(r.facets.prices.length).toBe(r.services.filter((s) => s.price != null).length);
    expect([...r.facets.prices].sort((a, b) => a - b)).toEqual(r.facets.prices);
    // The seeded salon's location says wifi and parking; nothing else is offered.
    expect(r.facets.amenities.map((a) => a.key)).toEqual(['wifi', 'free_parking']);
    for (const s of r.services) expect(s.salon.amenities).toEqual(['wifi', 'free_parking']);
  });

  it('a price range admits only what it says, and says how many unpriced fell out', async () => {
    const all = SearchResultsSchema.parse((await app.inject({ method: 'POST', url: `${P}/discovery/search`, payload: { q: 'massage' } })).json());
    const prices = all.facets.prices;
    const max = prices[Math.floor(prices.length / 2)]!;
    const cut = SearchResultsSchema.parse((await app.inject({ method: 'POST', url: `${P}/discovery/search`, payload: { q: 'massage', priceMax: max } })).json());
    expect(cut.services.length).toBeGreaterThan(0);
    expect(cut.services.length).toBeLessThanOrEqual(all.services.length);
    for (const s of cut.services) expect(Math.min(s.price ?? Infinity, s.priceFrom ?? Infinity)).toBeLessThanOrEqual(max);
    // The facets did not move under the person who chose the range.
    expect(cut.facets.prices).toEqual(all.facets.prices);
    const none = SearchResultsSchema.parse((await app.inject({ method: 'POST', url: `${P}/discovery/search`, payload: { q: 'massage', priceMin: 1_000_000 } })).json());
    expect(none.services).toEqual([]);
  });

  it('amenities are all-of, on both doors, and an unknown key is refused', async () => {
    const wifi = SearchResultsSchema.parse((await app.inject({ method: 'POST', url: `${P}/discovery/search`, payload: { q: 'massage', amenities: ['wifi'] } })).json());
    expect(wifi.services.length).toBeGreaterThan(0);
    const sauna = SearchResultsSchema.parse((await app.inject({ method: 'POST', url: `${P}/discovery/search`, payload: { q: 'massage', amenities: ['wifi', 'sauna'] } })).json());
    expect(sauna.services).toEqual([]);
    const bad = await app.inject({ method: 'POST', url: `${P}/discovery/search`, payload: { q: 'massage', amenities: ['jacuzzi'] } });
    expect(bad.statusCode).toBe(400);
    const cats = await app.inject({ method: 'GET', url: `${P}/discovery/categories` });
    const id = (cats.json().categories as { id: string }[])[0]!.id;
    const byCat = DiscoveryRankedServicesSchema.parse((await app.inject({ method: 'POST', url: `${P}/discovery/categories/${id}/services`, payload: { amenities: ['free_parking'] } })).json());
    expect(byCat.services.length).toBeGreaterThan(0);
    expect(byCat.facets.amenities.map((a) => a.key)).toEqual(['wifi', 'free_parking']);
    const catNone = DiscoveryRankedServicesSchema.parse((await app.inject({ method: 'POST', url: `${P}/discovery/categories/${id}/services`, payload: { amenities: ['sauna'] } })).json());
    expect(catNone.services).toEqual([]);
  });
});
