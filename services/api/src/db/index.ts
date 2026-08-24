import { CamelCasePlugin, Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import pg from 'pg';
import { env } from '../env.js';
import type { DB } from './types.js';

const pool = new pg.Pool({ connectionString: env.apiDatabaseUrl, max: 10 });

/**
 * The API's only database handle. Connects as the restricted
 * `velnes_api` role: without tenant context, tenant tables yield
 * nothing. All tenant work goes through withTenant().
 */
export const db = new Kysely<DB>({
  dialect: new PostgresDialect({ pool }),
  // maintainNestedObjectKeys: jsonb payloads (role perm maps, hours)
  // keep their own key spelling — only column names are camelized.
  plugins: [new CamelCasePlugin({ maintainNestedObjectKeys: true })],
});

export type Trx = Transaction<DB>;

/**
 * The tenant-context door: one transaction, `app.tenant_id` set
 * locally inside it, handed to the callback. RLS policies compare
 * against this value; there is no other way tenant data is reached.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (trx: Trx) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(trx);
    return fn(trx);
  });
}

export async function closeDb() {
  await db.destroy();
}
