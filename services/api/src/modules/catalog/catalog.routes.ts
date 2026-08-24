import {
  IdResponseSchema,
  LineQuoteRequestSchema,
  LineQuoteResponseSchema,
  LocationCatalogResponseSchema,
  PriceForRequestSchema,
  PriceForResponseSchema,
  ProductWriteSchema,
  ServiceOverridePatchSchema,
  ServiceWriteSchema,
  VariantOverridePatchSchema,
  type PermKey,
} from '@velnes/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant, type Trx } from '../../db/index.js';
import { can, permsFor } from '../auth/authz.service.js';
import {
  createProduct,
  createService,
  patchServiceOverride,
  patchVariantOverride,
  updateProduct,
  updateService,
} from './catalog.crud.service.js';
import { CatalogError, locationCatalog, priceFor, svcLine } from './catalog.service.js';

const ErrorSchema = z.object({ error: z.string(), message: z.string() });
const OkSchema = z.object({ ok: z.literal(true) });

export function requirePerm(key: PermKey) {
  return async (trx: Trx, req: FastifyRequest) => {
    const perms = await permsFor(trx, req.claims);
    if (!can(perms, key)) throw new CatalogError('NOT_FOUND', `Missing permission: ${key}`);
  };
}

function sendCatalogError(reply: FastifyReply, e: unknown) {
  if (e instanceof CatalogError) {
    const status = e.message.startsWith('Missing permission')
      ? 403
      : e.code === 'NOT_FOUND'
        ? 404
        : 422;
    return reply.code(status as 403).send({ error: e.code, message: e.message });
  }
  throw e;
}

export function catalogRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const IdParams = z.object({ id: z.uuid() });

  r.route({
    method: 'GET',
    url: '/locations/:id/catalog',
    preHandler: [app.authenticate],
    schema: { params: IdParams, response: { 200: LocationCatalogResponseSchema } },
    handler: async (req) =>
      withTenant(req.claims.ten, (trx) => locationCatalog(trx, req.params.id)),
  });

  r.route({
    method: 'POST',
    url: '/catalog/line-quote',
    preHandler: [app.authenticate],
    schema: {
      body: LineQuoteRequestSchema,
      response: { 200: LineQuoteResponseSchema, 404: ErrorSchema, 422: ErrorSchema },
    },
    handler: async (req, reply) => {
      try {
        return await withTenant(req.claims.ten, (trx) =>
          svcLine(trx, {
            serviceId: req.body.serviceId,
            locationId: req.body.locationId,
            variantId: req.body.variantId ?? null,
            modifierOptionIds: req.body.modifierOptionIds,
            employeeId: req.body.employeeId ?? null,
          }),
        );
      } catch (e) {
        return sendCatalogError(reply, e);
      }
    },
  });

  r.route({
    method: 'GET',
    url: '/price',
    preHandler: [app.authenticate],
    schema: {
      querystring: PriceForRequestSchema,
      response: { 200: PriceForResponseSchema, 404: ErrorSchema },
    },
    handler: async (req, reply) => {
      try {
        return await withTenant(req.claims.ten, (trx) =>
          priceFor(trx, {
            serviceId: req.query.serviceId,
            locationId: req.query.locationId,
            variantId: req.query.variantId ?? null,
          }),
        );
      } catch (e) {
        return sendCatalogError(reply, e);
      }
    },
  });

  r.route({
    method: 'POST',
    url: '/services',
    preHandler: [app.authenticate],
    schema: {
      body: ServiceWriteSchema,
      response: { 200: IdResponseSchema, 403: ErrorSchema },
    },
    handler: async (req, reply) => {
      try {
        return await withTenant(req.claims.ten, async (trx) => {
          await requirePerm('catalog.edit')(trx, req);
          return { id: await createService(trx, req.claims, req.body) };
        });
      } catch (e) {
        return sendCatalogError(reply, e);
      }
    },
  });

  r.route({
    method: 'PUT',
    url: '/services/:id',
    preHandler: [app.authenticate],
    schema: {
      params: IdParams,
      body: ServiceWriteSchema,
      response: { 200: OkSchema, 403: ErrorSchema, 404: ErrorSchema },
    },
    handler: async (req, reply) => {
      try {
        await withTenant(req.claims.ten, async (trx) => {
          await requirePerm('catalog.edit')(trx, req);
          await updateService(trx, req.claims, req.params.id, req.body);
        });
        return { ok: true as const };
      } catch (e) {
        return sendCatalogError(reply, e);
      }
    },
  });

  r.route({
    method: 'PATCH',
    url: '/locations/:id/catalog/services/:serviceId',
    preHandler: [app.authenticate],
    schema: {
      params: z.object({ id: z.uuid(), serviceId: z.uuid() }),
      body: ServiceOverridePatchSchema,
      response: { 200: OkSchema, 403: ErrorSchema, 404: ErrorSchema },
    },
    handler: async (req, reply) => {
      try {
        await withTenant(req.claims.ten, async (trx) => {
          await requirePerm('catalog.edit')(trx, req);
          await patchServiceOverride(trx, req.claims, req.params.id, req.params.serviceId, req.body);
        });
        return { ok: true as const };
      } catch (e) {
        return sendCatalogError(reply, e);
      }
    },
  });

  r.route({
    method: 'PATCH',
    url: '/locations/:id/catalog/variants/:variantId',
    preHandler: [app.authenticate],
    schema: {
      params: z.object({ id: z.uuid(), variantId: z.uuid() }),
      body: VariantOverridePatchSchema,
      response: { 200: OkSchema, 403: ErrorSchema, 404: ErrorSchema },
    },
    handler: async (req, reply) => {
      try {
        await withTenant(req.claims.ten, async (trx) => {
          await requirePerm('catalog.edit')(trx, req);
          await patchVariantOverride(trx, req.claims, req.params.id, req.params.variantId, req.body);
        });
        return { ok: true as const };
      } catch (e) {
        return sendCatalogError(reply, e);
      }
    },
  });

  r.route({
    method: 'POST',
    url: '/products',
    preHandler: [app.authenticate],
    schema: {
      body: ProductWriteSchema,
      response: { 200: IdResponseSchema, 403: ErrorSchema },
    },
    handler: async (req, reply) => {
      try {
        return await withTenant(req.claims.ten, async (trx) => {
          await requirePerm('catalog.edit')(trx, req);
          return { id: await createProduct(trx, req.claims, req.body) };
        });
      } catch (e) {
        return sendCatalogError(reply, e);
      }
    },
  });

  r.route({
    method: 'PUT',
    url: '/products/:id',
    preHandler: [app.authenticate],
    schema: {
      params: IdParams,
      body: ProductWriteSchema,
      response: { 200: OkSchema, 403: ErrorSchema, 404: ErrorSchema },
    },
    handler: async (req, reply) => {
      try {
        await withTenant(req.claims.ten, async (trx) => {
          await requirePerm('catalog.edit')(trx, req);
          await updateProduct(trx, req.claims, req.params.id, req.body);
        });
        return { ok: true as const };
      } catch (e) {
        return sendCatalogError(reply, e);
      }
    },
  });
}
