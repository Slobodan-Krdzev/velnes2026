import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, refusalText, useSession } from '@velnes/client';
import {
  AppointmentListResponseSchema,
  InvoiceListResponseSchema,
  LocationCatalogResponseSchema,
  LocationListResponseSchema,
  SaleResponseSchema,
  type Appointment,
  type SaleLine,
} from '@velnes/contracts';
import { I, Icon } from '@velnes/ui';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

const uuid = () =>
  crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now();
const money = (n: number) =>
  new Intl.NumberFormat('mk-MK', {
    style: 'currency',
    currency: 'MKD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
const localIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  return localIso(new Date(y!, m! - 1, d! + n));
};

interface MoLine {
  key: string;
  kind: 'service' | 'product' | 'appointment';
  refId: string;
  name: string;
  price: number;
  qty: number;
}

export function EmployeeApp() {
  const { t } = useTranslation();
  const { me, logout } = useSession();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'agenda' | 'pos' | 'rank'>('agenda');
  const [basket, setBasket] = useState<MoLine[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [saleKey, setSaleKey] = useState(uuid);
  const [payOpen, setPayOpen] = useState(false);
  const say = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2400);
  };

  const locations = useQuery({
    queryKey: ['locations'],
    queryFn: () => get(LocationListResponseSchema, '/locations'),
  });
  const here = useMemo(() => {
    const mine = (locations.data?.locations ?? []).filter(
      (l) => !me?.locationIds.length || me.locationIds.includes(l.id),
    );
    return mine[0]?.id ?? null;
  }, [locations.data, me]);

  const today = localIso(new Date());
  const appts = useQuery({
    queryKey: ['myAgenda', here],
    queryFn: () =>
      get(
        AppointmentListResponseSchema,
        `/appointments?locationId=${here}&from=${today}&to=${addDays(today, 7)}`,
      ),
    enabled: !!here,
  });
  const catalog = useQuery({
    queryKey: ['catalog', here],
    queryFn: () => get(LocationCatalogResponseSchema, `/locations/${here}/catalog`),
    enabled: !!here && tab === 'pos',
  });
  const invoices = useQuery({
    queryKey: ['rank'],
    queryFn: () => get(InvoiceListResponseSchema, '/invoices?limit=200'),
    enabled: tab === 'rank',
  });

  // Local treatment phase (Created/started/finished) — optimistic,
  // confirmed by the events door.
  const [phase, setPhase] = useState<Record<string, 'running' | 'done'>>({});
  const treat = useMutation({
    mutationFn: ({ id, what }: { id: string; what: 'Treatment started' | 'Treatment finished' }) =>
      post(z.object({ ok: z.literal(true) }), `/appointments/${id}/events`, { what }),
    onSuccess: (_d, v) => {
      setPhase((p) => ({ ...p, [v.id]: v.what === 'Treatment started' ? 'running' : 'done' }));
      if (v.what === 'Treatment finished') say(t('mo.measured'));
    },
  });

  const mine = (appts.data?.appointments ?? [])
    .filter((a) => a.employeeId === me?.id && a.kind === 'appointment' && a.status !== 'cancelled')
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const byDay = new Map<string, Appointment[]>();
  for (const a of mine) byDay.set(a.date, [...(byDay.get(a.date) ?? []), a]);

  const checkout = (a: Appointment) => {
    setBasket((b) =>
      b.some((l) => l.refId === a.id)
        ? b
        : [
            ...b,
            {
              key: uuid(),
              kind: 'appointment',
              refId: a.id,
              name: a.serviceName ?? a.title,
              price: a.price,
              qty: 1,
            },
          ],
    );
    setTab('pos');
  };

  const total = basket.reduce((s, l) => s + l.price * l.qty, 0);
  const pay = async (method: string) => {
    if (!here || !basket.length) return;
    try {
      const lines: SaleLine[] = basket.map((l) =>
        l.kind === 'appointment'
          ? { kind: 'appointment' as const, appointmentId: l.refId, lineDiscount: 0 }
          : l.kind === 'service'
            ? {
                kind: 'service' as const,
                serviceId: l.refId,
                variantId: null,
                modifierOptionIds: [],
                qty: l.qty,
                lineDiscount: 0,
              }
            : { kind: 'product' as const, productId: l.refId, qty: l.qty, lineDiscount: 0 },
      );
      const res = await post(SaleResponseSchema, '/sales', {
        key: saleKey,
        locationId: here,
        lines,
        method,
        employeeId: me?.id ?? null,
        tip: 0,
        serviceCharge: 0,
        cartDiscount: 0,
        pointsRedeemed: 0,
        giftAmount: 0,
      });
      setBasket([]);
      setSaleKey(uuid());
      setPayOpen(false);
      say(`${money(res.total)} · ${res.invoice.number}`);
      void qc.invalidateQueries({ queryKey: ['myAgenda'] });
    } catch (e) {
      say(refusalText(t, e));
    }
  };

  const agenda = (
    <>
      {mine.length === 0 ? (
        <div className="empty">
          <h3>{t('mo.nothingBooked')}</h3>
          <p>{t('mo.nothingBookedSub')}</p>
        </div>
      ) : (
        [...byDay.entries()].map(([day, list]) => (
          <div key={day} style={{ display: 'grid', gap: 12 }}>
            <div
              className="s muted"
              style={{
                fontWeight: 700,
                fontSize: 12,
                textTransform: 'uppercase',
                letterSpacing: '.03em',
              }}
            >
              {day === today ? `${t('common.today')} · ` : ''}
              {day}
            </div>
            {list.map((a) => {
              const f = phase[a.id] ?? 'todo';
              return (
                <div key={a.id} className="mo-card warm">
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <div>
                      <div className="tnum" style={{ fontWeight: 600 }}>
                        {a.start} – {a.end}
                      </div>
                      <div className="bold" style={{ fontSize: 16 }}>
                        {a.title}
                      </div>
                      {a.serviceName ? (
                        <div className="muted" style={{ fontWeight: 500 }}>
                          {a.serviceName}
                        </div>
                      ) : null}
                    </div>
                    {a.price ? <div className="tnum bold">{money(a.price)}</div> : null}
                  </div>
                  {f === 'todo' ? (
                    <button
                      className="btn btn-primary btn-sm"
                      style={{ width: '100%', marginTop: 10 }}
                      onClick={() => treat.mutate({ id: a.id, what: 'Treatment started' })}
                    >
                      {t('mo.startTreatment')}
                    </button>
                  ) : f === 'running' ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                      <span className="badge">{t('mo.running')}</span>
                      <button
                        className="btn btn-primary btn-sm"
                        style={{ flex: 1 }}
                        onClick={() => treat.mutate({ id: a.id, what: 'Treatment finished' })}
                      >
                        {t('mo.finishTreatment')}
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                      <span className="badge success">{t('mo.done')}</span>
                      <button
                        className="btn btn-primary btn-sm"
                        style={{ flex: 1 }}
                        onClick={() => checkout(a)}
                      >
                        {t('mo.checkOut')}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))
      )}
    </>
  );

  const tiles = [
    ...(catalog.data?.services ?? [])
      .filter((s) => s.status !== 'draft' && s.config.pos && s.config.active)
      .map((s) => ({
        id: s.id,
        kind: 'service' as const,
        name: s.name,
        meta: `${s.config.durationMin} min`,
        price: s.config.price,
      })),
    ...(catalog.data?.products ?? [])
      .filter((p) => !p.own && p.config.active && p.config.pos)
      .map((p) => ({
        id: p.id,
        kind: 'product' as const,
        name: p.name,
        meta: `${p.config.stock} ${t('mo.left')}`,
        price: p.config.price,
      })),
  ];

  const pos = (
    <>
      {basket.length ? (
        <div className="mo-card">
          {basket.map((l) => (
            <div
              key={l.key}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}
            >
              <span style={{ flex: 1 }}>
                <span className="bold">{l.name}</span>
              </span>
              <button
                className="btn btn-subtle btn-sq"
                aria-label={`${l.name} minus`}
                onClick={() =>
                  setBasket((b) =>
                    b
                      .map((x) => (x.key === l.key ? { ...x, qty: x.qty - 1 } : x))
                      .filter((x) => x.qty > 0),
                  )
                }
              >
                <Icon d={I.minus} size={16} />
              </button>
              <span className="tnum bold" style={{ width: 20, textAlign: 'center' }}>
                {l.qty}
              </span>
              <button
                className="btn btn-subtle btn-sq"
                aria-label={`${l.name} plus`}
                disabled={l.kind === 'appointment'}
                onClick={() =>
                  setBasket((b) => b.map((x) => (x.key === l.key ? { ...x, qty: x.qty + 1 } : x)))
                }
              >
                <Icon d={I.plus} size={16} />
              </button>
              <span className="tnum bold" style={{ width: 64, textAlign: 'right' }}>
                {money(l.price * l.qty)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mo-grid">
        {tiles.map((x) => (
          <button
            key={x.id}
            className="mo-tile"
            onClick={() =>
              setBasket((b) => {
                const ex = b.find((l) => l.refId === x.id);
                if (ex) return b.map((l) => (l.refId === x.id ? { ...l, qty: l.qty + 1 } : l));
                return [
                  ...b,
                  { key: uuid(), kind: x.kind, refId: x.id, name: x.name, price: x.price, qty: 1 },
                ];
              })
            }
          >
            <span className="bold" style={{ lineHeight: '18px' }}>
              {x.name}
            </span>
            <span className="muted" style={{ fontSize: 12, fontWeight: 500 }}>
              {x.meta}
            </span>
            <span className="tnum" style={{ fontSize: 16, fontWeight: 800 }}>
              {money(x.price)}
            </span>
          </button>
        ))}
      </div>
    </>
  );

  const week = (() => {
    const rows = new Map<string, { revenue: number; jobs: number }>();
    for (const i of invoices.data?.invoices ?? []) {
      if (i.status !== 'Paid') continue;
      const r = rows.get(i.employeeName) ?? { revenue: 0, jobs: 0 };
      r.revenue += i.total;
      r.jobs += 1;
      rows.set(i.employeeName, r);
    }
    return [...rows.entries()]
      .map(([name, r]) => ({ name, ...r }))
      .sort((a, b) => b.revenue - a.revenue);
  })();
  const top = week[0]?.revenue ?? 1;
  const rank = (
    <>
      <p className="muted" style={{ fontWeight: 500 }}>
        {t('mo.rankSub')}
      </p>
      {week.map((e, i) => (
        <div
          key={e.name}
          className={`rank-row${i === 0 ? ' top' : ''}${e.name === me?.name ? ' me' : ''}`}
        >
          <span className="rank-n">{i + 1}</span>
          <span style={{ flex: 1 }}>
            <span className="bold">
              {e.name}
              {e.name === me?.name ? ` · ${t('mo.you')}` : ''}
            </span>
            <span className="muted" style={{ display: 'block', fontSize: 12, fontWeight: 500 }}>
              {e.jobs} {t('mo.sales')}
            </span>
            <span className="rank-bar">
              <span style={{ width: `${Math.round((e.revenue / top) * 100)}%` }} />
            </span>
          </span>
          <span className="tnum bold">{money(e.revenue)}</span>
        </div>
      ))}
    </>
  );

  return (
    <div className="mo-app">
      <div className="mo-head">
        <div>
          <div className="t">
            {tab === 'agenda' ? t('mo.myDay') : tab === 'pos' ? t('mo.checkout') : t('mo.ranking')}
          </div>
          <div className="s">
            {me?.name.split(' ')[0]} · {me?.email}
          </div>
        </div>
        <button className="iconbtn" aria-label={t('shell.signOut')} onClick={() => void logout()}>
          <Icon d={I.x} size={20} />
        </button>
      </div>
      <div className="mo-body">
        {tab === 'agenda' ? agenda : tab === 'pos' ? pos : rank}
      </div>
      {tab === 'pos' && basket.length ? (
        <div className="mo-bar">
          <div style={{ flex: 1 }}>
            <div className="s muted" style={{ fontSize: 11, fontWeight: 700 }}>
              {t('till.total').toUpperCase()}
            </div>
            <div className="tnum" style={{ fontSize: 22, fontWeight: 800 }}>
              {money(total)}
            </div>
          </div>
          {payOpen ? (
            <>
              <button className="btn btn-secondary" onClick={() => void pay('Cash')}>
                {t('till.cash')}
              </button>
              <button className="btn btn-primary" onClick={() => void pay('Card')}>
                {t('till.card')}
              </button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={() => setPayOpen(true)}>
              {t('mo.takePayment')}
            </button>
          )}
        </div>
      ) : null}
      <div className="mo-tabs">
        {(
          [
            ['agenda', t('mo.agenda'), I.calendar],
            ['pos', t('mo.till'), I.register],
            ['rank', t('mo.ranking'), I.reports],
          ] as const
        ).map(([k, l, ic]) => (
          <button
            key={k}
            className={`mo-tab${tab === k ? ' on' : ''}`}
            onClick={() => setTab(k)}
          >
            <Icon d={ic} size={22} w={1.9} />
            {l}
          </button>
        ))}
      </div>
      <div className="toast" hidden={!toast} role="status">
        {toast}
      </div>
    </div>
  );
}
