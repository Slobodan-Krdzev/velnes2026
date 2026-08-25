import jwt from '@fastify/jwt';
import {
  AccessClaimsSchema,
  HqClaimsSchema,
  SupplierClaimsSchema,
  type AccessClaims,
  type HqClaims,
  type SupplierClaims,
} from '@velnes/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { env } from '../env.js';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateHq: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateSupplier: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    claims: AccessClaims;
    hqClaims: HqClaims;
    supplierClaims: SupplierClaims;
  }
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  await app.register(jwt, { secret: env.jwtSecret });

  app.decorateRequest('claims');
  app.decorateRequest('hqClaims');
  app.decorateRequest('supplierClaims');
  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = await req.jwtVerify();
      // An HQ token never opens a tenant door: the shapes reject
      // each other by construction.
      req.claims = AccessClaimsSchema.parse(payload);
    } catch {
      await reply.code(401).send({ error: 'UNAUTHORIZED' });
    }
  });
  app.decorate('authenticateHq', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = await req.jwtVerify();
      req.hqClaims = HqClaimsSchema.parse(payload);
    } catch {
      await reply.code(401).send({ error: 'UNAUTHORIZED' });
    }
  });
  app.decorate('authenticateSupplier', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = await req.jwtVerify();
      req.supplierClaims = SupplierClaimsSchema.parse(payload);
    } catch {
      await reply.code(401).send({ error: 'UNAUTHORIZED' });
    }
  });
});
