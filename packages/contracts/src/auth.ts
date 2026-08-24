import { z } from 'zod';
import { EmployeeAccessSchema, PermMapSchema } from './permissions.js';

export const LoginRequestSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const SessionEmployeeSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  access: EmployeeAccessSchema,
  roleId: z.uuid().nullable(),
  locationIds: z.array(z.uuid()),
});
export type SessionEmployee = z.infer<typeof SessionEmployeeSchema>;

export const LoginResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  employee: SessionEmployeeSchema,
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const RefreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

export const RefreshResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});
export type RefreshResponse = z.infer<typeof RefreshResponseSchema>;

export const LogoutRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type LogoutRequest = z.infer<typeof LogoutRequestSchema>;

export const LangSchema = z.enum(['en', 'mk', 'sq']);
export type Lang = z.infer<typeof LangSchema>;

export const MeResponseSchema = SessionEmployeeSchema.extend({
  email: z.email(),
  tenantId: z.uuid(),
  lang: LangSchema,
  perms: PermMapSchema,
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const MePatchSchema = z.object({ lang: LangSchema });

/** Claims carried in the access JWT. */
export const AccessClaimsSchema = z.object({
  sub: z.uuid(), // employee id
  ten: z.uuid(), // tenant (business) id
  acc: EmployeeAccessSchema,
  rol: z.uuid().nullable(),
  locs: z.array(z.uuid()),
});
export type AccessClaims = z.infer<typeof AccessClaimsSchema>;
