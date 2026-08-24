import type {
  AccessClaims,
  Location,
  LocationLifecycle,
  ReadinessResponse,
} from '@velnes/contracts';
import { LOC_EDGES } from '@velnes/contracts';
import { sql } from 'kysely';
import type { Trx } from '../../db/index.js';
import type { Locations } from '../../db/types.js';
import type { Selectable } from 'kysely';
import { logAudit } from '../audit/audit.service.js';

export class LocationError extends Error {
  constructor(
    public code: 'NOT_FOUND' | 'ILLEGAL_TRANSITION' | 'NOT_READY' | 'OWNER_ONLY',
    message: string,
  ) {
    super(message);
  }
}

type LocationRow = Selectable<Locations>;

function toContract(l: LocationRow): Location {
  return {
    id: l.id,
    name: l.name,
    city: l.city,
    address: l.address,
    tz: l.tz,
    phone: l.phone,
    rooms: l.rooms,
    invPrefix: l.invPrefix,
    online: l.online,
    cancelHours: l.cancelHours,
    opened: l.opened ? l.opened.toISOString().slice(0, 10) : null,
    lifecycle: l.lifecycle,
  };
}

export async function listLocations(trx: Trx): Promise<Location[]> {
  const rows = await trx.selectFrom('locations').selectAll().orderBy('name').execute();
  return rows.map(toContract);
}

/** The liveness predicate: every customer surface asks this, nothing
 *  else. Only ACTIVE locations exist to the outside world. */
export async function locLive(trx: Trx, id: string): Promise<boolean> {
  const l = await trx
    .selectFrom('locations')
    .select('lifecycle')
    .where('id', '=', id)
    .executeTakeFirst();
  return l?.lifecycle === 'ACTIVE';
}

/**
 * The readiness gate: five hard requirements, cosmetics never block.
 * A service is bookable at a location when its resolved config is
 * active AND online (override row, else the master item).
 */
export async function locReadiness(trx: Trx, id: string): Promise<ReadinessResponse> {
  const l = await trx
    .selectFrom('locations')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!l) throw new LocationError('NOT_FOUND', 'Unknown location');

  const legal = await trx
    .selectFrom('legalEntityLocations')
    .innerJoin('legalEntities', 'legalEntities.id', 'legalEntityLocations.legalEntityId')
    .select('legalEntities.status')
    .where('legalEntityLocations.locationId', '=', id)
    .where('legalEntities.status', '=', 'verified')
    .executeTakeFirst();

  const bookableAt = (trx2: Trx) =>
    trx2
      .selectFrom('services as s')
      .leftJoin('locationCatalogServices as lcs', (join) =>
        join.onRef('lcs.serviceId', '=', 's.id').on('lcs.locationId', '=', id),
      )
      .select('s.id')
      .where(
        sql<boolean>`coalesce(lcs.active, s.status = 'active') and coalesce(lcs.online, s.online)`,
      );

  const svcOk = await bookableAt(trx).limit(1).executeTakeFirst();

  const staffOk = await trx
    .selectFrom('employees as e')
    .innerJoin('employeeLocations as el', 'el.employeeId', 'e.id')
    .innerJoin('employeeSkills as sk', 'sk.employeeId', 'e.id')
    .select('e.id')
    .where('el.locationId', '=', id)
    .where('e.bookable', '=', true)
    .where('e.status', '=', 'active')
    .where('sk.serviceId', 'in', bookableAt(trx))
    .limit(1)
    .executeTakeFirst();

  const items = [
    { k: 'legal' as const, label: 'Verified legal entity attached', ok: !!legal },
    {
      k: 'address' as const,
      label: 'Location details complete',
      ok: !!(l.name && l.address && l.city),
    },
    { k: 'hours' as const, label: 'Working hours set', ok: l.hours != null },
    {
      k: 'service' as const,
      label: 'At least one active, online-bookable service',
      ok: !!svcOk,
    },
    {
      k: 'staff' as const,
      label: 'Staff assigned who can deliver a bookable service',
      ok: !!staffOk,
    },
  ];
  return { items, ok: items.every((i) => i.ok) };
}

/**
 * The one lifecycle writer — the prototype's locTransition verbatim:
 * legal edges only, readiness gate on APPROVED→ACTIVE, owner-only
 * activation, lifecycle log + audit in the same transaction.
 */
export async function locTransition(
  trx: Trx,
  claims: AccessClaims,
  id: string,
  to: LocationLifecycle,
  reason?: string,
): Promise<Location> {
  const l = await trx
    .selectFrom('locations')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!l) throw new LocationError('NOT_FOUND', 'Unknown location');
  const from = l.lifecycle;
  if (!LOC_EDGES[from].includes(to))
    throw new LocationError('ILLEGAL_TRANSITION', `${from} → ${to} is not a legal step`);

  if (to === 'ACTIVE' && from === 'APPROVED') {
    const r = await locReadiness(trx, id);
    if (!r.ok)
      throw new LocationError(
        'NOT_READY',
        'Not ready: ' +
          r.items
            .filter((i) => !i.ok)
            .map((i) => i.label)
            .join(', '),
      );
    const actor = await trx
      .selectFrom('employees')
      .select('access')
      .where('id', '=', claims.sub)
      .executeTakeFirst();
    if (actor?.access !== 'owner')
      throw new LocationError('OWNER_ONLY', 'Only account-level owners can activate a location');
  }

  const patch: Partial<{
    lifecycle: LocationLifecycle;
    online: boolean;
    opened: Date;
  }> = { lifecycle: to };
  if (to === 'ACTIVE') {
    patch.online = true;
    if (!l.opened) patch.opened = new Date();
    // Search-market admission happens here once §5 answers land (Phase 8+).
  }
  if (to === 'SUSPENDED' || to === 'CLOSED') patch.online = false;

  const updated = await trx
    .updateTable('locations')
    .set(patch)
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirstOrThrow();

  await trx
    .insertInto('locationLifecycleLog')
    .values({
      tenantId: l.tenantId,
      locationId: id,
      fromState: from,
      toState: to,
      actorEmployeeId: claims.sub,
      reason: reason ?? null,
    })
    .execute();

  const actorRow = await trx
    .selectFrom('employees')
    .select('name')
    .where('id', '=', claims.sub)
    .executeTakeFirst();
  await logAudit(trx, l.tenantId, {
    actorEmployeeId: claims.sub,
    actorName: actorRow?.name ?? 'Unknown',
    action: 'Location lifecycle',
    object: `Location · ${l.name}`,
    before: from,
    after: to + (reason ? ' — ' + reason : ''),
    reason,
  });

  return toContract(updated);
}
