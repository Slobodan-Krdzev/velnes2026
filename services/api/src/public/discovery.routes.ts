import {
  BusinessSettingsSchema,
  DiscoveryCategoriesSchema,
  DiscoveryCategoryServicesSchema,
  DiscoverySalonDetailSchema,
  DiscoveryRankedServicesSchema,
  DiscoverySalonsSchema,
  DiscoveryViewerSchema,
} from '@velnes/contracts';
import type { DiscoveryServiceCard } from '@velnes/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { z } from 'zod';
import { svcVariants } from '../modules/catalog/catalog.service.js';
import { ClientClaimsSchema } from '@velnes/contracts';
import { distanceKm, rank, type RankCandidate } from '../modules/search/rank.js';
import { activeSearchConfig, viewerHistory } from '../modules/search/search.service.js';
import { db, withTenant } from '../db/index.js';

const ErrorSchema = z.object({ error: z.string(), message: z.string() });

/** The consumer app's key-free read surface. Everything served here is
 *  either the global HQ taxonomy or data a salon publishes through its
 *  marketplace listing switch — nothing tenant-private. */

/** A salon's gallery as the consumer app can use it. Entries may carry
 *  a colour tone and no photograph — the prototype's placeholders, and
 *  what the seed still holds — so they are dropped one by one rather
 *  than letting a single empty entry take the whole gallery with it. */
const GalleryEntrySchema = z
  .object({
    id: z.string(),
    name: z.string().default(''),
    img: z.string().nullable().default(null),
    tone: z.string().nullable().default(null),
  })
  .loose();
const GallerySchema = z.array(GalleryEntrySchema).catch([]);
/** Everything the salon put in its gallery, photograph or tile. A
 *  malformed entry is dropped on its own rather than taking the whole
 *  gallery with it. */
const galleryOf = (gallery: unknown) =>
  GallerySchema.parse(gallery)
    .filter((p) => p.img || p.tone)
    .map((p) => ({ id: p.id, name: p.name, img: p.img, tone: p.tone }));
/** The card image: the first real photograph, if there is one. */
const cardPhoto = (gallery: unknown) => galleryOf(gallery).find((p) => p.img)?.img ?? null;

/** The consumer app is first-party: answer velnes hosts and local dev,
 *  nothing else needs these doors cross-origin. */
function openCors(req: FastifyRequest, reply: FastifyReply) {
  const origin = req.headers.origin;
  if (!origin) return;
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return;
  }
  if (host === 'localhost' || host.endsWith('velnes.mk')) {
    reply.header('access-control-allow-origin', origin);
    reply.header('vary', 'origin');
  }
}

interface ListedBusiness {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  address: string | null;
  phone: string | null;
  description: string;
  gallery: unknown;
  marketplace: ReturnType<typeof BusinessSettingsSchema.parse>['marketplace'];
}

/** All businesses that publish a marketplace listing, read under
 *  app.public (the same policy the slug lookup uses). */
async function listedBusinesses(): Promise<ListedBusiness[]> {
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.public', '1', true)`.execute(trx);
    const rows = await trx
      .selectFrom('businesses')
      .select(['id', 'slug', 'name', 'city', 'address', 'phone', 'description', 'gallery', 'settings'])
      .orderBy('name')
      .execute();
    const out: ListedBusiness[] = [];
    for (const b of rows) {
      if (!b.slug) continue;
      const parsed = BusinessSettingsSchema.safeParse(b.settings ?? {});
      if (!parsed.success || !parsed.data.marketplace.listed) continue;
      out.push({
        id: b.id,
        slug: b.slug,
        name: b.name,
        city: b.city,
        address: b.address,
        phone: b.phone,
        description: b.description,
        gallery: b.gallery,
        marketplace: parsed.data.marketplace,
      });
    }
    return out;
  });
}

/** Live-widget lookup under app.public — same policy the widget doors use. */
/** Where a salon sits on the map: the pin its owner dropped, preferring
 *  a live location's but falling back to any of them — a salon that is
 *  listed but not yet bookable still has a place in the world. */
async function firstPin(tenantId: string): Promise<{ lat: number | null; lng: number | null }> {
  const rows = await withTenant(tenantId, (trx) =>
    trx
      .selectFrom('locations')
      .select(['lat', 'lng', 'lifecycle'])
      .orderBy('name')
      .execute(),
  );
  const pinned = rows.filter((l) => l.lat != null && l.lng != null);
  const best = pinned.find((l) => l.lifecycle === 'ACTIVE') ?? pinned[0];
  return { lat: best?.lat ?? null, lng: best?.lng ?? null };
}

async function liveWidgets(tenantIds: string[]) {
  if (!tenantIds.length) return [];
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.public', '1', true)`.execute(trx);
    return trx
      .selectFrom('widgets')
      .select(['tenantId', 'publishableKey', 'locationIds', 'createdAt'])
      .where('tenantId', 'in', tenantIds)
      .where('status', '=', 'live')
      .orderBy('createdAt')
      .execute();
  });
}

/**
 * The categories something is actually published in.
 *
 * A category card is a promise that there is something behind it, so
 * the shelf only carries categories a listed salon really offers an
 * active, online service in. The predicate is deliberately the same one
 * the services door filters on — if the two ever drifted apart, a card
 * would open onto an empty page, which is the one thing the shelf must
 * not do.
 */
async function categoryIdsOnOffer(admitted: ListedBusiness[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const b of admitted) {
    const rows = await withTenant(b.id, (trx) =>
      trx
        .selectFrom('services')
        .select('categoryId')
        .distinct()
        .where('status', '=', 'active')
        .where('online', '=', true)
        .execute(),
    );
    for (const r of rows) if (r.categoryId) out.add(r.categoryId);
  }
  return out;
}

/** What the ranker needs that a result card does not carry. */
interface CandidateMeta {
  businessId: string;
  createdAt: string;
}

/**
 * Stage 1 admission for consumer service discovery — §5.
 *
 * Three hard rules, and they are hard: a salon that fails one is absent,
 * never merely ranked low.
 *
 *  - It publishes a marketplace listing.
 *  - It has at least one location on lifecycle ACTIVE. Only ACTIVE
 *    locations exist to the outside world, which is the rule the
 *    lifecycle was built to carry; a salon still being set up is not
 *    open, whatever else is true of it.
 *  - It is bookable — a live widget answers for it. This surface exists
 *    to be booked from, and a treatment that cannot be booked has no
 *    business competing for position with one that can. As an admission
 *    rule rather than a weight, because a weight can always be
 *    out-argued by another weight: at proximity 0.30 against
 *    availability 0.20 a nearby salon that took no bookings used to
 *    outrank a bookable one further away, which is precisely the
 *    outcome this forbids.
 *
 * One predicate, used by the category shelf and by both service doors,
 * so a card can never open onto a page its own admission rules emptied.
 */
async function admittedBusinesses(): Promise<ListedBusiness[]> {
  const listed = await listedBusinesses();
  if (!listed.length) return [];
  const bookable = new Set((await liveWidgets(listed.map((b) => b.id))).map((w) => w.tenantId));
  const out: ListedBusiness[] = [];
  for (const b of listed) {
    if (!bookable.has(b.id)) continue;
    const active = await withTenant(b.id, (trx) =>
      trx
        .selectFrom('locations')
        .select('id')
        .where('lifecycle', '=', 'ACTIVE')
        .executeTakeFirst(),
    );
    if (active) out.push(b);
  }
  return out;
}

/**
 * Everything published in one category, across every listed salon —
 * the candidates both doors work from.
 *
 * One gatherer, so the ranked and unranked forms can never disagree
 * about who is in the running. They differ only in the order they put
 * them in.
 */
async function gatherCategory(categoryId: string): Promise<
  | {
      category: { id: string; name: string; cardImage: string | null; icon: string | null };
      services: DiscoveryServiceCard[];
      meta: Map<string, CandidateMeta>;
    }
  | null
> {
  const category = await db
    .selectFrom('serviceCategories')
    .select(['id', 'name', 'cardImage', 'icon'])
    .where('id', '=', categoryId)
    .executeTakeFirst();
  if (!category) return null;

  const listed = await admittedBusinesses();
  // An empty IN list is not valid SQL to build, and "nothing is admitted"
  // is an ordinary state — a category page with nothing on it, not an
  // error. The same guard liveWidgets already uses.
  const created = listed.length
    ? await db.transaction().execute(async (trx) => {
        await sql`select set_config('app.public', '1', true)`.execute(trx);
        return trx
          .selectFrom('businesses')
          .select(['id', 'createdAt'])
          .where(
            'id',
            'in',
            listed.map((b) => b.id),
          )
          .execute();
      })
    : [];
  const createdAt = new Map(created.map((b) => [b.id, b.createdAt]));

  const services: DiscoveryServiceCard[] = [];
  const meta = new Map<string, CandidateMeta>();
  for (const b of listed) {
    const photo = cardPhoto(b.gallery);
    const pin = await firstPin(b.id);
    const rows = await withTenant(b.id, async (trx) => {
      const found = await trx
        .selectFrom('services as s')
        .select(['s.id', 's.name', 's.durationMin', 's.price', 's.sort'])
        .where('s.categoryId', '=', category.id)
        .where('s.status', '=', 'active')
        // POS-only treatments are not on offer to the public.
        .where('s.online', '=', true)
        .orderBy('s.sort')
        .orderBy('s.name')
        .execute();
      // A variant's price can undercut the master's, and the card says
      // "from" when it does. No location here, so this is the salon-wide
      // price before any per-location override.
      return Promise.all(
        found.map(async (s) => {
          const vs = (await svcVariants(trx, s.id, null)).filter((v) => v.active);
          return { ...s, priceFrom: vs.length ? Math.min(...vs.map((v) => v.price)) : null };
        }),
      );
    });
    const show = b.marketplace.showPrices;
    for (const s of rows) {
      services.push({
        id: s.id,
        name: s.name,
        category: category.name,
        durationMin: s.durationMin,
        price: show ? s.price : null,
        priceFrom: show ? s.priceFrom : null,
        salon: {
          slug: b.slug,
          name: b.name,
          city: b.city,
          photo,
          lat: pin.lat,
          lng: pin.lng,
          // Admission already guaranteed this; kept on the card because
          // the app still says it, and a field that silently became
          // constant is a field someone will later misread.
          bookable: true,
          showPrices: show,
        },
      });
      meta.set(s.id, {
        businessId: b.id,
        createdAt: (createdAt.get(b.id) ?? new Date()).toISOString(),
      });
    }
  }
  return { category, services, meta };
}

/**
 * The signed-in client, if there is one.
 *
 * Deliberately never throws and never answers 401: these are key-free
 * public doors, and being signed out is not an error. A token that has
 * expired or does not parse means the same thing as no token at all —
 * rank without a history.
 */
async function clientClaimsOf(req: FastifyRequest) {
  if (!req.headers.authorization) return null;
  try {
    return ClientClaimsSchema.parse(await req.jwtVerify());
  } catch {
    return null;
  }
}

export async function discoveryRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.addHook('onRequest', async (req, reply) => openCors(req, reply));

  // The Velnes taxonomy as browsable cards, plus the HQ-provided media
  // — but only the part of it that has anything behind it. A salon
  // registering still picks from the whole taxonomy; that is the
  // registration wizard's own door (/registrations/service-categories),
  // so a category nobody serves yet stays choosable there while staying
  // off the shelf here.
  r.route({
    method: 'GET',
    url: '/discovery/categories',
    schema: { response: { 200: DiscoveryCategoriesSchema } },
    handler: async () => {
      const onOffer = await categoryIdsOnOffer(await admittedBusinesses());
      const rows = await db
        .selectFrom('serviceCategories')
        .select(['id', 'name', 'cardImage', 'icon'])
        .orderBy('sort')
        .orderBy('name')
        .execute();
      return { categories: rows.filter((c) => onOffer.has(c.id)) };
    },
  });

  r.route({
    method: 'GET',
    url: '/discovery/salons',
    schema: { response: { 200: DiscoverySalonsSchema } },
    handler: async () => {
      const listed = await listedBusinesses();
      const widgets = await liveWidgets(listed.map((b) => b.id));
      const bookable = new Set(widgets.map((w) => w.tenantId));
      const salons = [];
      for (const b of listed) {
        const photo = cardPhoto(b.gallery);
        const cats = await withTenant(b.id, (trx) =>
          trx
            .selectFrom('services as s')
            .innerJoin('serviceCategories as c', 'c.id', 's.categoryId')
            .select('c.name')
            .distinct()
            .where('s.status', '=', 'active')
            .execute(),
        );
        const pin = await firstPin(b.id);
        salons.push({
          slug: b.slug,
          name: b.name,
          city: b.city,
          address: b.address,
          pitch: b.marketplace.pitch,
          categories: b.marketplace.categories,
          serviceCategories: cats.map((c) => c.name),
          photo,
          lat: pin.lat,
          lng: pin.lng,
          bookable: bookable.has(b.id),
        });
      }
      return { salons };
    },
  });

  /**
   * Everything offered in one category, across every listed salon —
   * the door behind a category card.
   *
   * What it will not do yet: rank. The order here is deterministic and
   * impersonal — bookable first, then cheapest, then by name — because
   * ordering results by where somebody is and what they have booked
   * before is the §5 search-architecture decision (exposure decay,
   * quality floor, consent modes, the HQ Search lab that tunes them).
   * Inventing a ranking here would put that rule behind a second door.
   */
  r.route({
    method: 'GET',
    url: '/discovery/categories/:id/services',
    schema: {
      params: z.object({ id: z.uuid() }),
      response: { 200: DiscoveryCategoryServicesSchema, 404: ErrorSchema },
    },
    handler: async (req, reply) => {
      const found = await gatherCategory(req.params.id);
      if (!found)
        return reply.code(404).send({ error: 'UNKNOWN_CATEGORY', message: 'No category here' });
      const { category, services } = found;

      // The unpersonalised order, and the whole of it: something you can
      // book leads; then the cheaper treatment; then alphabetical, so the
      // list is stable between requests. A salon that hides its prices
      // sorts after the ones that publish them rather than as free.
      const askingPrice = (s: DiscoveryServiceCard) =>
        s.priceFrom ?? s.price ?? Number.POSITIVE_INFINITY;
      const sorted = [...services].sort(
        (a, z) =>
          Number(z.salon.bookable) - Number(a.salon.bookable) ||
          askingPrice(a) - askingPrice(z) ||
          a.name.localeCompare(z.name) ||
          a.salon.name.localeCompare(z.salon.name),
      );

      return { category, services: sorted };
    },
  });

  /**
   * The ranked form of the same results — §5, Phase B.
   *
   * A POST and not a GET because the viewer's position travels in the
   * body: a precise location in a query string ends up in access logs,
   * proxy logs and referrers. The coordinates arrive already rounded to
   * ~110m, are used to order one response, and are not stored.
   *
   * Authentication is optional on purpose. A signed-out visitor is an
   * ordinary caller and gets a perfectly good page — proximity, value
   * and availability, with the personal component simply absent rather
   * than substituted for.
   */
  r.route({
    method: 'POST',
    url: '/discovery/categories/:id/services',
    schema: {
      params: z.object({ id: z.uuid() }),
      body: DiscoveryViewerSchema,
      response: { 200: DiscoveryRankedServicesSchema, 404: ErrorSchema },
    },
    handler: async (req, reply) => {
      const found = await gatherCategory(req.params.id);
      if (!found)
        return reply.code(404).send({ error: 'UNKNOWN_CATEGORY', message: 'No category here' });
      const { category, services, meta } = found;

      const cfg = await activeSearchConfig();
      const now = new Date();
      const position =
        req.body.lat != null && req.body.lng != null
          ? { lat: req.body.lat, lng: req.body.lng }
          : null;

      // Personalisation is for signed-in clients who have not switched
      // it off. A bad or absent token is not an error here — it simply
      // means there is no history to rank with.
      let history = null;
      let personalised = false;
      const claims = await clientClaimsOf(req);
      if (claims) {
        const me = await db
          .selectFrom('clientUsers')
          .select('personalisedResults')
          .where('id', '=', claims.sub)
          .executeTakeFirst();
        if (me?.personalisedResults) {
          history = await viewerHistory(claims.sub, now);
          personalised = true;
        }
      }

      const candidates: RankCandidate[] = services.map((s) => {
        const m = meta.get(s.id)!;
        return {
          id: s.id,
          name: s.name,
          categoryId: category.id,
          durationMin: s.durationMin,
          price: s.price,
          priceFrom: s.priceFrom,
          salon: {
            slug: s.salon.slug,
            businessId: m.businessId,
            name: s.salon.name,
            lat: s.salon.lat,
            lng: s.salon.lng,
            bookable: s.salon.bookable,
            createdAt: m.createdAt,
          },
        };
      });

      // Admission: a radius the viewer explicitly set is a hard filter,
      // and results outside it are absent rather than demoted. Without
      // one, "Near me" only sorts — a toggle that silently hides a salon
      // 6km away is a bug report waiting to happen.
      const admitted =
        position && req.body.radiusKm
          ? candidates.filter(
              (c) =>
                c.salon.lat != null &&
                c.salon.lng != null &&
                distanceKm(position, { lat: c.salon.lat, lng: c.salon.lng }) <=
                  req.body.radiusKm!,
            )
          : candidates;

      const ranked = rank(admitted, { position, history }, cfg.payload, { now });
      const byId = new Map(services.map((s) => [s.id, s]));
      return {
        category,
        services: ranked.map((r) => byId.get(r.candidate.id)!),
        rankVersion: cfg.version,
        personalised,
      };
    },
  });

  r.route({
    method: 'GET',
    url: '/discovery/salons/:slug',
    schema: {
      params: z.object({ slug: z.string().min(1) }),
      response: { 200: DiscoverySalonDetailSchema, 404: ErrorSchema },
    },
    handler: async (req, reply) => {
      const listed = await listedBusinesses();
      const biz = listed.find((b) => b.slug === req.params.slug);
      if (!biz)
        return reply.code(404).send({ error: 'UNKNOWN_SALON', message: 'No salon here' });
      const widget = (await liveWidgets([biz.id]))[0];
      const pin = await firstPin(biz.id);
      const { team, products, locations, addr } = await withTenant(biz.id, async (trx) => {
        const team = biz.marketplace.showTeam
          ? await trx
              .selectFrom('employees')
              .select(['id', 'name', 'roleTitle', 'avatar'])
              .where('status', '=', 'active')
              .where('bookable', '=', true)
              .orderBy('name')
              .execute()
          : [];
        const products = await trx
          .selectFrom('products as p')
          .leftJoin('productCategories as c', 'c.id', 'p.categoryId')
          .select(['p.id', 'p.name', 'p.price'])
          .select('c.name as category')
          .where('p.active', '=', true)
          .where('p.own', '=', false)
          .where('p.price', '>', 0)
          .orderBy('p.name')
          .execute();
        const locations = widget
          ? (
              await trx
                .selectFrom('locations')
                .select(['id', 'name', 'city', 'address', 'lifecycle', 'lat', 'lng'])
                .where('id', 'in', widget.locationIds.length ? widget.locationIds : [biz.id])
                .execute()
            )
              .filter((l) => l.lifecycle === 'ACTIVE')
              .map((l) => ({
                id: l.id,
                name: l.name,
                city: l.city,
                address: l.address,
                lat: l.lat,
                lng: l.lng,
              }))
          : [];
        // What we print: the business card's address, else the first
        // location's — a salon always has one somewhere.
        const any = await trx
          .selectFrom('locations')
          .select(['address', 'city'])
          .orderBy('name')
          .executeTakeFirst();
        const addr = {
          address: biz.address ?? any?.address ?? null,
          city: biz.city ?? any?.city ?? null,
        };
        return { team, products, locations, addr };
      });
      return {
        slug: biz.slug,
        name: biz.name,
        city: addr.city,
        address: addr.address,
        phone: biz.phone,
        description: biz.description,
        pitch: biz.marketplace.pitch,
        lat: pin.lat,
        lng: pin.lng,
        categories: biz.marketplace.categories,
        gallery: galleryOf(biz.gallery),
        showPrices: biz.marketplace.showPrices,
        team: team.map((e) => ({ id: e.id, name: e.name, role: e.roleTitle, avatar: e.avatar })),
        products,
        bookable: Boolean(widget),
        publishableKey: widget?.publishableKey ?? null,
        locations,
      };
    },
  });
}
