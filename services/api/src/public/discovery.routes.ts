import {
  BusinessSettingsSchema,
  DiscoveryCategoriesSchema,
  DiscoveryGalleryPhotoSchema,
  DiscoverySalonDetailSchema,
  DiscoverySalonsSchema,
} from '@velnes/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { z } from 'zod';
import { db, withTenant } from '../db/index.js';

const ErrorSchema = z.object({ error: z.string(), message: z.string() });

/** The consumer app's key-free read surface. Everything served here is
 *  either the global HQ taxonomy or data a salon publishes through its
 *  marketplace listing switch — nothing tenant-private. */

const GallerySchema = z.array(DiscoveryGalleryPhotoSchema.loose()).catch([]);

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

export async function discoveryRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.addHook('onRequest', async (req, reply) => openCors(req, reply));

  // The Velnes taxonomy as browsable cards — same open read the salon
  // registration wizard already uses, plus the HQ-provided media.
  r.route({
    method: 'GET',
    url: '/discovery/categories',
    schema: { response: { 200: DiscoveryCategoriesSchema } },
    handler: async () => {
      const rows = await db
        .selectFrom('serviceCategories')
        .select(['id', 'name', 'cardImage', 'icon'])
        .orderBy('sort')
        .orderBy('name')
        .execute();
      return { categories: rows };
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
        const photos = GallerySchema.parse(b.gallery);
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
          photo: photos[0]?.img ?? null,
          lat: pin.lat,
          lng: pin.lng,
          bookable: bookable.has(b.id),
        });
      }
      return { salons };
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
        gallery: GallerySchema.parse(biz.gallery).map((p) => ({ id: p.id, name: p.name, img: p.img })),
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
