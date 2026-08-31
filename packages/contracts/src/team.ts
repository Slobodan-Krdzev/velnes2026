import { z } from 'zod';
import { WeekHoursSchema } from './locations.js';
import { EmployeeAccessSchema } from './permissions.js';

export const EmployeeSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  roleTitle: z.string(),
  email: z.email(),
  phone: z.string().nullable(),
  access: EmployeeAccessSchema,
  roleId: z.uuid().nullable(),
  bookable: z.boolean(),
  status: z.enum(['active', 'invited']),
  color: z.string().nullable(),
  locationIds: z.array(z.uuid()),
  skillServiceIds: z.array(z.uuid()),
  hours: WeekHoursSchema.nullable(),
  twofaEnabled: z.boolean(),
  // The last sign-in or token refresh — real session data, or never.
  lastActive: z.string().nullable(),
});
export type Employee = z.infer<typeof EmployeeSchema>;

/** Inviting a user — role and locations decide what they see. Until
 *  the invite is accepted (an SMTP-era feature) they can sign in
 *  nowhere: no credentials are created. */
export const EmployeeInviteSchema = z.object({
  name: z.string().min(1),
  email: z.email(),
  roleId: z.uuid(),
  locationIds: z.array(z.uuid()).min(1),
  twofa: z.boolean().default(true),
});

export const EmployeeListResponseSchema = z.object({
  employees: z.array(EmployeeSchema),
});

export const CustomerSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  group: z.string(),
  visits: z.number().int(),
  spend: z.number().int(),
  points: z.number().int(),
  blacklisted: z.boolean(),
  noShows: z.number().int(),
});
export type Customer = z.infer<typeof CustomerSchema>;

export const CustomerListQuerySchema = z.object({
  query: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const CustomerListResponseSchema = z.object({
  customers: z.array(CustomerSchema),
});

export const EmployeePatchSchema = z.object({
  bookable: z.boolean().optional(),
  color: z.string().nullable().optional(),
  access: EmployeeAccessSchema.optional(),
  roleId: z.uuid().nullable().optional(),
  roleTitle: z.string().optional(),
  // Weekly availability, weekday "0"(Mon)…"6"(Sun) → periods | null.
  hours: WeekHoursSchema.optional(),
  // Which services this person performs; empty = does everything.
  skillServiceIds: z.array(z.uuid()).optional(),
  // Where the role applies; replaces the whole assignment.
  locationIds: z.array(z.uuid()).optional(),
});
export type EmployeePatch = z.infer<typeof EmployeePatchSchema>;
