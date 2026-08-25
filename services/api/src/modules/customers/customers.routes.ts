import {
  ActivityListSchema,
  CustomerApptsSchema,
  CustomerInvoicesSchema,
  CustomerLoyaltySchema,
  CustomerInsightsSchema,
  CustomerPatchSchema,
  CustomerProfileSchema,
  PersonalOfferCreateSchema,
  PersonalOfferListSchema,
  PersonalOfferSchema,
} from '@velnes/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
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
              ...(b.name !== undefined ? { name: b.name } : {}),
              ...(b.email !== undefined ? { email: b.email } : {}),
              ...(b.phone !== undefined ? { phone: b.phone } : {}),
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
    url: '/customers/:id/appointments',
    preHandler: [app.authenticate],
    schema: { params: IdParams, response: { 200: CustomerApptsSchema } },
    handler: async (req) =>
      withTenant(req.claims.ten, async (trx) => {
        const hhmm = (m: number) =>
          `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        const rows = await trx
          .selectFrom('appointments as a')
          .leftJoin('services as s', 's.id', 'a.serviceId')
          .leftJoin('locations as l', 'l.id', 'a.locationId')
          .leftJoin('employees as e', 'e.id', 'a.employeeId')
          .selectAll('a')
          .select(['s.name as svcName', 'l.name as locName', 'e.name as empName'])
          .where('a.customerId', '=', req.params.id)
          .where('a.kind', '=', 'appointment')
          .orderBy('a.date', 'desc')
          .orderBy('a.startMin', 'desc')
          .limit(200)
          .execute();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const map = (a: (typeof rows)[number]) => ({
          id: a.id,
          date: a.date.toISOString().slice(0, 10),
          start: hhmm(a.startMin),
          end: hhmm(a.startMin + a.durationMin),
          serviceName: a.svcName ?? a.title ?? '—',
          locationName: a.locName ?? '—',
          employeeName: a.empName,
          status: a.status,
          source: a.source,
          price: a.price,
        });
        return {
          upcoming: rows
            .filter((a) => a.date.getTime() >= today.getTime())
            .sort((a, b) => a.date.getTime() - b.date.getTime())
            .map(map),
          history: rows.filter((a) => a.date.getTime() < today.getTime()).map(map),
        };
      }),
  });

  r.route({
    method: 'GET',
    url: '/customers/:id/invoices',
    preHandler: [app.authenticate],
    schema: { params: IdParams, response: { 200: CustomerInvoicesSchema } },
    handler: async (req) =>
      withTenant(req.claims.ten, async (trx) => {
        const rows = await trx
          .selectFrom('invoices')
          .selectAll()
          .where('customerId', '=', req.params.id)
          .orderBy('date', 'desc')
          .limit(100)
          .execute();
        const totals = await trx
          .selectFrom('invoiceLines')
          .select(['invoiceId'])
          .select((eb) => eb.fn.sum<string>(sql`qty * unit_price - line_discount`).as('sum'))
          .where('invoiceId', 'in', rows.length ? rows.map((r) => r.id) : ['00000000-0000-4000-8000-000000000000'])
          .groupBy('invoiceId')
          .execute();
        return {
          invoices: rows.map((i) => {
            const lineSum = Number(totals.find((t) => t.invoiceId === i.id)?.sum ?? 0);
            return {
              id: i.id,
              number: i.number,
              date: i.date.toISOString().slice(0, 10),
              method: i.method,
              total: Math.max(
                0,
                lineSum - i.cartDiscount - i.pointsRedeemed - i.giftAmount - i.promoAmount,
              ) + i.tip + i.serviceCharge,
            };
          }),
        };
      }),
  });

  r.route({
    method: 'GET',
    url: '/customers/:id/loyalty',
    preHandler: [app.authenticate],
    schema: { params: IdParams, response: { 200: CustomerLoyaltySchema } },
    handler: async (req) =>
      withTenant(req.claims.ten, async (trx) => {
        const rows = await trx
          .selectFrom('loyaltyLedger')
          .selectAll()
          .where('customerId', '=', req.params.id)
          .orderBy('at', 'desc')
          .limit(100)
          .execute();
        const cfg = await trx.selectFrom('loyaltyConfig').selectAll().executeTakeFirst();
        const balance = rows.reduce((n, r) => n + r.points, 0);
        const step = cfg?.step ?? 100;
        return {
          balance,
          worth: cfg ? Math.floor(balance / step) * cfg.worth : 0,
          nextRewardAt: Math.ceil((balance + 1) / step) * step,
          rows: rows.map((r) => ({
            id: r.id,
            reason: r.reason,
            ref: r.ref || '—',
            when: r.at.toISOString().slice(0, 10),
            points: r.points,
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
