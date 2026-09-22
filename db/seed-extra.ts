/**
 * One-off dev seed: five extra, fully-working salons + a few suppliers,
 * added ON TOP of the demo world (no truncate). Run against the ADMIN
 * (BYPASSRLS) database url. Re-runnable: it wipes its own salons/suppliers
 * by slug/id first. Service & product categories are the global Velnes
 * taxonomy — reused by name, never re-created.
 *
 *   pnpm --filter @velnes/api exec tsx ../../db/seed-extra.ts
 */
import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import pg from 'pg';
import { employeePermMap, PERM_KEYS, scopeChoices, STANDARD_ROLES, type PermMap } from '@velnes/contracts';

const ADMIN_URL =
  process.env.ADMIN_DATABASE_URL ??
  process.env.TEST_ADMIN_DATABASE_URL ??
  'postgres://slobodanrevelapps@localhost:5432/velnes';
const PASSWORD = process.env.SEED_PASSWORD ?? 'velnes-demo';

// ── permission kits ──────────────────────────────────────────────────
const mkPerms = (o: PermMap): PermMap => {
  const r: PermMap = {};
  for (const k of PERM_KEYS) r[k] = o[k] ?? 'none';
  return r;
};
const ownerPerms = mkPerms(Object.fromEntries(PERM_KEYS.map((k) => [k, scopeChoices(k).at(-1) ?? 'none'])) as PermMap);
const staffPerms = employeePermMap();
const deskPerms = mkPerms({
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

/** Weekly hours: 0=Mon … 6=Sun (null = off). */
const stdHours = (satEnd = '16:00'): Record<string, [string, string][] | null> => ({
  0: [['09:00', '19:00']],
  1: [['09:00', '19:00']],
  2: [['09:00', '19:00']],
  3: [['09:00', '19:00']],
  4: [['09:00', '19:00']],
  5: [['09:00', satEnd]],
  6: null,
});
const payments = { cash: true, card: true, online: true, rounding: false, tip: true };
const COLORS = ['olive', 'clay', 'rose', 'sage', 'lilac', 'sky', 'sand', 'stone'];

// ── the five salons ──────────────────────────────────────────────────
type Staff = { name: string; email: string; title: string; kind: 'owner' | 'staff' | 'desk' };
type Svc = { name: string; cat: string; min: number; price: number };
type Prod = { name: string; cat: string; sku: string; price: number; stock: number };
type Cust = { name: string; email: string; group: string; visits: number; spend: number; points: number };
type Salon = {
  slug: string;
  name: string;
  city: string;
  address: string;
  phone: string;
  vat: string;
  team: Staff[];
  services: Svc[];
  products: Prod[];
  customers: Cust[];
};

const SALONS: Salon[] = [
  {
    slug: 'studio-lumiere',
    name: 'Studio Lumière',
    city: 'Skopje',
    address: 'Bulevar Ilinden 42',
    phone: '+389 2 3220 410',
    vat: 'MK4080091234501',
    team: [
      { name: 'Elena Popova', email: 'elena@studiolumiere.mk', title: 'Owner · Master stylist', kind: 'owner' },
      { name: 'Marko Ilievski', email: 'marko@studiolumiere.mk', title: 'Stylist', kind: 'staff' },
      { name: 'Sofija Ristova', email: 'sofija@studiolumiere.mk', title: 'Colour specialist', kind: 'staff' },
      { name: 'Ana Jovanova', email: 'ana@studiolumiere.mk', title: 'Front desk', kind: 'desk' },
    ],
    services: [
      { name: "Women's Cut & Style", cat: 'Haircuts', min: 45, price: 1200 },
      { name: "Men's Cut", cat: 'Haircuts', min: 30, price: 700 },
      { name: 'Full Colour', cat: 'Haircuts', min: 120, price: 3500 },
      { name: 'Highlights', cat: 'Haircuts', min: 150, price: 4500 },
      { name: 'Blow-dry', cat: 'Haircuts', min: 30, price: 800 },
      { name: "Children's Cut", cat: 'Haircuts', min: 20, price: 500 },
    ],
    products: [
      { name: 'Repair Shampoo 300 ml', cat: 'Hair care', sku: 'LUM-SHP-300', price: 650, stock: 24 },
      { name: 'Hydrating Conditioner 300 ml', cat: 'Hair care', sku: 'LUM-CON-300', price: 650, stock: 20 },
      { name: 'Weekly Hair Mask 200 ml', cat: 'Hair care', sku: 'LUM-MSK-200', price: 900, stock: 12 },
    ],
    customers: [
      { name: 'Marija Stojanoska', email: 'marija.st@example.com', group: 'Regulars', visits: 18, spend: 32400, points: 120 },
      { name: 'Dragana Petrova', email: 'dragana.p@example.com', group: 'VIP', visits: 41, spend: 98600, points: 410 },
      { name: 'Sara Nikolikj', email: 'sara.n@example.com', group: 'New', visits: 2, spend: 2400, points: 10 },
    ],
  },
  {
    slug: 'bella-hair',
    name: 'Bella Hair Studio',
    city: 'Bitola',
    address: 'Širok Sokak 88',
    phone: '+389 47 220 315',
    vat: 'MK4080091234502',
    team: [
      { name: 'Bella Naumova', email: 'bella@bellahair.mk', title: 'Owner · Stylist', kind: 'owner' },
      { name: 'Nikola Stojanov', email: 'nikola@bellahair.mk', title: 'Senior stylist', kind: 'staff' },
      { name: 'Marija Kostova', email: 'marija@bellahair.mk', title: 'Colourist', kind: 'staff' },
      { name: 'Ivona Risteska', email: 'ivona@bellahair.mk', title: 'Receptionist', kind: 'desk' },
    ],
    services: [
      { name: 'Cut & Blow-dry', cat: 'Haircuts', min: 45, price: 1100 },
      { name: 'Balayage', cat: 'Haircuts', min: 180, price: 5000 },
      { name: 'Root Touch-up', cat: 'Haircuts', min: 90, price: 2200 },
      { name: 'Keratin Treatment', cat: 'Haircuts', min: 120, price: 4000 },
      { name: 'Event Styling', cat: 'Haircuts', min: 60, price: 2500 },
    ],
    products: [
      { name: 'Argan Oil Serum 100 ml', cat: 'Hair care', sku: 'BEL-ARG-100', price: 900, stock: 15 },
      { name: 'Heat Protection Spray 200 ml', cat: 'Hair care', sku: 'BEL-HPS-200', price: 750, stock: 18 },
    ],
    customers: [
      { name: 'Tamara Angelova', email: 'tamara.a@example.com', group: 'Regulars', visits: 22, spend: 44300, points: 180 },
      { name: 'Kristina Ilic', email: 'kristina.i@example.com', group: 'New', visits: 1, spend: 1100, points: 5 },
    ],
  },
  {
    slug: 'barber-house',
    name: 'The Barber House',
    city: 'Skopje',
    address: 'Kosta Novakovikj 12',
    phone: '+389 2 3111 908',
    vat: 'MK4080091234503',
    team: [
      { name: 'Damjan Petrov', email: 'damjan@barberhouse.mk', title: 'Owner · Barber', kind: 'owner' },
      { name: 'Stefan Angelov', email: 'stefan@barberhouse.mk', title: 'Barber', kind: 'staff' },
      { name: 'Viktor Mladenov', email: 'viktor@barberhouse.mk', title: 'Barber', kind: 'staff' },
    ],
    services: [
      { name: 'Classic Cut', cat: 'Haircuts', min: 30, price: 600 },
      { name: 'Skin Fade', cat: 'Haircuts', min: 40, price: 800 },
      { name: 'Beard Trim', cat: 'Haircuts', min: 20, price: 400 },
      { name: 'Hot Towel Shave', cat: 'Haircuts', min: 30, price: 700 },
      { name: 'Cut & Beard Combo', cat: 'Haircuts', min: 50, price: 1000 },
    ],
    products: [
      { name: 'Beard Oil 50 ml', cat: 'Hair care', sku: 'BRB-BRD-50', price: 550, stock: 30 },
      { name: 'Matte Pomade 100 ml', cat: 'Hair care', sku: 'BRB-POM-100', price: 600, stock: 25 },
      { name: 'Aftershave Balm 100 ml', cat: 'Hair care', sku: 'BRB-AFT-100', price: 500, stock: 20 },
    ],
    customers: [
      { name: 'Goran Trajkov', email: 'goran.t@example.com', group: 'Regulars', visits: 30, spend: 21000, points: 90 },
      { name: 'Filip Naumov', email: 'filip.n@example.com', group: 'New', visits: 3, spend: 2400, points: 10 },
    ],
  },
  {
    slug: 'aurora-beauty',
    name: 'Aurora Skin & Beauty',
    city: 'Skopje',
    address: 'Vasil Glavinov 5',
    phone: '+389 2 3290 770',
    vat: 'MK4080091234504',
    team: [
      { name: 'Ivana Trajkovska', email: 'ivana@aurorabeauty.mk', title: 'Owner · Esthetician', kind: 'owner' },
      { name: 'Jana Dimitrova', email: 'jana@aurorabeauty.mk', title: 'Skin therapist', kind: 'staff' },
      { name: 'Teodora Ilic', email: 'teodora@aurorabeauty.mk', title: 'Nail technician', kind: 'staff' },
      { name: 'Simona Petkova', email: 'simona@aurorabeauty.mk', title: 'Front desk', kind: 'desk' },
    ],
    services: [
      { name: 'Signature Facial', cat: 'Skin care', min: 60, price: 2000 },
      { name: 'Chemical Peel', cat: 'Skin care', min: 45, price: 2500 },
      { name: 'Classic Manicure', cat: 'Nails', min: 45, price: 900 },
      { name: 'Gel Manicure', cat: 'Nails', min: 60, price: 1300 },
      { name: 'Spa Pedicure', cat: 'Nails', min: 60, price: 1200 },
    ],
    products: [
      { name: 'Gentle Cleanser 200 ml', cat: 'Skin care', sku: 'AUR-CLN-200', price: 800, stock: 16 },
      { name: 'Daily Moisturiser 50 ml', cat: 'Skin care', sku: 'AUR-MST-50', price: 1100, stock: 14 },
      { name: 'Vitamin C Serum 30 ml', cat: 'Skin care', sku: 'AUR-SER-30', price: 1500, stock: 10 },
    ],
    customers: [
      { name: 'Natasa Bogdanova', email: 'natasa.b@example.com', group: 'VIP', visits: 27, spend: 61000, points: 250 },
      { name: 'Emilija Ristova', email: 'emilija.r@example.com', group: 'Regulars', visits: 9, spend: 14300, points: 60 },
    ],
  },
  {
    slug: 'serenity-spa',
    name: 'Serenity Spa & Wellness',
    city: 'Ohrid',
    address: 'Kej Maršal Tito 20',
    phone: '+389 46 260 540',
    vat: 'MK4080091234505',
    team: [
      { name: 'Katarina Mihajlova', email: 'katarina@serenityspa.mk', title: 'Owner · Spa therapist', kind: 'owner' },
      { name: 'Petar Nikolov', email: 'petar@serenityspa.mk', title: 'Massage therapist', kind: 'staff' },
      { name: 'Lidija Stefanova', email: 'lidija@serenityspa.mk', title: 'Wellness therapist', kind: 'staff' },
      { name: 'Bojan Ristov', email: 'bojan@serenityspa.mk', title: 'Front desk', kind: 'desk' },
    ],
    services: [
      { name: 'Swedish Massage', cat: 'Massage', min: 60, price: 2200 },
      { name: 'Deep Tissue Massage', cat: 'Massage', min: 60, price: 2500 },
      { name: 'Aromatherapy Massage', cat: 'Massage', min: 75, price: 2800 },
      { name: 'Hot Stone Therapy', cat: 'Wellness', min: 90, price: 3200 },
      { name: 'Sauna & Relax Session', cat: 'Wellness', min: 45, price: 1500 },
    ],
    products: [
      { name: 'Relaxing Massage Oil 250 ml', cat: 'Recovery aids', sku: 'SER-OIL-250', price: 950, stock: 18 },
      { name: 'Essential Oil Set', cat: 'Recovery aids', sku: 'SER-EOS-01', price: 1400, stock: 12 },
    ],
    customers: [
      { name: 'Ana Spasova', email: 'ana.sp@example.com', group: 'Regulars', visits: 14, spend: 33600, points: 140 },
      { name: 'Milan Georgiev', email: 'milan.g@example.com', group: 'New', visits: 2, spend: 4400, points: 20 },
    ],
  },
];

// ── suppliers ────────────────────────────────────────────────────────
type SupProd = { name: string; sku: string; size: string; buy: number; rrp: number; stock: number; use: string; category: string };
type Supplier = {
  name: string;
  type: string;
  territory: string;
  minOrder: number;
  lead: string;
  terms: string;
  contact: string;
  manager: string;
  rating: number;
  owner: { name: string; email: string };
  products: SupProd[];
};
const SUPPLIERS: Supplier[] = [
  {
    name: 'HairPro Distribution',
    type: 'Distributor',
    territory: 'North Macedonia',
    minOrder: 5000,
    lead: '2–3 business days',
    terms: '30 days invoice',
    contact: 'orders@hairpro.mk · +389 2 3080 200',
    manager: 'Vlatko Petrov',
    rating: 4.5,
    owner: { name: 'Vlatko Petrov', email: 'vlatko@hairpro.mk' },
    products: [
      { name: 'Pro Repair Shampoo 1 l', sku: 'HP-SHP-1L', size: '1 l', buy: 420, rrp: 750, stock: 120, use: 'both', category: 'Hair care' },
      { name: 'Salon Colour Tube 100 ml', sku: 'HP-COL-100', size: '100 ml', buy: 180, rrp: 340, stock: 300, use: 'pro', category: 'Hair care' },
      { name: 'Developer 20 vol 1 l', sku: 'HP-DEV-1L', size: '1 l', buy: 160, rrp: 300, stock: 200, use: 'pro', category: 'Hair care' },
      { name: 'Argan Oil Serum 100 ml', sku: 'HP-ARG-100', size: '100 ml', buy: 500, rrp: 900, stock: 90, use: 'retail', category: 'Hair care' },
    ],
  },
  {
    name: 'Glow Cosmetics MK',
    type: 'Brand supplier',
    territory: 'North Macedonia, Kosovo',
    minOrder: 8000,
    lead: '3–5 working days',
    terms: '14 days invoice',
    contact: 'sales@glowcosmetics.mk',
    manager: 'Ana Kolarova',
    rating: 4.3,
    owner: { name: 'Ana Kolarova', email: 'ana@glowcosmetics.mk' },
    products: [
      { name: 'Enzyme Cleanser 200 ml', sku: 'GC-CLN-200', size: '200 ml', buy: 450, rrp: 820, stock: 80, use: 'both', category: 'Skin care' },
      { name: 'Hyaluronic Serum 30 ml', sku: 'GC-SER-30', size: '30 ml', buy: 820, rrp: 1500, stock: 60, use: 'retail', category: 'Skin care' },
      { name: 'Peel Solution 30% 50 ml', sku: 'GC-PEL-50', size: '50 ml', buy: 700, rrp: 1300, stock: 40, use: 'pro', category: 'Skin care' },
    ],
  },
  {
    name: 'Zen Wellness Supplies',
    type: 'Wholesaler',
    territory: 'North Macedonia',
    minOrder: 4000,
    lead: 'Same day',
    terms: 'Pay on delivery',
    contact: 'info@zenwellness.mk',
    manager: 'Goce Markov',
    rating: 4.1,
    owner: { name: 'Goce Markov', email: 'goce@zenwellness.mk' },
    products: [
      { name: 'Neutral Massage Oil 5 l', sku: 'ZW-OIL-5L', size: '5 l', buy: 900, rrp: 0, stock: 50, use: 'pro', category: 'Wellness supplies' },
      { name: 'Essential Oil Set (6)', sku: 'ZW-EOS-06', size: '6 × 10 ml', buy: 800, rrp: 1400, stock: 70, use: 'both', category: 'Wellness supplies' },
      { name: 'Hot Stone Set (12)', sku: 'ZW-HST-12', size: '12 stones', buy: 1200, rrp: 2200, stock: 30, use: 'pro', category: 'Wellness supplies' },
    ],
  },
];

/** Demo pins: the salon's own city, nudged by slug so pins do not
 *  stack. Placeholder coordinates — salons correct their own. */
const CITY_PINS: Record<string, [number, number]> = {
  Skopje: [41.9981, 21.4254],
  Bitola: [41.0314, 21.3347],
  Ohrid: [41.1231, 20.8016],
  Prishtina: [42.6629, 21.1655],
  Thessaloniki: [40.6401, 22.9444],
};
function cityPin(city: string, seed: string): [number, number] {
  const base = CITY_PINS[city] ?? CITY_PINS.Skopje!;
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 1000;
  return [
    Number((base[0] + ((h % 100) - 50) * 0.0004).toFixed(5)),
    Number((base[1] + ((Math.floor(h / 10) % 100) - 50) * 0.0005).toFixed(5)),
  ];
}

async function main() {
  const client = new pg.Client({ connectionString: ADMIN_URL });
  await client.connect();
  const q = (text: string, params?: unknown[]) => client.query(text, params);
  const hash = await argon2.hash(PASSWORD);

  const svcCatId = async (name: string) =>
    (await q(`SELECT id FROM service_categories WHERE name=$1`, [name])).rows[0]?.id as string;
  const prodCatId = async (name: string) =>
    (await q(
      `INSERT INTO product_categories (name, sort) VALUES ($1, 50)
       ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
      [name],
    )).rows[0].id as string;

  // ── wipe prior runs (by slug / supplier name) ──
  await q('BEGIN');
  const priorBiz = (await q(`SELECT id FROM businesses WHERE slug = ANY($1)`, [SALONS.map((s) => s.slug)])).rows.map(
    (r) => r.id as string,
  );
  for (const bizId of priorBiz) {
    for (const t of [
      'user_credentials', 'employee_skills', 'employee_locations', 'loyalty_config', 'invoice_counters',
      'widgets', 'customers', 'stock_movements', 'location_catalog_products', 'products',
      'location_catalog_services', 'services', 'payment_accounts', 'legal_entity_locations', 'legal_entities',
      'locations', 'employees', 'roles',
    ])
      await q(`DELETE FROM ${t} WHERE tenant_id=$1`, [bizId]);
    await q(`DELETE FROM businesses WHERE id=$1`, [bizId]);
  }
  const priorSup = (await q(`SELECT id FROM suppliers WHERE name = ANY($1)`, [SUPPLIERS.map((s) => s.name)])).rows.map(
    (r) => r.id as string,
  );
  for (const supId of priorSup) {
    await q(`DELETE FROM supplier_products WHERE supplier_id=$1`, [supId]);
    await q(`DELETE FROM supplier_users WHERE supplier_id=$1`, [supId]);
    await q(`DELETE FROM suppliers WHERE id=$1`, [supId]);
  }

  const creds: { salon: string; role: string; email: string }[] = [];

  // ── salons ──
  for (const s of SALONS) {
    const bizId = randomUUID();
    const locId = randomUUID();
    const leId = randomUUID();
    const roleOwner = randomUUID();
    const roleStaff = randomUUID();
    const roleDesk = randomUUID();

    await q(
      `INSERT INTO businesses (id, name, country, vat, plan, since, timing_enabled, assistant_enabled, slug,
         address, city, phone, description, gallery, settings)
       VALUES ($1,$2,'North Macedonia',$3,'Business',CURRENT_DATE - 200,false,true,$4,$5,$6,$7,$8,$9,$10)`,
      [
        bizId, s.name, s.vat, s.slug, s.address, s.city, s.phone,
        `${s.name} — ${s.city}.`,
        JSON.stringify([{ id: 'g1', name: 'Reception', img: null, tone: '#6f7357' }]),
        JSON.stringify({
          customers: { groups: [{ name: 'New', discountPct: 0 }, { name: 'Regulars', discountPct: 5 }, { name: 'VIP', discountPct: 10 }], forms: { consult: true, intake: false } },
          sales: { defaultVat: 18, autoReceipt: true, allowDiscounts: true, roundCash: false },
        }),
      ],
    );

    for (const [id, name, locked, descr, perms] of [
      [roleOwner, 'Owner', true, 'Everything, everywhere. The account itself.', ownerPerms],
      [roleStaff, 'Employee', false, STANDARD_ROLES.employee.description, staffPerms],
      [roleDesk, 'Front desk', true, 'The calendar and the till at the location.', deskPerms],
    ] as [string, string, boolean, string, PermMap][])
      await q(
        `INSERT INTO roles (id, tenant_id, name, std, locked, description, perms) VALUES ($1,$2,$3,true,$4,$5,$6)`,
        [id, bizId, name, locked, descr, JSON.stringify(perms)],
      );

    await q(
      // Demo pins so every listed salon has somewhere to sit on a map.
      `INSERT INTO locations (id, tenant_id, name, city, address, tz, phone, rooms, inv_prefix, online, cancel_hours, opened, hours, payments, lifecycle, lat, lng)
       VALUES ($1,$2,$3,$4,$5,'Europe/Skopje',$6,3,$7,true,24,CURRENT_DATE - 180,$8,$9,'ACTIVE',$10,$11)`,
      [locId, bizId, s.city, s.city, s.address, s.phone, s.slug.slice(0, 3).toUpperCase() + '-2026-', JSON.stringify(stdHours()), JSON.stringify(payments), ...cityPin(s.city, s.slug)],
    );

    await q(
      `INSERT INTO legal_entities (id, tenant_id, owner_type, owner_id, is_default, name, tax_id, vat_reg, currency, status, fiscal_profile_id)
       VALUES ($1,$2,'salon',NULL,true,$3,$4,$4,'MKD','verified','fp-mk-1')`,
      [leId, bizId, `${s.name} DOOEL ${s.city}`, s.vat],
    );
    await q(`INSERT INTO legal_entity_locations (tenant_id, legal_entity_id, location_id) VALUES ($1,$2,$3)`, [bizId, leId, locId]);
    await q(
      `INSERT INTO payment_accounts (tenant_id, legal_entity_id, provider, merchant_id, settlement_ref, status)
       VALUES ($1,$2,'CaSys (demo)',$3,'MK07 2501 0000 0000',$4)`,
      [bizId, leId, 'MID-' + s.slug.toUpperCase().replace(/-/g, '').slice(0, 8), 'active'],
    );

    // Services + per-location catalog rows.
    const svcIds: string[] = [];
    for (const [i, sv] of s.services.entries()) {
      const id = randomUUID();
      svcIds.push(id);
      const catId = await svcCatId(sv.cat);
      await q(
        `INSERT INTO services (id, tenant_id, name, category_id, duration_min, price, vat, status, pos, online, sort)
         VALUES ($1,$2,$3,$4,$5,$6,18,'active',true,true,$7)`,
        [id, bizId, sv.name, catId, sv.min, sv.price, i],
      );
      await q(
        `INSERT INTO location_catalog_services (tenant_id, location_id, service_id, active, price, duration_min, online, pos)
         VALUES ($1,$2,$3,true,$4,$5,true,true)`,
        [bizId, locId, id, sv.price, sv.min],
      );
    }

    // Products + per-location catalog + opening stock.
    for (const p of s.products) {
      const id = randomUUID();
      const catId = await prodCatId(p.cat);
      await q(
        `INSERT INTO products (id, tenant_id, name, category_id, sku, price, vat, active, own)
         VALUES ($1,$2,$3,$4,$5,$6,18,true,false)`,
        [id, bizId, p.name, catId, p.sku, p.price],
      );
      await q(
        `INSERT INTO location_catalog_products (tenant_id, location_id, product_id, active, price, low_stock, pos, stock)
         VALUES ($1,$2,$3,true,$4,2,true,$5)`,
        [bizId, locId, id, p.price, p.stock],
      );
    }

    // Team — owner + bookable staff (hours + all skills) + front desk.
    const roleOf = { owner: roleOwner, staff: roleStaff, desk: roleDesk };
    const ownerEmpId: Record<string, string> = {};
    for (const [i, m] of s.team.entries()) {
      const empId = randomUUID();
      const bookable = m.kind !== 'desk';
      const hours = bookable ? stdHours() : null;
      await q(
        `INSERT INTO employees (id, tenant_id, name, role_title, email, phone, access, role_id, bookable, status, twofa_enabled, color, hours)
         VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,'active',false,$9,$10)`,
        [empId, bizId, m.name, m.title, m.email, m.kind, roleOf[m.kind], bookable, COLORS[i % COLORS.length], hours ? JSON.stringify(hours) : null],
      );
      await q(`INSERT INTO employee_locations (tenant_id, employee_id, location_id) VALUES ($1,$2,$3)`, [bizId, empId, locId]);
      if (bookable) for (const sid of svcIds) await q(`INSERT INTO employee_skills (tenant_id, employee_id, service_id) VALUES ($1,$2,$3)`, [bizId, empId, sid]);
      await q(`INSERT INTO user_credentials (employee_id, tenant_id, password_hash) VALUES ($1,$2,$3)`, [empId, bizId, hash]);
      if (m.kind === 'owner') ownerEmpId.id = empId;
      creds.push({ salon: s.name, role: m.kind, email: m.email });
    }
    await q(`UPDATE businesses SET owner_employee_id=$1 WHERE id=$2`, [ownerEmpId.id, bizId]);

    // Counters, loyalty, a booking widget, a few customers.
    await q(`INSERT INTO invoice_counters (tenant_id, location_id, next) VALUES ($1,$2,1)`, [bizId, locId]);
    await q(
      `INSERT INTO loyalty_config (tenant_id, active, earn_per, points, step, worth, expiry_months, welcome, birthday)
       VALUES ($1,true,60,1,100,300,24,25,50)`,
      [bizId],
    );
    await q(
      `INSERT INTO widgets (id, tenant_id, name, location_ids, categories, lang, theme, accent, radius, start_step, deposit, status, domains, publishable_key)
       VALUES ($1,$2,'Main site',$3,'{all}','en','light','#6f7357','12','location','none','live',$4,$5)`,
      [randomUUID(), bizId, `{${locId}}`, `{${s.slug}.mk}`, 'pk_live_' + s.slug.replace(/-/g, '')],
    );
    for (const c of s.customers) {
      await q(
        `INSERT INTO customers (id, tenant_id, name, email, cust_group, since, visits, spend, points, blacklisted, no_shows, email_verified_at)
         VALUES ($1,$2,$3,$4,$5,CURRENT_DATE - ($6 * 20),$6,$7,$8,false,0, now())`,
        [randomUUID(), bizId, c.name, c.email, c.group, c.visits, c.spend, c.points],
      );
    }
  }

  // ── suppliers + portal owner + catalog ──
  for (const sup of SUPPLIERS) {
    const supId = randomUUID();
    await q(
      `INSERT INTO suppliers (id, name, type, territory, verified, min_order, lead, terms, contact, manager, rating)
       VALUES ($1,$2,$3,$4,true,$5,$6,$7,$8,$9,$10)`,
      [supId, sup.name, sup.type, sup.territory, sup.minOrder, sup.lead, sup.terms, sup.contact, sup.manager, sup.rating],
    );
    await q(
      `INSERT INTO supplier_users (id, supplier_id, name, email, role, password_hash) VALUES ($1,$2,$3,$4,'sr_owner',$5)`,
      [randomUUID(), supId, sup.owner.name, sup.owner.email, hash],
    );
    for (const p of sup.products)
      await q(
        `INSERT INTO supplier_products (id, supplier_id, brand, name, sku, size, pack, buy, rrp, moq, stock, lead, use, category, sample)
         VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8,1,$9,$10,$11,$12,false)`,
        [randomUUID(), supId, sup.name, p.name, p.sku, p.size, p.buy, p.rrp, p.stock, sup.lead, p.use, p.category],
      );
    creds.push({ salon: sup.name + ' (supplier portal)', role: 'sr_owner', email: sup.owner.email });
  }

  await q('COMMIT');
  await client.end();

  // ── print credentials ──
  console.log(`\n✅ Seeded ${SALONS.length} salons + ${SUPPLIERS.length} suppliers. Password for everyone: ${PASSWORD}\n`);
  let cur = '';
  for (const c of creds) {
    if (c.salon !== cur) {
      console.log(`\n${c.salon}`);
      cur = c.salon;
    }
    console.log(`  ${c.role.padEnd(9)} ${c.email}`);
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
