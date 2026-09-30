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
  // Booking changes (2026-09-30) — docs/BOOKING-CHANGES.md
  'CANCEL_TOO_LATE',
  'ALREADY_CANCELLED',
  'VISIT_STARTED',
  'REQUEST_ACTIVE',
  'NO_REQUEST',
  'SAME_TIME',
  'SLOT_TAKEN',
  'NOT_CHANGEABLE',
  'TIME_PASSED',
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

/* ── Booking changes (Alex, 2026-09-30) — docs/BOOKING-CHANGES.md ──── */

/** Who cancelled — a fact on the appointment, never inferred later. */
export const CancelledBySchema = z.enum(['customer', 'salon', 'system', 'hq']);
export type CancelledBy = z.infer<typeof CancelledBySchema>;

/** A customer's request to move a visit. The appointment itself keeps
 *  its status and time until the salon approves; a declined request
 *  waits for the customer's answer (keep or cancel) and is then
 *  resolved. One active (pending or declined-unanswered) per visit. */
export const ChangeRequestStatusSchema = z.enum(['pending', 'approved', 'declined', 'withdrawn', 'resolved']);
export const ChangeRequestSchema = z.object({
  id: z.uuid(),
  appointmentId: z.uuid(),
  status: ChangeRequestStatusSchema,
  originalDate: z.iso.date(),
  originalTime: ClockSchema,
  originalEnd: ClockSchema,
  requestedDate: z.iso.date(),
  requestedTime: ClockSchema,
  requestedEnd: ClockSchema,
  requestedAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
  resolvedByName: z.string().nullable(),
  declineReason: z.string().nullable(),
  customerDecision: z.enum(['keep', 'cancel']).nullable(),
  decidedAt: z.iso.datetime().nullable(),
});
export type ChangeRequest = z.infer<typeof ChangeRequestSchema>;

/** A pending request as the workspace lists it — the visit beside it. */
export const ChangeRequestRowSchema = ChangeRequestSchema.extend({
  locationId: z.uuid(),
  locationName: z.string(),
  customerName: z.string(),
  serviceName: z.string(),
  employeeName: z.string().nullable(),
});
export const ChangeRequestListSchema = z.object({ requests: z.array(ChangeRequestRowSchema) });
export const ChangeRequestDecisionSchema = z.object({ reason: z.string().max(300).optional() });

/** One line of a visit's timeline — the history table with its
 *  structured detail, for the workspace's drawer and the customer's
 *  "what happened" section. */
export const AppointmentHistoryEntrySchema = z.object({
  at: z.iso.datetime(),
  what: z.string(),
  byName: z.string(),
  source: z.string(),
  meta: z.record(z.string(), z.unknown()).default({}),
});
export const AppointmentHistorySchema = z.object({ entries: z.array(AppointmentHistoryEntrySchema) });

/** The cancellation as a fact. */
export const CancellationSchema = z.object({
  at: z.iso.datetime(),
  by: CancelledBySchema,
  reason: z.string().nullable(),
});

/** Payment, derived from the invoice truth; refund, from the intent. */
export const PaymentSummarySchema = z.object({
  status: z.enum(['unpaid', 'venue', 'paid']),
  method: z.string().nullable(),
  amount: MoneySchema.nullable(),
});
export const RefundStatusSchema = z.enum(['pending', 'processing', 'refunded', 'failed']);
export const RefundSummarySchema = z.object({
  status: RefundStatusSchema,
  amount: MoneySchema,
  requestedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
});
export type PaymentSummary = z.infer<typeof PaymentSummarySchema>;
export type RefundSummary = z.infer<typeof RefundSummarySchema>;
export type AppointmentHistoryEntry = z.infer<typeof AppointmentHistoryEntrySchema>;

/** What a customer may do with an upcoming visit — decided by the
 *  server, so the app never re-derives the cancellation window. */
export const CancelBlockedReasonSchema = z.enum(['too_late', 'cancelled', 'started', 'requested']);
export const VisitRightsSchema = z.object({
  canReschedule: z.boolean(),
  canCancel: z.boolean(),
  /** The instant after which cancellation is no longer free — ISO. */
  cancelDeadline: z.iso.datetime().nullable(),
  cancelBlockedReason: CancelBlockedReasonSchema.nullable(),
});

/** The workspace's view of a visit's changes, alongside the appointment. */
export const AppointmentChangesSchema = z.object({
  changeRequest: ChangeRequestSchema.nullable(),
  cancellation: CancellationSchema.nullable(),
  cancelHours: z.number().int().nullable(),
  payment: PaymentSummarySchema,
  refund: RefundSummarySchema.nullable(),
  history: z.array(AppointmentHistoryEntrySchema),
});
export type AppointmentChanges = z.infer<typeof AppointmentChangesSchema>;
export type ChangeRequestRow = z.infer<typeof ChangeRequestRowSchema>;
