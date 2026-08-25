import { randomBytes } from 'node:crypto';
import {
  AdminWidgetSchema,
  IntegrationEventsResponseSchema,
  WidgetCreateSchema,
  WidgetListResponseSchema,
  WidgetPatchSchema,
} from '@velnes/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant, type Trx } from '../../db/index.js';
import { logAudit } from '../audit/audit.service.js';
import { can, permsFor } from '../auth/authz.service.js';

/**
 * The owner's side of online booking. Two permissions split it the way
 * the prototype does: `widget.manage` for the widget itself,
 * `integrations.manage` for keys and the event feed.
 */

const Err = z.object({ error: z.string(), message: z.string() });
const newKey = () => `pk_live_${randomBytes(18).toString('base64url')}`;

async function toAdmin(trx: Trx, w: {
  id: string;
  name: string;
  publishableKey: string;
  locationIds: string[];
  categories: string[];
  lang: string;
  theme: string;
  accent: string;
  radius: string;
  btnStyle: string;
  startStep: string;
  deposit: string;
  cancelPolicy: string;
  domains: string[];
  status: 'draft' | 'live';
}) {
  const count = await trx
    .selectFrom('appointments')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('widgetId', '=', w.id)
    .executeTakeFirst();
  return {
    id: w.id,
    name: w.name,
    publishableKey: w.publishableKey,
    locationIds: w.locationIds,
    categories: w.categories,
    lang: (['en', 'mk', 'sq'].includes(w.lang) ? w.lang : 'en') as 'en' | 'mk' | 'sq',
    theme: w.theme,
    accent: w.accent,
    radius: w.radius,
    btnStyle: w.btnStyle,
    startStep: w.startStep,
    deposit: w.deposit,
    cancelPolicy: w.cancelPolicy,
    domains: w.domains,
    status: w.status,
    bookings: Number(count?.n ?? 0),
  };
}

async function actorName(trx: Trx, id: string) {
  return (
    (await trx.selectFrom('employees').select('name').where('id', '=', id).executeTakeFirst())
      ?.name ?? ''
  );
}

export function widgetsRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // Two doors, as the prototype splits them: widget.manage covers the
  // widget itself; integrations.manage covers keys and the event feed.
  const guard = async (
    trx: Trx,
    claims: Parameters<typeof permsFor>[1],
    perm: 'widget.manage' | 'integrations.manage',
  ) => {
    const perms = await permsFor(trx, claims);
    return can(perms, perm);
  };

  r.route({
    method: 'GET',
    url: '/widgets',
    preHandler: [app.authenticate],
    schema: { response: { 200: WidgetListResponseSchema, 403: Err } },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await guard(trx, req.claims, 'widget.manage')))
          return reply
            .code(403)
            .send({ error: 'FORBIDDEN', message: 'Missing permission: widget.manage' });
        const rows = await trx.selectFrom('widgets').selectAll().orderBy('createdAt').execute();
        const biz = await trx.selectFrom('businesses').select('slug').executeTakeFirst();
        const widgets = [];
        for (const w of rows) widgets.push(await toAdmin(trx, w));
        return { widgets, slug: biz?.slug ?? null };
      }),
  });

  r.route({
    method: 'POST',
    url: '/widgets',
    preHandler: [app.authenticate],
    schema: {
      body: WidgetCreateSchema,
      response: { 200: AdminWidgetSchema, 403: Err },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await guard(trx, req.claims, 'widget.manage')))
          return reply
            .code(403)
            .send({ error: 'FORBIDDEN', message: 'Missing permission: widget.manage' });
        // A new widget starts as a draft with every live location on.
        const locs = await trx
          .selectFrom('locations')
          .select('id')
          .where('lifecycle', '=', 'ACTIVE')
          .execute();
        const row = await trx
          .insertInto('widgets')
          .values({
            tenantId: req.claims.ten,
            name: req.body.name,
            publishableKey: newKey(),
            locationIds: locs.map((l) => l.id),
            status: 'draft',
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await logAudit(trx, req.claims.ten, {
          actorEmployeeId: req.claims.sub,
          actorName: await actorName(trx, req.claims.sub),
          action: 'Widget created',
          object: `Widget · ${row.name}`,
        });
        return toAdmin(trx, row);
      }),
  });

  r.route({
    method: 'PATCH',
    url: '/widgets/:id',
    preHandler: [app.authenticate],
    schema: {
      params: z.object({ id: z.uuid() }),
      body: WidgetPatchSchema,
      response: { 200: AdminWidgetSchema, 403: Err, 404: Err },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await guard(trx, req.claims, 'widget.manage')))
          return reply
            .code(403)
            .send({ error: 'FORBIDDEN', message: 'Missing permission: widget.manage' });
        const before = await trx
          .selectFrom('widgets')
          .selectAll()
          .where('id', '=', req.params.id)
          .executeTakeFirst();
        if (!before)
          return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown widget' });
        const b = req.body;
        await trx
          .updateTable('widgets')
          .set({
            ...(b.name !== undefined ? { name: b.name } : {}),
            ...(b.locationIds !== undefined ? { locationIds: b.locationIds } : {}),
            ...(b.categories !== undefined ? { categories: b.categories } : {}),
            ...(b.lang !== undefined ? { lang: b.lang } : {}),
            ...(b.theme !== undefined ? { theme: b.theme } : {}),
            ...(b.accent !== undefined ? { accent: b.accent } : {}),
            ...(b.radius !== undefined ? { radius: b.radius } : {}),
            ...(b.btnStyle !== undefined ? { btnStyle: b.btnStyle } : {}),
            ...(b.startStep !== undefined ? { startStep: b.startStep } : {}),
            ...(b.deposit !== undefined ? { deposit: b.deposit } : {}),
            ...(b.cancelPolicy !== undefined ? { cancelPolicy: b.cancelPolicy } : {}),
            ...(b.domains !== undefined ? { domains: b.domains } : {}),
            ...(b.status !== undefined ? { status: b.status } : {}),
          })
          .where('id', '=', req.params.id)
          .execute();
        if (b.status !== undefined && b.status !== before.status) {
          await logAudit(trx, req.claims.ten, {
            actorEmployeeId: req.claims.sub,
            actorName: await actorName(trx, req.claims.sub),
            action: b.status === 'live' ? 'Widget set live' : 'Widget set to draft',
            object: `Widget · ${before.name}`,
            before: before.status,
            after: b.status,
          });
        }
        const after = await trx
          .selectFrom('widgets')
          .selectAll()
          .where('id', '=', req.params.id)
          .executeTakeFirstOrThrow();
        return toAdmin(trx, after);
      }),
  });

  r.route({
    method: 'POST',
    url: '/widgets/:id/regenerate-key',
    preHandler: [app.authenticate],
    schema: {
      params: z.object({ id: z.uuid() }),
      response: { 200: AdminWidgetSchema, 403: Err, 404: Err },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await guard(trx, req.claims, 'integrations.manage')))
          return reply
            .code(403)
            .send({ error: 'FORBIDDEN', message: 'Missing permission: integrations.manage' });
        const before = await trx
          .selectFrom('widgets')
          .selectAll()
          .where('id', '=', req.params.id)
          .executeTakeFirst();
        if (!before)
          return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown widget' });
        const key = newKey();
        await trx
          .updateTable('widgets')
          .set({ publishableKey: key })
          .where('id', '=', req.params.id)
          .execute();
        // The old key dies this second — that is the whole point.
        await logAudit(trx, req.claims.ten, {
          actorEmployeeId: req.claims.sub,
          actorName: await actorName(trx, req.claims.sub),
          action: 'Online booking / Regenerate widget key',
          object: `Widget · ${before.name}`,
        });
        const after = await trx
          .selectFrom('widgets')
          .selectAll()
          .where('id', '=', req.params.id)
          .executeTakeFirstOrThrow();
        return toAdmin(trx, after);
      }),
  });

  r.route({
    method: 'GET',
    url: '/integration-events',
    preHandler: [app.authenticate],
    schema: {
      querystring: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }),
      response: { 200: IntegrationEventsResponseSchema, 403: Err },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await guard(trx, req.claims, 'integrations.manage')))
          return reply
            .code(403)
            .send({ error: 'FORBIDDEN', message: 'Missing permission: integrations.manage' });
        const rows = await trx
          .selectFrom('integrationEvents')
          .selectAll()
          .orderBy('ts', 'desc')
          .limit(req.query.limit)
          .execute();
        return {
          events: rows.map((e) => ({
            id: e.id,
            ts: e.ts.toISOString(),
            widgetId: e.widgetId,
            level: e.level,
            code: e.code,
            msg: e.msg,
            fix: e.fix,
          })),
        };
      }),
  });
}
