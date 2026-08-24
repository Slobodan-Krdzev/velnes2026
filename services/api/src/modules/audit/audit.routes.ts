import { AuditListResponseSchema, AuditQuerySchema } from '@velnes/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { withTenant } from '../../db/index.js';
import { listAudit } from './audit.service.js';

export function auditRoutes(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().route({
    method: 'GET',
    url: '/audit',
    preHandler: [app.authenticate],
    schema: {
      querystring: AuditQuerySchema,
      response: { 200: AuditListResponseSchema },
    },
    handler: async (req) => ({
      entries: await withTenant(req.claims.ten, (trx) => listAudit(trx, req.query)),
    }),
  });
}
