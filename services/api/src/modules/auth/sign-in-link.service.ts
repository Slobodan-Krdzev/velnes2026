import { createHash, randomBytes } from 'node:crypto';
import { SIGN_IN_LINK_DAYS, type AccessClaims } from '@velnes/contracts';
import argon2 from 'argon2';
import { sql } from 'kysely';
import { db, withTenant, type Trx } from '../../db/index.js';
import { env } from '../../env.js';
import { logAudit } from '../audit/audit.service.js';
import { AuthError, issueRefreshToken, sessionEmployee } from './auth.service.js';

/**
 * Personal sign-in links for the employee app — Alex, 2026-09-23.
 *
 * The problem they solve: an invited employee has no password and no
 * door to get one. The owner mints a link for a team member in
 * Settings › Team (it also rides in the invite mail); opening it on
 * the phone signs that one person into their own salon — the tenant
 * is the link's, never chosen — activates them, and asks for a
 * password once so "tap your name" works from then on.
 *
 * Only a sha256 of the token is stored. A link is single-use and
 * expires after `SIGN_IN_LINK_DAYS`; minting again revokes the old one.
 */

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

/** Mint a link for an employee inside the tenant's own transaction.
 *  Any earlier unused link for them stops working. */
export async function mintSignInLink(trx: Trx, tenantId: string, employeeId: string, createdBy: string | null) {
  await trx
    .updateTable('employeeSignInLinks')
    .set({ revokedAt: new Date() })
    .where('employeeId', '=', employeeId)
    .where('usedAt', 'is', null)
    .where('revokedAt', 'is', null)
    .execute();
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SIGN_IN_LINK_DAYS * 86_400_000);
  await trx
    .insertInto('employeeSignInLinks')
    .values({ tenantId, employeeId, tokenHash: hashToken(token), createdBy, expiresAt })
    .execute();
  return { url: `${env.employeeAppUrl}/join/${token}`, expiresAt };
}

/** The owner's door: mint for a team member, audited. */
export async function createSignInLink(trx: Trx, claims: AccessClaims, employeeId: string) {
  const target = await trx.selectFrom('employees').select(['id', 'name']).where('id', '=', employeeId).executeTakeFirst();
  if (!target) return null;
  const actor = await trx.selectFrom('employees').select('name').where('id', '=', claims.sub).executeTakeFirst();
  const link = await mintSignInLink(trx, claims.ten, employeeId, claims.sub);
  await logAudit(trx, claims.ten, {
    actorEmployeeId: claims.sub,
    actorName: actor?.name ?? '',
    action: 'Sign-in link created',
    object: `User · ${target.name}`,
  });
  return { employeeId, url: link.url, expiresAt: link.expiresAt.toISOString() };
}

/**
 * Redeem a link: the pre-tenant lookup runs under login mode (the same
 * narrow door email login uses), the writes under the link's own tenant.
 * Returns everything a login returns, plus whether a password is still
 * to be chosen and the salon's name for the welcome screen.
 */
export async function redeemSignInLink(token: string) {
  const row = await db.transaction().execute(async (trx) => {
    await sql`select set_config('app.auth', 'login', true)`.execute(trx);
    return trx
      .selectFrom('employeeSignInLinks as l')
      .innerJoin('employees as e', 'e.id', 'l.employeeId')
      .select(['l.id', 'l.tenantId', 'l.employeeId', 'l.expiresAt', 'l.usedAt', 'l.revokedAt', 'e.name', 'e.status'])
      .where('l.tokenHash', '=', hashToken(token))
      .executeTakeFirst();
  });
  if (!row || row.usedAt || row.revokedAt) throw new AuthError('INVALID_LINK');
  if (row.expiresAt.getTime() < Date.now()) throw new AuthError('LINK_EXPIRED');

  const { needsPassword, salonName } = await withTenant(row.tenantId, async (trx) => {
    await trx.updateTable('employeeSignInLinks').set({ usedAt: new Date() }).where('id', '=', row.id).execute();
    if (row.status !== 'active')
      await trx.updateTable('employees').set({ status: 'active' }).where('id', '=', row.employeeId).execute();
    const cred = await trx.selectFrom('userCredentials').select('employeeId').where('employeeId', '=', row.employeeId).executeTakeFirst();
    const biz = await trx.selectFrom('businesses').select('name').where('id', '=', row.tenantId).executeTakeFirst();
    await logAudit(trx, row.tenantId, {
      actorEmployeeId: row.employeeId,
      actorName: row.name,
      action: 'Signed in with a sign-in link',
      object: `User · ${row.name}`,
    });
    return { needsPassword: !cred, salonName: biz?.name ?? '' };
  });
  const employee = await sessionEmployee(row.tenantId, row.employeeId);
  const refreshToken = await issueRefreshToken(row.tenantId, row.employeeId);
  return { employee, refreshToken, needsPassword, salonName };
}

/**
 * Set the signed-in person's own password. The first time (no
 * credential yet — the link brought them in) no current password is
 * asked; after that the current one must verify.
 */
export async function setOwnPassword(claims: AccessClaims, password: string, current: string | undefined) {
  return withTenant(claims.ten, async (trx) => {
    const cred = await trx.selectFrom('userCredentials').select('passwordHash').where('employeeId', '=', claims.sub).executeTakeFirst();
    if (cred) {
      const ok = current ? await argon2.verify(cred.passwordHash, current).catch(() => false) : false;
      if (!ok) throw new AuthError('INVALID_CREDENTIALS');
    }
    const passwordHash = await argon2.hash(password);
    if (cred)
      await trx.updateTable('userCredentials').set({ passwordHash, updatedAt: new Date() }).where('employeeId', '=', claims.sub).execute();
    else await trx.insertInto('userCredentials').values({ employeeId: claims.sub, tenantId: claims.ten, passwordHash }).execute();
    const me = await trx.selectFrom('employees').select('name').where('id', '=', claims.sub).executeTakeFirst();
    await logAudit(trx, claims.ten, {
      actorEmployeeId: claims.sub,
      actorName: me?.name ?? '',
      action: cred ? 'Password changed' : 'Password set',
      object: `User · ${me?.name ?? ''}`,
    });
  });
}
