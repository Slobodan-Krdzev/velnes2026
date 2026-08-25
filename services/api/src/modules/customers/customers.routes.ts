import {
  ActivityListSchema,
  CustomerInsightsSchema,
  CustomerPatchSchema,
  CustomerProfileSchema,
  PersonalOfferCreateSchema,
  PersonalOfferListSchema,
  PersonalOfferSchema,
} from '@velnes/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant } from '../../db/index.js';
import { can, permsFor } from '../auth/authz.service.js';
import { logAudit } from '../audit/audit.service.js';
import {
  activityLog,
  createPersonalOffer,
  CustomerError,
  customerInsights,
  customerProfile,
  decidePersonalOffer,
  personalOffersFor,
  poStatus,
} from './customers.service.js';

const Err = z.object({ error: z.string(), message: z.string() });
const IdParams = z.object({ id: z.uuid() });
const statusFor = { NOT_FOUND: 404, LOC_NOT_LIVE: 409, WRONG_STATE: 409 } as const;

function sendErr(reply: FastifyReply, e: unknown) {
  if (e instanceof CustomerError)
    return reply.code(statusFor[e.code]).send({ error: e.code, message: e.message });
  throw e;
}

export function customersRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/customers/:id',
    preHandler: [app.authenticate],
    schema: { params: IdParams, response: { 200: CustomerProfileSchema, 404: Err } },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        try {
          return await customerProfile(trx, req.params.id);
        } catch (e) {
          return sendErr(reply, e);
        }
      }),
  });

  r.route({
    method: 'PATCH',
    url: '/customers/:id',
    preHandler: [app.authenticate],
    schema: {
      params: IdParams,
      body: CustomerPatchSchema,
      response: { 200: CustomerProfileSchema, 403: Err, 404: Err },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        const perms = await permsFor(trx, req.claims);
        if (!can(perms, 'customers.edit'))
          return reply
            .code(403)
            .send({ error: 'FORBIDDEN', message: 'Missing permission: customers.edit' });
        const b = req.body;
        try {
          const before = await customerProfile(trx, req.params.id);
          await trx
            .updateTable('customers')
            .set({
              ...(b.note !== undefined ? { note: b.note } : {}),
              ...(b.tags !== undefined ? { tags: b.tags } : {}),
              ...(b.group !== undefined ? { custGroup: b.group } : {}),
              ...(b.birthday !== undefined
                ? { birthday: b.birthday ? new Date(b.birthday) : null }
                : {}),
              ...(b.blacklisted !== undefined ? { blacklisted: b.blacklisted } : {}),
            })
            .where('id', '=', req.params.id)
            .execute();
          if (b.note !== undefined && b.note !== before.note)
            await activityLog(trx, req.claims.ten, req.params.id, req.claims.sub, 'note_added');
          if (b.blacklisted !== undefined && b.blacklisted !== before.blacklisted) {
            const actor = await trx
              .selectFrom('employees')
              .select('name')
              .where('id', '=', req.claims.sub)
              .executeTakeFirst();
            await logAudit(trx, req.claims.ten, {
              actorEmployeeId: req.claims.sub,
              actorName: actor?.name ?? '',
              action: b.blacklisted ? 'Customer blacklisted' : 'Customer un-blacklisted',
              object: `Customer · ${before.name}`,
            });
          }
          return await customerProfile(trx, req.params.id);
        } catch (e) {
          return sendErr(reply, e);
        }
      }),
  });

  r.route({
    method: 'GET',
    url: '/customers/:id/insights',
    preHandler: [app.authenticate],
    schema: { params: IdParams, response: { 200: CustomerInsightsSchema, 404: Err } },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        try {
          return await customerInsights(trx, req.params.id);
        } catch (e) {
          return sendErr(reply, e);
        }
      }),
  });

  r.route({
    method: 'GET',
    url: '/customers/:id/activity',
    preHandler: [app.authenticate],
    schema: { params: IdParams, response: { 200: ActivityListSchema } },
    handler: async (req) =>
      withTenant(req.claims.ten, async (trx) => {
        const rows = await trx
          .selectFrom('customerActivity as a')
          .leftJoin('employees as e', 'e.id', 'a.actorEmployeeId')
          .selectAll('a')
          .select('e.name as actorName')
          .where('a.customerId', '=', req.params.id)
          .orderBy('a.ts', 'desc')
          .limit(100)
          .execute();
        return {
          entries: rows.map((a) => ({
            id: a.id,
            ts: a.ts.toISOString(),
            actorName: a.actorName,
            type: a.type,
            refType: a.refType,
            refId: a.refId,
            meta: (a.meta ?? {}) as Record<string, unknown>,
          })),
        };
      }),
  });

  r.route({
    method: 'GET',
    url: '/customers/:id/offers',
    preHandler: [app.authenticate],
    schema: { params: IdParams, response: { 200: PersonalOfferListSchema } },
    handler: async (req) =>
      withTenant(req.claims.ten, async (trx) => ({
        offers: await personalOffersFor(trx, req.params.id),
      })),
  });

  r.route({
    method: 'POST',
    url: '/customers/:id/offers',
    preHandler: [app.authenticate],
    schema: {
      params: IdParams,
      body: PersonalOfferCreateSchema,
      response: { 200: PersonalOfferSchema, 403: Err, 404: Err, 409: Err },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        const perms = await permsFor(trx, req.claims);
        if (!can(perms, 'marketing.personal_offers'))
          return reply.code(403).send({
            error: 'FORBIDDEN',
            message: 'Missing permission: marketing.personal_offers',
          });
        try {
          const row = await createPersonalOffer(trx, req.claims.ten, req.claims.sub, req.params.id, req.body);
          const svc = await trx
            .selectFrom('services')
            .select('name')
            .where('id', '=', row.serviceId)
            .executeTakeFirstOrThrow();
          return {
            id: row.id,
            customerId: row.customerId,
            serviceId: row.serviceId,
            serviceName: svc.name,
            variantId: row.variantId,
            locationId: row.locationId,
            specialPrice: row.specialPrice,
            normalPrice: row.normalPrice,
            validUntil: req.body.validUntil,
            intent: row.intent,
            status: poStatus(row),
            createdAt: row.createdAt.toISOString(),
          };
        } catch (e) {
          return sendErr(reply, e);
        }
      }),
  });

  r.route({
    method: 'POST',
    url: '/personal-offers/:id/:action',
    preHandler: [app.authenticate],
    schema: {
      params: z.object({ id: z.uuid(), action: z.enum(['cancel', 'redeem']) }),
      response: { 200: z.object({ ok: z.literal(true) }), 403: Err, 404: Err, 409: Err },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        const perms = await permsFor(trx, req.claims);
        if (!can(perms, 'marketing.personal_offers'))
          return reply.code(403).send({
            error: 'FORBIDDEN',
            message: 'Missing permission: marketing.personal_offers',
          });
        try {
          await decidePersonalOffer(trx, req.claims.ten, req.claims.sub, req.params.id, req.params.action);
          return { ok: true as const };
        } catch (e) {
          return sendErr(reply, e);
        }
      }),
  });
}
