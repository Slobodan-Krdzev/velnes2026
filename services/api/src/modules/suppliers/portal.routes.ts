import {
  PortalDashboardSchema,
  SupplierPromotionListSchema,
  PortalSalonListSchema,
  PurchaseOrderListSchema,
  PurchaseOrderSchema,
  SupplierLoginResponseSchema,
  SupplierProductListSchema,
} from '@velnes/contracts';
import argon2 from 'argon2';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { z } from 'zod';
import { db, withSupplier } from '../../db/index.js';
import { AuthError } from '../auth/auth.service.js';
import { localIso } from '../scheduling/scheduling.service.js';
import { poTransition, SupplierError, toOrderContract } from './suppliers.service.js';

const Err = z.object({ error: z.string(), message: z.string() });

function sendErr(reply: FastifyReply, e: unknown) {
  if (e instanceof SupplierError)
    return reply
      .code(e.code === 'NOT_FOUND' ? 404 : 409)
      .send({ error: e.code, message: e.message });
  throw e;
}

/** The supplier's side of the platform. Their token opens only these
 *  doors; their reads run under app.supplier_id — RLS keeps them on
 *  their own orders and connections. */
export function portalRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'POST',
    url: '/portal/auth/login',
    config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
    schema: {
      body: z.object({ email: z.email(), password: z.string().min(1) }),
      response: { 200: SupplierLoginResponseSchema, 401: Err },
    },
    handler: async (req, reply) => {
      const row = await db.transaction().execute(async (trx) => {
        await sql`select set_config('app.auth', 'login', true)`.execute(trx);
        return trx
          .selectFrom('supplierUsers as u')
          .innerJoin('suppliers as s', 's.id', 'u.supplierId')
          .selectAll('u')
          .select('s.name as supplierName')
          .where(sql<boolean>`lower(u.email) = lower(${req.body.email})`)
          .executeTakeFirst();
      });
      const hash =
        row?.passwordHash ??
        '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      const ok = await argon2.verify(hash, req.body.password).catch(() => false);
      if (!row || !ok || row.status !== 'active') {
        void reply.code(401).send({ error: 'INVALID_CREDENTIALS', message: 'Sign-in refused' });
        return reply;
      }
      const accessToken = await reply.jwtSign(
        { sup: row.supplierId, sub: row.id, name: row.name, rol: row.role },
        { expiresIn: '8h' },
      );
      return {
        accessToken,
        user: {
          id: row.id,
          name: row.name,
          email: row.email,
          role: row.role,
          supplierId: row.supplierId,
          supplierName: row.supplierName,
        },
      };
    },
  });

  r.route({
    method: 'GET',
    url: '/portal/dashboard',
    preHandler: [app.authenticateSupplier],
    schema: { response: { 200: PortalDashboardSchema } },
    handler: async (req) =>
      withSupplier(req.supplierClaims.sup, async (trx) => {
        const conns = await trx.selectFrom('supplierConnections').selectAll().execute();
        const orders = await trx
          .selectFrom('purchaseOrders')
          .select('status')
          .execute();
        const products = await trx
          .selectFrom('supplierProducts')
          .select(sql<string>`count(*)`.as('n'))
          .where('supplierId', '=', req.supplierClaims.sup)
          .executeTakeFirst();
        return {
          salons: conns.filter((c) => c.status === 'connected').length,
          openOrders: orders.filter(
            (o) => !['delivered', 'cancelled', 'disputed'].includes(o.status),
          ).length,
          products: Number(products?.n ?? 0),
          pendingConnections: conns.filter((c) => c.status === 'pending').length,
        };
      }),
  });

  r.route({
    method: 'GET',
    url: '/portal/salons',
    preHandler: [app.authenticateSupplier],
    schema: { response: { 200: PortalSalonListSchema } },
    handler: async (req) =>
      withSupplier(req.supplierClaims.sup, async (trx) => {
        const conns = await trx.selectFrom('supplierConnections').selectAll().execute();
        const bizs = await trx.selectFrom('businesses').select(['id', 'name']).execute();
        const orders = await trx
          .selectFrom('purchaseOrders as o')
          .leftJoin('purchaseOrderLines as l', 'l.orderId', 'o.id')
          .select(['o.tenantId', 'o.status'])
          .select(sql<string>`COALESCE(SUM(l.qty * l.price),0)`.as('value'))
          .groupBy(['o.id', 'o.tenantId', 'o.status'])
          .execute();
        return {
          salons: conns.map((c) => {
            const mine = orders.filter((o) => o.tenantId === c.tenantId);
            return {
              businessId: c.tenantId,
              name: bizs.find((b) => b.id === c.tenantId)?.name ?? '—',
              customerNo: c.customerNo,
              status: c.status,
              connected: c.connected ? localIso(c.connected) : null,
              orders: mine.length,
              value: mine.reduce((n, o) => n + Number(o.value), 0),
              openOrders: mine.filter(
                (o) => !['delivered', 'cancelled', 'disputed'].includes(o.status),
              ).length,
              note: c.note,
            };
          }),
        };
      }),
  });

  r.route({
    method: 'POST',
    url: '/portal/connections/:businessId/:action',
    preHandler: [app.authenticateSupplier],
    schema: {
      params: z.object({ businessId: z.uuid(), action: z.enum(['accept', 'decline']) }),
      body: z.object({ customerNo: z.string().default('') }),
      response: { 200: z.object({ ok: z.literal(true) }), 404: Err, 409: Err },
    },
    handler: async (req, reply) =>
      withSupplier(req.supplierClaims.sup, async (trx) => {
        const conn = await trx
          .selectFrom('supplierConnections')
          .selectAll()
          .where('tenantId', '=', req.params.businessId)
          .where('supplierId', '=', req.supplierClaims.sup)
          .executeTakeFirst();
        if (!conn)
          return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown connection request' });
        if (conn.status !== 'pending')
          return reply.code(409).send({ error: 'WRONG_STATE', message: `Already ${conn.status}` });
        await trx
          .updateTable('supplierConnections')
          .set(
            req.params.action === 'accept'
              ? {
                  status: 'connected',
                  connected: new Date(),
                  customerNo:
                    req.body.customerNo ||
                    `MK-${5100 + Math.floor(Math.random() * 900)}`,
                }
              : { status: 'declined' },
          )
          .where('tenantId', '=', req.params.businessId)
          .where('supplierId', '=', req.supplierClaims.sup)
          .execute();
        return { ok: true as const };
      }),
  });

  r.route({
    method: 'GET',
    url: '/portal/orders',
    preHandler: [app.authenticateSupplier],
    schema: { response: { 200: PurchaseOrderListSchema } },
    handler: async (req) =>
      withSupplier(req.supplierClaims.sup, async (trx) => {
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
    url: '/portal/orders/:id/transitions',
    preHandler: [app.authenticateSupplier],
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({
        to: z.enum(['accepted', 'partial', 'processing', 'shipped', 'cancelled']),
        track: z.string().optional(),
      }),
      response: { 200: PurchaseOrderSchema, 404: Err, 409: Err },
    },
    handler: async (req, reply) =>
      withSupplier(req.supplierClaims.sup, async (trx) => {
        try {
          return await poTransition(
            trx,
            'supplier',
            { id: null, name: req.supplierClaims.name },
            req.params.id,
            req.body.to,
            { ...(req.body.track !== undefined ? { track: req.body.track } : {}) },
          );
        } catch (e) {
          return sendErr(reply, e);
        }
      }),
  });

  r.route({
    method: 'GET',
    url: '/portal/catalog',
    preHandler: [app.authenticateSupplier],
    schema: { response: { 200: SupplierProductListSchema } },
    handler: async (req) =>
      withSupplier(req.supplierClaims.sup, async (trx) => {
        const rows = await trx
          .selectFrom('supplierProducts')
          .selectAll()
          .where('supplierId', '=', req.supplierClaims.sup)
          .orderBy('category')
          .orderBy('name')
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
            active: p.active,
            linkedProductId: null, // the salon's linkage is theirs
          })),
        };
      }),
  });

  r.route({
    method: 'GET',
    url: '/portal/promotions',
    preHandler: [app.authenticateSupplier],
    schema: { response: { 200: SupplierPromotionListSchema } },
    handler: async (req) =>
      withSupplier(req.supplierClaims.sup, async (trx) => {
        const rows = await trx
          .selectFrom('supplierPromotions as p')
          .innerJoin('suppliers as s', 's.id', 'p.supplierId')
          .selectAll('p')
          .select('s.name as supplierName')
          .where('p.supplierId', '=', req.supplierClaims.sup)
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

  r.route({
    method: 'PATCH',
    url: '/portal/catalog/:id',
    preHandler: [app.authenticateSupplier],
    schema: {
      params: z.object({ id: z.uuid() }),
      body: z.object({
        buy: z.number().int().min(0).optional(),
        rrp: z.number().int().min(0).optional(),
        stock: z.number().int().min(0).optional(),
        active: z.boolean().optional(),
      }),
      response: { 200: z.object({ ok: z.literal(true) }), 404: Err },
    },
    handler: async (req, reply) =>
      withSupplier(req.supplierClaims.sup, async (trx) => {
        const p = await trx
          .selectFrom('supplierProducts')
          .select('id')
          .where('id', '=', req.params.id)
          .where('supplierId', '=', req.supplierClaims.sup)
          .executeTakeFirst();
        if (!p) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown product' });
        const b = req.body;
        await trx
          .updateTable('supplierProducts')
          .set({
            ...(b.buy !== undefined ? { buy: b.buy } : {}),
            ...(b.rrp !== undefined ? { rrp: b.rrp } : {}),
            ...(b.stock !== undefined ? { stock: b.stock } : {}),
            ...(b.active !== undefined ? { active: b.active } : {}),
          })
          .where('id', '=', req.params.id)
          .execute();
        return { ok: true as const };
      }),
  });
}
export { AuthError };
