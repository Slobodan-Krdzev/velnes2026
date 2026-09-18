import {
  CopySetupRequestSchema,
  CopySetupResponseSchema,
  LegalEntityListSchema,
  LocationPatchSchema,
  LocationCreateSchema,
  LocationListResponseSchema,
  LocationSchema,
  ReadinessResponseSchema,
  TransitionRequestSchema,
  TransitionResponseSchema,
  type Location,
} from '@velnes/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant } from '../../db/index.js';
import { logAudit } from '../audit/audit.service.js';
import { can, permsFor } from '../auth/authz.service.js';
import {
  copySetupInto,
  createLocation,
  listLocations,
  LocationError,
  locReadiness,
  locTransition,
} from './locations.service.js';

const ErrorSchema = z.object({ error: z.string(), message: z.string() });
const IdParams = z.object({ id: z.uuid() });

const statusFor = {
  NOT_FOUND: 404,
  ILLEGAL_TRANSITION: 409,
  NOT_READY: 409,
  OWNER_ONLY: 403,
} as const satisfies Record<LocationError['code'], number>;

export function locationsRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/locations',
    preHandler: [app.authenticate],
    schema: { response: { 200: LocationListResponseSchema } },
    handler: async (req) => ({
      locations: await withTenant(req.claims.ten, (trx) => listLocations(trx)),
    }),
  });

  r.route({
    method: 'GET',
    url: '/legal-entities',
    preHandler: [app.authenticate],
    schema: { response: { 200: LegalEntityListSchema } },
    handler: async (req) =>
      withTenant(req.claims.ten, async (trx) => ({
        entities: (
          await trx
            .selectFrom('legalEntities')
            .select(['id', 'name', 'taxId', 'status', 'isDefault'])
            .where('ownerType', '=', 'salon')
            .orderBy('isDefault', 'desc')
            .orderBy('name')
            .execute()
        ).map((e) => ({ ...e, status: String(e.status) })),
      })),
  });

  r.route({
    method: 'POST',
    url: '/locations',
    preHandler: [app.authenticate],
    schema: {
      body: LocationCreateSchema,
      response: { 200: LocationSchema, 403: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema },
    },
    handler: async (req, reply) => {
      try {
        return await withTenant(req.claims.ten, async (trx) => {
          const perms = await permsFor(trx, req.claims);
          if (!can(perms, 'locations.manage'))
            throw new LocationError('OWNER_ONLY', 'Missing permission: locations.manage');
          return createLocation(trx, req.claims, req.body);
        });
      } catch (e) {
        if (e instanceof LocationError)
          return reply.code(statusFor[e.code]).send({ error: e.code, message: e.message });
        throw e;
      }
    },
  });

  r.route({
    method: 'PATCH',
    url: '/locations/:id',
    preHandler: [app.authenticate],
    schema: {
      params: IdParams,
      body: LocationPatchSchema,
      response: { 200: LocationSchema, 403: ErrorSchema, 404: ErrorSchema },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        const perms = await permsFor(trx, req.claims);
        if (!can(perms, 'locations.manage'))
          return reply
            .code(403)
            .send({ error: 'FORBIDDEN', message: 'Missing permission: locations.manage' });
        const before = await trx
          .selectFrom('locations')
          .selectAll()
          .where('id', '=', req.params.id)
          .executeTakeFirst();
        if (!before)
          return reply.code(404).send({ error: 'NOT_FOUND', message: 'Unknown location' });
        const b = req.body;
        await trx
          .updateTable('locations')
          .set({
            ...(b.hours !== undefined ? { hours: JSON.stringify(b.hours) } : {}),
            ...(b.cancelHours !== undefined ? { cancelHours: b.cancelHours } : {}),
            ...(b.invPrefix !== undefined ? { invPrefix: b.invPrefix } : {}),
            ...(b.name !== undefined ? { name: b.name } : {}),
            ...(b.address !== undefined ? { address: b.address } : {}),
            ...(b.city !== undefined ? { city: b.city } : {}),
            ...(b.phone !== undefined ? { phone: b.phone } : {}),
            ...(b.tz !== undefined ? { tz: b.tz } : {}),
            ...(b.rooms !== undefined ? { rooms: b.rooms } : {}),
            ...(b.online !== undefined ? { online: b.online } : {}),
            ...(b.lat !== undefined ? { lat: b.lat } : {}),
            ...(b.lng !== undefined ? { lng: b.lng } : {}),
          })
          .where('id', '=', req.params.id)
          .execute();
        const actor = await trx
          .selectFrom('employees')
          .select('name')
          .where('id', '=', req.claims.sub)
          .executeTakeFirst();
        // Changing the week changes real availability — that is an
        // audited act, not a cosmetic edit.
        if (b.hours !== undefined) {
          await logAudit(trx, req.claims.ten, {
            actorEmployeeId: req.claims.sub,
            actorName: actor?.name ?? '',
            action: 'Working hours changed',
            object: `Location · ${before.name}`,
            locationName: before.name,
          });
        }
        // The card edit is the prototype's 'Location changed' entry.
        const cardTouched =
          b.name !== undefined || b.address !== undefined || b.city !== undefined ||
          b.phone !== undefined || b.tz !== undefined || b.rooms !== undefined ||
          b.online !== undefined;
        if (cardTouched) {
          await logAudit(trx, req.claims.ten, {
            actorEmployeeId: req.claims.sub,
            actorName: actor?.name ?? '',
            action: 'Location changed',
            object: `Location · ${b.name ?? before.name}`,
            before: `${before.name} · ${before.address ?? ''}`,
            after: `${b.name ?? before.name} · ${(b.address !== undefined ? b.address : before.address) ?? ''}`,
            locationName: b.name ?? before.name,
          });
        }
        const row = await trx
          .selectFrom('locations')
          .selectAll()
          .where('id', '=', req.params.id)
          .executeTakeFirstOrThrow();
        return {
          id: row.id,
          name: row.name,
          city: row.city,
          address: row.address,
          tz: row.tz,
          phone: row.phone,
          rooms: row.rooms,
          invPrefix: row.invPrefix,
          online: row.online,
          cancelHours: row.cancelHours,
          opened: row.opened ? row.opened.toISOString().slice(0, 10) : null,
          lifecycle: row.lifecycle,
          hours: (row.hours ?? null) as Location['hours'],
          lat: row.lat,
          lng: row.lng,
        };
      }),
  });

  r.route({
    method: 'GET',
    url: '/locations/:id/readiness',
    preHandler: [app.authenticate],
    schema: {
      params: IdParams,
      response: { 200: ReadinessResponseSchema, 403: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema },
    },
    handler: async (req, reply) => {
      try {
        return await withTenant(req.claims.ten, (trx) => locReadiness(trx, req.params.id));
      } catch (e) {
        if (e instanceof LocationError)
          return reply.code(statusFor[e.code]).send({ error: e.code, message: e.message });
        throw e;
      }
    },
  });

  r.route({
    method: 'POST',
    url: '/locations/:id/copy-setup',
    preHandler: [app.authenticate],
    schema: {
      params: IdParams,
      body: CopySetupRequestSchema,
      response: { 200: CopySetupResponseSchema, 403: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema },
    },
    handler: async (req, reply) => {
      try {
        await withTenant(req.claims.ten, async (trx) => {
          const perms = await permsFor(trx, req.claims);
          if (!can(perms, 'locations.manage'))
            throw new LocationError('OWNER_ONLY', 'Missing permission: locations.manage');
          await copySetupInto(trx, req.claims, req.params.id, req.body);
        });
        return { ok: true as const };
      } catch (e) {
        if (e instanceof LocationError)
          return reply.code(statusFor[e.code]).send({ error: e.code, message: e.message });
        throw e;
      }
    },
  });

  r.route({
    method: 'POST',
    url: '/locations/:id/transitions',
    preHandler: [app.authenticate],
    schema: {
      params: IdParams,
      body: TransitionRequestSchema,
      response: { 200: TransitionResponseSchema, 403: ErrorSchema, 404: ErrorSchema, 409: ErrorSchema },
    },
    handler: async (req, reply) => {
      try {
        const location = await withTenant(req.claims.ten, async (trx) => {
          const perms = await permsFor(trx, req.claims);
          if (!can(perms, 'locations.manage'))
            throw new LocationError('OWNER_ONLY', 'Missing permission: locations.manage');
          return locTransition(trx, req.claims, req.params.id, req.body.to, req.body.reason);
        });
        return { location };
      } catch (e) {
        if (e instanceof LocationError)
          return reply.code(statusFor[e.code]).send({ error: e.code, message: e.message });
        throw e;
      }
    },
  });
}
