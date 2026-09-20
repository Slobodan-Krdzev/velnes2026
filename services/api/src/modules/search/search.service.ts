import { SearchConfigPayloadSchema, type SearchConfigPayload } from '@velnes/contracts';
import { withHq } from '../../db/index.js';

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
