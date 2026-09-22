import { z } from 'zod';

/**
 * The permission vocabulary, mirrored 1:1 from the prototype's
 * PERM_GROUPS/SCOPES (reference/prototype/index.html). One vocabulary
 * shared by API authorization and every app's UI gating.
 */

export const PERM_GROUPS = [
  {
    group: 'Appointments',
    perms: [
      ['appointments.view_own', 'See their own appointments'],
      ['appointments.view_location', 'See the location calendar'],
      ['appointments.create', 'Create appointments'],
      ['appointments.edit', 'Edit appointments'],
      ['appointments.cancel', 'Cancel appointments'],
    ],
  },
  {
    group: 'Customers',
    perms: [
      ['customers.view_assigned', 'See customers they serve'],
      ['customers.view_location', 'See customers of the location'],
      ['customers.view_business', 'See every customer of the business'],
      ['customers.edit', 'Edit customer details'],
      ['customers.export', 'Export customer data'],
    ],
  },
  {
    group: 'Till and payments',
    perms: [
      ['pos.checkout', 'Take payments'],
      ['pos.discount', 'Give discounts'],
      ['pos.refund', 'Refund a sale'],
      ['pos.view_invoices', 'See invoices'],
      ['cash_drawer.close', 'Close the cash drawer'],
      ['payments.manage', 'Manage payments and payouts'],
    ],
  },
  {
    group: 'Catalog and stock',
    perms: [
      ['catalog.view', 'See the catalog'],
      ['catalog.edit', 'Change services and products'],
      ['inventory.view', 'See stock levels'],
      ['inventory.adjust', 'Adjust stock'],
      ['inventory.transfer', 'Transfer stock between locations'],
      ['suppliers.manage', 'Connect and order from suppliers'],
    ],
  },
  {
    group: 'Marketing',
    perms: [['marketing.personal_offers', 'Create personal offers with special pricing']],
  },
  {
    group: 'Reports',
    perms: [
      ['reports.view_own', 'See their own figures'],
      ['reports.view_location', 'See location reports'],
      ['reports.view_business', 'See business-wide reports'],
    ],
  },
  {
    group: 'Administration',
    perms: [
      ['users.manage', 'Invite and manage users'],
      ['roles.manage', 'Create and change roles'],
      ['locations.manage', 'Create and change locations'],
      ['integrations.manage', 'Manage widgets, keys and integrations'],
      ['widget.manage', 'Manage the website booking widget'],
      ['ranking.manage', 'Set how employees are ranked'],
    ],
  },
] as const;

export const PERM_KEYS = PERM_GROUPS.flatMap((g) => g.perms.map((p) => p[0]));

export const PermKeySchema = z.enum(
  PERM_KEYS as [(typeof PERM_KEYS)[number], ...(typeof PERM_KEYS)[number][]],
);
export type PermKey = z.infer<typeof PermKeySchema>;

export const ScopeSchema = z.enum([
  'none',
  'own',
  'assigned',
  'location',
  'locations',
  'business',
  'platform',
]);
export type Scope = z.infer<typeof ScopeSchema>;

/** A role's permission map: known keys to scopes; missing = 'none'. */
export const PermMapSchema = z.partialRecord(PermKeySchema, ScopeSchema);
export type PermMap = z.infer<typeof PermMapSchema>;

/**
 * Which scopes make sense for a permission — the prototype's
 * scopeChoices(). "Own agenda" with scope "entire business" is
 * nonsense, so it is not offered (and not accepted).
 */
export function scopeChoices(key: PermKey): Scope[] {
  if (key.endsWith('view_own')) return ['none', 'own'];
  if (key === 'customers.view_assigned') return ['none', 'assigned'];
  if (key === 'customers.view_business' || key === 'reports.view_business')
    return ['none', 'business'];
  if (/^(users|roles|locations|payments|integrations|ranking)\./.test(key))
    return ['none', 'business'];
  return ['none', 'location', 'locations', 'business'];
}

export const RoleSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  std: z.boolean(),
  locked: z.boolean(),
  description: z.string(),
  perms: PermMapSchema,
});
export type Role = z.infer<typeof RoleSchema>;

export const EmployeeAccessSchema = z.enum(['owner', 'manager', 'staff', 'desk']);
export type EmployeeAccess = z.infer<typeof EmployeeAccessSchema>;

export const RoleListResponseSchema = z.object({ roles: z.array(RoleSchema) });

export const RoleWriteSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  perms: PermMapSchema,
});
export type RoleWrite = z.infer<typeof RoleWriteSchema>;

/**
 * The two standard roles every tenant is born with (Alex, 2026-09-22):
 * an Owner, and a basic Employee who books appointments and runs the
 * till at their own location — nothing else. Owners may add roles;
 * these two are the floor.
 */
export function ownerPermMap(): PermMap {
  return Object.fromEntries(PERM_KEYS.map((k) => [k, scopeChoices(k).at(-1) ?? 'none'])) as PermMap;
}

/** Every key spelled out, so a role never says "missing" where it means "none". */
export function fullPermMap(o: PermMap): PermMap {
  return Object.fromEntries(PERM_KEYS.map((k) => [k, o[k] ?? 'none'])) as PermMap;
}

export function employeePermMap(): PermMap {
  return fullPermMap({
    'appointments.view_own': 'own',
    'appointments.create': 'location',
    'appointments.edit': 'location',
    'appointments.cancel': 'location',
    'pos.checkout': 'location',
  });
}

export const STANDARD_ROLES = {
  owner: {
    name: 'Owner',
    locked: true,
    description: 'Everything, everywhere. The account itself.',
    perms: ownerPermMap,
  },
  employee: {
    name: 'Employee',
    locked: false,
    description: 'Books appointments and runs the till at their location. Nothing else.',
    perms: employeePermMap,
  },
} as const;
