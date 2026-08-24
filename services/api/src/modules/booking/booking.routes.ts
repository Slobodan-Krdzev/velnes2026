import {
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
import {
  appointmentEvent,
  availableSlots,
  BookingError,
  BookingRefused,
  confirmBooking,
  createHold,
  listAppointments,
  patchAppointment,
} from './booking.service.js';

const ErrorSchema = z.object({ error: z.string(), message: z.string() });
const IdParams = z.object({ id: z.uuid() });

function sendBookingError(reply: FastifyReply, e: unknown) {
  if (e instanceof BookingRefused)
    return reply.code(409).send({ error: 'REFUSED' as const, message: e.message });
  if (e instanceof BookingError)
    return reply.code(404).send({ error: e.code, message: e.message });
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
      response: { 200: BookResponseSchema, 404: ErrorSchema, 409: BookingRefusalSchema },
    },
    handler: async (req, reply) => {
      try {
        const appointment = await withTenant(req.claims.ten, (trx) =>
          confirmBooking(trx, req.claims, req.body),
        );
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
      response: { 200: AppointmentListResponseSchema },
    },
    handler: async (req) => ({
      appointments: await withTenant(req.claims.ten, (trx) =>
        listAppointments(trx, req.query),
      ),
    }),
  });

  r.route({
    method: 'PATCH',
    url: '/appointments/:id',
    preHandler: [app.authenticate],
    schema: {
      params: IdParams,
      body: AppointmentPatchSchema,
      response: { 200: AppointmentSchema, 404: ErrorSchema, 409: BookingRefusalSchema },
    },
    handler: async (req, reply) => {
      try {
        return await withTenant(req.claims.ten, (trx) =>
          patchAppointment(trx, req.claims, req.params.id, req.body),
        );
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
