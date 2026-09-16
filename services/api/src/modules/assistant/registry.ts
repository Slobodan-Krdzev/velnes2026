import type { AssistantChangeSet, AssistantNavigate, PermKey } from '@velnes/contracts';
import type { AccessClaims } from '@velnes/contracts';
import { sql } from 'kysely';
import type { Trx } from '../../db/index.js';
import { createService, updateService } from '../catalog/catalog.crud.service.js';
import { createException, deleteException, listExceptions } from '../scheduling/scheduling.service.js';
import { createEmployee, updateEmployee } from '../team/team.service.js';
import { flightdeck } from '../flightdeck/flightdeck.service.js';

/**
 * The AI Assistant Action Registry (V1 — workspace surface).
 *
 * Each action is a thin, declarative wrapper over an EXISTING canonical
 * door. The Assistant never mutates directly: it resolves references to
 * IDs, validates, builds a structured preview + concurrency fingerprint,
 * and — only on explicit approval — calls the same service function the
 * normal UI calls, inside the caller's tenant transaction.
 *
 * `params` describe each action's arguments to the planner (they become
 * the tool's JSON schema). Destructive and role/permission/owner actions
 * are `navigate`-only in V1 (decision 4): the Assistant explains and
 * deep-links but never executes them.
 */

export interface PlannerParam {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
  required?: boolean;
  enum?: string[];
}
export interface ResolveResult {
  args: Record<string, unknown>;
  missing: string[];
  errors: { field: string; code: string; message: string }[];
}
export type Fingerprint = Record<string, unknown>;
export interface Conflict {
  field: string;
  was: string;
  now: string;
  proposed: string;
}
export interface PreviewResult {
  changeSet: AssistantChangeSet;
  fingerprint: Fingerprint;
}
export interface ExecResult {
  message: string;
  change: AssistantChangeSet;
}
export interface NavigateResult extends AssistantNavigate {
  message: string;
}

export interface ActionDef {
  id: string;
  app: 'workspace' | 'supplier';
  kind: 'read' | 'write' | 'navigate';
  risk: 'low' | 'medium' | 'high';
  permission: PermKey;
  required: string[];
  title: string;
  description: string; // handed to the planner
  params: PlannerParam[];
  resolve(trx: Trx, claims: AccessClaims, raw: Record<string, unknown>): Promise<ResolveResult>;
  read?(trx: Trx, claims: AccessClaims, args: Record<string, unknown>): Promise<string>;
  navigate?(trx: Trx, claims: AccessClaims, args: Record<string, unknown>): Promise<NavigateResult>;
  preview?(trx: Trx, claims: AccessClaims, args: Record<string, unknown>): Promise<PreviewResult>;
  checkFingerprint?(
    trx: Trx,
    claims: AccessClaims,
    args: Record<string, unknown>,
    fp: Fingerprint,
  ): Promise<Conflict | null>;
  execute?(trx: Trx, claims: AccessClaims, args: Record<string, unknown>): Promise<ExecResult>;
}

const mkd = (n: number) => `${Number(n).toLocaleString('en-US')} MKD`;
/** A model may fill a required field with a placeholder instead of leaving
 *  it out ("<UNKNOWN>", "n/a", "?"). Treat those as absent, not as a value. */
const PLACEHOLDER = /^(?:<.*>|unknown|n\/?a|tbd|none given|not specified|\?+|-+)$/i;
const str = (v: unknown) => {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  return PLACEHOLDER.test(s) ? '' : s;
};
/** Parse a price/amount from a string or number → whole MKD, or undefined. */
function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.replace(/[^\d.]/g, ''));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}
const bool = (v: unknown): boolean | undefined =>
  typeof v === 'boolean' ? v : typeof v === 'string' ? /^(true|yes|on|1)$/i.test(v.trim()) : undefined;

// ── shared resolvers ─────────────────────────────────────────────────
type SvcRow = { id: string; name: string; price: number; category: string | null };
async function resolveService(
  trx: Trx,
  raw: string,
): Promise<{ ok: true; svc: SvcRow } | { ok: false; code: 'AMBIGUOUS' | 'NOT_FOUND'; options: string[] }> {
  const name = raw.trim();
  const base = trx
    .selectFrom('services as s')
    .leftJoin('serviceCategories as c', 'c.id', 's.categoryId')
    .select(['s.id', 's.name', 's.price', 'c.name as category']);
  const exact = await base.where(sql<boolean>`lower(s.name) = ${name.toLowerCase()}`).execute();
  const hits = exact.length
    ? exact
    : await base.where(sql<boolean>`lower(s.name) like ${'%' + name.toLowerCase() + '%'}`).execute();
  if (hits.length === 1) return { ok: true, svc: hits[0] as SvcRow };
  if (hits.length > 1) return { ok: false, code: 'AMBIGUOUS', options: hits.map((h) => h.name) };
  const all = await trx.selectFrom('services').select('name').orderBy('name').limit(12).execute();
  return { ok: false, code: 'NOT_FOUND', options: all.map((a) => a.name) };
}

async function serviceCategoryNames(trx: Trx): Promise<string[]> {
  const rows = await trx.selectFrom('serviceCategories').select('name').orderBy('name').execute();
  return rows.map((r) => r.name);
}

const EVERYONE = /^(?:everyone|everybody|every one|all|all staff|anyone|any|any staff|whole team|the team)$/i;
/** Resolve "who performs this service" — a name list, or "everyone". Returns
 *  performerIds the canonical door understands: null = every worker; an array
 *  = exactly those employees. */
async function resolvePerformers(
  trx: Trx,
  raw: string,
): Promise<
  | { ok: true; ids: string[] | null; label: string }
  | { ok: false; code: 'NOT_FOUND' | 'AMBIGUOUS'; message: string }
> {
  const text = raw.trim();
  if (EVERYONE.test(text)) return { ok: true, ids: null, label: 'Everyone' };
  const staff = await trx
    .selectFrom('employees')
    .select(['id', 'name'])
    .where('status', '=', 'active')
    .orderBy('name')
    .execute();
  const names = text
    .split(/,|&|\band\b/i)
    .map((s) => s.trim())
    .filter(Boolean);
  const ids: string[] = [];
  const labels: string[] = [];
  for (const n of names) {
    const low = n.toLowerCase();
    const hits = staff.filter((e) => e.name.toLowerCase().includes(low));
    if (hits.length === 1) {
      ids.push(hits[0]!.id);
      labels.push(hits[0]!.name);
    } else if (hits.length > 1) {
      return { ok: false, code: 'AMBIGUOUS', message: `Several people match "${n}": ${hits.map((h) => h.name).join(', ')}. Which one?` };
    } else {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: `I couldn't find "${n}". Your team: ${staff.map((e) => e.name).join(', ')}. Or say "everyone".`,
      };
    }
  }
  if (!ids.length)
    return { ok: false, code: 'NOT_FOUND', message: `Who performs it? Your team: ${staff.map((e) => e.name).join(', ')}. Or say "everyone".` };
  return { ok: true, ids, label: labels.join(', ') };
}

type EmpRow = { id: string; name: string };
/** Resolve one employee by name under the caller's tenant (active staff). */
async function resolveEmployee(
  trx: Trx,
  raw: string,
): Promise<{ ok: true; emp: EmpRow } | { ok: false; code: 'AMBIGUOUS' | 'NOT_FOUND'; options: string[] }> {
  const staff = (await trx
    .selectFrom('employees')
    .select(['id', 'name'])
    .where('status', 'in', ['active', 'invited'])
    .orderBy('name')
    .execute()) as EmpRow[];
  const low = raw.trim().toLowerCase();
  const hits = staff.filter((e) => e.name.toLowerCase().includes(low));
  if (hits.length === 1) return { ok: true, emp: hits[0]! };
  if (hits.length > 1) return { ok: false, code: 'AMBIGUOUS', options: hits.map((e) => e.name) };
  return { ok: false, code: 'NOT_FOUND', options: staff.map((e) => e.name) };
}

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_ABBR: Record<string, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
const dayIndex = (w: string): number | undefined => {
  const s = w.trim().toLowerCase();
  const full = DAYS.indexOf(s);
  if (full >= 0) return full;
  return DAY_ABBR[s.slice(0, 3)];
};
/** Parse a day expression into weekday indices (0=Mon…6=Sun): "Mon-Fri",
 *  "weekdays", "weekend", "Monday and Wednesday", "Tue, Thu". */
function parseDays(raw: string): number[] {
  const s = raw.trim().toLowerCase();
  if (/weekday|working day|mon.*fri|every day.*except.*weekend/.test(s)) {
    if (/mon\w*\s*(?:-|to|–|—|through)\s*fri/.test(s)) return [0, 1, 2, 3, 4];
    if (/weekday|working day/.test(s)) return [0, 1, 2, 3, 4];
  }
  if (/weekend|sat\w*\s*(?:-|to|–|—|and)\s*sun/.test(s)) return [5, 6];
  if (/every ?day|all week|daily/.test(s)) return [0, 1, 2, 3, 4, 5, 6];
  // A range "X-Y" or "X to Y".
  const range = s.match(/([a-z]+)\s*(?:-|–|—|to|through)\s*([a-z]+)/);
  if (range) {
    const a = dayIndex(range[1]!);
    const b = dayIndex(range[2]!);
    if (a !== undefined && b !== undefined && a <= b) return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  }
  // A list of names.
  const out = new Set<number>();
  for (const w of s.split(/,|&|\band\b|\s+/)) {
    const i = dayIndex(w);
    if (i !== undefined) out.add(i);
  }
  return [...out].sort((x, y) => x - y);
}
const dayLabel = (i: number) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i] ?? '?';
const validTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
/** Normalise "9", "9:00", "9am", "17:30" → "HH:MM", or undefined. */
function toHHMM(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim().toLowerCase();
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return validTime(s) ? s : undefined;
  let h = Number(m[1]);
  const min = m[2] ?? '00';
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h > 23) return undefined;
  const out = `${String(h).padStart(2, '0')}:${min}`;
  return validTime(out) ? out : undefined;
}
type Week = Record<string, [string, string][] | null>;
async function currentWeek(trx: Trx, employeeId: string): Promise<Week> {
  const e = await trx.selectFrom('employees').select('hours').where('id', '=', employeeId).executeTakeFirst();
  return ((e?.hours as Week | null) ?? {}) as Week;
}

/** The flightdeck's own location pick: busiest by appointments, else the
 *  first active, else any — so a fresh salon still gets a status. */
async function primaryLocationId(trx: Trx): Promise<string | null> {
  const busiest = await trx
    .selectFrom('appointments')
    .select('locationId')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('kind', '=', 'appointment')
    .groupBy('locationId')
    .orderBy('n', 'desc')
    .executeTakeFirst();
  if (busiest?.locationId) return busiest.locationId;
  const active = await trx.selectFrom('locations').select('id').where('lifecycle', '=', 'ACTIVE').orderBy('createdAt').executeTakeFirst();
  if (active?.id) return active.id;
  return (await trx.selectFrom('locations').select('id').orderBy('createdAt').executeTakeFirst())?.id ?? null;
}

type LocRow = { id: string; name: string };
async function resolveLocation(
  trx: Trx,
  raw: string,
): Promise<
  { ok: true; loc: LocRow } | { ok: false; code: 'AMBIGUOUS' | 'NOT_FOUND' | 'NEEDED'; options: string[] }
> {
  const all = (await trx
    .selectFrom('locations')
    .select(['id', 'name'])
    .where('lifecycle', '<>', 'DRAFT')
    .orderBy('name')
    .execute()) as LocRow[];
  if (!raw) {
    if (all.length === 1) return { ok: true, loc: all[0]! };
    return { ok: false, code: 'NEEDED', options: all.map((l) => l.name) };
  }
  const low = raw.toLowerCase();
  const hits = all.filter((l) => l.name.toLowerCase().includes(low));
  if (hits.length === 1) return { ok: true, loc: hits[0]! };
  if (hits.length > 1) return { ok: false, code: 'AMBIGUOUS', options: hits.map((l) => l.name) };
  return { ok: false, code: 'NOT_FOUND', options: all.map((l) => l.name) };
}

/** Read the current base service into the fields a canonical PUT needs.
 *  Variants/modifiers/performers are omitted → updateService leaves them
 *  untouched, so an edit never disturbs the rest of the service. */
async function currentServiceWrite(trx: Trx, serviceId: string) {
  const s = await trx
    .selectFrom('services as s')
    .leftJoin('serviceCategories as c', 'c.id', 's.categoryId')
    .select([
      's.name',
      'c.name as category',
      's.durationMin',
      's.price',
      's.vat',
      's.status',
      's.pos',
      's.online',
      's.prepMin',
      's.resetMin',
    ])
    .where('s.id', '=', serviceId)
    .executeTakeFirstOrThrow();
  return s;
}

const svcErr = (field: string, r: { code: string; options: string[] }, name: string) => ({
  field,
  code: r.code,
  message:
    r.code === 'AMBIGUOUS'
      ? `Several services match "${name}": ${r.options.join(', ')}. Which one?`
      : `I couldn't find "${name}". Services: ${r.options.join(', ')}.`,
});

// ── read: list_services ──────────────────────────────────────────────
const listServices: ActionDef = {
  id: 'list_services',
  app: 'workspace',
  kind: 'read',
  risk: 'low',
  permission: 'catalog.view',
  required: [],
  title: 'List services',
  description: "List the salon's services with their prices.",
  params: [],
  async resolve() {
    return { args: {}, missing: [], errors: [] };
  },
  async read(trx) {
    const rows = await trx
      .selectFrom('services')
      .select(['name', 'price'])
      .where('status', '=', 'active')
      .orderBy('name')
      .execute();
    if (!rows.length) return 'There are no active services yet.';
    const list = rows.map((r) => `${r.name} (${mkd(r.price)})`).join(', ');
    return `You have ${rows.length} active service${rows.length === 1 ? '' : 's'}: ${list}.`;
  },
};

// ── read: read_service_price ─────────────────────────────────────────
const readServicePrice: ActionDef = {
  id: 'read_service_price',
  app: 'workspace',
  kind: 'read',
  risk: 'low',
  permission: 'catalog.view',
  required: ['serviceName'],
  title: 'Read a service price',
  description: 'Tell the user the current price of a named service.',
  params: [{ name: 'serviceName', type: 'string', description: 'The service to look up', required: true }],
  async resolve(trx, _claims, raw) {
    const serviceName = str(raw.serviceName);
    if (!serviceName) return { args: {}, missing: ['serviceName'], errors: [] };
    const r = await resolveService(trx, serviceName);
    if (!r.ok) return { args: { serviceName }, missing: [], errors: [svcErr('serviceName', r, serviceName)] };
    return { args: { serviceId: r.svc.id, serviceName: r.svc.name, price: r.svc.price }, missing: [], errors: [] };
  },
  async read(_trx, _claims, args) {
    return `${str(args.serviceName)} is ${mkd(Number(args.price))}.`;
  },
};

// ── read: business_status ("how am I doing today?") ─────────────────
const businessStatus: ActionDef = {
  id: 'business_status',
  app: 'workspace',
  kind: 'read',
  risk: 'low',
  permission: 'reports.view_own',
  required: [],
  title: 'Business status',
  description:
    "Summarise how the salon is doing right now in words — today's appointments and capacity, revenue, new customers, average spend, Velnes Premium member opportunities, and stock that needs attention. Use for questions like \"how am I doing today?\".",
  params: [],
  async resolve() {
    return { args: {}, missing: [], errors: [] };
  },
  async read(trx, claims) {
    // A whole-business question: aggregate today's figures across every
    // operating location (a booking at any location counts), then take the
    // tenant-wide items (new customers, Premium, stock) once. Reuses the
    // flightdeck door — the same numbers the dashboard shows.
    const locs = await trx
      .selectFrom('locations')
      .select('id')
      .where('lifecycle', '<>', 'DRAFT')
      .orderBy('createdAt')
      .execute();
    const locIds = locs.map((l) => l.id);
    if (!locIds.length) {
      const only = await primaryLocationId(trx);
      if (only) locIds.push(only);
    }
    if (!locIds.length) return "You don't have an operating location yet, so there's nothing to report.";

    // Sequentially (one transaction, one connection): sum the per-location
    // today fields; keep a representative deck for the tenant-wide ones.
    let bookedToday = 0;
    let totalSlots = 0;
    let revenueToday = 0;
    let noShows = 0;
    type Deck = Awaited<ReturnType<typeof flightdeck>>;
    let primary: Deck | null = null;
    for (const locId of locIds) {
      const f = await flightdeck(trx, { tenantId: claims.ten, locId, greetingName: '' });
      bookedToday += f.pulse.bookedToday;
      totalSlots += f.pulse.totalSlots;
      revenueToday += f.pulse.revenueToday;
      noShows += f.snapshot.noShows;
      if (!primary || f.pulse.bookedToday > primary.pulse.bookedToday) primary = f;
    }
    const f = primary!;
    const p = f.pulse;
    const capacityPct = totalSlots ? Math.round((bookedToday / totalSlots) * 100) : 0;
    const noShowPct = bookedToday ? Math.round((noShows / bookedToday) * 100) : 0;
    const many = locIds.length > 1;
    const lines: string[] = [];
    const delta = (d: number | null) => (d === null ? '' : d === 0 ? ' (flat)' : d > 0 ? ` (up ${d}%)` : ` (down ${Math.abs(d)}%)`);

    lines.push(
      `Appointments: ${bookedToday} of ${totalSlots} slot${totalSlots === 1 ? '' : 's'} booked today — ${capacityPct}% capacity${many ? ' across your locations' : ''}.`,
    );
    lines.push(`Revenue today: ${mkd(revenueToday)}.`);
    lines.push(`New customers this month: ${p.newCustomers}${delta(p.newCustomersDeltaPct)}.`);
    lines.push(`Average spend: ${mkd(p.avgSpend)}${delta(p.avgSpendDeltaPct)}.`);
    if (noShows > 0) lines.push(`No-shows today: ${noShows} (${noShowPct}%).`);
    if (f.memberRecs.count > 0)
      lines.push(
        `Velnes Premium: ${f.memberRecs.count} member opportunit${f.memberRecs.count === 1 ? 'y' : 'ies'} waiting, worth about ${mkd(f.memberRecs.value)}.`,
      );
    if (f.inventory.length) {
      const items = f.inventory
        .map((i) => `${i.name} (${i.soldOut ? 'sold out' : `${i.stock} left`})`)
        .join(', ');
      lines.push(`Stock to watch: ${items}.`);
    }
    if (f.opportunities.length) {
      const o = f.opportunities[0]!;
      lines.push(`Top opportunity: ${o.title}${o.value ? ` (about ${mkd(o.value)})` : ''} — ${o.detail}`);
    }
    return lines.join('\n');
  },
};

// ── write: create_service ────────────────────────────────────────────
const createServiceAction: ActionDef = {
  id: 'create_service',
  app: 'workspace',
  kind: 'write',
  risk: 'medium',
  permission: 'catalog.edit',
  required: ['name', 'price', 'durationMin', 'category', 'performers'],
  title: 'Create a service',
  description:
    'Create a new bookable service. Needs a name, a price in MKD, a duration in minutes, a category it belongs to (which must already exist), and who performs it (employee name(s), or "everyone").',
  params: [
    { name: 'name', type: 'string', description: 'The new service name', required: true },
    { name: 'price', type: 'number', description: 'Price in MKD', required: true },
    { name: 'durationMin', type: 'number', description: 'Duration in minutes', required: true },
    { name: 'category', type: 'string', description: 'An existing service category the service is filed under', required: true },
    { name: 'performers', type: 'string', description: 'Who performs this service — employee name(s), or "everyone"', required: true },
    { name: 'vat', type: 'number', description: 'VAT percent (optional, defaults to 18)' },
  ],
  async resolve(trx, _claims, raw) {
    const name = str(raw.name);
    const price = num(raw.price);
    const durationMin = num(raw.durationMin);
    const missing: string[] = [];
    if (!name) missing.push('name');
    if (price === undefined) missing.push('price');
    if (durationMin === undefined) missing.push('durationMin');
    const errors: ResolveResult['errors'] = [];
    if (price !== undefined && price < 0)
      errors.push({ field: 'price', code: 'BAD_PRICE', message: 'The price must be a positive number.' });
    if (durationMin !== undefined && (durationMin < 1 || durationMin > 24 * 60))
      errors.push({ field: 'durationMin', code: 'BAD_DURATION', message: 'Duration must be between 1 and 1440 minutes.' });
    const args: Record<string, unknown> = {};
    if (name) args.name = name;
    if (price !== undefined) args.price = Math.round(price);
    if (durationMin !== undefined) args.durationMin = Math.round(durationMin);
    if (raw.vat !== undefined && num(raw.vat) !== undefined) args.vat = Math.round(num(raw.vat)!);
    // Category is required — a service with no category is invisible in the
    // catalog (it groups by category), and must be one that already exists.
    const category = str(raw.category);
    if (!category) {
      missing.push('category');
      // Once we know the service, ask for its shelf and list the options.
      if (name) {
        const cats = await serviceCategoryNames(trx);
        errors.push({
          field: 'category',
          code: 'NEEDED',
          message: `Which category should "${name}" go under? You have: ${cats.join(', ') || '(none yet — create one in the catalog first)'}.`,
        });
      }
    } else {
      const cats = await serviceCategoryNames(trx);
      const hit = cats.find((c) => c.toLowerCase() === category.toLowerCase());
      if (!hit)
        errors.push({
          field: 'category',
          code: 'BAD_CATEGORY',
          message: `"${category}" isn't one of your categories: ${cats.join(', ') || '(none yet — create one in the catalog first)'}. Which category should it go under?`,
        });
      else args.category = hit;
    }
    // Who performs it — required (name list, or "everyone").
    const performers = str(raw.performers);
    if (!performers) {
      missing.push('performers');
      if (name) {
        const staff = await trx
          .selectFrom('employees')
          .select('name')
          .where('status', '=', 'active')
          .orderBy('name')
          .execute();
        errors.push({
          field: 'performers',
          code: 'NEEDED',
          message: `Who performs "${name}"? Your team: ${staff.map((e) => e.name).join(', ')}. Or say "everyone".`,
        });
      }
    } else {
      const r = await resolvePerformers(trx, performers);
      if (!r.ok) errors.push({ field: 'performers', code: r.code, message: r.message });
      else {
        args.performerIds = r.ids; // null = everyone; array = specific
        args.performersLabel = r.label;
      }
    }
    // Refuse an exact-name duplicate.
    if (name) {
      const dup = await trx
        .selectFrom('services')
        .select('id')
        .where(sql<boolean>`lower(name) = ${name.toLowerCase()}`)
        .executeTakeFirst();
      if (dup)
        errors.push({
          field: 'name',
          code: 'DUPLICATE',
          message: `A service called "${name}" already exists. Try editing it instead.`,
        });
    }
    return { args, missing, errors };
  },
  async preview(_trx, _claims, args) {
    const after: Record<string, unknown> = {
      name: str(args.name),
      price: Number(args.price),
      durationMin: Number(args.durationMin),
    };
    if (args.category) after.category = str(args.category);
    if (args.vat !== undefined) after.vat = Number(args.vat);
    if (args.performersLabel) after.performers = str(args.performersLabel);
    return {
      changeSet: { ops: [{ kind: 'create', entity: { type: 'service', label: str(args.name) }, after }] },
      fingerprint: { name: str(args.name).toLowerCase() },
    };
  },
  async checkFingerprint(trx, _claims, args) {
    // A create conflicts only if the name got taken meanwhile.
    const dup = await trx
      .selectFrom('services')
      .select('id')
      .where(sql<boolean>`lower(name) = ${str(args.name).toLowerCase()}`)
      .executeTakeFirst();
    if (dup)
      return { field: 'name', was: '—', now: 'already exists', proposed: str(args.name) };
    return null;
  },
  async execute(trx, claims, args) {
    const performerIds = (args.performerIds ?? null) as string[] | null;
    const id = await createService(trx, claims, {
      name: str(args.name),
      category: args.category ? str(args.category) : null,
      durationMin: Number(args.durationMin),
      price: Number(args.price),
      performerIds,
      ...(args.vat !== undefined ? { vat: Number(args.vat) } : {}),
    });
    const after: Record<string, unknown> = {
      name: str(args.name),
      price: Number(args.price),
      durationMin: Number(args.durationMin),
    };
    if (args.category) after.category = str(args.category);
    if (args.performersLabel) after.performers = str(args.performersLabel);
    return {
      message: `Created "${str(args.name)}" at ${mkd(Number(args.price))}${args.performersLabel ? `, performed by ${str(args.performersLabel)}` : ''}.`,
      change: { ops: [{ kind: 'create', entity: { type: 'service', id, label: str(args.name) }, after }] },
    };
  },
};

// ── write: edit_service (rename, recategorise, price, duration, tax, visibility) ──
const EDIT_FIELDS = ['newName', 'price', 'durationMin', 'category', 'vat', 'online', 'pos'] as const;
const editService: ActionDef = {
  id: 'edit_service',
  app: 'workspace',
  kind: 'write',
  risk: 'medium',
  permission: 'catalog.edit',
  required: ['serviceName'],
  title: 'Edit a service',
  description:
    'Change an existing service: its price, name, category, duration, VAT, or online/POS visibility — one field or several at once.',
  params: [
    { name: 'serviceName', type: 'string', description: 'The service to edit', required: true },
    { name: 'price', type: 'number', description: 'New price in MKD' },
    { name: 'newName', type: 'string', description: 'A new name for the service' },
    { name: 'category', type: 'string', description: 'An existing category to move it to' },
    { name: 'durationMin', type: 'number', description: 'New duration in minutes' },
    { name: 'vat', type: 'number', description: 'New VAT percent' },
    { name: 'online', type: 'boolean', description: 'Whether it is bookable online' },
    { name: 'pos', type: 'boolean', description: 'Whether it is sold at the till' },
  ],
  async resolve(trx, _claims, raw) {
    const serviceName = str(raw.serviceName);
    const errors: ResolveResult['errors'] = [];
    // Gather the requested edits.
    const edits: Record<string, unknown> = {};
    const price = num(raw.price);
    if (raw.price !== undefined) {
      if (price === undefined || price < 0)
        errors.push({ field: 'price', code: 'BAD_PRICE', message: 'The price must be a positive number.' });
      else edits.price = Math.round(price);
    }
    if (str(raw.newName)) edits.newName = str(raw.newName);
    if (raw.durationMin !== undefined) {
      const d = num(raw.durationMin);
      if (d === undefined || d < 1 || d > 24 * 60)
        errors.push({ field: 'durationMin', code: 'BAD_DURATION', message: 'Duration must be 1–1440 minutes.' });
      else edits.durationMin = Math.round(d);
    }
    if (raw.vat !== undefined && num(raw.vat) !== undefined) edits.vat = Math.round(num(raw.vat)!);
    if (raw.online !== undefined && bool(raw.online) !== undefined) edits.online = bool(raw.online);
    if (raw.pos !== undefined && bool(raw.pos) !== undefined) edits.pos = bool(raw.pos);
    const category = str(raw.category);
    if (category) {
      const cats = await serviceCategoryNames(trx);
      const hit = cats.find((c) => c.toLowerCase() === category.toLowerCase());
      if (!hit)
        errors.push({
          field: 'category',
          code: 'BAD_CATEGORY',
          message: `"${category}" isn't one of your categories: ${cats.join(', ') || '(none)'}.`,
        });
      else edits.category = hit;
    }
    if (!serviceName) return { args: { ...edits }, missing: ['serviceName'], errors };

    const r = await resolveService(trx, serviceName);
    if (!r.ok) return { args: { ...edits, serviceName }, missing: [], errors: [...errors, svcErr('serviceName', r, serviceName)] };

    // Need at least one field to change.
    const changed = EDIT_FIELDS.some((f) => edits[f] !== undefined);
    if (!changed && !errors.length)
      errors.push({
        field: 'change',
        code: 'NOTHING',
        message: `What would you like to change about "${r.svc.name}"? (price, name, category, duration, tax, or visibility)`,
      });
    return { args: { ...edits, serviceId: r.svc.id, serviceName: r.svc.name }, missing: [], errors };
  },
  async preview(trx, _claims, args) {
    const cur = await currentServiceWrite(trx, String(args.serviceId));
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const fp: Fingerprint = {};
    const put = (field: string, curVal: unknown, nextVal: unknown) => {
      before[field] = curVal;
      after[field] = nextVal;
      fp[field] = curVal;
    };
    if (args.price !== undefined) put('price', cur.price, Number(args.price));
    if (args.newName !== undefined) put('name', cur.name, str(args.newName));
    if (args.category !== undefined) put('category', cur.category, str(args.category));
    if (args.durationMin !== undefined) put('durationMin', cur.durationMin, Number(args.durationMin));
    if (args.vat !== undefined) put('vat', cur.vat, Number(args.vat));
    if (args.online !== undefined) put('online', cur.online, Boolean(args.online));
    if (args.pos !== undefined) put('pos', cur.pos, Boolean(args.pos));
    return {
      changeSet: {
        ops: [
          { kind: 'update', entity: { type: 'service', id: String(args.serviceId), label: str(args.serviceName) }, before, after },
        ],
      },
      fingerprint: fp,
    };
  },
  async checkFingerprint(trx, _claims, args, fp) {
    const cur = await currentServiceWrite(trx, String(args.serviceId));
    const map: Record<string, unknown> = {
      price: cur.price,
      name: cur.name,
      category: cur.category,
      durationMin: cur.durationMin,
      vat: cur.vat,
      online: cur.online,
      pos: cur.pos,
    };
    for (const [field, was] of Object.entries(fp)) {
      const now = map[field];
      if (now !== was)
        return {
          field: field === 'name' ? 'name' : field,
          was: field === 'price' ? mkd(Number(was)) : String(was),
          now: field === 'price' ? mkd(Number(now)) : String(now),
          proposed: field === 'price' && args.price !== undefined ? mkd(Number(args.price)) : '(your change)',
        };
    }
    return null;
  },
  async execute(trx, claims, args) {
    const cur = await currentServiceWrite(trx, String(args.serviceId));
    const write = {
      name: args.newName !== undefined ? str(args.newName) : cur.name,
      category: args.category !== undefined ? str(args.category) : cur.category,
      durationMin: args.durationMin !== undefined ? Number(args.durationMin) : cur.durationMin,
      price: args.price !== undefined ? Number(args.price) : cur.price,
      vat: args.vat !== undefined ? Number(args.vat) : cur.vat,
      status: cur.status,
      pos: args.pos !== undefined ? Boolean(args.pos) : cur.pos,
      online: args.online !== undefined ? Boolean(args.online) : cur.online,
      prepMin: cur.prepMin,
      resetMin: cur.resetMin,
    };
    await updateService(trx, claims, String(args.serviceId), write); // the canonical door
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    if (args.price !== undefined) { before.price = cur.price; after.price = Number(args.price); }
    if (args.newName !== undefined) { before.name = cur.name; after.name = str(args.newName); }
    if (args.category !== undefined) { before.category = cur.category; after.category = str(args.category); }
    if (args.durationMin !== undefined) { before.durationMin = cur.durationMin; after.durationMin = Number(args.durationMin); }
    if (args.vat !== undefined) { before.vat = cur.vat; after.vat = Number(args.vat); }
    if (args.online !== undefined) { before.online = cur.online; after.online = Boolean(args.online); }
    if (args.pos !== undefined) { before.pos = cur.pos; after.pos = Boolean(args.pos); }
    const label = args.newName !== undefined ? str(args.newName) : str(args.serviceName);
    return {
      message: `Updated "${label}".`,
      change: { ops: [{ kind: 'update', entity: { type: 'service', id: String(args.serviceId), label }, before, after }] },
    };
  },
};

// ── write: add_closure (a CLOSED day/range on a location) ────────────
const addClosure: ActionDef = {
  id: 'add_closure',
  app: 'workspace',
  kind: 'write',
  risk: 'medium',
  permission: 'locations.manage',
  required: ['date'],
  title: 'Close the salon on a date',
  description:
    'Mark a location closed on a date (or a date range). Dates must be ISO yyyy-mm-dd. Give a location name when the salon has more than one.',
  params: [
    { name: 'date', type: 'string', description: 'The (start) date, ISO yyyy-mm-dd', required: true },
    { name: 'endDate', type: 'string', description: 'End date for a range, ISO yyyy-mm-dd (optional)' },
    { name: 'location', type: 'string', description: 'Which location, if more than one' },
    { name: 'reason', type: 'string', description: 'A short reason (optional), e.g. "Public holiday"' },
  ],
  async resolve(trx, _claims, raw) {
    const errors: ResolveResult['errors'] = [];
    const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
    const date = str(raw.date);
    const endDate = str(raw.endDate);
    const args: Record<string, unknown> = {};
    if (date) {
      if (!isDate(date)) errors.push({ field: 'date', code: 'BAD_DATE', message: 'Give the date as yyyy-mm-dd.' });
      else args.date = date;
    }
    if (endDate) {
      if (!isDate(endDate)) errors.push({ field: 'endDate', code: 'BAD_DATE', message: 'Give the end date as yyyy-mm-dd.' });
      else if (date && endDate < date) errors.push({ field: 'endDate', code: 'BAD_RANGE', message: 'The end date is before the start.' });
      else args.endDate = endDate;
    }
    if (str(raw.reason)) args.reason = str(raw.reason);
    const missing: string[] = [];
    if (!date) missing.push('date');
    const loc = await resolveLocation(trx, str(raw.location));
    if (!loc.ok) {
      const msg =
        loc.code === 'NEEDED'
          ? `Which location? ${loc.options.join(', ')}.`
          : loc.code === 'AMBIGUOUS'
            ? `Several locations match: ${loc.options.join(', ')}. Which one?`
            : `I couldn't find that location. You have: ${loc.options.join(', ')}.`;
      errors.push({ field: 'location', code: loc.code, message: msg });
      missing.push('location'); // so continuation knows the next answer is a location
    } else {
      args.locationId = loc.loc.id;
      args.locationName = loc.loc.name;
    }
    return { args, missing, errors };
  },
  async preview(_trx, _claims, args) {
    const range = args.endDate ? `${str(args.date)} → ${str(args.endDate)}` : str(args.date);
    return {
      changeSet: {
        ops: [
          {
            kind: 'create',
            entity: { type: 'closure', label: `${str(args.locationName)} — ${range}` },
            after: { closed: range, ...(args.reason ? { reason: str(args.reason) } : {}) },
          },
        ],
      },
      fingerprint: { locationId: args.locationId, date: args.date },
    };
  },
  async execute(trx, _claims, args) {
    const ex = await createException(trx, String(args.locationId), {
      startDate: str(args.date),
      endDate: args.endDate ? str(args.endDate) : null,
      type: 'CLOSED',
      ...(args.reason ? { reason: str(args.reason) } : {}),
    });
    const range = args.endDate ? `${str(args.date)} → ${str(args.endDate)}` : str(args.date);
    return {
      message: `${str(args.locationName)} is now closed on ${range}.`,
      change: {
        ops: [{ kind: 'create', entity: { type: 'closure', id: ex.id, label: `${str(args.locationName)} — ${range}` }, after: { closed: range } }],
      },
    };
  },
};

// ── write: remove_closure (reopen a closed date) ─────────────────────
const removeClosure: ActionDef = {
  id: 'remove_closure',
  app: 'workspace',
  kind: 'write',
  risk: 'medium',
  permission: 'locations.manage',
  required: ['date'],
  title: 'Reopen a closed date',
  description: 'Remove a closure so the location opens again on that date. Date is ISO yyyy-mm-dd.',
  params: [
    { name: 'date', type: 'string', description: 'The closed date to reopen, ISO yyyy-mm-dd', required: true },
    { name: 'location', type: 'string', description: 'Which location, if more than one' },
  ],
  async resolve(trx, _claims, raw) {
    const errors: ResolveResult['errors'] = [];
    const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
    const date = str(raw.date);
    const args: Record<string, unknown> = {};
    const missing: string[] = [];
    if (!date) missing.push('date');
    else if (!isDate(date)) errors.push({ field: 'date', code: 'BAD_DATE', message: 'Give the date as yyyy-mm-dd.' });
    else args.date = date;
    const loc = await resolveLocation(trx, str(raw.location));
    if (!loc.ok) {
      errors.push({
        field: 'location',
        code: loc.code,
        message:
          loc.code === 'NEEDED'
            ? `Which location? ${loc.options.join(', ')}.`
            : `Which location? You have: ${loc.options.join(', ')}.`,
      });
      missing.push('location');
    } else if (date && isDate(date)) {
      const exs = await listExceptions(trx, loc.loc.id);
      const hit = exs.find((e) => e.startDate <= date && (e.endDate ?? e.startDate) >= date);
      if (!hit)
        errors.push({ field: 'date', code: 'NONE', message: `${loc.loc.name} has no closure on ${date}.` });
      else {
        args.exceptionId = hit.id;
        args.locationId = loc.loc.id;
        args.locationName = loc.loc.name;
      }
    }
    return { args, missing, errors };
  },
  async preview(_trx, _claims, args) {
    return {
      changeSet: {
        ops: [
          {
            kind: 'delete',
            entity: { type: 'closure', id: String(args.exceptionId), label: `${str(args.locationName)} — ${str(args.date)}` },
            before: { closed: str(args.date) },
          },
        ],
      },
      fingerprint: { exceptionId: args.exceptionId },
    };
  },
  async execute(trx, _claims, args) {
    await deleteException(trx, String(args.locationId), String(args.exceptionId));
    return {
      message: `${str(args.locationName)} is open again on ${str(args.date)}.`,
      change: {
        ops: [{ kind: 'delete', entity: { type: 'closure', id: String(args.exceptionId), label: `${str(args.locationName)} — ${str(args.date)}` }, before: { closed: str(args.date) } }],
      },
    };
  },
};

// ── navigate-only: delete a service (destructive → decision 4) ───────
const deleteServiceNav: ActionDef = {
  id: 'delete_service',
  app: 'workspace',
  kind: 'navigate',
  risk: 'high',
  permission: 'catalog.edit',
  required: ['serviceName'],
  title: 'Delete a service',
  description: 'Understand a request to delete/remove a service, but do NOT delete it — open it in the catalog instead.',
  params: [{ name: 'serviceName', type: 'string', description: 'The service the user wants to delete', required: true }],
  async resolve(trx, _claims, raw) {
    const serviceName = str(raw.serviceName);
    if (!serviceName) return { args: {}, missing: ['serviceName'], errors: [] };
    const r = await resolveService(trx, serviceName);
    if (!r.ok) return { args: { serviceName }, missing: [], errors: [svcErr('serviceName', r, serviceName)] };
    return { args: { serviceId: r.svc.id, serviceName: r.svc.name }, missing: [], errors: [] };
  },
  async navigate(_trx, _claims, args) {
    return {
      screen: '/catalog',
      entityId: String(args.serviceId),
      message: `Deleting a service is permanent and can affect past bookings, so I won't do it from here. I've opened "${str(args.serviceName)}" in the catalog — you can remove it there.`,
    };
  },
};

// ── navigate-only: roles / permissions / owner / team access ─────────
const manageAccessNav: ActionDef = {
  id: 'manage_access',
  app: 'workspace',
  kind: 'navigate',
  risk: 'high',
  permission: 'users.manage',
  required: [],
  title: 'Manage team access',
  description:
    "Understand a request to change someone's role, permissions or ownership, but do NOT change them — open Team & access instead.",
  params: [{ name: 'who', type: 'string', description: 'The person or role mentioned (optional)' }],
  async resolve(_trx, _claims, raw) {
    return { args: str(raw.who) ? { who: str(raw.who) } : {}, missing: [], errors: [] };
  },
  async navigate() {
    return {
      screen: '/settings',
      tab: 'team',
      message:
        "Roles and permissions decide what everyone can do, so I don't change them from chat. I've opened Team & access — you can manage roles and members there.",
    };
  },
};

// ── write: add_team_member (invite a basic member; roles stay navigate-only) ──
const addTeamMember: ActionDef = {
  id: 'add_team_member',
  app: 'workspace',
  kind: 'write',
  risk: 'medium',
  permission: 'users.manage',
  required: ['name', 'email'],
  title: 'Invite a team member',
  description:
    'Invite a new team member by name and email. They join as a basic member — assigning their role or permissions is done separately in Team & access.',
  params: [
    { name: 'name', type: 'string', description: "The person's full name", required: true },
    { name: 'email', type: 'string', description: 'Their email address', required: true },
    { name: 'phone', type: 'string', description: 'Phone number (optional)' },
    { name: 'bookable', type: 'boolean', description: 'Whether they take appointments (optional; default no)' },
  ],
  async resolve(trx, _claims, raw) {
    const name = str(raw.name);
    const email = str(raw.email).toLowerCase();
    const missing: string[] = [];
    if (!name) missing.push('name');
    if (!email) missing.push('email');
    const errors: ResolveResult['errors'] = [];
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      errors.push({ field: 'email', code: 'BAD_EMAIL', message: "That doesn't look like an email address." });
    if (email) {
      const taken = await trx
        .selectFrom('employees')
        .select('id')
        .where(sql<boolean>`lower(email) = ${email}`)
        .executeTakeFirst();
      if (taken) errors.push({ field: 'email', code: 'TAKEN', message: `Someone with ${email} is already on the team.` });
    }
    const args: Record<string, unknown> = {};
    if (name) args.name = name;
    if (email) args.email = email;
    if (str(raw.phone)) args.phone = str(raw.phone);
    if (raw.bookable !== undefined && bool(raw.bookable) !== undefined) args.bookable = bool(raw.bookable);
    return { args, missing, errors };
  },
  async preview(_trx, _claims, args) {
    const after: Record<string, unknown> = { name: str(args.name), email: str(args.email) };
    if (args.phone) after.phone = str(args.phone);
    if (args.bookable !== undefined) after.bookable = Boolean(args.bookable);
    return {
      changeSet: { ops: [{ kind: 'create', entity: { type: 'employee', label: str(args.name) }, after }] },
      fingerprint: { email: str(args.email) },
    };
  },
  async checkFingerprint(trx, _claims, args) {
    const taken = await trx
      .selectFrom('employees')
      .select('id')
      .where(sql<boolean>`lower(email) = ${str(args.email)}`)
      .executeTakeFirst();
    return taken ? { field: 'email', was: '—', now: 'already on the team', proposed: str(args.email) } : null;
  },
  async execute(trx, claims, args) {
    const emp = await createEmployee(trx, claims, {
      name: str(args.name),
      email: str(args.email),
      twofa: true,
      bookable: Boolean(args.bookable ?? false),
      ...(args.phone ? { phone: str(args.phone) } : {}),
    });
    const after: Record<string, unknown> = { name: emp.name, email: emp.email };
    if (args.phone) after.phone = str(args.phone);
    return {
      message: `Invited ${emp.name} (${emp.email}). Assign their role in Team & access when you're ready.`,
      change: { ops: [{ kind: 'create', entity: { type: 'employee', id: emp.id, label: emp.name }, after }] },
    };
  },
};

// ── write: edit_team_member (non-role fields only) ───────────────────
const editTeamMember: ActionDef = {
  id: 'edit_team_member',
  app: 'workspace',
  kind: 'write',
  risk: 'medium',
  permission: 'users.manage',
  required: ['employee'],
  title: 'Edit a team member',
  description:
    "Change a team member's name, job title, phone, or whether they take appointments. Changing their role, permissions or ownership is done in Team & access instead.",
  params: [
    { name: 'employee', type: 'string', description: 'Which team member', required: true },
    { name: 'newName', type: 'string', description: 'A new name' },
    { name: 'title', type: 'string', description: 'Their job title' },
    { name: 'phone', type: 'string', description: 'Phone number' },
    { name: 'bookable', type: 'boolean', description: 'Whether they take appointments' },
  ],
  async resolve(trx, _claims, raw) {
    const who = str(raw.employee);
    const errors: ResolveResult['errors'] = [];
    const edits: Record<string, unknown> = {};
    if (str(raw.newName)) edits.newName = str(raw.newName);
    if (str(raw.title)) edits.title = str(raw.title);
    if (raw.phone !== undefined) edits.phone = str(raw.phone); // may clear
    if (raw.bookable !== undefined && bool(raw.bookable) !== undefined) edits.bookable = bool(raw.bookable);
    if (!who) return { args: { ...edits }, missing: ['employee'], errors };
    const r = await resolveEmployee(trx, who);
    if (!r.ok)
      return {
        args: { ...edits, employee: who },
        missing: [],
        errors: [
          {
            field: 'employee',
            code: r.code,
            message:
              r.code === 'AMBIGUOUS'
                ? `Several people match "${who}": ${r.options.join(', ')}. Which one?`
                : `I couldn't find "${who}". Your team: ${r.options.join(', ')}.`,
          },
        ],
      };
    if (!['newName', 'title', 'phone', 'bookable'].some((f) => edits[f] !== undefined))
      errors.push({
        field: 'change',
        code: 'NOTHING',
        message: `What would you like to change about ${r.emp.name}? (name, job title, phone, or bookable)`,
      });
    return { args: { ...edits, employeeId: r.emp.id, employeeName: r.emp.name }, missing: [], errors };
  },
  async preview(trx, _claims, args) {
    const cur = await trx
      .selectFrom('employees')
      .select(['name', 'roleTitle', 'phone', 'bookable'])
      .where('id', '=', String(args.employeeId))
      .executeTakeFirstOrThrow();
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    if (args.newName !== undefined) { before.name = cur.name; after.name = str(args.newName); }
    if (args.title !== undefined) { before.title = cur.roleTitle; after.title = str(args.title); }
    if (args.phone !== undefined) { before.phone = cur.phone ?? '—'; after.phone = str(args.phone) || '—'; }
    if (args.bookable !== undefined) { before.bookable = cur.bookable; after.bookable = Boolean(args.bookable); }
    return {
      changeSet: {
        ops: [{ kind: 'update', entity: { type: 'employee', id: String(args.employeeId), label: str(args.employeeName) }, before, after }],
      },
      fingerprint: {},
    };
  },
  async execute(trx, claims, args) {
    const emp = await updateEmployee(trx, claims, String(args.employeeId), {
      ...(args.newName !== undefined ? { name: str(args.newName) } : {}),
      ...(args.title !== undefined ? { roleTitle: str(args.title) } : {}),
      ...(args.phone !== undefined ? { phone: str(args.phone) || null } : {}),
      ...(args.bookable !== undefined ? { bookable: Boolean(args.bookable) } : {}),
    });
    const after: Record<string, unknown> = {};
    if (args.newName !== undefined) after.name = str(args.newName);
    if (args.title !== undefined) after.title = str(args.title);
    if (args.phone !== undefined) after.phone = str(args.phone) || '—';
    if (args.bookable !== undefined) after.bookable = Boolean(args.bookable);
    return {
      message: `Updated ${emp.name}.`,
      change: { ops: [{ kind: 'update', entity: { type: 'employee', id: emp.id, label: emp.name }, after }] },
    };
  },
};

// ── write: set_working_hours (set named days to one period) ──────────
const setWorkingHours: ActionDef = {
  id: 'set_working_hours',
  app: 'workspace',
  kind: 'write',
  risk: 'medium',
  permission: 'users.manage',
  required: ['employee', 'days', 'start', 'end'],
  title: "Set a team member's working hours",
  description:
    "Set which hours a team member works on given days — e.g. Mon–Fri 09:00–17:00. Replaces those days' hours; other days are left as they are.",
  params: [
    { name: 'employee', type: 'string', description: 'Which team member', required: true },
    { name: 'days', type: 'string', description: 'Which days — e.g. "Mon-Fri", "weekdays", "Monday and Wednesday"', required: true },
    { name: 'start', type: 'string', description: 'Start time, HH:MM', required: true },
    { name: 'end', type: 'string', description: 'End time, HH:MM', required: true },
  ],
  async resolve(trx, _claims, raw) {
    const who = str(raw.employee);
    const missing: string[] = [];
    const errors: ResolveResult['errors'] = [];
    const args: Record<string, unknown> = {};
    const start = toHHMM(raw.start);
    const end = toHHMM(raw.end);
    if (!str(raw.start)) missing.push('start');
    else if (!start) errors.push({ field: 'start', code: 'BAD_TIME', message: 'Give the start time as HH:MM.' });
    else args.start = start;
    if (!str(raw.end)) missing.push('end');
    else if (!end) errors.push({ field: 'end', code: 'BAD_TIME', message: 'Give the end time as HH:MM.' });
    else args.end = end;
    if (start && end && end <= start)
      errors.push({ field: 'end', code: 'BAD_RANGE', message: 'The end time is before the start.' });
    if (!str(raw.days)) missing.push('days');
    else {
      const days = parseDays(str(raw.days));
      if (!days.length) errors.push({ field: 'days', code: 'BAD_DAYS', message: 'Try "Mon-Fri" or "Monday, Wednesday".' });
      else args.days = days;
    }
    if (!who) missing.push('employee');
    else {
      const r = await resolveEmployee(trx, who);
      if (!r.ok)
        errors.push({
          field: 'employee',
          code: r.code,
          message:
            r.code === 'AMBIGUOUS'
              ? `Several people match "${who}": ${r.options.join(', ')}. Which one?`
              : `I couldn't find "${who}". Your team: ${r.options.join(', ')}.`,
        });
      else {
        args.employeeId = r.emp.id;
        args.employeeName = r.emp.name;
      }
    }
    return { args, missing, errors };
  },
  async preview(_trx, _claims, args) {
    const days = (args.days as number[]).map(dayLabel).join(', ');
    return {
      changeSet: {
        ops: [
          {
            kind: 'update',
            entity: { type: 'hours', id: String(args.employeeId), label: `${str(args.employeeName)} — hours` },
            after: { days, hours: `${str(args.start)}–${str(args.end)}` },
          },
        ],
      },
      fingerprint: {},
    };
  },
  async execute(trx, claims, args) {
    const week = await currentWeek(trx, String(args.employeeId));
    const next: Week = { ...week };
    for (const d of args.days as number[]) next[String(d)] = [[String(args.start), String(args.end)]];
    const emp = await updateEmployee(trx, claims, String(args.employeeId), { hours: next });
    const days = (args.days as number[]).map(dayLabel).join(', ');
    return {
      message: `${emp.name} now works ${str(args.start)}–${str(args.end)} on ${days}.`,
      change: {
        ops: [
          {
            kind: 'update',
            entity: { type: 'hours', id: emp.id, label: `${emp.name} — hours` },
            after: { days, hours: `${str(args.start)}–${str(args.end)}` },
          },
        ],
      },
    };
  },
};

// ── write: add_split_shift (append a period to one day) ──────────────
const addSplitShift: ActionDef = {
  id: 'add_split_shift',
  app: 'workspace',
  kind: 'write',
  risk: 'medium',
  permission: 'users.manage',
  required: ['employee', 'day', 'start', 'end'],
  title: 'Add a split shift',
  description:
    "Add a second working period to one of a team member's days — e.g. a 14:00–18:00 shift on Tuesday alongside their morning.",
  params: [
    { name: 'employee', type: 'string', description: 'Which team member', required: true },
    { name: 'day', type: 'string', description: 'Which day — a single weekday', required: true },
    { name: 'start', type: 'string', description: 'Start time, HH:MM', required: true },
    { name: 'end', type: 'string', description: 'End time, HH:MM', required: true },
  ],
  async resolve(trx, _claims, raw) {
    const who = str(raw.employee);
    const missing: string[] = [];
    const errors: ResolveResult['errors'] = [];
    const args: Record<string, unknown> = {};
    const start = toHHMM(raw.start);
    const end = toHHMM(raw.end);
    if (!str(raw.start)) missing.push('start');
    else if (!start) errors.push({ field: 'start', code: 'BAD_TIME', message: 'Give the start time as HH:MM.' });
    else args.start = start;
    if (!str(raw.end)) missing.push('end');
    else if (!end) errors.push({ field: 'end', code: 'BAD_TIME', message: 'Give the end time as HH:MM.' });
    else args.end = end;
    if (start && end && end <= start)
      errors.push({ field: 'end', code: 'BAD_RANGE', message: 'The end time is before the start.' });
    if (!str(raw.day)) missing.push('day');
    else {
      const days = parseDays(str(raw.day));
      if (days.length !== 1) errors.push({ field: 'day', code: 'BAD_DAY', message: 'Which single day? e.g. "Tuesday".' });
      else args.day = days[0];
    }
    if (!who) missing.push('employee');
    else {
      const r = await resolveEmployee(trx, who);
      if (!r.ok)
        errors.push({
          field: 'employee',
          code: r.code,
          message:
            r.code === 'AMBIGUOUS'
              ? `Several people match "${who}": ${r.options.join(', ')}. Which one?`
              : `I couldn't find "${who}". Your team: ${r.options.join(', ')}.`,
        });
      else {
        args.employeeId = r.emp.id;
        args.employeeName = r.emp.name;
      }
    }
    return { args, missing, errors };
  },
  async preview(_trx, _claims, args) {
    return {
      changeSet: {
        ops: [
          {
            kind: 'update',
            entity: { type: 'hours', id: String(args.employeeId), label: `${str(args.employeeName)} — ${dayLabel(Number(args.day))}` },
            after: { adds: `${str(args.start)}–${str(args.end)}` },
          },
        ],
      },
      fingerprint: {},
    };
  },
  async execute(trx, claims, args) {
    const week = await currentWeek(trx, String(args.employeeId));
    const key = String(args.day);
    const existing = week[key] ?? [];
    const next: Week = { ...week, [key]: [...existing, [String(args.start), String(args.end)]] };
    const emp = await updateEmployee(trx, claims, String(args.employeeId), { hours: next });
    return {
      message: `Added ${str(args.start)}–${str(args.end)} on ${dayLabel(Number(args.day))} for ${emp.name}.`,
      change: {
        ops: [
          {
            kind: 'update',
            entity: { type: 'hours', id: emp.id, label: `${emp.name} — ${dayLabel(Number(args.day))}` },
            after: { adds: `${str(args.start)}–${str(args.end)}` },
          },
        ],
      },
    };
  },
};

const ALL: ActionDef[] = [
  businessStatus,
  listServices,
  readServicePrice,
  createServiceAction,
  editService,
  addClosure,
  removeClosure,
  addTeamMember,
  editTeamMember,
  setWorkingHours,
  addSplitShift,
  deleteServiceNav,
  manageAccessNav,
];

export function registryFor(app: 'workspace' | 'supplier'): ActionDef[] {
  return ALL.filter((a) => a.app === app);
}
export function actionById(id: string): ActionDef | undefined {
  return ALL.find((a) => a.id === id);
}
