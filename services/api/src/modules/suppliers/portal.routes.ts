import { brandsFor, ensureBrand, productCategories, resolveCategory, UnknownCategoryError } from './brands.service.js';
import { notifyPromotion } from './suppliers.service.js';
import { invoicePdf } from './invoice-pdf.service.js';
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
  PortalBrandListSchema,
  PortalCategoryListSchema,
  PortalCategoryRequestCreateSchema,
  PortalCategoryRequestListSchema,
  PortalPromotionPatchSchema,
  promotionStatus,
  SupplierJoinPreviewSchema,
  SupplierJoinRequestSchema,
  SupplierMediaListSchema,
  SupplierMediaSchema,
  SupplierMediaUploadSchema,
  SUPPLIER_MEDIA_MAX_BYTES,
} from '@velnes/contracts';
import argon2 from 'argon2';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { z } from 'zod';
import { db, withSupplier, withTenant, type Trx } from '../../db/index.js';
import { AuthError } from '../auth/auth.service.js';
import { localIso } from '../scheduling/scheduling.service.js';
import { poTransition, SupplierError, toOrderContract,
  notifyConnectionDecided,
} from './suppliers.service.js';
import { queueMail } from '../mail/mail.service.js';
import { claimJoinLink, joinMailBody, mintJoinLink, peekJoinLink } from './join-links.service.js';
import { deleteMedia, listMedia, readMedia, uploadMedia } from './media.service.js';
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

  // ── Join links: the invite mail's one way in (2026-10-07). Pre-session,
  // the token is the credential; rate-limited like login.
  r.route({
    method: 'GET',
    url: '/portal/join/:token',
    config: { rateLimit: { max: 30, timeWindow: '15 minutes' } },
    schema: {
      params: z.object({ token: z.string().min(16).max(128) }),
      response: { 200: SupplierJoinPreviewSchema, 401: z.object({ error: z.string() }) },
    },
    handler: async (req, reply) => {
      try {
        return await peekJoinLink(req.params.token);
      } catch (e) {
        if (e instanceof AuthError) return reply.code(401).send({ error: e.code });
        throw e;
      }
    },
  });

  r.route({
    method: 'POST',
    url: '/portal/join/:token',
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    schema: {
      params: z.object({ token: z.string().min(16).max(128) }),
      body: SupplierJoinRequestSchema,
      response: { 200: SupplierLoginResponseSchema, 401: z.object({ error: z.string() }) },
    },
    handler: async (req, reply) => {
      try {
        const user = await claimJoinLink(req.params.token, req.body);
        const accessToken = await reply.jwtSign(
          { sup: user.supplierId, sub: user.id, name: user.name, rol: user.role },
          { expiresIn: '8h' },
        );
        return { accessToken, user };
      } catch (e) {
        if (e instanceof AuthError) return reply.code(401).send({ error: e.code });
        throw e;
      }
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
        // The salon hears the answer — its bell and mailbox are its
        // own rows, written under its tenant context inside this step.
        await sql`select set_config('app.tenant_id', ${req.params.businessId}, true)`.execute(trx);
        await notifyConnectionDecided(trx, req.params.businessId, req.supplierClaims.sup, req.params.action === 'accept');
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

  // The invoice as a PDF (Alex, 2026-10-06), from the supplier's side.
  // Numbering and the salon's rows need the order's tenant context,
  // set inside this step as `poTransition` does.
  r.route({
    method: 'GET',
    url: '/portal/orders/:id/invoice.pdf',
    preHandler: [app.authenticateSupplier],
    schema: { params: z.object({ id: z.uuid() }) },
    handler: async (req, reply) =>
      withSupplier(req.supplierClaims.sup, async (trx) => {
        const o = await trx.selectFrom('purchaseOrders').select(['id', 'tenantId']).where('id', '=', req.params.id).executeTakeFirst();
        if (!o) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown order' });
        await sql`select set_config('app.tenant_id', ${o.tenantId}, true)`.execute(trx);
        try {
          const { buffer, invoiceNo } = await invoicePdf(trx, o.id);
          return reply
            .header('content-type', 'application/pdf')
            .header('content-disposition', `inline; filename="${invoiceNo}.pdf"`)
            .send(buffer);
        } catch (e) {
          return sendErr(reply, e);
        }
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
            categoryId: p.categoryId,
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
            active: p.active,
            status: promotionStatus({ active: p.active, starts: localIso(p.starts), ends: localIso(p.ends) }, localIso(new Date())),
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
      response: { 200: z.object({ ok: z.literal(true) }), 403: Err, 404: Err, 422: Err },
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
        const brand = b.brand !== undefined ? (await ensureBrand(trx, req.supplierClaims.sup, b.brand)).name : undefined;
        let shelf: { id: string; name: string } | undefined;
        if (b.category !== undefined) {
          try {
            shelf = await resolveCategory(trx, b.category);
          } catch (e) {
            if (e instanceof UnknownCategoryError) return reply.code(422).send({ error: 'UNKNOWN_CATEGORY', message: e.message });
            throw e;
          }
        }
        await trx
          .updateTable('supplierProducts')
          .set({
            ...(b.name !== undefined ? { name: b.name } : {}),
            ...(brand !== undefined ? { brand } : {}),
            ...(shelf ? { category: shelf.name, categoryId: shelf.id } : {}),
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
      response: { 200: z.object({ id: z.uuid() }), 403: Err, 422: Err },
    },
    handler: async (req, reply) =>
      withSupplier(req.supplierClaims.sup, async (trx) => {
        if (!(await portalCan(trx, reply, req.supplierClaims.rol, 'po.catalog'))) return reply;
        const b = req.body;
        // A brand the platform does not know yet is born here, in the
        // supplier's name; a category must be one of Velnes' shelves.
        const brand = (await ensureBrand(trx, req.supplierClaims.sup, b.brand)).name;
        let shelf: { id: string; name: string };
        try {
          shelf = await resolveCategory(trx, b.category);
        } catch (e) {
          if (e instanceof UnknownCategoryError) return reply.code(422).send({ error: 'UNKNOWN_CATEGORY', message: e.message });
          throw e;
        }
        const row = await trx
          .insertInto('supplierProducts')
          .values({
            supplierId: req.supplierClaims.sup,
            brand,
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
            category: shelf.name,
            categoryId: shelf.id,
            descr: b.descr,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        return { id: row.id };
      }),
  });

  // Every brand on the platform, the supplier's own first — what the
  // product panel offers; a new name typed there becomes a brand on save.
  // Velnes' product shelves — the only categories a supplier product may stand on.
  r.route({
    method: 'GET',
    url: '/portal/categories',
    preHandler: [app.authenticateSupplier],
    schema: { response: { 200: PortalCategoryListSchema } },
    handler: async (req) => withSupplier(req.supplierClaims.sup, async (trx) => ({ categories: await productCategories(trx) })),
  });

  // Ask HQ for a shelf that is missing — the salons' lifecycle, from the
  // supplier's side: a pending request, HQ's bell rung, the answer rung
  // back on the supplier's bell when HQ decides.
  r.route({
    method: 'GET',
    url: '/portal/category-requests',
    preHandler: [app.authenticateSupplier],
    schema: { response: { 200: PortalCategoryRequestListSchema } },
    handler: async (req) =>
      withSupplier(req.supplierClaims.sup, async (trx) => {
        const rows = await trx.selectFrom('categoryRequests').selectAll().where('supplierId', '=', req.supplierClaims.sup).orderBy('createdAt', 'desc').limit(50).execute();
        return {
          requests: rows.map((r2) => ({
            id: r2.id,
            name: r2.name,
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
    url: '/portal/category-requests',
    preHandler: [app.authenticateSupplier],
    schema: { body: PortalCategoryRequestCreateSchema, response: { 200: z.object({ id: z.uuid() }), 403: Err, 409: Err } },
    handler: async (req, reply) =>
      withSupplier(req.supplierClaims.sup, async (trx) => {
        if (!(await portalCan(trx, reply, req.supplierClaims.rol, 'po.catalog'))) return reply;
        const name = req.body.name.replace(/\s+/g, ' ');
        const exists = await trx.selectFrom('productCategories').select('id').where(sql`lower(name)`, '=', name.toLowerCase()).executeTakeFirst();
        if (exists) return reply.code(409).send({ error: 'EXISTS', message: 'That category already exists — just pick it' });
        const pending = await trx
          .selectFrom('categoryRequests')
          .select('id')
          .where(sql`lower(name)`, '=', name.toLowerCase())
          .where('kind', '=', 'products')
          .where('status', '=', 'pending')
          .executeTakeFirst();
        if (pending) return reply.code(409).send({ error: 'PENDING', message: 'That request is already with Velnes HQ' });
        const row = await trx
          .insertInto('categoryRequests')
          .values({ supplierId: req.supplierClaims.sup, name, kind: 'products', note: req.body.note })
          .returning('id')
          .executeTakeFirstOrThrow();
        const sup = await trx.selectFrom('suppliers').select('name').where('id', '=', req.supplierClaims.sup).executeTakeFirst();
        await trx
          .insertInto('platformNotices')
          .values({ audience: 'hq', kind: 'category_request', title: `Category request: ${name}`, body: `${sup?.name ?? 'A supplier'} (supplier) asks for a new product category.`, refId: row.id })
          .execute();
        return { id: row.id };
      }),
  });

  r.route({
    method: 'GET',
    url: '/portal/brands',
    preHandler: [app.authenticateSupplier],
    schema: { response: { 200: PortalBrandListSchema } },
    handler: async (req) => withSupplier(req.supplierClaims.sup, async (trx) => ({ brands: await brandsFor(trx, req.supplierClaims.sup) })),
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
    handler: async (req, reply) => {
      const b = req.body;
      const made = await withSupplier(req.supplierClaims.sup, async (trx) => {
        if (!(await portalCan(trx, reply, req.supplierClaims.rol, 'po.promotions'))) return null;
        // Brand follows the first chosen product; the products must be
        // the supplier's own (RLS also enforces this on insert).
        const first = await trx
          .selectFrom('supplierProducts')
          .select('brand')
          .where('id', '=', b.productIds[0]!)
          .where('supplierId', '=', req.supplierClaims.sup)
          .executeTakeFirst();
        if (!first) {
          await reply.code(409).send({ error: 'NO_PRODUCT', message: 'Pick your own products' });
          return null;
        }
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
        const sup = await trx.selectFrom('suppliers').select('name').where('id', '=', req.supplierClaims.sup).executeTakeFirstOrThrow();
        const salons = await trx.selectFrom('supplierConnections').select('tenantId').where('supplierId', '=', req.supplierClaims.sup).where('status', '=', 'connected').execute();
        return { id: row.id, supplierName: sup.name, salons: salons.map((c) => c.tenantId) };
      });
      if (!made) return reply;
      // Every connected salon hears about the offer — bell and mail —
      // once the promotion is a fact, each in the salon's own context.
      for (const tenantId of made.salons)
        await withTenant(tenantId, (t) => notifyPromotion(t, tenantId, { id: made.id, title: b.title, starts: b.starts, ends: b.ends, supplierName: made.supplierName }));
      return { id: made.id };
    },
  });

  // Edit a promotion, pause it, resume it — the supplier's own, with the
  // promotions right. A paused promotion is kept and offered to nobody.
  r.route({
    method: 'PATCH',
    url: '/portal/promotions/:id',
    preHandler: [app.authenticateSupplier],
    schema: {
      params: z.object({ id: z.uuid() }),
      body: PortalPromotionPatchSchema,
      response: { 200: z.object({ ok: z.literal(true) }), 403: Err, 404: Err, 409: Err },
    },
    handler: async (req, reply) =>
      withSupplier(req.supplierClaims.sup, async (trx) => {
        if (!(await portalCan(trx, reply, req.supplierClaims.rol, 'po.promotions'))) return reply;
        const p = await trx.selectFrom('supplierPromotions').select(['id', 'starts', 'ends']).where('id', '=', req.params.id).where('supplierId', '=', req.supplierClaims.sup).executeTakeFirst();
        if (!p) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown promotion' });
        const b = req.body;
        const starts = b.starts ?? localIso(p.starts);
        const ends = b.ends ?? localIso(p.ends);
        if (ends < starts) return reply.code(409).send({ error: 'DATES', message: 'The promotion cannot end before it starts' });
        let brand: string | undefined;
        if (b.productIds) {
          const first = await trx.selectFrom('supplierProducts').select('brand').where('id', '=', b.productIds[0]!).where('supplierId', '=', req.supplierClaims.sup).executeTakeFirst();
          if (!first) return reply.code(409).send({ error: 'NO_PRODUCT', message: 'Pick your own products' });
          brand = first.brand;
        }
        await trx
          .updateTable('supplierPromotions')
          .set({
            ...(b.title !== undefined ? { title: b.title } : {}),
            ...(b.kind !== undefined ? { kind: b.kind } : {}),
            ...(b.productIds !== undefined ? { productIds: b.productIds } : {}),
            ...(brand !== undefined ? { brand } : {}),
            ...(b.starts !== undefined ? { starts: b.starts } : {}),
            ...(b.ends !== undefined ? { ends: b.ends } : {}),
            ...(b.minOrder !== undefined ? { minOrder: b.minOrder } : {}),
            ...(b.usageLimit !== undefined ? { usageLimit: b.usageLimit } : {}),
            ...(b.terms !== undefined ? { terms: b.terms } : {}),
            ...(b.audience !== undefined ? { audience: b.audience } : {}),
            ...(b.active !== undefined ? { active: b.active } : {}),
          })
          .where('id', '=', req.params.id)
          .execute();
        return { ok: true as const };
      }),
  });

  // Delete a promotion: an offer withdrawn. Nothing references a
  // promotion (orders carry their own prices), so the row simply goes.
  r.route({
    method: 'DELETE',
    url: '/portal/promotions/:id',
    preHandler: [app.authenticateSupplier],
    schema: { params: z.object({ id: z.uuid() }), response: { 200: z.object({ ok: z.literal(true) }), 403: Err, 404: Err } },
    handler: async (req, reply) =>
      withSupplier(req.supplierClaims.sup, async (trx) => {
        if (!(await portalCan(trx, reply, req.supplierClaims.rol, 'po.promotions'))) return reply;
        const gone = await trx.deleteFrom('supplierPromotions').where('id', '=', req.params.id).where('supplierId', '=', req.supplierClaims.sup).executeTakeFirst();
        if (Number(gone.numDeletedRows) === 0) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown promotion' });
        return { ok: true as const };
      }),
  });

  // ── Settings: company, team and the role kit. ────────────────
  // ── Media: printed catalogs as PDFs (2026-10-07). Catalog right to
  // add and remove; anyone in the portal may list and open.
  r.route({
    method: 'GET',
    url: '/portal/media',
    preHandler: [app.authenticateSupplier],
    schema: { response: { 200: SupplierMediaListSchema } },
    handler: async (req) => withSupplier(req.supplierClaims.sup, async (trx) => ({ files: await listMedia(trx, req.supplierClaims.sup) })),
  });

  r.route({
    method: 'POST',
    url: '/portal/media',
    preHandler: [app.authenticateSupplier],
    bodyLimit: Math.ceil((SUPPLIER_MEDIA_MAX_BYTES * 4) / 3) + 4096,
    schema: {
      body: SupplierMediaUploadSchema,
      response: { 200: SupplierMediaSchema, 403: Err, 422: Err },
    },
    handler: async (req, reply) =>
      withSupplier(req.supplierClaims.sup, async (trx) => {
        if (!(await portalCan(trx, reply, req.supplierClaims.rol, 'po.catalog'))) return reply;
        try {
          return await uploadMedia(trx, req.supplierClaims.sup, { id: req.supplierClaims.sub, name: req.supplierClaims.name }, req.body);
        } catch (e) {
          if (e instanceof SupplierError) return reply.code(422).send({ error: e.code, message: e.message });
          throw e;
        }
      }),
  });

  r.route({
    method: 'DELETE',
    url: '/portal/media/:id',
    preHandler: [app.authenticateSupplier],
    schema: { params: z.object({ id: z.uuid() }), response: { 200: z.object({ ok: z.literal(true) }), 403: Err, 404: Err } },
    handler: async (req, reply) =>
      withSupplier(req.supplierClaims.sup, async (trx) => {
        if (!(await portalCan(trx, reply, req.supplierClaims.rol, 'po.catalog'))) return reply;
        try {
          await deleteMedia(trx, req.supplierClaims.sup, req.params.id);
          return { ok: true as const };
        } catch (e) {
          if (e instanceof SupplierError) return reply.code(404).send({ error: e.code, message: e.message });
          throw e;
        }
      }),
  });

  r.route({
    method: 'GET',
    url: '/portal/media/:id/file',
    preHandler: [app.authenticateSupplier],
    schema: { params: z.object({ id: z.uuid() }) },
    handler: async (req, reply) => {
      const file = await withSupplier(req.supplierClaims.sup, (trx) => readMedia(trx, req.supplierClaims.sup, req.params.id));
      if (!file) return reply.code(404).send({ error: 'NOT_FOUND', message: 'No such file' });
      return reply
        .header('content-type', file.mime)
        .header('content-disposition', `inline; filename="${encodeURIComponent(file.name)}"`)
        .send(file.data);
    },
  });

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
        const link = await mintJoinLink(trx, req.supplierClaims.sup, row.id, req.supplierClaims.sub);
        await queueMail(trx, {
          to: req.body.email,
          subject: 'You are invited to the Velnes supplier portal',
          body: joinMailBody(`${req.supplierClaims.name} invited you to the Velnes supplier portal as ${req.body.role}.`),
          kind: 'supplier_invite',
          refId: row.id,
          cta: { label: 'Join the supplier portal', url: link.url },
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
