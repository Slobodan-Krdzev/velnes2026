import {
  BillingInvoiceCreateSchema,
  BillingInvoiceListSchema,
  BillingInvoicePatchSchema,
  BillingInvoiceQuerySchema,
  BillingInvoiceSchema,
  BillingIssueBlockedSchema,
  BillingIssueRequestSchema,
  BillingLogoSchema,
} from '@velnes/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant } from '../../db/index.js';
import { permsFor } from '../auth/authz.service.js';
import { BillingError } from './billing.service.js';
import { createDraft, getDraft, listDrafts, patchDraft } from './drafts.service.js';
import { issueInvoice, logoOf } from './issue.service.js';
import { invoicePdf, pdfFilename } from './pdf.service.js';
import { reachOf } from './scope.js';

const Err = z.object({ error: z.string(), message: z.string() });
const IdParams = z.object({ id: z.uuid() });

function sendErr(reply: FastifyReply, e: unknown) {
  if (e instanceof BillingError) {
    if (e.code === 'ISSUE_BLOCKED') return reply.code(422).send({ error: e.code, message: e.message, problems: e.problems });
    const status = e.code === 'NOT_FOUND' ? 404 : e.code === 'CONFLICT' ? 409 : e.code === 'INTEGRITY' ? 500 : 422;
    return reply.code(status).send({ error: e.code, message: e.message });
  }
  throw e;
}

/** Accounting invoice drafts (phase 2, 2026-10-06) — docs/INVOICING.md.
 *  `billing.create` drafts; `billing.read` reads; each at the role's
 *  scope — a location-scoped desk sees its own locations' documents. */
export function draftsRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'POST',
    url: '/billing/invoices',
    preHandler: [app.authenticate],
    schema: { body: BillingInvoiceCreateSchema, response: { 200: BillingInvoiceSchema, 403: Err, 404: Err, 422: Err } },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        const reach = reachOf(await permsFor(trx, req.claims), 'billing.create', req.claims);
        if (!reach) return reply.code(403).send({ error: 'FORBIDDEN', message: 'Missing permission: billing.create' });
        try {
          return (await createDraft(trx, req.claims, reach, req.body)).invoice;
        } catch (e) {
          return sendErr(reply, e);
        }
      }),
  });

  r.route({
    method: 'GET',
    url: '/billing/invoices',
    preHandler: [app.authenticate],
    schema: { querystring: BillingInvoiceQuerySchema, response: { 200: BillingInvoiceListSchema, 403: Err } },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        const reach = reachOf(await permsFor(trx, req.claims), 'billing.read', req.claims);
        if (!reach) return reply.code(403).send({ error: 'FORBIDDEN', message: 'Missing permission: billing.read' });
        return { invoices: await listDrafts(trx, reach, req.query) };
      }),
  });

  r.route({
    method: 'GET',
    url: '/billing/invoices/:id',
    preHandler: [app.authenticate],
    schema: { params: IdParams, response: { 200: BillingInvoiceSchema, 403: Err, 404: Err } },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        const reach = reachOf(await permsFor(trx, req.claims), 'billing.read', req.claims);
        if (!reach) return reply.code(403).send({ error: 'FORBIDDEN', message: 'Missing permission: billing.read' });
        try {
          return await getDraft(trx, reach, req.params.id);
        } catch (e) {
          return sendErr(reply, e);
        }
      }),
  });

  r.route({
    method: 'PATCH',
    url: '/billing/invoices/:id',
    preHandler: [app.authenticate],
    schema: { params: IdParams, body: BillingInvoicePatchSchema, response: { 200: BillingInvoiceSchema, 403: Err, 404: Err, 422: Err } },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        const reach = reachOf(await permsFor(trx, req.claims), 'billing.create', req.claims);
        if (!reach) return reply.code(403).send({ error: 'FORBIDDEN', message: 'Missing permission: billing.create' });
        try {
          return await patchDraft(trx, req.claims, reach, req.params.id, req.body);
        } catch (e) {
          return sendErr(reply, e);
        }
      }),
  });

  /** The irreversible step (phase 3): `billing.issue`, one transaction,
   *  the number given last. 422 carries the structured problems; 409 a
   *  document already issued under another key. */
  r.route({
    method: 'POST',
    url: '/billing/invoices/:id/issue',
    preHandler: [app.authenticate],
    schema: {
      params: IdParams,
      body: BillingIssueRequestSchema,
      response: { 200: BillingInvoiceSchema, 403: Err, 404: Err, 409: Err, 422: z.union([BillingIssueBlockedSchema, Err]) },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        const reach = reachOf(await permsFor(trx, req.claims), 'billing.issue', req.claims);
        if (!reach) return reply.code(403).send({ error: 'FORBIDDEN', message: 'Missing permission: billing.issue' });
        try {
          return (await issueInvoice(trx, req.claims, reach, req.params.id, req.body.key)).invoice;
        } catch (e) {
          return sendErr(reply, e);
        }
      }),
  });

  r.route({
    method: 'GET',
    url: '/billing/invoices/:id/logo',
    preHandler: [app.authenticate],
    schema: { params: IdParams, response: { 200: BillingLogoSchema, 204: z.null(), 403: Err, 404: Err } },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        const reach = reachOf(await permsFor(trx, req.claims), 'billing.read', req.claims);
        if (!reach) return reply.code(403).send({ error: 'FORBIDDEN', message: 'Missing permission: billing.read' });
        try {
          const logo = await logoOf(trx, reach, req.params.id);
          if (!logo) return reply.code(204).send(null);
          return logo;
        } catch (e) {
          return sendErr(reply, e);
        }
      }),
  });

  /** The canonical PDF (phase 4): issued documents only, `billing.read`
   *  at the role's reach, the same bytes for preview and download —
   *  only the disposition differs. The ETag is the canonical hash. */
  r.route({
    method: 'GET',
    url: '/billing/invoices/:id/pdf',
    preHandler: [app.authenticate],
    schema: { params: IdParams, querystring: z.object({ download: z.enum(['0', '1']).default('0') }) },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        const reach = reachOf(await permsFor(trx, req.claims), 'billing.read', req.claims);
        if (!reach) return reply.code(403).send({ error: 'FORBIDDEN', message: 'Missing permission: billing.read' });
        try {
          const name = (await trx.selectFrom('employees').select('name').where('id', '=', req.claims.sub).executeTakeFirst())?.name ?? '';
          const pdf = await invoicePdf(trx, req.claims.ten, reach, req.params.id, { id: req.claims.sub, name });
          return reply
            .header('content-type', 'application/pdf')
            .header('content-disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${pdfFilename(pdf.number)}"`)
            .header('content-length', String(pdf.buffer.length))
            .header('etag', `"${pdf.sha256}"`)
            .header('x-document-sha256', pdf.sha256)
            .header('cache-control', 'private, no-store')
            .send(pdf.buffer);
        } catch (e) {
          return sendErr(reply, e);
        }
      }),
  });
}
