import { randomUUID } from 'node:crypto';
import { BusinessSettingsSchema, type RegistrationDraft } from '@velnes/contracts';
import argon2 from 'argon2';
import { sql } from 'kysely';
import pg from 'pg';

/**
 * Fixture salons — complete, real-shaped tenants for trying the
 * platform out, added and removed in one act each (Alex, 2026-09-28).
 *
 * How they are made: through the front door. Each fixture is a
 * registration draft filed at the anonymous door and approved the way
 * HQ approves — business, roles, owner with a password, verified legal
 * entity, an ACTIVE location with a pin on the map, services online,
 * products, gallery — so a fixture salon is indistinguishable from a
 * sign-up and exercises the same code. On top of that: two or three
 * active, bookable staff with skills and passwords (a sign-up's team
 * is merely invited), a pitch and a description for the consumer card.
 *
 * How they are told apart: `businesses.fixture_batch`. Real salons
 * carry NULL. `remove` deletes every tenant-scoped row of the batch's
 * businesses — the tables are found from the schema, in foreign-key
 * order, so a table added later is never forgotten — then their
 * registrations, then the businesses. Nothing outside the batch is
 * touched, by construction: every delete is `WHERE tenant_id = ANY`.
 *
 * Mail is forced to the mock transport for the run: the doors queue
 * verification and approval mails, and nothing may leave the building
 * for an address that does not exist. Categories are snapped to names
 * the target database already has — approval would otherwise create
 * them, and a removed batch must leave the global taxonomy as it was.
 */

export const FIXTURE_PASSWORD = 'velnes-fixture';
export const FIXTURE_DOMAIN = 'fixture.velnes.test';

type Svc = { name: string; category: string; durationMin: number; price: number };
type Prod = { name: string; category: string; price: number };
type Kind = {
  type: string;
  pitch: string;
  description: string;
  services: Svc[];
  products: Prod[];
};

/** Six kinds of salon; each fixture takes one and its catalogue. Prices
 *  in whole MKD, durations in minutes — the shapes the wizard sends. */
const KINDS: Kind[] = [
  {
    type: 'Physiotherapy',
    pitch: 'Physiotherapy that gets you moving again',
    description:
      'A physiotherapy practice for sports injuries, back and neck pain and post-operative rehabilitation. Every visit starts with an assessment and ends with a plan you can follow at home.',
    services: [
      { name: 'Initial assessment', category: 'Assessment', durationMin: 45, price: 1500 },
      { name: 'Physiotherapy session', category: 'Manual therapy', durationMin: 45, price: 1800 },
      { name: 'Manual therapy — spine', category: 'Manual therapy', durationMin: 40, price: 2000 },
      { name: 'Post-operative rehab', category: 'Rehab', durationMin: 60, price: 2200 },
      { name: 'Kinesio taping', category: 'Recovery', durationMin: 20, price: 700 },
      { name: 'Sports massage', category: 'Recovery', durationMin: 45, price: 1900 },
      { name: 'Dry needling', category: 'Manual therapy', durationMin: 30, price: 1600 },
      { name: 'Shockwave therapy', category: 'Rehab', durationMin: 25, price: 2400 },
    ],
    products: [
      { name: 'Kinesiology tape', category: 'Recovery aids', price: 550 },
      { name: 'Resistance band set', category: 'Home exercise', price: 900 },
      { name: 'Lumbar support belt', category: 'Supports', price: 1800 },
    ],
  },
  {
    type: 'Massage',
    pitch: 'Deep, honest massage — no rush, no upsell',
    description:
      'A small massage studio with three quiet rooms. Relaxation, deep tissue and couples massage, with warm oils and a therapist who listens first.',
    services: [
      { name: 'Relaxation massage', category: 'Massage', durationMin: 60, price: 1800 },
      { name: 'Deep tissue massage', category: 'Massage', durationMin: 60, price: 2200 },
      { name: 'Back and neck massage', category: 'Massage', durationMin: 30, price: 1100 },
      { name: 'Hot stone massage', category: 'Massage', durationMin: 75, price: 2800 },
      { name: 'Couples massage', category: 'Massage', durationMin: 60, price: 3900 },
      { name: 'Aromatherapy massage', category: 'Wellness', durationMin: 60, price: 2100 },
      { name: 'Foot reflexology', category: 'Wellness', durationMin: 40, price: 1300 },
    ],
    products: [
      { name: 'Lavender massage oil 250ml', category: 'Oils', price: 850 },
      { name: 'Arnica muscle balm', category: 'Own use', price: 690 },
    ],
  },
  {
    type: 'Haircuts',
    pitch: 'Sharp cuts, colour that lasts',
    description:
      'A neighbourhood hair salon for cuts, colour and blow-dries. Walk-ins when we can, bookings when you want to be sure.',
    services: [
      { name: "Women's haircut", category: 'Haircuts', durationMin: 45, price: 900 },
      { name: "Men's haircut", category: 'Haircuts', durationMin: 30, price: 500 },
      { name: 'Beard trim', category: 'Haircuts', durationMin: 20, price: 300 },
      { name: 'Blow-dry and style', category: 'Haircuts', durationMin: 40, price: 700 },
      { name: 'Full colour', category: 'Haircuts', durationMin: 120, price: 2600 },
      { name: 'Balayage', category: 'Haircuts', durationMin: 150, price: 4200 },
      { name: 'Keratin treatment', category: 'Haircuts', durationMin: 120, price: 3800 },
      { name: "Children's haircut", category: 'Haircuts', durationMin: 25, price: 350 },
    ],
    products: [
      { name: 'Repair shampoo 300ml', category: 'Hair care', price: 780 },
      { name: 'Heat protection spray', category: 'Hair care', price: 650 },
      { name: 'Matte styling clay', category: 'Hair care', price: 590 },
    ],
  },
  {
    type: 'Skin care',
    pitch: 'Facials built around your skin, not a menu',
    description:
      'A skin studio for facials, peels and brow work. We start with a skin analysis and choose the treatment from there.',
    services: [
      { name: 'Classic facial', category: 'Skin care', durationMin: 60, price: 1800 },
      { name: 'Deep cleansing facial', category: 'Skin care', durationMin: 75, price: 2300 },
      { name: 'Hydrafacial', category: 'Skin care', durationMin: 60, price: 3200 },
      { name: 'Chemical peel', category: 'Skin care', durationMin: 45, price: 2600 },
      { name: 'Microneedling', category: 'Skin care', durationMin: 60, price: 3900 },
      { name: 'Brow shaping and tint', category: 'Skin care', durationMin: 30, price: 600 },
      { name: 'Lash lift', category: 'Skin care', durationMin: 50, price: 1400 },
    ],
    products: [
      { name: 'Vitamin C serum', category: 'Skin care', price: 1900 },
      { name: 'SPF 50 day cream', category: 'Skin care', price: 1350 },
    ],
  },
  {
    type: 'Nails',
    pitch: 'Gel, acrylic and a proper pedicure',
    description:
      'A nail bar with six stations, sterilised tools and colours you will actually want. Manicure, pedicure, gel and nail art.',
    services: [
      { name: 'Classic manicure', category: 'Nails', durationMin: 40, price: 500 },
      { name: 'Gel manicure', category: 'Nails', durationMin: 60, price: 900 },
      { name: 'Gel removal', category: 'Nails', durationMin: 20, price: 250 },
      { name: 'Spa pedicure', category: 'Nails', durationMin: 60, price: 1100 },
      { name: 'Acrylic extensions', category: 'Nails', durationMin: 90, price: 1800 },
      { name: 'Nail art (per set)', category: 'Nails', durationMin: 30, price: 400 },
    ],
    products: [
      { name: 'Cuticle oil', category: 'Own use', price: 350 },
      { name: 'Hand cream 75ml', category: 'Skin care', price: 420 },
    ],
  },
  {
    type: 'Spa-Inclusive',
    pitch: 'Sauna, pool and a day that is yours',
    description:
      'A day spa with a sauna, a heated pool and treatment rooms. Half-day and full-day rituals, massages and body treatments.',
    services: [
      { name: 'Spa day pass', category: 'Spa-Inclusive', durationMin: 240, price: 2500 },
      { name: 'Signature body ritual', category: 'Spa-Inclusive', durationMin: 90, price: 3600 },
      { name: 'Body scrub and wrap', category: 'Wellness', durationMin: 75, price: 2900 },
      { name: 'Swedish massage', category: 'Massage', durationMin: 60, price: 2000 },
      { name: 'Sauna session', category: 'Wellness', durationMin: 60, price: 800 },
      { name: 'Couples spa afternoon', category: 'Spa-Inclusive', durationMin: 180, price: 6900 },
    ],
    products: [
      { name: 'Sea salt body scrub', category: 'Own use', price: 990 },
      { name: 'Eucalyptus sauna oil', category: 'Oils', price: 620 },
    ],
  },
];

/** Where the pins land: real towns, real coordinates, a little spread. */
const PLACES = [
  { city: 'Skopje', street: 'Partizanski odredi', zip: '1000', lat: 41.9981, lng: 21.4254 },
  { city: 'Skopje', street: 'Orce Nikolov', zip: '1000', lat: 42.0034, lng: 21.4178 },
  { city: 'Skopje', street: 'Jane Sandanski', zip: '1000', lat: 41.9866, lng: 21.4657 },
  { city: 'Skopje', street: 'Makedonija', zip: '1000', lat: 41.9946, lng: 21.4319 },
  { city: 'Bitola', street: 'Shirok Sokak', zip: '7000', lat: 41.0297, lng: 21.3347 },
  { city: 'Ohrid', street: 'Kej Makedonija', zip: '6000', lat: 41.1172, lng: 20.8016 },
  { city: 'Tetovo', street: 'Ilindenska', zip: '1200', lat: 42.0097, lng: 20.9716 },
  { city: 'Kumanovo', street: 'Goce Delchev', zip: '1300', lat: 42.1322, lng: 21.7144 },
  { city: 'Struga', street: 'Marshal Tito', zip: '6330', lat: 41.1778, lng: 20.6781 },
  { city: 'Prilep', street: 'Goce Delchev', zip: '7500', lat: 41.3464, lng: 21.5542 },
  { city: 'Veles', street: 'Blagoj Gjorev', zip: '1400', lat: 41.7153, lng: 21.7756 },
  { city: 'Strumica', street: 'Leninova', zip: '2400', lat: 41.4378, lng: 22.6427 },
  { city: 'Gostivar', street: 'Braka Ginoski', zip: '1230', lat: 41.7967, lng: 20.9083 },
  { city: 'Kavadarci', street: 'Ilindenska', zip: '1430', lat: 41.4331, lng: 22.0119 },
];

const NAMES = [
  'Aurora', 'Vardar', 'Lumina', 'Kalina', 'Nova', 'Tivko', 'Sonce', 'Balans', 'Mira', 'Oaza',
  'Harmonija', 'Ritam', 'Dafina', 'Zora', 'Element', 'Struja', 'Vitalis', 'Kora', 'Bela', 'Lotus',
];
const SUFFIX: Record<string, string> = {
  Physiotherapy: 'Fizio', Massage: 'Massage Studio', Haircuts: 'Hair', 'Skin care': 'Skin Studio', Nails: 'Nails', 'Spa-Inclusive': 'Spa',
};
const PEOPLE = [
  ['Ana', 'Trajkovska'], ['Marko', 'Ilievski'], ['Elena', 'Stojanova'], ['Nikola', 'Petrov'], ['Jana', 'Ristova'],
  ['Stefan', 'Kostov'], ['Teodora', 'Mitreva'], ['Bojan', 'Naumov'], ['Ivana', 'Georgieva'], ['Darko', 'Angelov'],
  ['Marija', 'Dimitrova'], ['Filip', 'Todorov'], ['Sara', 'Jovanova'], ['Kristijan', 'Spasov'], ['Milena', 'Arsova'],
  ['Arta', 'Rexhepi'], ['Blerim', 'Hoxha'], ['Drita', 'Krasniqi'], ['Luan', 'Berisha'], ['Vesa', 'Gashi'],
];

/** A gallery photo that is honest about being a placeholder: a soft
 *  gradient with the salon's initial, a couple of kilobytes as SVG. */
function placeholderImage(name: string, hue: number, i: number): string {
  const initial = name.trim().charAt(0).toUpperCase();
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue},45%,82%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},50%,62%)"/>` +
    `</linearGradient></defs><rect width="1200" height="800" fill="url(#g)"/>` +
    `<circle cx="${300 + i * 200}" cy="${520 - i * 90}" r="${260 - i * 40}" fill="rgba(255,255,255,0.18)"/>` +
    `<text x="600" y="455" font-family="Georgia,serif" font-size="260" text-anchor="middle" fill="rgba(60,40,30,0.55)">${initial}</text>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

const day = (open: string, close: string, closed = false) => ({
  open, close, closed, split: false, open2: '15:00', close2: '19:00',
});
/** Three honest weeks: long days, a short Saturday, a Sunday that varies. */
function hoursFor(i: number): RegistrationDraft['hours'] {
  const sundayOpen = i % 3 === 0;
  const late = i % 2 === 0;
  const wd = day('09:00', late ? '20:00' : '18:00');
  return {
    mon: wd, tue: wd, wed: wd, thu: wd, fri: wd,
    sat: day('10:00', '16:00'),
    sun: sundayOpen ? day('10:00', '14:00') : day('10:00', '14:00', true),
  };
}

/** Exact (case-insensitive) match in the target taxonomy, else its first
 *  category — never a new one: approval would create it, and a removed
 *  batch must leave the global lists exactly as it found them. */
function snap(raw: string, allowed: string[]): string {
  const hit = allowed.find((c) => c.toLowerCase() === raw.toLowerCase());
  return hit ?? allowed[0] ?? raw;
}

export interface FixtureSalon {
  businessId: string;
  slug: string;
  name: string;
  city: string;
  type: string;
  ownerEmail: string;
  staff: string[];
}

export interface AddOptions {
  batch: string;
  count: number;
  /** RLS-exempt connection (the owner role) for tagging the batch. */
  adminUrl: string;
  log?: (line: string) => void;
}

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Add a batch. Refuses a batch name already in use — remove it first, or
 * pick another — so a batch is always the set one command made.
 */
export async function addFixtureBatch(opts: AddOptions): Promise<FixtureSalon[]> {
  const log = opts.log ?? (() => undefined);
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(opts.batch))
    throw new Error('A batch name is 2–41 chars of a-z, 0-9 and dashes, e.g. demo-2026-09');
  if (opts.count < 1 || opts.count > 40) throw new Error('count must be between 1 and 40');

  // Nothing may leave the building for addresses that do not exist:
  // the doors queue mails, and the transport is the mock for this run.
  process.env.MAIL_TRANSPORT = 'mock';
  const { db } = await import('./index.js');
  const { approveRegistration, createRegistration } = await import(
    '../modules/registrations/registrations.service.js'
  );

  const admin = new pg.Client({ connectionString: opts.adminUrl });
  await admin.connect();
  try {
    const taken = await admin.query(`SELECT count(*)::int AS n FROM businesses WHERE fixture_batch = $1`, [opts.batch]);
    if (taken.rows[0].n > 0)
      throw new Error(`Batch "${opts.batch}" already has ${taken.rows[0].n} salons — remove it first, or pick another name`);

    const svcCats = (await db.selectFrom('serviceCategories').select('name').orderBy('sort').orderBy('name').execute()).map((c) => c.name);
    const prodCats = (await db.selectFrom('productCategories').select('name').orderBy('sort').orderBy('name').execute()).map((c) => c.name);
    if (!svcCats.length) throw new Error('The target database has no service categories — seed the taxonomy first');

    const out: FixtureSalon[] = [];
    const fail = (e: unknown): never => {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`${msg}\n${out.length} salon(s) of batch "${opts.batch}" were made before this — \`fixtures remove --batch ${opts.batch}\` takes them away.`);
    };
    // A batch-wide offset spreads a second batch over other names and
    // places than the first, without a second list.
    const offset = [...opts.batch].reduce((a, c) => a + c.charCodeAt(0), 0);
    for (let i = 0; i < opts.count; i++) {
      const k = (offset + i) % KINDS.length;
      const kind = KINDS[k]!;
      const place = PLACES[(offset + i) % PLACES.length]!;
      const base = NAMES[(offset + i) % NAMES.length]!;
      const name = `${base} ${SUFFIX[kind.type] ?? kind.type}`;
      const slugBase = slugify(`${name}-${place.city}`);
      const [ownerFirst, ownerLast] = PEOPLE[(offset + i) % PEOPLE.length]!;
      // Addresses carry salon and batch, so two batches — or a batch
      // made twice — never collide on the platform's one-account-per-email rule.
      const mailTag = `${slugBase}.${opts.batch}`;
      const ownerEmail = `${slugify(ownerFirst!)}.${slugify(ownerLast!)}.${mailTag}@${FIXTURE_DOMAIN}`;
      const hue = (offset * 7 + i * 47) % 360;

      const draft: RegistrationDraft = {
        acct: { name: `${ownerFirst} ${ownerLast}`, email: ownerEmail, pass: FIXTURE_PASSWORD },
        salon: { name, type: snap(kind.type, svcCats), phone: `+389 7${(i % 8) + 1} ${String(100 + i * 37).padStart(3, '0')} ${String(200 + i * 53).padStart(3, '0')}`, langs: 'MK, EN' },
        legal: { name: `${name} DOOEL ${place.city}`, taxId: `MK40${String(30011500000 + offset * 97 + i * 13).slice(0, 11)}`, vat: '', currency: 'MKD' },
        loc: {
          street: place.street, no: String(3 + ((offset + i * 7) % 60)), city: place.city, zip: place.zip, country: 'MK',
          lat: place.lat + ((i % 5) - 2) * 0.0021, lng: place.lng + ((i % 7) - 3) * 0.0017,
        },
        services: kind.services.map((s) => ({ ...s, category: snap(s.category, svcCats) })),
        products: prodCats.length ? kind.products.map((p) => ({ ...p, category: snap(p.category, prodCats), sizeMl: null, stock: 0, cost: null })) : [],
        gallery: [0, 1, 2].map((g) => ({ name: g === 0 ? 'Front' : g === 1 ? 'Treatment room' : 'Reception', img: placeholderImage(base, hue, g), card: g === 0 })),
        team: [], // staff are made below, active and bookable — an invite is not a colleague you can book
        hours: hoursFor(offset + i),
      };

      try {
        const reg = await createRegistration(draft);
        const world = await approveRegistration(reg.id, 'fixtures');
        const businessId = world.businessId;
        // The tag first — the one thing that says "fixture", and the handle
        // `remove` works by. Written with the owner role (RLS is on
        // tenants), and before anything else, so a failure further down
        // still leaves a salon that `remove` can find.
        await admin.query(`UPDATE businesses SET fixture_batch = $1 WHERE id = $2`, [opts.batch, businessId]);

        // Staff: two or three, active, bookable, with passwords and skills
        // over most of the catalogue — the part a sign-up leaves as invites.
        const staffNames: string[] = [];
        const nStaff = 2 + (i % 2);
        const hash = await argon2.hash(FIXTURE_PASSWORD);
        await db.transaction().execute(async (trx) => {
          await sql`select set_config('app.tenant_id', ${businessId}, true)`.execute(trx);
          const role = await trx.selectFrom('roles').select('id').where('name', '=', 'Employee').executeTakeFirst();
          const loc = await trx.selectFrom('locations').select(['id', 'hours']).where('tenantId', '=', businessId).executeTakeFirstOrThrow();
          const services = await trx.selectFrom('services').select('id').where('tenantId', '=', businessId).orderBy('sort').execute();
          const palette = ['coral', 'sage', 'sky', 'plum'];
          // Colleagues are people other than the owner, and other than each
          // other: the address is the name, and one address is one account.
          const used = new Set<number>([(offset + i) % PEOPLE.length]);
          for (let s = 0; s < nStaff; s++) {
            let p = (offset + i * 3 + s + 1) % PEOPLE.length;
            while (used.has(p)) p = (p + 1) % PEOPLE.length;
            used.add(p);
            const [first, last] = PEOPLE[p]!;
            const staffId = randomUUID();
            const email = `${slugify(first!)}.${slugify(last!)}.${mailTag}@${FIXTURE_DOMAIN}`;
            await trx.insertInto('employees').values({
              id: staffId, tenantId: businessId, name: `${first} ${last}`, roleTitle: s === 0 ? 'Senior therapist' : 'Therapist',
              email, phone: null, access: 'staff', roleId: role?.id ?? null, bookable: true, status: 'active',
              color: palette[s % palette.length]!, hours: JSON.stringify(loc.hours),
            }).execute();
            await trx.insertInto('userCredentials').values({ employeeId: staffId, tenantId: businessId, passwordHash: hash }).execute();
            await trx.insertInto('employeeLocations').values({ tenantId: businessId, employeeId: staffId, locationId: loc.id }).execute();
            // Each colleague skips a different service, so "any professional" and
            // "this professional" can differ in the calendar.
            for (const [n, svc] of services.entries())
              if ((n + s) % 4 !== 3)
                await trx.insertInto('employeeSkills').values({ tenantId: businessId, employeeId: staffId, serviceId: svc.id }).execute();
            staffNames.push(`${first} ${last}`);
          }
          // The consumer card's pitch and the salon page's description —
          // merged into settings the way the Settings door merges them.
          const b = await trx.selectFrom('businesses').select('settings').where('id', '=', businessId).executeTakeFirstOrThrow();
          // Over the full, defaulted shape: a partial marketplace block
          // would fail the listing's parse and hide the salon.
          const settings = BusinessSettingsSchema.parse(b.settings ?? {});
          settings.marketplace = { ...settings.marketplace, pitch: kind.pitch, description: kind.description };
          await trx.updateTable('businesses')
            .set({ settings: JSON.stringify(settings), description: kind.description })
            .where('id', '=', businessId).execute();
        });

        const biz = await admin.query(`SELECT slug FROM businesses WHERE id = $1`, [businessId]);
        out.push({ businessId, slug: biz.rows[0].slug, name, city: place.city, type: kind.type, ownerEmail, staff: staffNames });
      } catch (e) {
        fail(e);
      }
      log(`+ ${name} (${place.city}) · owner ${ownerEmail}`);
    }
    return out;
  } finally {
    await admin.end();
  }
}

/** The batches present, with their salon counts. */
export async function listFixtureBatches(adminUrl: string): Promise<{ batch: string; salons: number; since: Date }[]> {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const r = await admin.query(
      `SELECT fixture_batch AS batch, count(*)::int AS salons, min(created_at) AS since
         FROM businesses WHERE fixture_batch IS NOT NULL GROUP BY 1 ORDER BY 3`,
    );
    return r.rows;
  } finally {
    await admin.end();
  }
}

/**
 * Remove a batch: every row of every tenant-scoped table for the batch's
 * businesses, in foreign-key order, then their registrations, then the
 * businesses themselves. The table list and the order come from the
 * schema at run time, so a tenant table added later is included by
 * construction. One transaction: all of it, or none of it.
 */
export async function removeFixtureBatch(batch: string, adminUrl: string): Promise<{ removed: number; tables: number }> {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query('BEGIN');
    const ids = (await admin.query(`SELECT id FROM businesses WHERE fixture_batch = $1 FOR UPDATE`, [batch])).rows.map(
      (r: { id: string }) => r.id,
    );
    if (!ids.length) {
      await admin.query('ROLLBACK');
      return { removed: 0, tables: 0 };
    }
    const tenantTables: string[] = (
      await admin.query(
        `SELECT table_name FROM information_schema.columns
          WHERE table_schema = 'public' AND column_name = 'tenant_id' ORDER BY table_name`,
      )
    ).rows.map((r: { table_name: string }) => r.table_name);
    // Child before parent: a table is deleted only after every table
    // that references it. Edges among the tenant tables only — the
    // others are not being deleted from.
    const edges: { child: string; parent: string }[] = (
      await admin.query(
        `SELECT DISTINCT tc.table_name AS child, ccu.table_name AS parent
           FROM information_schema.table_constraints tc
           JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
          WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
            AND tc.table_name <> ccu.table_name`,
      )
    ).rows;
    const set = new Set(tenantTables);
    const dependents = new Map<string, Set<string>>(); // parent → children
    for (const e of edges) {
      if (!set.has(e.child) || !set.has(e.parent)) continue;
      if (!dependents.has(e.parent)) dependents.set(e.parent, new Set());
      dependents.get(e.parent)!.add(e.child);
    }
    // Kahn's algorithm on the reversed graph: a parent becomes deletable
    // once all its children are gone.
    const remainingChildren = new Map<string, number>();
    for (const t of tenantTables) remainingChildren.set(t, dependents.get(t)?.size ?? 0);
    const order: string[] = [];
    const ready = tenantTables.filter((t) => remainingChildren.get(t) === 0);
    const parentsOf = new Map<string, string[]>();
    for (const e of edges) {
      if (!set.has(e.child) || !set.has(e.parent)) continue;
      if (!parentsOf.has(e.child)) parentsOf.set(e.child, []);
      parentsOf.get(e.child)!.push(e.parent);
    }
    while (ready.length) {
      const t = ready.shift()!;
      order.push(t);
      for (const p of new Set(parentsOf.get(t) ?? [])) {
        remainingChildren.set(p, remainingChildren.get(p)! - 1);
        if (remainingChildren.get(p) === 0) ready.push(p);
      }
    }
    if (order.length !== tenantTables.length)
      throw new Error(`Could not order tenant tables for deletion (cycle among: ${tenantTables.filter((t) => !order.includes(t)).join(', ')})`);

    // businesses.owner_employee_id points into employees: cut it first.
    await admin.query(`UPDATE businesses SET owner_employee_id = NULL WHERE id = ANY($1)`, [ids]);
    for (const t of order) await admin.query(`DELETE FROM ${t} WHERE tenant_id = ANY($1)`, [ids]);
    await admin.query(`DELETE FROM registrations WHERE business_id = ANY($1)`, [ids]);
    await admin.query(`DELETE FROM businesses WHERE id = ANY($1) AND fixture_batch = $2`, [ids, batch]);
    await admin.query('COMMIT');
    return { removed: ids.length, tables: order.length };
  } catch (e) {
    await admin.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await admin.end();
  }
}
