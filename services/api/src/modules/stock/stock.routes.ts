import {
  StockMovementListSchema,
  StockMovementQuerySchema,
  StockMoveRequestSchema,
  StockMoveResponseSchema,
} from '@velnes/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant } from '../../db/index.js';
import { can, permsFor } from '../auth/authz.service.js';
import { StockError, stockMove } from './stock.service.js';

const ErrorSchema = z.object({ error: z.string(), message: z.string() });

export function stockRoutes(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().route({
    method: 'GET',
    url: '/stock/movements',
    preHandler: [app.authenticate],
    schema: {
      querystring: StockMovementQuerySchema,
      response: { 200: StockMovementListSchema, 403: ErrorSchema },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        // Seeing the ledger is inventory.view's right — stock numbers
        // on the till ride the catalog read; the history does not.
        const perms = await permsFor(trx, req.claims);
        if (!can(perms, 'inventory.view'))
          return reply
            .code(403)
            .send({ error: 'FORBIDDEN', message: 'Missing permission: inventory.view' });
        let q = trx
          .selectFrom('stockMovements as m')
          .innerJoin('products as p', 'p.id', 'm.productId')
          .innerJoin('locations as l', 'l.id', 'm.locationId')
          .leftJoin('employees as e', 'e.id', 'm.actorEmployeeId')
          .selectAll('m')
          .select(['p.name as productName', 'l.name as locationName', 'e.name as actorName'])
          .orderBy('m.at', 'desc')
          .limit(req.query.limit);
        if (req.query.productId) q = q.where('m.productId', '=', req.query.productId);
        if (req.query.locationId) q = q.where('m.locationId', '=', req.query.locationId);
        const rows = await q.execute();
        return {
          movements: rows.map((m) => ({
            id: m.id,
            at: m.at.toISOString(),
            kind: m.kind,
            qty: m.qty,
            productId: m.productId,
            productName: m.productName,
            locationId: m.locationId,
            locationName: m.locationName,
            ref: m.ref,
            note: m.note,
            actorName: m.actorName,
          })),
        };
      }),
  });

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
