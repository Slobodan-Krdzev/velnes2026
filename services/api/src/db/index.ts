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

/**
 * The HQ-context door: platform rows (hq_users, registrations) and
 * read-only cross-tenant views open under `app.hq = '1'` — the same
 * explicit-mode pattern as app.auth and app.public. Writes into a
 * tenant's world still go through withTenant, never through here.
 */
export async function withHq<T>(fn: (trx: Trx) => Promise<T>): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.hq', '1', true)`.execute(trx);
    return fn(trx);
  });
}

/**
 * The supplier-context door: the portal's people read and progress
 * their own orders and connections under `app.supplier_id` — never a
 * tenant context.
 */
export async function withSupplier<T>(supplierId: string, fn: (trx: Trx) => Promise<T>): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.supplier_id', ${supplierId}, true)`.execute(trx);
    return fn(trx);
  });
}

/**
 * The client-context door: a signed-in consumer reads and edits their
 * own account, their links, their notifications and their appointments
 * across every salon — never a tenant context, so they can never see a
 * salon's other customers.
 */
export async function withClient<T>(clientUserId: string, fn: (trx: Trx) => Promise<T>): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.client_id', ${clientUserId}, true)`.execute(trx);
    return fn(trx);
  });
}

/**
 * The narrow pre-session door for the consumer app: register, verify
 * an email code, log in. Nothing but `client_users` answers here.
 */
export async function withClientAuth<T>(fn: (trx: Trx) => Promise<T>): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.auth', 'client_login', true)`.execute(trx);
    return fn(trx);
  });
}

export async function closeDb() {
  await db.destroy();
}
