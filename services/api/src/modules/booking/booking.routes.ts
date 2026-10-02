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
  AppointmentChangesSchema,
  ChangeRequestDecisionSchema,
  ChangeRequestListSchema,
  PendingRequestsSchema,
  ChangeRequestSchema,
} from '@velnes/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
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
import { approveReschedule, cancelVisit, declineReschedule, paymentOf, refundOf, requestOf, visitHistory, visitLegs } from './changes.service.js';
import { processRefund } from '../payments/refunds.service.js';
import { hhmm, localIso } from '../scheduling/scheduling.service.js';

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
        // Cancelling is its own right, and its own door (Alex,
        // 2026-09-30): the whole visit, the facts, the refund intent and
        // the customer's word — the last two after the commit.
        if (req.body.status === 'cancelled') {
          const out = await withTenant(req.claims.ten, async (trx) => {
            const perms = await permsFor(trx, req.claims);
            if (!can(perms, 'appointments.cancel'))
              throw new BookingError('FORBIDDEN', 'Missing permission: appointments.cancel');
            const actor = await trx.selectFrom('employees').select('name').where('id', '=', req.claims.sub).executeTakeFirst();
            const r = await cancelVisit(trx, {
              appointmentId: req.params.id,
              by: 'salon',
              actor: { employeeId: req.claims.sub, name: actor?.name ?? '' },
              reason: req.body.reason ?? null,
            });
            return { r, a: await getAppointment(trx, req.params.id) };
          });
          if (out.r.notice && out.r.clientUserId) await notifyClient(out.r.clientUserId, out.r.notice);
          for (const rid of out.r.refundIds) await processRefund(rid);
          return out.a;
        }
        return await withTenant(req.claims.ten, async (trx) => {
          const perms = await permsFor(trx, req.claims);
          if (!can(perms, 'appointments.edit'))
            throw new BookingError('FORBIDDEN', 'Missing permission: appointments.edit');
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

  /* ── Booking changes (Alex, 2026-09-30) — docs/BOOKING-CHANGES.md ── */

  /** What a visit went through: the request, the cancellation, the
   *  money and the timeline — beside the appointment, for the drawer. */
  r.route({
    method: 'GET',
    url: '/appointments/:id/changes',
    preHandler: [app.authenticate],
    schema: { params: IdParams, response: { 200: AppointmentChangesSchema, 403: ErrorSchema, 404: ErrorSchema } },
    handler: async (req, reply) => {
      try {
        return await withTenant(req.claims.ten, async (trx) => {
          const perms = await permsFor(trx, req.claims);
          const wide = can(perms, 'appointments.view_location');
          if (!wide && !can(perms, 'appointments.view_own'))
            throw new BookingError('FORBIDDEN', 'Missing permission: appointments.view_own');
          const legs = await visitLegs(trx, req.params.id);
          const first = legs[0]!;
          if (!wide && !legs.some((l) => l.employeeId === req.claims.sub))
            throw new BookingError('FORBIDDEN', 'Missing permission: appointments.view_location');
          return {
            changeRequest: await requestOf(trx, first.id),
            cancellation:
              first.status === 'cancelled' && first.cancelledAt && first.cancelledBy
                ? { at: first.cancelledAt.toISOString(), by: first.cancelledBy as 'customer' | 'salon' | 'system' | 'hq', reason: first.cancelReason }
                : null,
            cancelHours: first.cancelHours,
            payment: await paymentOf(trx, legs),
            refund: await refundOf(trx, legs),
            history: await visitHistory(trx, req.params.id),
          };
        });
      } catch (e) {
        return sendBookingError(reply, e);
      }
    },
  });

  /**
   * Everything waiting for the salon's answer (Alex, 2026-10-01): the
   * booking requests still `requested`, and the pending reschedules —
   * for the flight deck's card and the Requests screen.
   */
  r.route({
    method: 'GET',
    url: '/requests/pending',
    preHandler: [app.authenticate],
    schema: { response: { 200: PendingRequestsSchema, 403: ErrorSchema } },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        const perms = await permsFor(trx, req.claims);
        const wide = can(perms, 'appointments.view_location');
        if (!wide && !can(perms, 'appointments.view_own'))
          return reply.code(403).send({ error: 'FORBIDDEN', message: 'Missing permission: appointments.view_own' });
        const rows = await trx
          .selectFrom('appointments as a')
          .leftJoin('locations as l', 'l.id', 'a.locationId')
          .leftJoin('services as s', 's.id', 'a.serviceId')
          .leftJoin('employees as e', 'e.id', 'a.employeeId')
          .select(['a.id', 'a.locationId', 'a.employeeId', 'a.title', 'a.date', 'a.startMin', 'a.durationMin', 'a.price', 'a.source', 'a.createdAt'])
          .select(['l.name as locationName', 's.name as serviceName', 'e.name as employeeName'])
          .where('a.kind', '=', 'appointment')
          .where('a.status', '=', 'requested')
          .orderBy('a.createdAt', 'desc')
          .limit(200)
          .execute();
        const ids = rows.map((x) => x.id);
        const units = ids.length
          ? await trx
              .selectFrom('appointmentProducts')
              .select(['appointmentId', sql<number>`COALESCE(SUM(qty), 0)`.as('units')])
              .where('appointmentId', 'in', ids)
              .groupBy('appointmentId')
              .execute()
          : [];
        const bookings = rows
          .filter((x) => wide || x.employeeId === req.claims.sub)
          .map((x) => ({
            id: x.id,
            locationId: x.locationId,
            locationName: x.locationName ?? '—',
            customerName: x.title,
            serviceName: x.serviceName ?? x.title,
            employeeName: x.employeeName ?? null,
            date: localIso(x.date),
            time: hhmm(x.startMin),
            end: hhmm(x.startMin + x.durationMin),
            price: x.price,
            source: x.source,
            requestedAt: x.createdAt.toISOString(),
            productUnits: Number(units.find((u) => u.appointmentId === x.id)?.units ?? 0),
          }));
        const pending = await trx
          .selectFrom('bookingChangeRequests as r')
          .innerJoin('appointments as a', 'a.id', 'r.appointmentId')
          .leftJoin('locations as l', 'l.id', 'a.locationId')
          .leftJoin('services as s', 's.id', 'a.serviceId')
          .leftJoin('employees as e', 'e.id', 'a.employeeId')
          .selectAll('r')
          .select(['a.locationId', 'a.employeeId', 'a.title', 'l.name as locationName', 's.name as serviceName', 'e.name as employeeName'])
          .where('r.status', '=', 'pending')
          .orderBy('r.requestedAt', 'desc')
          .limit(200)
          .execute();
        const reschedules = pending
          .filter((x) => wide || x.employeeId === req.claims.sub)
          .map((x) => ({
            id: x.id,
            appointmentId: x.appointmentId,
            status: 'pending' as const,
            originalDate: localIso(x.originalDate),
            originalTime: hhmm(x.originalStartMin),
            originalEnd: hhmm(x.originalStartMin + x.originalDurationMin),
            requestedDate: localIso(x.requestedDate),
            requestedTime: hhmm(x.requestedStartMin),
            requestedEnd: hhmm(x.requestedStartMin + x.originalDurationMin),
            requestedAt: x.requestedAt.toISOString(),
            resolvedAt: null,
            resolvedByName: null,
            declineReason: x.declineReason,
            customerDecision: null,
            decidedAt: null,
            locationId: x.locationId,
            locationName: x.locationName ?? '—',
            customerName: x.title,
            serviceName: x.serviceName ?? x.title,
            employeeName: x.employeeName ?? null,
          }));
        return { bookings, reschedules };
      }),
  });

  /** The requests waiting for the salon (or already answered), newest
   *  first — the calendar's inbox. Own-agenda readers see their own. */
  r.route({
    method: 'GET',
    url: '/change-requests',
    preHandler: [app.authenticate],
    schema: {
      querystring: z.object({ status: z.enum(['pending', 'declined', 'approved', 'withdrawn', 'resolved']).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }),
      response: { 200: ChangeRequestListSchema, 403: ErrorSchema },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        const perms = await permsFor(trx, req.claims);
        const wide = can(perms, 'appointments.view_location');
        if (!wide && !can(perms, 'appointments.view_own'))
          return reply.code(403).send({ error: 'FORBIDDEN', message: 'Missing permission: appointments.view_own' });
        let q = trx
          .selectFrom('bookingChangeRequests as r')
          .innerJoin('appointments as a', 'a.id', 'r.appointmentId')
          .leftJoin('locations as l', 'l.id', 'a.locationId')
          .leftJoin('services as s', 's.id', 'a.serviceId')
          .leftJoin('employees as e', 'e.id', 'a.employeeId')
          .leftJoin('employees as by', 'by.id', 'r.resolvedByEmployeeId')
          .selectAll('r')
          .select(['a.locationId', 'a.employeeId', 'a.title', 'l.name as locationName', 's.name as serviceName', 'e.name as employeeName', 'by.name as resolvedByName'])
          .orderBy('r.requestedAt', 'desc')
          .limit(req.query.limit);
        if (req.query.status) q = q.where('r.status', '=', req.query.status);
        const rows = await q.execute();
        return {
          requests: rows
            .filter((x) => wide || x.employeeId === req.claims.sub)
            .map((x) => ({
              id: x.id,
              appointmentId: x.appointmentId,
              status: x.status as 'pending' | 'approved' | 'declined' | 'withdrawn' | 'resolved',
              originalDate: localIso(x.originalDate),
              originalTime: hhmm(x.originalStartMin),
              originalEnd: hhmm(x.originalStartMin + x.originalDurationMin),
              requestedDate: localIso(x.requestedDate),
              requestedTime: hhmm(x.requestedStartMin),
              requestedEnd: hhmm(x.requestedStartMin + x.originalDurationMin),
              requestedAt: x.requestedAt.toISOString(),
              resolvedAt: x.resolvedAt?.toISOString() ?? null,
              resolvedByName: x.resolvedByName ?? null,
              declineReason: x.declineReason,
              customerDecision: (x.customerDecision as 'keep' | 'cancel' | null) ?? null,
              decidedAt: x.decidedAt?.toISOString() ?? null,
              locationId: x.locationId,
              locationName: x.locationName ?? '—',
              customerName: x.title,
              serviceName: x.serviceName ?? x.title,
              employeeName: x.employeeName ?? null,
            })),
        };
      }),
  });

  /** Approve: re-checked through the gate now, every leg moved, the
   *  customer told. Decline: nothing moves, the customer is asked. Both
   *  behind appointments.edit, like a booking request's decision. */
  for (const action of ['approve', 'decline'] as const)
    r.route({
      method: 'POST',
      url: `/change-requests/:id/${action}`,
      preHandler: [app.authenticate],
      schema: {
        params: IdParams,
        // A bare POST arrives as a null body.
        body: ChangeRequestDecisionSchema.nullish(),
        response: { 200: ChangeRequestSchema, 403: ErrorSchema, 404: ErrorSchema, 409: BookingRefusalSchema },
      },
      handler: async (req, reply) => {
        try {
          const out = await withTenant(req.claims.ten, async (trx) => {
            const perms = await permsFor(trx, req.claims);
            if (!can(perms, 'appointments.edit'))
              throw new BookingError('FORBIDDEN', 'Missing permission: appointments.edit');
            return action === 'approve'
              ? approveReschedule(trx, req.claims, req.params.id)
              : declineReschedule(trx, req.claims, req.params.id, req.body?.reason);
          });
          if (out.notice && out.clientUserId) await notifyClient(out.clientUserId, out.notice);
          return out.request;
        } catch (e) {
          return sendBookingError(reply, e);
        }
      },
    });
}
