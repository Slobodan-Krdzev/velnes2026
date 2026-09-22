import { randomUUID } from 'node:crypto';
import { STANDARD_ROLES, type PermMap } from '@velnes/contracts';
import type { Trx } from '../../db/index.js';

/**
 * The two roles every tenant starts with — Owner and a basic Employee
 * (`STANDARD_ROLES` in @velnes/contracts). One writer, so registration
 * approval, HQ's create-business door and the seeds cannot drift.
 * Runs inside the caller's tenant transaction.
 */
export async function standardRoles(
  trx: Trx,
  tenantId: string,
): Promise<{ ownerRoleId: string; employeeRoleId: string }> {
  const ids = { ownerRoleId: randomUUID(), employeeRoleId: randomUUID() };
  for (const [id, kit] of [
    [ids.ownerRoleId, STANDARD_ROLES.owner],
    [ids.employeeRoleId, STANDARD_ROLES.employee],
  ] as const)
    await trx
      .insertInto('roles')
      .values({
        id,
        tenantId,
        name: kit.name,
        std: true,
        locked: kit.locked,
        description: kit.description,
        perms: JSON.stringify(kit.perms() as PermMap),
      })
      .execute();
  return ids;
}

/**
 * The tenant's standard Employee role — what a new team member gets
 * when nobody picked a role for them. Null only for a tenant born
 * before the kit existed and not yet repaired by the migration.
 */
export async function employeeRoleId(trx: Trx): Promise<string | null> {
  const r = await trx
    .selectFrom('roles')
    .select('id')
    .where('std', '=', true)
    .where('name', '=', STANDARD_ROLES.employee.name)
    .executeTakeFirst();
  return r?.id ?? null;
}
