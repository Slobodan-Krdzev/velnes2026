import { API_PREFIX, SearchMissesSchema } from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';
import { resetAdmittedCache } from '../../public/discovery.routes.js';
import { buildServer } from '../../server.js';

/**
 * Step 10 of the Search phase — docs/SEARCH.md, decision 3.
 *
 * What people asked for and did not find. Alex chose the narrowest of
 * the three options offered: zero and low-result queries only,
 * normalized text, no identity, and nothing that touches ranking.
 *
 * Most of these tests are about what the log refuses to hold. The
 * privacy property is not a promise to be careful with the data — it is
 * that the data was never recorded, and a table that cannot answer
 * "who" is the only kind that reliably does not.
 */

const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });
const P = `${API_PREFIX}/public`;

/** The runtime role the API actually connects as. Only a policy proved
 *  against this role is a policy — the admin role carries BYPASSRLS and
 *  would let anything through. */
const API_URL = (
  process.env.API_DATABASE_URL ?? 'postgres://velnes_api:velnes_api@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

async function search(body: Record<string, unknown>) {
  resetAdmittedCache();
  const res = await app.inject({ method: 'POST', url: `${P}/discovery/search`, payload: body });
  expect(res.statusCode).toBe(200);
  return res.json();
}

async function rows(norm?: string) {
  const r = norm
    ? await admin.query(`SELECT * FROM search_misses WHERE norm = $1`, [norm])
    : await admin.query(`SELECT * FROM search_misses`);
  return r.rows as {
    norm: string;
    asked: number;
    results: number;
    how: string;
    day: Date;
  }[];
}

async function hqToken() {
  const res = await app.inject({
    method: 'POST',
    url: `${API_PREFIX}/hq/auth/login`,
    payload: { email: 'ivana@revelapps.com', password: 'velnes-demo' },
  });
  return (res.json() as { accessToken: string }).accessToken;
}

describe('the miss log', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
  });
  afterAll(async () => {
    await admin.query(`DELETE FROM search_misses`);
    await admin.end();
    await app.close();
    await closeDb();
  });
  beforeEach(async () => {
    await admin.query(`DELETE FROM search_misses`);
  });

  it('records a search that found nothing at all', async () => {
    await search({ q: 'qqzzxw' });
    const [row] = await rows('qqzzxw');
    expect(row).toBeDefined();
    expect(row!.results).toBe(0);
    // Not understood, rather than understood and empty. That difference
    // is the whole value of the log: one is a synonym to add, the other
    // is a salon to recruit.
    expect(row!.how).toBe('none');
  });

  it('records a query that worked and still left somebody with nothing', async () => {
    // "nails" is a real term the taxonomy knows, and this world sells
    // no manicures. A query that resolves perfectly well and still
    // leaves somebody with nothing to book is exactly the gap this log
    // exists to name — and it is a salon to recruit, not a synonym to
    // add.
    await search({ q: 'nails' });
    const [row] = await rows('nails');
    expect(row).toBeDefined();
    expect(row!.results).toBeLessThanOrEqual(2);
  });

  it('leaves a successful search alone', async () => {
    const r = await search({ q: 'fizio' });
    expect(r.services.length).toBeGreaterThan(2);
    expect(await rows('fizio')).toEqual([]);
  });

  it('counts repeats instead of adding rows', async () => {
    await search({ q: 'qqzzxw' });
    await search({ q: 'qqzzxw' });
    await search({ q: 'QQZZXW' });
    const all = await rows('qqzzxw');
    // One row per normalized query per day. No sequence of individual
    // searches can be reconstructed from a counter.
    expect(all).toHaveLength(1);
    expect(all[0]!.asked).toBe(3);
  });

  it('stores the normalized form, which is also what the index matched', async () => {
    await search({ q: '  ЌЕ  Café!!  ' });
    const all = await rows();
    expect(all).toHaveLength(1);
    // Lower-cased, punctuation collapsed, Latin accents folded — and
    // Cyrillic left alone, which is the whole reason search_norm does
    // not transliterate. A logged miss has to be replayable against the
    // index that missed it, so it is stored in the index's own form.
    expect(all[0]!.norm).toBe('ќе cafe');
  });

  it('holds nothing that could say who asked', async () => {
    await search({ q: 'qqzzxw' });
    const cols = await admin.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'search_misses'`,
    );
    const names = cols.rows.map((c: { column_name: string }) => c.column_name).sort();
    // The shape is the guarantee. There is no column for a client, a
    // session or an address, so there is nothing to be careful with.
    expect(names).toEqual(['asked', 'day', 'first_at', 'how', 'last_at', 'norm', 'results']);
    for (const n of names) expect(n).not.toMatch(/client|user|session|ip|customer|token/);
  });

  it('does not record a search the customer narrowed themselves', async () => {
    // An empty answer to "under this much, within that far" is a filter
    // doing its job, not a gap in what the platform sells.
    await search({ q: 'fizio', priceBand: 'low', categoryId: null });
    await search({ q: 'fizio', radiusKm: 1, lat: 41.9981, lng: 21.4254 });
    expect(await rows('fizio')).toEqual([]);
  });

  it('is never written through a table grant, only through the one function', async () => {
    const api = new pg.Client({ connectionString: API_URL });
    await api.connect();
    try {
      // The consumer search door is key-free. An INSERT policy here
      // would hand a pen to anyone on the internet.
      await api.query(`SELECT set_config('app.public', '1', false)`);
      await expect(
        api.query(`INSERT INTO search_misses (norm, results, how) VALUES ('x', 0, 'none')`),
      ).rejects.toThrow();
      // And the function is the way in, for the same role.
      await api.query(`SELECT log_search_miss('written through the door', 0, 'none')`);
      expect((await rows('written through the door'))[0]?.asked).toBe(1);
    } finally {
      await api.end();
    }
  });

  it('refuses text that did not come from the search box', async () => {
    await admin.query(`SELECT log_search_miss('a', 0, 'none')`);
    await admin.query(`SELECT log_search_miss($1, 0, 'none')`, ['x'.repeat(200)]);
    await admin.query(`SELECT log_search_miss(NULL, 0, 'none')`);
    // Below the search threshold, past the contract's maximum, or
    // nothing at all. The function is the boundary rather than trusting
    // whoever called it.
    expect(await rows()).toEqual([]);
  });

  describe('reading it', () => {
    it('is HQ-only, and RLS is what says so', async () => {
      await admin.query(`SELECT log_search_miss('secret query', 0, 'none')`);
      const api = new pg.Client({ connectionString: API_URL });
      await api.connect();
      try {
        // A salon that could read this would be reading a market
        // research report about its competitors.
        await api.query(`SELECT set_config('app.public', '1', false)`);
        expect((await api.query(`SELECT * FROM search_misses`)).rows).toEqual([]);
        await api.query(`SELECT set_config('app.public', '', false)`);
        await api.query(`SELECT set_config('app.hq', '1', false)`);
        expect((await api.query(`SELECT * FROM search_misses`)).rows).toHaveLength(1);
      } finally {
        await api.end();
      }
    });

    it('answers HQ worst-first', async () => {
      await admin.query(`SELECT log_search_miss('rare thing', 0, 'none')`);
      for (let i = 0; i < 5; i += 1)
        await admin.query(`SELECT log_search_miss('common thing', 0, 'none')`);
      const res = await app.inject({
        method: 'GET',
        url: `${API_PREFIX}/hq/search-misses?days=7&limit=10`,
        headers: { authorization: `Bearer ${await hqToken()}` },
      });
      expect(res.statusCode).toBe(200);
      const out = SearchMissesSchema.parse(res.json());
      expect(out.misses[0]!.norm).toBe('common thing');
      expect(out.misses[0]!.asked).toBe(5);
      expect(out.days).toBe(7);
    });

    it('needs an HQ token at all', async () => {
      const res = await app.inject({ method: 'GET', url: `${API_PREFIX}/hq/search-misses` });
      expect(res.statusCode).toBe(401);
    });
  });
});
