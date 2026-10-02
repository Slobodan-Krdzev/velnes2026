import { randomUUID } from 'node:crypto';
import { BusinessSettingsSchema, LOYALTY_RULES, appointmentPoints, type AmenityKey, type RegistrationDraft } from '@velnes/contracts';
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
  /** What this kind of place realistically offers — never everything. */
  amenities: AmenityKey[];
};

/** Six kinds of salon; each fixture takes one and its catalogue. Prices
 *  in whole MKD, durations in minutes — the shapes the wizard sends. */
const KINDS: Kind[] = [
  {
    type: 'Physiotherapy',
    amenities: ['wifi', 'free_parking', 'wheelchair_accessible', 'air_conditioning', 'waiting_area', 'private_treatment_rooms', 'changing_room'],
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
    amenities: ['wifi', 'waiting_area', 'private_treatment_rooms', 'air_conditioning', 'coffee_tea'],
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
    amenities: ['wifi', 'air_conditioning', 'waiting_area', 'coffee_tea', 'child_friendly'],
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
    amenities: ['wifi', 'air_conditioning', 'waiting_area', 'private_treatment_rooms', 'refreshments'],
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
    amenities: ['wifi', 'air_conditioning', 'waiting_area', 'coffee_tea'],
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
    amenities: ['free_parking', 'wifi', 'changing_room', 'shower', 'lockers', 'sauna', 'steam_room', 'hot_tub', 'swimming_pool', 'relaxation_area', 'couples_treatment_room', 'private_treatment_rooms'],
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
        products: prodCats.length ? kind.products.map((p) => ({ ...p, category: snap(p.category, prodCats), sizeMl: null, stock: 0, cost: null, img: null, description: null })) : [],
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
          // The place's facilities, as this kind of salon would have them.
          if (kind.amenities.length)
            await trx
              .insertInto('locationAmenities')
              .values(kind.amenities.map((key) => ({ tenantId: businessId, locationId: loc.id, key })))
              .execute();
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

/**
 * Give an existing batch its amenities (Alex, 2026-09-29): batches made
 * before amenities existed have locations with none. Each salon's kind
 * is read back from its name — the suffix the batch gave it — and its
 * locations get that kind's set, replaced whole. Idempotent. Real
 * salons are never touched: only rows tagged with the batch.
 */
export async function backfillFixtureAmenities(batch: string, adminUrl: string): Promise<{ salons: number; rows: number }> {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const salons = (await admin.query(`SELECT id, name FROM businesses WHERE fixture_batch = $1`, [batch])).rows as { id: string; name: string }[];
    let rows = 0;
    await admin.query('BEGIN');
    for (const s of salons) {
      const kind = KINDS.find((k) => s.name.endsWith(` ${SUFFIX[k.type] ?? k.type}`));
      if (!kind) continue;
      const locs = (await admin.query(`SELECT id FROM locations WHERE tenant_id = $1`, [s.id])).rows as { id: string }[];
      await admin.query(`DELETE FROM location_amenities WHERE tenant_id = $1`, [s.id]);
      for (const l of locs)
        for (const key of kind.amenities) {
          await admin.query(`INSERT INTO location_amenities (tenant_id, location_id, key) VALUES ($1, $2, $3)`, [s.id, l.id, key]);
          rows += 1;
        }
    }
    await admin.query('COMMIT');
    return { salons: salons.length, rows };
  } catch (e) {
    await admin.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await admin.end();
  }
}

/**
 * Give a batch believable reviews (Alex, 2026-09-30): fixture consumers
 * (accounts on the fixture domain) whose past visits at the salon are
 * really theirs — completed appointments, written the way the seed
 * writes them — and one review per visit, with variety: some with
 * words, some without, spread over the salon's professionals and
 * dimensions. Every fourth salon gets none, because a new salon has
 * none. Idempotent per batch: a salon that already has fixture reviews
 * is skipped. Everything lands in tenant-scoped tables, so `remove`
 * sweeps it; the fixture accounts go with the last batch that used them.
 */
export async function addFixtureReviews(batch: string, adminUrl: string): Promise<{ salons: number; reviews: number }> {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const WORDS: (string | null)[] = [
    'Great massage and a very clean salon.', null, 'Одлична услуга, многу чисто и пријатно.', 'Professional and on time — will be back.',
    null, 'Shërbim i shkëlqyer, ambient shumë i pastër.', 'Started ten minutes late, but the treatment itself was excellent.', null,
    'Топла препорака, персоналот е одличен.', 'Good, though the room was a little noisy.', null, 'Best haircut I have had in years.',
  ];
  try {
    const salons = (await admin.query(`SELECT id, name FROM businesses WHERE fixture_batch = $1 ORDER BY created_at`, [batch])).rows as { id: string; name: string }[];
    const hash = await argon2.hash(FIXTURE_PASSWORD);
    let reviews = 0;
    let touched = 0;
    await admin.query('BEGIN');
    for (const [i, s] of salons.entries()) {
      if (i % 4 === 3) continue; // the new salon: no reviews yet
      const had = await admin.query(`SELECT 1 FROM reviews WHERE tenant_id = $1 LIMIT 1`, [s.id]);
      if (had.rowCount) continue;
      const loc = (await admin.query(`SELECT id FROM locations WHERE tenant_id = $1 ORDER BY created_at LIMIT 1`, [s.id])).rows[0] as { id: string } | undefined;
      const staff = (await admin.query(`SELECT id FROM employees WHERE tenant_id = $1 AND bookable ORDER BY created_at`, [s.id])).rows as { id: string }[];
      const services = (await admin.query(`SELECT id FROM services WHERE tenant_id = $1 ORDER BY sort LIMIT 6`, [s.id])).rows as { id: string }[];
      if (!loc || !staff.length || !services.length) continue;
      touched += 1;
      const n = [42, 11, 27, 6, 18, 33, 9, 15][i % 8]!;
      for (let k = 0; k < n; k++) {
        const [first, last] = PEOPLE[(i * 7 + k * 3) % PEOPLE.length]!;
        const email = `${slugify(first!)}.${slugify(last!)}.client@${FIXTURE_DOMAIN}`;
        // One account per name; the address is the identity (its unique
        // index is on lower(email), which ON CONFLICT cannot name).
        let cu = await admin.query(`SELECT id FROM client_users WHERE lower(email) = lower($1)`, [email]);
        if (!cu.rowCount)
          cu = await admin.query(
            `INSERT INTO client_users (email, password_hash, first, last, lang, email_verified_at) VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
            [email, hash, first, last, ['en', 'mk', 'sq'][k % 3]],
          );
        const clientId = cu.rows[0].id as string;
        let cust = await admin.query(`SELECT customer_id FROM client_customer_links WHERE client_user_id = $1 AND tenant_id = $2`, [clientId, s.id]);
        let customerId: string;
        if (cust.rowCount) customerId = cust.rows[0].customer_id as string;
        else {
          cust = await admin.query(`INSERT INTO customers (tenant_id, name, email, cust_group) VALUES ($1, $2, $3, 'Regular') RETURNING id`, [s.id, `${first} ${last}`, email]);
          customerId = cust.rows[0].id as string;
          await admin.query(`INSERT INTO client_customer_links (client_user_id, tenant_id, customer_id) VALUES ($1, $2, $3)`, [clientId, s.id, customerId]);
        }
        const emp = staff[(k + i) % staff.length]!;
        const svc = services[(k * 2 + i) % services.length]!;
        const daysAgo = 3 + ((k * 11 + i * 5) % 170);
        const appt = await admin.query(
          `INSERT INTO appointments (tenant_id, location_id, date, start_min, duration_min, kind, status, title, service_id, employee_id, customer_id, price, source, client_user_id)
           VALUES ($1, $2, CURRENT_DATE - $3::int, $4, 45, 'appointment', 'confirmed', $5, $6, $7, $8, 1500, 'marketplace', $9) RETURNING id, date`,
          [s.id, loc.id, daysAgo, 540 + ((k * 7) % 14) * 30, `${first} ${last}`, svc.id, emp.id, customerId, clientId],
        );
        // Mostly happy, with honest dips: a salon at 4.6–4.9, never a flat 5.0.
        const dip = (k * 13 + i) % 9;
        const service = dip === 0 ? 3 : dip < 3 ? 4 : 5;
        const timing = dip === 1 ? 3 : dip < 4 ? 4 : 5;
        const cleanliness = dip === 2 ? 4 : 5;
        const professional = dip === 3 ? 3 : dip < 5 ? 4 : 5;
        await admin.query(
          `INSERT INTO reviews (tenant_id, location_id, appointment_id, client_user_id, customer_id, service_id, employee_id,
             service_rating, timing_rating, cleanliness_rating, professional_rating, body, appointment_date, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13::date + interval '1 day')`,
          [s.id, loc.id, appt.rows[0].id, clientId, customerId, svc.id, emp.id, service, timing, cleanliness, professional, WORDS[(k + i) % WORDS.length], appt.rows[0].date],
        );
        reviews += 1;
      }
    }
    await admin.query('COMMIT');
    return { salons: touched, reviews };
  } catch (e) {
    await admin.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await admin.end();
  }
}

/**
 * Booking changes (Alex, 2026-09-30) — every state the consumer and the
 * workspace can show, on the batch's first salon, for one fixture
 * consumer (changes.client@fixture.velnes.test, password
 * `velnes-fixture`): an ordinary upcoming visit; one inside a closed
 * cancellation window; a pending reschedule request; a declined one
 * waiting for the customer; an approved one; a kept original; a
 * customer cancellation; a cancellation that fed Premium; a prepaid
 * cancellation refunded; a prepaid cancellation whose refund failed.
 * Idempotent per batch: a salon that already has them is skipped.
 */
export async function addFixtureChanges(batch: string, adminUrl: string): Promise<{ salons: number; appointments: number }> {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const salons = (await admin.query(`SELECT id, name FROM businesses WHERE fixture_batch = $1 ORDER BY created_at LIMIT 1`, [batch])).rows as { id: string; name: string }[];
    const hash = await argon2.hash(FIXTURE_PASSWORD);
    let made = 0;
    let touched = 0;
    await admin.query('BEGIN');
    for (const s of salons) {
      const email = `changes.client@${FIXTURE_DOMAIN}`;
      let cu = await admin.query(`SELECT id FROM client_users WHERE lower(email) = lower($1)`, [email]);
      if (!cu.rowCount)
        cu = await admin.query(
          `INSERT INTO client_users (email, password_hash, first, last, lang, email_verified_at) VALUES ($1, $2, 'Slobodan', 'Krstevski', 'en', now()) RETURNING id`,
          [email, hash],
        );
      const clientId = cu.rows[0].id as string;
      const had = await admin.query(`SELECT 1 FROM appointments WHERE tenant_id = $1 AND client_user_id = $2 LIMIT 1`, [s.id, clientId]);
      if (had.rowCount) continue;
      const loc = (await admin.query(`SELECT id FROM locations WHERE tenant_id = $1 ORDER BY created_at LIMIT 1`, [s.id])).rows[0] as { id: string } | undefined;
      const staff = (await admin.query(`SELECT id, name FROM employees WHERE tenant_id = $1 AND bookable ORDER BY created_at`, [s.id])).rows as { id: string; name: string }[];
      const services = (await admin.query(`SELECT id, name FROM services WHERE tenant_id = $1 ORDER BY sort LIMIT 4`, [s.id])).rows as { id: string; name: string }[];
      if (!loc || !staff.length || !services.length) continue;
      touched += 1;
      let cust = await admin.query(`SELECT customer_id FROM client_customer_links WHERE client_user_id = $1 AND tenant_id = $2`, [clientId, s.id]);
      let customerId: string;
      if (cust.rowCount) customerId = cust.rows[0].customer_id as string;
      else {
        cust = await admin.query(`INSERT INTO customers (tenant_id, name, email, cust_group) VALUES ($1, 'Slobodan Krstevski', $2, 'Regular') RETURNING id`, [s.id, email]);
        customerId = cust.rows[0].id as string;
        await admin.query(`INSERT INTO client_customer_links (client_user_id, tenant_id, customer_id) VALUES ($1, $2, $3)`, [clientId, s.id, customerId]);
      }
      // A Premium member of this salon, so a released slot has somebody to be offered to.
      const member = await admin.query(
        `INSERT INTO customers (tenant_id, name, email, cust_group, premium) VALUES ($1, 'Marija Premium', $2, 'VIP', $3) RETURNING id`,
        [s.id, `marija.premium.${batch}@${FIXTURE_DOMAIN}`, JSON.stringify({ status: 'active', since: '2026-01-15', renews: '2027-01-15' })],
      );
      const emp = staff[0]!;
      const svc = (k: number) => services[k % services.length]!;
      const appt = async (o: { days: number; startMin: number; status?: string; cancelHours?: number; svc: number; price?: number; cancelledBy?: string; reason?: string; key?: string }) => {
        const r = await admin.query(
          `INSERT INTO appointments (tenant_id, location_id, date, start_min, duration_min, prep_min, reset_min, kind, status, title, service_id, employee_id, customer_id, price, source, client_user_id, cancel_hours, cancelled_at, cancelled_by, cancel_reason, idempotency_key)
           VALUES ($1, $2, CURRENT_DATE + $3::int, $4, 45, 0, 10, 'appointment', $5, 'Slobodan Krstevski', $6, $7, $8, $9, 'client', $10, $11, $12, $13, $14, $15) RETURNING id, date::text AS date`,
          [s.id, loc.id, o.days, o.startMin, o.status ?? 'booked', svc(o.svc).id, emp.id, customerId, o.price ?? 1500, clientId, o.cancelHours ?? 24,
            o.cancelledBy ? new Date(Date.now() - 86_400_000) : null, o.cancelledBy ?? null, o.reason ?? null, o.key ?? null],
        );
        made += 1;
        const id = r.rows[0].id as string;
        await line(id, 'Created', 'Slobodan Krstevski', 'client', {}, -3);
        return { id, date: r.rows[0].date as string };
      };
      const line = (id: string, what: string, by: string, source: string, meta: Record<string, unknown>, daysAgo: number) =>
        admin.query(
          `INSERT INTO appointment_history (tenant_id, appointment_id, what, by_name, source, meta, at) VALUES ($1, $2, $3, $4, $5, $6, now() + ($7::int * interval '1 day'))`,
          [s.id, id, what, by, source, JSON.stringify(meta), daysAgo],
        );
      const req = (appointmentId: string, o: { status: string; originalDate: string; originalStart: number; days: number; start: number; reason?: string; decision?: string }) =>
        admin.query(
          `INSERT INTO booking_change_requests (tenant_id, appointment_id, status, original_date, original_start_min, original_duration_min, original_employee_id, requested_date, requested_start_min, requested_employee_id, requested_by_client_user_id, requested_at, resolved_by_employee_id, resolved_at, decline_reason, customer_decision, decided_at)
           VALUES ($1, $2, $3, $4, $5, 45, $6, CURRENT_DATE + $7::int, $8, $6, $9, now() - interval '1 day', $10, $11, $12, $13, $14)`,
          [s.id, appointmentId, o.status, o.originalDate, o.originalStart, emp.id, o.days, o.start, clientId,
            o.status === 'pending' ? null : emp.id, o.status === 'pending' ? null : new Date(Date.now() - 3_600_000 * 20), o.reason ?? null, o.decision ?? null, o.decision ? new Date(Date.now() - 3_600_000 * 10) : null],
        );
      const paid = async (appointmentId: string, price: number, refund: 'refunded' | 'failed', chargeRef: string) => {
        const number = `FIX-${appointmentId.slice(0, 8).toUpperCase()}`;
        const inv = await admin.query(
          `INSERT INTO invoices (tenant_id, location_id, number, customer_id, customer_name, method, status, total, idempotency_key)
           VALUES ($1, $2, $3, $4, 'Slobodan Krstevski', 'Online card', $5, $6, $7) RETURNING id`,
          [s.id, loc.id, number, customerId, refund === 'refunded' ? 'Refunded' : 'Paid', price, `pay:${appointmentId}`],
        );
        await admin.query(
          `INSERT INTO invoice_lines (tenant_id, invoice_id, description, qty, unit_price, item_class, appointment_id) VALUES ($1, $2, 'Treatment', 1, $3, 'service', $4)`,
          [s.id, inv.rows[0].id, price, appointmentId],
        );
        await admin.query(
          `INSERT INTO refunds (tenant_id, appointment_id, invoice_id, amount, method, status, provider, charge_ref, provider_ref, requested_at, completed_at, attempts, failure_reason)
           VALUES ($1, $2, $3, $4, 'Online card', $5, 'mock', $6, $7, now() - interval '1 day', $8, $9, $10)`,
          [s.id, appointmentId, inv.rows[0].id, price, refund, chargeRef, refund === 'refunded' ? `mock_rf_${appointmentId.slice(0, 16)}` : null,
            refund === 'refunded' ? new Date(Date.now() - 86_000_000) : null, refund === 'refunded' ? 1 : 5, refund === 'failed' ? 'Mock provider refused the refund' : null],
        );
        await line(appointmentId, 'Refund requested', 'Slobodan Krstevski', 'system', { amount: price, method: 'Online card' }, -1);
        await line(appointmentId, refund === 'refunded' ? 'Refund completed' : 'Refund failed', 'mock', 'system', { amount: price }, -1);
      };
      const hm = (h: number, m = 0) => h * 60 + m;
      const plus = (iso: string, n: number) => {
        const d = new Date(`${iso}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + n);
        return d.toISOString().slice(0, 10);
      };

      // 1. An ordinary upcoming visit — cancellation still open.
      await appt({ days: 5, startMin: hm(10), svc: 0 });
      // 2. Inside a closed window: tomorrow at 10:00 with a 48-hour policy.
      await appt({ days: 1, startMin: hm(10), svc: 1, cancelHours: 48 });
      // 3. A pending reschedule request.
      const a3 = await appt({ days: 6, startMin: hm(11), svc: 2 });
      await req(a3.id, { status: 'pending', originalDate: a3.date, originalStart: hm(11), days: 8, start: hm(14) });
      await line(a3.id, 'Reschedule requested', 'Slobodan Krstevski', 'client', { from: `${a3.date} 11:00`, to: `${plus(a3.date, 2)} 14:00` }, -1);
      // 4. A declined request, waiting for the customer.
      const a4 = await appt({ days: 7, startMin: hm(9), svc: 3 });
      await req(a4.id, { status: 'declined', originalDate: a4.date, originalStart: hm(9), days: 9, start: hm(16), reason: 'Fully booked that afternoon' });
      await line(a4.id, 'Reschedule requested', 'Slobodan Krstevski', 'client', { from: `${a4.date} 09:00`, to: `${plus(a4.date, 2)} 16:00` }, -1);
      await line(a4.id, 'Reschedule declined', emp.name, 'staff', { reason: 'Fully booked that afternoon' }, -1);
      // 5. An approved reschedule: the visit already sits at the new time.
      const a5 = await appt({ days: 9, startMin: hm(12), svc: 0 });
      await req(a5.id, { status: 'approved', originalDate: a5.date, originalStart: hm(15), days: 9, start: hm(12) });
      await line(a5.id, 'Reschedule requested', 'Slobodan Krstevski', 'client', { from: `${a5.date} 15:00`, to: `${a5.date} 12:00` }, -2);
      await line(a5.id, 'Reschedule approved', emp.name, 'staff', { from: `${a5.date} 15:00`, to: `${a5.date} 12:00` }, -1);
      // 6. Declined, and the customer kept the original.
      const a6 = await appt({ days: 10, startMin: hm(13), svc: 1 });
      await req(a6.id, { status: 'resolved', originalDate: a6.date, originalStart: hm(13), days: 12, start: hm(10), reason: 'Therapist away that day', decision: 'keep' });
      await line(a6.id, 'Reschedule requested', 'Slobodan Krstevski', 'client', { from: `${a6.date} 13:00`, to: `${plus(a6.date, 2)} 10:00` }, -2);
      await line(a6.id, 'Reschedule declined', emp.name, 'staff', { reason: 'Therapist away that day' }, -1);
      await line(a6.id, 'Original appointment kept', 'Slobodan Krstevski', 'client', { when: `${a6.date} 13:00` }, -1);
      // 7. Cancelled by the customer, within the window.
      const a7 = await appt({ days: 4, startMin: hm(10), svc: 2, status: 'cancelled', cancelledBy: 'customer', reason: 'Cannot make it' });
      await line(a7.id, 'Cancelled', 'Slobodan Krstevski', 'client', { by: 'customer', reason: 'Cannot make it' }, -1);
      // 8. Cancelled, and the freed slot offered to Premium.
      const a8 = await appt({ days: 5, startMin: hm(14), svc: 3, status: 'cancelled', cancelledBy: 'customer' });
      await line(a8.id, 'Cancelled', 'Slobodan Krstevski', 'client', { by: 'customer' }, -1);
      await admin.query(
        `INSERT INTO member_recs (tenant_id, location_id, date, start_at, end_at, service_id, variant_id, employee_id, normal_price, rec_pct, rec_price, candidates, slot_key)
         VALUES ($1, $2, CURRENT_DATE + 5, '14:00', '14:45', $3, NULL, $4, 1500, 35, 975, $5, $6)`,
        [s.id, loc.id, svc(3).id, emp.id, JSON.stringify([{ cid: member.rows[0].id, name: 'Marija Premium', score: 40, why: ['reliable — no no-shows', 'inside their preferred time window'] }]), `${loc.id}|${plus(a8.date, 0)}|${emp.id}|14:00`],
      );
      // 9. Prepaid, cancelled, refunded.
      const a9 = await appt({ days: 6, startMin: hm(16), svc: 0, status: 'cancelled', cancelledBy: 'customer', price: 1800 });
      await line(a9.id, 'Cancelled', 'Slobodan Krstevski', 'client', { by: 'customer' }, -1);
      await paid(a9.id, 1800, 'refunded', 'mock_ch_fixture_ok');
      // 10. Prepaid, cancelled by the salon, the refund refused by the provider.
      const a10 = await appt({ days: 7, startMin: hm(17), svc: 1, status: 'cancelled', cancelledBy: 'salon', reason: 'Therapist ill', price: 2200 });
      await line(a10.id, 'Cancelled', emp.name, 'staff', { by: 'salon', reason: 'Therapist ill' }, -1);
      await paid(a10.id, 2200, 'failed', 'mock_ch_fixture_fail');
    }
    await admin.query('COMMIT');
    return { salons: touched, appointments: made };
  } catch (e) {
    await admin.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await admin.end();
  }
}

/**
 * Velnes Loyalty (Alex, 2026-09-30) — docs/LOYALTY.md §54: realistic
 * ledgers on the batch's first salon. Consumer A (the booking-changes
 * consumer, `changes.client@…`): the welcome bonus, a one-service
 * visit, its review, a two-service visit with two products — every
 * number from the rules, so the totals follow the confirmed formula.
 * Plus: a welcome-only consumer, an active one with many rows, a
 * consumer with none, and the visits that earn nothing (cancelled,
 * no-show, completed and unreviewed) beside a rescheduled visit that
 * earned exactly once. Rows are written directly, as the platform
 * would have written them; idempotent per batch.
 */
export async function addFixtureLoyalty(batch: string, adminUrl: string): Promise<{ consumers: number; rows: number }> {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const salon = (await admin.query(`SELECT id, name FROM businesses WHERE fixture_batch = $1 ORDER BY created_at LIMIT 1`, [batch])).rows[0] as { id: string; name: string } | undefined;
    if (!salon) return { consumers: 0, rows: 0 };
    const hash = await argon2.hash(FIXTURE_PASSWORD);
    const loc = (await admin.query(`SELECT id FROM locations WHERE tenant_id = $1 ORDER BY created_at LIMIT 1`, [salon.id])).rows[0] as { id: string } | undefined;
    const emp = (await admin.query(`SELECT id FROM employees WHERE tenant_id = $1 AND bookable ORDER BY created_at LIMIT 1`, [salon.id])).rows[0] as { id: string } | undefined;
    const services = (await admin.query(`SELECT id, name FROM services WHERE tenant_id = $1 ORDER BY sort LIMIT 3`, [salon.id])).rows as { id: string; name: string }[];
    if (!loc || !emp || services.length < 2) return { consumers: 0, rows: 0 };
    let rows = 0;
    let consumers = 0;
    await admin.query('BEGIN');
    const account = async (email: string, first: string, last: string, lang: string) => {
      let cu = await admin.query(`SELECT id FROM client_users WHERE lower(email) = lower($1)`, [email]);
      if (!cu.rowCount)
        cu = await admin.query(
          `INSERT INTO client_users (email, password_hash, first, last, lang, email_verified_at) VALUES ($1, $2, $3, $4, $5, now() - interval '20 days') RETURNING id`,
          [email, hash, first, last, lang],
        );
      const clientId = cu.rows[0].id as string;
      let link = await admin.query(`SELECT customer_id FROM client_customer_links WHERE client_user_id = $1 AND tenant_id = $2`, [clientId, salon.id]);
      let customerId: string;
      if (link.rowCount) customerId = link.rows[0].customer_id as string;
      else {
        link = await admin.query(`INSERT INTO customers (tenant_id, name, email, cust_group) VALUES ($1, $2, $3, 'Regular') RETURNING id`, [salon.id, `${first} ${last}`, email]);
        customerId = link.rows[0].customer_id ?? link.rows[0].id;
        await admin.query(`INSERT INTO client_customer_links (client_user_id, tenant_id, customer_id) VALUES ($1, $2, $3)`, [clientId, salon.id, customerId]);
      }
      return { clientId, customerId, name: `${first} ${last}` };
    };
    const ledger = async (clientId: string, type: string, points: number, sourceType: string | null, sourceId: string | null, meta: Record<string, unknown>, daysAgo: number) => {
      const r = await admin.query(
        `INSERT INTO client_loyalty_ledger (client_user_id, type, points, source_type, source_id, tenant_id, meta, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now() - ($8::int * interval '1 day'))
         ON CONFLICT DO NOTHING RETURNING id`,
        [clientId, type, points, sourceType, sourceId, sourceType === 'account' ? null : salon.id, JSON.stringify({ ruleVersion: LOYALTY_RULES.version, ...meta }), daysAgo],
      );
      if (r.rowCount) rows += 1;
      await admin.query(`UPDATE client_users SET loyalty_points = (SELECT COALESCE(SUM(points), 0) FROM client_loyalty_ledger WHERE client_user_id = $1) WHERE id = $1`, [clientId]);
    };
    const visit = async (a: { clientId: string; customerId: string; name: string }, daysAgo: number, startMin: number, svcs: string[], status = 'confirmed', products = 0) => {
      const key = randomUUID();
      const ids: string[] = [];
      let start = startMin;
      for (const [i, sid] of svcs.entries()) {
        const r = await admin.query(
          `INSERT INTO appointments (tenant_id, location_id, date, start_min, duration_min, kind, status, title, service_id, employee_id, customer_id, price, source, client_user_id, cancel_hours, idempotency_key, cancelled_by, cancelled_at)
           VALUES ($1, $2, CURRENT_DATE - $3::int, $4, 45, 'appointment', $5, $6, $7, $8, $9, 1500, 'client', $10, 24, $11, $12, $13) RETURNING id`,
          [salon.id, loc.id, daysAgo, start, status, a.name, sid, emp.id, a.customerId, a.clientId, svcs.length > 1 ? `${key}:${i + 1}` : key,
            status === 'cancelled' ? 'customer' : null, status === 'cancelled' ? new Date(Date.now() - daysAgo * 86_400_000) : null],
        );
        ids.push(r.rows[0].id as string);
        start += 45;
      }
      if (products > 0) {
        const number = `LOY-${ids[0]!.slice(0, 8).toUpperCase()}`;
        const inv = await admin.query(
          `INSERT INTO invoices (tenant_id, location_id, number, customer_id, customer_name, method, status, total, idempotency_key, date)
           VALUES ($1, $2, $3, $4, $5, 'Card', 'Paid', $6, $7, CURRENT_DATE - $8::int) RETURNING id`,
          [salon.id, loc.id, number, a.customerId, a.name, 1500 * svcs.length + 550 * products, `fixture:${ids[0]}`, daysAgo],
        );
        await admin.query(`INSERT INTO invoice_lines (tenant_id, invoice_id, description, qty, unit_price, item_class, appointment_id, sort) VALUES ($1, $2, 'Treatment', 1, 1500, 'service', $3, 0)`, [salon.id, inv.rows[0].id, ids[0]]);
        await admin.query(`INSERT INTO invoice_lines (tenant_id, invoice_id, description, qty, unit_price, item_class, sort) VALUES ($1, $2, 'Hair product', $3, 550, 'product', 1)`, [salon.id, inv.rows[0].id, products]);
      }
      return ids;
    };
    const awardVisit = async (a: { clientId: string }, ids: string[], serviceCount: number, productUnits: number, daysAgo: number) => {
      const pts = appointmentPoints(serviceCount, productUnits);
      await ledger(a.clientId, 'appointment_completed', pts.total, 'appointment', ids[0]!, { serviceCount, servicePoints: pts.servicePoints, productUnits, productPoints: pts.productPoints, total: pts.total, salonName: salon.name }, daysAgo);
    };

    // Consumer A — the booking-changes consumer, when present in this batch.
    const A = await account(`changes.client@${FIXTURE_DOMAIN}`, 'Slobodan', 'Krstevski', 'en');
    const had = await admin.query(`SELECT 1 FROM client_loyalty_ledger WHERE client_user_id = $1 LIMIT 1`, [A.clientId]);
    if (!had.rowCount) {
      consumers += 1;
      await ledger(A.clientId, 'registration_bonus', LOYALTY_RULES.registration, 'account', A.clientId, {}, 20);
      const v1 = await visit(A, 12, 600, [services[0]!.id]);
      await awardVisit(A, v1, 1, 0, 12);
      const rv = await admin.query(
        `INSERT INTO reviews (tenant_id, location_id, appointment_id, client_user_id, customer_id, service_id, employee_id, service_rating, timing_rating, cleanliness_rating, professional_rating, body, appointment_date, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 5, 4, 5, 5, 'Lovely, calm and on time.', CURRENT_DATE - 12, now() - interval '11 days') ON CONFLICT (appointment_id) DO NOTHING RETURNING id`,
        [salon.id, loc.id, v1[0], A.clientId, A.customerId, services[0]!.id, emp.id],
      );
      if (rv.rowCount) await ledger(A.clientId, 'review_submitted', LOYALTY_RULES.review, 'review', rv.rows[0].id, {}, 11);
      const v2 = await visit(A, 5, 660, [services[0]!.id, services[1]!.id], 'confirmed', 2);
      await awardVisit(A, v2, 2, 2, 5);
      // The visits that earn nothing, and the one that earned once.
      await visit(A, 3, 540, [services[1]!.id], 'cancelled');
      await visit(A, 2, 540, [services[0]!.id], 'no_show');
      await visit(A, 1, 900, [services[2]?.id ?? services[0]!.id]); // completed, unreviewed, not yet settled by the sweep in a fresh world
      const moved = await visit(A, 8, 720, [services[1]!.id]);
      await admin.query(
        `INSERT INTO booking_change_requests (tenant_id, appointment_id, status, original_date, original_start_min, original_duration_min, original_employee_id, requested_date, requested_start_min, requested_employee_id, requested_by_client_user_id, requested_at, resolved_by_employee_id, resolved_at)
         VALUES ($1, $2, 'approved', CURRENT_DATE - 9, 600, 45, $3, CURRENT_DATE - 8, 720, $3, $4, now() - interval '10 days', $3, now() - interval '10 days')`,
        [salon.id, moved[0], emp.id, A.clientId],
      );
      await awardVisit(A, moved, 1, 0, 8);
    }
    // Welcome only.
    const B = await account(`welcome.client@${FIXTURE_DOMAIN}`, 'Ana', 'Petrova', 'mk');
    if (!(await admin.query(`SELECT 1 FROM client_loyalty_ledger WHERE client_user_id = $1 LIMIT 1`, [B.clientId])).rowCount) {
      consumers += 1;
      await ledger(B.clientId, 'registration_bonus', LOYALTY_RULES.registration, 'account', B.clientId, {}, 6);
    }
    // Active: many visits, some products, a review or two.
    const C = await account(`active.client@${FIXTURE_DOMAIN}`, 'Bojana', 'Nikolova', 'sq');
    if (!(await admin.query(`SELECT 1 FROM client_loyalty_ledger WHERE client_user_id = $1 LIMIT 1`, [C.clientId])).rowCount) {
      consumers += 1;
      await ledger(C.clientId, 'registration_bonus', LOYALTY_RULES.registration, 'account', C.clientId, {}, 60);
      for (let k = 0; k < 7; k++) {
        const n = 1 + (k % 3);
        const products = k % 2 ? k % 4 : 0;
        const ids = await visit(C, 55 - k * 7, 540 + (k % 3) * 60, services.slice(0, n).map((s) => s.id), 'confirmed', products);
        await awardVisit(C, ids, n, products, 55 - k * 7);
        if (k % 3 === 0) {
          const rv = await admin.query(
            `INSERT INTO reviews (tenant_id, location_id, appointment_id, client_user_id, customer_id, service_id, employee_id, service_rating, timing_rating, cleanliness_rating, professional_rating, body, appointment_date, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 5, 5, 5, 4, NULL, CURRENT_DATE - $8::int, now() - ($8::int * interval '1 day') + interval '1 day') ON CONFLICT (appointment_id) DO NOTHING RETURNING id`,
            [salon.id, loc.id, ids[0], C.clientId, C.customerId, services[0]!.id, emp.id, 55 - k * 7],
          );
          if (rv.rowCount) await ledger(C.clientId, 'review_submitted', LOYALTY_RULES.review, 'review', rv.rows[0].id, {}, 54 - k * 7);
        }
      }
    }
    // Nothing at all: an account that exists and has never earned.
    await account(`quiet.client@${FIXTURE_DOMAIN}`, 'Marko', 'Stojanov', 'en');
    await admin.query('COMMIT');
    return { consumers, rows };
  } catch (e) {
    await admin.query('ROLLBACK').catch(() => undefined);
    throw e;
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
    // Fixture consumers (the reviews' authors) that no remaining salon links to.
    await admin.query(
      `DELETE FROM client_notifications WHERE client_user_id IN (
         SELECT id FROM client_users cu WHERE cu.email LIKE $1 AND NOT EXISTS (SELECT 1 FROM client_customer_links l WHERE l.client_user_id = cu.id))`,
      [`%@${FIXTURE_DOMAIN}`],
    );
    await admin.query(
      `DELETE FROM client_users cu WHERE cu.email LIKE $1 AND NOT EXISTS (SELECT 1 FROM client_customer_links l WHERE l.client_user_id = cu.id)`,
      [`%@${FIXTURE_DOMAIN}`],
    );
    await admin.query('COMMIT');
    return { removed: ids.length, tables: order.length };
  } catch (e) {
    await admin.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await admin.end();
  }
}
