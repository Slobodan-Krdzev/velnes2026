import {
  BillingConsentWriteSchema,
  BillingCustomerListSchema,
  BillingCustomerQuerySchema,
  BillingCustomerSchema,
  BillingCustomerWriteSchema,
  BillingProfileListSchema,
  BillingProfileSchema,
  BillingProfileWriteSchema,
} from '@velnes/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant } from '../../db/index.js';
import { can, permsFor } from '../auth/authz.service.js';
import { BillingError, createCustomer, getCustomer, getProfile, listCustomers, listProfiles, setConsent, updateCustomer, upsertProfile } from './billing.service.js';

const Err = z.object({ error: z.string(), message: z.string() });
const IdParams = z.object({ id: z.uuid() });

function sendErr(reply: FastifyReply, e: unknown) {
  if (e instanceof BillingError)
    return reply.code(e.code === 'NOT_FOUND' ? 404 : 422).send({ error: e.code, message: e.message });
  throw e;
}

/** Invoicing phase 1 doors (Alex, 2026-10-06) — docs/INVOICING.md.
 *  `billing.settings` owns the issuer profile; `billing.create` the
 *  billing identities. RLS scopes every row to the tenant; a foreign
 *  id is simply not found. */
export function billingRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const gate = async (trx: Parameters<typeof permsFor>[0], claims: Parameters<typeof permsFor>[1], reply: FastifyReply, perm: 'billing.settings' | 'billing.create') => {
    const perms = await permsFor(trx, claims);
    if (can(perms, perm)) return true;
    reply.code(403).send({ error: 'FORBIDDEN', message: `Missing permission: ${perm}` });
    return false;
  };

  r.route({
    method: 'GET',
    url: '/billing/profiles',
    preHandler: [app.authenticate],
    schema: { response: { 200: BillingProfileListSchema, 403: Err } },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await gate(trx, req.claims, reply, 'billing.settings'))) return reply;
        return { profiles: await listProfiles(trx) };
      }),
  });

  r.route({
    method: 'GET',
    url: '/billing/profiles/:id',
    preHandler: [app.authenticate],
    schema: { params: IdParams, response: { 200: BillingProfileSchema, 403: Err, 404: Err } },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await gate(trx, req.claims, reply, 'billing.settings'))) return reply;
        try {
          return await getProfile(trx, req.params.id);
        } catch (e) {
          return sendErr(reply, e);
        }
      }),
  });

  r.route({
    method: 'PUT',
    url: '/billing/profiles/:id',
    preHandler: [app.authenticate],
    schema: { params: IdParams, body: BillingProfileWriteSchema, response: { 200: BillingProfileSchema, 403: Err, 404: Err, 422: Err } },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await gate(trx, req.claims, reply, 'billing.settings'))) return reply;
        try {
          return await upsertProfile(trx, req.claims, req.params.id, req.body);
        } catch (e) {
          return sendErr(reply, e);
        }
      }),
  });

  r.route({
    method: 'GET',
    url: '/billing/customers',
    preHandler: [app.authenticate],
    schema: { querystring: BillingCustomerQuerySchema, response: { 200: BillingCustomerListSchema, 403: Err } },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await gate(trx, req.claims, reply, 'billing.create'))) return reply;
        return { customers: await listCustomers(trx, req.query) };
      }),
  });

  r.route({
    method: 'GET',
    url: '/billing/customers/:id',
    preHandler: [app.authenticate],
    schema: { params: IdParams, response: { 200: BillingCustomerSchema, 403: Err, 404: Err } },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await gate(trx, req.claims, reply, 'billing.create'))) return reply;
        try {
          return await getCustomer(trx, req.params.id);
        } catch (e) {
          return sendErr(reply, e);
        }
      }),
  });

  r.route({
    method: 'POST',
    url: '/billing/customers',
    preHandler: [app.authenticate],
    schema: { body: BillingCustomerWriteSchema, response: { 200: BillingCustomerSchema, 403: Err, 404: Err, 422: Err } },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await gate(trx, req.claims, reply, 'billing.create'))) return reply;
        try {
          return await createCustomer(trx, req.claims, req.body);
        } catch (e) {
          return sendErr(reply, e);
        }
      }),
  });

  r.route({
    method: 'PATCH',
    url: '/billing/customers/:id',
    preHandler: [app.authenticate],
    schema: { params: IdParams, body: BillingCustomerWriteSchema, response: { 200: BillingCustomerSchema, 403: Err, 404: Err, 422: Err } },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await gate(trx, req.claims, reply, 'billing.create'))) return reply;
        try {
          return await updateCustomer(trx, req.claims, req.params.id, req.body);
        } catch (e) {
          return sendErr(reply, e);
        }
      }),
  });

  r.route({
    method: 'POST',
    url: '/billing/customers/:id/consent',
    preHandler: [app.authenticate],
    schema: { params: IdParams, body: BillingConsentWriteSchema, response: { 200: BillingCustomerSchema, 403: Err, 404: Err } },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await gate(trx, req.claims, reply, 'billing.create'))) return reply;
        try {
          return await setConsent(trx, req.claims, req.params.id, req.body);
        } catch (e) {
          return sendErr(reply, e);
        }
      }),
  });
}
