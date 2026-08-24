import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AccessClaims, MeResponse, SessionEmployee } from '@velnes/contracts';
import argon2 from 'argon2';
import { sql } from 'kysely';
import { db, withTenant } from '../../db/index.js';
import type { EmployeeAccess, EmployeeStatus } from '../../db/types.js';
import { env } from '../../env.js';
import { logAudit } from '../audit/audit.service.js';
import { permsFor } from './authz.service.js';

export class AuthError extends Error {
  constructor(public code: 'INVALID_CREDENTIALS' | 'NOT_ACTIVE' | 'INVALID_TOKEN') {
    super(code);
  }
}

interface AuthLookupRow {
  employeeId: string;
  tenantId: string;
  name: string;
  access: EmployeeAccess;
  roleId: string | null;
  status: EmployeeStatus;
  passwordHash: string;
}

/** The login lookup: the one deliberate door through tenant
 *  isolation, unlocked only inside this transaction via the
 *  auth_login_lookup policies. */
async function authLookup(email: string): Promise<AuthLookupRow | undefined> {
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.auth', 'login', true)`.execute(trx);
    return trx
      .selectFrom('employees as e')
      .innerJoin('userCredentials as c', 'c.employeeId', 'e.id')
      .select([
        'e.id as employeeId',
        'e.tenantId',
        'e.name',
        'e.access',
        'e.roleId',
        'e.status',
        'c.passwordHash',
      ])
      .where(sql<boolean>`lower(e.email) = lower(${email})`)
      .executeTakeFirst();
  });
}

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

async function issueRefreshToken(tenantId: string, employeeId: string, familyId?: string) {
  const token = randomBytes(32).toString('base64url');
  await db
    .insertInto('refreshTokens')
    .values({
      tenantId,
      employeeId,
      tokenHash: hashToken(token),
      familyId: familyId ?? randomUUID(),
      expiresAt: new Date(Date.now() + env.refreshTtlDays * 24 * 3600 * 1000),
    })
    .execute();
  return token;
}

async function revokeFamily(familyId: string) {
  await db
    .updateTable('refreshTokens')
    .set({ revokedAt: new Date() })
    .where('familyId', '=', familyId)
    .where('revokedAt', 'is', null)
    .execute();
}

async function sessionEmployee(
  tenantId: string,
  employeeId: string,
): Promise<MeResponse> {
  return withTenant(tenantId, async (trx) => {
    const e = await trx
      .selectFrom('employees')
      .select(['id', 'name', 'email', 'access', 'roleId', 'lang'])
      .where('id', '=', employeeId)
      .executeTakeFirstOrThrow();
    const locs = await trx
      .selectFrom('employeeLocations')
      .select('locationId')
      .where('employeeId', '=', employeeId)
      .execute();
    const perms = await permsFor(trx, {
      sub: e.id,
      ten: tenantId,
      acc: e.access,
      rol: e.roleId,
      locs: [],
    });
    return {
      id: e.id,
      name: e.name,
      email: e.email,
      access: e.access,
      roleId: e.roleId,
      lang: e.lang as 'en' | 'mk' | 'sq',
      tenantId,
      locationIds: locs.map((l) => l.locationId),
      perms,
    };
  });
}

export function claimsFor(e: SessionEmployee & { tenantId: string }): AccessClaims {
  return { sub: e.id, ten: e.tenantId, acc: e.access, rol: e.roleId, locs: e.locationIds };
}

/** The login door. */
export async function login(email: string, password: string) {
  const row = await authLookup(email);
  // Always burn a hash verification so unknown emails take as long
  // as wrong passwords.
  const hash =
    row?.passwordHash ??
    '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const ok = await argon2.verify(hash, password).catch(() => false);
  if (!row || !ok) throw new AuthError('INVALID_CREDENTIALS');
  if (row.status !== 'active') throw new AuthError('NOT_ACTIVE');

  const employee = await sessionEmployee(row.tenantId, row.employeeId);
  const refreshToken = await issueRefreshToken(row.tenantId, row.employeeId);
  await withTenant(row.tenantId, (trx) =>
    logAudit(trx, row.tenantId, {
      actorEmployeeId: row.employeeId,
      actorName: row.name,
      action: 'Signed in',
      object: `User · ${row.name}`,
    }),
  );
  return { employee, refreshToken };
}

/** Rotate a refresh token. Reuse of an already-rotated token is
 *  treated as theft: the whole family is revoked. */
export async function rotateRefreshToken(token: string) {
  const row = await db
    .selectFrom('refreshTokens')
    .selectAll()
    .where('tokenHash', '=', hashToken(token))
    .executeTakeFirst();
  if (!row) throw new AuthError('INVALID_TOKEN');
  if (row.revokedAt) throw new AuthError('INVALID_TOKEN');
  if (row.rotatedAt) {
    await revokeFamily(row.familyId);
    throw new AuthError('INVALID_TOKEN');
  }
  if (row.expiresAt.getTime() < Date.now()) throw new AuthError('INVALID_TOKEN');

  await db
    .updateTable('refreshTokens')
    .set({ rotatedAt: new Date() })
    .where('id', '=', row.id)
    .execute();
  const next = await issueRefreshToken(row.tenantId, row.employeeId, row.familyId);
  const employee = await sessionEmployee(row.tenantId, row.employeeId);
  return { employee, refreshToken: next };
}

export async function logout(token: string) {
  const row = await db
    .selectFrom('refreshTokens')
    .select(['familyId'])
    .where('tokenHash', '=', hashToken(token))
    .executeTakeFirst();
  if (row) await revokeFamily(row.familyId);
}

export async function me(claims: AccessClaims) {
  return sessionEmployee(claims.ten, claims.sub);
}

export async function setLang(claims: AccessClaims, lang: 'en' | 'mk' | 'sq') {
  // Commit the write before re-reading: sessionEmployee opens its own
  // transaction and would not see an uncommitted update.
  await withTenant(claims.ten, (trx) =>
    trx.updateTable('employees').set({ lang }).where('id', '=', claims.sub).execute(),
  );
  return sessionEmployee(claims.ten, claims.sub);
}
