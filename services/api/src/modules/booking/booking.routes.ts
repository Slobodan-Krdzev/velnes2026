import {
  AppointmentDecisionSchema,
  AppointmentEventSchema,
  AppointmentListQuerySchema,
  AppointmentListResponseSchema,
  AppointmentPatchSchema,
  AppointmentSchema,
  AvailabilityQuerySchema,
  AvailabilityResponseSchema,
  BookRequestSchema,
  BookResponseSchema,
  BookingRefusalSchema,
  HoldRequestSchema,
  HoldResponseSchema,
} from '@velnes/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant } from '../../db/index.js';
import { can, permsFor } from '../auth/authz.service.js';
import {
  appointmentEvent,
  availableSlots,
  BookingError,
  BookingRefused,
  confirmBooking,
  createHold,
  decideRequest,
  getAppointment,
  listAppointments,
  patchAppointment,
} from './booking.service.js';
import { notifyClient } from '../clients/clients.service.js';
import { afterDecided } from './requests.service.js';

const ErrorSchema = z.object({ error: z.string(), message: z.string() });
const IdParams = z.object({ id: z.uuid() });

function sendBookingError(reply: FastifyReply, e: unknown) {
  if (e instanceof BookingRefused)
    return reply.code(409).send({
      error: 'REFUSED' as const,
      message: e.message,
      code: e.code,
      params: e.params,
    });
  if (e instanceof BookingError)
    return reply
      .code(e.code === 'FORBIDDEN' ? 403 : 404)
      .send({ error: e.code, message: e.message });
  throw e;
}

export function bookingRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/availability',
    preHandler: [app.authenticate],
    schema: {
      querystring: AvailabilityQuerySchema,
      response: { 200: AvailabilityResponseSchema },
    },
    handler: async (req) => ({
      slots: await withTenant(req.claims.ten, (trx) =>
        availableSlots(trx, {
          locationId: req.query.locationId,
          serviceId: req.query.serviceId,
          employeeId: req.query.employeeId,
          date: req.query.date,
          variantId: req.query.variantId ?? null,
          key: req.query.key,
        }),
      ),
    }),
  });

  r.route({
    method: 'POST',
    url: '/holds',
    preHandler: [app.authenticate],
    schema: {
      body: HoldRequestSchema,
      response: { 200: HoldResponseSchema, 404: ErrorSchema, 409: BookingRefusalSchema },
    },
    handler: async (req, reply) => {
      try {
        return await withTenant(req.claims.ten, (trx) => createHold(trx, req.body));
      } catch (e) {
        return sendBookingError(reply, e);
      }
    },
  });

  r.route({
    method: 'POST',
    url: '/appointments',
    preHandler: [app.authenticate],
    schema: {
      body: BookRequestSchema,
      response: { 200: BookResponseSchema, 403: ErrorSchema, 404: ErrorSchema, 409: BookingRefusalSchema },
    },
    handler: async (req, reply) => {
      try {
        const appointment = await withTenant(req.claims.ten, async (trx) => {
          const perms = await permsFor(trx, req.claims);
          if (!can(perms, 'appointments.create'))
            throw new BookingError('FORBIDDEN', 'Missing permission: appointments.create');
          return confirmBooking(trx, req.claims, req.body);
        });
        return { appointment };
      } catch (e) {
        return sendBookingError(reply, e);
      }
    },
  });

  r.route({
    method: 'GET',
    url: '/appointments',
    preHandler: [app.authenticate],
    schema: {
      querystring: AppointmentListQuerySchema,
      response: { 200: AppointmentListResponseSchema, 403: ErrorSchema },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        // The prototype's view ladder: the location calendar needs
        // view_location; view_own alone shows exactly their own day.
        const perms = await permsFor(trx, req.claims);
        const wide = can(perms, 'appointments.view_location');
        if (!wide && !can(perms, 'appointments.view_own'))
          return reply
            .code(403)
            .send({ error: 'FORBIDDEN', message: 'Missing permission: appointments.view_own' });
        const rows = await listAppointments(trx, req.query);
        return {
          appointments: wide ? rows : rows.filter((a) => a.employeeId === req.claims.sub),
        };
      }),
  });

  // One appointment by id — what a bell entry opens. The same rights
  // as the list: location-wide readers see any, own-agenda readers
  // only their own.
  r.route({
    method: 'GET',
    url: '/appointments/:id',
    preHandler: [app.authenticate],
    schema: { params: IdParams, response: { 200: AppointmentSchema, 403: ErrorSchema, 404: ErrorSchema } },
    handler: async (req, reply) => {
      try {
        return await withTenant(req.claims.ten, async (trx) => {
          const perms = await permsFor(trx, req.claims);
          const wide = can(perms, 'appointments.view_location');
          if (!wide && !can(perms, 'appointments.view_own'))
            throw new BookingError('FORBIDDEN', 'Missing permission: appointments.view_own');
          const a = await getAppointment(trx, req.params.id);
          if (!wide && a.employeeId !== req.claims.sub)
            throw new BookingError('FORBIDDEN', 'Missing permission: appointments.view_location');
          return a;
        });
      } catch (e) {
        return sendBookingError(reply, e);
      }
    },
  });

  // The salon's answer to a booking request: accept or decline. Behind
  // appointments.edit; rings the customer's bell and mails them.
  r.route({
    method: 'POST',
    url: '/appointments/:id/decide',
    preHandler: [app.authenticate],
    schema: {
      params: IdParams,
      body: AppointmentDecisionSchema,
      response: { 200: AppointmentSchema, 403: ErrorSchema, 404: ErrorSchema, 409: BookingRefusalSchema },
    },
    handler: async (req, reply) => {
      try {
        const { a, notice, clientUserId } = await withTenant(req.claims.ten, async (trx) => {
          const perms = await permsFor(trx, req.claims);
          if (!can(perms, 'appointments.edit'))
            throw new BookingError('FORBIDDEN', 'Missing permission: appointments.edit');
          const a = await decideRequest(trx, req.claims, req.params.id, req.body.decision, req.body.reason);
          const row = await trx
            .selectFrom('appointments')
            .select(['clientUserId', 'customerId'])
            .where('id', '=', a.id)
            .executeTakeFirstOrThrow();
          const cust = row.customerId
            ? await trx.selectFrom('customers').select(['name', 'email']).where('id', '=', row.customerId).executeTakeFirst()
            : undefined;
          const notice = await afterDecided(trx, req.claims.ten, a, req.body.decision, req.body.reason, {
            name: cust?.name ?? a.title,
            email: cust?.email ?? null,
            clientUserId: row.clientUserId,
          });
          return { a, notice, clientUserId: row.clientUserId };
        });
        if (notice && clientUserId) await notifyClient(clientUserId, notice);
        return a;
      } catch (e) {
        return sendBookingError(reply, e);
      }
    },
  });

  r.route({
    method: 'PATCH',
    url: '/appointments/:id',
    preHandler: [app.authenticate],
    schema: {
      params: IdParams,
      body: AppointmentPatchSchema,
      response: { 200: AppointmentSchema, 403: ErrorSchema, 404: ErrorSchema, 409: BookingRefusalSchema },
    },
    handler: async (req, reply) => {
      try {
        return await withTenant(req.claims.ten, async (trx) => {
          // Cancelling is its own right; every other change is an edit.
          const perms = await permsFor(trx, req.claims);
          const key =
            req.body.status === 'cancelled' ? 'appointments.cancel' : 'appointments.edit';
          if (!can(perms, key))
            throw new BookingError('FORBIDDEN', `Missing permission: ${key}`);
          return patchAppointment(trx, req.claims, req.params.id, req.body);
        });
      } catch (e) {
        return sendBookingError(reply, e);
      }
    },
  });

  r.route({
    method: 'POST',
    url: '/appointments/:id/events',
    preHandler: [app.authenticate],
    schema: {
      params: IdParams,
      body: AppointmentEventSchema,
      response: { 200: z.object({ ok: z.literal(true) }), 404: ErrorSchema },
    },
    handler: async (req, reply) => {
      try {
        await withTenant(req.claims.ten, async (trx) => {
          const perms = await permsFor(trx, req.claims);
          if (!can(perms, 'appointments.edit'))
            throw new BookingError('FORBIDDEN', 'Missing permission: appointments.edit');
          const actor = await trx
            .selectFrom('employees')
            .select('name')
            .where('id', '=', req.claims.sub)
            .executeTakeFirst();
          await appointmentEvent(trx, req.params.id, req.body.what, actor?.name ?? '');
        });
        return { ok: true as const };
      } catch (e) {
        return sendBookingError(reply, e);
      }
    },
  });
}
