import type { Flightdeck } from '@velnes/contracts';
import { sql } from 'kysely';
import type { Trx } from '../../db/index.js';
import { isPremium } from '../customers/customers.service.js';
import { memberRecScan, openCapacity } from '../marketing/marketing.service.js';
import { localIso } from '../scheduling/scheduling.service.js';
import { computeInsights, type InsightSignals } from './insights.provider.js';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const QUIET_DAYS = 60;

function isoOf(d: Date) {
  return localIso(d);
}

/**
 * The flightdeck payload, composed from live data in one door. The
 * pulse, hero, snapshot, staff and inventory are derived here; the
 * opportunities and Kumo insight come from the insights provider
 * (rules today, Claude later), fed only aggregated signals.
 */
export async function flightdeck(
  trx: Trx,
  opts: { tenantId: string; locId: string; greetingName: string },
): Promise<Flightdeck> {
  const { locId, greetingName } = opts;
  const now = new Date();
  const today = isoOf(now);
  const tomorrow = isoOf(new Date(now.getTime() + 86_400_000));
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const eightWeeksAgo = new Date(now.getTime() - 56 * 86_400_000);

  // ── Capacity: booked today vs. the open gaps the engine sees. ──
  const [capsToday, capsTmw] = await Promise.all([
    openCapacity(trx, locId, today),
    openCapacity(trx, locId, tomorrow),
  ]);
  const apptsToday = await trx
    .selectFrom('appointments')
    .select(['id', 'source', 'status'])
    .where('locationId', '=', locId)
    .where('kind', '=', 'appointment')
    .where('status', '!=', 'cancelled')
    .where(sql<boolean>`date::date = ${today}::date`)
    .execute();
  const bookedToday = apptsToday.length;
  const totalSlots = bookedToday + capsToday.length;
  const capacityPct = totalSlots ? Math.round((bookedToday / totalSlots) * 100) : 0;
  const onlineToday = apptsToday.filter((a) => a.source === 'widget' || a.source === 'marketplace').length;
  const noShows = apptsToday.filter((a) => a.status === 'no_show').length;
  const noShowPct = bookedToday ? Math.round((noShows / bookedToday) * 100) : 0;

  // ── Money: today, this month, last month. ──
  const invoices = await trx
    .selectFrom('invoices')
    .select(['id', 'date', 'total', 'employeeId', 'employeeName'])
    .where('locationId', '=', locId)
    .where('date', '>=', prevMonthStart)
    .execute();
  const dayIso = (d: Date | string) => isoOf(new Date(d as string));
  const revenueToday = invoices.filter((i) => dayIso(i.date) === today).reduce((s, i) => s + i.total, 0);
  const thisMonth = invoices.filter((i) => new Date(i.date as unknown as string) >= monthStart);
  const lastMonth = invoices.filter(
    (i) => new Date(i.date as unknown as string) >= prevMonthStart && new Date(i.date as unknown as string) < monthStart,
  );
  const avgSpend = thisMonth.length ? Math.round(thisMonth.reduce((s, i) => s + i.total, 0) / thisMonth.length) : 0;
  const avgSpendPrev = lastMonth.length ? Math.round(lastMonth.reduce((s, i) => s + i.total, 0) / lastMonth.length) : 0;
  const avgSpendDeltaPct = avgSpendPrev ? Math.round(((avgSpend - avgSpendPrev) / avgSpendPrev) * 100) : null;
  // The "target" is the salon's own trailing daily revenue — a real
  // baseline, not an invented goal.
  const dayTotals = new Map<string, number>();
  for (const i of invoices) dayTotals.set(dayIso(i.date), (dayTotals.get(dayIso(i.date)) ?? 0) + i.total);
  const activeDays = [...dayTotals.values()].filter((v) => v > 0);
  const revenueTarget = activeDays.length ? Math.round(activeDays.reduce((s, v) => s + v, 0) / activeDays.length) : 0;

  // ── Customers: new this month, premium members, quiet regulars. ──
  const customers = await trx
    .selectFrom('customers')
    .select(['id', 'since', 'visits', 'spend', 'premium', 'blacklisted'])
    .execute();
  const newCustomers = customers.filter((c) => new Date(c.since as unknown as string) >= monthStart).length;
  const newPrev = customers.filter(
    (c) => new Date(c.since as unknown as string) >= prevMonthStart && new Date(c.since as unknown as string) < monthStart,
  ).length;
  const newCustomersDeltaPct = newPrev ? Math.round(((newCustomers - newPrev) / newPrev) * 100) : null;
  const memberCount = customers.filter((c) => isPremium(c.premium) && !c.blacklisted).length;

  const lastSeen = await trx
    .selectFrom('appointments')
    .select(['customerId'])
    .select((eb) => eb.fn.max('date').as('last'))
    .where('kind', '=', 'appointment')
    .where('customerId', 'is not', null)
    .groupBy('customerId')
    .execute();
  const lastById = new Map(lastSeen.map((r) => [r.customerId as string, new Date(r.last as unknown as string)]));
  const quietCutoff = new Date(now.getTime() - QUIET_DAYS * 86_400_000);
  const quiet = customers.filter((c) => {
    if (c.blacklisted || c.visits < 3) return false;
    const seen = lastById.get(c.id);
    return !seen || seen < quietCutoff;
  });
  const quietValue = Math.round(
    quiet.reduce((s, c) => s + (c.visits ? Math.round(c.spend / c.visits) : 0), 0),
  );

  // ── Products: low stock, and slow movers with margin. Stock and the
  //    live price are per-location (location_catalog_products). ──
  const products = await trx
    .selectFrom('products as p')
    .innerJoin('locationCatalogProducts as lcp', 'lcp.productId', 'p.id')
    .select(['p.id', 'p.name', 'p.own', 'lcp.stock', 'lcp.price'])
    .where('lcp.locationId', '=', locId)
    .execute();
  const monthProductLines = await trx
    .selectFrom('invoiceLines as il')
    .innerJoin('invoices as inv', 'inv.id', 'il.invoiceId')
    .select(['il.productId', 'il.qty', 'il.unitPrice', 'inv.employeeId', 'inv.date', 'il.itemClass'])
    .where('il.itemClass', '=', 'product')
    .where('inv.date', '>=', monthStart)
    .execute();
  const soldProductIds = new Set(monthProductLines.map((l) => l.productId).filter(Boolean) as string[]);
  const lowStock = products
    .filter((p) => !p.own && p.stock <= 8)
    .sort((a, b) => a.stock - b.stock)
    .slice(0, 4);
  const slow = products.filter((p) => !p.own && p.price > 0 && p.stock > 0 && !soldProductIds.has(p.id));
  const slowValue = Math.round(slow.reduce((s, p) => s + p.price * Math.min(p.stock, 4), 0));

  // ── Retail & upsell per person (this month product revenue). ──
  const upsellByEmp = new Map<string, number>();
  for (const l of monthProductLines) {
    if (!l.employeeId) continue;
    upsellByEmp.set(l.employeeId, (upsellByEmp.get(l.employeeId) ?? 0) + l.unitPrice * l.qty);
  }
  const emps = await trx
    .selectFrom('employees')
    .select(['id', 'name'])
    .where('tenantId', '=', opts.tenantId)
    .execute();
  const staff = emps
    .map((e) => ({ employeeId: e.id, name: e.name, value: Math.round(upsellByEmp.get(e.id) ?? 0) }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
  const productSalesToday = (
    await trx
      .selectFrom('invoiceLines as il')
      .innerJoin('invoices as inv', 'inv.id', 'il.invoiceId')
      .select(['il.qty', 'il.unitPrice'])
      .where('il.itemClass', '=', 'product')
      .where('inv.locationId', '=', locId)
      .where(sql<boolean>`inv.date::date = ${today}::date`)
      .execute()
  ).reduce((s, l) => s + l.unitPrice * l.qty, 0);

  // The upsell gap: the team's own average vs. its floor.
  let upsell: InsightSignals['upsell'] = null;
  if (staff.length >= 2) {
    const teamAvg = staff.reduce((s, x) => s + x.value, 0) / staff.length;
    const floor = staff[staff.length - 1]!.value;
    const gapPerHead = Math.round((teamAvg - floor) / Math.max(1, Math.round(teamAvg / 300)));
    if (teamAvg - floor > 0) upsell = { gap: Math.max(0, gapPerHead), value: Math.round(teamAvg - floor) };
  }

  // ── Quietest weekday, from the last eight weeks of appointments. ──
  const history = await trx
    .selectFrom('appointments')
    .select(['date'])
    .where('locationId', '=', locId)
    .where('kind', '=', 'appointment')
    .where('status', '!=', 'cancelled')
    .where('date', '>=', eightWeeksAgo)
    .execute();
  const byDow = new Array(7).fill(0);
  for (const a of history) byDow[new Date(a.date as unknown as string).getDay()]++;
  let quietestWeekday: string | null = null;
  if (history.length >= 20) {
    let minIdx = -1;
    for (let d = 0; d < 7; d++) if (byDow[d] > 0 && (minIdx < 0 || byDow[d] < byDow[minIdx])) minIdx = d;
    if (minIdx >= 0) quietestWeekday = WEEKDAYS[minIdx]!;
  }

  // ── Velnes Premium: pending member recommendations. ──
  await memberRecScan(trx, opts.tenantId, locId);
  const recs = await trx
    .selectFrom('memberRecs')
    .select(['recPrice'])
    .where('status', '=', 'pending')
    .execute();
  const memberRecs = { count: recs.length, value: recs.reduce((s, r) => s + r.recPrice, 0) };

  // ── Getting-started checklist. Shown only while the salon has no
  //    sales history yet — the "empty flightdeck" of a first login. ──
  const svcRows = await trx
    .selectFrom('services')
    .select('id')
    .where('tenantId', '=', opts.tenantId)
    .execute();
  const supplierConn = await trx
    .selectFrom('supplierConnections')
    .select('supplierId')
    .where('tenantId', '=', opts.tenantId)
    .where('status', '=', 'connected')
    .executeTakeFirst();
  const locRows = await trx
    .selectFrom('locations')
    .select(['hours', 'lifecycle'])
    .where('tenantId', '=', opts.tenantId)
    .execute();
  const thisLoc = locRows.find(() => true) ?? null;
  const activeLocations = locRows.filter((l) => l.lifecycle === 'ACTIVE').length;

  // Legal details are optional at registration; remind until entered.
  const entity = await trx
    .selectFrom('legalEntities')
    .select(['taxId', 'vatReg'])
    .where('tenantId', '=', opts.tenantId)
    .orderBy('isDefault', 'desc')
    .executeTakeFirst();
  const legalPending = {
    taxId: !entity?.taxId?.trim(),
    vat: !entity?.vatReg?.trim(),
  };
  const obSteps: Flightdeck['onboarding']['steps'] = [
    { key: 'services', done: svcRows.length > 0, count: svcRows.length, actionTarget: 'catalog' },
    { key: 'products', done: products.length > 0, count: products.length, actionTarget: 'catalog' },
    { key: 'team', done: emps.length > 1, count: emps.length, actionTarget: 'settings' },
    { key: 'hours', done: thisLoc?.hours != null, count: thisLoc?.hours != null ? 1 : 0, actionTarget: 'settings' },
    { key: 'suppliers', done: !!supplierConn, count: supplierConn ? 1 : 0, actionTarget: 'suppliers' },
  ];
  const obDone = obSteps.filter((s) => s.done).length;
  const fresh = invoices.length === 0 && history.length === 0 && bookedToday === 0;
  const onboarding: Flightdeck['onboarding'] = {
    show: fresh,
    doneCount: obDone,
    totalCount: obSteps.length,
    locationCount: activeLocations || locRows.length,
    steps: obSteps,
  };

  // ── The hero: fill tomorrow's gaps, else today's, else quiet. ──
  const heroCaps = capsTmw.length ? capsTmw : capsToday.length ? capsToday : null;
  const heroWhen = capsTmw.length ? 'tomorrow' : 'today';
  const heroDate = capsTmw.length ? tomorrow : today;
  const hero: Flightdeck['hero'] = heroCaps
    ? {
        kind: 'capacity',
        when: heroWhen,
        date: heroDate,
        locationId: locId,
        openSlots: heroCaps.length,
        fromTime: heroCaps[0]!.start,
        toTime: heroCaps[heroCaps.length - 1]!.start,
        potential: heroCaps.reduce((s, c) => s + c.price, 0),
        memberCount,
      }
    : { kind: 'quiet' };

  // ── Opportunities + Kumo, from the insights provider. ──
  const signals: InsightSignals = {
    quietRegulars: { count: quiet.length, value: quietValue, sinceDays: QUIET_DAYS },
    slowProducts: { count: slow.length, value: slowValue, topNames: slow.slice(0, 3).map((p) => p.name) },
    upsell,
    quietestWeekday,
  };
  const insights = await computeInsights(signals);

  return {
    greetingName,
    onboarding,
    legalPending,
    pulse: {
      capacityPct,
      bookedToday,
      totalSlots,
      revenueToday,
      revenueTarget,
      newCustomers,
      newCustomersDeltaPct,
      avgSpend,
      avgSpendDeltaPct,
    },
    memberRecs,
    hero,
    opportunities: insights.opportunities,
    kumo: insights.kumo,
    snapshot: {
      bookedToday,
      totalSlots,
      onlineToday,
      noShows,
      noShowPct,
      revenue: revenueToday,
      productSales: Math.round(productSalesToday),
    },
    staff,
    inventory: lowStock.map((p) => ({ id: p.id, name: p.name, stock: p.stock, soldOut: p.stock === 0 })),
    provider: insights.provider,
  };
}
