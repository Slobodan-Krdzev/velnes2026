import {
  CI,
  type CustomerInsights,
  type CustomerProfile,
  type PersonalOffer,
} from '@velnes/contracts';
import type { Trx } from '../../db/index.js';
import { localIso } from '../scheduling/scheduling.service.js';
import { svcChoice } from '../catalog/catalog.service.js';
import { locLive } from '../locations/locations.service.js';

export class CustomerError extends Error {
  constructor(
    public code: 'NOT_FOUND' | 'LOC_NOT_LIVE' | 'WRONG_STATE',
    message: string,
  ) {
    super(message);
  }
}

/**
 * The one door: is this customer Velnes Premium? The membership is
 * PLATFORM truth mirrored read-only on the customer row; nobody
 * stores their own copy of the answer.
 */
export function isPremium(premium: unknown): boolean {
  const p = premium as { status?: string } | null;
  return p?.status === 'active';
}

/** Premium members earn 1.5× loyalty (HQ-set rule). */
export const PREMIUM_LOYALTY_MULT = 1.5;

export async function customerProfile(trx: Trx, id: string): Promise<CustomerProfile> {
  const c = await trx.selectFrom('customers').selectAll().where('id', '=', id).executeTakeFirst();
  if (!c) throw new CustomerError('NOT_FOUND', 'Unknown customer');
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    group: c.custGroup,
    since: c.since ? localIso(c.since) : null,
    visits: c.visits,
    spend: c.spend,
    points: c.points,
    prepaid: c.prepaid,
    blacklisted: c.blacklisted,
    noShows: c.noShows,
    note: c.note,
    birthday: c.birthday ? localIso(c.birthday) : null,
    tags: c.tags,
    premium: (c.premium as CustomerProfile['premium']) ?? null,
    isPremium: isPremium(c.premium),
  };
}

export async function activityLog(
  trx: Trx,
  tenantId: string,
  customerId: string,
  actorEmployeeId: string | null,
  type: string,
  refType = '',
  refId = '',
  meta: Record<string, unknown> = {},
) {
  await trx
    .insertInto('customerActivity')
    .values({
      tenantId,
      customerId,
      actorEmployeeId,
      type,
      refType,
      refId,
      meta: JSON.stringify(meta),
    })
    .execute();
}

/** Derived, never stored: 'expired' is a reading, not a field. */
export function poStatus(po: { status: string; validUntil: Date }): PersonalOffer['status'] {
  if (po.status === 'cancelled' || po.status === 'redeemed') return po.status;
  if (localIso(po.validUntil) < localIso(new Date())) return 'expired';
  return 'live';
}

/** All personal offers across customers — the marketing list. */
export async function personalOffersAll(trx: Trx): Promise<(PersonalOffer & { customerName: string })[]> {
  const rows = await trx
    .selectFrom('personalOffers as p')
    .innerJoin('services as s', 's.id', 'p.serviceId')
    .innerJoin('customers as c', 'c.id', 'p.customerId')
    .selectAll('p')
    .select(['s.name as serviceName', 'c.name as customerName'])
    .orderBy('p.createdAt', 'desc')
    .limit(100)
    .execute();
  return rows.map((p) => ({
    id: p.id,
    customerId: p.customerId,
    customerName: p.customerName,
    serviceId: p.serviceId,
    serviceName: p.serviceName,
    variantId: p.variantId,
    locationId: p.locationId,
    specialPrice: p.specialPrice,
    normalPrice: p.normalPrice,
    validUntil: localIso(p.validUntil),
    intent: p.intent,
    status: poStatus(p),
    createdAt: p.createdAt.toISOString(),
  }));
}

export async function personalOffersFor(trx: Trx, customerId: string): Promise<PersonalOffer[]> {
  const rows = await trx
    .selectFrom('personalOffers as p')
    .innerJoin('services as s', 's.id', 'p.serviceId')
    .selectAll('p')
    .select('s.name as serviceName')
    .where('p.customerId', '=', customerId)
    .orderBy('p.createdAt', 'desc')
    .execute();
  return rows.map((p) => ({
    id: p.id,
    customerId: p.customerId,
    serviceId: p.serviceId,
    serviceName: p.serviceName,
    variantId: p.variantId,
    locationId: p.locationId,
    specialPrice: p.specialPrice,
    normalPrice: p.normalPrice,
    validUntil: localIso(p.validUntil),
    intent: p.intent,
    status: poStatus(p),
    createdAt: p.createdAt.toISOString(),
  }));
}

/** The live personal offer priceFor() asks about — variant rule as
 *  the prototype: an offer without a variant covers every variant. */
export async function livePersonalOffer(
  trx: Trx,
  customerId: string,
  serviceId: string,
  variantId: string | null,
) {
  const rows = await trx
    .selectFrom('personalOffers')
    .selectAll()
    .where('customerId', '=', customerId)
    .where('serviceId', '=', serviceId)
    .where('status', '=', 'live')
    .execute();
  return rows.find(
    (p) => poStatus(p) === 'live' && (!p.variantId || p.variantId === variantId),
  );
}

export async function createPersonalOffer(
  trx: Trx,
  tenantId: string,
  actorEmployeeId: string,
  customerId: string,
  req: {
    serviceId: string;
    variantId?: string | null | undefined;
    locationId: string;
    specialPrice: number;
    validUntil: string;
    intent: string;
  },
) {
  // A promise you cannot keep is not an offer: the location must be
  // live before anything is promised there.
  if (!(await locLive(trx, req.locationId)))
    throw new CustomerError('LOC_NOT_LIVE', 'Personal offers need a live location');
  const customer = await trx
    .selectFrom('customers')
    .select('id')
    .where('id', '=', customerId)
    .executeTakeFirst();
  if (!customer) throw new CustomerError('NOT_FOUND', 'Unknown customer');
  // The normal price through the same door as calendar, till and
  // booking flow — the offer may not disagree with svcChoice.
  const normal = await svcChoice(trx, req.serviceId, req.locationId, req.variantId ?? null);
  const row = await trx
    .insertInto('personalOffers')
    .values({
      tenantId,
      customerId,
      serviceId: req.serviceId,
      variantId: req.variantId ?? null,
      locationId: req.locationId,
      specialPrice: req.specialPrice,
      normalPrice: normal.price,
      validUntil: new Date(req.validUntil),
      intent: req.intent,
      createdBy: actorEmployeeId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await activityLog(trx, tenantId, customerId, actorEmployeeId, 'offer_created', 'offer', row.id, {
    intent: req.intent,
    serviceId: req.serviceId,
    specialPrice: req.specialPrice,
  });
  return row;
}

export async function decidePersonalOffer(
  trx: Trx,
  tenantId: string,
  actorEmployeeId: string,
  id: string,
  action: 'cancel' | 'redeem',
) {
  const po = await trx
    .selectFrom('personalOffers')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!po) throw new CustomerError('NOT_FOUND', 'Unknown personal offer');
  if (action === 'redeem' && poStatus(po) !== 'live')
    throw new CustomerError('WRONG_STATE', 'Only a live offer can be redeemed');
  await trx
    .updateTable('personalOffers')
    .set({ status: action === 'cancel' ? 'cancelled' : 'redeemed' })
    .where('id', '=', id)
    .execute();
  await activityLog(
    trx,
    tenantId,
    po.customerId,
    actorEmployeeId,
    action === 'cancel' ? 'offer_cancelled' : 'offer_redeemed',
    'offer',
    id,
    action === 'redeem'
      ? { intent: po.intent, serviceId: po.serviceId, amount: po.specialPrice, override: true }
      : { intent: po.intent, serviceId: po.serviceId },
  );
}

const median = (ns: number[]): number | null => {
  if (!ns.length) return null;
  const v = ns.slice().sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m]! : Math.round((v[m - 1]! + v[m]!) / 2);
};
const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / 864e5);
const wdIdx = (iso: string) => (new Date(iso).getDay() + 6) % 7;

/**
 * custStats, the prototype's rules verbatim. "Completed" in this
 * world: the appointment's day has passed (or ended earlier today)
 * and it was not cancelled or a no-show — cancellations stay visible
 * in history but weigh nowhere. Products come from the customer's
 * invoices, joined to visits by day.
 */
export async function customerInsights(trx: Trx, cid: string): Promise<CustomerInsights> {
  const c = await trx.selectFrom('customers').selectAll().where('id', '=', cid).executeTakeFirst();
  if (!c) throw new CustomerError('NOT_FOUND', 'Unknown customer');
  const TODAY = localIso(new Date());
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();

  const appts = await trx
    .selectFrom('appointments as a')
    .leftJoin('employees as e', 'e.id', 'a.employeeId')
    .leftJoin('services as s', 's.id', 'a.serviceId')
    .selectAll('a')
    .select(['e.name as empName', 's.name as svcName'])
    .where('a.customerId', '=', cid)
    .where('a.status', 'in', ['booked', 'confirmed'])
    .where('a.kind', '=', 'appointment')
    .orderBy('a.date')
    .orderBy('a.startMin')
    .execute();
  const done = appts.filter((a) => {
    const d = localIso(a.date);
    return d < TODAY || (d === TODAY && a.startMin + a.durationMin <= nowMin);
  });

  const productLines = await trx
    .selectFrom('invoiceLines as l')
    .innerJoin('invoices as i', 'i.id', 'l.invoiceId')
    .leftJoin('products as p', 'p.id', 'l.productId')
    .select(['l.productId', 'l.qty', 'l.unitPrice', 'l.description', 'i.date', 'p.name as pname'])
    .where('i.customerId', '=', cid)
    .where('l.itemClass', '=', 'product')
    .execute();

  if (!done.length) {
    // No history: fall back to the recorded totals.
    const visits = c.visits;
    return {
      seeded: false,
      totals: {
        visits,
        spend: c.spend,
        avgSpend: visits ? Math.round(c.spend / visits) : 0,
        firstDate: c.since ? localIso(c.since) : null,
        lastDate: null,
      },
      firstVisit: null,
      lastVisit: null,
      services: [],
      products: [],
      times: [],
      weekdays: [],
      employees: [],
      cadence: { medianGapDays: null, sampleSize: 0, trend: null, steady: false },
      overdueDays: null,
      lapsedServices: [],
      favoriteService: null,
      favoriteProduct: null,
      retention: null,
    };
  }

  const hhmm = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const prodOn = (d: string) =>
    productLines
      .filter((l) => localIso(l.date) === d)
      .reduce((n, l) => n + l.qty * l.unitPrice, 0);

  const byDate = new Map<string, typeof done>();
  for (const a of done) {
    const d = localIso(a.date);
    byDate.set(d, [...(byDate.get(d) ?? []), a]);
  }
  const dates = [...byDate.keys()].sort();
  const visits = dates.length;
  const spend =
    done.reduce((n, a) => n + a.price, 0) +
    productLines.reduce((n, l) => n + l.qty * l.unitPrice, 0);

  const visitDetail = (d: string) => {
    const rows = byDate.get(d)!;
    return {
      date: d,
      rows: rows.map((a) => ({
        serviceId: a.serviceId,
        service: a.svcName ?? a.title ?? '—',
        employeeId: a.employeeId,
        employeeName: a.empName ?? '—',
        start: hhmm(a.startMin),
        end: hhmm(a.startMin + a.durationMin),
        amount: a.price,
      })),
      amount: rows.reduce((n, a) => n + a.price, 0) + prodOn(d),
    };
  };

  const smap = new Map<string, { serviceId: string | null; name: string; count: number; spend: number }>();
  for (const a of done) {
    const key = a.serviceId ?? a.svcName ?? '—';
    const s = smap.get(key) ?? {
      serviceId: a.serviceId,
      name: a.svcName ?? '—',
      count: 0,
      spend: 0,
    };
    s.count++;
    s.spend += a.price;
    smap.set(key, s);
  }
  const servicesAgg = [...smap.values()]
    .sort((a, b) => b.count - a.count)
    .map((s) => ({ ...s, pct: Math.round((s.count / done.length) * 100) }));

  const pmap = new Map<string, { productId: string | null; name: string; qty: number; spend: number }>();
  for (const l of productLines) {
    const key = l.productId ?? l.description;
    const p = pmap.get(key) ?? {
      productId: l.productId,
      name: l.pname ?? l.description,
      qty: 0,
      spend: 0,
    };
    p.qty += l.qty;
    p.spend += l.qty * l.unitPrice;
    pmap.set(key, p);
  }
  const productsAgg = [...pmap.values()].sort((a, b) => b.qty - a.qty);

  const hours = new Map<number, number>();
  const wds = new Map<number, number>();
  const emap = new Map<string, number>();
  const empNames = new Map<string, string>();
  for (const d of dates) {
    const first = byDate.get(d)![0]!;
    const h = Math.floor(first.startMin / 60);
    hours.set(h, (hours.get(h) ?? 0) + 1);
    wds.set(wdIdx(d), (wds.get(wdIdx(d)) ?? 0) + 1);
    if (first.employeeId) {
      emap.set(first.employeeId, (emap.get(first.employeeId) ?? 0) + 1);
      empNames.set(first.employeeId, first.empName ?? '—');
    }
  }
  const times = [...hours.entries()].map(([hour, count]) => ({ hour, count })).sort((a, b) => a.hour - b.hour);
  const weekdays = [...wds.entries()].map(([wd, count]) => ({ wd, count })).sort((a, b) => a.wd - b.wd);
  const employeesAgg = [...emap.entries()]
    .map(([empId, count]) => ({
      empId,
      name: empNames.get(empId) ?? '—',
      count,
      pct: Math.round((count / visits) * 100),
    }))
    .sort((a, b) => b.count - a.count);

  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) gaps.push(daysBetween(dates[i - 1]!, dates[i]!));
  const med = median(gaps);

  // A rhythm exists only when the spread is small enough — the
  // median always gives a number, the gate makes it honest.
  let steady = false;
  if (gaps.length >= CI.MIN_VISITS && med && med > 0) {
    const v = gaps.slice().sort((a, b) => a - b);
    const q1 = v[Math.floor(v.length * 0.25)]!;
    const q3 = v[Math.floor(v.length * 0.75)]!;
    steady = (q3 - q1) / med <= CI.RHYTHM_SPREAD;
  }
  let trend: 'up' | 'down' | 'flat' | null = null;
  const cutD = new Date();
  cutD.setDate(cutD.getDate() - CI.TREND_WINDOW);
  const cut = localIso(cutD);
  const rec: number[] = [];
  const older: number[] = [];
  for (let i = 1; i < dates.length; i++)
    (dates[i]! >= cut ? rec : older).push(daysBetween(dates[i - 1]!, dates[i]!));
  if (steady && rec.length >= 3 && older.length >= 3) {
    const mr = median(rec)!;
    const mo = median(older)!;
    trend = mo && Math.abs(mo - mr) / mo >= CI.TREND_PCT ? (mr < mo ? 'up' : 'down') : 'flat';
  }
  const sinceLast = daysBetween(dates[dates.length - 1]!, TODAY);
  const overdueDays = steady && med && sinceLast > med * CI.OVERDUE_FACTOR ? Math.round(sinceLast - med) : null;
  const lapsed = servicesAgg.filter((s) => {
    if (s.count < CI.LAPSE_MIN) return false;
    const lastOf = done.filter((a) => (a.serviceId ?? a.svcName) === (s.serviceId ?? s.name)).pop()!;
    return daysBetween(localIso(lastOf.date), TODAY) > CI.LAPSE_WINDOW;
  });

  return {
    seeded: true,
    totals: {
      visits,
      spend,
      avgSpend: Math.round(spend / visits),
      firstDate: dates[0]!,
      lastDate: dates[dates.length - 1]!,
    },
    firstVisit: visitDetail(dates[0]!),
    lastVisit: visitDetail(dates[dates.length - 1]!),
    services: servicesAgg,
    products: productsAgg,
    times,
    weekdays,
    employees: employeesAgg,
    cadence: { medianGapDays: med, sampleSize: gaps.length, trend, steady },
    overdueDays,
    lapsedServices: lapsed.map((s) => ({ serviceId: s.serviceId, name: s.name, count: s.count })),
    favoriteService: visits >= CI.MIN_VISITS && servicesAgg[0] ? servicesAgg[0] : null,
    favoriteProduct: productsAgg[0] ?? null,
    // 'returning'/'at_risk' only with a proven rhythm.
    retention: !steady ? null : overdueDays != null ? 'at_risk' : 'returning',
  };
}
