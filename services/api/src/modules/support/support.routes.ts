import {
  SupportTicketCreateSchema,
  SupportTicketListSchema,
  SupportTicketReplySchema,
} from '@velnes/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant } from '../../db/index.js';
import { createTicket, listTickets, replyToTicket, SupportError } from './support.service.js';

const Err = z.object({ error: z.string(), message: z.string() });

function sendErr(reply: FastifyReply, e: unknown) {
  if (e instanceof SupportError)
    return reply.code(e.code === 'NOT_FOUND' ? 404 : 422).send({ error: e.code, message: e.message });
  throw e;
}

/** The salon's side of support: open a ticket to Revelapps HQ, read
 *  the thread, and reply. Every write also queues mail to HQ. */
export function supportRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/support/tickets',
    preHandler: [app.authenticate],
    schema: { response: { 200: SupportTicketListSchema } },
    handler: async (req) =>
      withTenant(req.claims.ten, async (trx) => ({ tickets: await listTickets(trx) })),
  });

  r.route({
    method: 'POST',
    url: '/support/tickets',
    preHandler: [app.authenticate],
    schema: { body: SupportTicketCreateSchema, response: { 200: z.object({ id: z.uuid() }), 422: Err } },
    handler: async (req, reply) => {
      try {
        return await withTenant(req.claims.ten, async (trx) => {
          const biz = await trx
            .selectFrom('businesses')
            .select('name')
            .where('id', '=', req.claims.ten)
            .executeTakeFirst();
          const me = await trx
            .selectFrom('employees')
            .select(['name', 'email'])
            .where('id', '=', req.claims.sub)
            .executeTakeFirst();
          const id = await createTicket(trx, {
            origin: 'tenant',
            tenantId: req.claims.ten,
            supplierId: null,
            originName: biz?.name ?? 'Salon',
            createdBy: me?.name ?? 'Salon',
            replyTo: me?.email ?? '',
            subject: req.body.subject,
            category: req.body.category,
            body: req.body.body,
          });
          return { id };
        });
      } catch (e) {
        return sendErr(reply, e);
      }
    },
  });

  r.route({
    method: 'POST',
    url: '/support/tickets/:id/reply',
    preHandler: [app.authenticate],
    schema: {
      params: z.object({ id: z.uuid() }),
      body: SupportTicketReplySchema.pick({ body: true }),
      response: { 200: z.object({ ok: z.literal(true) }), 404: Err, 422: Err },
    },
    handler: async (req, reply) => {
      try {
        await withTenant(req.claims.ten, async (trx) => {
          const me = await trx
            .selectFrom('employees')
            .select('name')
            .where('id', '=', req.claims.sub)
            .executeTakeFirst();
          await replyToTicket(trx, req.params.id, {
            authorKind: 'tenant',
            authorName: me?.name ?? 'Salon',
            body: req.body.body,
          });
        });
        return { ok: true as const };
      } catch (e) {
        return sendErr(reply, e);
      }
    },
  });
}
