import { ReportQuerySchema, ReportSchema, type Report } from '@velnes/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { z } from 'zod';
import { withTenant, type Trx } from '../../db/index.js';
import { can, permsFor } from '../auth/authz.service.js';

const Err = z.object({ error: z.string(), message: z.string() });

/** The marketplace's cut per booking source — the same table the
 *  prototype carries; only the marketplace and API partners charge. */
const SOURCE_FEE: Record<string, number> = { marketplace: 0.08, api: 0.03 };

const localIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  return localIso(new Date(y!, m! - 1, d! + n));
};
const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);

type Scope = { own: string | null };

async function revenueBetween(trx: Trx, from: string, to: string, scope: Scope) {
  let q = trx
    .selectFrom('invoices')
    .select([
      sql<number>`coalesce(sum(total),0)::int`.as('revenue'),
      sql<number>`count(*)::int`.as('n'),
    ])
    .where('status', '=', 'Paid')
    .where(sql<boolean>`date >= ${from}::date AND date <= ${to}::date`);
  if (scope.own) q = q.where('employeeId', '=', scope.own);
  return q.executeTakeFirstOrThrow();
}

async function apptCounts(trx: Trx, from: string, to: string, scope: Scope) {
  let q = trx
    .selectFrom('appointments')
    .select([
      sql<number>`count(*) filter (where status in ('booked','confirmed'))::int`.as('kept'),
      sql<number>`count(*) filter (where status = 'no_show')::int`.as('noShows'),
    ])
    .where('kind', '=', 'appointment')
    .where(sql<boolean>`date >= ${from}::date AND date <= ${to}::date`);
  if (scope.own) q = q.where('employeeId', '=', scope.own);
  return q.executeTakeFirstOrThrow();
}

export async function buildReport(
  trx: Trx,
  from: string,
  to: string,
  scope: Scope,
): Promise<Report> {
  const len = daysBetween(from, to) + 1;
  const prevFrom = addDays(from, -len);
  const prevTo = addDays(from, -1);

  const cur = await revenueBetween(trx, from, to, scope);
  const prev = await revenueBetween(trx, prevFrom, prevTo, scope);
  const appts = await apptCounts(trx, from, to, scope);
  const apptsPrev = await apptCounts(trx, prevFrom, prevTo, scope);

  let dailyQ = trx
    .selectFrom('invoices')
    .select([
      sql<string>`to_char(date, 'YYYY-MM-DD')`.as('date'),
      sql<number>`coalesce(sum(total),0)::int`.as('revenue'),
    ])
    .where('status', '=', 'Paid')
    .where(sql<boolean>`date >= ${from}::date AND date <= ${to}::date`)
    .groupBy(sql`to_char(date, 'YYYY-MM-DD')`);
  if (scope.own) dailyQ = dailyQ.where('employeeId', '=', scope.own);
  const dailyRows = await dailyQ.execute();
  const byDate = new Map(dailyRows.map((r) => [r.date, r.revenue]));
  const daily: Report['daily'] = [];
  for (let i = 0; i < len; i++) {
    const d = addDays(from, i);
    daily.push({ date: d, revenue: byDate.get(d) ?? 0 });
  }

  const lineBase = (cls: string) => {
    let q = trx
      .selectFrom('invoiceLines as l')
      .innerJoin('invoices as i', 'i.id', 'l.invoiceId')
      .where('i.status', '=', 'Paid')
      .where('l.itemClass', '=', cls)
      .where(sql<boolean>`i.date >= ${from}::date AND i.date <= ${to}::date`);
    if (scope.own) q = q.where('i.employeeId', '=', scope.own);
    return q;
  };

  const svcRows = await lineBase('service')
    .innerJoin('services as s', 's.id', 'l.serviceId')
    .leftJoin('serviceCategories as sc', 'sc.id', 's.categoryId')
    .select([
      's.id as id',
      's.name as name',
      'sc.name as category',
      sql<number>`sum(l.qty)::int`.as('booked'),
      sql<number>`sum(l.qty * l.unit_price - l.line_discount)::int`.as('revenue'),
    ])
    .groupBy(['s.id', 's.name', 'sc.name'])
    .orderBy('revenue', 'desc')
    .execute();

  const prodRows = await lineBase('product')
    .innerJoin('products as p', 'p.id', 'l.productId')
    .select([
      'p.id as id',
      'p.name as name',
      sql<number>`sum(l.qty)::int`.as('sold'),
      sql<number>`sum(l.qty * l.unit_price - l.line_discount)::int`.as('revenue'),
      sql<number>`coalesce((select sum(stock)::int from location_catalog_products lcp where lcp.product_id = p.id), 0)`.as(
        'stock',
      ),
    ])
    .groupBy(['p.id', 'p.name'])
    .orderBy('revenue', 'desc')
    .execute();

  // Utilisation: booked minutes against the week each person carries.
  let empApptQ = trx
    .selectFrom('appointments as a')
    .innerJoin('employees as e', 'e.id', 'a.employeeId')
    .select([
      'e.id as id',
      'e.name as name',
      'e.roleTitle as roleTitle',
      'e.hours as hours',
      sql<number>`count(*)::int`.as('appointments'),
      sql<number>`coalesce(sum(a.duration_min),0)::int`.as('minutes'),
    ])
    .where('a.kind', '=', 'appointment')
    .where('a.status', 'in', ['booked', 'confirmed'])
    .where(sql<boolean>`a.date >= ${from}::date AND a.date <= ${to}::date`)
    .groupBy(['e.id', 'e.name', 'e.roleTitle', 'e.hours']);
  if (scope.own) empApptQ = empApptQ.where('e.id', '=', scope.own);
  const empAppts = await empApptQ.execute();

  let empRevQ = trx
    .selectFrom('invoices')
    .select(['employeeId', sql<number>`coalesce(sum(total),0)::int`.as('revenue')])
    .where('status', '=', 'Paid')
    .where(sql<boolean>`date >= ${from}::date AND date <= ${to}::date`)
    .groupBy('employeeId');
  if (scope.own) empRevQ = empRevQ.where('employeeId', '=', scope.own);
  const empRev = new Map(
    (await empRevQ.execute()).map((r) => [r.employeeId, r.revenue] as const),
  );

  const weeklyMinutes = (hours: unknown): number => {
    if (!hours || typeof hours !== 'object') return 0;
    let m = 0;
    for (const day of Object.values(hours as Record<string, [string, string][] | null>))
      for (const [a, b] of day ?? [])
        m +=
          Number(b.slice(0, 2)) * 60 +
          Number(b.slice(3, 5)) -
          Number(a.slice(0, 2)) * 60 -
          Number(a.slice(3, 5));
    return m;
  };
  const employees: Report['employees'] = empAppts
    .map((e) => {
      const avail = (weeklyMinutes(e.hours) * len) / 7;
      return {
        id: e.id,
        name: e.name,
        roleTitle: e.roleTitle,
        appointments: e.appointments,
        revenue: empRev.get(e.id) ?? 0,
        utilisationPct: avail ? Math.min(100, Math.round((e.minutes / avail) * 100)) : 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  const vatRows = await lineBase('service')
    .clearWhere()
    .where('i.status', '=', 'Paid')
    .where(sql<boolean>`i.date >= ${from}::date AND i.date <= ${to}::date`)
    .$if(!!scope.own, (q) => q.where('i.employeeId', '=', scope.own!))
    .select([
      'l.vat as rate',
      sql<number>`sum(l.qty * l.unit_price - l.line_discount)::int`.as('gross'),
    ])
    .groupBy('l.vat')
    .execute();
  const vatMap = new Map(vatRows.map((r) => [r.rate, r.gross] as const));
  const vat: Report['vat'] = [18, 5].map((rate) => {
    const gross = vatMap.get(rate) ?? 0;
    const net = Math.round(gross / (1 + rate / 100));
    return { rate, net, vat: gross - net, gross };
  });

  let srcQ = trx
    .selectFrom('appointments')
    .select([
      'source',
      sql<number>`count(*)::int`.as('bookings'),
      sql<number>`coalesce(sum(price),0)::int`.as('revenue'),
    ])
    .where('kind', '=', 'appointment')
    .where('status', 'in', ['booked', 'confirmed'])
    .where(sql<boolean>`date >= ${from}::date AND date <= ${to}::date`)
    .groupBy('source');
  if (scope.own) srcQ = srcQ.where('employeeId', '=', scope.own);
  const srcRows = await srcQ.execute();
  const srcTotal = srcRows.reduce((s, r) => s + r.bookings, 0);
  const sources: Report['sources'] = srcRows
    .map((r) => ({
      source: r.source,
      bookings: r.bookings,
      revenue: r.revenue,
      sharePct: srcTotal ? Math.round((r.bookings / srcTotal) * 100) : 0,
      fee: Math.round(r.revenue * (SOURCE_FEE[r.source] ?? 0)),
    }))
    .sort((a, b) => b.bookings - a.bookings);

  const locRows = await trx
    .selectFrom('locations')
    .select(['id', 'name'])
    .orderBy('name')
    .execute();
  const locations: Report['locations'] = [];
  for (const l of locRows) {
    let invQ = trx
      .selectFrom('invoices')
      .select([
        sql<number>`coalesce(sum(total),0)::int`.as('revenue'),
        sql<number>`count(*)::int`.as('n'),
      ])
      .where('status', '=', 'Paid')
      .where('locationId', '=', l.id)
      .where(sql<boolean>`date >= ${from}::date AND date <= ${to}::date`);
    if (scope.own) invQ = invQ.where('employeeId', '=', scope.own);
    const inv = await invQ.executeTakeFirstOrThrow();
    let apQ = trx
      .selectFrom('appointments')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('kind', '=', 'appointment')
      .where('status', 'in', ['booked', 'confirmed'])
      .where('locationId', '=', l.id)
      .where(sql<boolean>`date >= ${from}::date AND date <= ${to}::date`);
    if (scope.own) apQ = apQ.where('employeeId', '=', scope.own);
    const ap = await apQ.executeTakeFirstOrThrow();
    let prodQ = trx
      .selectFrom('invoiceLines as l')
      .innerJoin('invoices as i', 'i.id', 'l.invoiceId')
      .select(sql<number>`coalesce(sum(l.qty * l.unit_price - l.line_discount),0)::int`.as('rev'))
      .where('i.status', '=', 'Paid')
      .where('i.locationId', '=', l.id)
      .where('l.itemClass', '=', 'product')
      .where(sql<boolean>`i.date >= ${from}::date AND i.date <= ${to}::date`);
    if (scope.own) prodQ = prodQ.where('i.employeeId', '=', scope.own);
    const prod = await prodQ.executeTakeFirstOrThrow();
    locations.push({
      id: l.id,
      name: l.name,
      revenue: inv.revenue,
      appointments: ap.n,
      ticket: inv.n ? Math.round(inv.revenue / inv.n) : 0,
      products: prod.rev,
    });
  }

  const kept = appts.kept;
  return {
    totals: {
      revenue: cur.revenue,
      invoices: cur.n,
      appointments: kept,
      avgTicket: cur.n ? Math.round(cur.revenue / cur.n) : 0,
      noShows: appts.noShows,
      noShowPct:
        kept + appts.noShows
          ? Math.round((appts.noShows / (kept + appts.noShows)) * 1000) / 10
          : 0,
      prevRevenue: prev.revenue,
      prevAppointments: apptsPrev.kept,
      prevAvgTicket: prev.n ? Math.round(prev.revenue / prev.n) : 0,
    },
    daily,
    services: svcRows,
    products: prodRows,
    employees,
    vat,
    sources,
    locations,
  };
}

export function reportsRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.route({
    method: 'GET',
    url: '/reports',
    preHandler: [app.authenticate],
    schema: {
      querystring: ReportQuerySchema,
      response: { 200: ReportSchema, 403: Err },
    },
    handler: async (req, reply) =>
      withTenant(req.claims.ten, async (trx) => {
        const perms = await permsFor(trx, req.claims);
        // Business- or location-wide readers see everything; someone
        // with only their own figures gets exactly those.
        const wide = can(perms, 'reports.view_location') || can(perms, 'reports.view_business');
        if (!wide && !can(perms, 'reports.view_own'))
          return reply
            .code(403)
            .send({ error: 'FORBIDDEN', message: 'Missing permission: reports.view_own' });
        return buildReport(trx, req.query.from, req.query.to, {
          own: wide ? null : req.claims.sub,
        });
      }),
  });
}
