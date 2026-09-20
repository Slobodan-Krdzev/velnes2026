import { SearchConfigPayloadSchema, type SearchConfigPayload } from '@velnes/contracts';
import { withClient, withHq, withTenant } from '../../db/index.js';
import type { ViewerHistory } from './rank.js';

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
    // Favourites are not persisted yet (Phase C). Empty rather than
    // absent, so the ranker needs no special case the day they land.
    favouriteServiceIds: [],
    favouriteBusinessIds: [],
  };

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

/** Only the most recent booking of each kind counts — recency decay is
 *  applied once, to the latest, not compounded over every visit. */
function keepLatest(into: Record<string, string>, key: string, at: string) {
  const had = into[key];
  if (!had || at > had) into[key] = at;
}
