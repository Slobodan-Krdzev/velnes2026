import { WorkspaceReviewsPageSchema, WorkspaceReviewsQuerySchema, WorkspaceReviewsSummarySchema } from '@velnes/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant } from '../../db/index.js';
import { can, permsFor } from '../auth/authz.service.js';
import { tenantReviewSummary, tenantReviews } from './reviews.service.js';

const ErrorSchema = z.object({ error: z.string(), message: z.string() });

/**
 * The salon's window on its reviews (Alex, 2026-09-30): read-only, by
 * design and by RLS — there is no door here that changes a customer's
 * words or stars, and there will not be one in the workspace. Gated on
 * `reviews.view`.
 */
export function reviewsRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/reviews/summary',
    preHandler: [app.authenticate],
    schema: { response: { 200: WorkspaceReviewsSummarySchema, 403: ErrorSchema } },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        const perms = await permsFor(trx, req.claims);
        if (!can(perms, 'reviews.view')) return reply.code(403).send({ error: 'FORBIDDEN', message: 'No access to reviews' });
        return tenantReviewSummary(trx, req.claims.ten);
      }),
  });

  r.route({
    method: 'GET',
    url: '/reviews',
    preHandler: [app.authenticate],
    schema: { querystring: WorkspaceReviewsQuerySchema, response: { 200: WorkspaceReviewsPageSchema, 403: ErrorSchema } },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        const perms = await permsFor(trx, req.claims);
        if (!can(perms, 'reviews.view')) return reply.code(403).send({ error: 'FORBIDDEN', message: 'No access to reviews' });
        return tenantReviews(trx, req.claims.ten, req.query);
      }),
  });
}
