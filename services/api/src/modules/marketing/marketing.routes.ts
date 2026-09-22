import type {
  LastMinuteOfferSchema,
  MemberRecSchema} from '@velnes/contracts';
import {
  CapacityResponseSchema,
  DiscountCodeCreateSchema,
  DiscountCodeListSchema,
  DiscountCodePatchSchema,
  DiscountCodeRowSchema,
  PersonalOfferListSchema,
  MemberRecListSchema,
  OfferCreateSchema,
  OfferListSchema,
  PremiumOfferListSchema,
} from '@velnes/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { z } from 'zod';
import { withTenant } from '../../db/index.js';
import { can, permsFor } from '../auth/authz.service.js';
import { localIso } from '../scheduling/scheduling.service.js';
import { logAudit } from '../audit/audit.service.js';
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

/** The row every code door answers with; status is derived, never stored. */
function codeRow(d: {
  id: string;
  code: string;
  type: 'Percentage' | 'Fixed amount';
  value: number;
  used: number;
  usageLimit: number | null;
  starts: Date;
  ends: Date;
  active: boolean;
}) {
  const today = localIso(new Date());
  const starts = localIso(d.starts);
  const ends = localIso(d.ends);
  const status = !d.active ? 'Off' : today < starts ? 'Scheduled' : today > ends ? 'Expired' : 'Active';
  return { id: d.id, code: d.code, type: d.type, value: d.value, used: d.used, usageLimit: d.usageLimit, starts, ends, active: d.active, status: status as 'Active' | 'Scheduled' | 'Expired' | 'Off' };
}

async function actorName(trx: Parameters<typeof permsFor>[0], id: string): Promise<string> {
  const a = await trx.selectFrom('employees').select('name').where('id', '=', id).executeTakeFirst();
  return a?.name ?? '';
}

export function marketingRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/discount-codes',
    preHandler: [app.authenticate],
    schema: { response: { 200: DiscountCodeListSchema, 403: Err } },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await gate(trx, req.claims, reply))) return reply;
        const rows = await trx.selectFrom('discountCodes').selectAll().orderBy('starts', 'desc').execute();
        return { codes: rows.map(codeRow) };
      }),
  });

  // A new code. Behind the same right as the rest of marketing; the
  // code is unique per salon, and a clash says so rather than 500.
  r.route({
    method: 'POST',
    url: '/discount-codes',
    preHandler: [app.authenticate],
    schema: { body: DiscountCodeCreateSchema, response: { 200: DiscountCodeRowSchema, 403: Err, 409: Err } },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await gate(trx, req.claims, reply))) return reply;
        const clash = await trx
          .selectFrom('discountCodes')
          .select('id')
          .where(sql<boolean>`upper(code) = upper(${req.body.code})`)
          .executeTakeFirst();
        if (clash) return reply.code(409).send({ error: 'EXISTS', message: 'That code already exists' });
        const row = await trx
          .insertInto('discountCodes')
          .values({
            tenantId: req.claims.ten,
            code: req.body.code,
            type: req.body.type,
            value: req.body.value,
            usageLimit: req.body.usageLimit,
            starts: new Date(req.body.starts),
            ends: new Date(req.body.ends),
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await logAudit(trx, req.claims.ten, {
          actorEmployeeId: req.claims.sub,
          actorName: await actorName(trx, req.claims.sub),
          action: 'Discount code created',
          object: `Code · ${row.code}`,
          after: `${row.type === 'Percentage' ? `${row.value}%` : `${row.value} MKD`} · ${req.body.starts} → ${req.body.ends}`,
        });
        return codeRow(row);
      }),
  });

  // The switch, the cap, the end date. Off pauses the code at the till
  // and in the Velnes app the same second.
  r.route({
    method: 'PATCH',
    url: '/discount-codes/:id',
    preHandler: [app.authenticate],
    schema: {
      params: z.object({ id: z.uuid() }),
      body: DiscountCodePatchSchema,
      response: { 200: DiscountCodeRowSchema, 403: Err, 404: Err },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await gate(trx, req.claims, reply))) return reply;
        const before = await trx.selectFrom('discountCodes').selectAll().where('id', '=', req.params.id).executeTakeFirst();
        if (!before) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown code' });
        const row = await trx
          .updateTable('discountCodes')
          .set({
            ...(req.body.active !== undefined ? { active: req.body.active } : {}),
            ...(req.body.usageLimit !== undefined ? { usageLimit: req.body.usageLimit } : {}),
            ...(req.body.ends !== undefined ? { ends: new Date(req.body.ends) } : {}),
          })
          .where('id', '=', req.params.id)
          .returningAll()
          .executeTakeFirstOrThrow();
        if (req.body.active !== undefined && req.body.active !== before.active)
          await logAudit(trx, req.claims.ten, {
            actorEmployeeId: req.claims.sub,
            actorName: await actorName(trx, req.claims.sub),
            action: req.body.active ? 'Discount code switched on' : 'Discount code switched off',
            object: `Code · ${row.code}`,
            before: before.active ? 'on' : 'off',
            after: row.active ? 'on' : 'off',
          });
        return codeRow(row);
      }),
  });

  // Only a code nobody has used may go; a used one stays for the
  // record and is switched off instead.
  r.route({
    method: 'DELETE',
    url: '/discount-codes/:id',
    preHandler: [app.authenticate],
    schema: { params: z.object({ id: z.uuid() }), response: { 200: z.object({ ok: z.literal(true) }), 403: Err, 404: Err, 409: Err } },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await gate(trx, req.claims, reply))) return reply;
        const row = await trx.selectFrom('discountCodes').selectAll().where('id', '=', req.params.id).executeTakeFirst();
        if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown code' });
        if (row.used > 0) return reply.code(409).send({ error: 'IN_USE', message: 'Used codes stay for the record — switch it off instead' });
        await trx.deleteFrom('discountCodes').where('id', '=', row.id).execute();
        await logAudit(trx, req.claims.ten, {
          actorEmployeeId: req.claims.sub,
          actorName: await actorName(trx, req.claims.sub),
          action: 'Discount code deleted',
          object: `Code · ${row.code}`,
        });
        return { ok: true as const };
      }),
  });

  r.route({
    method: 'GET',
    url: '/personal-offers',
    preHandler: [app.authenticate],
    schema: { response: { 200: PersonalOfferListSchema, 403: Err } },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await gate(trx, req.claims, reply))) return reply;
        return { offers: await personalOffersAll(trx) };
      }),
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
      response: { 200: CapacityResponseSchema, 403: Err },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await gate(trx, req.claims, reply))) return reply;
        const slots = await openCapacity(trx, req.query.locationId, req.query.date);
        return { slots, value: slots.reduce((n, c) => n + c.price, 0) };
      }),
  });

  r.route({
    method: 'GET',
    url: '/offers',
    preHandler: [app.authenticate],
    schema: { response: { 200: OfferListSchema, 403: Err } },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await gate(trx, req.claims, reply))) return reply;
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
