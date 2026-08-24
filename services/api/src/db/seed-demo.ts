import argon2 from 'argon2';
import pg from 'pg';
import {
  PERM_KEYS,
  scopeChoices,
  type PermMap,
} from '@velnes/contracts';

/**
 * The demo world, mirroring the prototype's seed verbatim:
 * Velnes Fizio Centar with Centar + Aerodrom, the five employees,
 * the standard role kits + custom Bookkeeping role, the legal
 * entities (incl. Aroma Nordic's deliberately-pending one) and
 * payment accounts. Runs with the ADMIN database url (BYPASSRLS).
 */

export const DEMO_PASSWORD = 'velnes-demo';

// Stable ids so tests and docs can reference the world.
export const demo = {
  business: '10000000-0000-4000-8000-000000000001',
  locCentar: '20000000-0000-4000-8000-000000000001',
  locAerodrom: '20000000-0000-4000-8000-000000000002',
  roleOwner: '30000000-0000-4000-8000-000000000001',
  roleManager: '30000000-0000-4000-8000-000000000002',
  roleFrontdesk: '30000000-0000-4000-8000-000000000003',
  roleEmployee: '30000000-0000-4000-8000-000000000004',
  roleFinance: '30000000-0000-4000-8000-000000000005',
  empMaria: '40000000-0000-4000-8000-000000000001',
  empAna: '40000000-0000-4000-8000-000000000002',
  empElena: '40000000-0000-4000-8000-000000000003',
  empNikola: '40000000-0000-4000-8000-000000000004',
  empBojan: '40000000-0000-4000-8000-000000000005',
  leVelnes: '50000000-0000-4000-8000-000000000001',
  leBeautyPro: '50000000-0000-4000-8000-000000000002',
  leAroma: '50000000-0000-4000-8000-000000000003',
} as const;

const mkPerms = (o: PermMap): PermMap => {
  const r: PermMap = {};
  for (const k of PERM_KEYS) r[k] = o[k] ?? 'none';
  return r;
};

/** Owner: every permission at its widest legal scope. */
const ownerPerms = mkPerms(
  Object.fromEntries(PERM_KEYS.map((k) => [k, scopeChoices(k).at(-1) ?? 'none'])),
);

const managerPerms = mkPerms({
  'appointments.view_own': 'own',
  'appointments.view_location': 'locations',
  'appointments.create': 'locations',
  'appointments.edit': 'locations',
  'appointments.cancel': 'locations',
  'customers.view_assigned': 'assigned',
  'customers.view_location': 'locations',
  'customers.edit': 'locations',
  'pos.checkout': 'locations',
  'pos.discount': 'locations',
  'pos.refund': 'locations',
  'pos.view_invoices': 'locations',
  'cash_drawer.close': 'locations',
  'inventory.transfer': 'locations',
  'widget.manage': 'business',
  'catalog.view': 'locations',
  'catalog.edit': 'locations',
  'inventory.view': 'locations',
  'inventory.adjust': 'locations',
  'suppliers.manage': 'locations',
  'reports.view_own': 'own',
  'reports.view_location': 'locations',
  'ranking.manage': 'business',
  'marketing.personal_offers': 'locations',
});

const frontdeskPerms = mkPerms({
  'appointments.view_own': 'own',
  'appointments.view_location': 'location',
  'appointments.create': 'location',
  'appointments.edit': 'location',
  'appointments.cancel': 'location',
  'customers.view_assigned': 'assigned',
  'customers.view_location': 'location',
  'customers.edit': 'location',
  'pos.checkout': 'location',
  'pos.view_invoices': 'location',
  'cash_drawer.close': 'location',
  'catalog.view': 'location',
  'inventory.view': 'location',
});

const employeePerms = mkPerms({
  'appointments.view_own': 'own',
  'appointments.create': 'location',
  'appointments.edit': 'location',
  'pos.checkout': 'location',
  'reports.view_own': 'own',
});

const financePerms = mkPerms({
  'reports.view_location': 'business',
  'reports.view_business': 'business',
  'payments.manage': 'business',
  'customers.export': 'business',
  'inventory.view': 'business',
});

const stdHours = (satEnd = '15:00') => ({
  0: null,
  1: [['09:00', '20:00']],
  2: [['09:00', '20:00']],
  3: [['09:00', '20:00']],
  4: [['09:00', '20:00']],
  5: [['09:00', '20:00']],
  6: [['09:00', satEnd]],
});

const payments = { cash: true, card: true, online: true, rounding: false, tip: true };

export async function seedDemo(adminUrl: string) {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  const q = (text: string, values?: unknown[]) => client.query(text, values);
  try {
    await q('BEGIN');
    await q(`TRUNCATE audit_log, refresh_tokens, user_credentials, payment_accounts,
      legal_entity_locations, legal_entities, employee_locations,
      location_lifecycle_log, locations, employees, roles, businesses CASCADE`);

    await q(
      `INSERT INTO businesses (id, name, country, vat, plan, since, timing_enabled)
       VALUES ($1,'Velnes Fizio Centar','North Macedonia','MK4080012345678','Business','2026-02-14',true)`,
      [demo.business],
    );

    const roles: [string, string, boolean, boolean, string, PermMap][] = [
      [demo.roleOwner, 'Owner', true, true, 'Everything, everywhere. The account itself.', ownerPerms],
      [demo.roleManager, 'Manager', true, false,
        'Everything day to day at the locations they are assigned to. No ownership, no payouts.', managerPerms],
      [demo.roleFrontdesk, 'Front desk', true, false,
        'The whole calendar and the till at one location. No reports, no business settings.', frontdeskPerms],
      [demo.roleEmployee, 'Employee', true, false,
        'Their own day and the till. No catalog, no customer list, and no calendar of anyone else.', employeePerms],
      [demo.roleFinance, 'Bookkeeping', false, false,
        'Custom role. Reads the figures of every location, changes nothing in the calendar.', financePerms],
    ];
    for (const [id, name, std, locked, description, perms] of roles)
      await q(
        `INSERT INTO roles (id, tenant_id, name, std, locked, description, perms)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, demo.business, name, std, locked, description, JSON.stringify(perms)],
      );

    const emps: [string, string, string, string, string, string, string, boolean, string, boolean, string][] = [
      [demo.empMaria, 'Maria Petrovska', 'Physiotherapist', 'maria@velnes.mk', '+389 70 111 222', 'owner', demo.roleOwner, true, 'active', true, 'olive'],
      [demo.empAna, 'Ana Dimitrova', 'Rehab coach', 'ana@velnes.mk', '+389 70 222 333', 'staff', demo.roleEmployee, true, 'active', false, 'clay'],
      [demo.empElena, 'Elena Ristova', 'Sports physiotherapist', 'elena@velnes.mk', '+389 70 333 444', 'staff', demo.roleEmployee, true, 'active', false, 'rose'],
      [demo.empNikola, 'Nikola Trajkov', 'Front desk', 'nikola@velnes.mk', '+389 70 444 555', 'desk', demo.roleFrontdesk, false, 'invited', false, 'sage'],
      [demo.empBojan, 'Bojan Stojanov', 'Bookkeeper', 'bojan@velnes.mk', '+389 70 555 666', 'manager', demo.roleFinance, false, 'active', true, 'lilac'],
    ];
    for (const [id, name, title, email, phone, access, roleId, bookable, status, twofa, color] of emps)
      await q(
        `INSERT INTO employees (id, tenant_id, name, role_title, email, phone, access, role_id, bookable, status, twofa_enabled, color)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [id, demo.business, name, title, email, phone, access, roleId, bookable, status, twofa, color],
      );
    await q(`UPDATE businesses SET owner_employee_id=$1 WHERE id=$2`, [
      demo.empMaria,
      demo.business,
    ]);

    await q(
      `INSERT INTO locations (id, tenant_id, name, city, address, tz, phone, rooms, inv_prefix, online, cancel_hours, opened, hours, payments, lifecycle)
       VALUES
       ($1,$3,'Centar','Skopje','Macedonia Street 21','Europe/Skopje','+389 2 3112 940',3,'CEN-2026-',true,24,'2024-03-01',$4,$6,'ACTIVE'),
       ($2,$3,'Aerodrom','Skopje','Jane Sandanski 82','Europe/Skopje','+389 2 2455 118',2,'AER-2026-',true,24,'2025-09-15',$5,$6,'ACTIVE')`,
      [
        demo.locCentar,
        demo.locAerodrom,
        demo.business,
        JSON.stringify(stdHours()),
        JSON.stringify(stdHours()),
        JSON.stringify(payments),
      ],
    );

    // The prototype's EMP_LOCS mapping, verbatim.
    const empLocs: [string, string[]][] = [
      [demo.empMaria, [demo.locCentar, demo.locAerodrom]],
      [demo.empAna, [demo.locAerodrom]],
      [demo.empElena, [demo.locCentar]],
      [demo.empNikola, [demo.locCentar, demo.locAerodrom]],
      [demo.empBojan, [demo.locCentar, demo.locAerodrom]],
    ];
    for (const [empId, locIds] of empLocs)
      for (const locId of locIds)
        await q(
          `INSERT INTO employee_locations (tenant_id, employee_id, location_id) VALUES ($1,$2,$3)`,
          [demo.business, empId, locId],
        );

    // Legal entities. Aroma Nordic stays deliberately unfinished —
    // its pending state is load-bearing for HQ diagnostics later.
    await q(
      `INSERT INTO legal_entities (id, tenant_id, owner_type, is_default, name, tax_id, vat_reg, currency, status, fiscal_profile_id)
       VALUES
       ($1,$4,'salon',true,'Velnes Studio DOOEL Skopje','MK4030026512345','MK4030026512345','MKD','verified','fp-mk-1'),
       ($2,NULL,'supplier',true,'BeautyPro MK DOO Skopje','MK4030019876543','MK4030019876543','MKD','verified','fp-mk-1'),
       ($3,NULL,'supplier',true,'Aroma Nordic Direct AB','SE556677889901','','MKD','pending',NULL)`,
      [demo.leVelnes, demo.leBeautyPro, demo.leAroma, demo.business],
    );
    await q(
      `INSERT INTO legal_entity_locations (tenant_id, legal_entity_id, location_id)
       VALUES ($1,$2,$3),($1,$2,$4)`,
      [demo.business, demo.leVelnes, demo.locCentar, demo.locAerodrom],
    );
    await q(
      `INSERT INTO payment_accounts (tenant_id, legal_entity_id, provider, merchant_id, settlement_ref, status)
       VALUES
       ($1,$2,'CaSys (demo)','MID-88214-VS','MK07 2501 …2201','active'),
       (NULL,$3,'CaSys (demo)','MID-90417-BP','MK07 2501 …8842','active'),
       (NULL,$4,NULL,NULL,NULL,'incomplete')`,
      [demo.business, demo.leVelnes, demo.leBeautyPro, demo.leAroma],
    );

    const hash = await argon2.hash(DEMO_PASSWORD);
    for (const [id] of emps)
      await q(
        `INSERT INTO user_credentials (employee_id, tenant_id, password_hash) VALUES ($1,$2,$3)`,
        [id, demo.business, hash],
      );

    await q(
      `INSERT INTO audit_log (tenant_id, actor_name, role_name, business_name, location_name, action, object, before, after, source)
       VALUES ($1,'Maria Petrovska','Owner','Velnes Fizio Centar','—','Seed','Demo world','—','Seeded','Seeder')`,
      [demo.business],
    );

    await q('COMMIT');
  } catch (e) {
    await q('ROLLBACK');
    throw e;
  } finally {
    await client.end();
  }
}
