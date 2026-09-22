import type { AccessClaims, Employee, EmployeeInvite, EmployeePatch } from '@velnes/contracts';
import { sql } from 'kysely';
import type { Trx } from '../../db/index.js';
import { logAudit } from '../audit/audit.service.js';
import { queueMail } from '../mail/mail.service.js';
import { mintSignInLink } from '../auth/sign-in-link.service.js';
import { employeeRoleId } from './role-kits.js';

/**
 * The team doors — the create/update-employee logic, lifted verbatim out
 * of team.routes so both the HTTP route and the AI Assistant call ONE
 * service (the one-door rule). The routes keep the permission check and
 * map these errors to HTTP codes; behaviour is unchanged (the team/roles
 * suites are the parity net).
 */

export class TeamError extends Error {
  constructor(
    public code: 'NOT_FOUND' | 'LAST_OWNER' | 'REFUSED_STATE',
    message: string,
  ) {
    super(message);
  }
}

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
type Week = Record<string, [string, string][] | null> | null;

/** The prototype's whProblem + whSort: every period runs forward and none
 *  overlap. Returns the sorted week, or the refusal naming the weekday.
 *  Bookable people need at least one skill and one working day. */
export function checkEmployeeState(
  hours: Week,
  skills: string[],
  bookable: boolean,
): { hours: Week; error?: string } {
  let sorted: Week = null;
  if (hours) {
    sorted = {};
    for (let i = 0; i < 7; i++) {
      const list = hours[String(i)] ?? null;
      if (!list || !list.length) {
        sorted[String(i)] = null;
        continue;
      }
      for (const [a, b] of list) {
        if (!a || !b) return { hours, error: `${WEEK[i]}: Fill in both times of every period` };
        if (mins(b) <= mins(a)) return { hours, error: `${WEEK[i]}: ${a}–${b} ends before it starts` };
      }
      const st = [...list].sort((x, y) => mins(x[0]) - mins(y[0]));
      for (let j = 1; j < st.length; j++)
        if (mins(st[j]![0]) < mins(st[j - 1]![1]))
          return {
            hours,
            error: `${WEEK[i]}: ${st[j - 1]![0]}–${st[j - 1]![1]} and ${st[j]![0]}–${st[j]![1]} overlap`,
          };
      sorted[String(i)] = st;
    }
  }
  if (bookable && !skills.length)
    return { hours: sorted ?? hours, error: 'Pick at least one service, or switch off bookable' };
  const week = sorted ?? hours;
  if (bookable && (!week || !Object.values(week).some(Boolean)))
    return { hours: week, error: 'Set at least one working day, or switch off bookable' };
  return { hours: sorted ?? hours };
}

/** The Employee contract shape for one employee, including live lastActive. */
export async function employeeRow(trx: Trx, id: string): Promise<Employee> {
  const e = await trx.selectFrom('employees').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const locs = await trx
    .selectFrom('employeeLocations')
    .select('locationId')
    .where('employeeId', '=', e.id)
    .execute();
  const skills = await trx
    .selectFrom('employeeSkills')
    .select('serviceId')
    .where('employeeId', '=', e.id)
    .execute();
  return {
    id: e.id,
    name: e.name,
    roleTitle: e.roleTitle,
    email: e.email,
    phone: e.phone,
    access: e.access,
    roleId: e.roleId,
    bookable: e.bookable,
    status: e.status,
    color: e.color,
    locationIds: locs.map((l) => l.locationId),
    skillServiceIds: skills.map((s) => s.serviceId),
    hours: (e.hours ?? null) as Employee['hours'],
    twofaEnabled: e.twofaEnabled,
    avatar: e.avatar ?? null,
    lastActive:
      (
        await trx
          .selectFrom('refreshTokens')
          .select(sql<Date>`max(greatest(created_at, coalesce(rotated_at, created_at)))`.as('last'))
          .where('employeeId', '=', e.id)
          .executeTakeFirst()
      )?.last?.toISOString() ?? null,
  };
}

async function actorName(trx: Trx, id: string): Promise<string> {
  const a = await trx.selectFrom('employees').select('name').where('id', '=', id).executeTakeFirst();
  return a?.name ?? '';
}
async function roleName(trx: Trx, id: string | null): Promise<string> {
  if (!id) return '—';
  return (await trx.selectFrom('roles').select('name').where('id', '=', id).executeTakeFirst())?.name ?? '—';
}

/** Invite a new team member. Invited + no credentials until acceptance
 *  (an SMTP-era feature); the invite goes through the outbox. */
export async function createEmployee(trx: Trx, claims: AccessClaims, b: EmployeeInvite): Promise<Employee> {
  const checked = checkEmployeeState(b.hours ?? null, b.skillServiceIds ?? [], b.bookable);
  if (checked.error) throw new TeamError('REFUSED_STATE', checked.error);

  let color = b.color ?? null;
  if (!color) {
    const taken = (await trx.selectFrom('employees').select('color').execute()).map((e) => e.color);
    color = ['olive', 'clay', 'rose', 'sage', 'lilac', 'sky', 'sand', 'stone'].find((c) => !taken.includes(c)) ?? 'stone';
  }
  const locationIds =
    b.locationIds ?? (await trx.selectFrom('locations').select('id').execute()).map((l) => l.id);

  // Nobody joins with no rights at all: an invite that names no role
  // gets the standard Employee kit — book, take payments, ask support.
  const roleId = b.roleId ?? (await employeeRoleId(trx));
  const row = await trx
    .insertInto('employees')
    .values({
      tenantId: claims.ten,
      name: b.name,
      email: b.email,
      roleId,
      roleTitle: b.roleTitle ?? 'New user',
      access: b.access ?? 'staff',
      bookable: b.bookable,
      status: 'invited',
      twofaEnabled: b.twofa,
      color,
      phone: b.phone ?? null,
      avatar: b.avatar ?? null,
      ...(checked.hours ? { hours: JSON.stringify(checked.hours) } : {}),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  for (const lid of locationIds)
    await trx.insertInto('employeeLocations').values({ tenantId: claims.ten, employeeId: row.id, locationId: lid }).execute();
  for (const sid of b.skillServiceIds ?? [])
    await trx.insertInto('employeeSkills').values({ tenantId: claims.ten, employeeId: row.id, serviceId: sid }).execute();

  const role = roleId ? await roleName(trx, roleId) : '—';
  await logAudit(trx, claims.ten, {
    actorEmployeeId: claims.sub,
    actorName: await actorName(trx, claims.sub),
    action: 'User invited',
    object: `User · ${b.name}`,
    before: '—',
    after: role,
  });
  const link = await mintSignInLink(trx, claims.ten, row.id, claims.sub);
  await queueMail(trx, {
    tenantId: claims.ten,
    to: b.email,
    subject: 'You are invited to Velnes',
    body: `${(await actorName(trx, claims.sub)) || 'Your salon'} invited you as ${role !== '—' ? role : 'a team member'}. Open this link on your phone to sign in: ${link.url} — it works once and is valid for 7 days.`,
    kind: 'employee_invite',
    refId: row.id,
  });
  return employeeRow(trx, row.id);
}

/** Update a team member. Refuses the last-owner demotion and bad weeks;
 *  audits a role change. Replaces locations/skills wholesale when given. */
export async function updateEmployee(
  trx: Trx,
  claims: AccessClaims,
  id: string,
  patch: EmployeePatch,
): Promise<Employee> {
  const before = await trx.selectFrom('employees').selectAll().where('id', '=', id).executeTakeFirst();
  if (!before) throw new TeamError('NOT_FOUND', 'Unknown employee');

  // The last-owner safeguard: a salon always needs one owner.
  if (patch.access !== undefined && patch.access !== 'owner' && before.access === 'owner') {
    const owners = await trx
      .selectFrom('employees')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('access', '=', 'owner')
      .where('status', '=', 'active')
      .executeTakeFirstOrThrow();
    if (owners.n <= 1) throw new TeamError('LAST_OWNER', 'Make someone else owner first — a salon needs one');
  }

  const nextSkills =
    patch.skillServiceIds ??
    (await trx.selectFrom('employeeSkills').select('serviceId').where('employeeId', '=', id).execute()).map(
      (s) => s.serviceId,
    );
  const nextHours = patch.hours !== undefined ? patch.hours : ((before.hours ?? null) as Week);
  const nextBookable = patch.bookable ?? before.bookable;
  const checked = checkEmployeeState(nextHours, nextSkills, nextBookable);
  if (checked.error) throw new TeamError('REFUSED_STATE', checked.error);
  const hoursToWrite = patch.hours !== undefined ? (checked.hours ?? patch.hours) : undefined;

  await trx
    .updateTable('employees')
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.email !== undefined ? { email: patch.email } : {}),
      ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
      ...(patch.bookable !== undefined ? { bookable: patch.bookable } : {}),
      ...(patch.color !== undefined ? { color: patch.color } : {}),
      ...(patch.access !== undefined ? { access: patch.access } : {}),
      ...(patch.roleId !== undefined ? { roleId: patch.roleId } : {}),
      ...(patch.roleTitle !== undefined ? { roleTitle: patch.roleTitle } : {}),
      ...(patch.avatar !== undefined ? { avatar: patch.avatar } : {}),
      ...(hoursToWrite !== undefined ? { hours: JSON.stringify(hoursToWrite) } : {}),
    })
    .where('id', '=', id)
    .execute();

  if (patch.locationIds !== undefined) {
    await trx.deleteFrom('employeeLocations').where('employeeId', '=', id).execute();
    for (const lid of patch.locationIds)
      await trx.insertInto('employeeLocations').values({ tenantId: claims.ten, employeeId: id, locationId: lid }).execute();
  }
  if (patch.skillServiceIds !== undefined) {
    await trx.deleteFrom('employeeSkills').where('employeeId', '=', id).execute();
    for (const sid of patch.skillServiceIds)
      await trx.insertInto('employeeSkills').values({ tenantId: claims.ten, employeeId: id, serviceId: sid }).execute();
  }
  if (patch.roleId !== undefined && patch.roleId !== before.roleId) {
    await logAudit(trx, claims.ten, {
      actorEmployeeId: claims.sub,
      actorName: await actorName(trx, claims.sub),
      action: 'Role changed',
      object: `User · ${before.name}`,
      before: await roleName(trx, before.roleId),
      after: await roleName(trx, patch.roleId),
    });
  }
  return employeeRow(trx, id);
}
