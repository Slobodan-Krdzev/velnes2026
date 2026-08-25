import {
  PortalDashboardSchema,
  PortalSalonListSchema,
  PurchaseOrderListSchema,
  PurchaseOrderSchema,
  SupplierProductListSchema,
  SupplierPromotionListSchema,
  type PurchaseOrder,
} from '@velnes/contracts';
import type { Lang } from '@velnes/i18n';
import { VelnesMark } from '@velnes/ui';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { pGet, pPatch, pPost, PortalApiError, type PortalUser } from './api.js';

/** viewPortal: dashboard, salons, catalog, orders live; promotions
 *  read-only; academy, reports and settings keep honest empty states
 *  until their engines land. */

const money = (n: number) =>
  new Intl.NumberFormat('mk-MK', { style: 'currency', currency: 'MKD', maximumFractionDigits: 0 }).format(n);
const dateShort = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${Number(d)}.${Number(m)}.${y}`;
};

const TABS = [
  ['dashboard', 'po.tabDashboard'],
  ['salons', 'po.tabSalons'],
  ['catalog', 'po.tabCatalog'],
  ['orders', 'po.tabOrders'],
  ['promotions', 'po.tabPromotions'],
  ['academy', 'po.tabAcademy'],
  ['reports', 'po.tabReports'],
  ['settings', 'po.tabSettings'],
] as const;
type Tab = (typeof TABS)[number][0];

export function Portal({
  user,
  setLang,
  signOut,
}: {
  user: PortalUser;
  setLang: (l: Lang) => void;
  signOut: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [toast, setToast] = useState<string | null>(null);
  const say = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3500);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header className="topbar" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '0 20px' }}>
        <span style={{ color: 'var(--accent-deep)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <VelnesMark size={26} />
          <strong>{user.supplierName}</strong>
        </span>
        <div className="cat-tabs" style={{ marginLeft: 12 }}>
          {TABS.map(([k, label]) => (
            <button key={k} className={`ttab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>
              {t(label)}
            </button>
          ))}
        </div>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <select
            className="select"
            aria-label="Language"
            value={i18n.language}
            onChange={(e) => setLang(e.target.value as Lang)}
          >
            <option value="en">EN</option>
            <option value="mk">МК</option>
            <option value="sq">SQ</option>
          </select>
          <span className="badge">{user.name}</span>
          <button className="btn btn-subtle btn-sm" onClick={signOut}>
            {t('po.signOut')}
          </button>
        </span>
      </header>
      <main style={{ flex: 1, padding: 24, maxWidth: 1280, width: '100%', margin: '0 auto' }}>
        {tab === 'dashboard' ? <Dashboard say={say} /> : null}
        {tab === 'salons' ? <Salons /> : null}
        {tab === 'catalog' ? <Catalog say={say} /> : null}
        {tab === 'orders' ? <Orders say={say} /> : null}
        {tab === 'promotions' ? <Promotions /> : null}
        {tab === 'academy' ? <Soon body={t('po.academySub')} /> : null}
        {tab === 'reports' ? <Soon body={t('po.reportsSub')} /> : null}
        {tab === 'settings' ? <Soon body={t('po.settingsSub')} /> : null}
      </main>
      {toast ? <div className="toast show">{toast}</div> : null}
    </div>
  );
}

function Soon({ body }: { body: string }) {
  const { t } = useTranslation();
  return (
    <div className="empty">
      <h3>{t('po.comingLater')}</h3>
      <p>{body}</p>
    </div>
  );
}

function Dashboard({ say }: { say: (m: string) => void }) {
  const { t } = useTranslation();
  const [stats, setStats] = useState<z.infer<typeof PortalDashboardSchema> | null>(null);
  const [salons, setSalons] = useState<z.infer<typeof PortalSalonListSchema> | null>(null);
  const reload = useCallback(() => {
    void pGet(PortalDashboardSchema, '/portal/dashboard').then(setStats);
    void pGet(PortalSalonListSchema, '/portal/salons').then(setSalons);
  }, []);
  useEffect(reload, [reload]);
  const pending = (salons?.salons ?? []).filter((s) => s.status === 'pending');

  const decide = async (businessId: string, action: 'accept' | 'decline') => {
    try {
      await pPost(z.object({ ok: z.literal(true) }), `/portal/connections/${businessId}/${action}`, {});
      say(t(action === 'accept' ? 'po.accepted' : 'po.declined'));
      reload();
    } catch (e) {
      say(e instanceof PortalApiError ? e.message : 'failed');
    }
  };

  return (
    <div className="stacked">
      <div className="grid4">
        <Stat label={t('po.connectedSalons')} value={stats?.salons ?? '—'} />
        <Stat label={t('po.openOrders')} value={stats?.openOrders ?? '—'} hint={t('po.acrossAccounts')} />
        <Stat label={t('po.yourProducts')} value={stats?.products ?? '—'} hint={t('po.inYourCatalog')} />
        <Stat label={t('po.pendingRequests')} value={stats?.pendingConnections ?? '—'} />
      </div>
      {pending.length ? (
        <div className="card" style={{ borderColor: 'var(--accent-deep)' }}>
          <div className="card-header">
            <h2>{t('po.newConnections')}</h2>
            <span className="badge accent">{pending.length}</span>
          </div>
          {pending.map((r) => (
            <div className="rowcard" key={r.businessId}>
              <span className="mark on">{r.name[0]}</span>
              <span className="grow">
                <span className="t">{r.name}</span>
                <span className="s">{r.note || '—'}</span>
              </span>
              <span className="acts">
                <button className="btn btn-subtle btn-sm" onClick={() => void decide(r.businessId, 'decline')}>
                  {t('po.decline')}
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => void decide(r.businessId, 'accept')}>
                  {t('po.accept')}
                </button>
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="note">{t('po.paymentsNote')}</div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint ? <span className="stat-hint">{hint}</span> : null}
    </div>
  );
}

function Salons() {
  const { t } = useTranslation();
  const [salons, setSalons] = useState<z.infer<typeof PortalSalonListSchema> | null>(null);
  useEffect(() => {
    void pGet(PortalSalonListSchema, '/portal/salons').then(setSalons);
  }, []);
  return (
    <div className="card">
      <table>
        <thead>
          <tr>
            <th>{t('po.salon')}</th>
            <th>{t('po.customerNo')}</th>
            <th>{t('po.connectedSince')}</th>
            <th className="right">{t('po.orders')}</th>
            <th className="right">{t('po.value')}</th>
            <th className="right">{t('po.open')}</th>
            <th>{t('po.status')}</th>
          </tr>
        </thead>
        <tbody>
          {(salons?.salons ?? []).map((s) => (
            <tr key={s.businessId}>
              <td className="bold">{s.name}</td>
              <td className="muted tnum">{s.customerNo || '—'}</td>
              <td className="muted tnum">{s.connected ? dateShort(s.connected) : '—'}</td>
              <td className="right tnum">{s.orders}</td>
              <td className="right bold tnum">{money(s.value)}</td>
              <td className="right tnum">{s.openOrders}</td>
              <td>
                <span className={`badge ${s.status === 'connected' ? 'success' : s.status === 'pending' ? 'warning' : ''}`}>
                  {s.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Catalog({ say }: { say: (m: string) => void }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<z.infer<typeof SupplierProductListSchema> | null>(null);
  const reload = useCallback(() => {
    void pGet(SupplierProductListSchema, '/portal/catalog').then(setRows);
  }, []);
  useEffect(reload, [reload]);

  const save = async (id: string, body: Record<string, unknown>) => {
    try {
      await pPatch(z.object({ ok: z.literal(true) }), `/portal/catalog/${id}`, body);
      say(t('po.stockSaved'));
      reload();
    } catch (e) {
      say(e instanceof PortalApiError ? e.message : 'failed');
    }
  };

  return (
    <div className="card">
      <table>
        <thead>
          <tr>
            <th>{t('po.product')}</th>
            <th className="right">{t('po.buy')}</th>
            <th className="right">{t('po.rrp')}</th>
            <th className="right">{t('po.stock')}</th>
            <th className="right">{t('po.active')}</th>
          </tr>
        </thead>
        <tbody>
          {(rows?.products ?? []).map((p) => (
            <tr key={p.id} className={p.active === false ? 'dim' : ''}>
              <td>
                <span className="bold">{p.name}</span>{' '}
                {p.sample ? <span className="badge accent">{t('po.sample')}</span> : null}
                <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                  {p.brand} · {p.sku} · {p.size}
                </span>
              </td>
              <td className="right bold tnum">{p.buy ? money(p.buy) : '—'}</td>
              <td className="right muted tnum">{p.rrp ? money(p.rrp) : '—'}</td>
              <td className="right">
                <input
                  className="input qty-in"
                  type="number"
                  min={0}
                  defaultValue={p.stock}
                  aria-label={`Stock ${p.name}`}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (v !== p.stock) void save(p.id, { stock: v });
                  }}
                />
              </td>
              <td className="right">
                <span className="rowact">
                  <button
                    className={`toggle ${p.active !== false ? 'on' : ''}`}
                    role="switch"
                    aria-checked={p.active !== false}
                    aria-label={`Active ${p.name}`}
                    onClick={() => void save(p.id, { active: p.active === false })}
                  >
                    <span className="knob" />
                  </button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const statusKey: Record<string, string> = {
  submitted: 'sup.statusSubmitted', accepted: 'sup.statusAccepted', partial: 'sup.statusPartial',
  processing: 'sup.statusProcessing', shipped: 'sup.statusShipped',
  partdelivered: 'sup.statusPartdelivered', delivered: 'sup.statusDelivered',
  cancelled: 'sup.statusCancelled', disputed: 'sup.statusDisputed',
};

function Orders({ say }: { say: (m: string) => void }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<PurchaseOrder[]>([]);
  const [track, setTrack] = useState<Record<string, string>>({});
  const reload = useCallback(() => {
    void pGet(PurchaseOrderListSchema, '/portal/orders').then((r) => setRows(r.orders));
  }, []);
  useEffect(reload, [reload]);

  const move = async (id: string, to: string, trackNo?: string) => {
    try {
      await pPost(PurchaseOrderSchema, `/portal/orders/${id}/transitions`, {
        to,
        ...(trackNo !== undefined ? { track: trackNo } : {}),
      });
      if (to === 'shipped') say(t('po.shipped'));
      reload();
    } catch (e) {
      say(e instanceof PortalApiError ? e.message : 'failed');
    }
  };

  if (!rows.length)
    return (
      <div className="empty">
        <h3>{t('po.noOrders')}</h3>
        <p>{t('po.noOrdersSub')}</p>
      </div>
    );

  return (
    <div className="card">
      <table>
        <thead>
          <tr>
            <th>{t('po.order')}</th>
            <th>{t('po.salon')}</th>
            <th>{t('po.placed')}</th>
            <th className="right">{t('po.value')}</th>
            <th>{t('po.status')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id}>
              <td>
                <span className="bold">{o.ref}</span>
                <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                  {o.lines.length} × · {o.byName}
                </span>
              </td>
              <td className="muted">{o.locationId.slice(0, 8)}</td>
              <td className="muted tnum">{dateShort(o.createdAt.slice(0, 10))}</td>
              <td className="right bold tnum">{money(o.total)}</td>
              <td>
                <span
                  className={`badge ${o.status === 'delivered' ? 'success' : o.status === 'disputed' ? 'danger' : 'info'}`}
                >
                  {t(statusKey[o.status] ?? o.status)}
                </span>
              </td>
              <td className="right">
                {o.status === 'submitted' ? (
                  <button className="btn btn-primary btn-sm" onClick={() => void move(o.id, 'accepted')}>
                    {t('po.acceptOrder')}
                  </button>
                ) : o.status === 'accepted' || o.status === 'partial' ? (
                  <button className="btn btn-secondary btn-sm" onClick={() => void move(o.id, 'processing')}>
                    {t('po.startProcessing')}
                  </button>
                ) : o.status === 'processing' ? (
                  <span style={{ display: 'inline-flex', gap: 6 }}>
                    <input
                      className="input"
                      style={{ maxWidth: 170 }}
                      placeholder={t('po.track')}
                      value={track[o.id] ?? ''}
                      onChange={(e) => setTrack((x) => ({ ...x, [o.id]: e.target.value }))}
                    />
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => void move(o.id, 'shipped', track[o.id] ?? '')}
                    >
                      {t('po.ship')}
                    </button>
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Promotions() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<z.infer<typeof SupplierPromotionListSchema> | null>(null);
  useEffect(() => {
    // The salon-side list filtered by RLS would need a tenant; the
    // portal reads its own promotions through the platform policy.
    void pGet(SupplierPromotionListSchema, '/portal/promotions').then(setRows).catch(() => setRows({ promotions: [] }));
  }, []);
  return (
    <div className="card">
      <div className="card-header">
        <h2>{t('po.promoTitle')}</h2>
      </div>
      {(rows?.promotions ?? []).map((o) => (
        <div className="rowcard" key={o.id}>
          <span className="mark on">%</span>
          <span className="grow">
            <span className="t">{o.title}</span>
            <span className="s">{o.terms}</span>
            <span className="s">
              {t('po.until', { date: dateShort(o.ends) })} · {o.audience}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
