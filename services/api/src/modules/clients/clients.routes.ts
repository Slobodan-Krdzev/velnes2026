import rateLimit from '@fastify/rate-limit';
import {
  ClientAppointmentsSchema,
  ClientBookRequestSchema,
  ClientLoginSchema,
  ClientNotificationsSchema,
  ClientPasswordSchema,
  ClientPendingSchema,
  ClientProfilePatchSchema,
  ClientProfileSchema,
  ClientRegisterSchema,
  ClientResendSchema,
  ClientFavouritesSchema,
  ClientSalonLinksSchema,
  ClientOffersSchema,
  FavouriteKindSchema,
  ClientSessionSchema,
  ClientVerifySchema,
  PublicBookResponseSchema,
  BookingRefusalSchema,
  PayQuoteRequestSchema,
  PayQuoteSchema,
  PayRequestSchema,
  PayResultSchema,
  ClientCardsSchema,
  type ClientOffer,
} from '@velnes/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { z } from 'zod';
import { db, withClient, withHq, withTenant } from '../../db/index.js';
import { env } from '../../env.js';
import { BookingError, BookingRefused, confirmChain } from '../booking/booking.service.js';
import { afterBooked } from '../booking/requests.service.js';
import { payAppointment, quotePayment } from '../payments/payments.service.js';
import { randomBytes } from 'node:crypto';
import { visitPayload } from '../../public/public.routes.js';
import { personalOffersFor } from '../customers/customers.service.js';
import {
  addFavourite,
  listFavourites,
  removeFavourite,
} from './favourites.service.js';
import {
  changeClientPassword,
  ClientError,
  clientById,
  clientSalons,
  linkCustomer,
  loginClient,
  notifyClient,
  notifySalon,
  registerClient,
  resendClientCode,
  toProfile,
  verifyClientEmail,
} from './clients.service.js';

const ErrorSchema = z.object({ error: z.string(), message: z.string() });
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const localIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The consumer surface: its own narrow plugin scope, like the widget's
 *  — its own rate limit, its own token shape, and no reach at all into
 *  the authenticated staff API. */
/**
 * "My appointments", across every salon. The rows are read under the
 * client's own context — their RLS policy on appointments is what makes
 * that possible — but the *names* (salon, location, service, employee)
 * live in tenant-scoped tables a client context cannot see. So each
 * salon's own context fills in its own labels. No joins across a
 * boundary the database is right to refuse.
 */
/**
 * The personal offers a client can act on, across every salon they are
 * a customer of — same shape as `myAppointments`: the links under the
 * client's own context, each salon's context for its own offers and
 * labels, the public context for the salon's name. Live only: the
 * marketplace shows what can still be booked, not the history.
 */
async function myOffers(clientUserId: string): Promise<ClientOffer[]> {
  const links = await withClient(clientUserId, (trx) =>
    trx.selectFrom('clientCustomerLinks').select(['tenantId', 'customerId']).execute(),
  );
  const out: ClientOffer[] = [];
  for (const l of links) {
    const biz = await db.transaction().execute(async (trx) => {
      await sql`select set_config('app.public', '1', true)`.execute(trx);
      return trx.selectFrom('businesses').select(['name', 'slug']).where('id', '=', l.tenantId).executeTakeFirst();
    });
    if (!biz) continue;
    const rows = await withTenant(l.tenantId, async (trx) => {
      const offers = (await personalOffersFor(trx, l.customerId)).filter((o) => o.status === 'live');
      if (!offers.length) return [];
      const [locs, vars] = await Promise.all([
        trx.selectFrom('locations').select(['id', 'name']).execute(),
        trx.selectFrom('serviceVariants').select(['id', 'label']).execute(),
      ]);
      return offers.map((o) => ({
        id: o.id,
        salon: { slug: biz.slug, name: biz.name },
        locationId: o.locationId,
        locationName: locs.find((x) => x.id === o.locationId)?.name ?? '',
        serviceId: o.serviceId,
        serviceName: o.serviceName,
        variantId: o.variantId,
        variantLabel: o.variantId ? (vars.find((v) => v.id === o.variantId)?.label ?? null) : null,
        specialPrice: o.specialPrice,
        normalPrice: o.normalPrice,
        validUntil: o.validUntil,
        intent: o.intent,
      }));
    });
    out.push(...rows);
  }
  // Soonest to expire first: the one to act on now.
  return out.sort((a, b) => a.validUntil.localeCompare(b.validUntil));
}

async function myAppointments(clientUserId: string) {
  const rows = await withClient(clientUserId, (trx) =>
    trx
      .selectFrom('appointments')
      .select([
        'id',
        'tenantId',
        'locationId',
        'serviceId',
        'variantId',
        'employeeId',
        'date',
        'startMin',
        'durationMin',
        'price',
        'status',
        'title',
      ])
      .where('clientUserId', '=', clientUserId)
      .orderBy('date', 'desc')
      .orderBy('startMin', 'desc')
      .execute(),
  );
  if (!rows.length) return [];
  const tenants = [...new Set(rows.map((a) => a.tenantId))];
  const salons = new Map<string, { name: string; slug: string | null }>();
  await Promise.all(
    tenants.map(async (t) => {
      const biz = await db.transaction().execute(async (trx) => {
        await sql`select set_config('app.public', '1', true)`.execute(trx);
        return trx.selectFrom('businesses').select(['name', 'slug']).where('id', '=', t).executeTakeFirst();
      });
      if (biz) salons.set(t, biz);
    }),
  );
  const out = [];
  for (const t of tenants) {
    const mine = rows.filter((a) => a.tenantId === t);
    const labels = await withTenant(t, async (trx) => {
      const [locs, svcs, vars, emps] = await Promise.all([
        trx.selectFrom('locations').select(['id', 'name', 'address', 'lat', 'lng', 'cancelHours']).execute(),
        trx.selectFrom('services').select(['id', 'name']).execute(),
        trx.selectFrom('serviceVariants').select(['id', 'label']).execute(),
        trx.selectFrom('employees').select(['id', 'name']).execute(),
      ]);
      return { locs, svcs, vars, emps };
    });
    for (const a of mine) {
      const loc = labels.locs.find((l) => l.id === a.locationId);
      const svc = labels.svcs.find((x) => x.id === a.serviceId);
      const variant = labels.vars.find((v) => v.id === a.variantId);
      const emp = labels.emps.find((e) => e.id === a.employeeId);
      const salon = salons.get(t);
      out.push({
        id: a.id,
        ref: a.id.slice(0, 8).toUpperCase(),
        salonName: salon?.name ?? '',
        salonSlug: salon?.slug ?? null,
        locationName: loc?.name ?? '',
        locationAddress: loc?.address ?? null,
        lat: loc?.lat ?? null,
        lng: loc?.lng ?? null,
        serviceName: variant
          ? `${svc?.name ?? a.title} · ${variant.label}`
          : (svc?.name ?? a.title),
        employeeName: emp?.name ?? null,
        date: localIso(a.date),
        time: hhmm(a.startMin),
        end: hhmm(a.startMin + a.durationMin),
        durationMin: a.durationMin,
        price: a.price,
        status: a.status,
        cancelHours: loc?.cancelHours ?? 24,
      });
    }
  }
  // Newest first across every salon.
  return out.sort((x, y) => (x.date === y.date ? y.time.localeCompare(x.time) : y.date.localeCompare(x.date)));
}

/** A signed-in client's payment doors: their own appointment, their
 *  own token — no capability needed. */
function clientPayRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const own = async (clientUserId: string, appointmentId: string) =>
    withClient(clientUserId, (trx) =>
      trx
        .selectFrom('appointments')
        .select('tenantId')
        .where('id', '=', appointmentId)
        .where('clientUserId', '=', clientUserId)
        .executeTakeFirst(),
    );

  r.route({
    method: 'POST',
    url: '/pay/quote',
    preHandler: [app.authenticateClient],
    schema: { body: PayQuoteRequestSchema, response: { 200: PayQuoteSchema, 404: ErrorSchema, 409: BookingRefusalSchema } },
    handler: async (req, reply) => {
      const a = await own(req.clientClaims.sub, req.body.appointmentId);
      if (!a) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown appointment' });
      try {
        return await withTenant(a.tenantId, (trx) => quotePayment(trx, req.body));
      } catch (e) {
        if (e instanceof BookingRefused)
          return reply.code(409).send({ error: 'REFUSED' as const, message: e.message, code: e.code, params: e.params });
        throw e;
      }
    },
  });

  r.route({
    method: 'POST',
    url: '/pay',
    preHandler: [app.authenticateClient],
    schema: { body: PayRequestSchema, response: { 200: PayResultSchema, 404: ErrorSchema, 409: BookingRefusalSchema } },
    handler: async (req, reply) => {
      const id = req.clientClaims.sub;
      const a = await own(id, req.body.appointmentId);
      if (!a) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown appointment' });
      try {
        // A saved card is charged through its provider token — the
        // form never sees the number again. A new card may be kept.
        let charged: { ref: string; brand: string; last4: string } | undefined;
        if (req.body.method === 'card' && req.body.savedCardId) {
          const card = await withClient(id, (trx) =>
            trx
              .selectFrom('clientPaymentMethods')
              .select(['brand', 'last4', 'providerRef', 'expMonth', 'expYear'])
              .where('id', '=', req.body.savedCardId!)
              .executeTakeFirst(),
          );
          if (!card) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown card' });
          if (new Date(card.expYear, card.expMonth, 0) < new Date())
            return reply.code(409).send({ error: 'REFUSED' as const, message: 'That card has expired', code: 'CARD_DECLINED', params: {} });
          charged = { ref: `mock_ch_${randomBytes(9).toString('base64url')}`, brand: card.brand, last4: card.last4 };
        }
        const out = await withTenant(a.tenantId, (trx) =>
          payAppointment(trx, a.tenantId, req.body, { clientUserId: id, charged }),
        );
        if (out.status === 'paid' && req.body.method === 'card' && req.body.saveCard && req.body.card && !req.body.savedCardId) {
          const c = req.body.card;
          const digits = c.number.replace(/[\s-]/g, '');
          const dup = await withClient(id, (trx) =>
            trx
              .selectFrom('clientPaymentMethods')
              .select('id')
              .where('last4', '=', digits.slice(-4))
              .where('expMonth', '=', c.expMonth)
              .where('expYear', '=', c.expYear)
              .executeTakeFirst(),
          );
          if (!dup)
            await withClient(id, (trx) =>
              trx
                .insertInto('clientPaymentMethods')
                .values({
                  clientUserId: id,
                  brand: out.card?.brand ?? 'Card',
                  last4: digits.slice(-4),
                  expMonth: c.expMonth,
                  expYear: c.expYear,
                  holder: c.holder,
                  providerRef: `mock_pm_${randomBytes(9).toString('base64url')}`,
                })
                .execute(),
            );
        }
        if (out.status === 'paid')
          await notifyClient(id, {
            kind: 'appointment',
            title: 'Payment received',
            body: `${out.amount} MKD paid${out.card ? ` with ${out.card.brand}${out.card.last4 ? ` ••${out.card.last4}` : ''}` : ''}. Invoice ${out.invoiceNumber ?? ''}.`,
            refType: 'appointment',
            refId: req.body.appointmentId,
          });
        return out;
      } catch (e) {
        if (e instanceof BookingRefused)
          return reply.code(409).send({ error: 'REFUSED' as const, message: e.message, code: e.code, params: e.params });
        throw e;
      }
    },
  });
}

/** The account's saved cards: list and forget. Adding one happens at
 *  checkout ("save this card"), never here — a card is saved by using it. */
function clientCardRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.route({
    method: 'GET',
    url: '/me/cards',
    preHandler: [app.authenticateClient],
    schema: { response: { 200: ClientCardsSchema } },
    handler: async (req) => {
      const rows = await withClient(req.clientClaims.sub, (trx) =>
        trx
          .selectFrom('clientPaymentMethods')
          .select(['id', 'brand', 'last4', 'expMonth', 'expYear', 'holder', 'createdAt'])
          .orderBy('createdAt', 'desc')
          .execute(),
      );
      return { cards: rows.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })) };
    },
  });
  r.route({
    method: 'DELETE',
    url: '/me/cards/:id',
    preHandler: [app.authenticateClient],
    schema: { params: z.object({ id: z.uuid() }), response: { 200: z.object({ ok: z.literal(true) }), 404: ErrorSchema } },
    handler: async (req, reply) => {
      const gone = await withClient(req.clientClaims.sub, (trx) =>
        trx.deleteFrom('clientPaymentMethods').where('id', '=', req.params.id).returning('id').executeTakeFirst(),
      );
      if (!gone) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown card' });
      return { ok: true as const };
    },
  });
}

export async function clientRoutes(app: FastifyInstance) {
  await app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
  });
  clientPayRoutes(app);
  clientCardRoutes(app);

  const r = app.withTypeProvider<ZodTypeProvider>();

  const session = async (c: Awaited<ReturnType<typeof clientById>>, reply: FastifyReply) => ({
    token: await reply.jwtSign(
      { cli: true as const, sub: c.id, email: c.email },
      { expiresIn: '30d' },
    ),
    profile: toProfile(c),
  });

  const fail = (reply: FastifyReply, e: unknown) => {
    if (e instanceof ClientError)
      return reply.code(e.code === 'NOT_FOUND' ? 404 : 400).send({ error: e.code, message: e.message });
    throw e;
  };

  // ---- registration and the email code ----------------------------

  r.route({
    method: 'POST',
    url: '/register',
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    schema: { body: ClientRegisterSchema, response: { 200: ClientPendingSchema } },
    handler: async (req) => {
      await registerClient(req.body);
      return { pending: true as const };
    },
  });

  r.route({
    method: 'POST',
    url: '/resend-code',
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    schema: { body: ClientResendSchema, response: { 200: ClientPendingSchema } },
    handler: async (req) => {
      await resendClientCode(req.body.email);
      return { pending: true as const };
    },
  });

  r.route({
    method: 'POST',
    url: '/verify-email',
    config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
    schema: {
      body: ClientVerifySchema,
      response: { 200: ClientSessionSchema, 400: ErrorSchema },
    },
    handler: async (req, reply) => {
      try {
        const c = await verifyClientEmail(req.body.email, req.body.code);
        await notifyClient(c.id, {
          kind: 'account',
          title: 'Welcome to Velnes',
          body: 'Your account is ready. Find a salon and book your first appointment.',
          refType: 'general',
        });
        return await session(c, reply);
      } catch (e) {
        return fail(reply, e);
      }
    },
  });

  r.route({
    method: 'POST',
    url: '/login',
    config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
    schema: { body: ClientLoginSchema, response: { 200: ClientSessionSchema, 400: ErrorSchema } },
    handler: async (req, reply) => {
      try {
        const c = await loginClient(req.body.email, req.body.password);
        return await session(c, reply);
      } catch (e) {
        return fail(reply, e);
      }
    },
  });

  // ---- the account -------------------------------------------------

  r.route({
    method: 'GET',
    url: '/me',
    preHandler: [app.authenticateClient],
    schema: { response: { 200: ClientProfileSchema, 404: ErrorSchema } },
    handler: async (req, reply) => {
      try {
        return toProfile(await clientById(req.clientClaims.sub));
      } catch (e) {
        return fail(reply, e);
      }
    },
  });

  r.route({
    method: 'PATCH',
    url: '/me',
    preHandler: [app.authenticateClient],
    schema: {
      body: ClientProfilePatchSchema,
      response: { 200: ClientProfileSchema, 404: ErrorSchema },
    },
    handler: async (req, reply) => {
      const id = req.clientClaims.sub;
      const b = req.body;
      try {
        await withClient(id, (trx) =>
          trx
            .updateTable('clientUsers')
            .set({
              ...(b.first !== undefined ? { first: b.first } : {}),
              ...(b.last !== undefined ? { last: b.last } : {}),
              ...(b.phone !== undefined ? { phone: b.phone } : {}),
              ...(b.dob !== undefined ? { dob: b.dob } : {}),
              ...(b.lang !== undefined ? { lang: b.lang } : {}),
              ...(b.avatar !== undefined ? { avatar: b.avatar } : {}),
              ...(b.personalisedResults !== undefined
                ? { personalisedResults: b.personalisedResults }
                : {}),
              ...(b.locationAllowed !== undefined ? { locationAllowed: b.locationAllowed } : {}),
            })
            .where('id', '=', id)
            .execute(),
        );
        return toProfile(await clientById(id));
      } catch (e) {
        return fail(reply, e);
      }
    },
  });

  r.route({
    method: 'POST',
    url: '/me/password',
    preHandler: [app.authenticateClient],
    schema: {
      body: ClientPasswordSchema,
      response: { 200: z.object({ ok: z.literal(true) }), 400: ErrorSchema },
    },
    handler: async (req, reply) => {
      try {
        await changeClientPassword(req.clientClaims.sub, req.body.current, req.body.next);
        return { ok: true as const };
      } catch (e) {
        return fail(reply, e);
      }
    },
  });

  // ---- offers made to me, across every salon ------------------------

  r.route({
    method: 'GET',
    url: '/me/offers',
    preHandler: [app.authenticateClient],
    schema: { response: { 200: ClientOffersSchema } },
    handler: async (req) => ({ offers: await myOffers(req.clientClaims.sub) }),
  });

  r.route({
    method: 'GET',
    url: '/me/salons',
    preHandler: [app.authenticateClient],
    schema: { response: { 200: ClientSalonLinksSchema } },
    handler: async (req) => ({ salons: await clientSalons(req.clientClaims.sub) }),
  });

  // ---- my appointments, across every salon -------------------------

  r.route({
    method: 'GET',
    url: '/me/appointments',
    preHandler: [app.authenticateClient],
    schema: { response: { 200: ClientAppointmentsSchema } },
    handler: async (req) => ({ appointments: await myAppointments(req.clientClaims.sub) }),
  });

  r.route({
    method: 'POST',
    url: '/me/appointments/:id/cancel',
    preHandler: [app.authenticateClient],
    schema: {
      params: z.object({ id: z.uuid() }),
      response: { 200: z.object({ ok: z.literal(true) }), 404: ErrorSchema, 409: ErrorSchema },
    },
    handler: async (req, reply) => {
      const id = req.clientClaims.sub;
      // Read it under the client's own context: only their own rows.
      const a = await withClient(id, (trx) =>
        trx
          .selectFrom('appointments')
          .select(['id', 'tenantId', 'status', 'date', 'startMin', 'locationId'])
          .where('id', '=', req.params.id)
          .where('clientUserId', '=', id)
          .executeTakeFirst(),
      );
      if (!a) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown appointment' });
      if (a.status === 'cancelled')
        return reply.code(409).send({ error: 'ALREADY_CANCELLED', message: 'Already cancelled' });
      const c = await clientById(id);
      // The write happens in the salon's own context — its calendar,
      // its history, its bell.
      await withTenant(a.tenantId, async (trx) => {
        await trx
          .updateTable('appointments')
          .set({ status: 'cancelled' })
          .where('id', '=', a.id)
          .execute();
        await trx
          .insertInto('appointmentHistory')
          .values({
            tenantId: a.tenantId,
            appointmentId: a.id,
            what: 'Cancelled',
            byName: `${c.first} ${c.last}`.trim() || c.email,
            source: 'client',
          })
          .execute();
        await notifySalon(trx, a.tenantId, {
          kind: 'booking',
          title: 'Appointment cancelled',
          body: `${`${c.first} ${c.last}`.trim() || c.email} cancelled their appointment on ${localIso(a.date)} at ${hhmm(a.startMin)}.`,
          refId: a.id,
        });
      });
      await notifyClient(id, {
        kind: 'appointment',
        title: 'Appointment cancelled',
        body: `Your appointment on ${localIso(a.date)} at ${hhmm(a.startMin)} is cancelled.`,
        refType: 'appointment',
        refId: a.id,
      });
      return { ok: true as const };
    },
  });

  // ---- the bell ----------------------------------------------------

  /**
   * Favourites — Phase C, docs/FAVOURITES.md.
   *
   * One read door, not two. The hearts scattered across discovery need
   * to know what is already saved, and the obvious shortcut is a second,
   * leaner "just the ids" endpoint — which is exactly how a concept
   * grows a second door that later disagrees with the first. The app
   * derives its heart states from this same response.
   */
  r.route({
    method: 'GET',
    url: '/me/favourites',
    preHandler: [app.authenticateClient],
    schema: { response: { 200: ClientFavouritesSchema } },
    handler: async (req) => listFavourites(req.clientClaims.sub),
  });

  r.route({
    method: 'PUT',
    url: '/me/favourites/:kind/:id',
    preHandler: [app.authenticateClient],
    schema: {
      params: z.object({ kind: FavouriteKindSchema, id: z.uuid() }),
      response: { 200: z.object({ ok: z.literal(true) }), 404: ErrorSchema },
    },
    // Idempotent: pressing a filled heart again is not an error, and a
    // heart that errored because it was already filled would be a
    // strange thing to explain to anybody.
    handler: async (req, reply) => {
      const r2 = await addFavourite(req.clientClaims.sub, req.params.kind, req.params.id);
      if (r2 === 'unknown')
        return reply.code(404).send({ error: 'UNKNOWN_TARGET', message: 'Nothing to save here' });
      return { ok: true as const };
    },
  });

  r.route({
    method: 'DELETE',
    url: '/me/favourites/:kind/:id',
    preHandler: [app.authenticateClient],
    schema: {
      params: z.object({ kind: FavouriteKindSchema, id: z.uuid() }),
      response: { 200: z.object({ ok: z.literal(true) }) },
    },
    handler: async (req) => {
      await removeFavourite(req.clientClaims.sub, req.params.kind, req.params.id);
      return { ok: true as const };
    },
  });

  r.route({
    method: 'GET',
    url: '/me/notifications',
    preHandler: [app.authenticateClient],
    schema: { response: { 200: ClientNotificationsSchema } },
    handler: async (req) => {
      const rows = await withClient(req.clientClaims.sub, (trx) =>
        trx
          .selectFrom('clientNotifications')
          .selectAll()
          .orderBy('createdAt', 'desc')
          .limit(50)
          .execute(),
      );
      return {
        notifications: rows.map((n) => ({
          id: n.id,
          kind: n.kind,
          title: n.title,
          body: n.body,
          refType: n.refType,
          refId: n.refId,
          read: n.readAt !== null,
          at: n.createdAt.toISOString(),
        })),
        unread: rows.filter((n) => n.readAt === null).length,
      };
    },
  });

  r.route({
    method: 'POST',
    url: '/me/notifications/read',
    preHandler: [app.authenticateClient],
    schema: {
      body: z.object({ id: z.uuid().nullable().default(null) }),
      response: { 200: z.object({ ok: z.literal(true) }) },
    },
    handler: async (req) => {
      const id = req.clientClaims.sub;
      await withClient(id, (trx) => {
        let q = trx.updateTable('clientNotifications').set({ readAt: new Date() });
        if (req.body.id) q = q.where('id', '=', req.body.id);
        return q.where('readAt', 'is', null).execute();
      });
      return { ok: true as const };
    },
  });

  // ---- booking, signed in ------------------------------------------

  r.route({
    method: 'POST',
    url: '/book',
    preHandler: [app.authenticateClient],
    schema: {
      body: ClientBookRequestSchema,
      response: {
        200: PublicBookResponseSchema,
        404: ErrorSchema,
        409: BookingRefusalSchema,
      },
    },
    handler: async (req, reply) => {
      const c = await clientById(req.clientClaims.sub);
      // The salon is named by its public slug; resolve it the same way
      // the discovery doors do.
      const biz = await db.transaction().execute(async (trx) => {
        await sql`select set_config('app.public', '1', true)`.execute(trx);
        return trx
          .selectFrom('businesses')
          .select(['id', 'name'])
          .where('slug', '=', req.body.slug)
          .executeTakeFirst();
      });
      if (!biz) return reply.code(404).send({ error: 'UNKNOWN_SALON', message: 'No salon here' });
      try {
        const out = await withTenant(biz.id, async (trx) => {
          // Booking is what makes someone a customer of this salon.
          const customerId = await linkCustomer(trx, biz.id, {
            id: c.id,
            email: c.email,
            first: c.first,
            last: c.last,
            phone: c.phone,
          });
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
            customerId,
            name: `${c.first} ${c.last}`.trim() || c.email,
            phone: c.phone ?? '',
            email: c.email,
            source: 'client',
            deposit: 0,
          });
          // Every treatment in the visit belongs to this account.
          await trx
            .updateTable('appointments')
            .set({ clientUserId: c.id })
            .where(
              'id',
              'in',
              booked.map((a) => a.id),
            )
            .execute();
          const out = await visitPayload(trx, booked);
          const notice = await afterBooked(trx, {
            tenantId: biz.id,
            booked,
            customerName: `${c.first} ${c.last}`.trim() || c.email,
            customerEmail: c.email,
            clientUserId: c.id,
          });
          return { out, notice };
        }).then(async ({ out, notice }) => {
          if (notice) await notifyClient(c.id, notice);
          return out;
        });
        return out;
      } catch (e) {
        if (e instanceof BookingRefused)
          return reply
            .code(409)
            .send({ error: 'REFUSED' as const, message: e.message, code: e.code, params: e.params });
        if (e instanceof BookingError)
          return reply.code(404).send({ error: e.code, message: e.message });
        throw e;
      }
    },
  });

  // Dev convenience the mock transport makes honest: with no SMTP
  // provider decided, the code lives in the outbox. Never in production.
  if (env.mailTransport === 'mock') {
    r.route({
      method: 'GET',
      url: '/dev/last-code',
      schema: {
        querystring: z.object({ email: z.email() }),
        response: { 200: z.object({ code: z.string().nullable() }) },
      },
      handler: async (req) => {
        const row = await withHq((trx) =>
          trx
            .selectFrom('mailOutbox')
            .select('body')
            .where('toEmail', '=', req.query.email.toLowerCase())
            .where('kind', '=', 'client_email_verify')
            .orderBy('sentAt', 'desc')
            .executeTakeFirst(),
        );
        const m = row?.body.match(/code is (\d{6})/);
        return { code: m?.[1] ?? null };
      },
    });
  }
}
