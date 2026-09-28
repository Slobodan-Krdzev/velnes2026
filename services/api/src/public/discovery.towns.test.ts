import { API_PREFIX, DiscoveryTownsSchema, SearchResultsSchema } from '@velnes/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../db/index.js';
import { demo } from '../db/seed-demo.js';
import { resetAdmittedCache } from './discovery.routes.js';
import { buildServer } from '../server.js';

/**
 * "Where" on the phone's search sheet: the towns salons are in, and a
 * town as a hard filter on both doors. Against the seeded world — one
 * listed salon, in one town.
 */
const app = await buildServer();
const P = `${API_PREFIX}/public`;

describe('towns, and the city filter', () => {
  let town = '';
  beforeAll(async () => {
    await app.ready();
    resetAdmittedCache();
  });
  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  it('lists the towns admitted salons are in, most salons first', async () => {
    const res = await app.inject({ method: 'GET', url: `${P}/discovery/towns` });
    expect(res.statusCode).toBe(200);
    const { towns } = DiscoveryTownsSchema.parse(res.json());
    expect(towns.length).toBeGreaterThan(0);
    for (const t of towns) expect(t.salons).toBeGreaterThan(0);
    expect([...towns].sort((a, b) => b.salons - a.salons || a.name.localeCompare(b.name))).toEqual(towns);
    town = towns[0]!.name;
  });

  it('a typed search in the salon’s own town answers; in another town, nothing', async () => {
    const here = await app.inject({ method: 'POST', url: `${P}/discovery/search`, payload: { q: 'massage', city: town.toUpperCase() } });
    expect(here.statusCode).toBe(200);
    const r1 = SearchResultsSchema.parse(here.json());
    expect(r1.services.length).toBeGreaterThan(0);
    for (const s of r1.services) expect((s.salon.city ?? '').toLowerCase()).toBe(town.toLowerCase());

    const elsewhere = await app.inject({ method: 'POST', url: `${P}/discovery/search`, payload: { q: 'massage', city: 'Nowhere-on-Earth' } });
    expect(elsewhere.statusCode).toBe(200);
    expect(SearchResultsSchema.parse(elsewhere.json()).services).toHaveLength(0);
  });

  it('a category card filters by town the same way', async () => {
    const cats = await app.inject({ method: 'GET', url: `${P}/discovery/categories` });
    const id = (cats.json().categories as { id: string }[])[0]!.id;
    const here = await app.inject({ method: 'POST', url: `${P}/discovery/categories/${id}/services`, payload: { city: town } });
    expect(here.statusCode).toBe(200);
    expect(here.json().services.length).toBeGreaterThan(0);
    const elsewhere = await app.inject({ method: 'POST', url: `${P}/discovery/categories/${id}/services`, payload: { city: 'Nowhere-on-Earth' } });
    expect(elsewhere.statusCode).toBe(200);
    expect(elsewhere.json().services).toHaveLength(0);
    void demo;
  });
});
