import rateLimit from '@fastify/rate-limit';
import {
  AvailabilityResponseSchema,
  BookingRefusalSchema,
  HoldResponseSchema,
  PublicBookRequestSchema,
  PublicBookResponseSchema,
  PublicHoldRequestSchema,
  PublicServicesResponseSchema,
  PublicWidgetSchema,
} from '@velnes/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { z } from 'zod';
import { db, withTenant, type Trx } from '../db/index.js';
import {
  availableSlots,
  BookingError,
  BookingRefused,
  confirmBooking,
  createHold,
  empsFor,
} from '../modules/booking/booking.service.js';
import { svcAt, svcVariants } from '../modules/catalog/catalog.service.js';
import { locLive } from '../modules/locations/locations.service.js';

const ErrorSchema = z.object({ error: z.string(), message: z.string() });
const KeyQuery = z.object({ key: z.string().min(4) });

interface WidgetRow {
  id: string;
  tenantId: string;
  name: string;
  publishableKey: string;
  locationIds: string[];
  categories: string[];
  lang: string;
  theme: string;
  accent: string;
  radius: string;
  startStep: string;
  deposit: string;
  cancelPolicy: string;
  domains: string[];
  status: 'live' | 'draft';
}

/** The one pre-auth door of the public surface: the publishable key
 *  resolves the widget (and with it, the tenant). */
async function widgetByKey(key: string): Promise<WidgetRow | undefined> {
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.public', '1', true)`.execute(trx);
    return trx
      .selectFrom('widgets')
      .selectAll()
      .where('publishableKey', '=', key)
      .where('status', '=', 'live')
      .executeTakeFirst();
  });
}
async function widgetBySlug(slug: string): Promise<WidgetRow | undefined> {
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.public', '1', true)`.execute(trx);
    const biz = await trx
      .selectFrom('businesses')
      .select('id')
      .where('slug', '=', slug)
      .executeTakeFirst();
    if (!biz) return undefined;
    return trx
      .selectFrom('widgets')
      .selectAll()
      .where('tenantId', '=', biz.id)
      .where('status', '=', 'live')
      .orderBy('createdAt')
      .executeTakeFirst();
  });
}

async function logEvent(
  trx: Trx,
  tenantId: string,
  widgetId: string | null,
  code: string,
  msg: string,
  fix = '',
  level = 'error',
) {
  await trx
    .insertInto('integrationEvents')
    .values({ tenantId, widgetId, level, code, msg, fix })
    .execute();
}

/** ~30 s availability cache — the widget's endpoint is the real load. */
const availCache = new Map<string, { at: number; data: unknown }>();
const AVAIL_TTL = 30_000;

/** CORS per registered domain: the widget only answers its own sites
 *  (and the hosted page / local dev, which send no cross-site origin
 *  or a velnes one). */
function corsCheck(req: FastifyRequest, reply: FastifyReply, w: WidgetRow): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin / server-side
  let host = '';
  try {
    host = new URL(origin).hostname;
  } catch {
    return false;
  }
  const allowed =
    host === 'localhost' ||
    host.endsWith('velnes.mk') ||
    w.domains.some((d) => host === d || host.endsWith(`.${d}`));
  if (allowed) {
    reply.header('access-control-allow-origin', origin);
    reply.header('vary', 'origin');
  }
  return allowed;
}

export async function publicRoutes(app: FastifyInstance) {
  // Its own, stricter limiter: keyed by publishable key when present.
  await app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
    keyGenerator: (req) =>
      ((req.query as { key?: string })?.key ?? (req.body as { widgetKey?: string })?.widgetKey ?? req.ip) as string,
  });

  const r = app.withTypeProvider<ZodTypeProvider>();

  const resolve = async (
    req: FastifyRequest,
    reply: FastifyReply,
    key: string,
  ): Promise<WidgetRow | null> => {
    const w = await widgetByKey(key);
    if (!w) {
      await reply.code(404).send({ error: 'UNKNOWN_KEY', message: 'Unknown publishable key' });
      return null;
    }
    if (!corsCheck(req, reply, w)) {
      await withTenant(w.tenantId, (trx) =>
        logEvent(
          trx,
          w.tenantId,
          w.id,
          'DOMAIN_NOT_ALLOWED',
          `A request came from ${req.headers.origin ?? 'an unknown origin'}, which is not on the widget's domain list.`,
          'Add the domain under Settings › Online booking, or remove the embed from that site.',
        ),
      );
      await reply.code(403).send({ error: 'DOMAIN_NOT_ALLOWED', message: 'This domain is not registered for the widget' });
      return null;
    }
    return w;
  };

  const widgetPayload = async (w: WidgetRow) =>
    withTenant(w.tenantId, async (trx) => {
      const biz = await trx
        .selectFrom('businesses')
        .select(['name', 'slug'])
        .executeTakeFirstOrThrow();
      const locs = await trx
        .selectFrom('locations')
        .select(['id', 'name', 'city', 'address', 'lifecycle'])
        .where('id', 'in', w.locationIds.length ? w.locationIds : [w.tenantId])
        .execute();
      return {
        businessName: biz.name,
        slug: biz.slug,
        widgetId: w.id,
        publishableKey: w.publishableKey,
        name: w.name,
        lang: (['en', 'mk', 'sq'].includes(w.lang) ? w.lang : 'en') as 'en' | 'mk' | 'sq',
        theme: w.theme,
        accent: w.accent,
        radius: w.radius,
        startStep: w.startStep,
        deposit: w.deposit,
        cancelPolicy: w.cancelPolicy,
        // Only live locations exist to the outside world.
        locations: locs
          .filter((l) => l.lifecycle === 'ACTIVE')
          .map((l) => ({ id: l.id, name: l.name, city: l.city, address: l.address })),
      };
    });

  r.route({
    method: 'GET',
    url: '/widget',
    schema: {
      querystring: KeyQuery,
      response: { 200: PublicWidgetSchema, 403: ErrorSchema, 404: ErrorSchema },
    },
    handler: async (req, reply) => {
      const w = await resolve(req, reply, req.query.key);
      if (!w) return reply;
      return widgetPayload(w);
    },
  });

  r.route({
    method: 'GET',
    url: '/booking-page/:slug',
    schema: {
      params: z.object({ slug: z.string().min(1) }),
      response: { 200: PublicWidgetSchema, 404: ErrorSchema },
    },
    handler: async (req, reply) => {
      const w = await widgetBySlug(req.params.slug);
      if (!w)
        return reply.code(404).send({ error: 'UNKNOWN_SALON', message: 'No booking page here' });
      return widgetPayload(w);
    },
  });

  r.route({
    method: 'GET',
    url: '/services',
    schema: {
      querystring: KeyQuery.extend({ locationId: z.uuid() }),
      response: { 200: PublicServicesResponseSchema, 403: ErrorSchema, 404: ErrorSchema },
    },
    handler: async (req, reply) => {
      const w = await resolve(req, reply, req.query.key);
      if (!w) return reply;
      return withTenant(w.tenantId, async (trx) => {
        if (!(await locLive(trx, req.query.locationId))) return { services: [] };
        const rows = await trx
          .selectFrom('services as s')
          .leftJoin('serviceCategories as c', 'c.id', 's.categoryId')
          .selectAll('s')
          .select('c.name as category')
          .where('s.status', '=', 'active')
          .orderBy('s.sort')
          .execute();
        const out = [];
        for (const s of rows) {
          if (
            !w.categories.includes('all') &&
            !w.categories.includes(s.category ?? '')
          )
            continue;
          const cfg = await svcAt(trx, s.id, req.query.locationId);
          if (!cfg.active || !cfg.online) continue;
          // Only offer what can actually be done here (prototype rule):
          // somebody at this location must do the service.
          const emps = await empsFor(trx, req.query.locationId, s.id);
          if (!emps.length) continue;
          const vs = (await svcVariants(trx, s.id, req.query.locationId)).filter(
            (v) => v.active,
          );
          const groups = await trx
            .selectFrom('serviceModifierGroups')
            .selectAll()
            .where('serviceId', '=', s.id)
            .orderBy('sort')
            .execute();
          const options = groups.length
            ? await trx
                .selectFrom('serviceModifierOptions')
                .selectAll()
                .where('groupId', 'in', groups.map((g) => g.id))
                .orderBy('sort')
                .execute()
            : [];
          out.push({
            id: s.id,
            name: s.name,
            category: s.category,
            durationMin: cfg.durationMin,
            price: cfg.price,
            priceFrom: vs.length ? Math.min(...vs.map((v) => v.price)) : null,
            variants: vs.map((v) => ({
              id: v.id,
              label: v.label,
              durationMin: v.durationMin,
              price: v.price,
              std: v.std,
            })),
            modifiers: groups.map((g) => ({
              id: g.id,
              name: g.name,
              type: g.type,
              required: g.required,
              options: options
                .filter((o) => o.groupId === g.id)
                .map((o) => ({ id: o.id, name: o.name, price: o.price, durationMin: o.durationMin })),
            })),
            employees: emps.map((e) => ({ id: e.id, name: e.name })),
          });
        }
        return { services: out };
      });
    },
  });

  r.route({
    method: 'GET',
    url: '/availability',
    schema: {
      querystring: KeyQuery.extend({
        locationId: z.uuid(),
        serviceId: z.uuid(),
        date: z.iso.date(),
        employeeId: z.union([z.uuid(), z.literal('any')]).default('any'),
        variantId: z.uuid().optional(),
        holdKey: z.string().optional(),
      }),
      response: { 200: AvailabilityResponseSchema, 403: ErrorSchema, 404: ErrorSchema },
    },
    handler: async (req, reply) => {
      const w = await resolve(req, reply, req.query.key);
      if (!w) return reply;
      const q = req.query;
      const cacheKey = `${q.locationId}|${q.serviceId}|${q.date}|${q.variantId ?? ''}|${q.employeeId}`;
      const hit = availCache.get(cacheKey);
      if (hit && Date.now() - hit.at < AVAIL_TTL && !q.holdKey)
        return hit.data as { slots: [] };
      const data = await withTenant(w.tenantId, async (trx) => {
        const exists = await trx
          .selectFrom('services')
          .select('id')
          .where('id', '=', q.serviceId)
          .executeTakeFirst();
        if (!exists) {
          await logEvent(
            trx,
            w.tenantId,
            w.id,
            'SERVICE_NOT_FOUND',
            `Availability was asked for a service that does not exist (${q.serviceId}).`,
            'Remove the service from the widget selection, or restore it in the catalog.',
          );
          return { slots: [] };
        }
        return {
          slots: await availableSlots(trx, {
            locationId: q.locationId,
            serviceId: q.serviceId,
            employeeId: q.employeeId,
            date: q.date,
            variantId: q.variantId ?? null,
            key: q.holdKey,
          }),
        };
      });
      availCache.set(cacheKey, { at: Date.now(), data });
      return data;
    },
  });

  r.route({
    method: 'POST',
    url: '/holds',
    schema: {
      body: PublicHoldRequestSchema.extend({ widgetKey: z.string().min(4) }),
      response: {
        200: HoldResponseSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        409: BookingRefusalSchema,
      },
    },
    handler: async (req, reply) => {
      const w = await resolve(req, reply, req.body.widgetKey);
      if (!w) return reply;
      try {
        return await withTenant(w.tenantId, (trx) =>
          createHold(trx, {
            key: req.body.key,
            locationId: req.body.locationId,
            serviceId: req.body.serviceId,
            date: req.body.date,
            time: req.body.time,
            employeeId: req.body.employeeId,
          }),
        );
      } catch (e) {
        return sendPublicBookingError(reply, e);
      }
    },
  });

  r.route({
    method: 'POST',
    url: '/book',
    schema: {
      body: PublicBookRequestSchema.extend({ widgetKey: z.string().min(4) }),
      response: {
        200: PublicBookResponseSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        409: BookingRefusalSchema,
      },
    },
    handler: async (req, reply) => {
      const w = await resolve(req, reply, req.body.widgetKey);
      if (!w) return reply;
      try {
        const out = await withTenant(w.tenantId, async (trx) => {
          const a = await confirmBooking(trx, null, {
            key: req.body.key,
            locationId: req.body.locationId,
            serviceId: req.body.serviceId,
            date: req.body.date,
            time: req.body.time,
            employeeId: req.body.employeeId,
            variantId: req.body.variantId ?? null,
            modifierOptionIds: req.body.modifierOptionIds,
            name: req.body.name,
            phone: req.body.phone,
            ...(req.body.email ? { email: req.body.email } : {}),
            source: 'widget',
            deposit: 0,
          });
          // Attribute the booking to its widget for the stats card.
          await trx
            .updateTable('appointments')
            .set({ widgetId: w.id })
            .where('id', '=', a.id)
            .where('widgetId', 'is', null)
            .execute();
          const [locRow, empRow] = await Promise.all([
            trx.selectFrom('locations').select('name').where('id', '=', a.locationId).executeTakeFirst(),
            a.employeeId
              ? trx.selectFrom('employees').select('name').where('id', '=', a.employeeId).executeTakeFirst()
              : Promise.resolve(undefined),
          ]);
          return {
            ref: a.id,
            date: a.date,
            time: a.start,
            end: a.end,
            serviceName: a.serviceName ?? '',
            locationName: locRow?.name ?? '',
            employeeName: empRow?.name ?? '',
            price: a.price,
          };
        });
        // A confirmed booking frees the cache for that day.
        for (const k of availCache.keys())
          if (k.startsWith(`${req.body.locationId}|`)) availCache.delete(k);
        return out;
      } catch (e) {
        return sendPublicBookingError(reply, e);
      }
    },
  });
}

function sendPublicBookingError(reply: FastifyReply, e: unknown) {
  if (e instanceof BookingRefused)
    return reply.code(409).send({
      error: 'REFUSED' as const,
      message: e.message,
      code: e.code,
      params: e.params,
    });
  if (e instanceof BookingError)
    return reply.code(404).send({ error: e.code, message: e.message });
  throw e;
}
