import type { HqRole } from '@velnes/contracts';
import argon2 from 'argon2';
import { sql } from 'kysely';
import { db, withHq } from '../../db/index.js';
import { AuthError } from '../auth/auth.service.js';

/** HQ principals are their own kind: separate table, separate token
 *  shape. The login lookup reuses the explicit app.auth mode. */
export async function hqLogin(email: string, password: string) {
  const row = await db.transaction().execute(async (trx) => {
    await sql`select set_config('app.auth', 'login', true)`.execute(trx);
    return trx
      .selectFrom('hqUsers')
      .selectAll()
      .where(sql<boolean>`lower(email) = lower(${email})`)
      .executeTakeFirst();
  });
  const hash =
    row?.passwordHash ??
    '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const ok = await argon2.verify(hash, password).catch(() => false);
  if (!row || !ok) throw new AuthError('INVALID_CREDENTIALS');
  if (row.status !== 'active') throw new AuthError('NOT_ACTIVE');
  return { id: row.id, name: row.name, email: row.email, role: row.role as HqRole };
}

export async function hqUserById(id: string) {
  const row = await withHq((trx) =>
    trx
      .selectFrom('hqUsers')
      .select(['id', 'name', 'email', 'role'])
      .where('id', '=', id)
      .executeTakeFirst(),
  );
  return row ? { ...row, role: row.role as HqRole } : undefined;
}

/** Which HQ roles may decide intake reviews. */
export const canReview = (role: HqRole) => role === 'hq_super' || role === 'hq_onboard';
