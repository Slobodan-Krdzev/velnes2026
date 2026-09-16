import { z } from 'zod';
import { EmployeeAccessSchema, PermMapSchema } from './permissions.js';

export const LoginRequestSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/** The phone's tap-your-name sign-in: the device holds the roster of
 *  ids from a prior session; the person supplies the password. */
export const LoginByIdRequestSchema = z.object({
  employeeId: z.uuid(),
  password: z.string().min(1),
});
export type LoginByIdRequest = z.infer<typeof LoginByIdRequestSchema>;

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
  // The role's display name — the preview bar shows it without
  // needing a roles listing the previewed user may not be allowed.
  roleName: z.string().nullable().default(null),
  // Whether RevelApps HQ has switched the AI Assistant on for this
  // salon. The workspace shows the launcher only when true; the server
  // also enforces it at every assistant endpoint.
  assistantEnabled: z.boolean().default(false),
  // The user's own avatar photo (data URL), shown in the workspace menu
  // and the client app. Null until they upload one.
  avatar: z.string().nullable().default(null),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

/** Avatar photos — data URLs, downscaled client-side, stored inline like
 *  the salon gallery until an asset host is decided. */
export const AVATAR_MAX_CHARS = 300_000;
export const AvatarSchema = z.string().min(1).max(AVATAR_MAX_CHARS);

/** A user updating their own profile: language and/or their avatar. */
export const MePatchSchema = z.object({
  lang: LangSchema.optional(),
  avatar: AvatarSchema.nullable().optional(), // null clears the photo
});

/** Preview access — the prototype's startPreview(): a user manager
 *  becomes another user for real. The server issues a genuine access
 *  token for the target; roles, scopes and data all follow. */
export const PreviewRequestSchema = z.object({
  employeeId: z.uuid(),
  // A silent token renewal mid-preview; the start is what gets audited.
  renew: z.boolean().optional(),
});
export type PreviewRequest = z.infer<typeof PreviewRequestSchema>;

export const PreviewResponseSchema = z.object({
  accessToken: z.string(),
  employee: MeResponseSchema,
});
export type PreviewResponse = z.infer<typeof PreviewResponseSchema>;

/** Claims carried in the access JWT. */
export const AccessClaimsSchema = z.object({
  sub: z.uuid(), // employee id
  ten: z.uuid(), // tenant (business) id
  acc: EmployeeAccessSchema,
  rol: z.uuid().nullable(),
  locs: z.array(z.uuid()),
});
export type AccessClaims = z.infer<typeof AccessClaimsSchema>;
