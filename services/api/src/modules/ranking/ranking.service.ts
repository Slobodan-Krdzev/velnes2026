import { BusinessSettingsSchema, type RankingBoard, type RANK_KEYS } from '@velnes/contracts';
import type { Trx } from '../../db/index.js';
import { localIso } from '../scheduling/scheduling.service.js';

type RankKey = (typeof RANK_KEYS)[number];

/** The metric behind each criterion. `reviews` has no source yet
 *  (reviews are deferred), so it is honestly not measured. */
const METRIC: Record<RankKey, 'turnover' | 'appointments' | 'upsellCount' | 'upsellTurnover' | 'upsellPct' | null> = {
  rank_reviews: null,
  rank_upsellcount: 'upsellCount',
  rank_turnover: 'turnover',
  rank_upsellturnover: 'upsellTurnover',
  rank_upsellpct: 'upsellPct',
  rank_appointments: 'appointments',
};

function mondayOf(d: Date): Date {
  const day = d.getDay(); // 0 Sun … 6 Sat
  const back = (day + 6) % 7; // days since Monday
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back);
  return m;
}

/**
 * The ranking board: one score per person from the criteria the owner
 * ticked. Equal-weight over the computable criteria today; a model can
 * weigh them later behind this same function without the board or the
 * employee app changing (the swappable seam, like the flightdeck).
 */
export async function rankingBoard(trx: Trx, tenantId: string): Promise<RankingBoard> {
  const now = new Date();
  const weekStart = mondayOf(now);
  const weekStartIso = localIso(weekStart);

  const biz = await trx.selectFrom('businesses').select('settings').executeTakeFirstOrThrow();
  const settings = BusinessSettingsSchema.parse((biz.settings ?? {}) as Record<string, unknown>);
  const criteria = settings.ranking.criteria;

  const emps = await trx
    .selectFrom('employees')
    .select(['id', 'name'])
    .where('tenantId', '=', tenantId)
    .where('status', '=', 'active')
    .execute();

  const invoices = await trx
    .selectFrom('invoices')
    .select(['id', 'employeeId', 'total', 'status'])
    .where('date', '>=', weekStart)
    .execute();
  const paid = invoices.filter((i) => i.status === 'Paid' && i.employeeId);
  const paidIds = paid.map((i) => i.id);
  const productLines = paidIds.length
    ? await trx
        .selectFrom('invoiceLines')
        .select(['invoiceId', 'qty', 'unitPrice'])
        .where('itemClass', '=', 'product')
        .where('invoiceId', 'in', paidIds)
        .execute()
    : [];
  const empOfInvoice = new Map(paid.map((i) => [i.id, i.employeeId as string]));

  const appts = await trx
    .selectFrom('appointments')
    .select(['employeeId'])
    .where('kind', '=', 'appointment')
    .where('status', '!=', 'cancelled')
    .where('date', '>=', weekStart)
    .execute();

  type M = { turnover: number; appointments: number; upsellCount: number; upsellTurnover: number; upsellPct: number };
  const metrics = new Map<string, M>();
  const zero = (): M => ({ turnover: 0, appointments: 0, upsellCount: 0, upsellTurnover: 0, upsellPct: 0 });
  for (const e of emps) metrics.set(e.id, zero());
  for (const i of paid) {
    const m = metrics.get(i.employeeId as string);
    if (m) m.turnover += i.total;
  }
  for (const l of productLines) {
    const empId = empOfInvoice.get(l.invoiceId);
    const m = empId ? metrics.get(empId) : undefined;
    if (m) {
      m.upsellCount += l.qty;
      m.upsellTurnover += l.unitPrice * l.qty;
    }
  }
  for (const a of appts) {
    const m = a.employeeId ? metrics.get(a.employeeId) : undefined;
    if (m) m.appointments += 1;
  }
  for (const m of metrics.values()) m.upsellPct = m.turnover ? m.upsellTurnover / m.turnover : 0;

  // Which ticked criteria we can actually weigh this week.
  const notMeasured = criteria.filter((k) => METRIC[k] === null);
  const usable = criteria
    .map((k) => METRIC[k])
    .filter((v): v is keyof M => v !== null);
  const fields: (keyof M)[] = usable.length ? usable : ['turnover'];

  // Equal-weight normalised score over the usable fields. (The model
  // seam: replace the equal weights with model-chosen ones later.)
  const maxOf = (f: keyof M) => Math.max(1, ...emps.map((e) => metrics.get(e.id)![f]));
  const maxes = new Map(fields.map((f) => [f, maxOf(f)]));
  const rows = emps
    .map((e) => {
      const m = metrics.get(e.id)!;
      const score = Math.round(
        (fields.reduce((s, f) => s + m[f] / (maxes.get(f) as number), 0) / fields.length) * 100,
      );
      return { employeeId: e.id, name: e.name, appointments: m.appointments, turnover: Math.round(m.turnover), score };
    })
    .sort((a, b) => b.score - a.score || b.turnover - a.turnover);

  return { rows, criteria, notMeasured, provider: 'rules', weekStart: weekStartIso };
}
