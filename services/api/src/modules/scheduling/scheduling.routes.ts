import {
  DayScheduleSchema,
  ExceptionSchema,
  ExceptionWriteSchema,
  HolidayListResponseSchema,
} from '@velnes/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTenant } from '../../db/index.js';
import {
  applyHoliday,
  createException,
  deleteException,
  listExceptions,
  locationHolidays,
  ScheduleError,
  scheduleFor,
} from './scheduling.service.js';

const ErrorSchema = z.object({ error: z.string(), message: z.string() });
const IdParams = z.object({ id: z.uuid() });

function sendScheduleError(reply: FastifyReply, e: unknown) {
  if (e instanceof ScheduleError) {
    const status = e.code === 'NOT_FOUND' ? 404 : e.code === 'CLASH' ? 409 : 422;
    return reply.code(status as 404).send({ error: e.code, message: e.message });
  }
  throw e;
}

export function schedulingRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/locations/:id/schedule',
    preHandler: [app.authenticate],
    schema: {
      params: IdParams,
      querystring: z.object({ date: z.iso.date() }),
      response: { 200: DayScheduleSchema, 404: ErrorSchema },
    },
    handler: async (req, reply) => {
      try {
        return await withTenant(req.claims.ten, (trx) =>
          scheduleFor(trx, req.params.id, req.query.date),
        );
      } catch (e) {
        return sendScheduleError(reply, e);
      }
    },
  });

  r.route({
    method: 'GET',
    url: '/locations/:id/exceptions',
    preHandler: [app.authenticate],
    schema: {
      params: IdParams,
      response: { 200: z.object({ exceptions: z.array(ExceptionSchema) }) },
    },
    handler: async (req) => ({
      exceptions: await withTenant(req.claims.ten, (trx) => listExceptions(trx, req.params.id)),
    }),
  });

  r.route({
    method: 'POST',
    url: '/locations/:id/exceptions',
    preHandler: [app.authenticate],
    schema: {
      params: IdParams,
      body: ExceptionWriteSchema,
      response: { 200: ExceptionSchema, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
    },
    handler: async (req, reply) => {
      try {
        return await withTenant(req.claims.ten, (trx) =>
          createException(trx, req.params.id, req.body),
        );
      } catch (e) {
        return sendScheduleError(reply, e);
      }
    },
  });

  r.route({
    method: 'DELETE',
    url: '/locations/:id/exceptions/:excId',
    preHandler: [app.authenticate],
    schema: {
      params: z.object({ id: z.uuid(), excId: z.uuid() }),
      response: { 200: z.object({ ok: z.literal(true) }), 404: ErrorSchema },
    },
    handler: async (req, reply) => {
      try {
        await withTenant(req.claims.ten, (trx) =>
          deleteException(trx, req.params.id, req.params.excId),
        );
        return { ok: true as const };
      } catch (e) {
        return sendScheduleError(reply, e);
      }
    },
  });

  r.route({
    method: 'GET',
    url: '/locations/:id/holidays',
    preHandler: [app.authenticate],
    schema: {
      params: IdParams,
      response: { 200: HolidayListResponseSchema, 404: ErrorSchema },
    },
    handler: async (req, reply) => {
      try {
        return await withTenant(req.claims.ten, (trx) => locationHolidays(trx, req.params.id));
      } catch (e) {
        return sendScheduleError(reply, e);
      }
    },
  });

  r.route({
    method: 'POST',
    url: '/locations/:id/holidays/:holidayId/apply',
    preHandler: [app.authenticate],
    schema: {
      params: z.object({ id: z.uuid(), holidayId: z.string() }),
      response: { 200: ExceptionSchema, 404: ErrorSchema, 409: ErrorSchema, 422: ErrorSchema },
    },
    handler: async (req, reply) => {
      try {
        return await withTenant(req.claims.ten, (trx) =>
          applyHoliday(trx, req.params.id, req.params.holidayId),
        );
      } catch (e) {
        return sendScheduleError(reply, e);
      }
    },
  });
}
