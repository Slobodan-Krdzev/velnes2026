import {
  LoginRequestSchema,
  LoginByIdRequestSchema,
  MePatchSchema,
  LoginResponseSchema,
  OkResponseSchema,
  LogoutRequestSchema,
  MeResponseSchema,
  PreviewRequestSchema,
  PreviewResponseSchema,
  RefreshRequestSchema,
  RefreshResponseSchema,
  SetPasswordRequestSchema,
  SignInLinkRedeemRequestSchema,
  SignInLinkRedeemResponseSchema,
} from '@velnes/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AuthError,
  PreviewError,
  claimsFor,
  login,
  loginById,
  logout,
  me,
  rotateRefreshToken,
  updateMe,
  startPreview,
} from './auth.service.js';
import { env } from '../../env.js';
import { redeemSignInLink, setOwnPassword } from './sign-in-link.service.js';

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
    url: '/auth/login-id',
    schema: {
      body: LoginByIdRequestSchema,
      response: { 200: LoginResponseSchema, 401: ErrorSchema },
    },
    handler: async (req, reply) => {
      try {
        const { employee, refreshToken } = await loginById(req.body.employeeId, req.body.password);
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

  /** A personal sign-in link, opened on the phone: signs that one
   *  person into their own salon (Alex, 2026-09-23). Single use. */
  r.route({
    method: 'POST',
    url: '/auth/sign-in-link',
    schema: {
      body: SignInLinkRedeemRequestSchema,
      response: { 200: SignInLinkRedeemResponseSchema, 401: ErrorSchema },
    },
    handler: async (req, reply) => {
      try {
        const { employee, refreshToken, needsPassword, salonName } = await redeemSignInLink(req.body.token);
        const accessToken = await reply.jwtSign(claimsFor(employee), { expiresIn: env.accessTtl });
        return { accessToken, refreshToken, employee, needsPassword, salonName };
      } catch (e) {
        if (e instanceof AuthError) return reply.code(401).send({ error: e.code });
        throw e;
      }
    },
  });

  /** Choose or change your own password: free the first time (the link
   *  brought you in), the current one required after that. */
  r.route({
    method: 'POST',
    url: '/auth/password',
    preHandler: [app.authenticate],
    schema: {
      body: SetPasswordRequestSchema,
      response: { 200: OkResponseSchema, 401: ErrorSchema },
    },
    handler: async (req, reply) => {
      try {
        await setOwnPassword(req.claims, req.body.password, req.body.current);
        return { ok: true as const };
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

  r.route({
    method: 'POST',
    url: '/auth/preview',
    preHandler: [app.authenticate],
    schema: {
      body: PreviewRequestSchema,
      response: {
        200: PreviewResponseSchema,
        400: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
    },
    handler: async (req, reply) => {
      try {
        const employee = await startPreview(
          req.claims,
          req.body.employeeId,
          req.body.renew ?? false,
        );
        const accessToken = await reply.jwtSign(claimsFor(employee), {
          expiresIn: env.accessTtl,
        });
        return { accessToken, employee };
      } catch (e) {
        if (e instanceof PreviewError) {
          const status = { SELF: 400, FORBIDDEN: 403, NOT_FOUND: 404 } as const;
          return reply.code(status[e.code]).send({ error: e.code });
        }
        throw e;
      }
    },
  });

  r.route({
    method: 'PATCH',
    url: '/auth/me',
    preHandler: [app.authenticate],
    schema: { body: MePatchSchema, response: { 200: MeResponseSchema } },
    handler: async (req) => updateMe(req.claims, req.body),
  });
}
