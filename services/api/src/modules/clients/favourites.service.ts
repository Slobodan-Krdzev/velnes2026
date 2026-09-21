import {
  BusinessSettingsSchema,
  type ClientFavourite,
  type ClientFavourites,
  type FavouriteKind,
} from '@velnes/contracts';
import { sql } from 'kysely';
import { db, withClient, withTenant } from '../../db/index.js';

/**
 * Favourites — Phase C, docs/FAVOURITES.md.
 *
 * The client's own list, read and written only in their own context.
 * Resolving what a favourite *is* crosses into tenant data, which is
 * what `withTenant` is for and what `myAppointments` already does:
 * reading a service's name is not the same as telling that service's
 * salon who asked. Nothing here ever tells a salon anything.
 */

/**
 * How long a target must have been missing before its row is swept.
 *
 * Long, on purpose. A row is only ever stamped when a tenant read
 * succeeded and the target genuinely was not in it, but "succeeded" is
 * not the same as "was right": a restore, a re-import, a migration part
 * way through. Ninety days is far longer than any of those, and the row
 * costs nothing in the meantime.
 */
const SWEEP_AFTER_DAYS = 90;

/** What a favourite's target turned out to be, when we went to look. */
type Resolution =
  /** Resolves, and is public. Shown. */
  | { state: 'available'; row: ClientFavourite }
  /** Resolves, but is not published right now — a draft service, an
   *  unlisted salon, a hidden team. Kept, and left out of the list: the
   *  person did not change their mind, the salon did. */
  | { state: 'unavailable' }
  /** Not there at all. Stamped, and swept only after the grace period. */
  | { state: 'gone' };

interface FavRow {
  kind: string;
  tenantId: string;
  refId: string;
  missingSince: Date | null;
  createdAt: Date;
}

/** The salon behind every favourite, read under app.public — the same
 *  open read the discovery doors use. */
async function salonOf(tenantId: string) {
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.public', '1', true)`.execute(trx);
    return trx
      .selectFrom('businesses')
      .select(['id', 'name', 'slug', 'city', 'gallery', 'settings'])
      .where('id', '=', tenantId)
      .executeTakeFirst();
  });
}

/** First real photograph in a salon's gallery, as a CSS-ready value. */
function galleryPhoto(gallery: unknown): string | null {
  if (!Array.isArray(gallery)) return null;
  for (const p of gallery) {
    if (p && typeof p === 'object' && typeof (p as { img?: unknown }).img === 'string')
      return (p as { img: string }).img;
  }
  return null;
}

/**
 * Work out what one favourite currently is.
 *
 * The three-way answer is the point. A binary "can I show this?" would
 * conflate a salon that unpublished itself this morning with one that
 * never existed, and either delete something a person still wants or
 * keep something that will never resolve again.
 */
async function resolveOne(f: FavRow): Promise<Resolution> {
  const biz = await salonOf(f.tenantId);
  // The salon itself is missing: everything hanging off it is gone too.
  if (!biz || !biz.slug) return { state: 'gone' };

  const settings = BusinessSettingsSchema.safeParse(biz.settings ?? {});
  const listed = settings.success && settings.data.marketplace.listed;
  const showTeam = settings.success && settings.data.marketplace.showTeam;
  const photo = galleryPhoto(biz.gallery);
  const base = {
    salonSlug: biz.slug,
    salonName: biz.name,
    savedAt: f.createdAt.toISOString(),
  };

  if (f.kind === 'salon') {
    // Exists but is not on the marketplace right now: hidden, not gone.
    if (!listed) return { state: 'unavailable' };
    return {
      state: 'available',
      row: {
        kind: 'salon',
        id: f.refId,
        name: biz.name,
        sub: biz.city ?? '',
        photo,
        ...base,
      },
    };
  }

  if (f.kind === 'service') {
    const svc = await withTenant(f.tenantId, (trx) =>
      trx
        .selectFrom('services')
        .select(['id', 'name', 'status', 'online'])
        .where('id', '=', f.refId)
        .executeTakeFirst(),
    );
    if (!svc) return { state: 'gone' };
    // Draft, taken offline, or its salon unlisted: all reversible.
    if (!listed || svc.status !== 'active' || !svc.online) return { state: 'unavailable' };
    return {
      state: 'available',
      row: {
        kind: 'service',
        id: f.refId,
        name: svc.name,
        sub: `at ${biz.name}`,
        photo,
        ...base,
      },
    };
  }

  const emp = await withTenant(f.tenantId, (trx) =>
    trx
      .selectFrom('employees')
      .select(['id', 'name', 'roleTitle', 'status', 'bookable'])
      .where('id', '=', f.refId)
      .executeTakeFirst(),
  );
  if (!emp) return { state: 'gone' };
  // A pro is only public while their salon shows its team at all.
  if (!listed || !showTeam || emp.status !== 'active' || !emp.bookable)
    return { state: 'unavailable' };
  return {
    state: 'available',
    row: {
      kind: 'pro',
      id: f.refId,
      name: emp.name,
      sub: emp.roleTitle ? `${emp.roleTitle} · ${biz.name}` : biz.name,
      // The prototype draws initials for a professional, not a photo.
      photo: null,
      ...base,
    },
  };
}

/**
 * The list, grouped as the section renders it.
 *
 * This is also where housekeeping happens, because it is the one place
 * that already knows the answer for every one of this client's rows. A
 * target that has come back has its stamp cleared; one that has just
 * gone gets stamped; one that has been gone longer than the grace
 * period is swept. Bounded by the client's own row count, triggered by
 * their own read, and needing no scheduler — which this codebase does
 * not have.
 */
export async function listFavourites(clientUserId: string): Promise<ClientFavourites> {
  const rows = (await withClient(clientUserId, (trx) =>
    trx
      .selectFrom('clientFavourites')
      .select(['kind', 'tenantId', 'refId', 'missingSince', 'createdAt'])
      .where('clientUserId', '=', clientUserId)
      .orderBy('createdAt', 'desc')
      .execute(),
  )) as FavRow[];

  const out: ClientFavourites = { salons: [], services: [], pros: [], hidden: 0 };
  const reappeared: { kind: string; refId: string }[] = [];
  const vanished: { kind: string; refId: string }[] = [];
  const sweep: { kind: string; refId: string }[] = [];
  const cutoff = Date.now() - SWEEP_AFTER_DAYS * 86_400_000;

  for (const f of rows) {
    const r = await resolveOne(f);
    if (r.state === 'gone') {
      if (!f.missingSince) vanished.push({ kind: f.kind, refId: f.refId });
      else if (f.missingSince.getTime() < cutoff) sweep.push({ kind: f.kind, refId: f.refId });
      continue;
    }
    // It resolved, so whatever we thought before, it is here now.
    if (f.missingSince) reappeared.push({ kind: f.kind, refId: f.refId });
    if (r.state === 'unavailable') {
      out.hidden += 1;
      continue;
    }
    if (r.row.kind === 'salon') out.salons.push(r.row);
    else if (r.row.kind === 'service') out.services.push(r.row);
    else out.pros.push(r.row);
  }

  if (reappeared.length || vanished.length || sweep.length) {
    await withClient(clientUserId, async (trx) => {
      for (const k of reappeared)
        await trx
          .updateTable('clientFavourites')
          .set({ missingSince: null })
          .where('clientUserId', '=', clientUserId)
          .where('kind', '=', k.kind)
          .where('refId', '=', k.refId)
          .execute();
      for (const k of vanished)
        await trx
          .updateTable('clientFavourites')
          .set({ missingSince: new Date() })
          .where('clientUserId', '=', clientUserId)
          .where('kind', '=', k.kind)
          .where('refId', '=', k.refId)
          .execute();
      for (const k of sweep)
        await trx
          .deleteFrom('clientFavourites')
          .where('clientUserId', '=', clientUserId)
          .where('kind', '=', k.kind)
          .where('refId', '=', k.refId)
          .execute();
    });
  }

  return out;
}

/**
 * Add one. Idempotent: favouriting twice is the same row, not two, and
 * the second press is not an error — a heart that errors because it is
 * already filled would be a strange thing to explain.
 *
 * The target must resolve to something real, or there is nothing to
 * save; but it need not be *available*, because a person may reasonably
 * save a salon that has just gone quiet.
 */
export async function addFavourite(
  clientUserId: string,
  kind: FavouriteKind,
  refId: string,
): Promise<'ok' | 'unknown'> {
  const tenantId = await tenantOf(kind, refId);
  if (!tenantId) return 'unknown';
  await withClient(clientUserId, (trx) =>
    trx
      .insertInto('clientFavourites')
      .values({ clientUserId, kind, tenantId, refId, missingSince: null })
      .onConflict((oc) => oc.columns(['clientUserId', 'kind', 'refId']).doNothing())
      .execute(),
  );
  return 'ok';
}

/** Remove one. Idempotent in the same way and for the same reason. */
export async function removeFavourite(
  clientUserId: string,
  kind: FavouriteKind,
  refId: string,
): Promise<void> {
  await withClient(clientUserId, (trx) =>
    trx
      .deleteFrom('clientFavourites')
      .where('clientUserId', '=', clientUserId)
      .where('kind', '=', kind)
      .where('refId', '=', refId)
      .execute(),
  );
}

/**
 * Which salon a target belongs to — and, in passing, whether it exists.
 *
 * A service and an employee are tenant rows, so finding one means asking
 * each listed salon in turn. That is the price of not storing a foreign
 * key, and it is paid once when something is favourited rather than on
 * every read, which is why the tenant is stored on the row afterwards.
 */
async function tenantOf(kind: FavouriteKind, refId: string): Promise<string | null> {
  if (kind === 'salon') {
    const biz = await salonOf(refId);
    return biz?.slug ? biz.id : null;
  }
  const all = await db.transaction().execute(async (trx) => {
    await sql`select set_config('app.public', '1', true)`.execute(trx);
    return trx.selectFrom('businesses').select(['id']).where('slug', 'is not', null).execute();
  });
  for (const b of all) {
    const hit = await withTenant(b.id, (trx) =>
      kind === 'service'
        ? trx.selectFrom('services').select('id').where('id', '=', refId).executeTakeFirst()
        : trx.selectFrom('employees').select('id').where('id', '=', refId).executeTakeFirst(),
    );
    if (hit) return b.id;
  }
  return null;
}

/**
 * Just the ids, for the ranker — §5's affinity signal.
 *
 * Deliberately not the same shape as the list: the ranker wants sets to
 * test membership against, and it wants them whether or not the target
 * is public today. A favourite is a standing statement about what a
 * person likes, and the ranker has already admitted the candidate by the
 * time it asks.
 */
export async function favouriteIds(
  clientUserId: string,
): Promise<{ services: string[]; businesses: string[] }> {
  const rows = await withClient(clientUserId, (trx) =>
    trx
      .selectFrom('clientFavourites')
      .select(['kind', 'tenantId', 'refId'])
      .where('clientUserId', '=', clientUserId)
      .execute(),
  );
  return {
    services: rows.filter((r) => r.kind === 'service').map((r) => r.refId),
    // A favourited pro counts for their salon: it is the nearest true
    // thing the scorer can say, since results are treatments at salons
    // and there is no pro seam to fill.
    businesses: rows.filter((r) => r.kind !== 'service').map((r) => r.tenantId),
  };
}
