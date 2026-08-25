import { randomUUID } from 'node:crypto';
import {
  MATCH,
  CI,
  PREMIUM_RULES,
  type CapacitySlot,
  type OfferPhase,
} from '@velnes/contracts';
import { sql } from 'kysely';
import type { Trx } from '../../db/index.js';
import { svcAt, svcTiming, svcVariants } from '../catalog/catalog.service.js';
import { activityLog, customerInsights, isPremium } from '../customers/customers.service.js';
import {
  hhmm,
  localIso,
  mins,
  scheduleFor,
  wdIdx,
  whList,
} from '../scheduling/scheduling.service.js';
import { DAY_END, DAY_START } from '../booking/booking.service.js';
import { effTreatment } from '../timing/timing.service.js';

export class MarketingError extends Error {
  constructor(
    public code: 'NOT_FOUND' | 'INVALID' | 'WRONG_STATE',
    message: string,
  ) {
    super(message);
  }
}

const capId = (locId: string, date: string, empId: string, start: string) =>
  `${locId}|${date}|${empId}|${start}`;
export const nowMins = () => new Date().getHours() * 60 + new Date().getMinutes();

/** The longest treatment this employee does that fits the gap.
 *  Variants count: a 90-minute massage is the same service. The
 *  duration is THIS employee's — a faster hand fits a longer
 *  treatment in the same gap. */
async function bestFill(
  trx: Trx,
  emp: { id: string; skills: string[] },
  locId: string,
  gap: number,
  roomBefore: number,
) {
  const services = await trx
    .selectFrom('services')
    .select(['id'])
    .where('status', '=', 'active')
    .execute();
  let best: {
    serviceId: string;
    variantId: string | null;
    dur: number;
    price: number;
    prepMin: number;
    resetMin: number;
    operationalMin: number;
  } | null = null;
  for (const sv of services) {
    if (emp.skills.length && !emp.skills.includes(sv.id)) continue;
    const at = await svcAt(trx, sv.id, locId);
    if (!at.active) continue;
    const w = await svcTiming(trx, sv.id, locId);
    // Same rule as the gate: prep never starts before the window is
    // open, so the first opportunity of a window carries none.
    const prep = Math.max(0, Math.min(w.prep, roomBefore));
    const options: { variantId: string | null; dur: number; price: number }[] = [
      { variantId: null, dur: (await effTreatment(trx, sv.id, locId, null, emp.id)).min, price: at.price },
    ];
    for (const v of (await svcVariants(trx, sv.id, locId)).filter((x) => x.active))
      options.push({
        variantId: v.id,
        dur: (await effTreatment(trx, sv.id, locId, v.id, emp.id)).min,
        price: v.price,
      });
    for (const o of options) {
      if (prep + o.dur + w.reset > gap) continue;
      if (!best || o.dur > best.dur || (o.dur === best.dur && o.price > best.price))
        best = {
          serviceId: sv.id,
          variantId: o.variantId,
          dur: o.dur,
          price: o.price,
          prepMin: prep,
          resetMin: w.reset,
          operationalMin: prep + o.dur + w.reset,
        };
    }
  }
  return best;
}

/** The gaps of one day at one location — the single capacity source
 *  the flightdeck, the offer drawer and the Premium scan all read. */
export async function openCapacity(trx: Trx, locId: string, date: string): Promise<CapacitySlot[]> {
  const sch = await scheduleFor(trx, locId, date);
  if (!sch.open) return [];
  const wd = wdIdx(date);
  const fromNow = date === localIso(new Date()) ? nowMins() : 0;
  const emps = await trx
    .selectFrom('employees as e')
    .innerJoin('employeeLocations as el', 'el.employeeId', 'e.id')
    .selectAll('e')
    .where('el.locationId', '=', locId)
    .where('e.bookable', '=', true)
    .where('e.status', '=', 'active')
    .execute();
  const svcNames = new Map(
    (await trx.selectFrom('services').select(['id', 'name']).execute()).map((s) => [s.id, s.name]),
  );
  const out: CapacitySlot[] = [];
  for (const e of emps) {
    const skills = (
      await trx.selectFrom('employeeSkills').select('serviceId').where('employeeId', '=', e.id).execute()
    ).map((s) => s.serviceId);
    const hours = (e.hours ?? {}) as Record<string, unknown>;
    const win = whList(hours[String(wd)]);
    if (!win.length) continue;
    // The employee's window clipped to what the shop keeps open — an
    // exception on the opening hours cuts in automatically, because
    // scheduleFor is the only one who speaks about that.
    const blocks: [number, number][] = [];
    for (const v of win)
      for (const per of sch.periods) {
        const a = Math.max(mins(v[0]), mins(per[0]));
        const b = Math.min(mins(v[1]), mins(per[1]));
        if (b > a) blocks.push([a, b]);
      }
    const appts = await trx
      .selectFrom('appointments')
      .select(['startMin', 'durationMin', 'prepMin', 'resetMin'])
      .where('employeeId', '=', e.id)
      .where('date', '=', new Date(date))
      .where('status', 'not in', ['cancelled'])
      .execute();
    const busy = appts
      .map((a) => [a.startMin - a.prepMin, a.startMin + a.durationMin + a.resetMin] as [number, number])
      .sort((x, y) => x[0] - y[0]);
    for (const [winA, winB] of blocks.sort((x, y) => x[0] - y[0])) {
      let from = Math.max(winA, fromNow);
      for (const [bs, be] of busy.filter(([s, en]) => en > from && s < winB).concat([[winB, winB]])) {
        if (bs > from) {
          const gap = bs - from;
          const cand = await bestFill(trx, { id: e.id, skills }, locId, gap, from - winA);
          if (cand)
            out.push({
              id: capId(locId, date, e.id, hhmm(from)),
              locationId: locId,
              date,
              empId: e.id,
              empName: e.name,
              start: hhmm(from + cand.prepMin),
              blockStart: hhmm(from),
              dur: cand.dur,
              prepMin: cand.prepMin,
              resetMin: cand.resetMin,
              operationalMin: cand.operationalMin,
              serviceId: cand.serviceId,
              serviceName: svcNames.get(cand.serviceId) ?? '—',
              variantId: cand.variantId,
              price: cand.price,
              gap,
            });
        }
        from = Math.max(from, be);
      }
    }
  }
  return out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

// ── The offer: one thing, several phases. ─────────────────────────

function phaseLive(ph: OfferPhase, nowM: number) {
  if (ph.startsAt && nowM < mins(ph.startsAt)) return false;
  if (ph.endsAt && nowM >= mins(ph.endsAt)) return false;
  return true;
}

export async function phaseAllows(trx: Trx, ph: OfferPhase, custId: string | null) {
  if (ph.audience === 'PUBLIC') return true;
  if (!custId) return false;
  if (ph.audience === 'SPECIFIC_CUSTOMERS') return ph.customerIds.includes(custId);
  const c = await trx.selectFrom('customers').select('premium').where('id', '=', custId).executeTakeFirst();
  return !!c && isPremium(c.premium);
}

export function applyRule(ph: OfferPhase, price: number) {
  if (ph.discountType === 'fixed_promo_price') return Math.max(0, ph.discountValue);
  return Math.max(0, Math.round(price * (1 - ph.discountValue / 100)));
}

export function offerLabel(ph: OfferPhase) {
  return ph.discountType === 'fixed_promo_price'
    ? 'Last-minute price'
    : `Last-minute — ${ph.discountValue}% off`;
}

/** Which phase applies to this opportunity right now? The first live
 *  one — phases do not overlap, so it is at most one. Not stackable:
 *  one place, one moment, one offer price. */
export async function offerFor(trx: Trx, slotId: string, nowM: number) {
  const rows = await trx
    .selectFrom('lastMinuteOffers')
    .selectAll()
    .where('status', '=', 'live')
    .where(sql<boolean>`${slotId} = ANY(slot_ids)`)
    .execute();
  for (const o of rows) {
    const phases = o.phases as OfferPhase[];
    const ph = phases.find((p) => phaseLive(p, nowM));
    if (ph) return { offer: o, phase: ph };
  }
  return null;
}

export async function createOffer(
  trx: Trx,
  tenantId: string,
  actorId: string,
  req: {
    locationId: string;
    date: string;
    pickedSlotIds: string[];
    vipPct: number;
    vipFrom: string;
    vipUntil: string;
    publicOn: boolean;
    publicPct: number;
  },
) {
  if (mins(req.vipUntil) <= mins(req.vipFrom))
    throw new MarketingError('INVALID', 'Early access ends before it starts');
  const caps = await openCapacity(trx, req.locationId, req.date);
  const picked = caps.filter((c) => req.pickedSlotIds.includes(c.id));
  if (!picked.length) throw new MarketingError('INVALID', 'Pick at least one empty slot');
  // Phase 1 belongs to the members: the early window is Velnes
  // Premium's, not a private customer group's.
  const phases: OfferPhase[] = [
    {
      startsAt: req.vipFrom,
      endsAt: req.vipUntil,
      audience: 'PREMIUM_MEMBERS',
      customerIds: [],
      discountType: 'percentage_discount',
      discountValue: req.vipPct,
    },
  ];
  if (req.publicOn)
    phases.push({
      startsAt: req.vipUntil,
      endsAt: null,
      audience: 'PUBLIC',
      customerIds: [],
      discountType: 'percentage_discount',
      discountValue: req.publicPct,
    });
  const slots: Record<string, CapacitySlot> = {};
  for (const c of picked) slots[c.id] = c;
  return trx
    .insertInto('lastMinuteOffers')
    .values({
      tenantId,
      locationId: req.locationId,
      date: new Date(req.date),
      slotIds: picked.map((c) => c.id),
      slots: JSON.stringify(slots),
      phases: JSON.stringify(phases),
      createdBy: actorId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

// ── The Velnes Premium pipeline. ──────────────────────────────────

const median = (ns: number[]) => {
  if (!ns.length) return null;
  const v = ns.slice().sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m]! : Math.round((v[m - 1]! + v[m]!) / 2);
};
void median;

/** Suitability, transparently weighed — every point names its why. */
export async function memberScore(
  trx: Trx,
  cid: string,
  slot: { serviceId: string; empId: string | null; date: string; hour: number },
) {
  const st = await customerInsights(trx, cid);
  let score = 0;
  const why: string[] = [];
  const svc = st.services.find((s) => s.serviceId === slot.serviceId);
  if (svc && svc.count >= MATCH.SVC_MIN) {
    score += MATCH.SVC;
    why.push(`booked ${svc.name} ${svc.count}×`);
  }
  const topEmp = st.employees[0];
  if (slot.empId && topEmp && topEmp.empId === slot.empId && topEmp.pct >= CI.MIN_EMP_PCT) {
    score += MATCH.EMP;
    why.push(`${topEmp.pct}% of visits with ${topEmp.name}`);
  }
  const topWd = st.weekdays.slice().sort((a, b) => b.count - a.count)[0];
  if (
    topWd &&
    st.totals.visits &&
    Math.round((topWd.count / st.totals.visits) * 100) >= CI.MIN_WD_PCT &&
    topWd.wd === wdIdx(slot.date)
  ) {
    score += MATCH.WD;
    why.push('usually books on this weekday');
  }
  let band: { from: number; to: number; count: number } | null = null;
  for (let h = 6; h <= 20; h++) {
    const n = st.times.filter((t) => t.hour >= h && t.hour < h + 3).reduce((a, t) => a + t.count, 0);
    if (!band || n > band.count) band = { from: h, to: h + 3, count: n };
  }
  if (
    band &&
    st.totals.visits &&
    Math.round((band.count / st.totals.visits) * 100) >= CI.MIN_BAND_PCT &&
    slot.hour >= band.from &&
    slot.hour < band.to
  ) {
    score += MATCH.BAND;
    why.push('inside their preferred time window');
  }
  if (st.retention === 'at_risk') {
    score += MATCH.ATRISK;
    why.push('at-risk — a nudge may bring them back');
  }
  if (st.seeded && st.totals.visits >= CI.MIN_VISITS) {
    const c = await trx.selectFrom('customers').select('noShows').where('id', '=', cid).executeTakeFirst();
    if (!(c && c.noShows > 0)) {
      score += MATCH.RELIABLE;
      why.push('reliable — no no-shows');
    }
  }
  const cut = new Date();
  cut.setDate(cut.getDate() - MATCH.FATIGUE_DAYS);
  const recent = await trx
    .selectFrom('customerActivity')
    .select(sql<string>`count(*)`.as('n'))
    .where('customerId', '=', cid)
    .where('ts', '>=', cut)
    .where(sql<boolean>`type ~ 'offer|member'`)
    .executeTakeFirst();
  const n = Number(recent?.n ?? 0);
  if (n) {
    score += MATCH.FATIGUE;
    why.push(`already received ${n} offer${n > 1 ? 's' : ''} recently`);
  }
  return { score, why };
}

/** One recommendation from tomorrow's gaps — deterministic: the first
 *  opportunity of the day, priced inside the HQ rules. */
export async function memberRecScan(trx: Trx, tenantId: string, locId: string) {
  if (!PREMIUM_RULES.enabled) return null;
  const existing = await trx.selectFrom('memberRecs').select('id').executeTakeFirst();
  if (existing) return null;
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const date = localIso(d);
  const caps = await openCapacity(trx, locId, date);
  if (!caps.length) return null;
  const cap = caps[0]!;
  const recPct = Math.min(35, PREMIUM_RULES.maxDiscountPct);
  const hour = parseInt(cap.start, 10);
  const members = await trx.selectFrom('customers').selectAll().where('blacklisted', '=', false).execute();
  const candidates = [];
  for (const m of members.filter((x) => isPremium(x.premium))) {
    const s = await memberScore(trx, m.id, { serviceId: cap.serviceId, empId: cap.empId, date, hour });
    candidates.push({ cid: m.id, name: m.name, ...s });
  }
  candidates.sort((a, b) => b.score - a.score);
  if (!candidates.length) return null;
  return trx
    .insertInto('memberRecs')
    .values({
      tenantId,
      locationId: locId,
      date: new Date(date),
      startAt: cap.start,
      endAt: hhmm(mins(cap.start) + cap.dur),
      serviceId: cap.serviceId,
      variantId: cap.variantId,
      employeeId: cap.empId,
      normalPrice: cap.price,
      recPct,
      recPrice: Math.max(0, Math.round(cap.price * (1 - recPct / 100))),
      candidates: JSON.stringify(candidates),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function recDecide(
  trx: Trx,
  tenantId: string,
  actorId: string,
  id: string,
  action: 'approve' | 'decline',
) {
  const r = await trx.selectFrom('memberRecs').selectAll().where('id', '=', id).executeTakeFirst();
  if (!r) throw new MarketingError('NOT_FOUND', 'Unknown recommendation');
  if (r.status !== 'pending') throw new MarketingError('WRONG_STATE', 'Already decided');
  const candidates = r.candidates as { cid: string; name: string; score: number; why: string[] }[];
  if (action === 'decline') {
    await trx.updateTable('memberRecs').set({ status: 'declined' }).where('id', '=', id).execute();
    if (candidates[0])
      await activityLog(trx, tenantId, candidates[0].cid, actorId, 'rec_declined', 'offer', id, {
        serviceId: r.serviceId,
      });
    return null;
  }
  const pmoId = randomUUID();
  await trx
    .insertInto('premiumOffers')
    .values({
      id: pmoId,
      tenantId,
      recId: r.id,
      locationId: r.locationId,
      date: r.date,
      startAt: r.startAt,
      endAt: r.endAt,
      serviceId: r.serviceId,
      variantId: r.variantId,
      employeeId: r.employeeId,
      normalPrice: r.normalPrice,
      pct: r.recPct,
      price: r.recPrice,
      candidates: JSON.stringify(candidates),
    })
    .execute();
  await trx
    .updateTable('memberRecs')
    .set({ status: 'approved', offerId: pmoId })
    .where('id', '=', id)
    .execute();
  if (candidates[0])
    await activityLog(trx, tenantId, candidates[0].cid, actorId, 'member_offer_sent', 'offer', pmoId, {
      intent: 'member_lastminute',
      serviceId: r.serviceId,
      amount: r.recPrice,
    });
  return pmoId;
}

/** Who may see this offer right now? The same staircase as the
 *  window itself: first the best member, then the group, then all. */
export function pmoVisible(
  o: { status: string; stage: number; candidates: unknown },
  custId: string | null,
) {
  if (o.status !== 'live') return false;
  if (o.stage === 3) return true;
  if (!custId) return false;
  const cands = o.candidates as { cid: string }[];
  if (o.stage === 1) return !!cands[0] && cands[0].cid === custId;
  if (o.stage === 2) return cands.some((c) => c.cid === custId);
  return false;
}

/** In production a clock does this; the endpoint is the honest demo
 *  button, labelled as such in the UI. */
export async function pmoAdvance(trx: Trx, tenantId: string, actorId: string, id: string) {
  const o = await trx.selectFrom('premiumOffers').selectAll().where('id', '=', id).executeTakeFirst();
  if (!o) throw new MarketingError('NOT_FOUND', 'Unknown member offer');
  if (o.status !== 'live') throw new MarketingError('WRONG_STATE', 'The window is closed');
  const cands = o.candidates as { cid: string }[];
  if (o.stage === 1) {
    await trx.updateTable('premiumOffers').set({ stage: 2 }).where('id', '=', id).execute();
    if (cands[0])
      await activityLog(trx, tenantId, cands[0].cid, actorId, 'member_offer_escalated', 'offer', id, {
        serviceId: o.serviceId,
      });
    return 2;
  }
  if (o.stage === 2) {
    if (PREMIUM_RULES.publicFallback) {
      await trx.updateTable('premiumOffers').set({ stage: 3 }).where('id', '=', id).execute();
      return 3;
    }
    await trx.updateTable('premiumOffers').set({ status: 'done' }).where('id', '=', id).execute();
    return 0;
  }
  await trx.updateTable('premiumOffers').set({ status: 'done' }).where('id', '=', id).execute();
  return 0;
}

/** The member option priceFor() asks about. */
export async function memberOfferFor(
  trx: Trx,
  serviceId: string,
  date: string,
  custId: string | null,
  variantId: string | null = null,
) {
  const rows = await trx
    .selectFrom('premiumOffers')
    .selectAll()
    .where('serviceId', '=', serviceId)
    .where(sql<boolean>`date = ${date}::date`)
    .where('status', '=', 'live')
    .execute();
  return (
    rows.find((o) => (!o.variantId || o.variantId === variantId) && pmoVisible(o, custId)) ?? null
  );
}

export { DAY_START, DAY_END };
