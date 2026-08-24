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
      stock_movements, location_catalog_products, products, product_categories,
      employee_skills, location_catalog_variants, location_catalog_services,
      service_modifier_options, service_modifier_groups, service_variants,
      services, service_categories,
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
