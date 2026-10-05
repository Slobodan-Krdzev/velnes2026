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
  ReviewSubmitSchema,
  ClientReviewSchema,
  ClientRescheduleRequestSchema,
  ChangeRequestSchema,
  AvailabilityResponseSchema,
  LoyaltyAccountSchema,
} from '@velnes/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { z } from 'zod';
import { db, withClient, withHq, withTenant } from '../../db/index.js';
import { env } from '../../env.js';
import { BookingError, BookingRefused, chainAvailability, confirmChain, productsOf } from '../booking/booking.service.js';
import {
  cancelVisit,
  keepOriginal,
  paymentOf,
  refundOf,
  requestOf,
  requestReschedule,
  visitHistory,
  visitLegs,
  visitRights,
  withdrawReschedule,
  type Leg,
} from '../booking/changes.service.js';
import { processRefund } from '../payments/refunds.service.js';
import { awardRegistration, awardReview, loyaltyAccountOf } from '../loyalty/loyalty.service.js';
import { createI18n } from '@velnes/i18n';
import { afterBooked } from '../booking/requests.service.js';
import { payAppointment, quotePayment } from '../payments/payments.service.js';
import { randomBytes } from 'node:crypto';
import { visitPayload } from '../../public/public.routes.js';
import { personalOffersFor } from '../customers/customers.service.js';
import { ReviewError, isCompleted, reviewsOfAppointments, submitReview } from '../reviews/reviews.service.js';
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
        'modifierOptionIds',
        'employeeId',
        'date',
        'startMin',
        'durationMin',
        'price',
        'status',
        'paid',
        'title',
        'kind',
        'prepMin',
        'resetMin',
        'anyEmp',
        'customerId',
        'clientUserId',
        'idempotencyKey',
        'cancelHours',
        'quietBonus',
        'cancelledAt',
        'cancelledBy',
        'cancelReason',
      ])
      .where('clientUserId', '=', clientUserId)
      .orderBy('date', 'desc')
      .orderBy('startMin', 'desc')
      .execute(),
  );
  if (!rows.length) return [];
  // The visit is the unit of a change: legs booked together share an
  // idempotency-key prefix, and the first leg carries the request.
  const visitKey = (a: { id: string; idempotencyKey: string | null }) => a.idempotencyKey?.match(/^(.*):\d+$/)?.[1] ?? a.id;
  // The reviews these visits carry (the client's own), and "now" once.
  const reviews = await reviewsOfAppointments(clientUserId, rows.map((a) => a.id));
  const now = new Date();
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
    const { locs, svcs, vars, emps, extras } = await withTenant(t, async (trx) => {
      const [locs, svcs, vars, emps] = await Promise.all([
        trx.selectFrom('locations').select(['id', 'name', 'address', 'lat', 'lng', 'cancelHours', 'tz']).execute(),
        trx.selectFrom('services').select(['id', 'name']).execute(),
        trx.selectFrom('serviceVariants').select(['id', 'label']).execute(),
        trx.selectFrom('employees').select(['id', 'name']).execute(),
      ]);
      // Booking changes: per visit, the rights the server decides, the
      // active or last request, the cancellation, the money, the story.
      const byVisit = new Map<string, Leg[]>();
      for (const a of mine) {
        const k = visitKey(a);
        const legs = byVisit.get(k) ?? [];
        legs.push({ ...a, date: localIso(a.date), modifierOptionIds: a.modifierOptionIds ?? [] });
        byVisit.set(k, legs);
      }
      type Extras = ReturnType<typeof visitRights> & {
        changeRequest: Awaited<ReturnType<typeof requestOf>>;
        cancellation: { at: string; by: 'customer' | 'salon' | 'system' | 'hq'; reason: string | null } | null;
        payment: Awaited<ReturnType<typeof paymentOf>>;
        refund: Awaited<ReturnType<typeof refundOf>>;
        history: Awaited<ReturnType<typeof visitHistory>>;
        products: Awaited<ReturnType<typeof productsOf>>;
      };
      const extras = new Map<string, Extras>();
      for (const legs of byVisit.values()) {
        legs.sort((x, y) => (x.date === y.date ? x.startMin - y.startMin : x.date.localeCompare(y.date)));
        const first = legs[0]!;
        const tz = locs.find((l) => l.id === first.locationId)?.tz ?? 'Europe/Skopje';
        const changeRequest = await requestOf(trx, first.id);
        const active = changeRequest && (changeRequest.status === 'pending' || changeRequest.status === 'declined') ? changeRequest : null;
        const rights = visitRights(legs, active, tz, now);
        const payment = await paymentOf(trx, legs);
        const refund = await refundOf(trx, legs);
        const cancellation =
          first.status === 'cancelled' && first.cancelledAt && first.cancelledBy
            ? { at: first.cancelledAt.toISOString(), by: first.cancelledBy as 'customer' | 'salon' | 'system' | 'hq', reason: first.cancelReason }
            : null;
        // Products ride on the visit's first treatment, and are shown there.
        const products = await productsOf(trx, first.id);
        for (const leg of legs) {
          const history = await visitHistory(trx, leg.id);
          extras.set(leg.id, { ...rights, changeRequest, cancellation, payment, refund, history, products: leg.id === first.id ? products : [] });
        }
      }
      return { locs, svcs, vars, emps, extras };
    });
    const labels = { locs, svcs, vars, emps };
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
        paid: a.paid === 'paid',
        cancelHours: loc?.cancelHours ?? 24,
        quietBonus: a.quietBonus ?? 0,
        // Reviews: completed by the platform's definition, in the
        // salon's clock; reviewable once, by whoever booked it.
        completed: isCompleted(a, loc?.tz ?? 'Europe/Skopje', now),
        canReview: isCompleted(a, loc?.tz ?? 'Europe/Skopje', now) && !reviews.has(a.id),
        review: reviews.get(a.id) ?? null,
        serviceId: a.serviceId,
        employeeId: a.employeeId,
        locationId: a.locationId,
        variantId: a.variantId,
        modifierOptionIds: a.modifierOptionIds ?? [],
        // The window as accepted at booking, not the location's today.
        ...(a.cancelHours != null ? { cancelHours: a.cancelHours } : {}),
        ...extras.get(a.id)!,
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
        // Velnes Loyalty (2026-09-30): the welcome bonus lands on the
        // first verification, once — the ledger's unique source sees to
        // it — and the welcome bell says the number. A repeated verify
        // awards nothing and rings nothing.
        const bonus = await awardRegistration(c.id);
        // The session's profile carries the balance as it now is.
        c.loyaltyPoints = (c.loyaltyPoints ?? 0) + bonus;
        if (bonus) {
          const t = createI18n((['en', 'mk', 'sq'] as const).includes(c.lang as 'en') ? (c.lang as 'en' | 'mk' | 'sq') : 'en').t;
          await notifyClient(c.id, {
            kind: 'account',
            title: t('loy.welcomeTitle'),
            body: t('loy.welcomeBody', { n: bonus }),
            refType: 'loyalty',
          });
        }
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

  /** The visit, if it is this client's — read under their own context,
   *  so somebody else's appointment is a plain 404. */
  const ownVisit = async (clientUserId: string, appointmentId: string) =>
    withClient(clientUserId, (trx) =>
      trx
        .selectFrom('appointments')
        .select(['id', 'tenantId'])
        .where('id', '=', appointmentId)
        .where('clientUserId', '=', clientUserId)
        .executeTakeFirst(),
    );
  const refused = (reply: FastifyReply, e: unknown) => {
    if (e instanceof BookingRefused)
      return reply.code(409).send({ error: 'REFUSED' as const, message: e.message, code: e.code, params: e.params });
    if (e instanceof BookingError) return reply.code(404).send({ error: e.code, message: e.message });
    throw e;
  };
  const AppointmentParams = z.object({ id: z.uuid() });

  /**
   * Cancellation (Alex, 2026-09-30) — docs/BOOKING-CHANGES.md. The
   * window is checked here, at the moment of the click, against the
   * visit's own snapshot in the location's zone — whatever the screen
   * showed. The whole visit is cancelled; a refund intent is created
   * for a prepaid one and the provider asked after the commit.
   */
  r.route({
    method: 'POST',
    url: '/me/appointments/:id/cancel',
    preHandler: [app.authenticateClient],
    schema: {
      params: AppointmentParams,
      // A bare POST arrives as a null body.
      body: z.object({ reason: z.string().max(300).optional() }).nullish(),
      response: { 200: z.object({ ok: z.literal(true) }), 404: ErrorSchema, 409: BookingRefusalSchema },
    },
    handler: async (req, reply) => {
      const id = req.clientClaims.sub;
      const a = await ownVisit(id, req.params.id);
      if (!a) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown appointment' });
      const c = await clientById(id);
      try {
        const out = await withTenant(a.tenantId, (trx) =>
          cancelVisit(trx, {
            appointmentId: a.id,
            by: 'customer',
            actor: { name: `${c.first} ${c.last}`.trim() || c.email, clientUserId: id },
            reason: req.body?.reason ?? null,
          }),
        );
        if (out.notice) await notifyClient(id, out.notice);
        // Money moves after the booking is settled, never inside it.
        for (const rid of out.refundIds) await processRefund(rid);
        return { ok: true as const };
      } catch (e) {
        return refused(reply, e);
      }
    },
  });

  /** The visit's free starts on a day, its own legs out of the way —
   *  the picker behind "Reschedule". */
  r.route({
    method: 'GET',
    url: '/me/appointments/:id/reschedule-slots',
    preHandler: [app.authenticateClient],
    schema: {
      params: AppointmentParams,
      querystring: z.object({ date: z.iso.date() }),
      response: { 200: AvailabilityResponseSchema, 404: ErrorSchema },
    },
    handler: async (req, reply) => {
      const a = await ownVisit(req.clientClaims.sub, req.params.id);
      if (!a) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown appointment' });
      const slots = await withTenant(a.tenantId, async (trx) => {
        const legs = await visitLegs(trx, a.id);
        const first = legs[0]!;
        const oneHand = legs.every((l) => l.employeeId === first.employeeId);
        return chainAvailability(trx, {
          locationId: first.locationId,
          items: legs.map((l) => ({ serviceId: l.serviceId!, variantId: l.variantId, modifierOptionIds: l.modifierOptionIds })),
          // The original professional stays (V1); a visit split across
          // hands asks for anyone.
          employeeId: oneHand && first.employeeId ? first.employeeId : 'any',
          date: req.query.date,
          ignoreIds: legs.map((l) => l.id),
        });
      });
      return { slots: slots.slots };
    },
  });

  r.route({
    method: 'POST',
    url: '/me/appointments/:id/reschedule',
    preHandler: [app.authenticateClient],
    schema: {
      params: AppointmentParams,
      body: ClientRescheduleRequestSchema,
      response: { 200: ChangeRequestSchema, 404: ErrorSchema, 409: BookingRefusalSchema },
    },
    handler: async (req, reply) => {
      const id = req.clientClaims.sub;
      const a = await ownVisit(id, req.params.id);
      if (!a) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown appointment' });
      const c = await clientById(id);
      try {
        return await withTenant(a.tenantId, (trx) =>
          requestReschedule(trx, {
            appointmentId: a.id,
            client: { id, name: `${c.first} ${c.last}`.trim() || c.email },
            date: req.body.date,
            time: req.body.time,
          }),
        );
      } catch (e) {
        return refused(reply, e);
      }
    },
  });

  r.route({
    method: 'POST',
    url: '/me/appointments/:id/reschedule/withdraw',
    preHandler: [app.authenticateClient],
    schema: { params: AppointmentParams, response: { 200: ChangeRequestSchema, 404: ErrorSchema, 409: BookingRefusalSchema } },
    handler: async (req, reply) => {
      const id = req.clientClaims.sub;
      const a = await ownVisit(id, req.params.id);
      if (!a) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown appointment' });
      const c = await clientById(id);
      try {
        return await withTenant(a.tenantId, (trx) =>
          withdrawReschedule(trx, { appointmentId: a.id, client: { id, name: `${c.first} ${c.last}`.trim() || c.email } }),
        );
      } catch (e) {
        return refused(reply, e);
      }
    },
  });

  /** After a decline: the customer keeps the original. Cancelling
   *  instead is the cancel door, which answers the request itself. */
  r.route({
    method: 'POST',
    url: '/me/appointments/:id/reschedule/keep',
    preHandler: [app.authenticateClient],
    schema: { params: AppointmentParams, response: { 200: ChangeRequestSchema, 404: ErrorSchema, 409: BookingRefusalSchema } },
    handler: async (req, reply) => {
      const id = req.clientClaims.sub;
      const a = await ownVisit(id, req.params.id);
      if (!a) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown appointment' });
      const c = await clientById(id);
      try {
        return await withTenant(a.tenantId, (trx) =>
          keepOriginal(trx, { appointmentId: a.id, client: { id, name: `${c.first} ${c.last}`.trim() || c.email } }),
        );
      } catch (e) {
        return refused(reply, e);
      }
    },
  });

  // ---- reviews -----------------------------------------------------

  /**
   * One review for one completed appointment of mine (Alex,
   * 2026-09-30). The appointment is the authority: salon, location,
   * service, professional and date all come from it, never from the
   * body. Everything the app already knew is checked again here.
   */
  r.route({
    method: 'POST',
    url: '/me/appointments/:id/review',
    preHandler: [app.authenticateClient],
    schema: {
      params: z.object({ id: z.uuid() }),
      body: ReviewSubmitSchema,
      response: { 200: ClientReviewSchema, 404: ErrorSchema, 409: ErrorSchema },
    },
    handler: async (req, reply) => {
      try {
        const review = await submitReview(req.clientClaims.sub, req.params.id, req.body);
        // Velnes Loyalty: the review's own points, once per review (the
        // review id is the source). The thank-you card says the number;
        // no second bell rings for it.
        const tenantId = await withClient(req.clientClaims.sub, (trx) =>
          trx.selectFrom('appointments').select('tenantId').where('id', '=', req.params.id).executeTakeFirst(),
        );
        const loyaltyPoints = await awardReview(req.clientClaims.sub, review.id, tenantId?.tenantId ?? '');
        return { ...review, ...(loyaltyPoints ? { loyaltyPoints } : {}) };
      } catch (e) {
        if (e instanceof ReviewError) {
          const status = e.code === 'NOT_FOUND' ? 404 : 409;
          return reply.code(status).send({ error: e.code, message: e.message });
        }
        throw e;
      }
    },
  });

  // ---- Velnes Loyalty (2026-09-30) — docs/LOYALTY.md ---------------

  /** The account's own balance and ledger, newest first. Read only:
   *  nothing a client sends can move a point. */
  r.route({
    method: 'GET',
    url: '/me/loyalty',
    preHandler: [app.authenticateClient],
    schema: { response: { 200: LoyaltyAccountSchema } },
    handler: async (req) => loyaltyAccountOf(req.clientClaims.sub),
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
            products: req.body.products ?? [],
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
