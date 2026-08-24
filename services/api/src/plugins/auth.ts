import jwt from '@fastify/jwt';
import { AccessClaimsSchema, type AccessClaims } from '@velnes/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { env } from '../env.js';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    claims: AccessClaims;
  }
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  await app.register(jwt, { secret: env.jwtSecret });

  app.decorateRequest('claims');
  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = await req.jwtVerify();
      req.claims = AccessClaimsSchema.parse(payload);
    } catch {
      await reply.code(401).send({ error: 'UNAUTHORIZED' });
    }
  });
});
