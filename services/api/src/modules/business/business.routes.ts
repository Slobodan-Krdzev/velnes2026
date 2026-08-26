import {
  BusinessPatchSchema,
  BusinessProfileSchema,
  BusinessSettingsPatchSchema,
  BusinessSettingsSchema,
  type BusinessSettings,
} from '@velnes/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant, type Trx } from '../../db/index.js';
import { logAudit } from '../audit/audit.service.js';
import { can, permsFor } from '../auth/authz.service.js';

const Err = z.object({ error: z.string(), message: z.string() });

async function profile(trx: Trx) {
  const b = await trx.selectFrom('businesses').selectAll().executeTakeFirstOrThrow();
  const le = await trx
    .selectFrom('legalEntities')
    .selectAll()
    .where('ownerType', '=', 'salon')
    .where('isDefault', '=', true)
    .executeTakeFirst();
  const acc = le
    ? await trx
        .selectFrom('paymentAccounts')
        .selectAll()
        .where('legalEntityId', '=', le.id)
        .executeTakeFirst()
    : undefined;
  return {
    id: b.id,
    name: b.name,
    country: b.country,
    vat: b.vat,
    slug: b.slug,
    address: b.address,
    city: b.city,
    phone: b.phone,
    description: b.description,
    gallery: (b.gallery ?? []) as z.infer<typeof BusinessProfileSchema>['gallery'],
    timingEnabled: b.timingEnabled,
    legal: le
      ? {
          name: le.name,
          taxId: le.taxId,
          status: le.status,
          merchantId: acc?.merchantId ?? null,
          provider: acc?.provider ?? null,
          accountStatus: acc?.status ?? null,
        }
      : null,
  };
}

export function businessRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  const gate = async (
    trx: Trx,
    claims: Parameters<typeof permsFor>[1],
    reply: FastifyReply,
    perm: Parameters<typeof can>[1],
  ) => {
    const perms = await permsFor(trx, claims);
    if (!can(perms, perm)) {
      await reply
        .code(403)
        .send({ error: 'FORBIDDEN', message: `Missing permission: ${perm}` });
      return false;
    }
    return true;
  };

  r.route({
    method: 'GET',
    url: '/business',
    preHandler: [app.authenticate],
    schema: { response: { 200: BusinessProfileSchema } },
    handler: async (req) => withTenant(req.claims.ten, profile),
  });

  r.route({
    method: 'PATCH',
    url: '/business',
    preHandler: [app.authenticate],
    schema: {
      body: BusinessPatchSchema,
      response: { 200: BusinessProfileSchema, 403: Err },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        if (!(await gate(trx, req.claims, reply, 'locations.manage'))) return reply;
        const b = req.body;
        const before = await trx.selectFrom('businesses').select('name').executeTakeFirstOrThrow();
        await trx
          .updateTable('businesses')
          .set({
            ...(b.name !== undefined ? { name: b.name } : {}),
            ...(b.address !== undefined ? { address: b.address } : {}),
            ...(b.city !== undefined ? { city: b.city } : {}),
            ...(b.phone !== undefined ? { phone: b.phone } : {}),
            ...(b.description !== undefined ? { description: b.description } : {}),
            ...(b.gallery !== undefined ? { gallery: JSON.stringify(b.gallery) } : {}),
            ...(b.timingEnabled !== undefined ? { timingEnabled: b.timingEnabled } : {}),
          })
          .where('id', '=', req.claims.ten)
          .execute();
        if (b.name !== undefined && b.name !== before.name) {
          const actor = await trx
            .selectFrom('employees')
            .select('name')
            .where('id', '=', req.claims.sub)
            .executeTakeFirst();
          await logAudit(trx, req.claims.ten, {
            actorEmployeeId: req.claims.sub,
            actorName: actor?.name ?? '',
            action: 'Business renamed',
            object: `Business · ${before.name}`,
            before: before.name,
            after: b.name,
          });
        }
        return profile(trx);
      }),
  });

  r.route({
    method: 'GET',
    url: '/business-settings',
    preHandler: [app.authenticate],
    schema: { response: { 200: BusinessSettingsSchema } },
    handler: async (req) =>
      withTenant(req.claims.ten, async (trx) => {
        const b = await trx.selectFrom('businesses').select('settings').executeTakeFirstOrThrow();
        // Defaults fill any section that was never saved.
        return BusinessSettingsSchema.parse(b.settings ?? {});
      }),
  });

  r.route({
    method: 'PATCH',
    url: '/business-settings',
    preHandler: [app.authenticate],
    schema: {
      body: BusinessSettingsPatchSchema,
      response: { 200: BusinessSettingsSchema, 403: Err },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        // Each section keeps the prototype's permission split.
        const need: [keyof BusinessSettings, Parameters<typeof can>[1]][] = [
          ['ranking', 'ranking.manage'],
          ['customers', 'customers.view_business'],
          ['sales', 'payments.manage'],
          ['marketplace', 'widget.manage'],
        ];
        const perms = await permsFor(trx, req.claims);
        for (const [section, perm] of need)
          if (req.body[section] !== undefined && !can(perms, perm))
            return reply
              .code(403)
              .send({ error: 'FORBIDDEN', message: `Missing permission: ${perm}` });
        const b = await trx.selectFrom('businesses').select('settings').executeTakeFirstOrThrow();
        const merged = BusinessSettingsSchema.parse({
          ...((b.settings ?? {}) as Record<string, unknown>),
          ...req.body,
        });
        await trx
          .updateTable('businesses')
          .set({ settings: JSON.stringify(merged) })
          .where('id', '=', req.claims.ten)
          .execute();
        return merged;
      }),
  });
}
