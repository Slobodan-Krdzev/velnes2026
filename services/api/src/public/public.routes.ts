import rateLimit from '@fastify/rate-limit';
import {
  AvailabilityResponseSchema,
  BookingRefusalSchema,
  BusinessSettingsSchema,
  CONSUMER_KEY_PREFIX,
  HoldResponseSchema,
  PublicBookRequestSchema,
  PublicBookResponseSchema,
  PublicChainSlotsRequestSchema,
  PublicHoldRequestSchema,
  PublicPayQuoteRequestSchema,
  PublicPayRequestSchema,
  PublicServicesResponseSchema,
  PublicWidgetSchema,
  PayQuoteSchema,
  PayResultSchema,
} from '@velnes/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { z } from 'zod';
import { db, withTenant, type Trx } from '../db/index.js';
import {
  chainAvailability,
  availableSlots,
  BookingError,
  BookingRefused,
  confirmChain,
  createHold,
  empsFor,
} from '../modules/booking/booking.service.js';
import { afterBooked, guestPayToken } from '../modules/booking/requests.service.js';
import { payAppointment, quotePayment } from '../modules/payments/payments.service.js';
import { svcAt, svcVariants } from '../modules/catalog/catalog.service.js';
import { locLive } from '../modules/locations/locations.service.js';
import { discoveryRoutes } from './discovery.routes.js';

const ErrorSchema = z.object({ error: z.string(), message: z.string() });
const KeyQuery = z.object({ key: z.string().min(4) });

interface WidgetRow {
  /** The consumer app's own key (`salon:<slug>`): no widget row behind
   *  it, so nothing is attributed to a widget and no domain list applies. */
  consumer?: true;
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

/**
 * The consumer app books without a widget: `salon:<slug>` resolves to
 * a virtual row over the salon's ACTIVE locations. A salon is on the
 * Velnes app once HQ approved it with live services; the website widget
 * is a separate product it may or may not have (Alex, 2026-09-22).
 */
async function consumerRow(slug: string): Promise<WidgetRow | undefined> {
  const biz = await db.transaction().execute(async (trx) => {
    await sql`select set_config('app.public', '1', true)`.execute(trx);
    return trx
      .selectFrom('businesses')
      .select(['id', 'name', 'settings'])
      .where('slug', '=', slug)
      .executeTakeFirst();
  });
  if (!biz) return undefined;
  const parsed = BusinessSettingsSchema.safeParse(biz.settings ?? {});
  if (!parsed.success || !parsed.data.marketplace.listed) return undefined;
  const locs = await withTenant(biz.id, (trx) =>
    trx.selectFrom('locations').select('id').where('lifecycle', '=', 'ACTIVE').orderBy('createdAt').execute(),
  );
  if (!locs.length) return undefined;
  return {
    consumer: true,
    id: '',
    tenantId: biz.id,
    name: biz.name,
    publishableKey: `${CONSUMER_KEY_PREFIX}${slug}`,
    locationIds: locs.map((l) => l.id),
    categories: ['all'],
    lang: 'en',
    theme: '',
    accent: '',
    radius: '',
    startStep: '',
    deposit: '',
    cancelPolicy: '',
    domains: [],
    status: 'live',
  };
}

/** The one pre-auth door of the public surface: the publishable key
 *  resolves the widget (and with it, the tenant) — or, for the consumer
 *  app's `salon:<slug>`, the salon itself. */
async function widgetByKey(key: string): Promise<WidgetRow | undefined> {
  if (key.startsWith(CONSUMER_KEY_PREFIX)) return consumerRow(key.slice(CONSUMER_KEY_PREFIX.length));
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
  if (w.consumer) return true; // the platform's own app: no domain list, the server's CORS applies
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

  // The consumer app's key-free discovery doors share this scope (and
  // with it, the public rate limiter).
  await app.register(discoveryRoutes);

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
          w.consumer ? null : w.id,
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

  guestPayRoutes(app, resolve);

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
      // The widget's own configuration door: a consumer key has none.
      if (w.consumer) return reply.code(404).send({ error: 'UNKNOWN_KEY', message: 'Unknown publishable key' });
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
            w.consumer ? null : w.id,
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

  // Free times for a whole visit: several treatments, one answer. A
  // POST because the question carries a list, not because it writes.
  r.route({
    method: 'POST',
    url: '/slots',
    schema: {
      body: PublicChainSlotsRequestSchema,
      response: { 200: AvailabilityResponseSchema, 403: ErrorSchema, 404: ErrorSchema },
    },
    handler: async (req, reply) => {
      const w = await resolve(req, reply, req.body.key);
      if (!w) return reply;
      const b = req.body;
      return withTenant(w.tenantId, (trx) =>
        chainAvailability(trx, {
          locationId: b.locationId,
          items: b.items,
          employeeId: b.employeeId,
          date: b.date,
        }),
      );
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
          const items = req.body.items ?? [
            {
              serviceId: req.body.serviceId,
              variantId: req.body.variantId ?? null,
              modifierOptionIds: req.body.modifierOptionIds,
            },
          ];
          const booked = await confirmChain(trx, null, {
            key: req.body.key,
            locationId: req.body.locationId,
            date: req.body.date,
            time: req.body.time,
            employeeId: req.body.employeeId,
            items,
            name: req.body.name,
            phone: req.body.phone,
            ...(req.body.email ? { email: req.body.email } : {}),
            source: w.consumer ? 'marketplace' : 'widget',
            deposit: 0,
          });
          // Attribute the visit to its widget for the stats card — a
          // consumer booking has no widget to be attributed to.
          if (!w.consumer)
            await trx
              .updateTable('appointments')
              .set({ widgetId: w.id })
              .where(
                'id',
                'in',
                booked.map((a) => a.id),
              )
              .where('widgetId', 'is', null)
              .execute();
          // A Velnes-app guest rings the salon's bell and gets a mail
          // like anyone else; a widget booking stays the widget's own.
          if (w.consumer)
            await afterBooked(trx, {
              tenantId: w.tenantId,
              booked,
              customerName: req.body.name,
              customerEmail: req.body.email ?? null,
              clientUserId: null,
            });
          const payload = await visitPayload(trx, booked);
          // A guest's key to the payment doors — theirs alone.
          return w.consumer ? { ...payload, payToken: guestPayToken(payload.ref) } : payload;
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

/**
 * A guest's payment doors. The salon key names the tenant; the token
 * (handed out with the booking, or in the acceptance mail) proves the
 * guest may act on that one appointment. Signed-in clients use the
 * client doors instead.
 */
export function guestPayRoutes(app: FastifyInstance, resolve: (req: FastifyRequest, reply: FastifyReply, key: string) => Promise<WidgetRow | null>) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const admit = async (req: FastifyRequest, reply: FastifyReply, key: string, appointmentId: string, token: string) => {
    const w = await resolve(req, reply, key);
    if (!w) return null;
    if (!w.consumer || token !== guestPayToken(appointmentId)) {
      await reply.code(403).send({ error: 'FORBIDDEN', message: 'This link does not open that appointment' });
      return null;
    }
    return w;
  };

  r.route({
    method: 'POST',
    url: '/pay/quote',
    schema: { body: PublicPayQuoteRequestSchema, response: { 200: PayQuoteSchema, 403: ErrorSchema, 404: ErrorSchema, 409: BookingRefusalSchema } },
    handler: async (req, reply) => {
      const w = await admit(req, reply, req.body.key, req.body.appointmentId, req.body.token);
      if (!w) return reply;
      try {
        return await withTenant(w.tenantId, (trx) => quotePayment(trx, req.body));
      } catch (e) {
        return sendPublicBookingError(reply, e);
      }
    },
  });

  r.route({
    method: 'POST',
    url: '/pay',
    schema: { body: PublicPayRequestSchema, response: { 200: PayResultSchema, 403: ErrorSchema, 404: ErrorSchema, 409: BookingRefusalSchema } },
    handler: async (req, reply) => {
      const w = await admit(req, reply, req.body.key, req.body.appointmentId, req.body.token);
      if (!w) return reply;
      try {
        // A guest never keeps a card: the request's saveCard is ignored.
        return await withTenant(w.tenantId, (trx) =>
          payAppointment(trx, w.tenantId, { ...req.body, saveCard: false }, { clientUserId: null }),
        );
      } catch (e) {
        return sendPublicBookingError(reply, e);
      }
    },
  });
}

/** The visit as the app shows it: the whole span up front, a line per
 *  treatment underneath. A single booking is a visit of one. */
export async function visitPayload(trx: Trx, booked: { id: string; locationId: string; employeeId: string | null; date: string; start: string; end: string; price: number; serviceName: string | null; status?: string }[]) {
  const first = booked[0]!;
  const last = booked[booked.length - 1]!;
  const locRow = await trx
    .selectFrom('locations')
    .select('name')
    .where('id', '=', first.locationId)
    .executeTakeFirst();
  const empIds = [...new Set(booked.map((a) => a.employeeId).filter((x): x is string => Boolean(x)))];
  const emps = empIds.length
    ? await trx.selectFrom('employees').select(['id', 'name']).where('id', 'in', empIds).execute()
    : [];
  const nameOf = (id: string | null) => (id ? (emps.find((e) => e.id === id)?.name ?? '') : '');
  return {
    ref: first.id,
    date: first.date,
    time: first.start,
    end: last.end,
    serviceName: booked.map((a) => a.serviceName ?? '').filter(Boolean).join(' + '),
    items: booked.map((a) => ({
      ref: a.id,
      serviceName: a.serviceName ?? '',
      time: a.start,
      end: a.end,
      price: a.price,
      employeeName: nameOf(a.employeeId),
    })),
    locationName: locRow?.name ?? '',
    employeeName: nameOf(first.employeeId),
    status: first.status === 'requested' ? ('requested' as const) : ('booked' as const),
    price: booked.reduce((n, a) => n + a.price, 0),
  };
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
