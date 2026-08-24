import { RecomputeResponseSchema, TimingSuggestionsResponseSchema } from '@velnes/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant } from '../../db/index.js';
import {
  acceptTiming,
  dismissTiming,
  listSuggestions,
  recomputeAll,
  TimingError,
} from './timing.service.js';

const ErrorSchema = z.object({ error: z.string(), message: z.string() });
const IdParams = z.object({ id: z.uuid() });

export function timingRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'POST',
    url: '/timings/recompute',
    preHandler: [app.authenticate],
    schema: { response: { 200: RecomputeResponseSchema } },
    handler: async (req) =>
      withTenant(req.claims.ten, (trx) => recomputeAll(trx, req.claims.ten)),
  });

  r.route({
    method: 'GET',
    url: '/timings/suggestions',
    preHandler: [app.authenticate],
    schema: { response: { 200: TimingSuggestionsResponseSchema } },
    handler: async (req) => ({
      suggestions: await withTenant(req.claims.ten, (trx) => listSuggestions(trx)),
    }),
  });

  for (const action of ['approve', 'dismiss'] as const) {
    r.route({
      method: 'POST',
      url: `/timings/:id/${action}`,
      preHandler: [app.authenticate],
      schema: {
        params: IdParams,
        response: { 200: z.object({ ok: z.literal(true) }), 404: ErrorSchema, 422: ErrorSchema },
      },
      handler: async (req, reply) => {
        try {
          await withTenant(req.claims.ten, (trx) =>
            action === 'approve'
              ? acceptTiming(trx, req.claims, req.params.id)
              : dismissTiming(trx, req.params.id),
          );
          return { ok: true as const };
        } catch (e) {
          if (e instanceof TimingError) {
            const status = e.code === 'NOT_FOUND' ? 404 : 422;
            return reply.code(status as 404).send({ error: e.code, message: e.message });
          }
          throw e;
        }
      },
    });
  }
}
