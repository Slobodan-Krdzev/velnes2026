import {
  LoginRequestSchema,
  LoginResponseSchema,
  LogoutRequestSchema,
  MeResponseSchema,
  RefreshRequestSchema,
  RefreshResponseSchema,
} from '@velnes/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AuthError, claimsFor, login, logout, me, rotateRefreshToken } from './auth.service.js';
import { env } from '../../env.js';

const ErrorSchema = z.object({ error: z.string() });

export function authRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'POST',
    url: '/auth/login',
    schema: {
      body: LoginRequestSchema,
      response: { 200: LoginResponseSchema, 401: ErrorSchema },
    },
    handler: async (req, reply) => {
      try {
        const { employee, refreshToken } = await login(req.body.email, req.body.password);
        const accessToken = await reply.jwtSign(claimsFor(employee), {
          expiresIn: env.accessTtl,
        });
        return { accessToken, refreshToken, employee };
      } catch (e) {
        if (e instanceof AuthError) return reply.code(401).send({ error: e.code });
        throw e;
      }
    },
  });

  r.route({
    method: 'POST',
    url: '/auth/refresh',
    schema: {
      body: RefreshRequestSchema,
      response: { 200: RefreshResponseSchema, 401: ErrorSchema },
    },
    handler: async (req, reply) => {
      try {
        const { employee, refreshToken } = await rotateRefreshToken(req.body.refreshToken);
        const accessToken = await reply.jwtSign(claimsFor(employee), {
          expiresIn: env.accessTtl,
        });
        return { accessToken, refreshToken };
      } catch (e) {
        if (e instanceof AuthError) return reply.code(401).send({ error: e.code });
        throw e;
      }
    },
  });

  r.route({
    method: 'POST',
    url: '/auth/logout',
    schema: {
      body: LogoutRequestSchema,
      response: { 204: z.null() },
    },
    handler: async (req, reply) => {
      await logout(req.body.refreshToken);
      return reply.code(204).send(null);
    },
  });

  r.route({
    method: 'GET',
    url: '/auth/me',
    preHandler: [app.authenticate],
    schema: { response: { 200: MeResponseSchema } },
    handler: async (req) => me(req.claims),
  });
}
