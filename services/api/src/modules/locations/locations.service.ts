import type {
  AccessClaims,
  CopyChecklist,
  Location,
  LocationCreate,
  LocationLifecycle,
  ReadinessResponse,
} from '@velnes/contracts';
import { LOC_EDGES } from '@velnes/contracts';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { localIso } from '../scheduling/scheduling.service.js';
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
    opened: l.opened ? localIso(l.opened) : null,
    lifecycle: l.lifecycle,
  };
}

/**
 * The copy engine: a snapshot, never a link (prototype
 * copyLocationSetup verbatim). Stock is a transaction and starts at
 * 0; staff, customers, history and payment credentials never travel.
 * No source reference is stored — syncing later is impossible by
 * construction.
 */
export async function copyLocationSetup(
  trx: Trx,
  tenantId: string,
  srcId: string,
  dstId: string,
  c: CopyChecklist,
) {
  if (c.services) {
    const services = await trx.selectFrom('services').selectAll().where('status', '=', 'active').execute();
    const srcOverrides = await trx
      .selectFrom('locationCatalogServices')
      .selectAll()
      .where('locationId', '=', srcId)
      .execute();
    for (const sv of services) {
      const o = srcOverrides.find((x) => x.serviceId === sv.id);
      const active = o?.active ?? true;
      const online = o?.online ?? sv.online;
      const pos = o?.pos ?? sv.pos;
      await trx
        .insertInto('locationCatalogServices')
        .values({
          tenantId,
          locationId: dstId,
          serviceId: sv.id,
          active,
          online,
          pos,
          price: c.prices ? (o?.price ?? sv.price) : sv.price,
          durationMin: c.timing ? (o?.durationMin ?? sv.durationMin) : sv.durationMin,
          prepMin: c.timing ? (o?.prepMin ?? null) : null,
          resetMin: c.timing ? (o?.resetMin ?? null) : null,
        })
        .execute();
    }
    const srcVariants = await trx
      .selectFrom('locationCatalogVariants')
      .selectAll()
      .where('locationId', '=', srcId)
      .execute();
    for (const v of srcVariants)
      await trx
        .insertInto('locationCatalogVariants')
        .values({
          tenantId,
          locationId: dstId,
          variantId: v.variantId,
          active: v.active,
          price: c.prices ? v.price : null,
          durationMin: c.timing ? v.durationMin : null,
        })
        .execute();
  }
  if (c.products) {
    const products = await trx.selectFrom('products').selectAll().execute();
    const srcOverrides = await trx
      .selectFrom('locationCatalogProducts')
      .selectAll()
      .where('locationId', '=', srcId)
      .execute();
    for (const p of products) {
      const o = srcOverrides.find((x) => x.productId === p.id);
      await trx
        .insertInto('locationCatalogProducts')
        .values({
          tenantId,
          locationId: dstId,
          productId: p.id,
          active: o?.active ?? true,
          pos: o?.pos ?? true,
          lowStock: o?.lowStock ?? 2,
          price: c.prices ? (o?.price ?? p.price) : p.price,
          stock: 0, // stock is a transaction, never a copy
        })
        .execute();
    }
  }
  const src = await trx.selectFrom('locations').selectAll().where('id', '=', srcId).executeTakeFirst();
  if (src) {
    const patch: Record<string, unknown> = {};
    if (c.hours) patch.hours = JSON.stringify(src.hours);
    if (c.policies) patch.cancelHours = src.cancelHours;
    if (c.payments) patch.payments = JSON.stringify(src.payments);
    if (Object.keys(patch).length)
      await trx.updateTable('locations').set(patch).where('id', '=', dstId).execute();
  }
}

const STD_HOURS = {
  0: [['09:00', '19:00']],
  1: [['09:00', '19:00']],
  2: [['09:00', '19:00']],
  3: [['09:00', '19:00']],
  4: [['09:00', '19:00']],
  5: [['09:00', '15:00']],
  6: null,
};

/**
 * The wizard's create door: the location lands whole — snapshot copy
 * or honest emptiness (everything off, never a silent fallback to the
 * global default), legal entity attached or created pending, owners
 * granted access — and optionally submitted to HQ in the same act.
 */
export async function createLocation(
  trx: Trx,
  claims: AccessClaims,
  req: LocationCreate,
): Promise<Location> {
  const id = randomUUID();
  await trx
    .insertInto('locations')
    .values({
      id,
      tenantId: claims.ten,
      name: req.name,
      city: req.city,
      address: req.address,
      zip: req.zip || null,
      country: req.country,
      tz: req.tz,
      phone: req.phone || null,
      rooms: req.rooms,
      invPrefix: req.invPrefix || `${req.name.slice(0, 3).toUpperCase()}-`,
      online: false,
      cancelHours: 24,
      lifecycle: 'DRAFT',
      hours: JSON.stringify(STD_HOURS),
      payments: JSON.stringify({ cash: true, card: true, online: false, rounding: false, tip: true }),
    })
    .execute();

  if (req.mode === 'copy' && req.srcLocationId)
    await copyLocationSetup(trx, claims.ten, req.srcLocationId, id, req.copy);

  // What was not (part of the) copy starts OFF — never a silent
  // fallback to the business-wide default.
  const services = await trx.selectFrom('services').select('id').execute();
  const covered = await trx
    .selectFrom('locationCatalogServices')
    .select('serviceId')
    .where('locationId', '=', id)
    .execute();
  const coveredIds = new Set(covered.map((c) => c.serviceId));
  for (const sv of services)
    if (!coveredIds.has(sv.id))
      await trx
        .insertInto('locationCatalogServices')
        .values({
          tenantId: claims.ten,
          locationId: id,
          serviceId: sv.id,
          active: false,
          online: false,
          pos: false,
          price: (await trx.selectFrom('services').select('price').where('id', '=', sv.id).executeTakeFirstOrThrow()).price,
          durationMin: (await trx.selectFrom('services').select('durationMin').where('id', '=', sv.id).executeTakeFirstOrThrow()).durationMin,
        })
        .execute();
  const products = await trx.selectFrom('products').select(['id', 'price']).execute();
  const coveredProds = new Set(
    (
      await trx
        .selectFrom('locationCatalogProducts')
        .select('productId')
        .where('locationId', '=', id)
        .execute()
    ).map((p) => p.productId),
  );
  for (const p of products)
    if (!coveredProds.has(p.id))
      await trx
        .insertInto('locationCatalogProducts')
        .values({
          tenantId: claims.ten,
          locationId: id,
          productId: p.id,
          active: false,
          pos: false,
          price: p.price,
          stock: 0,
          lowStock: 2,
        })
        .execute();

  // The legal entity: attach an existing one, or create it pending —
  // HQ reviews it together with the location, one submission, one
  // decision.
  if (req.legal.mode === 'existing') {
    await trx
      .insertInto('legalEntityLocations')
      .values({ tenantId: claims.ten, legalEntityId: req.legal.legalEntityId, locationId: id })
      .execute();
  } else {
    const leId = randomUUID();
    await trx
      .insertInto('legalEntities')
      .values({
        id: leId,
        tenantId: claims.ten,
        ownerType: 'salon',
        isDefault: false,
        name: req.legal.name,
        taxId: req.legal.taxId,
        vatReg: req.legal.vat || null,
        currency: req.legal.currency || 'MKD',
        status: 'pending',
      })
      .execute();
    await trx
      .insertInto('legalEntityLocations')
      .values({ tenantId: claims.ten, legalEntityId: leId, locationId: id })
      .execute();
    await trx
      .insertInto('paymentAccounts')
      .values({ tenantId: claims.ten, legalEntityId: leId, provider: null, status: 'incomplete' })
      .execute();
  }

  // Automatic access: only real owners — everybody else stays explicit.
  const owners = await trx
    .selectFrom('employees')
    .select('id')
    .where('access', '=', 'owner')
    .execute();
  for (const o of owners)
    await trx
      .insertInto('employeeLocations')
      .values({ tenantId: claims.ten, employeeId: o.id, locationId: id })
      .execute();

  const actor = await trx
    .selectFrom('employees')
    .select('name')
    .where('id', '=', claims.sub)
    .executeTakeFirst();
  await logAudit(trx, claims.ten, {
    actorEmployeeId: claims.sub,
    actorName: actor?.name ?? 'Unknown',
    action: 'Location created',
    object: `Location · ${req.name}`,
    after: req.mode === 'copy' ? 'Copy of existing setup (snapshot)' : 'From scratch',
  });

  if (req.submit) return locTransition(trx, claims, id, 'SUBMITTED');
  const row = await trx.selectFrom('locations').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  return toContract(row);
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
  claims: AccessClaims | null,
  id: string,
  to: LocationLifecycle,
  reason?: string,
  // HQ reviewers act without an employee identity; the log still
  // names them. Tenant calls leave this unset.
  actor?: { employeeId: string | null; name: string },
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
    const actorRow = claims
      ? await trx
          .selectFrom('employees')
          .select('access')
          .where('id', '=', claims.sub)
          .executeTakeFirst()
      : undefined;
    if (actorRow?.access !== 'owner')
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
      actorEmployeeId: actor ? actor.employeeId : (claims?.sub ?? null),
      reason: reason ?? null,
    })
    .execute();

  const actorName = actor
    ? actor.name
    : claims
      ? ((await trx.selectFrom('employees').select('name').where('id', '=', claims.sub).executeTakeFirst())?.name ?? 'Unknown')
      : 'Unknown';
  await logAudit(trx, l.tenantId, {
    actorEmployeeId: actor ? actor.employeeId : (claims?.sub ?? null),
    actorName,
    action: 'Location lifecycle',
    object: `Location · ${l.name}`,
    before: from,
    after: to + (reason ? ' — ' + reason : ''),
    reason,
  });

  return toContract(updated);
}
