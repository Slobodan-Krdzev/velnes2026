import { API_PREFIX, DiscoveryCategoriesSchema, DiscoveryRankedServicesSchema, PARTY_HORIZON_DAYS, SearchResultsSchema } from '@velnes/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../db/index.js';
import { demo } from '../db/seed-demo.js';
import { nowAt } from '../modules/scheduling/scheduling.service.js';
import { daysFor, weekdayOf } from '../modules/search/when.js';
import { resetAdmittedCache } from './discovery.routes.js';
import { buildServer } from '../server.js';

/**
 * "When" and "for two" on the doors (Alex, 2026-09-30): a day is hard
 * admission — only what has a free start that day, each card saying
 * which — and a party is admission on the calendar too. The doors take
 * the wall clock, so the expectations are computed from it: the seeded
 * salon is open Monday to Saturday, closed on Sundays. Rehab training
 * is the treatment with two bookable hands at each place (Maria with
 * Ana at Aerodrom, Maria with Elena at Centar), and Maria works every
 * open day; Sports massage is Elena's alone, at Centar.
 */
const app = await buildServer();
const P = `${API_PREFIX}/public`;
const clock = nowAt('Europe/Skopje');
const tomorrow = daysFor('tomorrow', clock.date, 7)[0]!;
const weekend = daysFor('weekend', clock.date, 7);

async function search(body: Record<string, unknown>) {
  resetAdmittedCache();
  const res = await app.inject({ method: 'POST', url: `${P}/discovery/search`, payload: body });
  expect(res.statusCode).toBe(200);
  const r = SearchResultsSchema.parse(res.json());
  // Only the seeded salon: other suites' fixtures may be listed too.
  return r.services.filter((s) => s.salon.slug === 'velnes-fizio');
}

describe('a day, and a party', () => {
  beforeAll(() => app.ready());
  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  it('without a day, nothing claims one', async () => {
    const cards = await search({ q: 'rehab training' });
    expect(cards.length).toBeGreaterThan(0);
    for (const s of cards) expect(s.availableOn).toBeNull();
  });

  it('"tomorrow" admits only what has a free start tomorrow, and says which', async () => {
    const cards = await search({ q: 'rehab training', when: 'tomorrow' });
    if (weekdayOf(tomorrow) === 6) {
      // Closed on Sundays: an honest nothing, not a card without a day.
      expect(cards).toEqual([]);
      return;
    }
    const rehab = cards.filter((s) => s.id === demo.s4);
    expect(rehab.map((s) => s.location.id).sort()).toEqual([demo.locCentar, demo.locAerodrom].sort());
    for (const s of cards) {
      expect(s.availableOn?.date).toBe(tomorrow);
      expect(s.availableOn?.at).toMatch(/^\d\d:\d\d$/);
    }
  });

  it('"this weekend" is the coming Saturday for a salon closed on Sundays', async () => {
    const cards = await search({ q: 'rehab training', when: 'weekend' });
    const saturday = weekend.find((d) => weekdayOf(d) === 5);
    // A Sunday has no weekend left: the honest answer is nothing.
    if (!saturday) {
      expect(cards).toEqual([]);
      return;
    }
    // On the Saturday itself the afternoon may already be gone (open
    // till 15:00); only the days ahead are asserted.
    if (saturday === clock.date) return;
    expect(cards.some((s) => s.id === demo.s4)).toBe(true);
    for (const s of cards) expect(s.availableOn?.date).toBe(saturday);
  });

  it('"for two" keeps only where two can be seen at once, within the horizon', async () => {
    const two = await search({ q: 'rehab training', party: 2 });
    // Rehab training at both places — two hands at each.
    const rehab = two.filter((s) => s.id === demo.s4);
    expect(rehab.map((s) => s.location.id).sort()).toEqual([demo.locCentar, demo.locAerodrom].sort());
    const horizon = daysFor(null, clock.date, PARTY_HORIZON_DAYS);
    for (const s of two) expect(horizon).toContain(s.availableOn?.date);
    // Three: nowhere has three hands for it.
    expect(await search({ q: 'rehab training', party: 3 })).toEqual([]);
    // Sports massage is Elena's alone: for two, it is gone.
    const massage = await search({ q: 'sports massage', party: 2 });
    expect(massage.some((s) => s.id === demo.s8)).toBe(false);
  });

  it('the category door answers the same question', async () => {
    const cats = DiscoveryCategoriesSchema.parse((await app.inject({ method: 'GET', url: `${P}/discovery/categories` })).json());
    const rehab = cats.categories.find((c) => c.name === 'Rehab');
    expect(rehab).toBeTruthy();
    const res = await app.inject({ method: 'POST', url: `${P}/discovery/categories/${rehab!.id}/services`, payload: { party: 2 } });
    expect(res.statusCode).toBe(200);
    const r = DiscoveryRankedServicesSchema.parse(res.json());
    const mine = r.services.filter((s) => s.salon.slug === 'velnes-fizio');
    expect(mine.map((s) => s.location.id).sort()).toEqual([demo.locCentar, demo.locAerodrom].sort());
    for (const s of mine) expect(s.availableOn).not.toBeNull();
    // And a party the schema does not allow is refused, not clamped.
    expect((await app.inject({ method: 'POST', url: `${P}/discovery/categories/${rehab!.id}/services`, payload: { party: 9 } })).statusCode).toBe(400);
  });
});
