import { z } from 'zod';
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
});
export type Employee = z.infer<typeof EmployeeSchema>;

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
});
export type EmployeePatch = z.infer<typeof EmployeePatchSchema>;
