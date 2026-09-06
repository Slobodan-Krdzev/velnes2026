import {
  BusinessCategoryCreateSchema,
  BusinessCategoryListSchema,
  BusinessCategoryPatchSchema,
} from '@velnes/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { db, withHq } from '../../db/index.js';

const Err = z.object({ error: z.string(), message: z.string() });

const superOnly = (reply: FastifyReply, rol: string) => {
  if (rol === 'hq_super') return true;
  void reply.code(403).send({ error: 'FORBIDDEN', message: 'HQ super only' });
  return false;
};

/** The salon verticals Revelapps HQ curates. One anonymous read for the
 *  registration wizard (enabled only), and HQ CRUD to manage the list. */
export function businessCategoriesRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // Anonymous — the registration wizard has no session. Enabled only.
  r.route({
    method: 'GET',
    url: '/business-categories',
    schema: { response: { 200: BusinessCategoryListSchema } },
    handler: async () => {
      const rows = await db
        .selectFrom('businessCategories')
        .select(['id', 'name', 'enabled', 'sort'])
        .where('enabled', '=', true)
        .orderBy('sort')
        .orderBy('name')
        .execute();
      return { categories: rows };
    },
  });

  // HQ sees the whole list.
  r.route({
    method: 'GET',
    url: '/hq/business-categories',
    preHandler: [app.authenticateHq],
    schema: { response: { 200: BusinessCategoryListSchema } },
    handler: async () =>
      withHq(async (trx) => ({
        categories: await trx
          .selectFrom('businessCategories')
          .select(['id', 'name', 'enabled', 'sort'])
          .orderBy('sort')
          .orderBy('name')
          .execute(),
      })),
  });

  r.route({
    method: 'POST',
    url: '/hq/business-categories',
    preHandler: [app.authenticateHq],
    schema: { body: BusinessCategoryCreateSchema, response: { 200: z.object({ id: z.uuid() }), 403: Err, 409: Err } },
    handler: async (req, reply) => {
      if (!superOnly(reply, req.hqClaims.rol)) return reply;
      return withHq(async (trx) => {
        const dupe = await trx
          .selectFrom('businessCategories')
          .select('id')
          .where('name', '=', req.body.name)
          .executeTakeFirst();
        if (dupe)
          return reply.code(409).send({ error: 'DUPLICATE', message: 'That category already exists' });
        const max = await trx
          .selectFrom('businessCategories')
          .select((eb) => eb.fn.max('sort').as('m'))
          .executeTakeFirst();
        const row = await trx
          .insertInto('businessCategories')
          .values({ name: req.body.name, sort: Number(max?.m ?? 0) + 1 })
          .returning('id')
          .executeTakeFirstOrThrow();
        return { id: row.id };
      });
    },
  });

  r.route({
    method: 'PATCH',
    url: '/hq/business-categories/:id',
    preHandler: [app.authenticateHq],
    schema: {
      params: z.object({ id: z.uuid() }),
      body: BusinessCategoryPatchSchema,
      response: { 200: z.object({ ok: z.literal(true) }), 403: Err, 404: Err },
    },
    handler: async (req, reply) => {
      if (!superOnly(reply, req.hqClaims.rol)) return reply;
      return withHq(async (trx) => {
        const row = await trx
          .selectFrom('businessCategories')
          .select('id')
          .where('id', '=', req.params.id)
          .executeTakeFirst();
        if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown category' });
        await trx
          .updateTable('businessCategories')
          .set({
            ...(req.body.name !== undefined ? { name: req.body.name } : {}),
            ...(req.body.enabled !== undefined ? { enabled: req.body.enabled } : {}),
          })
          .where('id', '=', req.params.id)
          .execute();
        return { ok: true as const };
      });
    },
  });
}
