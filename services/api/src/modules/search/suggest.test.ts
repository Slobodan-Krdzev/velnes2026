import { API_PREFIX, SearchSuggestionsSchema } from '@velnes/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';
import { resetAdmittedCache } from '../../public/discovery.routes.js';
import { buildServer } from '../../server.js';

/**
 * Step 4 of the Search phase — docs/SEARCH.md.
 *
 * One door, three kinds, one input.
 *
 * These run against the seeded world, which is one listed salon —
 * Velnes Fizio Centar — and its eight physiotherapy treatments. That is
 * deliberately not the developer's database: writing these against
 * whatever happened to be sitting in dev is how a suite passes for one
 * person and nobody else.
 */

const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const app = await buildServer();
const admin = new pg.Client({ connectionString: ADMIN_URL });
const P = `${API_PREFIX}/public`;

async function suggest(q: string) {
  resetAdmittedCache();
  const res = await app.inject({ method: 'POST', url: `${P}/discovery/suggest`, payload: { q } });
  expect(res.statusCode).toBe(200);
  return SearchSuggestionsSchema.parse(res.json());
}

describe('suggestions', () => {
  beforeAll(async () => {
    await app.ready();
    await admin.connect();
  });
  afterAll(async () => {
    await admin.end();
    await app.close();
    await closeDb();
  });

  it('says nothing at all below the threshold', async () => {
    const r = await suggest('m');
    expect(r.salons).toEqual([]);
    expect(r.services).toEqual([]);
    expect(r.categories).toEqual([]);
    // Echoed, so a client can throw away a response that arrives late.
    expect(r.q).toBe('m');
  });

  it('finds a treatment by name, and carries the salon behind it', async () => {
    const r = await suggest('Sports massage');
    expect(r.services[0]?.name, 'the named treatment leads').toBe('Sports massage');
    // The row renders without a second request.
    expect(r.services[0]?.salonName).toBe('Velnes Fizio Centar');
    expect(r.services[0]?.salonSlug).toBe('velnes-fizio');
  });

  it('completes a salon from a fragment', async () => {
    const r = await suggest('Velnes');
    expect(r.salons.map((s) => s.name)).toContain('Velnes Fizio Centar');
    expect(r.salons[0]?.slug).toBe('velnes-fizio');
  });

  it('reads an intent through a synonym, in either script', async () => {
    // "fizio" and "физио" are this taxonomy's four physiotherapy
    // categories at once, and the seeded salon sells in all of them.
    for (const q of ['fizio', 'физио']) {
      const r = await suggest(q);
      const names = r.categories.map((c) => c.name);
      expect(names, q).toEqual(expect.arrayContaining(['Manual therapy', 'Rehab']));
    }
  });

  it('mixes kinds in one list, because there is one input', async () => {
    const r = await suggest('therapy');
    expect(r.categories.map((c) => c.name)).toContain('Manual therapy');
    expect(r.services.some((s) => /therapy/i.test(s.name))).toBe(true);
  });

  it('finds a treatment nobody typed exactly', async () => {
    // Nothing is called "posture"; "Posture screening" is.
    const r = await suggest('posture');
    expect(r.services.map((s) => s.name)).toContain('Posture screening');
  });

  it('survives a missing letter', async () => {
    const r = await suggest('masage');
    expect(r.services.some((s) => /massage/i.test(s.name)), 'a typo still finds it').toBe(true);
  });

  it('never suggests a category nothing can be booked in', async () => {
    // Haircuts exists in the taxonomy and has real synonyms, but the
    // seeded world sells no haircuts. A suggestion for it would open
    // onto an empty page — the same dead end the category shelf has
    // refused since Phase A.
    const r = await suggest('barber');
    expect(r.categories.map((c) => c.name)).not.toContain('Haircuts');
  });

  it('never suggests a salon that has no public listing', async () => {
    // Lumen Beauty is seeded without a slug, so it is not published and
    // was never in the index to begin with.
    const r = await suggest('Lumen');
    expect(r.salons).toEqual([]);
  });

  it('answers an unknown word with an empty list rather than an error', async () => {
    const r = await suggest('xyzzyplugh');
    expect(r.salons).toEqual([]);
    expect(r.services).toEqual([]);
    expect(r.categories).toEqual([]);
  });

  it('stops suggesting a salon the moment it unlists', async () => {
    const before = await suggest('Velnes');
    expect(before.salons.length).toBeGreaterThan(0);
    await admin.query(
      `UPDATE businesses SET settings = jsonb_set(settings,'{marketplace,listed}','false')
        WHERE slug = 'velnes-fizio'`,
    );
    try {
      const after = await suggest('Velnes');
      expect(after.salons.some((s) => s.slug === 'velnes-fizio')).toBe(false);
      expect(after.services, 'and its treatments go with it').toEqual([]);
    } finally {
      await admin.query(
        `UPDATE businesses SET settings = jsonb_set(settings,'{marketplace,listed}','true')
          WHERE slug = 'velnes-fizio'`,
      );
    }
  });

  it('keeps suggesting when the website widget goes dark — admission is the open location', async () => {
    const before = await suggest('Sports massage');
    expect(before.services.length).toBeGreaterThan(0);
    await admin.query(
      `UPDATE widgets SET status='draft'
        WHERE tenant_id=(SELECT id FROM businesses WHERE slug='velnes-fizio')`,
    );
    try {
      const after = await suggest('Sports massage');
      // Admission is the same rule the results page uses, and that rule
      // is the ACTIVE location: the widget is a separate product a salon
      // may never have, so switching it off changes nothing here.
      expect(after.services.length).toBe(before.services.length);
    } finally {
      await admin.query(
        `UPDATE widgets SET status='live'
          WHERE tenant_id=(SELECT id FROM businesses WHERE slug='velnes-fizio')`,
      );
    }
  });

  it('gives the same answer twice', async () => {
    expect(await suggest('therapy')).toEqual(await suggest('therapy'));
  });
});
