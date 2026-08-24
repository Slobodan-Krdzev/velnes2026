import {
  CheckoutStatusResponseSchema,
  InvoiceListQuerySchema,
  InvoiceListResponseSchema,
  InvoiceSchema,
  RefundRequestSchema,
  SaleRequestSchema,
  SaleResponseSchema,
  ValidateCodeRequestSchema,
  ValidateCodeResponseSchema,
} from '@velnes/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant } from '../../db/index.js';
import { can, permsFor } from '../auth/authz.service.js';
import {
  checkoutStatus,
  finishSale,
  listInvoices,
  refundInvoice,
  retryTransaction,
  TillError,
  validateCode,
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
          return finishSale(trx, req.claims, req.body);
        });
      } catch (e) {
        return sendTillError(reply, e);
      }
    },
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
