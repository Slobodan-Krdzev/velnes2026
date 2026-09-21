import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../db/index.js';

/**
 * Step 1 of the Search phase — docs/SEARCH.md.
 *
 * The projection has one job: be true. Everything downstream trusts it
 * to say what text exists on the platform, so what these prove is that
 * it cannot quietly drift from the tables it mirrors.
 */

const ADMIN_URL = (
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.TEST_SEED_DATABASE_URL ??
  'postgres://velnes:velnes@localhost:5432/velnes'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

const API_URL = (
  process.env.API_DATABASE_URL ?? 'postgres://velnes_api:velnes_api@localhost:5432/velnes_test'
).replace(/\/[^/?]+(\?|$)/, '/velnes_test$1');

describe('the search projection', () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  const api = new pg.Client({ connectionString: API_URL });
  let tenant = '';
  let service = '';

  beforeAll(async () => {
    await admin.connect();
    await api.connect();
    const b = await admin.query(`SELECT id FROM businesses WHERE slug = 'velnes-fizio'`);
    tenant = b.rows[0].id;
    const s = await admin.query(
      `SELECT id FROM services WHERE tenant_id = $1 AND status='active' AND online LIMIT 1`,
      [tenant],
    );
    service = s.rows[0].id;
  });
  afterAll(async () => {
    await admin.end();
    await api.end();
    await closeDb();
  });

  it('holds the salons and treatments that are actually published', async () => {
    const r = await admin.query(
      `SELECT kind, count(*)::int AS n FROM search_documents GROUP BY kind ORDER BY kind`,
    );
    const by = Object.fromEntries(r.rows.map((x) => [x.kind, x.n]));
    expect(by.salon).toBeGreaterThan(0);
    expect(by.service).toBeGreaterThan(0);

    // Exactly the publishable set — no drafts, no POS-only treatments,
    // nothing belonging to a salon that is not listed.
    const drift = await admin.query(`
      SELECT count(*)::int AS n FROM search_documents d
       WHERE d.kind = 'service'
         AND NOT EXISTS (
           SELECT 1 FROM services s JOIN businesses b ON b.id = s.tenant_id
            WHERE s.id = d.ref_id AND s.status = 'active' AND s.online
              AND b.slug IS NOT NULL
              AND COALESCE(b.settings->'marketplace'->>'listed','true') = 'true')`);
    expect(drift.rows[0].n, 'no row survives its source').toBe(0);
  });

  it('normalises for matching, keeping Cyrillic and folding accents', async () => {
    const r = await admin.query(
      `SELECT search_norm('Studio Lumière – Skopje!') lat, search_norm('Шишање Мажи') cyr`,
    );
    expect(r.rows[0].lat).toBe('studio lumiere skopje');
    // Nothing transliterates Cyrillic, and nothing should: "масажа" is
    // matched by a synonym row, never by folding it into Latin.
    expect(r.rows[0].cyr).toBe('шишање мажи');
  });

  it('follows a treatment out of the catalogue and back', async () => {
    await admin.query(`UPDATE services SET status='draft' WHERE id=$1`, [service]);
    let n = await admin.query(`SELECT count(*)::int AS n FROM search_documents WHERE ref_id=$1`, [
      service,
    ]);
    expect(n.rows[0].n, 'a draft is not suggestible').toBe(0);

    await admin.query(`UPDATE services SET status='active' WHERE id=$1`, [service]);
    n = await admin.query(`SELECT count(*)::int AS n FROM search_documents WHERE ref_id=$1`, [
      service,
    ]);
    expect(n.rows[0].n, 'and comes back when it returns').toBe(1);
  });

  it('carries a salon rename through to its treatments', async () => {
    const before = await admin.query(`SELECT name FROM businesses WHERE id=$1`, [tenant]);
    await admin.query(`UPDATE businesses SET name='Renamed Salon' WHERE id=$1`, [tenant]);
    try {
      const r = await admin.query(
        `SELECT count(*)::int AS n FROM search_documents
          WHERE tenant_id=$1 AND salon_name <> 'Renamed Salon'`,
        [tenant],
      );
      // A suggestion shows the salon behind a treatment; a stale name
      // there is a lie on the card.
      expect(r.rows[0].n).toBe(0);
    } finally {
      await admin.query(`UPDATE businesses SET name=$2 WHERE id=$1`, [
        tenant,
        before.rows[0].name,
      ]);
    }
  });

  it('takes a whole catalogue out when a salon unlists, and back when it returns', async () => {
    await admin.query(
      `UPDATE businesses SET settings = jsonb_set(settings,'{marketplace,listed}','false') WHERE id=$1`,
      [tenant],
    );
    let n = await admin.query(
      `SELECT count(*)::int AS n FROM search_documents WHERE tenant_id=$1`,
      [tenant],
    );
    expect(n.rows[0].n).toBe(0);

    await admin.query(
      `UPDATE businesses SET settings = jsonb_set(settings,'{marketplace,listed}','true') WHERE id=$1`,
      [tenant],
    );
    n = await admin.query(`SELECT count(*)::int AS n FROM search_documents WHERE tenant_id=$1`, [
      tenant,
    ]);
    expect(n.rows[0].n, 'salon plus its treatments').toBeGreaterThan(1);
  });

  it('survives the demo seed, which truncates rather than deletes', async () => {
    // Row triggers do not fire on TRUNCATE. Without the statement-level
    // trigger this projection would keep pointing at a world that no
    // longer exists — the same shape of bug that wiped the ranking
    // config in Phase B.
    const seeded = await admin.query(`SELECT count(*)::int AS n FROM search_documents`);
    expect(seeded.rows[0].n, 'the seeded world is indexed').toBeGreaterThan(0);
    const orphans = await admin.query(
      `SELECT count(*)::int AS n FROM search_documents d
        WHERE NOT EXISTS (SELECT 1 FROM businesses b WHERE b.id = d.tenant_id)`,
    );
    expect(orphans.rows[0].n, 'nothing points at a salon that is gone').toBe(0);
  });

  it('finds an honest typo, and uses the index to do it', async () => {
    // word_similarity, not similarity: "masage" scores 0.27 against
    // "Aromatherapy Massage" as a whole string and would be missed,
    // but 0.67 against its best-matching word.
    const r = await admin.query(
      `SELECT count(*)::int AS n FROM search_documents WHERE 'masage' <% norm AND kind='service'`,
    );
    expect(r.rows[0].n, 'a missing letter still finds massages').toBeGreaterThan(0);

    // At forty-six rows the planner picks a sequential scan, and it is
    // right to: the index would be slower. So what is asserted here is
    // that the index *can* serve this operator — which is the thing that
    // would silently stop being true if the operator class were wrong —
    // rather than that the planner must choose it at demo scale.
    await admin.query('BEGIN');
    await admin.query('SET LOCAL enable_seqscan = off');
    const plan = await admin.query(
      `EXPLAIN (COSTS OFF) SELECT display FROM search_documents WHERE 'masage' <% norm`,
    );
    await admin.query('ROLLBACK');
    const text = plan.rows.map((x) => x['QUERY PLAN']).join('\n');
    expect(text, 'the trigram index can serve this operator').toContain(
      'search_documents_norm_trgm',
    );
  });

  it('is readable by anyone and writable by nobody', async () => {
    // A key-free search box has to read it, and it holds only what
    // salons publish — so the read is open.
    for (const setup of ['', `SET app.public = '1'`, `SET app.tenant_id = '${tenant}'`]) {
      await api.query('BEGIN');
      if (setup) await api.query(setup);
      const r = await api.query(`SELECT count(*)::int AS n FROM search_documents`);
      await api.query('ROLLBACK');
      expect(r.rows[0].n).toBeGreaterThan(0);
    }
    // But nothing can edit it into disagreeing with its sources: there
    // is no write policy at all, only SECURITY DEFINER triggers.
    await api.query('BEGIN');
    await api.query(`SET app.tenant_id = '${tenant}'`);
    await expect(
      api.query(
        `INSERT INTO search_documents (kind, ref_id, tenant_id, display, norm, salon_slug, salon_name)
         VALUES ('salon', $1, $2, 'Fake', 'fake', 'fake', 'Fake')`,
        [randomUUID(), tenant],
      ),
    ).rejects.toThrow(/policy/i);
    await api.query('ROLLBACK');
  });
});
