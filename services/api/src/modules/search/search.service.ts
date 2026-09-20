import {
  SearchConfigPayloadSchema,
  type SearchConfigPayload,
  type SearchConfigVersion,
  type SearchPreview,
} from '@velnes/contracts';
import { sql } from 'kysely';
import { withClient, withHq, withTenant } from '../../db/index.js';
import type { ViewerHistory } from './rank.js';
import { rank } from './rank.js';
import {
  candidatesOf,
  gatherCategory,
  textCandidates,
  withTextRelevance,
} from '../../public/discovery.routes.js';
import { applyFilters } from './filters.js';
import type { RankCandidate } from './rank.js';
import { favouriteIds } from '../clients/favourites.service.js';

/**
 * The Search lab's config — §5, docs/SEARCH-RANKING.md.
 *
 * One active version at a time, enforced by a partial unique index.
 * Rows are written once and then only activated or deactivated, so the
 * table is its own audit trail: who wrote a version, who switched it on,
 * and exactly what it said.
 */

export class SearchConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SearchConfigError';
  }
}

export interface ActiveSearchConfig {
  /** Stamped onto ranked responses, so an order can be explained later. */
  version: number;
  payload: SearchConfigPayload;
}

/**
 * Read the config in force.
 *
 * Read under `app.hq` because ranking config is platform-level and
 * deliberately unreadable by a tenant or by the public — a salon that
 * could read the weights could game them. The consumer doors are
 * key-free, so this is the one place they reach past their own context,
 * and it returns numbers only: nothing from this table is ever echoed
 * to a caller except the version number.
 *
 * The payload is validated on the way out rather than trusted. A config
 * document that has drifted from the contract is a ranking that is
 * quietly wrong for everybody, which is far worse than a loud failure —
 * so a bad payload raises here instead of ordering results by accident.
 */
export async function activeSearchConfig(): Promise<ActiveSearchConfig> {
  const row = await withHq((trx) =>
    trx
      .selectFrom('searchConfig')
      .select(['version', 'payload'])
      .where('active', '=', true)
      .executeTakeFirst(),
  );
  if (!row)
    throw new SearchConfigError(
      'No active search config. One version must always be active — see db/migrations for the seeded v1.',
    );
  const parsed = SearchConfigPayloadSchema.safeParse(row.payload);
  if (!parsed.success)
    throw new SearchConfigError(
      `Search config v${row.version} does not match the contract: ${parsed.error.issues
        .map((i) => `${i.path.join('.')} ${i.message}`)
        .join('; ')}`,
    );
  return { version: row.version, payload: parsed.data };
}


/**
 * The viewer's own history, shaped for the ranker — §2.2.
 *
 * Read across every salon through `withClient`, which is the context
 * built for exactly this: a client reading their own appointments,
 * never a tenant reading its customers. Nothing here is another
 * client's behaviour, and nothing about it is shown to a salon.
 *
 * "Completed" uses the same predicate the Customer Insights engine
 * already uses for a visit that happened — booked or confirmed, kind
 * `appointment`, and finished before now. A cancelled or no-show visit
 * is not a preference, and neither is one that has not happened yet.
 */
export async function viewerHistory(clientUserId: string, now: Date): Promise<ViewerHistory> {
  const rows = await withClient(clientUserId, (trx) =>
    trx
      .selectFrom('appointments')
      .select(['tenantId', 'serviceId', 'date', 'startMin', 'durationMin', 'status', 'kind'])
      .where('clientUserId', '=', clientUserId)
      .where('status', 'in', ['booked', 'confirmed'])
      .where('kind', '=', 'appointment')
      .execute(),
  );

  const history: ViewerHistory = {
    services: {},
    businesses: {},
    categories: {},
    durationsByCategory: {},
    favouriteServiceIds: [],
    favouriteBusinessIds: [],
  };

  // Phase C: the seam §2.2 left open. Nothing about the scoring changes
  // — the weight, the max-not-sum rule and the absence of recency decay
  // on a favourite were all settled before favourites existed, and
  // double counting is impossible because of the first two: booked and
  // favourited scores max(1.00, 0.90), not 1.90.
  const favs = await favouriteIds(clientUserId);
  history.favouriteServiceIds = favs.services;
  history.favouriteBusinessIds = favs.businesses;

  const done = rows.filter((a) => endOf(a.date, a.startMin, a.durationMin) <= now);
  if (!done.length) return history;

  // Services are tenant-scoped, so the category of one has to be read
  // inside its own tenant's context — one pass per salon, not per visit.
  const byTenant = new Map<string, typeof done>();
  for (const a of done) {
    const list = byTenant.get(a.tenantId) ?? [];
    list.push(a);
    byTenant.set(a.tenantId, list);
  }

  for (const [tenantId, visits] of byTenant) {
    const ids = [...new Set(visits.map((v) => v.serviceId).filter((x): x is string => !!x))];
    const services = ids.length
      ? await withTenant(tenantId, (trx) =>
          trx
            .selectFrom('services')
            .select(['id', 'categoryId', 'durationMin'])
            .where('id', 'in', ids)
            .execute(),
        )
      : [];
    const catOf = new Map(services.map((x) => [x.id, x.categoryId]));

    for (const v of visits) {
      const at = endOf(v.date, v.startMin, v.durationMin).toISOString();
      keepLatest(history.businesses, tenantId, at);
      if (!v.serviceId) continue;
      keepLatest(history.services, v.serviceId, at);
      const cat = catOf.get(v.serviceId);
      if (!cat) continue;
      keepLatest(history.categories, cat, at);
      const ds = history.durationsByCategory[cat] ?? [];
      if (!ds.includes(v.durationMin)) ds.push(v.durationMin);
      history.durationsByCategory[cat] = ds;
    }
  }
  return history;
}

/** When a visit finished, in real time. */
function endOf(date: unknown, startMin: number, durationMin: number): Date {
  const iso = date instanceof Date ? date.toISOString().slice(0, 10) : String(date).slice(0, 10);
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMinutes(d.getUTCMinutes() + startMin + durationMin);
  return d;
}

/**
 * "Most chosen" — step 9 of docs/SEARCH.md, and decision 2.
 *
 * The categories the platform actually books most, over the last 90
 * days. It replaces a label that was previously decoration; Alex chose
 * to make it real rather than remove it, and a real label has to be
 * able to say nothing.
 *
 * What it counts, and what it refuses to:
 *
 *   - **Completed visits only**, by the definition `viewerHistory`
 *     already uses — booked or confirmed, a real appointment, and the
 *     end time has passed. There is no `completed` status in the
 *     lifecycle, so "finished" is inferred from the same three facts in
 *     both places rather than two ways. A cancellation or a no-show is
 *     not a choice anybody made.
 *   - **Aggregates and nothing else.** No client is read, no identity
 *     is touched and nothing new is tracked. The counts never leave the
 *     server either: what ships is an order, so no salon can read
 *     another salon's volumes out of it.
 *   - **Nothing at all below the floor.** On thin data the honest
 *     answer is silence: "most chosen" computed from nine bookings is a
 *     claim about nothing, and a decorative label is exactly what this
 *     step exists to remove.
 */
export const MOST_CHOSEN_WINDOW_DAYS = 90;
/** Fewer completed visits than this across the whole platform and the
 *  phrase means nothing. Absent, rather than misleading. */
export const MOST_CHOSEN_MIN_TOTAL = 40;
/** And a category needs its own showing before it can be called chosen,
 *  or one quiet week in one salon decides what the country sees. */
export const MOST_CHOSEN_MIN_PER_CATEGORY = 5;

export async function mostChosenCategoryIds(tenantIds: string[], now: Date): Promise<string[]> {
  if (!tenantIds.length) return [];
  const since = new Date(now);
  since.setUTCDate(since.getUTCDate() - MOST_CHOSEN_WINDOW_DAYS);

  const counts = new Map<string, number>();
  let total = 0;
  // Appointments are tenant-scoped, so this is one pass per salon. That
  // is why the result is cached rather than computed per request.
  for (const tenantId of tenantIds) {
    const visits = await withTenant(tenantId, (trx) =>
      trx
        .selectFrom('appointments')
        .select(['serviceId', 'date', 'startMin', 'durationMin'])
        .where('status', 'in', ['booked', 'confirmed'])
        .where('kind', '=', 'appointment')
        .where('serviceId', 'is not', null)
        .where('date', '>=', since)
        .execute(),
    );
    const done = visits.filter((v) => endOf(v.date, v.startMin, v.durationMin) <= now);
    if (!done.length) continue;

    const ids = [...new Set(done.map((v) => v.serviceId).filter((x): x is string => !!x))];
    const services = await withTenant(tenantId, (trx) =>
      trx.selectFrom('services').select(['id', 'categoryId']).where('id', 'in', ids).execute(),
    );
    const catOf = new Map(services.map((x) => [x.id, x.categoryId]));
    for (const v of done) {
      const cat = v.serviceId ? catOf.get(v.serviceId) : null;
      if (!cat) continue;
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
      total += 1;
    }
  }

  if (total < MOST_CHOSEN_MIN_TOTAL) return [];
  return [...counts.entries()]
    .filter(([, n]) => n >= MOST_CHOSEN_MIN_PER_CATEGORY)
    // Ties broken by id, so the same data always produces the same
    // order rather than whatever the Map happened to hold.
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id]) => id);
}

/** Only the most recent booking of each kind counts — recency decay is
 *  applied once, to the latest, not compounded over every visit. */
function keepLatest(into: Record<string, string>, key: string, at: string) {
  const had = into[key];
  if (!had || at > had) into[key] = at;
}


/**
 * What people asked for and did not find — step 10 of docs/SEARCH.md.
 *
 * Read under `app.hq`, which is the only context the table's policy
 * admits. A salon that could read this would be reading a market
 * research report about its competitors: what the country is asking for
 * and nobody is selling.
 */
const HOWS = ['salon', 'category', 'service', 'fuzzy', 'none'] as const;
type MissHow = (typeof HOWS)[number];

export async function recentSearchMisses(days: number, limit: number) {
  const rows = await withHq((trx) =>
    trx
      .selectFrom('searchMisses')
      .select(['norm', 'day', 'asked', 'results', 'how'])
      .where('day', '>=', sql<Date>`current_date - ${sql.lit(days)}::int`)
      // Worst first: asked most often, and emptiest when it was.
      .orderBy('asked', 'desc')
      .orderBy('results', 'asc')
      .orderBy('norm', 'asc')
      .limit(limit)
      .execute(),
  );
  return rows.map((r) => ({
    norm: r.norm,
    day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10),
    asked: r.asked,
    results: r.results,
    // The column is free text at the database level; the contract is an
    // enum. Anything that is not one of the five reads as "none" rather
    // than failing a whole page of otherwise good rows.
    how: HOWS.includes(r.how as MissHow) ? (r.how as MissHow) : 'none',
  }));
}

/** Every version, newest first. Read-only, and the whole history —
 *  the table is the audit trail, so hiding rows would defeat it. */
export async function listSearchConfigs(): Promise<SearchConfigVersion[]> {
  const rows = await withHq((trx) =>
    trx
      .selectFrom('searchConfig')
      .select(['version', 'payload', 'note', 'active', 'createdAt', 'activatedAt'])
      .orderBy('version', 'desc')
      .execute(),
  );
  return rows.map((r) => ({
    version: r.version,
    payload: SearchConfigPayloadSchema.parse(r.payload),
    note: r.note,
    active: r.active,
    createdAt: r.createdAt.toISOString(),
    activatedAt: r.activatedAt ? r.activatedAt.toISOString() : null,
  }));
}

/**
 * Write a new version, optionally activating it.
 *
 * Versions are never edited in place: tuning is a new row, so the
 * history stays a history. Activation deactivates the old one in the
 * same transaction, which is the only way past the partial unique index
 * — the index is what makes "the config in force" mean exactly one row
 * even if two people press the button at once.
 */
export async function createSearchConfig(
  draft: { payload: SearchConfigPayload; note: string; activate: boolean },
  actor: { id: string; name: string },
): Promise<SearchConfigVersion> {
  return withHq(async (trx) => {
    const top = await trx
      .selectFrom('searchConfig')
      .select('version')
      .orderBy('version', 'desc')
      .executeTakeFirst();
    const version = (top?.version ?? 0) + 1;
    if (draft.activate)
      await trx.updateTable('searchConfig').set({ active: false }).where('active', '=', true).execute();
    const row = await trx
      .insertInto('searchConfig')
      .values({
        version,
        payload: JSON.stringify(draft.payload),
        note: draft.note,
        active: draft.activate,
        createdBy: actor.id,
        createdByName: actor.name,
        activatedBy: draft.activate ? actor.id : null,
        activatedByName: draft.activate ? actor.name : '',
        activatedAt: draft.activate ? new Date() : null,
      })
      .returning(['version', 'payload', 'note', 'active', 'createdAt', 'activatedAt'])
      .executeTakeFirstOrThrow();
    return {
      version: row.version,
      payload: SearchConfigPayloadSchema.parse(row.payload),
      note: row.note,
      active: row.active,
      createdAt: row.createdAt.toISOString(),
      activatedAt: row.activatedAt ? row.activatedAt.toISOString() : null,
    };
  });
}

/** Put an existing version back in force. Idempotent: activating the
 *  version already active is a no-op rather than an error. */
export async function activateSearchConfig(
  version: number,
  actor: { id: string; name: string },
): Promise<SearchConfigVersion> {
  return withHq(async (trx) => {
    const target = await trx
      .selectFrom('searchConfig')
      .selectAll()
      .where('version', '=', version)
      .executeTakeFirst();
    if (!target) throw new SearchConfigError(`No search config v${version}`);
    if (!target.active) {
      await trx.updateTable('searchConfig').set({ active: false }).where('active', '=', true).execute();
      await trx
        .updateTable('searchConfig')
        .set({
          active: true,
          activatedBy: actor.id,
          activatedByName: actor.name,
          activatedAt: new Date(),
        })
        .where('version', '=', version)
        .execute();
    }
    const row = await trx
      .selectFrom('searchConfig')
      .select(['version', 'payload', 'note', 'active', 'createdAt', 'activatedAt'])
      .where('version', '=', version)
      .executeTakeFirstOrThrow();
    return {
      version: row.version,
      payload: SearchConfigPayloadSchema.parse(row.payload),
      note: row.note,
      active: row.active,
      createdAt: row.createdAt.toISOString(),
      activatedAt: row.activatedAt ? row.activatedAt.toISOString() : null,
    };
  });
}

/**
 * The dry run: what a draft would do to one category's order.
 *
 * Ranks the same candidates the real door ranks — anything else would
 * tell whoever is tuning the weights a comfortable lie. Personalisation
 * is deliberately absent: a diff has to be reproducible, and "how it
 * looks to one particular person's history" is not.
 */
export async function previewRanking(
  what: { categoryId: string | null; q: string | null },
  draft: SearchConfigPayload,
  at: { lat: number | null; lng: number | null },
): Promise<SearchPreview | null> {
  const active = await activeSearchConfig();
  const position = at.lat != null && at.lng != null ? { lat: at.lat, lng: at.lng } : null;
  const viewer = { position, history: null };

  let label: string;
  let candidates: RankCandidate[];
  let interpretation: SearchPreview['interpretation'] = null;

  if (what.q) {
    // Step 11: the text entrance, through the door's own candidate
    // builder. A lab that built candidates a second way would be
    // explaining a search nobody performs.
    const t = await textCandidates(what.q.trim());
    const gathered = withTextRelevance(t.byCategory, t.matches);
    // Admission is the same function the door applies, with no filters
    // set — so the gap between gathered and admitted here is purely
    // what the ranker's own rules removed.
    candidates = applyFilters(
      gathered,
      { radiusKm: null, priceBand: null, categoryId: null },
      position,
      null,
    ).admitted;
    label = what.q;
    interpretation = {
      normalized: await normalizedForm(what.q),
      how: t.read.how,
      ambiguous: t.read.ambiguous,
      directSalon: t.read.directSalon?.name ?? null,
      matches: t.matches
        .slice()
        .sort((a, b) => b.score - a.score)
        .slice(0, 20)
        .map((m) => ({ kind: m.kind, display: m.display, how: m.how, score: m.score })),
      categories: t.facetCategories.map((c) => c.name),
      gathered: gathered.length,
      admitted: candidates.length,
    };
  } else {
    const found = await gatherCategory(what.categoryId!);
    if (!found) return null;
    candidates = candidatesOf(found.category.id, found.services, found.meta);
    label = found.category.name;
  }

  const before = rank(candidates, viewer, active.payload).map((r) => r.candidate.id);
  const after = rank(candidates, viewer, draft);
  const wasAt = new Map(before.map((id, i) => [id, i]));

  const rows = after.map((r, i) => {
    const was = wasAt.get(r.candidate.id) ?? i;
    return {
      id: r.candidate.id,
      name: r.candidate.name,
      salon: r.candidate.salon.name,
      was,
      now: i,
      moved: i - was,
      score: r.score,
      components: r.components,
    };
  });
  return {
    category: label,
    activeVersion: active.version,
    rows,
    moved: rows.filter((r) => r.moved !== 0).length,
    interpretation,
  };
}

/**
 * What `search_norm` makes of a query.
 *
 * Asked of the database rather than reimplemented, for the same reason
 * everything else here is: one implementation of "what does this text
 * become", or the lab would eventually explain a normalization the
 * index does not use.
 */
async function normalizedForm(q: string): Promise<string> {
  const r = await withHq((trx) => sql<{ n: string }>`select search_norm(${q}) as n`.execute(trx));
  return r.rows[0]?.n ?? '';
}
