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
  hqIvana: 'c0000000-0000-4000-8000-000000000001',
  hqDamjan: 'c0000000-0000-4000-8000-000000000002',
  hqTea: 'c0000000-0000-4000-8000-000000000003',
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
  // Services s1..s8 (prototype ids), variants and products keep
  // recognizable stable uuids too.
  s1: '60000000-0000-4000-8000-000000000001',
  s2: '60000000-0000-4000-8000-000000000002',
  s3: '60000000-0000-4000-8000-000000000003',
  s4: '60000000-0000-4000-8000-000000000004',
  s5: '60000000-0000-4000-8000-000000000005',
  s6: '60000000-0000-4000-8000-000000000006',
  s7: '60000000-0000-4000-8000-000000000007',
  s8: '60000000-0000-4000-8000-000000000008',
  p1: '70000000-0000-4000-8000-000000000001',
  p2: '70000000-0000-4000-8000-000000000002',
  p3: '70000000-0000-4000-8000-000000000003',
  p4: '70000000-0000-4000-8000-000000000004',
  p5: '70000000-0000-4000-8000-000000000005',
  p6: '70000000-0000-4000-8000-000000000006',
  p7: '70000000-0000-4000-8000-000000000007',
  o1: '70000000-0000-4000-8000-000000000011',
  o2: '70000000-0000-4000-8000-000000000012',
  o3: '70000000-0000-4000-8000-000000000013',
  c1: '80000000-0000-4000-8000-000000000001',
  c2: '80000000-0000-4000-8000-000000000002',
  c3: '80000000-0000-4000-8000-000000000003',
  c4: '80000000-0000-4000-8000-000000000004',
  c5: '80000000-0000-4000-8000-000000000005',
  c6: '80000000-0000-4000-8000-000000000006',
  et1: '90000000-0000-4000-8000-000000000001',
  et2: '90000000-0000-4000-8000-000000000002',
  et3: '90000000-0000-4000-8000-000000000003',
  p8: '70000000-0000-4000-8000-000000000008',
  p9: '70000000-0000-4000-8000-000000000009',
  sup1: 'd1000000-0000-4000-8000-000000000001',
  sup2: 'd1000000-0000-4000-8000-000000000002',
  sup3: 'd1000000-0000-4000-8000-000000000003',
  sup4: 'd1000000-0000-4000-8000-000000000004',
  supUserVesna: 'd3000000-0000-4000-8000-000000000001',
  supUserGoran: 'd3000000-0000-4000-8000-000000000002',
  po1: 'd4000000-0000-4000-8000-000000000001',
  po2: 'd4000000-0000-4000-8000-000000000002',
  po3: 'd4000000-0000-4000-8000-000000000003',
  po4: 'd4000000-0000-4000-8000-000000000004',
  gift1: 'a0000000-0000-4000-8000-000000000001',
  gift2: 'a0000000-0000-4000-8000-000000000002',
  gift3: 'a0000000-0000-4000-8000-000000000003',
} as const;

const vid = (svc: number, n: number) =>
  `61000000-0000-4000-8000-00000000${String(svc).padStart(2, '0')}0${n}`;
const gid = (n: number) => `62000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const oid = (n: number) => `63000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

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

/** Weekly hours, prototype shape: 0=Monday … 6=Sunday(null=off). */
const stdHours = (satEnd = '15:00'): Record<string, [string, string][] | null> => ({
  0: [['09:00', '19:00']],
  1: [['09:00', '19:00']],
  2: [['09:00', '19:00']],
  3: [['09:00', '19:00']],
  4: [['09:00', '19:00']],
  5: [['09:00', satEnd]],
  6: null,
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
      integration_events, widgets, registrations, hq_users,
      customer_activity, personal_offers, last_minute_offers, member_recs, premium_offers,
      purchase_order_lines, purchase_orders, supplier_connections, supplier_promotions,
      supplier_users, supplier_products, suppliers,
      tax_rules, service_recipes, loyalty_ledger, loyalty_config,
      discount_codes, gift_cards, checkout_items, merchant_transactions,
      checkouts, invoice_lines, invoices, invoice_counters,
      emp_timings, holds, appointment_history, appointments, customers,
      schedule_exceptions, holidays, holiday_calendar_years,
      stock_movements, location_catalog_products, products, product_categories,
      employee_skills, location_catalog_variants, location_catalog_services,
      service_modifier_options, service_modifier_groups, service_variants,
      services, service_categories,
      location_lifecycle_log, locations, employees, roles, businesses CASCADE`);

    await q(
      `INSERT INTO businesses (id, name, country, vat, plan, since, timing_enabled, slug)
       VALUES ($1,'Velnes Fizio Centar','North Macedonia','MK4080012345678','Business','2026-02-14',true,'velnes-fizio')`,
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

    // Hours per the prototype: Ana is off Mondays, Elena off Tuesdays
    // and works to 17:00.
    const empHours: Record<string, Record<string, [string, string][] | null>> = {
      [demo.empMaria]: stdHours(),
      [demo.empAna]: { ...stdHours(), 0: null },
      [demo.empElena]: { ...stdHours('17:00'), 1: null },
      [demo.empNikola]: stdHours(),
      [demo.empBojan]: stdHours(),
    };
    const emps: [string, string, string, string, string, string, string, boolean, string, boolean, string][] = [
      [demo.empMaria, 'Maria Petrovska', 'Physiotherapist', 'maria@velnes.mk', '+389 70 111 222', 'owner', demo.roleOwner, true, 'active', true, 'olive'],
      [demo.empAna, 'Ana Dimitrova', 'Rehab coach', 'ana@velnes.mk', '+389 70 222 333', 'staff', demo.roleEmployee, true, 'active', false, 'clay'],
      [demo.empElena, 'Elena Ristova', 'Sports physiotherapist', 'elena@velnes.mk', '+389 70 333 444', 'staff', demo.roleEmployee, true, 'active', false, 'rose'],
      [demo.empNikola, 'Nikola Trajkov', 'Front desk', 'nikola@velnes.mk', '+389 70 444 555', 'desk', demo.roleFrontdesk, false, 'invited', false, 'sage'],
      [demo.empBojan, 'Bojan Stojanov', 'Bookkeeper', 'bojan@velnes.mk', '+389 70 555 666', 'manager', demo.roleFinance, false, 'active', true, 'lilac'],
    ];
    for (const [id, name, title, email, phone, access, roleId, bookable, status, twofa, color] of emps)
      await q(
        `INSERT INTO employees (id, tenant_id, name, role_title, email, phone, access, role_id, bookable, status, twofa_enabled, color, hours)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [id, demo.business, name, title, email, phone, access, roleId, bookable, status, twofa, color, JSON.stringify(empHours[id])],
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

    // ── Catalog: the prototype's services verbatim ────────────────
    const svcCats = ['Assessment', 'Manual therapy', 'Rehab', 'Recovery'];
    const svcCatId: Record<string, string> = {};
    for (const [i, name] of svcCats.entries()) {
      const r = await q(
        `INSERT INTO service_categories (tenant_id, name, sort) VALUES ($1,$2,$3) RETURNING id`,
        [demo.business, name, i],
      );
      svcCatId[name] = r.rows[0].id;
    }

    // [id, name, cat, min, price, prep, reset]
    const svcRows: [string, string, string, number, number, number | null, number | null][] = [
      [demo.s1, 'Physiotherapy session', 'Manual therapy', 45, 1800, 10, 10],
      [demo.s2, 'Manual therapy, spine', 'Manual therapy', 60, 2400, null, null],
      [demo.s3, 'Follow-up session', 'Manual therapy', 30, 1200, null, null],
      [demo.s4, 'Rehab training', 'Rehab', 60, 1500, null, null],
      [demo.s5, 'Medical taping', 'Recovery', 30, 900, null, null],
      [demo.s6, 'Sports injury assessment', 'Assessment', 50, 2200, null, null],
      [demo.s7, 'Posture screening', 'Assessment', 30, 1200, null, null],
      [demo.s8, 'Sports massage', 'Recovery', 45, 1900, 5, 15],
    ];
    for (const [i, [id, name, cat, min, price, prep, reset]] of svcRows.entries())
      await q(
        `INSERT INTO services (id, tenant_id, name, category_id, duration_min, price, vat, status, pos, online, prep_min, reset_min, sort)
         VALUES ($1,$2,$3,$4,$5,$6,18,'active',true,true,$7,$8,$9)`,
        [id, demo.business, name, svcCatId[cat], min, price, prep, reset, i],
      );

    // Variants (s2, s6, s8) — SERVICE_VARIANTS verbatim.
    const variantRows: [string, string, string, number, number, boolean][] = [
      [vid(8, 1), demo.s8, '45 minutes', 45, 1900, true],
      [vid(8, 2), demo.s8, '60 minutes', 60, 2400, false],
      [vid(8, 3), demo.s8, '90 minutes', 90, 3300, false],
      [vid(2, 1), demo.s2, 'One region', 45, 1900, false],
      [vid(2, 2), demo.s2, 'Two regions', 60, 2400, true],
      [vid(2, 3), demo.s2, 'Full spine', 90, 3300, false],
      [vid(6, 1), demo.s6, 'Screening, 30 min', 30, 1400, false],
      [vid(6, 2), demo.s6, 'Full assessment, 50 min', 50, 2200, true],
      [vid(6, 3), demo.s6, 'With written report, 80 min', 80, 3200, false],
    ];
    for (const [i, [id, sid, label, min, price, std]] of variantRows.entries())
      await q(
        `INSERT INTO service_variants (id, tenant_id, service_id, label, duration_min, price, std, sort)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, demo.business, sid, label, min, price, std, i % 3],
      );

    // Modifier groups + options — SERVICE_MODIFIERS verbatim.
    const groups: [string, string, string, 'single' | 'multi', boolean][] = [
      [gid(1), demo.s1, 'Focus', 'single', false],
      [gid(2), demo.s1, 'Add on', 'multi', false],
      [gid(3), demo.s2, 'Report', 'single', false],
      [gid(4), demo.s2, 'Add on', 'multi', false],
      [gid(5), demo.s4, 'Format', 'single', true],
      [gid(6), demo.s4, 'Add on', 'multi', false],
      [gid(7), demo.s6, 'Add on', 'multi', false],
      [gid(8), demo.s8, 'Oil', 'single', false],
      [gid(9), demo.s8, 'Add on', 'multi', false],
    ];
    for (const [i, [id, sid, name, type, required]] of groups.entries())
      await q(
        `INSERT INTO service_modifier_groups (id, tenant_id, service_id, name, type, required, sort)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, demo.business, sid, name, type, required, i],
      );
    const options: [string, string, string, number, number][] = [
      [oid(1), gid(1), 'Lower back', 0, 0],
      [oid(2), gid(1), 'Neck and shoulder', 0, 0],
      [oid(3), gid(1), 'Knee or ankle', 0, 0],
      [oid(4), gid(2), 'Medical taping', 700, 10],
      [oid(5), gid(2), 'Ultrasound therapy', 500, 10],
      [oid(6), gid(3), 'No report', 0, 0],
      [oid(7), gid(3), 'Report for your doctor', 600, 15],
      [oid(8), gid(4), 'Dry needling', 800, 10],
      [oid(9), gid(4), 'Cupping', 600, 10],
      [oid(10), gid(5), 'One to one', 0, 0],
      [oid(11), gid(5), 'Small group, up to four', -600, 0],
      [oid(12), gid(6), 'Home exercise programme', 400, 10],
      [oid(13), gid(6), 'Progress measurement', 500, 10],
      [oid(14), gid(6), 'Extra fifteen minutes', 500, 15],
      [oid(15), gid(7), 'Movement video analysis', 900, 15],
      [oid(16), gid(7), 'Written treatment plan', 700, 10],
      [oid(17), gid(8), 'Neutral oil', 0, 0],
      [oid(18), gid(8), 'Arnica blend', 300, 0],
      [oid(19), gid(9), 'Cupping', 700, 15],
    ];
    for (const [i, [id, g, name, price, min]] of options.entries())
      await q(
        `INSERT INTO service_modifier_options (id, tenant_id, group_id, name, price, duration_min, sort)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, demo.business, g, name, price, min, i],
      );

    // Per-location catalog rows (seedLocationCatalog: both open).
    for (const loc of [demo.locCentar, demo.locAerodrom])
      for (const [id, , , min, price] of svcRows)
        await q(
          `INSERT INTO location_catalog_services (tenant_id, location_id, service_id, active, price, duration_min, online, pos)
           VALUES ($1,$2,$3,true,$4,$5,true,true)`,
          [demo.business, loc, id, price, min],
        );

    // Employee skills — the prototype's skills arrays.
    const skills: [string, string[]][] = [
      [demo.empMaria, [demo.s1, demo.s2, demo.s3, demo.s4]],
      [demo.empAna, [demo.s1, demo.s4, demo.s5]],
      [demo.empElena, [demo.s6, demo.s7, demo.s4, demo.s5, demo.s8]],
    ];
    for (const [emp, sids] of skills)
      for (const sid of sids)
        await q(
          `INSERT INTO employee_skills (tenant_id, employee_id, service_id) VALUES ($1,$2,$3)`,
          [demo.business, emp, sid],
        );

    // ── Products & stock ─────────────────────────────────────────
    const prodCats = ['Home exercise', 'Recovery aids', 'Supports', 'Own use'];
    const prodCatId: Record<string, string> = {};
    for (const [i, name] of prodCats.entries()) {
      const r = await q(
        `INSERT INTO product_categories (tenant_id, name, sort) VALUES ($1,$2,$3) RETURNING id`,
        [demo.business, name, i],
      );
      prodCatId[name] = r.rows[0].id;
    }
    // [id, name, cat, sku, stock@Centar, price, active, own, cost, size, unit, seller]
    const prodRows: [string, string, string, string, number, number, boolean, boolean, number | null, number | null, string | null, string | null][] = [
      [demo.p1, 'Resistance band set', 'Home exercise', 'VEL-BND-SET', 22, 1200, true, false, null, null, null, null],
      [demo.p2, 'Massage oil, arnica 200 ml', 'Recovery aids', 'VEL-OIL-200', 9, 850, true, false, null, null, null, demo.leBeautyPro],
      [demo.p3, 'Kinesiology tape roll', 'Recovery aids', 'VEL-TAPE-5M', 41, 550, true, false, null, null, null, null],
      [demo.p4, 'Trigger point ball', 'Home exercise', 'VEL-TPB-06', 3, 700, true, false, null, null, null, null],
      [demo.p5, 'Cold pack, reusable', 'Recovery aids', 'VEL-CLD-01', 17, 900, true, false, null, null, null, null],
      [demo.p6, 'Posture support brace', 'Supports', 'VEL-BRC-M', 0, 2400, false, false, null, null, null, null],
      [demo.p7, 'Foam roller 45 cm', 'Home exercise', 'VEL-FRL-45', 12, 1800, true, false, null, null, null, null],
      [demo.o1, 'Massage oil, neutral 1 l', 'Own use', 'VEL-OIL-1L', 6, 0, true, true, 900, 1000, 'ml', null],
      [demo.o2, 'Arnica massage oil 500 ml', 'Own use', 'VEL-ARN-500', 3, 0, true, true, 1150, 500, 'ml', null],
      [demo.o3, 'Ultrasound gel 5 l', 'Own use', 'VEL-GEL-5L', 2, 0, true, true, 640, 5000, 'ml', null],
      [demo.p8, 'Couch roll 50 cm', 'Own use', 'VEL-CCH-50', 14, 0, true, true, 510, 50, 'm', null],
      [demo.p9, 'Nitrile gloves M — 100 pcs', 'Own use', 'VEL-GLV-M', 6, 0, true, true, 790, 100, 'pcs', null],
    ];
    for (const [id, name, cat, sku, , price, active, own, cost, size, unit, seller] of prodRows)
      await q(
        `INSERT INTO products (id, tenant_id, name, category_id, sku, price, cost, vat, active, own, use, size_amount, size_unit, seller_legal_entity_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,18,$8,$9,$10,$11,$12,$13)`,
        [id, demo.business, name, prodCatId[cat], sku, price, cost, active, own, own ? 'pro' : null, size, unit, seller],
      );
    for (const loc of [demo.locCentar, demo.locAerodrom])
      for (const [id, , , , , price, active, own] of prodRows)
        await q(
          `INSERT INTO location_catalog_products (tenant_id, location_id, product_id, active, price, low_stock, pos, stock)
           VALUES ($1,$2,$3,$4,$5,2,$6,0)`,
          [demo.business, loc, id, active, price, own ? false : active],
        );
    // Opening stock at Centar through real ledger movements.
    for (const [id, , , , stock] of prodRows)
      if (stock > 0) {
        await q(
          `INSERT INTO stock_movements (tenant_id, location_id, product_id, qty, kind, note, actor_employee_id)
           VALUES ($1,$2,$3,$4,'adjustment','Opening stock',$5)`,
          [demo.business, demo.locCentar, id, stock, demo.empMaria],
        );
        await q(
          `UPDATE location_catalog_products SET stock=$1 WHERE location_id=$2 AND product_id=$3`,
          [stock, demo.locCentar, id],
        );
      }

    // ── Customers (minimal profile; Phase 9 adds intelligence) ────
    const custRows: [string, string, string, string, string, string, number, number, number, number, boolean, number, string | null][] = [
      [demo.c1, 'Katerina Stojanovska', 'katerina.s@example.com', '+389 70 221 884', 'Regulars', '2022-03-14', 38, 98500, 320, 2700, false, 0, 'Prefers Maria. Recovering from a hamstring tear, left leg.'],
      [demo.c2, 'Ivana Nikolikj', 'ivana.n@example.com', '+389 71 448 209', 'Regulars', '2023-01-08', 21, 53650, 140, 0, false, 0, null],
      [demo.c3, 'Bojan Ilievski', 'bojan.i@example.com', '+389 75 903 117', 'New', '2025-11-02', 2, 4200, 10, 0, true, 3, null],
      [demo.c4, 'Marija Angelovska', 'marija.a@example.com', '+389 78 552 640', 'VIP', '2020-06-21', 96, 318600, 980, 7200, false, 0, 'Always books the last slot of the day.'],
      [demo.c5, 'Stefan Georgiev', 'stefan.g@example.com', '+389 70 118 776', 'Regulars', '2024-04-30', 12, 23300, 60, 0, false, 0, null],
      [demo.c6, 'Elena Todorova', 'elena.t@example.com', '+389 72 664 301', 'New', '2026-01-19', 1, 1700, 5, 0, false, 0, null],
    ];
    for (const [id, name, email, phone, grp, since, visits, spend, points, prepaid, bl, ns, note] of custRows)
      await q(
        `INSERT INTO customers (id, tenant_id, name, email, phone, cust_group, since, visits, spend, points, prepaid, blacklisted, no_shows, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [id, demo.business, name, email, phone, grp, since, visits, spend, points, prepaid, bl, ns, note],
      );

    // Velnes Premium is a PLATFORM membership, mirrored read-only:
    // two active members and one expired so the lifecycle shows
    // honestly (prototype seeding, verbatim).
    const day = (n: number) => {
      const d = new Date();
      d.setDate(d.getDate() + n);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const prem: [string, string, number, number][] = [
      [demo.c4, 'active', -260, 20],
      [demo.c1, 'active', -120, 8],
      [demo.c6, 'expired', -400, -35],
    ];
    for (const [id, status, since, renews] of prem)
      await q(`UPDATE customers SET premium=$2 WHERE id=$1`, [
        id,
        JSON.stringify({ status, since: day(since), renews: day(renews) }),
      ]);
    // Birthdays: Marija soon (feeds the suggestion), Katerina far off.
    await q(`UPDATE customers SET birthday=$2 WHERE id=$1`, [demo.c4, `1988${day(9).slice(4)}`]);
    await q(`UPDATE customers SET birthday=$2 WHERE id=$1`, [demo.c1, `1990${day(120).slice(4)}`]);

    // ── Holiday calendar (MK, from the prototype, verbatim) ───────
    await q(
      `INSERT INTO holiday_calendar_years (country_code, country_name, year, verified, source) VALUES
       ('MK','North Macedonia',2026,true,'Official 2026 calendar'),
       ('MK','North Macedonia',2027,false,'Provisional — Bajram not yet confirmed')`,
    );
    const mk: [string, string, string, string, string | null][] = [
      ['2026-01-01', "New Year's Day", 'PUBLIC_HOLIDAY', 'Everyone', null],
      ['2026-01-07', 'Orthodox Christmas', 'RELIGIOUS', 'Everyone', null],
      ['2026-03-20', 'Ramazan Bajram (Eid al-Fitr)', 'RELIGIOUS', 'Everyone', null],
      ['2026-04-10', 'Good Friday', 'RELIGIOUS', 'Orthodox Christians', null],
      ['2026-04-13', 'Orthodox Easter Monday', 'RELIGIOUS', 'Everyone', null],
      ['2026-05-01', 'Labour Day', 'PUBLIC_HOLIDAY', 'Everyone', null],
      ['2026-05-25', 'Saints Cyril and Methodius Day', 'PUBLIC_HOLIDAY', 'Everyone', '2026-05-24'],
      ['2026-08-03', 'Republic Day', 'PUBLIC_HOLIDAY', 'Everyone', '2026-08-02'],
      ['2026-09-08', 'Independence Day', 'PUBLIC_HOLIDAY', 'Everyone', null],
      ['2026-10-12', 'Revolution Day', 'PUBLIC_HOLIDAY', 'Everyone', '2026-10-11'],
      ['2026-10-23', 'Day of the Macedonian Revolutionary Struggle', 'PUBLIC_HOLIDAY', 'Everyone', null],
      ['2026-12-08', 'Saint Clement of Ohrid Day', 'RELIGIOUS', 'Everyone', null],
      ['2027-01-01', "New Year's Day", 'PUBLIC_HOLIDAY', 'Everyone', null],
      ['2027-01-07', 'Orthodox Christmas', 'RELIGIOUS', 'Everyone', null],
      ['2027-04-30', 'Good Friday', 'RELIGIOUS', 'Orthodox Christians', null],
      ['2027-05-03', 'Orthodox Easter Monday', 'RELIGIOUS', 'Everyone', null],
      ['2027-05-24', 'Saints Cyril and Methodius Day', 'PUBLIC_HOLIDAY', 'Everyone', null],
      ['2027-08-02', 'Republic Day', 'PUBLIC_HOLIDAY', 'Everyone', null],
      ['2027-09-08', 'Independence Day', 'PUBLIC_HOLIDAY', 'Everyone', null],
      ['2027-10-11', 'Revolution Day', 'PUBLIC_HOLIDAY', 'Everyone', null],
      ['2027-10-25', 'Day of the Macedonian Revolutionary Struggle', 'PUBLIC_HOLIDAY', 'Everyone', '2027-10-23'],
      ['2027-12-08', 'Saint Clement of Ohrid Day', 'RELIGIOUS', 'Everyone', null],
    ];
    for (const [date, name, type, applies, moved] of mk)
      await q(
        `INSERT INTO holidays (id, country_code, year, date, name, type, applies, moved_from)
         VALUES ($1,'MK',$2,$3,$4,$5,$6,$7)`,
        [`mk-${date}`, Number(date.slice(0, 4)), date, name, type, applies, moved],
      );

    // ── Demo appointments this week (weekday slots that satisfy the
    //    booking gate: Wednesday + Thursday, morning) ───────────────
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const isoAt = (offset: number) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + offset);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const appts: [string, string, number, number, string, string, string, string, number][] = [
      // [date, locId, startMin, durMin, serviceId, empId, custId, title, price]
      [isoAt(2), demo.locCentar, 540, 60, demo.s4, demo.empMaria, demo.c1, 'Katerina Stojanovska', 1500],
      [isoAt(2), demo.locCentar, 660, 45, demo.s1, demo.empMaria, demo.c2, 'Ivana Nikolikj', 1800],
      [isoAt(3), demo.locCentar, 600, 50, demo.s6, demo.empElena, demo.c5, 'Stefan Georgiev', 2200],
    ];
    for (const [date, locId, start, dur, sid, emp, cust, title, price] of appts) {
      const r = await q(
        `INSERT INTO appointments (tenant_id, location_id, date, start_min, duration_min, prep_min, reset_min, kind, status, title, service_id, employee_id, customer_id, price, quoted, source)
         VALUES ($1,$2,$3,$4,$5,0,10,'appointment','confirmed',$6,$7,$8,$9,$10,$11,'staff') RETURNING id`,
        [demo.business, locId, date, start, dur, title, sid, emp, cust, price,
          JSON.stringify({ treatmentMin: dur, prepMin: 0, resetMin: 10, basis: 'catalog' })],
      );
      await q(
        `INSERT INTO appointment_history (tenant_id, appointment_id, what, by_name, source)
         VALUES ($1,$2,'Created','Nikola Trajkov','staff')`,
        [demo.business, r.rows[0].id],
      );
    }

    // ── Timing records — the prototype's et1/et2/et3 showcase ─────
    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const daysAgo = (n: number) => {
      const d = new Date(today);
      d.setDate(d.getDate() - n);
      return iso(d);
    };
    const timings: [string, string, string, number, number, string, number, string, number | null, string | null, string | null][] = [
      // [id, empId, sid, observedN, median, pace, recommended, status, approvedMin, approvedBy, approvedAt]
      [demo.et1, demo.empMaria, demo.s1, 18, 51, '1.13', 50, 'suggested', null, null, null],
      [demo.et2, demo.empElena, demo.s8, 22, 40, '0.89', 40, 'approved', 40, 'Elena Petrova', daysAgo(30)],
      [demo.et3, demo.empAna, demo.s4, 26, 49, '0.82', 50, 'suggested', 60, 'Elena Petrova', daysAgo(186)],
    ];
    for (const [id, emp, sid, n, med, pace, rec, status, appr, apprBy, apprAt] of timings)
      await q(
        `INSERT INTO emp_timings (id, tenant_id, employee_id, service_id, variant_id, location_id,
           observed_n, observed_median_min, pace_factor, window_from, window_to, computed_at,
           recommended_min, status, approved_min, approved_by, approved_at, source)
         VALUES ($1,$2,$3,$4,NULL,NULL,$5,$6,$7,$8,$9,$9,$10,$11,$12,$13,$14,'observed')`,
        [id, demo.business, emp, sid, n, med, pace, daysAgo(96), iso(today), rec, status, appr, apprBy, apprAt],
      );

    // ── Till world: gift cards, promo codes, loyalty, recipes ─────
    await q(
      `INSERT INTO gift_cards (id, tenant_id, code, value, remaining, customer_id) VALUES
       ($1,$4,'VEL-8841-2290',100,22,$5),
       ($2,$4,'VEL-3317-9042',50,50,NULL),
       ($3,$4,'VEL-6620-1185',75,0,$6)`,
      [demo.gift1, demo.gift2, demo.gift3, demo.business, demo.c4, demo.c1],
    );
    await q(
      `INSERT INTO discount_codes (tenant_id, code, type, value, used, usage_limit, starts, ends) VALUES
       ($1,'SUMMER26','Percentage',15,48,200,'2026-07-01','2026-08-31'),
       ($1,'WELCOME10','Fixed amount',10,132,500,'2026-01-01','2026-12-31'),
       ($1,'AUTUMN20','Percentage',20,0,150,'2026-09-15','2026-10-15'),
       ($1,'SPRING26','Percentage',10,187,200,'2026-03-01','2026-05-31')`,
      [demo.business],
    );
    await q(
      `INSERT INTO loyalty_config (tenant_id, active, earn_per, points, step, worth, expiry_months, welcome, birthday)
       VALUES ($1,true,60,1,100,300,24,25,50)`,
      [demo.business],
    );
    // Opening balances reconcile the seeded customer point totals:
    // the ledger explains every number, from day one.
    for (const [id, , , , , , , , points] of custRows)
      if (points > 0)
        await q(
          `INSERT INTO loyalty_ledger (tenant_id, customer_id, at, reason, points, ref)
           VALUES ($1,$2,now(),'Opening balance',$3,'—')`,
          [demo.business, id, points],
        );
    // Recipes — what one treatment takes from the own-use shelf.
    const recipeRows: [string, string, number][] = [
      [demo.s1, demo.o1, 12],
      [demo.s1, demo.p9, 2],
      [demo.s1, demo.p8, 1.4],
      [demo.s2, demo.o1, 18],
      [demo.s2, demo.o3, 60],
      [demo.s2, demo.p9, 2],
      [demo.s2, demo.p8, 1.4],
      [demo.s4, demo.p8, 1.4],
      [demo.s6, demo.p8, 1.4],
      [demo.s8, demo.o2, 25],
      [demo.s8, demo.p8, 1.4],
    ];
    for (const [sid, pid, qty] of recipeRows)
      await q(
        `INSERT INTO service_recipes (tenant_id, service_id, product_id, qty_amount) VALUES ($1,$2,$3,$4)`,
        [demo.business, sid, pid, qty],
      );
    // Historical invoices (prototype i1–i4, booked at Centar).
    const invRows: [string, string, string, string, string, string, [string, number, number][]][] = [
      ['CEN-2026-0412', '2026-08-04', 'Katerina Stojanovska', 'Maria Petrovska', 'Card', 'Paid', [['Rehab training', 1, 1700], ['Cuticle oil pen', 1, 510]]],
      ['CEN-2026-0411', '2026-08-04', 'Marija Angelovska', 'Maria Petrovska', 'Gift card', 'Paid', [['Manual therapy, spine', 1, 4700]]],
      ['CEN-2026-0410', '2026-08-03', 'Stefan Georgiev', 'Elena Ristova', 'Cash', 'Paid', [['Sports injury assessment', 1, 2700], ['Hydrating mask', 2, 1750]]],
      ['CEN-2026-0409', '2026-08-03', 'Ivana Nikolikj', 'Ana Dimitrova', 'Card', 'Refunded', [['Medical taping', 1, 900]]],
    ];
    for (const [number, date, cust, emp, method, status, lns] of invRows) {
      const total = lns.reduce((s, [, qy, u]) => s + qy * u, 0);
      const inv = await q(
        `INSERT INTO invoices (tenant_id, location_id, number, date, customer_name, employee_name, method, status, total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [demo.business, demo.locCentar, number, date, cust, emp, method, status, total],
      );
      for (const [i, [d, qy, u]] of lns.entries())
        await q(
          `INSERT INTO invoice_lines (tenant_id, invoice_id, description, qty, unit_price, item_class, sort)
           VALUES ($1,$2,$3,$4,$5,'other',$6)`,
          [demo.business, inv.rows[0].id, d, qy, u, i],
        );
    }
    await q(
      `INSERT INTO invoice_counters (tenant_id, location_id, next) VALUES ($1,$2,413)`,
      [demo.business, demo.locCentar],
    );

    // The prototype's main widget, live on the salon site.
    await q(
      `INSERT INTO widgets (id, tenant_id, name, location_ids, categories, lang, theme, accent, radius, start_step, deposit, status, domains, publishable_key)
       VALUES ('b0000000-0000-4000-8000-000000000001',$1,'Main site — all locations',$2,'{all}','en','light','#6f7357','12','location','none','live','{velnesstudio.mk}','pk_live_velnes_demo')`,
      [demo.business, '{' + demo.locCentar + ',' + demo.locAerodrom + '}'],
    );

    const hash = await argon2.hash(DEMO_PASSWORD);
    for (const [id] of emps)
      await q(
        `INSERT INTO user_credentials (employee_id, tenant_id, password_hash) VALUES ($1,$2,$3)`,
        [id, demo.business, hash],
      );

    // ── The supplier chain (prototype seed, verbatim shapes) ──────
    const spid = (n: number) => `d2000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
    const supRows: [string, string, string, string, boolean, number, string, string, string, string, number][] = [
      [demo.sup1, 'BeautyPro MK', 'Distributor', 'North Macedonia', true, 6000, '2–3 business days', '30 days invoice', 'Vesna Todorova · vesna@beautypro.mk · +389 2 3090 100', 'Vesna Todorova', 4.6],
      [demo.sup2, 'Aroma Nordic Direct', 'Brand supplier', 'Europe', true, 12000, '5–7 working days', 'Prepaid', 'orders@aromanordic.se', 'Karin Ek', 4.2],
      [demo.sup3, 'Adriatic Beauty Group', 'Distributor', 'North Macedonia, Kosovo', true, 6000, '1–2 working days', '14 days invoice', 'sales@adriaticbeauty.com', '—', 4.4],
      [demo.sup4, 'Skopje Salon Supplies', 'Wholesaler', 'Skopje region', false, 3600, 'Same day', 'Pay on delivery', 'info@salonsupplies.mk', '—', 3.9],
    ];
    for (const [id, name, type, terr, ver, minO, lead, terms, contact, manager, rating] of supRows)
      await q(
        `INSERT INTO suppliers (id, name, type, territory, verified, min_order, lead, terms, contact, manager, rating)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [id, name, type, terr, ver, minO, lead, terms, contact, manager, rating],
      );

    // n, sup, brand, name, sku, ean, size, pack, buy, rrp, moq, stock, lead, use, cat, sample, ownSize, ownUnit, link
    const spRows: [number, string, string, string, string, string, string, number, number, number, number, number, string, string, string, boolean, number | null, string | null, string | null][] = [
      [1, demo.sup1, 'Thera-Band', 'Thera-Band resistance set, 3 levels', 'TB-SET-03', '3474636975918', '3 bands', 6, 550, 990, 1, 240, '2–3 business days', 'both', 'Home exercise', false, null, null, demo.p1],
      [9, demo.sup1, 'Thera-Band', 'Arnica massage oil 200 ml', 'TB-ARN-200', '3474637154639', '200 ml', 6, 900, 1450, 1, 90, '2–3 business days', 'both', 'Recovery aids', false, null, null, demo.p2],
      [2, demo.sup1, 'Thera-Band', 'Ultrasound gel 5 l', 'TB-GEL-5L', '3474630372184', '5 l', 12, 380, 0, 3, 180, '2 days', 'pro', 'Clinic supplies', false, null, null, null],
      [3, demo.sup1, 'Thera-Band', 'Couch roll 50 cm — 9 rolls', 'TB-CCH-50', '3474630372191', '9 rolls', 6, 310, 0, 2, 64, '2 days', 'pro', 'Clinic supplies', false, null, null, demo.p8],
      [4, demo.sup1, 'CureTape', 'CureTape kinesiology tape 5 m', 'CT-CLA-5M', '896364002435', '5 m', 6, 1000, 1600, 1, 0, '10 days', 'retail', 'Recovery aids', false, null, null, demo.p3],
      [5, demo.sup2, 'Nordic', 'Nordic reusable cold pack', 'NR-CLD-01', '7350045670012', '27x12 cm', 4, 850, 1450, 2, 96, '6 days', 'both', 'Recovery aids', false, null, null, demo.p5],
      [6, demo.sup2, 'Nordic', 'Nordic posture brace, size M', 'NR-BRC-M', '7350045670104', 'size M', 4, 1050, 1700, 2, 41, '6 days', 'retail', 'Supports', false, null, null, demo.p6],
      [7, demo.sup1, 'Thera-Band', 'Nitrile gloves M — pack of 100', 'TB-GLV-100', '3474630372207', '100 pcs', 1, 470, 0, 1, 220, '2 days', 'pro', 'Clinic supplies', false, null, null, demo.p9],
      [8, demo.sup3, 'OrthoPro', 'OrthoPro trigger point ball', 'OP-TPB-06', '8606105320019', '6 cm', 12, 270, 550, 6, 500, '1 day', 'both', 'Home exercise', false, null, null, demo.p4],
      [10, demo.sup1, 'Thera-Band', 'Warming massage balm 100 ml — sample', 'TB-WRM-100S', '3474630372313', '100 ml', 1, 0, 0, 1, 60, '3 days', 'pro', 'Clinic supplies', true, 100, 'ml', null],
      [11, demo.sup2, 'Nordic', 'Nordic arnica gel 50 ml — sample', 'NR-ARN-50S', '7350045670210', '50 ml', 1, 0, 0, 1, 24, '6 days', 'pro', 'Recovery aids', true, 50, 'ml', null],
    ];
    for (const [n, sup, brand, name, sku, ean, size, pack, buy, rrp, moq, stock, lead, use, cat, sample, ownSize, ownUnit, link] of spRows) {
      await q(
        `INSERT INTO supplier_products (id, supplier_id, brand, name, sku, ean, size, pack, buy, rrp, moq, stock, lead, use, category, sample, own_size, own_unit)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [spid(n), sup, brand, name, sku, ean, size, pack, buy, rrp, moq, stock, lead, use, cat, sample, ownSize, ownUnit],
      );
      if (link)
        await q(`UPDATE products SET supplier_product_id=$1 WHERE id=$2`, [spid(n), link]);
    }

    // Connections: BeautyPro + Aroma connected, Skopje Supplies pending.
    await q(
      `INSERT INTO supplier_connections (tenant_id, supplier_id, status, customer_no, connected, share, location_ids) VALUES
       ($1,$2,'connected','MK-4821','2026-08-04','{"orders":true,"stock":true,"sales":true,"training":true}',$3),
       ($1,$4,'connected','AN-99120','2026-06-19','{"orders":true,"stock":false,"sales":false,"training":true}',$5),
       ($1,$6,'pending','',NULL,'{}',$5)`,
      [demo.business, demo.sup1, `{${demo.locCentar},${demo.locAerodrom}}`, demo.sup2, `{${demo.locCentar}}`, demo.sup4],
    );

    // Purchase orders (prototype po1–po4, verbatim).
    const poRows: [string, string, string, string, string, string, string | null, string, string, [number, number, number, number, number, number][]][] = [
      [demo.po1, 'CEN-0042', demo.sup1, demo.locCentar, 'shipped', '2026-08-02', '2026-08-07', 'Maria Petrovska', 'MK-PARCEL-88213', [[1, 12, 550, 2, 0, 0], [3, 6, 310, 0, 0, 0]]],
      [demo.po2, 'AER-0031', demo.sup1, demo.locAerodrom, 'delivered', '2026-07-21', '2026-07-24', 'Ana Dimitrova', 'MK-PARCEL-87104', [[2, 12, 380, 0, 12, 0], [7, 2, 470, 0, 2, 0]]],
      [demo.po3, 'CEN-0043', demo.sup2, demo.locCentar, 'approval', '2026-08-06', null as unknown as string, 'Elena Ristova', '', [[5, 8, 850, 0, 0, 0], [6, 4, 1050, 0, 0, 0]]],
      [demo.po4, 'CEN-0041', demo.sup1, demo.locCentar, 'disputed', '2026-07-11', '2026-07-15', 'Maria Petrovska', 'MK-PARCEL-86550', [[4, 6, 1000, 0, 4, 2]]],
    ];
    for (const [id, ref, sup, loc, status, created, expected, byName, track, lines] of poRows) {
      await q(
        `INSERT INTO purchase_orders (id, tenant_id, ref, supplier_id, location_id, status, by_name, expected, track, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, demo.business, ref, sup, loc, status, byName, expected, track, created],
      );
      for (const [i, [n, qty, price, free, recv, dmg]] of lines.entries())
        await q(
          `INSERT INTO purchase_order_lines (tenant_id, order_id, supplier_product_id, qty, price, free, recv, dmg, sort)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [demo.business, id, spid(n), qty, price, free, recv, dmg, i],
        );
    }

    // Supplier promotions (prototype supplierOffers).
    await q(
      `INSERT INTO supplier_promotions (supplier_id, brand, title, kind, product_ids, starts, ends, min_order, usage_limit, terms, audience, value, per) VALUES
       ($1,'Thera-Band','Buy 10 resistance sets, receive 2 free','bxgy',$2,'2026-08-01','2026-08-31',0,400,'Applies per order line. Free units are invoiced at 0 ден and count for stock.','Connected salons only',2,10),
       ($1,'Thera-Band','Colour launch bundle − 15%','pct',$3,'2026-08-05','2026-08-31',15000,0,'15% off tape and recovery aids from 15.000 ден per order.','Salons with more than 20 colour treatments a month',15,0),
       ($4,'Nordic','Free tester with every 6 masks','gift',$5,'2026-07-01','2026-08-15',0,120,'One 15 ml tester per 6 units, while stock lasts.','All connected salons',1,6)`,
      [demo.sup1, `{${spid(1)}}`, `{${spid(2)},${spid(3)}}`, demo.sup2, `{${spid(5)}}`],
    );

    // Revelapps HQ staff (prototype's hqUsers) — same demo password.
    const hqRows: [string, string, string, string][] = [
      [demo.hqIvana, 'Ivana Markovska', 'ivana@revelapps.com', 'hq_super'],
      [demo.hqDamjan, 'Damjan Kostov', 'damjan@revelapps.com', 'hq_onboard'],
      [demo.hqTea, 'Tea Nikolova', 'tea@revelapps.com', 'hq_support'],
    ];
    for (const [id, name, email, role] of hqRows)
      await q(
        `INSERT INTO hq_users (id, name, email, role, password_hash) VALUES ($1,$2,$3,$4,$5)`,
        [id, name, email, role, hash],
      );

    // BeautyPro's portal people — same demo password.
    const supUsers: [string, string, string, string][] = [
      [demo.supUserVesna, 'Vesna Todorova', 'vesna@beautypro.mk', 'sr_account'],
      [demo.supUserGoran, 'Goran Iliev', 'goran@beautypro.mk', 'sr_order'],
    ];
    for (const [id, name, email, role] of supUsers)
      await q(
        `INSERT INTO supplier_users (id, supplier_id, name, email, role, password_hash) VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, demo.sup1, name, email, role, hash],
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
