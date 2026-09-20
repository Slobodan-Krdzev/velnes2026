import { sql } from 'kysely';
import { db } from '../../db/index.js';
import type { SearchMatch } from './interpret.js';

/**
 * Step 4 of the Search phase — docs/SEARCH.md.
 *
 * Every way a typed string meets the platform, in one query. Salons and
 * treatments come from the projection; intents come from the category
 * terms, so "masaza" and "масажа" arrive here as Massage without anyone
 * parsing a string in JavaScript.
 *
 * Normalization happens in SQL, through `search_norm`, and nowhere else.
 * The query text is handed over raw on purpose: two implementations of
 * "what does this text become" would eventually disagree, and the one
 * that matters is the one the index was built with.
 */

/** Below this a query is noise — two characters match half the world. */
export const MIN_QUERY = 2;

/** Nobody reads past this, and scoring an unbounded pool is how a search
 *  box becomes a denial of service. */
const PER_KIND_CAP = 25;

interface Row {
  kind: 'salon' | 'service' | 'category';
  id: string;
  display: string;
  how: 'exact' | 'prefix' | 'fuzzy';
  score: number;
  salonSlug: string | null;
  salonName: string | null;
  categoryId: string | null;
  salonCount: number | null;
}

/**
 * @param raw   what the customer typed, unnormalized
 * @param tenantIds  the salons currently admitted; suggestions never
 *   reach past them, so a salon that has just unlisted stops being
 *   suggested even though the projection still carries its text
 */
export async function lookupMatches(raw: string, tenantIds: string[]): Promise<SearchMatch[]> {
  const q = raw.trim();
  if (q.length < MIN_QUERY || tenantIds.length === 0) return [];

  // `app.public` because this is the key-free surface: the projection
  // and the taxonomy are both readable there, and nothing else is.
  const rows = await db.transaction().execute(async (trx) => {
    await sql`select set_config('app.public', '1', true)`.execute(trx);
    const r = await sql<Row>`
      WITH q AS (SELECT search_norm(${q}) AS nq)
      (
        -- Salons and treatments, from the projection. The how/score
        -- columns are computed in the inner select and ordered in the
        -- outer one: an output alias may stand alone in ORDER BY but
        -- cannot appear inside an expression there.
        SELECT * FROM (
          SELECT d.kind::text AS "kind",
                 d.ref_id::text AS "id",
                 d.display AS "display",
                 CASE WHEN d.norm = q.nq THEN 'exact'
                      WHEN d.norm LIKE q.nq || '%' OR d.norm LIKE '% ' || q.nq || '%' THEN 'prefix'
                      ELSE 'fuzzy' END AS "how",
                 CASE WHEN d.norm = q.nq THEN 1::real
                      ELSE word_similarity(q.nq, d.norm) END AS "score",
                 d.salon_slug AS "salonSlug",
                 d.salon_name AS "salonName",
                 d.category_id::text AS "categoryId",
                 NULL::int AS "salonCount"
            FROM search_documents d, q
           WHERE d.tenant_id = ANY(${tenantIds}::uuid[])
             AND (d.norm = q.nq OR d.norm LIKE '%' || q.nq || '%' OR q.nq <% d.norm)
        ) hits
        ORDER BY ("how" = 'exact') DESC, ("how" = 'prefix') DESC, "score" DESC
        LIMIT ${PER_KIND_CAP * 2}
      )
      UNION ALL
      (
        -- Intents, from the taxonomy's own words. DISTINCT ON keeps the
        -- best way a category was reached: one matched by its name and
        -- by a synonym at once is still a single suggestion.
        SELECT * FROM (
          SELECT DISTINCT ON ("id") *
            FROM (
              SELECT 'category' AS "kind",
                     t.category_id::text AS "id",
                     c.name AS "display",
                     CASE WHEN t.norm = q.nq THEN 'exact'
                          WHEN t.norm LIKE q.nq || '%' OR t.norm LIKE '% ' || q.nq || '%' THEN 'prefix'
                          ELSE 'fuzzy' END AS "how",
                     CASE WHEN t.norm = q.nq THEN 1::real
                          ELSE word_similarity(q.nq, t.norm) END AS "score",
                     NULL::text AS "salonSlug",
                     NULL::text AS "salonName",
                     NULL::text AS "categoryId",
                     (SELECT count(DISTINCT sd.tenant_id)::int
                        FROM search_documents sd
                       WHERE sd.kind = 'service'
                         AND sd.category_id = t.category_id
                         AND sd.tenant_id = ANY(${tenantIds}::uuid[])) AS "salonCount"
                FROM service_category_terms t
                JOIN service_categories c ON c.id = t.category_id, q
               WHERE (t.norm = q.nq OR t.norm LIKE '%' || q.nq || '%' OR q.nq <% t.norm)
                 -- A category is only worth suggesting if something in
                 -- it can actually be booked. The category shelf has
                 -- carried this rule since Phase A for the same reason:
                 -- a card that opens onto an empty page is a dead end
                 -- with a nice name.
                 AND EXISTS (
                   SELECT 1 FROM search_documents sd
                    WHERE sd.kind = 'service'
                      AND sd.category_id = t.category_id
                      AND sd.tenant_id = ANY(${tenantIds}::uuid[]))
            ) terms
           ORDER BY "id", ("how" = 'exact') DESC, ("how" = 'prefix') DESC, "score" DESC
        ) cats
        ORDER BY ("how" = 'exact') DESC, ("how" = 'prefix') DESC, "score" DESC
        LIMIT ${PER_KIND_CAP}
      )
    `.execute(trx);
    return r.rows;
  });

  // Absent means absent: the project runs with exactOptionalPropertyTypes,
  // so a category has no salonSlug key at all rather than one set to
  // undefined.
  return rows.map((r) => ({
    kind: r.kind,
    id: r.id,
    display: r.display,
    how: r.how,
    score: Number(r.score),
    categoryId: r.categoryId,
    ...(r.salonSlug ? { salonSlug: r.salonSlug } : {}),
    ...(r.salonName ? { salonName: r.salonName } : {}),
    ...(r.salonCount != null ? { salonCount: Number(r.salonCount) } : {}),
  }));
}

/**
 * The best few of each kind, for the suggestion list.
 *
 * Exact before prefix before fuzzy, then by how well it matched, then by
 * name so the order never wobbles between two identical scores.
 */
export function topMatches(matches: SearchMatch[], kind: SearchMatch['kind'], take: number) {
  const rank = { exact: 0, prefix: 1, fuzzy: 2 } as const;
  return matches
    .filter((m) => m.kind === kind)
    .sort(
      (a, b) =>
        rank[a.how] - rank[b.how] || b.score - a.score || a.display.localeCompare(b.display),
    )
    .slice(0, take);
}
