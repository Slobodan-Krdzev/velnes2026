import {
  CheckoutStatusResponseSchema,
  DrawerCloseRequestSchema,
  DrawerCloseResponseSchema,
  InvoiceListQuerySchema,
  InvoiceListResponseSchema,
  InvoiceSchema,
  RefundRequestSchema,
  SaleRequestSchema,
  SaleResponseSchema,
  ValidateCodeRequestSchema,
  ValidateCodeResponseSchema,
  DuePaymentsSchema,
  DueQuerySchema,
} from '@velnes/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant } from '../../db/index.js';
import { logAudit } from '../audit/audit.service.js';
import { can, permsFor } from '../auth/authz.service.js';
import {
  checkoutStatus,
  finishSale,
  listInvoices,
  refundInvoice,
  retryTransaction,
  TillError,
  validateCode,
  listDue,
} from './till.service.js';

const ErrorSchema = z.object({ error: z.string(), message: z.string() });
const IdParams = z.object({ id: z.uuid() });

function sendTillError(reply: FastifyReply, e: unknown) {
  if (e instanceof TillError) {
    const status = e.code === 'NOT_FOUND' ? 404 : e.code === 'BAD_CODE' ? 422 : 409;
    return reply.code(status as 404).send({ error: e.code, message: e.message });
  }
  throw e;
}

export function tillRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'POST',
    url: '/sales',
    preHandler: [app.authenticate],
    schema: {
      body: SaleRequestSchema,
      response: { 200: SaleResponseSchema, 403: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
    },
    handler: async (req, reply) => {
      try {
        return await withTenant(req.claims.ten, async (trx) => {
          const perms = await permsFor(trx, req.claims);
          if (!can(perms, 'pos.checkout'))
            return reply
              .code(403)
              .send({ error: 'FORBIDDEN', message: 'Missing permission: pos.checkout' });
          // Giving a discount is its own right: a sale carrying one
          // is refused when the role's pos.discount says none.
          const discounted =
            req.body.cartDiscount > 0 || req.body.lines.some((l) => l.lineDiscount > 0);
          if (discounted && !can(perms, 'pos.discount'))
            return reply
              .code(403)
              .send({ error: 'FORBIDDEN', message: 'Missing permission: pos.discount' });
          return finishSale(trx, req.claims, req.body);
        });
      } catch (e) {
        return sendTillError(reply, e);
      }
    },
  });

  r.route({
    method: 'POST',
    url: '/till/drawer-close',
    preHandler: [app.authenticate],
    schema: {
      body: DrawerCloseRequestSchema,
      response: { 200: DrawerCloseResponseSchema, 403: ErrorSchema, 404: ErrorSchema },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        // Closing the drawer is cash_drawer.close's act: the server
        // computes the day's expected cash from the invoices, the
        // counted amount and the difference go on the record.
        const perms = await permsFor(trx, req.claims);
        if (!can(perms, 'cash_drawer.close'))
          return reply
            .code(403)
            .send({ error: 'FORBIDDEN', message: 'Missing permission: cash_drawer.close' });
        const loc = await trx
          .selectFrom('locations')
          .select('name')
          .where('id', '=', req.body.locationId)
          .executeTakeFirst();
        if (!loc)
          return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown location' });
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        // The day's cash is the sum of the day's cash receipts — the
        // sale door's own total, never re-derived from lines (Phase 0).
        const invoices = await trx
          .selectFrom('invoices')
          .select(['id', 'total'])
          .where('locationId', '=', req.body.locationId)
          .where('method', '=', 'Cash')
          .where('status', '!=', 'Refunded')
          .where('date', '>=', today)
          .execute();
        const expected = invoices.reduce((s, i) => s + i.total, 0);
        const difference = req.body.countedCash - expected;
        const actor = await trx
          .selectFrom('employees')
          .select('name')
          .where('id', '=', req.claims.sub)
          .executeTakeFirst();
        await logAudit(trx, req.claims.ten, {
          actorEmployeeId: req.claims.sub,
          actorName: actor?.name ?? '',
          action: 'Cash drawer closed',
          object: `Location · ${loc.name}`,
          before: `Expected ${expected}`,
          after: `Counted ${req.body.countedCash} (${difference >= 0 ? '+' : ''}${difference})`,
          locationName: loc.name,
        });
        return {
          date: today.toISOString().slice(0, 10),
          expectedCash: expected,
          countedCash: req.body.countedCash,
          difference,
          cashSales: invoices.length,
        };
      }),
  });

  r.route({
    method: 'GET',
    url: '/checkouts/:id/status',
    preHandler: [app.authenticate],
    schema: {
      params: IdParams,
      response: { 200: CheckoutStatusResponseSchema, 404: ErrorSchema },
    },
    handler: async (req, reply) => {
      try {
        return await withTenant(req.claims.ten, (trx) => checkoutStatus(trx, req.params.id));
      } catch (e) {
        return sendTillError(reply, e);
      }
    },
  });

  r.route({
    method: 'POST',
    url: '/merchant-transactions/:id/retry',
    preHandler: [app.authenticate],
    schema: {
      params: IdParams,
      response: { 200: z.object({ ok: z.literal(true) }), 404: ErrorSchema, 409: ErrorSchema },
    },
    handler: async (req, reply) => {
      try {
        await withTenant(req.claims.ten, (trx) => retryTransaction(trx, req.params.id));
        return { ok: true as const };
      } catch (e) {
        return sendTillError(reply, e);
      }
    },
  });

  r.route({
    method: 'POST',
    url: '/till/validate-code',
    preHandler: [app.authenticate],
    schema: {
      body: ValidateCodeRequestSchema,
      response: { 200: ValidateCodeResponseSchema },
    },
    handler: async (req) =>
      withTenant(req.claims.ten, (trx) => validateCode(trx, req.body.code, req.body.subtotal)),
  });

  /** Due payments (2026-10-01): what past visits still owe — the till's Due tab. */
  r.route({
    method: 'GET',
    url: '/till/due',
    preHandler: [app.authenticate],
    schema: { querystring: DueQuerySchema, response: { 200: DuePaymentsSchema, 403: ErrorSchema } },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        const perms = await permsFor(trx, req.claims);
        if (!can(perms, 'pos.checkout'))
          return reply.code(403).send({ error: 'FORBIDDEN', message: 'Missing permission: pos.checkout' });
        return listDue(trx, req.query);
      }),
  });

  r.route({
    method: 'GET',
    url: '/invoices',
    preHandler: [app.authenticate],
    schema: {
      querystring: InvoiceListQuerySchema,
      response: { 200: InvoiceListResponseSchema },
    },
    handler: async (req, reply) => {
      return await withTenant(req.claims.ten, async (trx) => {
        const perms = await permsFor(trx, req.claims);
        if (!can(perms, 'pos.view_invoices'))
          return reply
            .code(403 as never)
            .send({ error: 'FORBIDDEN', message: 'Missing permission: pos.view_invoices' } as never);
        return { invoices: await listInvoices(trx, req.query) };
      });
    },
  });

  r.route({
    method: 'POST',
    url: '/invoices/:id/refund',
    preHandler: [app.authenticate],
    schema: {
      params: IdParams,
      body: RefundRequestSchema,
      response: { 200: InvoiceSchema, 403: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema },
    },
    handler: async (req, reply) => {
      try {
        return await withTenant(req.claims.ten, async (trx) => {
          const perms = await permsFor(trx, req.claims);
          if (!can(perms, 'pos.refund'))
            return reply
              .code(403)
              .send({ error: 'FORBIDDEN', message: 'Missing permission: pos.refund' });
          return refundInvoice(trx, req.claims, req.params.id, req.body.reason);
        });
      } catch (e) {
        return sendTillError(reply, e);
      }
    },
  });
}
