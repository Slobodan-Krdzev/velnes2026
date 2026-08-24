import type { AccessClaims, PermKey, PermMap, Scope } from '@velnes/contracts';
import { PermMapSchema } from '@velnes/contracts';
import type { Trx } from '../../db/index.js';

/**
 * The authorization door: one scopeOf/can pair, mirroring the
 * prototype. Scopes come from the employee's role permission map,
 * validated against the shared contract on the way out of the db.
 */
export async function permsFor(trx: Trx, claims: AccessClaims): Promise<PermMap> {
  if (!claims.rol) return {};
  const role = await trx
    .selectFrom('roles')
    .select('perms')
    .where('id', '=', claims.rol)
    .executeTakeFirst();
  if (!role) return {};
  const parsed = PermMapSchema.safeParse(role.perms);
  return parsed.success ? parsed.data : {};
}

export function scopeOf(perms: PermMap, key: PermKey): Scope {
  return perms[key] ?? 'none';
}

export function can(perms: PermMap, key: PermKey): boolean {
  return scopeOf(perms, key) !== 'none';
}
