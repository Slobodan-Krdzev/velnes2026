import { useQuery } from '@tanstack/react-query';
import { ReportSchema, type Report } from '@velnes/contracts';
import { I, Icon } from '@velnes/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { get } from '@velnes/client';
import { DateField } from '../../lib/DateField.js';
import { money } from '../../lib/money.js';
import { useOutsideClose } from '../../lib/pop.js';

/** viewReports over the real /reports door: the pulse stats with the
 *  previous-period deltas, the revenue bars, and the six panes —
 *  locations, sources, services, products, employees, VAT. The CSV
 *  button downloads the pane you are looking at, no toast theatre. */

type Period = 'week' | 'month' | 'quarter' | 'year';
type Tab = 'locations' | 'sources' | 'services' | 'products' | 'employees' | 'vat';

const localIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const rangeFor = (p: Period): [string, string] => {
  const now = new Date();
  const to = localIso(now);
  const from = new Date(now);
  if (p === 'week') from.setDate(now.getDate() - 6);
  if (p === 'month') from.setDate(now.getDate() - 27);
  if (p === 'quarter') from.setDate(now.getDate() - 89);
  if (p === 'year') from.setDate(now.getDate() - 364);
  return [localIso(from), to];
};

const delta = (cur: number, prev: number) => {
  if (!prev) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
};

function Delta({ cur, prev, vs }: { cur: number; prev: number; vs: string }) {
  const d = delta(cur, prev);
  if (d === null) return <>{vs}</>;
  return (
    <>
      <span className={d >= 0 ? 'up' : 'down'}>
        {d >= 0 ? '▲' : '▼'} {Math.abs(d)}%
      </span>{' '}
      {vs}
    </>
  );
}

const SOURCE_KEYS: Record<string, string> = {
  marketplace: 'source.marketplace',
  widget: 'source.widget',
  link: 'source.link',
  staff: 'source.staff',
  pos: 'source.pos',
  phone: 'source.phone',
  walkin: 'source.walkin',
  google: 'source.google',
  instagram: 'source.instagram',
  api: 'source.api',
};

export function ReportsPage() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<Period | 'custom'>('week');
  const [custom, setCustom] = useState<[string, string]>(rangeFor('week'));
  const [tab, setTab] = useState<Tab>('services');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useOutsideClose(filtersOpen, () => setFiltersOpen(false));
  const [from, to] = period === 'custom' ? custom : rangeFor(period);
  const validRange = from <= to;
  const report = useQuery({
    queryKey: ['report', from, to],
    queryFn: () => get(ReportSchema, `/reports?from=${from}&to=${to}`),
    enabled: validRange,
  });
  const r = report.data;

  // Long periods read as weekly bars — daily would be a picket fence.
  const bars: [string, number][] = (() => {
    if (!r) return [];
    if (r.daily.length <= 31)
      return r.daily.map((d) => [d.date.slice(8), d.revenue] as [string, number]);
    const weeks = new Map<string, number>();
    for (const d of r.daily) {
      const wk = d.date.slice(0, 7);
      weeks.set(wk, (weeks.get(wk) ?? 0) + d.revenue);
    }
    return [...weeks.entries()].map(([k, v]) => [k.slice(5), v]);
  })();
  const peak = Math.max(...bars.map(([, v]) => v), 1);

  const csv = () => {
    if (!r) return;
    const esc = (v: string | number) => `"${String(v).replaceAll('"', '""')}"`;
    let rows: (string | number)[][];
    if (tab === 'services')
      rows = [
        [t('rep.service'), t('rep.category'), t('rep.booked'), t('rep.revenue')],
        ...r.services.map((s) => [s.name, s.category ?? '', s.booked, s.revenue]),
      ];
    else if (tab === 'products')
      rows = [
        [t('rep.product'), t('rep.sold'), t('rep.stock'), t('rep.revenue')],
        ...r.products.map((p) => [p.name, p.sold, p.stock, p.revenue]),
      ];
    else if (tab === 'employees')
      rows = [
        [t('rep.employee'), t('rep.role'), t('rep.appointments'), t('rep.revenue'), t('rep.utilisation')],
        ...r.employees.map((e) => [e.name, e.roleTitle, e.appointments, e.revenue, e.utilisationPct]),
      ];
    else if (tab === 'vat')
      rows = [
        [t('rep.rate'), t('rep.net'), t('rep.vat'), t('rep.gross')],
        ...r.vat.map((v) => [`${v.rate}%`, v.net, v.vat, v.gross]),
      ];
    else if (tab === 'sources')
      rows = [
        [t('rep.source'), t('rep.bookings'), t('rep.revenue'), t('rep.share'), t('rep.fee')],
        ...r.sources.map((s) => [t(SOURCE_KEYS[s.source] ?? 'source.unknown'), s.bookings, s.revenue, `${s.sharePct}%`, s.fee]),
      ];
    else
      rows = [
        [t('rep.location'), t('rep.revenue'), t('rep.appointments'), t('rep.avgTicket'), t('rep.productRevenue')],
        ...r.locations.map((l) => [l.name, l.revenue, l.appointments, l.ticket, l.products]),
      ];
    const blob = new Blob([rows.map((row) => row.map(esc).join(',')).join('\n')], {
      type: 'text/csv',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `velnes-report-${tab}-${from}-${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const periods: [Period | 'custom', string][] = [
    ['week', t('rep.thisWeek')],
    ['month', t('rep.thisMonth')],
    ['quarter', t('rep.thisQuarter')],
    ['year', t('rep.thisYear')],
    ['custom', t('rep.custom')],
  ];
  const tabsDef: [Tab, string][] = [
    ['locations', t('rep.tabLocations')],
    ['sources', t('rep.tabSources')],
    ['services', t('rep.tabServices')],
    ['products', t('rep.tabProducts')],
    ['employees', t('rep.tabEmployees')],
    ['vat', t('rep.tabVat')],
  ];

  return (
    <>
      <div className="toolbar toolbar-row">
        <div className="filters">
          <div className="pop" ref={filtersRef}>
            <button
              className={`btn btn-secondary btn-pill${period !== 'week' ? ' on' : ''}${filtersOpen ? ' open' : ''}`}
              aria-haspopup="menu"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((v) => !v)}
            >
              {t('rep.period')}: {periods.find(([p]) => p === period)?.[1]}
              <span className={`caret${filtersOpen ? ' up' : ''}`}>
                <Icon d={I.down} size={18} w={2.2} />
              </span>
            </button>
            {filtersOpen ? (
              <div className="menu menu-left" role="menu">
                {periods.map(([p, label]) => (
                  <button
                    key={p}
                    className={`menu-row${period === p ? ' on' : ''}`}
                    role="menuitemradio"
                    aria-checked={period === p}
                    onClick={() => {
                      if (p === 'custom') setCustom([from, to]);
                      setPeriod(p);
                      setFiltersOpen(false);
                    }}
                  >
                    <span className="menu-tick">
                      {period === p ? <Icon d={I.check} size={18} w={3} /> : null}
                    </span>
                    <span className="grow" style={{ textAlign: 'left' }}>
                      {label}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {period === 'custom' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <DateField
                value={custom[0]}
                max={custom[1]}
                label={t('rep.from')}
                width={150}
                onChange={(v) => setCustom([v, custom[1]])}
              />
              <span className="muted">–</span>
              <DateField
                value={custom[1]}
                min={custom[0]}
                label={t('rep.to')}
                width={150}
                onChange={(v) => setCustom([custom[0], v])}
              />
            </div>
          ) : (
            <span className="badge accent tnum">
              {from} → {to}
            </span>
          )}
        </div>
        <div className="toolbar-actions">
          <button className="btn btn-secondary btn-w" onClick={csv} disabled={!r}>
            {t('rep.downloadCsv')}
          </button>
        </div>
      </div>

      {!r ? null : (
        <>
          <div className="grid4" style={{ marginBottom: 24 }}>
            <div className="stat">
              <span className="stat-label">{t('rep.revenue')}</span>
              <span className="stat-value tnum">{money(r.totals.revenue)}</span>
              <span className="stat-hint">
                <Delta cur={r.totals.revenue} prev={r.totals.prevRevenue} vs={t('rep.vsPrev')} />
              </span>
            </div>
            <div className="stat">
              <span className="stat-label">{t('rep.appointments')}</span>
              <span className="stat-value tnum">{r.totals.appointments}</span>
              <span className="stat-hint">
                <Delta
                  cur={r.totals.appointments}
                  prev={r.totals.prevAppointments}
                  vs={t('rep.vsPrev')}
                />
              </span>
            </div>
            <div className="stat">
              <span className="stat-label">{t('rep.avgTicket')}</span>
              <span className="stat-value tnum">{money(r.totals.avgTicket)}</span>
              <span className="stat-hint">
                <Delta cur={r.totals.avgTicket} prev={r.totals.prevAvgTicket} vs={t('rep.vsPrev')} />
              </span>
            </div>
            <div className="stat">
              <span className="stat-label">{t('rep.noShows')}</span>
              <span className="stat-value tnum">{r.totals.noShows}</span>
              <span className="stat-hint">{t('rep.ofBookings', { pct: r.totals.noShowPct })}</span>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header">
              <h2>{t('rep.revenueByDay')}</h2>
              <span className="muted" style={{ fontWeight: 500 }}>
                {periods.find(([p]) => p === period)?.[1]}
              </span>
            </div>
            <div className="bars">
              {bars.map(([label, v]) => (
                <div key={label} className="bar-wrap">
                  <span className="tnum" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-muted)' }}>
                    {v === 0 ? '—' : money(v)}
                  </span>
                  <div
                    className="bar"
                    style={{ height: Math.max((v / peak) * 170, 3) }}
                    role="img"
                    aria-label={`${label}: ${money(v)}`}
                  />
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-muted)' }}>{label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div style={{ padding: '16px 20px 0' }}>
              <div className="tabs">
                {tabsDef.map(([k, label]) => (
                  <button
                    key={k}
                    className={`tab${tab === k ? ' active' : ''}`}
                    onClick={() => setTab(k)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {tab === 'services' ? <ServicesPane r={r} /> : null}
            {tab === 'products' ? <ProductsPane r={r} /> : null}
            {tab === 'employees' ? <EmployeesPane r={r} /> : null}
            {tab === 'vat' ? <VatPane r={r} /> : null}
            {tab === 'sources' ? <SourcesPane r={r} /> : null}
            {tab === 'locations' ? <LocationsPane r={r} /> : null}
          </div>
        </>
      )}
    </>
  );
}

function ServicesPane({ r }: { r: Report }) {
  const { t } = useTranslation();
  return (
    <table>
      <thead>
        <tr>
          <th>{t('rep.service')}</th>
          <th>{t('rep.category')}</th>
          <th className="right">{t('rep.booked')}</th>
          <th className="right">{t('rep.revenue')}</th>
        </tr>
      </thead>
      <tbody>
        {r.services.map((s) => (
          <tr key={s.id}>
            <td className="bold">{s.name}</td>
            <td className="muted">{s.category ?? '—'}</td>
            <td className="right tnum">{s.booked}</td>
            <td className="right bold tnum">{money(s.revenue)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ProductsPane({ r }: { r: Report }) {
  const { t } = useTranslation();
  return (
    <table>
      <thead>
        <tr>
          <th>{t('rep.product')}</th>
          <th className="right">{t('rep.sold')}</th>
          <th className="right">{t('rep.stock')}</th>
          <th className="right">{t('rep.revenue')}</th>
        </tr>
      </thead>
      <tbody>
        {r.products.map((p) => (
          <tr key={p.id}>
            <td className="bold">{p.name}</td>
            <td className="right tnum">{p.sold}</td>
            <td className="right muted tnum">{p.stock}</td>
            <td className="right bold tnum">{money(p.revenue)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EmployeesPane({ r }: { r: Report }) {
  const { t } = useTranslation();
  return (
    <table>
      <thead>
        <tr>
          <th>{t('rep.employee')}</th>
          <th>{t('rep.role')}</th>
          <th className="right">{t('rep.appointments')}</th>
          <th className="right">{t('rep.revenue')}</th>
          <th className="right">{t('rep.utilisation')}</th>
        </tr>
      </thead>
      <tbody>
        {r.employees.map((e) => (
          <tr key={e.id}>
            <td className="bold">{e.name}</td>
            <td className="muted">{e.roleTitle}</td>
            <td className="right tnum">{e.appointments}</td>
            <td className="right bold tnum">{money(e.revenue)}</td>
            <td className="right muted tnum">{e.utilisationPct}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function VatPane({ r }: { r: Report }) {
  const { t } = useTranslation();
  return (
    <table>
      <thead>
        <tr>
          <th>{t('rep.rate')}</th>
          <th className="right">{t('rep.net')}</th>
          <th className="right">{t('rep.vat')}</th>
          <th className="right">{t('rep.gross')}</th>
        </tr>
      </thead>
      <tbody>
        {r.vat.map((v) => (
          <tr key={v.rate}>
            <td className="bold">
              {v.rate}% {v.rate === 18 ? t('rep.standard') : t('rep.reduced')}
            </td>
            <td className="right tnum">{money(v.net)}</td>
            <td className="right tnum">{money(v.vat)}</td>
            <td className="right bold tnum">{money(v.gross)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SourcesPane({ r }: { r: Report }) {
  const { t } = useTranslation();
  return (
    <table>
      <thead>
        <tr>
          <th>{t('rep.source')}</th>
          <th className="right">{t('rep.bookings')}</th>
          <th className="right">{t('rep.share')}</th>
          <th className="right">{t('rep.revenue')}</th>
          <th className="right">{t('rep.fee')}</th>
        </tr>
      </thead>
      <tbody>
        {r.sources.map((s) => (
          <tr key={s.source}>
            <td className="bold">{t(SOURCE_KEYS[s.source] ?? 'source.unknown')}</td>
            <td className="right tnum">{s.bookings}</td>
            <td className="right muted tnum">{s.sharePct}%</td>
            <td className="right bold tnum">{money(s.revenue)}</td>
            <td className="right muted tnum">{s.fee ? money(s.fee) : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LocationsPane({ r }: { r: Report }) {
  const { t } = useTranslation();
  const peak = Math.max(...r.locations.map((l) => l.revenue), 1);
  const together = r.locations.reduce(
    (s, l) => ({
      revenue: s.revenue + l.revenue,
      appointments: s.appointments + l.appointments,
      products: s.products + l.products,
    }),
    { revenue: 0, appointments: 0, products: 0 },
  );
  const avgTicket = Math.round(
    r.locations.reduce((s, l) => s + l.ticket, 0) / Math.max(r.locations.length, 1),
  );
  return (
    <>
      <div className="bars">
        {r.locations.map((l) => (
          <div key={l.id} className="bar-wrap">
            <span className="tnum" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-muted)' }}>
              {money(l.revenue)}
            </span>
            <div className="bar" style={{ height: Math.max((l.revenue / peak) * 170, 3) }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-muted)' }}>{l.name}</span>
          </div>
        ))}
      </div>
      <table>
        <thead>
          <tr>
            <th>{t('rep.metric')}</th>
            {r.locations.map((l) => (
              <th key={l.id} className="right">
                {l.name}
              </th>
            ))}
            <th className="right">{t('rep.together')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="bold">{t('rep.revenue')}</td>
            {r.locations.map((l) => (
              <td key={l.id} className="right tnum">
                {money(l.revenue)}
              </td>
            ))}
            <td className="right bold tnum">{money(together.revenue)}</td>
          </tr>
          <tr>
            <td className="bold">{t('rep.appointments')}</td>
            {r.locations.map((l) => (
              <td key={l.id} className="right tnum">
                {l.appointments}
              </td>
            ))}
            <td className="right bold tnum">{together.appointments}</td>
          </tr>
          <tr>
            <td className="bold">{t('rep.avgTicket')}</td>
            {r.locations.map((l) => (
              <td key={l.id} className="right tnum">
                {money(l.ticket)}
              </td>
            ))}
            <td className="right bold tnum">{money(avgTicket)}</td>
          </tr>
          <tr>
            <td className="bold">{t('rep.productRevenue')}</td>
            {r.locations.map((l) => (
              <td key={l.id} className="right tnum">
                {money(l.products)}
              </td>
            ))}
            <td className="right bold tnum">{money(together.products)}</td>
          </tr>
        </tbody>
      </table>
    </>
  );
}
