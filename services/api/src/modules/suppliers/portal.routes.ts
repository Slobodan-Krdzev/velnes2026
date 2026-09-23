import { env } from '../../env.js';
import {
  PO_PERM_GROUPS,
  PortalCompanySchema,
  PortalCompanyPatchSchema,
  PortalDashboardSchema,
  PortalBulkPriceSchema,
  PortalNotificationListSchema,
  PortalProductCreateSchema,
  PortalProductPatchSchema,
  PortalPromotionCreateSchema,
  PortalReportsSchema,
  PortalRoleCreateSchema,
  PortalRoleListSchema,
  PortalRolePatchSchema,
  PortalTeamInviteSchema,
  PortalTeamListSchema,
  PortalTeamPatchSchema,
  SupplierPromotionListSchema,
  PortalSalonListSchema,
  PurchaseOrderListSchema,
  PurchaseOrderSchema,
  type PurchaseOrderStatus,
  SupplierLoginResponseSchema,
  SupplierProductListSchema,
  SupportTicketCreateSchema,
  SupportTicketListSchema,
  SupportTicketReplySchema,
} from '@velnes/contracts';
import argon2 from 'argon2';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { z } from 'zod';
import { db, withSupplier, type Trx } from '../../db/index.js';
import { AuthError } from '../auth/auth.service.js';
import { localIso } from '../scheduling/scheduling.service.js';
import { poTransition, SupplierError, toOrderContract } from './suppliers.service.js';
import { queueMail } from '../mail/mail.service.js';
import { createTicket, listTickets, replyToTicket, SupportError } from '../support/support.service.js';

const Err = z.object({ error: z.string(), message: z.string() });

function sendErr(reply: FastifyReply, e: unknown) {
  if (e instanceof SupplierError)
    return reply
      .code(e.code === 'NOT_FOUND' ? 404 : e.code === 'INVALID' ? 422 : 409)
      .send({ error: e.code, message: e.message });
  if (e instanceof SupportError)
    return reply
      .code(e.code === 'NOT_FOUND' ? 404 : 422)
      .send({ error: e.code, message: e.message });
  throw e;
}

/** The live permission scope for a portal role, read from the
 *  supplier_roles kit (the prototype's seedPortalRolePerms matrix). */
async function roleScope(trx: Trx, role: string, perm: string): Promise<'none' | 'own' | 'all'> {
  const r = await trx.selectFrom('supplierRoles').select('perms').where('id', '=', role).executeTakeFirst();
  const perms = (r?.perms ?? {}) as Record<string, string>;
  return (perms[perm] ?? 'none') as 'none' | 'own' | 'all';
}
async function portalCan(trx: Trx, reply: FastifyReply, role: string, perm: string): Promise<boolean> {
  if ((await roleScope(trx, role, perm)) !== 'none') return true;
  void reply.code(403).send({ error: 'FORBIDDEN', message: 'Your portal role cannot do that' });
  return false;
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
        const sup = req.supplierClaims.sup;
        const [supplier, conns, bizs, prods, promos] = await Promise.all([
          trx.selectFrom('suppliers').select(['name', 'type']).where('id', '=', sup).executeTakeFirst(),
          trx.selectFrom('supplierConnections').selectAll().execute(),
          trx.selectFrom('businesses').select(['id', 'name', 'city']).execute(),
          trx
            .selectFrom('supplierProducts')
            .select(['id', 'name', 'stock', 'sample'])
            .where('supplierId', '=', sup)
            .execute(),
          trx.selectFrom('supplierPromotions').selectAll().where('supplierId', '=', sup).execute(),
        ]);
        const brands = await trx
          .selectFrom('supplierBrands as sb')
          .innerJoin('brands as b', 'b.id', 'sb.brandId')
          .select('b.name as name')
          .where('sb.supplierId', '=', sup)
          .execute();

        // Orders in scope, with per-order value and 30-day window.
        const since30 = new Date(Date.now() - 30 * 24 * 3600 * 1000);
        const orders = await trx
          .selectFrom('purchaseOrders as o')
          .leftJoin('purchaseOrderLines as l', 'l.orderId', 'o.id')
          .leftJoin('businesses as b2', 'b2.id', 'o.tenantId')
          .select(['o.id', 'o.ref', 'o.tenantId', 'o.status', 'o.createdAt', 'b2.name as salonName'])
          .select(sql<string>`COALESCE(SUM(l.qty * l.price),0)`.as('value'))
          .groupBy(['o.id', 'o.ref', 'o.tenantId', 'o.status', 'o.createdAt', 'b2.name'])
          .execute();
        const recentOrders = [...orders]
          .sort((a, b3) => new Date(b3.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 5)
          .map((o) => ({
            id: o.id,
            ref: o.ref,
            salonName: o.salonName ?? null,
            createdAt: new Date(o.createdAt).toISOString(),
            total: Number(o.value),
            status: o.status as PurchaseOrderStatus,
          }));
        const openStatuses = (s: string) => !['delivered', 'cancelled', 'disputed'].includes(s);
        const orderValue30 = orders
          .filter((o) => new Date(o.createdAt) >= since30)
          .reduce((n, o) => n + Number(o.value), 0);

        // Repeat rate: accounts that ordered more than once, over
        // accounts that ordered at all. Honest null when nobody has.
        const perAccount = new Map<string, number>();
        for (const o of orders) perAccount.set(o.tenantId, (perAccount.get(o.tenantId) ?? 0) + 1);
        const ordered = perAccount.size;
        const repeatRate = ordered
          ? Math.round(([...perAccount.values()].filter((n) => n >= 2).length / ordered) * 100)
          : null;

        // Best selling: the supplier's own products, ranked by
        // qty × price across all their order lines.
        const lineAgg = await trx
          .selectFrom('purchaseOrderLines as l')
          .innerJoin('supplierProducts as sp', 'sp.id', 'l.supplierProductId')
          .select('sp.name as name')
          .select(sql<string>`SUM(l.qty * l.price)`.as('value'))
          .where('sp.supplierId', '=', sup)
          .groupBy('sp.name')
          .orderBy('value', 'desc')
          .limit(4)
          .execute();
        const bestSelling = lineAgg.map((r) => ({ name: r.name, value: Number(r.value) }));

        // Payments: the supplier's own legal entity + account, read-only.
        const le = await trx
          .selectFrom('legalEntities')
          .select(['id', 'name'])
          .where('ownerType', '=', 'supplier')
          .where('ownerId', '=', sup)
          .where('isDefault', '=', true)
          .executeTakeFirst();
        const acc = le
          ? await trx
              .selectFrom('paymentAccounts')
              .select(['provider', 'merchantId', 'settlementRef', 'status'])
              .where('legalEntityId', '=', le.id)
              .executeTakeFirst()
          : undefined;
        const payStatus = (acc?.status ?? 'none') as 'active' | 'pending' | 'incomplete' | 'none';

        // Honest attention signals — derived, never hard-coded.
        const attention: {
          icon: 'products' | 'invoice' | 'tag';
          title: string;
          detail: string;
          tab: 'catalog' | 'orders' | 'promotions';
        }[] = [];
        const oos = prods.filter((p) => p.stock === 0 && !p.sample);
        if (oos.length)
          attention.push({
            icon: 'products',
            title:
              oos.length === 1
                ? `${oos[0]!.name} is out of stock`
                : `${oos.length} products are out of stock`,
            detail: 'Connected salons carry these — update your stock',
            tab: 'catalog',
          });
        const disputed = orders.filter((o) => o.status === 'disputed');
        if (disputed.length)
          attention.push({
            icon: 'invoice',
            title:
              disputed.length === 1
                ? 'An order is disputed'
                : `${disputed.length} orders are disputed`,
            detail: 'A salon reported damaged or missing units',
            tab: 'orders',
          });
        const soon = promos.filter((p) => {
          const days = (new Date(p.ends).getTime() - Date.now()) / (24 * 3600 * 1000);
          return p.active && days > 0 && days <= 21;
        });
        if (soon.length)
          attention.push({
            icon: 'tag',
            title:
              soon.length === 1
                ? `“${soon[0]!.title}” ends soon`
                : `${soon.length} promotions end soon`,
            detail: 'Review uptake before it closes',
            tab: 'promotions',
          });

        const shareLabel = (share: Record<string, unknown>) => {
          const on: string[] = [];
          if (share.orders) on.push('orders');
          if (share.stock) on.push('stock');
          if (share.sales) on.push('sales');
          if (share.training) on.push('training registrations');
          if (!on.length) return 'nothing yet';
          if (on.length === 1) return on[0]!;
          return `${on.slice(0, -1).join(', ')} and ${on.at(-1)}`;
        };

        return {
          supplierName: supplier?.name ?? req.supplierClaims.name,
          supplierType: supplier?.type ?? 'Supplier',
          brands: brands.map((b) => b.name),
          salons: conns.filter((c) => c.status === 'connected').length,
          openOrders: orders.filter((o) => openStatuses(o.status)).length,
          orderValue30,
          repeatRate,
          trainingSeats: null, // the trainings engine is not built yet
          products: prods.length,
          pendingConnections: conns.filter((c) => c.status === 'pending').length,
          payments: {
            legalEntity: le?.name ?? null,
            merchantId: acc?.merchantId ?? null,
            provider: acc?.provider ?? null,
            settlement: acc?.settlementRef ?? null,
            status: payStatus,
          },
          bestSelling,
          recentOrders,
          requests: conns
            .filter((c) => c.status === 'pending')
            .map((c) => ({
              businessId: c.tenantId,
              name: bizs.find((b) => b.id === c.tenantId)?.name ?? '—',
              city: bizs.find((b) => b.id === c.tenantId)?.city ?? null,
              locations: c.locationIds.length,
              note: c.note,
              shares: shareLabel(c.share as Record<string, unknown>),
            })),
          attention,
        };
      }),
  });

  r.route({
    method: 'GET',
    url: '/portal/notifications',
    preHandler: [app.authenticateSupplier],
    schema: { response: { 200: PortalNotificationListSchema } },
    handler: async (req) =>
      withSupplier(req.supplierClaims.sup, async (trx) => {
        const rows = await trx
          .selectFrom('supplierNotifications')
          .selectAll()
          .where('supplierId', '=', req.supplierClaims.sup)
          .orderBy('createdAt', 'desc')
          .limit(30)
          .execute();
        return {
          notifications: rows.map((n) => ({
            id: n.id,
            kind: n.kind,
            title: n.title,
            body: n.body,
            refId: n.refId,
            createdAt: n.createdAt.toISOString(),
          })),
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
        reason: z.string().optional(),
      }),
      response: { 200: PurchaseOrderSchema, 404: Err, 409: Err, 422: Err },
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
            {
              ...(req.body.track !== undefined ? { track: req.body.track } : {}),
              ...(req.body.reason !== undefined ? { reason: req.body.reason } : {}),
            },
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
      body: PortalProductPatchSchema,
      response: { 200: z.object({ ok: z.literal(true) }), 403: Err, 404: Err },
    },
    handler: async (req, reply) =>
      withSupplier(req.supplierClaims.sup, async (trx) => {
        if (!(await portalCan(trx, reply, req.supplierClaims.rol, 'po.catalog'))) return reply;
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
            ...(b.name !== undefined ? { name: b.name } : {}),
            ...(b.brand !== undefined ? { brand: b.brand } : {}),
            ...(b.category !== undefined ? { category: b.category } : {}),
            ...(b.sku !== undefined ? { sku: b.sku } : {}),
            ...(b.ean !== undefined ? { ean: b.ean } : {}),
            ...(b.size !== undefined ? { size: b.size } : {}),
            ...(b.pack !== undefined ? { pack: b.pack } : {}),
            ...(b.buy !== undefined ? { buy: b.buy } : {}),
            ...(b.rrp !== undefined ? { rrp: b.rrp } : {}),
            ...(b.moq !== undefined ? { moq: b.moq } : {}),
            ...(b.stock !== undefined ? { stock: b.stock } : {}),
            ...(b.use !== undefined ? { use: b.use } : {}),
            ...(b.descr !== undefined ? { descr: b.descr } : {}),
            ...(b.active !== undefined ? { active: b.active } : {}),
          })
          .where('id', '=', req.params.id)
          .execute();
        return { ok: true as const };
      }),
  });

  // Delete a product. Order history pins it (409 — deactivate
  // instead); a salon that carried it keeps its own row, losing only
  // the official link (FK ON DELETE SET NULL). Promotions drop it.
  r.route({
    method: 'DELETE',
    url: '/portal/catalog/:id',
    preHandler: [app.authenticateSupplier],
    schema: {
      params: z.object({ id: z.uuid() }),
      response: { 200: z.object({ ok: z.literal(true) }), 403: Err, 404: Err, 409: Err },
    },
    handler: async (req, reply) =>
      withSupplier(req.supplierClaims.sup, async (trx) => {
        if (!(await portalCan(trx, reply, req.supplierClaims.rol, 'po.catalog'))) return reply;
        const p = await trx
          .selectFrom('supplierProducts')
          .select('id')
          .where('id', '=', req.params.id)
          .where('supplierId', '=', req.supplierClaims.sup)
          .executeTakeFirst();
        if (!p) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown product' });
        const ordered = await trx
          .selectFrom('purchaseOrderLines')
          .select('id')
          .where('supplierProductId', '=', req.params.id)
          .limit(1)
          .executeTakeFirst();
        if (ordered)
          return reply.code(409).send({
            error: 'ON_ORDERS',
            message: 'This product is on orders — turn off its availability instead',
          });
        await sql`
          UPDATE supplier_promotions
          SET product_ids = array_remove(product_ids, ${req.params.id}::uuid)
          WHERE supplier_id = ${req.supplierClaims.sup}::uuid
        `.execute(trx);
        await trx.deleteFrom('supplierProducts').where('id', '=', req.params.id).execute();
        return { ok: true as const };
      }),
  });

  // Bulk price change across the whole catalog (± a percentage).
  r.route({
    method: 'POST',
    url: '/portal/catalog/bulk',
    preHandler: [app.authenticateSupplier],
    schema: {
      body: PortalBulkPriceSchema,
      response: { 200: z.object({ updated: z.number().int() }), 403: Err },
    },
    handler: async (req, reply) =>
      withSupplier(req.supplierClaims.sup, async (trx) => {
        if (!(await portalCan(trx, reply, req.supplierClaims.rol, 'po.catalog'))) return reply;
        const factor = 1 + req.body.percent / 100;
        const set: Record<string, unknown> = {};
        if (req.body.target === 'buy' || req.body.target === 'both')
          set.buy = sql`GREATEST(0, ROUND(buy * ${factor}::float))::int`;
        if (req.body.target === 'rrp' || req.body.target === 'both')
          set.rrp = sql`GREATEST(0, ROUND(rrp * ${factor}::float))::int`;
        const res = await trx
          .updateTable('supplierProducts')
          .set(set)
          .where('supplierId', '=', req.supplierClaims.sup)
          .executeTakeFirst();
        return { updated: Number(res.numUpdatedRows) };
      }),
  });

  // Add product — publishes to every connected salon (they compare
  // the official data and adopt it against their own).
  r.route({
    method: 'POST',
    url: '/portal/catalog',
    preHandler: [app.authenticateSupplier],
    schema: {
      body: PortalProductCreateSchema,
      response: { 200: z.object({ id: z.uuid() }), 403: Err },
    },
    handler: async (req, reply) =>
      withSupplier(req.supplierClaims.sup, async (trx) => {
        if (!(await portalCan(trx, reply, req.supplierClaims.rol, 'po.catalog'))) return reply;
        const b = req.body;
        const row = await trx
          .insertInto('supplierProducts')
          .values({
            supplierId: req.supplierClaims.sup,
            brand: b.brand,
            name: b.name,
            sku: b.sku,
            ean: b.ean,
            size: b.size,
            pack: b.pack,
            buy: b.buy,
            rrp: b.rrp,
            moq: b.moq,
            stock: b.stock,
            use: b.use,
            category: b.category,
            descr: b.descr,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        return { id: row.id };
      }),
  });

  // Add promotion — an offer salons see in their catalog, never a
  // change to their prices or till.
  r.route({
    method: 'POST',
    url: '/portal/promotions',
    preHandler: [app.authenticateSupplier],
    schema: {
      body: PortalPromotionCreateSchema,
      response: { 200: z.object({ id: z.uuid() }), 403: Err, 409: Err },
    },
    handler: async (req, reply) =>
      withSupplier(req.supplierClaims.sup, async (trx) => {
        if (!(await portalCan(trx, reply, req.supplierClaims.rol, 'po.promotions'))) return reply;
        const b = req.body;
        // Brand follows the first chosen product; the products must be
        // the supplier's own (RLS also enforces this on insert).
        const first = await trx
          .selectFrom('supplierProducts')
          .select('brand')
          .where('id', '=', b.productIds[0]!)
          .where('supplierId', '=', req.supplierClaims.sup)
          .executeTakeFirst();
        if (!first)
          return reply.code(409).send({ error: 'NO_PRODUCT', message: 'Pick your own products' });
        const row = await trx
          .insertInto('supplierPromotions')
          .values({
            supplierId: req.supplierClaims.sup,
            brand: first.brand,
            title: b.title,
            kind: b.kind,
            productIds: b.productIds,
            starts: b.starts,
            ends: b.ends,
            minOrder: b.minOrder,
            usageLimit: b.usageLimit,
            terms: b.terms,
            audience: b.audience,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        return { id: row.id };
      }),
  });

  // ── Settings: company, team and the role kit. ────────────────
  r.route({
    method: 'GET',
    url: '/portal/company',
    preHandler: [app.authenticateSupplier],
    schema: { response: { 200: PortalCompanySchema } },
    handler: async (req) =>
      withSupplier(req.supplierClaims.sup, async (trx) => {
        const s = await trx
          .selectFrom('suppliers')
          .select(['name', 'territory', 'minOrder', 'lead', 'terms', 'contact', 'avatar'])
          .where('id', '=', req.supplierClaims.sup)
          .executeTakeFirstOrThrow();
        return { name: s.name, territory: s.territory, minOrder: s.minOrder, lead: s.lead, terms: s.terms, contact: s.contact, avatar: s.avatar ?? null };
      }),
  });

  // The supplier's own avatar/logo — shown on the salon workspace's
  // suppliers screen. Company settings sit under po.terms.
  r.route({
    method: 'PATCH',
    url: '/portal/company',
    preHandler: [app.authenticateSupplier],
    schema: {
      body: PortalCompanyPatchSchema,
      response: { 200: z.object({ ok: z.literal(true) }), 403: z.object({ error: z.string(), message: z.string() }) },
    },
    handler: async (req, reply) =>
      withSupplier(req.supplierClaims.sup, async (trx) => {
        if (!(await portalCan(trx, reply, req.supplierClaims.rol, 'po.terms'))) return reply;
        await trx
          .updateTable('suppliers')
          .set({ avatar: req.body.avatar })
          .where('id', '=', req.supplierClaims.sup)
          .execute();
        return { ok: true as const };
      }),
  });

  r.route({
    method: 'GET',
    url: '/portal/team',
    preHandler: [app.authenticateSupplier],
    schema: { response: { 200: PortalTeamListSchema } },
    handler: async (req) =>
      withSupplier(req.supplierClaims.sup, async (trx) => {
        const rows = await trx
          .selectFrom('supplierUsers as u')
          .leftJoin('supplierRoles as r2', 'r2.id', 'u.role')
          .select(['u.id', 'u.name', 'u.email', 'u.role', 'u.status', 'r2.name as roleName'])
          .where('u.supplierId', '=', req.supplierClaims.sup)
          .orderBy('u.createdAt')
          .execute();
        return {
          members: rows.map((u) => ({
            id: u.id,
            name: u.name,
            email: u.email,
            role: u.role,
            roleName: u.roleName ?? u.role,
            status: u.status as 'active' | 'invited' | 'disabled',
          })),
        };
      }),
  });

  r.route({
    method: 'POST',
    url: '/portal/team',
    preHandler: [app.authenticateSupplier],
    schema: {
      body: PortalTeamInviteSchema,
      response: { 200: z.object({ id: z.uuid() }), 403: Err, 409: Err },
    },
    handler: async (req, reply) =>
      withSupplier(req.supplierClaims.sup, async (trx) => {
        if (!(await portalCan(trx, reply, req.supplierClaims.rol, 'po.users'))) return reply;
        const taken = await trx
          .selectFrom('supplierUsers')
          .select('id')
          .where(sql<boolean>`lower(email) = lower(${req.body.email})`)
          .executeTakeFirst();
        if (taken)
          return reply.code(409).send({ error: 'DUPLICATE', message: 'Someone already uses that address' });
        const roleRow = await trx.selectFrom('supplierRoles').select('id').where('id', '=', req.body.role).executeTakeFirst();
        if (!roleRow) return reply.code(409).send({ error: 'NO_ROLE', message: 'Pick an existing role' });
        const row = await trx
          .insertInto('supplierUsers')
          .values({
            supplierId: req.supplierClaims.sup,
            name: req.body.name,
            email: req.body.email,
            role: req.body.role,
            status: 'invited',
            passwordHash:
              '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await queueMail(trx, {
          to: req.body.email,
          subject: 'You are invited to the Velnes supplier portal',
          body: `${req.supplierClaims.name} invited you as ${req.body.role}. Two-factor is required at first sign-in.`,
          kind: 'supplier_invite',
          refId: row.id,
          cta: { label: 'Open the supplier portal', url: env.supplierAppUrl },
        });
        return { id: row.id };
      }),
  });

  r.route({
    method: 'PATCH',
    url: '/portal/team/:id',
    preHandler: [app.authenticateSupplier],
    schema: {
      params: z.object({ id: z.uuid() }),
      body: PortalTeamPatchSchema,
      response: { 200: z.object({ ok: z.literal(true) }), 403: Err, 404: Err, 409: Err },
    },
    handler: async (req, reply) =>
      withSupplier(req.supplierClaims.sup, async (trx) => {
        if (!(await portalCan(trx, reply, req.supplierClaims.rol, 'po.users'))) return reply;
        const u = await trx
          .selectFrom('supplierUsers')
          .select(['id', 'role'])
          .where('id', '=', req.params.id)
          .where('supplierId', '=', req.supplierClaims.sup)
          .executeTakeFirst();
        if (!u) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown user' });
        // The portal always keeps an owner.
        if (u.role === 'sr_owner' && req.body.role !== undefined && req.body.role !== 'sr_owner') {
          const owners = await trx
            .selectFrom('supplierUsers')
            .select(({ fn }) => fn.countAll<string>().as('n'))
            .where('role', '=', 'sr_owner')
            .where('supplierId', '=', req.supplierClaims.sup)
            .executeTakeFirstOrThrow();
          if (Number(owners.n) <= 1)
            return reply.code(409).send({ error: 'LAST_OWNER', message: 'The last owner keeps the keys' });
        }
        if (req.body.role !== undefined) {
          const roleRow = await trx.selectFrom('supplierRoles').select('id').where('id', '=', req.body.role).executeTakeFirst();
          if (!roleRow) return reply.code(409).send({ error: 'NO_ROLE', message: 'Pick an existing role' });
        }
        await trx
          .updateTable('supplierUsers')
          .set({
            ...(req.body.name !== undefined ? { name: req.body.name } : {}),
            ...(req.body.email !== undefined ? { email: req.body.email } : {}),
            ...(req.body.role !== undefined ? { role: req.body.role } : {}),
          })
          .where('id', '=', u.id)
          .execute();
        return { ok: true as const };
      }),
  });

  r.route({
    method: 'DELETE',
    url: '/portal/team/:id',
    preHandler: [app.authenticateSupplier],
    schema: {
      params: z.object({ id: z.uuid() }),
      response: { 200: z.object({ ok: z.literal(true) }), 403: Err, 404: Err, 409: Err },
    },
    handler: async (req, reply) =>
      withSupplier(req.supplierClaims.sup, async (trx) => {
        if (!(await portalCan(trx, reply, req.supplierClaims.rol, 'po.users'))) return reply;
        if (req.params.id === req.supplierClaims.sub)
          return reply.code(409).send({ error: 'SELF', message: 'You cannot remove yourself' });
        const u = await trx
          .selectFrom('supplierUsers')
          .select(['id', 'role'])
          .where('id', '=', req.params.id)
          .where('supplierId', '=', req.supplierClaims.sup)
          .executeTakeFirst();
        if (!u) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown user' });
        if (u.role === 'sr_owner') {
          const owners = await trx
            .selectFrom('supplierUsers')
            .select(({ fn }) => fn.countAll<string>().as('n'))
            .where('role', '=', 'sr_owner')
            .where('supplierId', '=', req.supplierClaims.sup)
            .executeTakeFirstOrThrow();
          if (Number(owners.n) <= 1)
            return reply.code(409).send({ error: 'LAST_OWNER', message: 'The last owner keeps the keys' });
        }
        await trx.deleteFrom('supplierUsers').where('id', '=', u.id).execute();
        return { ok: true as const };
      }),
  });

  r.route({
    method: 'GET',
    url: '/portal/roles',
    preHandler: [app.authenticateSupplier],
    schema: { response: { 200: PortalRoleListSchema } },
    handler: async (req) =>
      withSupplier(req.supplierClaims.sup, async (trx) => {
        const STD_ORDER = ['sr_owner', 'sr_account', 'sr_catalog', 'sr_order', 'sr_trainer', 'sr_finance', 'sr_analyst'];
        const roles = (await trx.selectFrom('supplierRoles').selectAll().execute()).sort((a, b2) => {
          const ia = STD_ORDER.indexOf(a.id);
          const ib = STD_ORDER.indexOf(b2.id);
          if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
          return a.name.localeCompare(b2.name);
        });
        const users = await trx
          .selectFrom('supplierUsers')
          .select(['name', 'email', 'role'])
          .where('supplierId', '=', req.supplierClaims.sup)
          .execute();
        return {
          roles: roles.map((r2) => ({
            id: r2.id,
            name: r2.name,
            scope: r2.scope,
            std: r2.std,
            locked: r2.locked,
            perms: (r2.perms ?? {}) as Record<string, 'none' | 'own' | 'all'>,
            users: users.filter((u) => u.role === r2.id).length,
            userNames: users.filter((u) => u.role === r2.id).map((u) => ({ name: u.name, email: u.email })),
          })),
        };
      }),
  });

  r.route({
    method: 'POST',
    url: '/portal/roles',
    preHandler: [app.authenticateSupplier],
    schema: {
      body: PortalRoleCreateSchema,
      response: { 200: z.object({ id: z.string() }), 403: Err, 409: Err },
    },
    handler: async (req, reply) =>
      withSupplier(req.supplierClaims.sup, async (trx) => {
        if (!(await portalCan(trx, reply, req.supplierClaims.rol, 'po.users'))) return reply;
        const base = await trx.selectFrom('supplierRoles').selectAll().where('id', '=', req.body.base).executeTakeFirst();
        if (!base) return reply.code(409).send({ error: 'NO_BASE', message: 'Start from an existing role' });
        const id = 'src_' + req.body.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40);
        const dupe = await trx.selectFrom('supplierRoles').select('id').where('id', '=', id).executeTakeFirst();
        if (dupe) return reply.code(409).send({ error: 'DUPLICATE', message: 'That role already exists' });
        await trx
          .insertInto('supplierRoles')
          .values({
            id,
            name: req.body.name,
            scope: req.body.scope || `Custom role, based on ${base.name}.`,
            std: false,
            locked: false,
            perms: JSON.stringify(base.perms ?? {}),
          })
          .execute();
        return { id };
      }),
  });

  r.route({
    method: 'PATCH',
    url: '/portal/roles/:id',
    preHandler: [app.authenticateSupplier],
    schema: {
      params: z.object({ id: z.string() }),
      body: PortalRolePatchSchema,
      response: { 200: z.object({ ok: z.literal(true) }), 403: Err, 404: Err, 409: Err },
    },
    handler: async (req, reply) =>
      withSupplier(req.supplierClaims.sup, async (trx) => {
        if (!(await portalCan(trx, reply, req.supplierClaims.rol, 'po.users'))) return reply;
        const role = await trx.selectFrom('supplierRoles').selectAll().where('id', '=', req.params.id).executeTakeFirst();
        if (!role) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown role' });
        if (role.locked)
          return reply.code(409).send({ error: 'LOCKED', message: 'This role is fixed. Somebody has to keep the keys.' });
        if (req.body.perms) {
          const known = new Set(PO_PERM_GROUPS.flatMap(([, list]) => list.map(([k]) => k)));
          for (const k of Object.keys(req.body.perms))
            if (!known.has(k)) return reply.code(409).send({ error: 'NO_PERM', message: `Unknown permission ${k}` });
        }
        const perms = { ...((role.perms ?? {}) as Record<string, string>), ...(req.body.perms ?? {}) };
        await trx
          .updateTable('supplierRoles')
          .set({
            ...(req.body.name !== undefined ? { name: req.body.name } : {}),
            ...(req.body.scope !== undefined ? { scope: req.body.scope } : {}),
            ...(req.body.perms !== undefined ? { perms: JSON.stringify(perms) } : {}),
          })
          .where('id', '=', role.id)
          .execute();
        return { ok: true as const };
      }),
  });

  r.route({
    method: 'DELETE',
    url: '/portal/roles/:id',
    preHandler: [app.authenticateSupplier],
    schema: {
      params: z.object({ id: z.string() }),
      response: { 200: z.object({ ok: z.literal(true) }), 403: Err, 404: Err, 409: Err },
    },
    handler: async (req, reply) =>
      withSupplier(req.supplierClaims.sup, async (trx) => {
        if (!(await portalCan(trx, reply, req.supplierClaims.rol, 'po.users'))) return reply;
        const role = await trx.selectFrom('supplierRoles').select(['id', 'std', 'locked']).where('id', '=', req.params.id).executeTakeFirst();
        if (!role) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown role' });
        if (role.std || role.locked)
          return reply.code(409).send({ error: 'STANDARD', message: 'A standard role cannot be removed' });
        const holders = await trx
          .selectFrom('supplierUsers')
          .select(({ fn }) => fn.countAll<string>().as('n'))
          .where('role', '=', role.id)
          .where('supplierId', '=', req.supplierClaims.sup)
          .executeTakeFirstOrThrow();
        if (Number(holders.n))
          return reply.code(409).send({ error: 'IN_USE', message: 'People are still on this role — move them first' });
        await trx.deleteFrom('supplierRoles').where('id', '=', role.id).execute();
        return { ok: true as const };
      }),
  });

  // ── Reports: real where derivable. ───────────────────────────
  r.route({
    method: 'GET',
    url: '/portal/reports',
    preHandler: [app.authenticateSupplier],
    schema: { response: { 200: PortalReportsSchema } },
    handler: async (req) =>
      withSupplier(req.supplierClaims.sup, async (trx) => {
        const sup = req.supplierClaims.sup;
        const [orders, bizs, promos] = await Promise.all([
          trx
            .selectFrom('purchaseOrders as o')
            .leftJoin('purchaseOrderLines as l', 'l.orderId', 'o.id')
            .select(['o.id', 'o.tenantId'])
            .select(sql<string>`COALESCE(SUM(l.qty * l.price),0)`.as('value'))
            .groupBy(['o.id', 'o.tenantId'])
            .execute(),
          trx.selectFrom('businesses').select(['id', 'name']).execute(),
          trx.selectFrom('supplierPromotions').select(['title']).where('supplierId', '=', sup).orderBy('starts', 'desc').execute(),
        ]);
        const orderValue = orders.reduce((n, o) => n + Number(o.value), 0);
        const perAccount = new Map<string, { orders: number; value: number }>();
        for (const o of orders) {
          const cur = perAccount.get(o.tenantId) ?? { orders: 0, value: 0 };
          cur.orders += 1;
          cur.value += Number(o.value);
          perAccount.set(o.tenantId, cur);
        }
        const ordered = perAccount.size;
        const repeatRate = ordered
          ? Math.round(([...perAccount.values()].filter((a) => a.orders >= 2).length / ordered) * 100)
          : null;
        return {
          orderValue,
          orders: orders.length,
          averageOrder: orders.length ? Math.round(orderValue / orders.length) : 0,
          repeatRate,
          promotionUptake: null, // the promotion → order link isn't tracked yet
          bySalon: [...perAccount.entries()]
            .map(([tenantId, a]) => ({
              name: bizs.find((b) => b.id === tenantId)?.name ?? '—',
              orders: a.orders,
              value: a.value,
            }))
            .sort((x, y) => y.value - x.value),
          promotions: promos.map((p) => ({ title: p.title })),
        };
      }),
  });

  // ── Support: the supplier's own tickets to Revelapps HQ. ──────
  r.route({
    method: 'GET',
    url: '/portal/support/tickets',
    preHandler: [app.authenticateSupplier],
    schema: { response: { 200: SupportTicketListSchema } },
    handler: async (req) =>
      withSupplier(req.supplierClaims.sup, async (trx) => ({ tickets: await listTickets(trx) })),
  });

  r.route({
    method: 'POST',
    url: '/portal/support/tickets',
    preHandler: [app.authenticateSupplier],
    schema: { body: SupportTicketCreateSchema, response: { 200: z.object({ id: z.uuid() }), 422: Err } },
    handler: async (req, reply) => {
      try {
        return await withSupplier(req.supplierClaims.sup, async (trx) => {
          const me = await trx
            .selectFrom('supplierUsers')
            .select(['name', 'email'])
            .where('id', '=', req.supplierClaims.sub)
            .executeTakeFirst();
          const id = await createTicket(trx, {
            origin: 'supplier',
            tenantId: null,
            supplierId: req.supplierClaims.sup,
            originName: req.supplierClaims.name,
            createdBy: me?.name ?? 'Supplier',
            replyTo: me?.email ?? '',
            subject: req.body.subject,
            category: req.body.category,
            body: req.body.body,
          });
          return { id };
        });
      } catch (e) {
        return sendErr(reply, e);
      }
    },
  });

  r.route({
    method: 'POST',
    url: '/portal/support/tickets/:id/reply',
    preHandler: [app.authenticateSupplier],
    schema: {
      params: z.object({ id: z.uuid() }),
      body: SupportTicketReplySchema.pick({ body: true }),
      response: { 200: z.object({ ok: z.literal(true) }), 404: Err, 422: Err },
    },
    handler: async (req, reply) => {
      try {
        await withSupplier(req.supplierClaims.sup, async (trx) => {
          const me = await trx
            .selectFrom('supplierUsers')
            .select('name')
            .where('id', '=', req.supplierClaims.sub)
            .executeTakeFirst();
          await replyToTicket(trx, req.params.id, {
            authorKind: 'supplier',
            authorName: me?.name ?? 'Supplier',
            body: req.body.body,
          });
        });
        return { ok: true as const };
      } catch (e) {
        return sendErr(reply, e);
      }
    },
  });
}
export { AuthError };
