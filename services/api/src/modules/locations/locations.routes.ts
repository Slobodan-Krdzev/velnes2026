import {
  LocationListResponseSchema,
  ReadinessResponseSchema,
  TransitionRequestSchema,
  TransitionResponseSchema,
} from '@velnes/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant } from '../../db/index.js';
import { can, permsFor } from '../auth/authz.service.js';
import {
  listLocations,
  LocationError,
  locReadiness,
  locTransition,
} from './locations.service.js';

const ErrorSchema = z.object({ error: z.string(), message: z.string() });
const IdParams = z.object({ id: z.uuid() });

const statusFor = {
  NOT_FOUND: 404,
  ILLEGAL_TRANSITION: 409,
  NOT_READY: 409,
  OWNER_ONLY: 403,
} as const satisfies Record<LocationError['code'], number>;

export function locationsRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/locations',
    preHandler: [app.authenticate],
    schema: { response: { 200: LocationListResponseSchema } },
    handler: async (req) => ({
      locations: await withTenant(req.claims.ten, (trx) => listLocations(trx)),
    }),
  });

  r.route({
    method: 'GET',
    url: '/locations/:id/readiness',
    preHandler: [app.authenticate],
    schema: {
      params: IdParams,
      response: { 200: ReadinessResponseSchema, 403: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema },
    },
    handler: async (req, reply) => {
      try {
        return await withTenant(req.claims.ten, (trx) => locReadiness(trx, req.params.id));
      } catch (e) {
        if (e instanceof LocationError)
          return reply.code(statusFor[e.code]).send({ error: e.code, message: e.message });
        throw e;
      }
    },
  });

  r.route({
    method: 'POST',
    url: '/locations/:id/transitions',
    preHandler: [app.authenticate],
    schema: {
      params: IdParams,
      body: TransitionRequestSchema,
      response: { 200: TransitionResponseSchema, 403: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema },
    },
    handler: async (req, reply) => {
      try {
        const location = await withTenant(req.claims.ten, async (trx) => {
          const perms = await permsFor(trx, req.claims);
          if (!can(perms, 'locations.manage'))
            throw new LocationError('OWNER_ONLY', 'Missing permission: locations.manage');
          return locTransition(trx, req.claims, req.params.id, req.body.to, req.body.reason);
        });
        return { location };
      } catch (e) {
        if (e instanceof LocationError)
          return reply.code(statusFor[e.code]).send({ error: e.code, message: e.message });
        throw e;
      }
    },
  });
}
