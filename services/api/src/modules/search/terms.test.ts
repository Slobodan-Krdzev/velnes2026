import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';

/**
 * Step 2 of the Search phase — docs/SEARCH.md.
 *
 * The gap between what a customer types and what the taxonomy calls
 * things. These prove the words Alex's own examples depend on actually
 * resolve, that a term may honestly mean several categories, and that a
 * salon cannot teach the platform new words about itself.
 */

const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const API_URL = (
  process.env.API_DATABASE_URL ?? 'postgres://velnes_api:velnes_api@localhost:5432/velnes_test'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

describe('category terms', () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  const api = new pg.Client({ connectionString: API_URL });

  /** Which categories a typed word resolves to. */
  async function resolves(typed: string): Promise<string[]> {
    const r = await admin.query(
      `SELECT DISTINCT c.name FROM service_category_terms t
         JOIN service_categories c ON c.id = t.category_id
        WHERE t.norm = search_norm($1) ORDER BY c.name`,
      [typed],
    );
    return r.rows.map((x) => x.name);
  }

  beforeAll(async () => {
    await admin.connect();
    await api.connect();
  });
  afterAll(async () => {
    await admin.end();
    await api.end();
    await closeDb();
  });

  it('understands the words the brief asked for, in either script', async () => {
    expect(await resolves('massage')).toContain('Massage');
    expect(await resolves('masaza')).toContain('Massage');
    expect(await resolves('масажа')).toContain('Massage');
    expect(await resolves('barber')).toContain('Haircuts');
    expect(await resolves('frizer')).toContain('Haircuts');
    expect(await resolves('фризер')).toContain('Haircuts');
    expect(await resolves('haircut')).toContain('Haircuts');
  });

  it('normalises what is typed, so case and accents do not matter', async () => {
    expect(await resolves('MASSAGE')).toContain('Massage');
    expect(await resolves('  Massage  ')).toContain('Massage');
  });

  it('lets one word honestly mean several categories', async () => {
    // This taxonomy splits physiotherapy four ways. "fizio" is all of
    // them, and resolving to a set is truer than picking a winner.
    const cats = await resolves('fizio');
    expect(cats.length).toBeGreaterThan(1);
    expect(cats).toEqual(expect.arrayContaining(['Manual therapy', 'Rehab']));
  });

  it('carries every category as a term, so a category name always matches itself', async () => {
    const r = await admin.query(
      `SELECT count(*)::int AS n FROM service_categories c
        WHERE NOT EXISTS (SELECT 1 FROM service_category_terms t
                           WHERE t.category_id = c.id AND t.kind = 'name')`,
    );
    expect(r.rows[0].n).toBe(0);
  });

  it('ships no unreviewed Macedonian or Albanian display names', async () => {
    // Synonyms in those languages are fine — they are matched, never
    // shown. A display name would be put in front of a customer, and the
    // native review has not happened.
    const r = await admin.query(
      `SELECT count(*)::int AS n FROM service_category_terms
        WHERE kind = 'name' AND lang <> 'en'`,
    );
    expect(r.rows[0].n, 'translated names wait for a native pass').toBe(0);
  });

  it('survives a demo reseed, because the taxonomy is no longer truncated', async () => {
    // The seed ran before this suite. If service_categories were still
    // being wiped, every id would have changed and these would all be
    // orphans pointing at nothing.
    const r = await admin.query(
      `SELECT count(*)::int AS n FROM service_category_terms t
        WHERE NOT EXISTS (SELECT 1 FROM service_categories c WHERE c.id = t.category_id)`,
    );
    expect(r.rows[0].n).toBe(0);
    const some = await admin.query(`SELECT count(*)::int AS n FROM service_category_terms`);
    expect(some.rows[0].n).toBeGreaterThan(0);
  });

  it('is read by anyone and written only by HQ', async () => {
    const cat = await admin.query(`SELECT id FROM service_categories LIMIT 1`);
    await api.query('BEGIN');
    await api.query(`SET app.public = '1'`);
    const read = await api.query(`SELECT count(*)::int AS n FROM service_category_terms`);
    expect(read.rows[0].n, 'a key-free search box has to read these').toBeGreaterThan(0);
    // A salon must not be able to make its own name mean "massage".
    await expect(
      api.query(
        `INSERT INTO service_category_terms (category_id, lang, kind, term)
         VALUES ($1,'en','synonym','my salon')`,
        [cat.rows[0].id],
      ),
    ).rejects.toThrow(/policy/i);
    await api.query('ROLLBACK');
  });
});
