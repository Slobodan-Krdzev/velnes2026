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
/**
 * Why a day came back with nothing free, when the door knows a reason
 * the caller could act on. Absent when the day is simply full.
 *
 *   NOBODY_AT_PACE — "any professional" was asked, and everyone who
 *   does the treatment is measured slower than the catalog quotes it,
 *   so no one fits the offered slot. Choosing a professional by name
 *   offers their own times at their own pace.
 */
export const SlotsReasonSchema = z.enum(['NOBODY_AT_PACE']);
export const AvailabilityResponseSchema = z.object({
  slots: z.array(SlotSchema),
  reason: SlotsReasonSchema.optional(),
});
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

/** `requested`: a Velnes-app booking at a salon that confirms by hand —
 *  it holds its slot until the salon accepts (booked) or declines
 *  (cancelled). Nobody pays for a request. */
export const AppointmentStatusSchema = z.enum(['booked', 'confirmed', 'cancelled', 'no_show', 'requested']);
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
  serviceCategory: z.string().nullable(),
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
  // True once a live invoice line references this appointment — the
  // till stops offering it, the drawer can say so.
  paid: z.boolean().default(false),
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

/** The salon's answer to a request — one door, `POST /appointments/:id/decide`. */
export const AppointmentDecisionSchema = z.object({
  decision: z.enum(['accept', 'decline']),
  reason: z.string().max(300).optional(),
});
export type AppointmentDecision = z.infer<typeof AppointmentDecisionSchema>;

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

/** Structured refusal codes from the one booking gate — clients
 *  render these localized; `message` stays the English fallback. */
export const RefusalCodeSchema = z.enum([
  'LOC_UNKNOWN',
  'LOC_CLOSED_DAY',
  'LOC_CLOSED_EXCEPTION',
  'LOC_OPEN_HOURS',
  'NOBODY_DOES_SERVICE',
  'NOBODY_FREE',
  'EMP_PICK',
  'EMP_NOT_AT_LOCATION',
  'EMP_NOT_BOOKABLE',
  'EMP_INVITED',
  'PAST_CLOSING',
  'BEFORE_OPENING',
  'EMP_DAY_OFF',
  'EMP_NO_ROOM_WRAP',
  'EMP_HOURS',
  'EMP_NO_SKILL',
  'CUSTOMER_BLACKLISTED',
  'EMP_BUSY',
  'SLOT_HELD',
  'ROOMS_FULL',
  'MISSING_REQUIRED',
  'NOT_A_REQUEST',
  'NOT_PAYABLE',
  'ALREADY_PAID',
  'CARD_DECLINED',
  'BAD_CODE',
]);
export type RefusalCode = z.infer<typeof RefusalCodeSchema>;

/** The refusal from the one booking gate — a human sentence plus the
 *  structured code + params that let every client localize it. */
export const BookingRefusalSchema = z.object({
  error: z.literal('REFUSED'),
  message: z.string(),
  code: RefusalCodeSchema.optional(),
  params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});
export type BookingRefusal = z.infer<typeof BookingRefusalSchema>;
