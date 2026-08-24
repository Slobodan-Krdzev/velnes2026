import { z } from 'zod';
import { MoneySchema } from './catalog.js';

/** "HH:MM" clock time. */
export const ClockSchema = z.string().regex(/^\d{2}:\d{2}$/);
export const PeriodSchema = z.tuple([ClockSchema, ClockSchema]);

/** The day-schedule answer: periods is always a list — a day with a
 *  lunch break has two and nobody downstream cares. */
export const DayScheduleSchema = z.object({
  open: z.boolean(),
  periods: z.array(PeriodSchema),
  source: z.enum(['regular', 'exception']),
  reason: z.string().nullable(),
});
export type DaySchedule = z.infer<typeof DayScheduleSchema>;

export const ExceptionWriteSchema = z.object({
  startDate: z.iso.date(),
  endDate: z.iso.date().nullable().optional(),
  type: z.enum(['CLOSED', 'CUSTOM_HOURS']),
  periods: z.array(PeriodSchema).optional(),
  reason: z.string().optional(),
});
export const ExceptionSchema = z.object({
  id: z.uuid(),
  startDate: z.iso.date(),
  endDate: z.iso.date().nullable(),
  type: z.enum(['CLOSED', 'CUSTOM_HOURS']),
  periods: z.array(PeriodSchema).nullable(),
  reason: z.string().nullable(),
  source: z.enum(['MANUAL', 'PUBLIC_HOLIDAY']),
  holidayId: z.string().nullable(),
});
export type ScheduleException = z.infer<typeof ExceptionSchema>;

export const HolidaySchema = z.object({
  id: z.string(),
  date: z.iso.date(),
  name: z.string(),
  type: z.string(),
  applies: z.string(),
  movedFrom: z.iso.date().nullable(),
  state: z.enum(['open', 'applied', 'covered']),
});
export const HolidayListResponseSchema = z.object({
  years: z.array(
    z.object({ year: z.number().int(), verified: z.boolean(), source: z.string() }),
  ),
  holidays: z.array(HolidaySchema),
});

export const AvailabilityQuerySchema = z.object({
  locationId: z.uuid(),
  serviceId: z.uuid(),
  employeeId: z.union([z.uuid(), z.literal('any')]).default('any'),
  date: z.iso.date(),
  variantId: z.uuid().optional(),
  key: z.string().optional(), // your own hold does not block you
});
export const SlotSchema = z.object({
  t: ClockSchema,
  emp: z.uuid().nullable(),
  free: z.boolean(),
});
export const AvailabilityResponseSchema = z.object({ slots: z.array(SlotSchema) });
export type AvailabilityResponse = z.infer<typeof AvailabilityResponseSchema>;

export const HoldRequestSchema = z.object({
  key: z.string().min(8),
  locationId: z.uuid(),
  serviceId: z.uuid(),
  date: z.iso.date(),
  time: ClockSchema,
  employeeId: z.union([z.uuid(), z.literal('any')]).default('any'),
});
export const HoldResponseSchema = z.object({
  holdId: z.uuid(),
  until: z.iso.datetime(),
});

export const AppointmentStatusSchema = z.enum(['booked', 'confirmed', 'cancelled', 'no_show']);
export const AppointmentKindSchema = z.enum(['appointment', 'blocked', 'absence', 'chore', 'note']);

export const BookRequestSchema = z.object({
  key: z.string().min(8),
  locationId: z.uuid(),
  serviceId: z.uuid(),
  date: z.iso.date(),
  time: ClockSchema,
  employeeId: z.union([z.uuid(), z.literal('any')]).default('any'),
  variantId: z.uuid().nullable().optional(),
  modifierOptionIds: z.array(z.uuid()).default([]),
  customerId: z.uuid().optional(),
  name: z.string().optional(),
  email: z.email().optional(),
  phone: z.string().optional(),
  source: z.string().default('staff'),
  deposit: MoneySchema.default(0),
});
export type BookRequest = z.infer<typeof BookRequestSchema>;

export const AppointmentSchema = z.object({
  id: z.uuid(),
  locationId: z.uuid(),
  date: z.iso.date(),
  start: ClockSchema,
  end: ClockSchema,
  kind: AppointmentKindSchema,
  status: AppointmentStatusSchema,
  title: z.string(),
  serviceId: z.uuid().nullable(),
  serviceName: z.string().nullable(),
  variantId: z.uuid().nullable(),
  variantLabel: z.string().nullable(),
  modifierNames: z.array(z.string()),
  employeeId: z.uuid().nullable(),
  anyEmp: z.boolean(),
  customerId: z.uuid().nullable(),
  price: MoneySchema,
  durationMin: z.number().int(),
  prepMin: z.number().int(),
  resetMin: z.number().int(),
  basis: z.enum(['catalog', 'employee-approved', 'employee-pace']).nullable(),
  source: z.string(),
});
export type Appointment = z.infer<typeof AppointmentSchema>;

export const BookResponseSchema = z.object({ appointment: AppointmentSchema });

export const AppointmentPatchSchema = z.object({
  date: z.iso.date().optional(),
  time: ClockSchema.optional(),
  employeeId: z.uuid().optional(),
  status: AppointmentStatusSchema.optional(),
  reason: z.string().optional(),
});

export const AppointmentEventSchema = z.object({
  what: z.enum(['Treatment started', 'Treatment finished']),
});

export const AppointmentListQuerySchema = z.object({
  locationId: z.uuid(),
  from: z.iso.date(),
  to: z.iso.date(),
});
export const AppointmentListResponseSchema = z.object({
  appointments: z.array(AppointmentSchema),
});

/** The refusal from the one booking gate — a human sentence. */
export const BookingRefusalSchema = z.object({
  error: z.literal('REFUSED'),
  message: z.string(),
});
