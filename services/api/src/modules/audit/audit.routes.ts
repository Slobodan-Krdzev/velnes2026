import { AuditListResponseSchema, AuditQuerySchema } from '@velnes/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant } from '../../db/index.js';
import { can, permsFor } from '../auth/authz.service.js';
import { listAudit } from './audit.service.js';

export function auditRoutes(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().route({
    method: 'GET',
    url: '/audit',
    preHandler: [app.authenticate],
    schema: {
      querystring: AuditQuerySchema,
      response: {
        200: AuditListResponseSchema,
        403: z.object({ error: z.string(), message: z.string() }),
      },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        // The log names people and money moves — the same right that
        // gates the settings section (SEC_PERM) gates the door.
        const perms = await permsFor(trx, req.claims);
        if (!can(perms, 'users.manage') && !can(perms, 'roles.manage'))
          return reply
            .code(403)
            .send({ error: 'FORBIDDEN', message: 'Missing permission: users.manage' });
        return { entries: await listAudit(trx, req.query) };
      }),
  });
}
