import { API_PREFIX, DEFAULT_SEARCH_CONFIG, SearchPreviewSchema } from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';
import { buildServer } from '../../server.js';

/**
 * Step 9 of Phase B: the Search lab.
 *
 * Tuning must be a versioned, reversible, inspectable act — and it must
 * be out of reach of the people whose results it decides.
 */

const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });
let superToken = '';
let supportToken = '';
/** What was in force, and how far the history went, before this suite
 *  touched anything. Restored afterwards — a test that edits the
 *  versioned record is doing the one thing the record exists to
 *  prevent. */
let baseVersion = 0;
let maxVersion = 0;

async function hqToken(email: string) {
  const res = await app.inject({
    method: 'POST',
    url: `${API_PREFIX}/hq/auth/login`,
    payload: { email, password: 'velnes-demo' },
  });
  return (res.json() as { accessToken: string }).accessToken;
}
const call = (
  method: 'GET' | 'POST',
  url: string,
  payload?: unknown,
  t = superToken,
) =>
  app.inject({
    method,
    url: `${API_PREFIX}${url}`,
    headers: { authorization: `Bearer ${t}` },
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });

describe('the HQ Search lab', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
    superToken = await hqToken('ivana@revelapps.com');
    supportToken = await hqToken('tea@revelapps.com');
    const r = await admin.query(
      `SELECT max(version)::int AS top,
              (SELECT version FROM search_config WHERE active)::int AS live
         FROM search_config`,
    );
    maxVersion = r.rows[0].top;
    baseVersion = r.rows[0].live;
  });
  afterAll(async () => {
    // Put the world back: only the versions this suite created go, and
    // whatever was in force before is in force again.
    await admin.query(`UPDATE search_config SET active = false WHERE active`);
    await admin.query(`DELETE FROM search_config WHERE version > $1`, [maxVersion]);
    await admin.query(`UPDATE search_config SET active = true WHERE version = $1`, [baseVersion]);
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('shows the whole history, not only what is in force', async () => {
    const res = await call('GET', '/hq/search-config');
    expect(res.statusCode).toBe(200);
    const { versions } = res.json() as { versions: { version: number; active: boolean }[] };
    expect(versions.length).toBeGreaterThan(0);
    // Exactly one in force, always — the invariant the whole document
    // rests on.
    expect(versions.filter((v) => v.active).length).toBe(1);
  });

  it('keeps ranking config away from roles that only support and onboard', async () => {
    // It decides what every consumer sees; it is not a support decision.
    const write = await call(
      'POST',
      '/hq/search-config',
      { payload: DEFAULT_SEARCH_CONFIG, note: 'nope', activate: false },
      supportToken,
    );
    expect(write.statusCode).toBe(403);
    // Reading stays open: an auditor who cannot see the rules cannot
    // audit them.
    expect((await call('GET', '/hq/search-config', undefined, supportToken)).statusCode).toBe(200);
  });

  it('writes a new version rather than editing one, and can put it in force', async () => {
    const draft = {
      ...DEFAULT_SEARCH_CONFIG,
      weights: { ...DEFAULT_SEARCH_CONFIG.weights, proximity: 0.5, value: 0.05 },
    };
    const made = await call('POST', '/hq/search-config', {
      payload: draft,
      note: 'Lean harder on distance',
      activate: false,
    });
    expect(made.statusCode).toBe(200);
    const v = made.json() as { version: number; active: boolean };
    expect(v.version).toBeGreaterThan(1);
    expect(v.active, 'parked, not live').toBe(false);
    // v1 is still the one in force.
    const before = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/public/discovery/categories/${await anyCategoryId()}/services`,
      payload: {},
    });
    expect(before.json().rankVersion).toBe(baseVersion);

    const on = await call('POST', `/hq/search-config/${v.version}/activate`);
    expect(on.statusCode).toBe(200);
    expect((on.json() as { active: boolean }).active).toBe(true);

    // The consumer door now stamps the new version — which is the whole
    // point of stamping it.
    const after = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/public/discovery/categories/${await anyCategoryId()}/services`,
      payload: {},
    });
    expect(after.json().rankVersion).toBe(v.version);

    // Reversible: put the previous version back and the door says so.
    expect(
      (await call('POST', `/hq/search-config/${baseVersion}/activate`)).statusCode,
    ).toBe(200);
    const back = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/public/discovery/categories/${await anyCategoryId()}/services`,
      payload: {},
    });
    expect(back.json().rankVersion).toBe(baseVersion);
  });

  it('activating the version already in force is a no-op, not an error', async () => {
    const res = await call('POST', `/hq/search-config/${baseVersion}/activate`);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { active: boolean }).active).toBe(true);
  });

  it('refuses to activate a version that does not exist', async () => {
    expect((await call('POST', '/hq/search-config/9999/activate')).statusCode).toBe(404);
  });

  it('dry-runs a draft and says how the order would move, changing nothing', async () => {
    const categoryId = await anyCategoryId();
    // Turn distance up hard; from Skopje, nearby salons should climb.
    const draft = {
      ...DEFAULT_SEARCH_CONFIG,
      weights: {
        ...DEFAULT_SEARCH_CONFIG.weights,
        proximity: 1,
        affinity: 0,
        availability: 0,
        value: 0,
      },
    };
    const res = await call('POST', '/hq/search-config/preview', {
      categoryId,
      payload: draft,
      lat: 41.9981,
      lng: 21.4254,
    });
    expect(res.statusCode).toBe(200);
    const out = SearchPreviewSchema.parse(res.json());
    expect(out.activeVersion).toBe(baseVersion);
    expect(out.rows.length).toBeGreaterThan(0);
    // was/now/moved agree with each other, or the diff is a lie.
    for (const r of out.rows) expect(r.moved).toBe(r.now - r.was);
    // Components come back so a move can be explained rather than
    // guessed at.
    expect(Object.keys(out.rows[0]!.components)).toContain('proximity');

    // And nothing changed: the door still ranks under v1.
    const live = await app.inject({
      method: 'POST',
      url: `${API_PREFIX}/public/discovery/categories/${categoryId}/services`,
      payload: {},
    });
    expect(live.json().rankVersion).toBe(baseVersion);
  });

  it('refuses a dry run against a category that does not exist', async () => {
    const res = await call('POST', '/hq/search-config/preview', {
      categoryId: '00000000-0000-4000-8000-000000000000',
      payload: DEFAULT_SEARCH_CONFIG,
      lat: null,
      lng: null,
    });
    expect(res.statusCode).toBe(404);
  });

  describe('the query box — step 11 of docs/SEARCH.md', () => {
    const ask = (q: string | null, categoryId: string | null = null) =>
      call('POST', '/hq/search-config/preview', {
        q,
        categoryId,
        payload: DEFAULT_SEARCH_CONFIG,
        lat: null,
        lng: null,
      });

    it('shows how the text was read, not only how it ranked', async () => {
      // Most surprising orders are decided before the scorer runs: the
      // text meant something other than what was intended. That half of
      // the story is the one the lab could not previously tell.
      const out = SearchPreviewSchema.parse((await ask('fizio')).json());
      const i = out.interpretation!;
      expect(i.normalized).toBe('fizio');
      expect(i.how).toBe('category');
      expect(i.categories.length).toBeGreaterThan(1);
      expect(i.gathered).toBeGreaterThan(0);
      expect(i.admitted).toBe(out.rows.length);
      expect(out.category, 'labelled by what was asked').toBe('fizio');
    });

    it('shows every way the text met the platform, best first', async () => {
      const out = SearchPreviewSchema.parse((await ask('Sports massage')).json());
      const i = out.interpretation!;
      expect(i.matches[0]!.how).toBe('exact');
      expect(i.matches.map((m) => m.display)).toContain('Sports massage');
      for (let n = 1; n < i.matches.length; n += 1)
        expect(i.matches[n]!.score).toBeLessThanOrEqual(i.matches[n - 1]!.score);
    });

    it('says when the text would have opened a salon instead', async () => {
      // No results page happens at all in that case, and a lab that
      // silently showed an empty ranking would be hiding the reason.
      const out = SearchPreviewSchema.parse((await ask('Velnes Fizio Centar')).json());
      expect(out.interpretation!.how).toBe('salon');
      expect(out.interpretation!.directSalon).toBe('Velnes Fizio Centar');
    });

    it('explains a query that understood nothing', async () => {
      const out = SearchPreviewSchema.parse((await ask('qqzzxw')).json());
      expect(out.interpretation!.how).toBe('none');
      expect(out.interpretation!.gathered).toBe(0);
      expect(out.rows).toEqual([]);
    });

    it('ranks the same candidates the consumer door ranks', async () => {
      // The instruction for this phase was one search system. A lab
      // that built its own candidates would explain a search nobody
      // performs.
      const out = SearchPreviewSchema.parse((await ask('fizio')).json());
      const live = await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/public/discovery/search`,
        payload: { q: 'fizio' },
      });
      const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();
      expect(ids(out.rows)).toEqual(ids(live.json().services));
    });

    it('carries the explanations the consumer response never does', async () => {
      const out = SearchPreviewSchema.parse((await ask('fizio')).json());
      expect(Object.keys(out.rows[0]!.components)).toContain('textRelevance');
      const live = await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/public/discovery/search`,
        payload: { q: 'fizio' },
      });
      // Weights and component scores stay inside HQ: a salon that could
      // read them could game them.
      expect(JSON.stringify(live.json())).not.toMatch(/components|textRelevance|proximity/);
    });

    it('insists on one entrance or the other', async () => {
      // Both would be two questions; neither is none.
      expect((await ask('fizio', await anyCategoryId())).statusCode).toBe(400);
      expect((await ask(null, null)).statusCode).toBe(400);
    });

    it('changes nothing', async () => {
      await ask('fizio');
      const live = await app.inject({
        method: 'POST',
        url: `${API_PREFIX}/public/discovery/categories/${await anyCategoryId()}/services`,
        payload: {},
      });
      expect(live.json().rankVersion).toBe(baseVersion);
    });
  });

  /** A category the seed really publishes services in. */
  async function anyCategoryId() {
    const cats = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/public/discovery/categories`,
    });
    return (cats.json() as { categories: { id: string }[] }).categories[0]!.id;
  }
});
