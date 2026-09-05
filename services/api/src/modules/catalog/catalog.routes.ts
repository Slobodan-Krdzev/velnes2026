import {
  CategoryListResponseSchema,
  CategoryRequestCreateSchema,
  CategoryRequestListSchema,
  ComboListSchema,
  ComboWriteSchema,
  IdResponseSchema,
  PlatformNoticeListSchema,
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
  createCombo,
  createProduct,
  createService,
  deleteCombo,
  listCombos,
  patchCombo,
  patchServiceOverride,
  patchVariantOverride,
  updateCombo,
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

  // Reading the resolved catalog is not only the catalog page's
  // right: the till and the booking drawer sell from the same list.
  const canReadCatalog = async (
    trx: Parameters<typeof permsFor>[0],
    claims: Parameters<typeof permsFor>[1],
  ) => {
    const perms = await permsFor(trx, claims);
    return (
      can(perms, 'catalog.view') || can(perms, 'pos.checkout') || can(perms, 'appointments.create')
    );
  };

  r.route({
    method: 'GET',
    url: '/locations/:id/catalog',
    preHandler: [app.authenticate],
    schema: {
      params: IdParams,
      response: { 200: LocationCatalogResponseSchema, 403: ErrorSchema },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await canReadCatalog(trx, req.claims)))
          return reply
            .code(403)
            .send({ error: 'FORBIDDEN', message: 'Missing permission: catalog.view' });
        return locationCatalog(trx, req.params.id);
      }),
  });

  r.route({
    method: 'POST',
    url: '/catalog/line-quote',
    preHandler: [app.authenticate],
    schema: {
      body: LineQuoteRequestSchema,
      response: { 200: LineQuoteResponseSchema, 403: ErrorSchema, 404: ErrorSchema, 422: ErrorSchema },
    },
    handler: async (req, reply) => {
      try {
        return await withTenant(req.claims.ten, async (trx) => {
          if (!(await canReadCatalog(trx, req.claims)))
            return reply
              .code(403)
              .send({ error: 'FORBIDDEN', message: 'Missing permission: catalog.view' });
          return svcLine(trx, {
            serviceId: req.body.serviceId,
            locationId: req.body.locationId,
            variantId: req.body.variantId ?? null,
            modifierOptionIds: req.body.modifierOptionIds,
            employeeId: req.body.employeeId ?? null,
          });
        });
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
      response: { 200: PriceForResponseSchema, 403: ErrorSchema, 404: ErrorSchema },
    },
    handler: async (req, reply) => {
      try {
        return await withTenant(req.claims.ten, async (trx) => {
          if (!(await canReadCatalog(trx, req.claims)))
            return reply
              .code(403)
              .send({ error: 'FORBIDDEN', message: 'Missing permission: catalog.view' });
          return priceFor(trx, {
            serviceId: req.query.serviceId,
            locationId: req.query.locationId,
            variantId: req.query.variantId ?? null,
            customerId: req.query.customerId ?? null,
            date: req.query.date,
            slotId: req.query.slotId ?? null,
          });
        });
      } catch (e) {
        return sendCatalogError(reply, e);
      }
    },
  });

  r.route({
    method: 'GET',
    url: '/categories',
    preHandler: [app.authenticate],
    schema: { response: { 200: CategoryListResponseSchema, 403: ErrorSchema } },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await canReadCatalog(trx, req.claims)))
          return reply
            .code(403)
            .send({ error: 'FORBIDDEN', message: 'Missing permission: catalog.view' });
        const svc = await trx
          .selectFrom('serviceCategories as c')
          .leftJoin('services as s', 's.categoryId', 'c.id')
          .select(['c.id', 'c.name'])
          .select((eb) => eb.fn.count<string>('s.id').as('n'))
          .groupBy(['c.id', 'c.name'])
          .orderBy('c.name')
          .execute();
        const prod = await trx
          .selectFrom('productCategories as c')
          .leftJoin('products as p', 'p.categoryId', 'c.id')
          .select(['c.id', 'c.name'])
          .select((eb) => eb.fn.count<string>('p.id').as('n'))
          .groupBy(['c.id', 'c.name'])
          .orderBy('c.name')
          .execute();
        return {
          categories: [
            ...svc.map((c) => ({ id: c.id, name: c.name, type: 'services' as const, items: Number(c.n) })),
            ...prod.map((c) => ({ id: c.id, name: c.name, type: 'products' as const, items: Number(c.n) })),
          ],
        };
      }),
  });

  // There is deliberately no POST /categories on the salon surface:
  // the taxonomy is Velnes-owned. HQ writes through /hq/categories.
  // What a salon CAN do is ask — a request with a lifecycle.

  r.route({
    method: 'GET',
    url: '/category-requests',
    preHandler: [app.authenticate],
    schema: { response: { 200: CategoryRequestListSchema, 403: ErrorSchema } },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await canReadCatalog(trx, req.claims)))
          return reply
            .code(403)
            .send({ error: 'FORBIDDEN', message: 'Missing permission: catalog.view' });
        const rows = await trx
          .selectFrom('categoryRequests')
          .selectAll()
          .orderBy('createdAt', 'desc')
          .limit(50)
          .execute();
        return {
          requests: rows.map((r2) => ({
            id: r2.id,
            name: r2.name,
            type: r2.kind as 'services' | 'products',
            note: r2.note,
            status: r2.status as 'pending' | 'approved' | 'declined',
            hqReason: r2.hqReason,
            createdAt: r2.createdAt.toISOString(),
            decidedAt: r2.decidedAt ? r2.decidedAt.toISOString() : null,
          })),
        };
      }),
  });

  r.route({
    method: 'POST',
    url: '/category-requests',
    preHandler: [app.authenticate],
    schema: {
      body: CategoryRequestCreateSchema,
      response: { 200: IdResponseSchema, 403: ErrorSchema, 409: ErrorSchema },
    },
    handler: async (req, reply) => {
      try {
        return await withTenant(req.claims.ten, async (trx) => {
          await requirePerm('catalog.edit')(trx, req);
          const table =
            req.body.type === 'services' ? ('serviceCategories' as const) : ('productCategories' as const);
          const exists = await trx
            .selectFrom(table)
            .select('id')
            .where('name', '=', req.body.name)
            .executeTakeFirst();
          if (exists)
            return reply
              .code(409)
              .send({ error: 'EXISTS', message: 'That category already exists — just pick it' });
          const pending = await trx
            .selectFrom('categoryRequests')
            .select('id')
            .where('name', '=', req.body.name)
            .where('kind', '=', req.body.type)
            .where('status', '=', 'pending')
            .executeTakeFirst();
          if (pending)
            return reply
              .code(409)
              .send({ error: 'PENDING', message: 'That request is already with Velnes HQ' });
          const row = await trx
            .insertInto('categoryRequests')
            .values({
              tenantId: req.claims.ten,
              name: req.body.name,
              kind: req.body.type,
              note: req.body.note,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          // Ring HQ's bell — the ask should not wait to be found.
          const biz = await trx.selectFrom('businesses').select('name').executeTakeFirst();
          await trx
            .insertInto('platformNotices')
            .values({
              audience: 'hq',
              kind: 'category_request',
              title: `Category request: ${req.body.name}`,
              body: `${biz?.name ?? 'A salon'} asks for a new ${
                req.body.type === 'services' ? 'service' : 'product'
              } category.`,
            })
            .execute();
          return { id: row.id };
        });
      } catch (e) {
        return sendCatalogError(reply, e);
      }
    },
  });

  // Platform notices — global reads, newest first. The bell in the
  // shell drinks from here.
  r.route({
    method: 'GET',
    url: '/notices',
    preHandler: [app.authenticate],
    schema: { response: { 200: PlatformNoticeListSchema } },
    handler: async (req) =>
      withTenant(req.claims.ten, async (trx) => {
        const rows = await trx
          .selectFrom('platformNotices')
          .selectAll()
          .where('audience', '=', 'salons')
          .orderBy('createdAt', 'desc')
          .limit(20)
          .execute();
        return {
          notices: rows.map((n) => ({
            id: n.id,
            kind: n.kind,
            title: n.title,
            body: n.body,
            refId: n.refId ?? null,
            createdAt: n.createdAt.toISOString(),
          })),
        };
      }),
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

  // ── Combos (the till's Packages): tenant-level sellable bundles. ──
  r.route({
    method: 'GET',
    url: '/combos',
    preHandler: [app.authenticate],
    schema: { response: { 200: ComboListSchema, 403: ErrorSchema } },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await canReadCatalog(trx, req.claims)))
          return reply
            .code(403)
            .send({ error: 'FORBIDDEN', message: 'Missing permission: catalog.view' });
        return { combos: await listCombos(trx) };
      }),
  });

  r.route({
    method: 'POST',
    url: '/combos',
    preHandler: [app.authenticate],
    schema: { body: ComboWriteSchema, response: { 200: IdResponseSchema, 403: ErrorSchema, 422: ErrorSchema } },
    handler: async (req, reply) => {
      try {
        return await withTenant(req.claims.ten, async (trx) => {
          await requirePerm('catalog.edit')(trx, req);
          return { id: await createCombo(trx, req.claims, req.body) };
        });
      } catch (e) {
        return sendCatalogError(reply, e);
      }
    },
  });

  r.route({
    method: 'PUT',
    url: '/combos/:id',
    preHandler: [app.authenticate],
    schema: {
      params: IdParams,
      body: ComboWriteSchema,
      response: { 200: OkSchema, 403: ErrorSchema, 404: ErrorSchema, 422: ErrorSchema },
    },
    handler: async (req, reply) => {
      try {
        await withTenant(req.claims.ten, async (trx) => {
          await requirePerm('catalog.edit')(trx, req);
          await updateCombo(trx, req.claims, req.params.id, req.body);
        });
        return { ok: true as const };
      } catch (e) {
        return sendCatalogError(reply, e);
      }
    },
  });

  r.route({
    method: 'PATCH',
    url: '/combos/:id',
    preHandler: [app.authenticate],
    schema: {
      params: IdParams,
      body: z.object({
        pos: z.boolean().optional(),
        online: z.boolean().optional(),
        status: z.enum(['active', 'draft']).optional(),
      }),
      response: { 200: OkSchema, 403: ErrorSchema, 404: ErrorSchema },
    },
    handler: async (req, reply) => {
      try {
        await withTenant(req.claims.ten, async (trx) => {
          await requirePerm('catalog.edit')(trx, req);
          await patchCombo(trx, req.params.id, req.body);
        });
        return { ok: true as const };
      } catch (e) {
        return sendCatalogError(reply, e);
      }
    },
  });

  r.route({
    method: 'DELETE',
    url: '/combos/:id',
    preHandler: [app.authenticate],
    schema: { params: IdParams, response: { 200: OkSchema, 403: ErrorSchema, 404: ErrorSchema } },
    handler: async (req, reply) => {
      try {
        await withTenant(req.claims.ten, async (trx) => {
          await requirePerm('catalog.edit')(trx, req);
          await deleteCombo(trx, req.params.id);
        });
        return { ok: true as const };
      } catch (e) {
        return sendCatalogError(reply, e);
      }
    },
  });
}
