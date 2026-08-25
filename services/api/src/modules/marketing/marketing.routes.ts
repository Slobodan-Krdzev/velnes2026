import type {
  LastMinuteOfferSchema,
  MemberRecSchema} from '@velnes/contracts';
import {
  CapacityResponseSchema,
  DiscountCodeListSchema,
  PersonalOfferListSchema,
  MemberRecListSchema,
  OfferCreateSchema,
  OfferListSchema,
  PremiumOfferListSchema,
} from '@velnes/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant } from '../../db/index.js';
import { can, permsFor } from '../auth/authz.service.js';
import { localIso } from '../scheduling/scheduling.service.js';
import { personalOffersAll } from '../customers/customers.service.js';
import {
  createOffer,
  MarketingError,
  memberRecScan,
  openCapacity,
  pmoAdvance,
  recDecide,
} from './marketing.service.js';

const Err = z.object({ error: z.string(), message: z.string() });
const statusFor = { NOT_FOUND: 404, INVALID: 422, WRONG_STATE: 409 } as const;

function sendErr(reply: FastifyReply, e: unknown) {
  if (e instanceof MarketingError)
    return reply.code(statusFor[e.code]).send({ error: e.code, message: e.message });
  throw e;
}

export function marketingRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/discount-codes',
    preHandler: [app.authenticate],
    schema: { response: { 200: DiscountCodeListSchema } },
    handler: async (req) =>
      withTenant(req.claims.ten, async (trx) => {
        const rows = await trx.selectFrom('discountCodes').selectAll().orderBy('starts').execute();
        const today = localIso(new Date());
        return {
          codes: rows.map((d) => {
            const starts = localIso(d.starts);
            const ends = localIso(d.ends);
            return {
              id: d.id,
              code: d.code,
              type: d.type,
              value: d.value,
              used: d.used,
              usageLimit: d.usageLimit,
              starts,
              ends,
              status: (today < starts ? 'Scheduled' : today > ends ? 'Expired' : 'Active') as
                | 'Active'
                | 'Scheduled'
                | 'Expired',
            };
          }),
        };
      }),
  });

  r.route({
    method: 'GET',
    url: '/personal-offers',
    preHandler: [app.authenticate],
    schema: { response: { 200: PersonalOfferListSchema } },
    handler: async (req) =>
      withTenant(req.claims.ten, async (trx) => ({ offers: await personalOffersAll(trx) })),
  });

  const gate = async (
    trx: Parameters<typeof permsFor>[0],
    claims: Parameters<typeof permsFor>[1],
    reply: FastifyReply,
  ) => {
    const perms = await permsFor(trx, claims);
    if (!can(perms, 'marketing.personal_offers')) {
      await reply.code(403).send({
        error: 'FORBIDDEN',
        message: 'Missing permission: marketing.personal_offers',
      });
      return false;
    }
    return true;
  };

  r.route({
    method: 'GET',
    url: '/capacity',
    preHandler: [app.authenticate],
    schema: {
      querystring: z.object({ locationId: z.uuid(), date: z.iso.date() }),
      response: { 200: CapacityResponseSchema },
    },
    handler: async (req) =>
      withTenant(req.claims.ten, async (trx) => {
        const slots = await openCapacity(trx, req.query.locationId, req.query.date);
        return { slots, value: slots.reduce((n, c) => n + c.price, 0) };
      }),
  });

  r.route({
    method: 'GET',
    url: '/offers',
    preHandler: [app.authenticate],
    schema: { response: { 200: OfferListSchema } },
    handler: async (req) =>
      withTenant(req.claims.ten, async (trx) => {
        const rows = await trx
          .selectFrom('lastMinuteOffers')
          .selectAll()
          .orderBy('createdAt', 'desc')
          .limit(50)
          .execute();
        return {
          offers: rows.map((o) => ({
            id: o.id,
            locationId: o.locationId,
            date: localIso(o.date),
            slotIds: o.slotIds,
            slots: o.slots as z.infer<typeof LastMinuteOfferSchema>['slots'],
            phases: o.phases as z.infer<typeof LastMinuteOfferSchema>['phases'],
            status: o.status as 'live' | 'ended',
            createdAt: o.createdAt.toISOString(),
          })),
        };
      }),
  });

  r.route({
    method: 'POST',
    url: '/offers',
    preHandler: [app.authenticate],
    schema: {
      body: OfferCreateSchema,
      response: { 200: z.object({ id: z.uuid() }), 403: Err, 422: Err },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await gate(trx, req.claims, reply))) return reply;
        try {
          const row = await createOffer(trx, req.claims.ten, req.claims.sub, req.body);
          return { id: row.id };
        } catch (e) {
          return sendErr(reply, e);
        }
      }),
  });

  r.route({
    method: 'POST',
    url: '/offers/:id/end',
    preHandler: [app.authenticate],
    schema: {
      params: z.object({ id: z.uuid() }),
      response: { 200: z.object({ ok: z.literal(true) }), 403: Err, 404: Err },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await gate(trx, req.claims, reply))) return reply;
        const row = await trx
          .selectFrom('lastMinuteOffers')
          .select('id')
          .where('id', '=', req.params.id)
          .executeTakeFirst();
        if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown offer' });
        await trx
          .updateTable('lastMinuteOffers')
          .set({ status: 'ended' })
          .where('id', '=', req.params.id)
          .execute();
        return { ok: true as const };
      }),
  });

  // ── The Premium pipeline. ─────────────────────────────────────

  r.route({
    method: 'GET',
    url: '/premium/recommendations',
    preHandler: [app.authenticate],
    schema: {
      querystring: z.object({ locationId: z.uuid().optional() }),
      response: { 200: MemberRecListSchema },
    },
    handler: async (req) =>
      withTenant(req.claims.ten, async (trx) => {
        // Reading the queue runs the scan when it is empty — one
        // recommendation, deterministic, same capacity source.
        if (req.query.locationId)
          await memberRecScan(trx, req.claims.ten, req.query.locationId);
        const rows = await trx
          .selectFrom('memberRecs as r')
          .innerJoin('services as s', 's.id', 'r.serviceId')
          .leftJoin('employees as e', 'e.id', 'r.employeeId')
          .selectAll('r')
          .select(['s.name as serviceName', 'e.name as employeeName'])
          .orderBy('r.createdAt', 'desc')
          .execute();
        return {
          recommendations: rows.map((r2) => ({
            id: r2.id,
            locationId: r2.locationId,
            date: localIso(r2.date),
            start: r2.startAt,
            end: r2.endAt,
            serviceId: r2.serviceId,
            serviceName: r2.serviceName,
            variantId: r2.variantId,
            employeeId: r2.employeeId,
            employeeName: r2.employeeName,
            normalPrice: r2.normalPrice,
            recPct: r2.recPct,
            recPrice: r2.recPrice,
            candidates: r2.candidates as z.infer<typeof MemberRecSchema>['candidates'],
            status: r2.status as 'pending' | 'approved' | 'declined',
            offerId: r2.offerId,
          })),
        };
      }),
  });

  r.route({
    method: 'POST',
    url: '/premium/recommendations/:id/:action',
    preHandler: [app.authenticate],
    schema: {
      params: z.object({ id: z.uuid(), action: z.enum(['approve', 'decline']) }),
      response: {
        200: z.object({ offerId: z.uuid().nullable() }),
        403: Err,
        404: Err,
        409: Err,
      },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await gate(trx, req.claims, reply))) return reply;
        try {
          const offerId = await recDecide(trx, req.claims.ten, req.claims.sub, req.params.id, req.params.action);
          return { offerId };
        } catch (e) {
          return sendErr(reply, e);
        }
      }),
  });

  r.route({
    method: 'GET',
    url: '/premium/offers',
    preHandler: [app.authenticate],
    schema: { response: { 200: PremiumOfferListSchema } },
    handler: async (req) =>
      withTenant(req.claims.ten, async (trx) => {
        const rows = await trx
          .selectFrom('premiumOffers as o')
          .innerJoin('services as s', 's.id', 'o.serviceId')
          .selectAll('o')
          .select('s.name as serviceName')
          .orderBy('o.createdAt', 'desc')
          .execute();
        return {
          offers: rows.map((o) => ({
            id: o.id,
            locationId: o.locationId,
            date: localIso(o.date),
            start: o.startAt,
            end: o.endAt,
            serviceId: o.serviceId,
            serviceName: o.serviceName,
            variantId: o.variantId,
            normalPrice: o.normalPrice,
            pct: o.pct,
            price: o.price,
            candidates: o.candidates as z.infer<typeof MemberRecSchema>['candidates'],
            stage: o.stage,
            status: o.status as 'live' | 'done',
          })),
        };
      }),
  });

  // In production a clock advances the window; this is the honest
  // demo button, labelled as such in the UI.
  r.route({
    method: 'POST',
    url: '/premium/offers/:id/advance',
    preHandler: [app.authenticate],
    schema: {
      params: z.object({ id: z.uuid() }),
      response: { 200: z.object({ stage: z.number().int() }), 403: Err, 404: Err, 409: Err },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await gate(trx, req.claims, reply))) return reply;
        try {
          return { stage: await pmoAdvance(trx, req.claims.ten, req.claims.sub, req.params.id) };
        } catch (e) {
          return sendErr(reply, e);
        }
      }),
  });
}
