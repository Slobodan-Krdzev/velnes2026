import { StockMoveRequestSchema, StockMoveResponseSchema } from '@velnes/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant } from '../../db/index.js';
import { can, permsFor } from '../auth/authz.service.js';
import { StockError, stockMove } from './stock.service.js';

const ErrorSchema = z.object({ error: z.string(), message: z.string() });

export function stockRoutes(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().route({
    method: 'POST',
    url: '/stock/movements',
    preHandler: [app.authenticate],
    schema: {
      body: StockMoveRequestSchema,
      response: {
        200: StockMoveResponseSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        409: ErrorSchema,
        422: ErrorSchema,
      },
    },
    handler: async (req, reply) => {
      const permNeeded =
        req.body.kind === 'transfer' ? ('inventory.transfer' as const) : ('inventory.adjust' as const);
      try {
        return await withTenant(req.claims.ten, async (trx) => {
          const perms = await permsFor(trx, req.claims);
          if (!can(perms, permNeeded))
            return reply
              .code(403)
              .send({ error: 'FORBIDDEN', message: `Missing permission: ${permNeeded}` });
          return stockMove(trx, req.claims, req.body);
        });
      } catch (e) {
        if (e instanceof StockError) {
          const status = e.code === 'NOT_FOUND' ? 404 : e.code === 'INSUFFICIENT' ? 409 : 422;
          return reply.code(status as 404).send({ error: e.code, message: e.message });
        }
        throw e;
      }
    },
  });
}
