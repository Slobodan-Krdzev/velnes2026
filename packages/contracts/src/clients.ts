import { z } from 'zod';
import { AVATAR_MAX_CHARS } from './auth.js';
import { ClockSchema } from './scheduling.js';

/** Client users: the ordinary people who book through the consumer
 *  app. The platform's fourth principal — one account, one email, every
 *  salon. A client token carries `cli`, which no employee, HQ or
 *  supplier token has, and lacks `ten`/`sup`, which theirs require: the
 *  four shapes reject each other by construction. */
export const ClientClaimsSchema = z.object({
  cli: z.literal(true),
  sub: z.uuid(), // client_users.id
  email: z.email(),
});
export type ClientClaims = z.infer<typeof ClientClaimsSchema>;

export const CLIENT_CODE_LENGTH = 6;
const PasswordSchema = z.string().min(8).max(200);
const EmailSchema = z.email().max(200);

export const ClientRegisterSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  first: z.string().min(1).max(60),
  last: z.string().max(60).default(''),
  phone: z.string().max(40).default(''),
  // ISO date; the prototype's calendar step is optional.
  dob: z.iso.date().nullable().default(null),
  lang: z.enum(['en', 'mk', 'sq']).default('en'),
});

export const ClientVerifySchema = z.object({
  email: EmailSchema,
  code: z.string().length(CLIENT_CODE_LENGTH),
});
export const ClientResendSchema = z.object({ email: EmailSchema });
export const ClientLoginSchema = z.object({ email: EmailSchema, password: z.string().min(1) });

export const ClientProfileSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  emailVerified: z.boolean(),
  first: z.string(),
  last: z.string(),
  phone: z.string().nullable(),
  dob: z.iso.date().nullable(),
  lang: z.enum(['en', 'mk', 'sq']),
  avatar: z.string().nullable(),
  since: z.iso.date(),
});
export type ClientProfile = z.infer<typeof ClientProfileSchema>;

export const ClientSessionSchema = z.object({
  token: z.string(),
  profile: ClientProfileSchema,
});

/** Registration and resend answer the same way whether or not the
 *  address is already taken — the app must not become an email
 *  oracle. `pending` says a code is on its way, nothing more. */
export const ClientPendingSchema = z.object({ pending: z.literal(true) });

export const ClientProfilePatchSchema = z.object({
  first: z.string().min(1).max(60).optional(),
  last: z.string().max(60).optional(),
  phone: z.string().max(40).nullable().optional(),
  dob: z.iso.date().nullable().optional(),
  lang: z.enum(['en', 'mk', 'sq']).optional(),
  avatar: z.string().max(AVATAR_MAX_CHARS).nullable().optional(),
});

export const ClientPasswordSchema = z.object({
  current: z.string().min(1),
  next: PasswordSchema,
});

/** One appointment as the client sees it — across every salon they
 *  have visited, so the salon's name travels with it. */
export const ClientAppointmentSchema = z.object({
  id: z.uuid(),
  ref: z.string(),
  salonName: z.string(),
  salonSlug: z.string().nullable(),
  locationName: z.string(),
  locationAddress: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  serviceName: z.string(),
  employeeName: z.string().nullable(),
  date: z.iso.date(),
  time: ClockSchema,
  end: ClockSchema,
  durationMin: z.number().int(),
  price: z.number().int(),
  status: z.string(),
  /** Free cancellation window the salon set for that location. */
  cancelHours: z.number().int(),
});
export const ClientAppointmentsSchema = z.object({
  appointments: z.array(ClientAppointmentSchema),
});
export type ClientAppointment = z.infer<typeof ClientAppointmentSchema>;

export const ClientNotificationSchema = z.object({
  id: z.uuid(),
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  refType: z.string().nullable(),
  refId: z.string().nullable(),
  read: z.boolean(),
  at: z.string(),
});
export const ClientNotificationsSchema = z.object({
  notifications: z.array(ClientNotificationSchema),
  unread: z.number().int(),
});

/** The signed-in booking: same fields as the public one minus the
 *  guest identity, which the session already answers. */
export const ClientBookRequestSchema = z.object({
  key: z.string().min(8),
  slug: z.string().min(1),
  locationId: z.uuid(),
  serviceId: z.uuid(),
  date: z.iso.date(),
  time: ClockSchema,
  employeeId: z.union([z.uuid(), z.literal('any')]).default('any'),
  variantId: z.uuid().nullable().optional(),
  modifierOptionIds: z.array(z.uuid()).default([]),
});

/** The salons a client is a customer of — the bridge, from their side. */
export const ClientSalonLinkSchema = z.object({
  slug: z.string().nullable(),
  name: z.string(),
  visits: z.number().int(),
  since: z.iso.date(),
});
export const ClientSalonLinksSchema = z.object({ salons: z.array(ClientSalonLinkSchema) });
