import {
  RegistrationCreateResponseSchema,
  RegistrationDraftSchema,
  RegistrationStatusResponseSchema,
  RegistrationStatusSchema,
  type RegistrationDraft,
} from '@velnes/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createRegistration,
  registrationByToken,
  RegistrationError,
  resubmitRegistration,
} from './registrations.service.js';

const Err = z.object({ error: z.string(), message: z.string() });

function sendRegError(reply: FastifyReply, e: unknown) {
  if (e instanceof RegistrationError) {
    const code = e.code === 'NOT_FOUND' ? 404 : e.code === 'EMAIL_TAKEN' ? 409 : 422;
    return reply.code(code).send({ error: e.code, message: e.message });
  }
  throw e;
}

/** The anonymous front door of the platform: apply, check where you
 *  stand, resubmit after "changes required". The token from creation
 *  is the applicant's only key — RLS matches it row-by-row. */
export function registrationsRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'POST',
    url: '/registrations',
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    schema: {
      body: RegistrationDraftSchema,
      response: { 200: RegistrationCreateResponseSchema, 409: Err },
    },
    handler: async (req, reply) => {
      try {
        return await createRegistration(req.body as RegistrationDraft);
      } catch (e) {
        return sendRegError(reply, e);
      }
    },
  });

  r.route({
    method: 'GET',
    url: '/registrations/:id',
    schema: {
      params: z.object({ id: z.uuid() }),
      querystring: z.object({ token: z.uuid() }),
      response: { 200: RegistrationStatusResponseSchema, 404: Err },
    },
    handler: async (req, reply) => {
      const row = await registrationByToken(req.params.id, req.query.token);
      if (!row)
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown registration' });
      const draft = row.draft as RegistrationDraft;
      return {
        id: row.id,
        status: RegistrationStatusSchema.parse(row.status),
        hqReason: row.hqReason,
        draft: { ...draft, acct: { name: draft.acct.name, email: draft.acct.email } },
      };
    },
  });

  r.route({
    method: 'POST',
    url: '/registrations/:id/resubmit',
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    schema: {
      params: z.object({ id: z.uuid() }),
      querystring: z.object({ token: z.uuid() }),
      body: RegistrationDraftSchema,
      response: {
        200: z.object({ id: z.uuid(), status: RegistrationStatusSchema }),
        404: Err,
        422: Err,
      },
    },
    handler: async (req, reply) => {
      try {
        return await resubmitRegistration(
          req.params.id,
          req.query.token,
          req.body as RegistrationDraft,
        );
      } catch (e) {
        return sendRegError(reply, e);
      }
    },
  });
}
