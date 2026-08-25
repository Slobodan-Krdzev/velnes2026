import {
  OrderCreateSchema,
  PurchaseOrderListSchema,
  PurchaseOrderSchema,
  PurchaseOrderStatusSchema,
  ReceiveRequestSchema,
  SupplierListSchema,
  SupplierProductListSchema,
  SupplierPromotionListSchema,
} from '@velnes/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant } from '../../db/index.js';
import { can, permsFor } from '../auth/authz.service.js';
import { localIso } from '../scheduling/scheduling.service.js';
import {
  createOrder,
  poTransition,
  receiveOrder,
  SupplierError,
  toOrderContract,
} from './suppliers.service.js';

const Err = z.object({ error: z.string(), message: z.string() });
const statusFor = { NOT_FOUND: 404, INVALID: 422, WRONG_STATE: 409, MIN_ORDER: 422 } as const;

function sendErr(reply: FastifyReply, e: unknown) {
  if (e instanceof SupplierError)
    return reply.code(statusFor[e.code]).send({ error: e.code, message: e.message });
  throw e;
}

export function suppliersRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  const gate = async (
    trx: Parameters<typeof permsFor>[0],
    claims: Parameters<typeof permsFor>[1],
    reply: FastifyReply,
  ) => {
    const perms = await permsFor(trx, claims);
    if (!can(perms, 'suppliers.manage')) {
      await reply
        .code(403)
        .send({ error: 'FORBIDDEN', message: 'Missing permission: suppliers.manage' });
      return false;
    }
    return true;
  };

  r.route({
    method: 'GET',
    url: '/suppliers',
    preHandler: [app.authenticate],
    schema: { response: { 200: SupplierListSchema } },
    handler: async (req) =>
      withTenant(req.claims.ten, async (trx) => {
        const rows = await trx.selectFrom('suppliers').selectAll().orderBy('name').execute();
        const conns = await trx.selectFrom('supplierConnections').selectAll().execute();
        const counts = await trx
          .selectFrom('supplierProducts')
          .select(['supplierId'])
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .groupBy('supplierId')
          .execute();
        return {
          suppliers: rows.map((s) => {
            const c = conns.find((x) => x.supplierId === s.id);
            return {
              id: s.id,
              name: s.name,
              type: s.type,
              territory: s.territory,
              verified: s.verified,
              minOrder: s.minOrder,
              lead: s.lead,
              terms: s.terms,
              contact: s.contact,
              manager: s.manager,
              rating: s.rating == null ? null : Number(s.rating),
              products: Number(counts.find((x) => x.supplierId === s.id)?.n ?? 0),
              status: (c?.status === 'connected'
                ? 'connected'
                : c?.status === 'pending'
                  ? 'pending'
                  : 'available') as 'available' | 'pending' | 'connected',
              customerNo: c?.customerNo ?? '',
              connected: c?.connected ? localIso(c.connected) : null,
              share: (c?.share ?? {}) as Record<string, boolean>,
              locationIds: c?.locationIds ?? [],
            };
          }),
        };
      }),
  });

  r.route({
    method: 'POST',
    url: '/suppliers/:id/connect',
    preHandler: [app.authenticate],
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({ note: z.string().default(''), locationIds: z.array(z.uuid()).default([]) }),
      response: { 200: z.object({ ok: z.literal(true) }), 403: Err, 404: Err, 409: Err },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await gate(trx, req.claims, reply))) return reply;
        const sup = await trx
          .selectFrom('suppliers')
          .select('id')
          .where('id', '=', req.params.id)
          .executeTakeFirst();
        if (!sup) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown supplier' });
        const existing = await trx
          .selectFrom('supplierConnections')
          .select('status')
          .where('supplierId', '=', req.params.id)
          .executeTakeFirst();
        if (existing)
          return reply
            .code(409)
            .send({ error: 'WRONG_STATE', message: `Already ${existing.status}` });
        await trx
          .insertInto('supplierConnections')
          .values({
            tenantId: req.claims.ten,
            supplierId: req.params.id,
            status: 'pending',
            note: req.body.note,
            locationIds: req.body.locationIds,
          })
          .execute();
        return { ok: true as const };
      }),
  });

  r.route({
    method: 'GET',
    url: '/suppliers/:id/catalog',
    preHandler: [app.authenticate],
    schema: {
      params: z.object({ id: z.uuid() }),
      response: { 200: SupplierProductListSchema },
    },
    handler: async (req) =>
      withTenant(req.claims.ten, async (trx) => {
        const rows = await trx
          .selectFrom('supplierProducts')
          .selectAll()
          .where('supplierId', '=', req.params.id)
          .where('active', '=', true)
          .orderBy('category')
          .orderBy('name')
          .execute();
        const links = await trx
          .selectFrom('products')
          .select(['id', 'supplierProductId'])
          .where('supplierProductId', 'is not', null)
          .execute();
        return {
          products: rows.map((p) => ({
            id: p.id,
            supplierId: p.supplierId,
            brand: p.brand,
            name: p.name,
            sku: p.sku,
            ean: p.ean,
            size: p.size,
            pack: p.pack,
            buy: p.buy,
            rrp: p.rrp,
            vat: p.vat,
            moq: p.moq,
            stock: p.stock,
            lead: p.lead,
            use: p.use,
            category: p.category,
            descr: p.descr,
            sample: p.sample,
            linkedProductId: links.find((l) => l.supplierProductId === p.id)?.id ?? null,
          })),
        };
      }),
  });

  r.route({
    method: 'GET',
    url: '/purchase-orders',
    preHandler: [app.authenticate],
    schema: { response: { 200: PurchaseOrderListSchema } },
    handler: async (req) =>
      withTenant(req.claims.ten, async (trx) => {
        const rows = await trx
          .selectFrom('purchaseOrders')
          .select('id')
          .orderBy('createdAt', 'desc')
          .limit(100)
          .execute();
        const orders = [];
        for (const row of rows) orders.push(await toOrderContract(trx, row.id));
        return { orders };
      }),
  });

  r.route({
    method: 'POST',
    url: '/purchase-orders',
    preHandler: [app.authenticate],
    schema: {
      body: OrderCreateSchema,
      response: { 200: PurchaseOrderSchema, 403: Err, 404: Err, 409: Err, 422: Err },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await gate(trx, req.claims, reply))) return reply;
        try {
          return await createOrder(trx, req.claims, req.body);
        } catch (e) {
          return sendErr(reply, e);
        }
      }),
  });

  r.route({
    method: 'POST',
    url: '/purchase-orders/:id/transitions',
    preHandler: [app.authenticate],
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({ to: PurchaseOrderStatusSchema }),
      response: { 200: PurchaseOrderSchema, 403: Err, 404: Err, 409: Err },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await gate(trx, req.claims, reply))) return reply;
        const actor = await trx
          .selectFrom('employees')
          .select('name')
          .where('id', '=', req.claims.sub)
          .executeTakeFirst();
        try {
          return await poTransition(
            trx,
            'salon',
            { id: req.claims.sub, name: actor?.name ?? '' },
            req.params.id,
            req.body.to,
          );
        } catch (e) {
          return sendErr(reply, e);
        }
      }),
  });

  r.route({
    method: 'POST',
    url: '/purchase-orders/:id/receive',
    preHandler: [app.authenticate],
    schema: {
      params: z.object({ id: z.uuid() }),
      body: ReceiveRequestSchema,
      response: { 200: PurchaseOrderSchema, 403: Err, 404: Err, 409: Err },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await gate(trx, req.claims, reply))) return reply;
        try {
          return await receiveOrder(trx, req.claims, req.params.id, req.body.lines);
        } catch (e) {
          return sendErr(reply, e);
        }
      }),
  });

  r.route({
    method: 'GET',
    url: '/supplier-promotions',
    preHandler: [app.authenticate],
    schema: { response: { 200: SupplierPromotionListSchema } },
    handler: async (req) =>
      withTenant(req.claims.ten, async (trx) => {
        const rows = await trx
          .selectFrom('supplierPromotions as p')
          .innerJoin('suppliers as s', 's.id', 'p.supplierId')
          .selectAll('p')
          .select('s.name as supplierName')
          .where('p.active', '=', true)
          .orderBy('p.starts', 'desc')
          .execute();
        return {
          promotions: rows.map((p) => ({
            id: p.id,
            supplierId: p.supplierId,
            supplierName: p.supplierName,
            brand: p.brand,
            title: p.title,
            kind: p.kind,
            productIds: p.productIds,
            starts: localIso(p.starts),
            ends: localIso(p.ends),
            minOrder: p.minOrder,
            usageLimit: p.usageLimit,
            terms: p.terms,
            audience: p.audience,
            value: p.value,
            per: p.per,
          })),
        };
      }),
  });
}
