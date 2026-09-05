import {
  PO_FLAT,
  PO_PERM_GROUPS,
  PO_SCOPES,
  PortalCompanySchema,
  PortalDashboardSchema,
  PortalNotificationListSchema,
  PortalProductCreateSchema,
  PortalReportsSchema,
  PortalRoleListSchema,
  PortalSalonListSchema,
  PortalTeamListSchema,
  PurchaseOrderListSchema,
  PurchaseOrderSchema,
  SupplierProductListSchema,
  SupplierPromotionListSchema,
  SUPPORT_CATEGORIES,
  SupportTicketListSchema,
  type PurchaseOrder,
  type SupportCategory,
  type SupportTicket,
} from '@velnes/contracts';
import type { Lang } from '@velnes/i18n';
import { I, Icon, VelnesMark } from '@velnes/ui';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { pDelete, pGet, pPatch, pPost, PortalApiError, type PortalUser } from './api.js';

/** The supplier's own workspace: the prototype's viewPortal, chrome
 *  and all. Dashboard, Salons, Catalog, Orders and Promotions read
 *  and write real data; Academy and Reports/Settings land in their
 *  own phases. */

const money = (n: number) =>
  new Intl.NumberFormat('mk-MK', { style: 'currency', currency: 'MKD', maximumFractionDigits: 0 }).format(n);
const dateShort = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${Number(d)}.${Number(m)}.${y}`;
};
const initials = (n: string) =>
  n.split(' ').map((p) => p[0]).join('').slice(0, 2);

type Tab =
  | 'dashboard'
  | 'orders'
  | 'salons'
  | 'catalog'
  | 'promotions'
  | 'academy'
  | 'reports'
  | 'support'
  | 'settings';

// The prototype's PORTAL_NAV order (Orders sits second); Settings is
// in the sidebar foot, like the salon workspace.
const NAV: { tab: Tab; label: string; icon: string; size: number }[] = [
  { tab: 'dashboard', label: 'po.tabDashboard', icon: I.reports, size: 28 },
  { tab: 'orders', label: 'po.tabOrders', icon: I.invoice, size: 26 },
  { tab: 'salons', label: 'po.tabSalons', icon: I.users, size: 28 },
  { tab: 'catalog', label: 'po.tabCatalog', icon: I.products, size: 28 },
  { tab: 'promotions', label: 'po.tabPromotions', icon: I.tag, size: 26 },
  { tab: 'academy', label: 'po.tabAcademy', icon: I.note, size: 26 },
  { tab: 'reports', label: 'po.tabReports', icon: I.pulse, size: 26 },
  { tab: 'support', label: 'nav.support', icon: I.info, size: 26 },
];

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
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [notifs, setNotifs] = useState<z.infer<typeof PortalNotificationListSchema>['notifications']>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement | null>(null);
  const [focusOrder, setFocusOrder] = useState<string | null>(null);
  const clearFocus = useCallback(() => setFocusOrder(null), []);
  const [focusTicket, setFocusTicket] = useState<string | null>(null);
  const clearTicketFocus = useCallback(() => setFocusTicket(null), []);
  const say = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    document.body.classList.add('env-portal');
    return () => document.body.classList.remove('env-portal');
  }, []);
  useEffect(() => {
    const load = () =>
      void pGet(PortalNotificationListSchema, '/portal/notifications')
        .then((r) => setNotifs(r.notifications))
        .catch(() => undefined);
    load();
    const iv = setInterval(load, 60_000);
    return () => clearInterval(iv);
  }, []);
  useEffect(() => {
    if (!notifOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [notifOpen]);
  const latestNotif = notifs[0]?.createdAt ?? '';
  const seenNotif = (() => {
    try {
      return localStorage.getItem('velnes.portal.notifsSeen') ?? '';
    } catch {
      return '';
    }
  })();
  const unseen = !!latestNotif && latestNotif > seenNotif;
  useEffect(() => {
    if (!menu) return;
    const onPointer = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [menu]);

  return (
    <>
      <aside className="sidebar">
        <div className="sidebar-group">
          <div className="applogo" title={t('po.portalTitle')}>
            <VelnesMark size={34} />
          </div>
          <nav id="nav-main" className="sidebar-group">
            {NAV.map((n) => (
              <button
                key={n.tab}
                className={`tile${tab === n.tab ? ' active' : ''}`}
                title={t(n.label)}
                aria-label={t(n.label)}
                onClick={() => setTab(n.tab)}
              >
                <Icon d={n.icon} size={n.size} w={1.9} />
              </button>
            ))}
          </nav>
        </div>
        <nav id="nav-foot" className="sidebar-group">
          <button
            className={`tile${tab === 'settings' ? ' active' : ''}`}
            title={t('po.tabSettings')}
            aria-label={t('po.tabSettings')}
            onClick={() => setTab('settings')}
          >
            <Icon d={I.gear} size={26} w={1.9} />
          </button>
        </nav>
      </aside>

      <div className="shell">
        <header className="topbar">
          <div className="topbar-left">
            <h1 id="page-title">{t('po.portalTitle')}</h1>
          </div>
          <div className="topbar-mid" id="topbar-mid" />
          <div className="topbar-right">
            <div className="pop" ref={notifRef}>
              <button
                className="iconbtn"
                style={{ position: 'relative' }}
                aria-label={t('po.notifications')}
                aria-haspopup="menu"
                aria-expanded={notifOpen}
                onClick={() => {
                  setNotifOpen((v) => !v);
                  if (latestNotif) {
                    try {
                      localStorage.setItem('velnes.portal.notifsSeen', latestNotif);
                    } catch {
                      /* private mode — the dot just stays */
                    }
                  }
                }}
              >
                <Icon d={I.bell} size={24} w={2} />
                {unseen ? <span className="dot" /> : null}
              </button>
              {notifOpen ? (
                <div className="menu menu-wide menu-scroll" role="menu">
                  <div className="menu-label">{t('po.notifications')}</div>
                  {notifs.length === 0 ? (
                    <div className="menu-label" style={{ fontWeight: 500 }}>
                      {t('po.noNotifications')}
                    </div>
                  ) : (
                    notifs.map((n) => (
                      <button
                        key={n.id}
                        className="menu-row"
                        onClick={() => {
                          setNotifOpen(false);
                          if (n.kind === 'ticket') {
                            setTab('support');
                            if (n.refId) setFocusTicket(n.refId);
                          } else {
                            setTab('orders');
                            if (n.refId) setFocusOrder(n.refId);
                          }
                        }}
                      >
                        <Icon d={n.kind === 'ticket' ? I.info : I.invoice} size={20} />
                        <span className="grow" style={{ textAlign: 'left' }}>
                          <span className="mi-t" style={{ fontWeight: 700 }}>
                            {n.title}
                          </span>
                          <span className="mi-s" style={{ display: 'block' }}>
                            {n.body} · {n.createdAt.slice(0, 10)}
                          </span>
                        </span>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
            <div className="pop" ref={menuRef}>
              <button
                className="avatar"
                aria-haspopup="menu"
                aria-expanded={menu}
                title={user.name}
                onClick={() => setMenu((v) => !v)}
              >
                {initials(user.name)}
              </button>
              {menu ? (
                <div className="menu menu-wide menu-scroll" role="menu">
                  <div className="menu-label">{t('po.signedIn')}</div>
                  <div style={{ padding: '4px 12px 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="avatar">{initials(user.name)}</span>
                    <span>
                      <span className="mi-t" style={{ fontWeight: 700 }}>
                        {user.name}
                      </span>
                      <span className="mi-s">
                        {user.supplierName} · {user.role}
                      </span>
                    </span>
                  </div>
                  <div className="menu-sep" />
                  <div className="menu-label">{t('po.language')}</div>
                  {(['en', 'mk', 'sq'] as const).map((l) => (
                    <button
                      key={l}
                      className="menu-row"
                      onClick={() => {
                        setLang(l);
                        setMenu(false);
                      }}
                    >
                      <span className={`check${i18n.language === l ? ' on' : ''}`}>
                        <Icon d={I.check} size={14} w={3.5} />
                      </span>
                      <span className="grow">
                        <span className="mi-t">{t(`lang.${l}`)}</span>
                      </span>
                    </button>
                  ))}
                  <div className="menu-sep" />
                  <button className="menu-row" onClick={signOut}>
                    <span className="check">
                      <Icon d={I.arrowleft} size={14} w={2.5} />
                    </span>
                    <span className="grow">
                      <span className="mi-t">{t('po.signOut')}</span>
                    </span>
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <main id="view">
          {tab === 'dashboard' ? <Dashboard user={user} say={say} goto={setTab} /> : null}
          {tab === 'orders' ? <Orders say={say} focusOrderId={focusOrder} clearFocus={clearFocus} /> : null}
          {tab === 'salons' ? <Salons user={user} say={say} /> : null}
          {tab === 'catalog' ? <Catalog user={user} say={say} /> : null}
          {tab === 'promotions' ? <Promotions user={user} say={say} /> : null}
          {tab === 'academy' ? <Academy say={say} user={user} /> : null}
          {tab === 'reports' ? <Reports /> : null}
          {tab === 'support' ? (
            <PortalSupport say={say} focusId={focusTicket} clearFocus={clearTicketFocus} />
          ) : null}
          {tab === 'settings' ? <Settings user={user} say={say} /> : null}
        </main>
      </div>
      {toast ? <div className="toast show">{toast}</div> : null}
    </>
  );
}

/** The prototype's #panel drawer, portaled to the body. */
function Panel({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    document.body.classList.add('panel-open');
    return () => document.body.classList.remove('panel-open');
  }, []);
  return createPortal(
    <>
      <div className="scrim on" onClick={onClose} />
      <aside className="panel open" role="dialog" aria-modal="true">
        {children}
      </aside>
    </>,
    document.body,
  );
}

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint ? <span className="stat-hint">{hint}</span> : null}
    </div>
  );
}

// ── Dashboard ────────────────────────────────────────────────────
function Dashboard({
  user,
  say,
  goto,
}: {
  user: PortalUser;
  say: (m: string) => void;
  goto: (t: Tab) => void;
}) {
  const { t } = useTranslation();
  const [d, setD] = useState<z.infer<typeof PortalDashboardSchema> | null>(null);
  const reload = useCallback(() => {
    void pGet(PortalDashboardSchema, '/portal/dashboard').then(setD);
  }, []);
  useEffect(reload, [reload]);

  const decide = async (businessId: string, action: 'accept' | 'decline') => {
    try {
      await pPost(z.object({ ok: z.literal(true) }), `/portal/connections/${businessId}/${action}`, {});
      say(t(action === 'accept' ? 'po.accepted' : 'po.declined'));
      reload();
    } catch (e) {
      say(e instanceof PortalApiError ? e.message : 'failed');
    }
  };

  const pay = d?.payments;
  const payStatus = pay?.status ?? 'none';
  const maxBest = Math.max(...(d?.bestSelling ?? []).map((b) => b.value), 1);
  const attnIcon = (k: 'products' | 'invoice' | 'tag') =>
    k === 'products' ? I.products : k === 'invoice' ? I.invoice : I.tag;
  const attnLabel = (k: 'products' | 'invoice' | 'tag') =>
    k === 'products' ? t('po.updateStock') : k === 'invoice' ? t('po.openOrder') : t('po.seeResults');

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-context">
          <span className="k">{t('po.portalTitle')}</span>
          <span className="v">{d?.supplierName ?? user.supplierName}</span>
        </div>
        <div className="toolbar-actions">
          <span className="envtag portal">
            {d?.supplierType ?? 'Supplier'} · {(d?.brands ?? []).join(', ')}
          </span>
        </div>
      </div>
      <div className="stacked">
        <div className="grid5">
          <Stat label={t('po.connectedSalons')} value={d?.salons ?? '—'} hint={t('po.connectedHint')} />
          <Stat label={t('po.openOrders')} value={d?.openOrders ?? '—'} hint={t('po.acrossAccounts')} />
          <Stat label={t('po.orderValue')} value={d ? money(d.orderValue30) : '—'} hint={t('po.last30')} />
          <Stat
            label={t('po.repeatOrders')}
            value={d ? (d.repeatRate === null ? '—' : `${d.repeatRate}%`) : '—'}
            hint={t('po.repeatHint')}
          />
          <Stat
            label={t('po.trainingSeats')}
            value={d?.trainingSeats ? `${d.trainingSeats.taken} of ${d.trainingSeats.seats}` : '—'}
            hint={t('po.seatsHint')}
          />
        </div>

        <div className="card">
          <div className="card-header">
            <h2>{t('po.payments')}</h2>
            <span
              className={`badge ${payStatus === 'active' ? 'success' : payStatus === 'pending' ? 'warning' : payStatus === 'none' ? '' : 'danger'}`}
            >
              {t(`po.pay_${payStatus}`)}
            </span>
          </div>
          <div className="grid2" style={{ padding: 20 }}>
            <div className="kv">
              <span className="k">{t('po.legalEntity')}</span>
              <span className="v">{pay?.legalEntity ?? '—'}</span>
            </div>
            <div className="kv">
              <span className="k">{t('po.merchantId')}</span>
              <span className="v tnum">{pay?.merchantId ?? t('po.notAssigned')}</span>
            </div>
            <div className="kv">
              <span className="k">{t('po.provider')}</span>
              <span className="v">{pay?.provider ?? '—'}</span>
            </div>
            <div className="kv">
              <span className="k">{t('po.settlement')}</span>
              <span className="v tnum">{pay?.settlement ?? '—'}</span>
            </div>
          </div>
          <div className="note" style={{ margin: '0 20px 20px' }}>
            {t('po.paymentsNote')}
          </div>
        </div>

        {d && d.requests.length ? (
          <div className="card" style={{ borderColor: 'var(--accent-deep)' }}>
            <div className="card-header">
              <h2>{t('po.newConnections')}</h2>
              <span className="badge accent">{d.requests.length}</span>
            </div>
            {d.requests.map((r) => (
              <div className="rowcard" key={r.businessId}>
                <span className="mark on">{r.name[0]}</span>
                <span className="grow">
                  <span className="t">{r.name}</span>
                  <span className="s">
                    {[r.city, t('po.locationsCount', { n: r.locations }), r.note]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <span className="s">{t('po.willShare', { what: r.shares })}</span>
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

        <div className="grid2">
          <div className="card">
            <div className="card-header">
              <h2>{t('po.bestSelling')}</h2>
              <span className="muted" style={{ fontWeight: 500 }}>
                {t('po.last30')}
              </span>
            </div>
            <table>
              <tbody>
                {(d?.bestSelling ?? []).map((b) => (
                  <tr key={b.name}>
                    <td className="bold">{b.name}</td>
                    <td className="right tnum">{money(b.value)}</td>
                    <td style={{ width: 140 }}>
                      <div className="bar-h">
                        <span style={{ width: `${Math.round((b.value / maxBest) * 100)}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
                {d && d.bestSelling.length === 0 ? (
                  <tr>
                    <td className="muted" style={{ fontWeight: 500 }}>
                      {t('po.noSalesYet')}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="card">
            <div className="card-header">
              <h2>{t('po.needsAttention')}</h2>
            </div>
            {(d?.attention ?? []).map((a, i) => (
              <div className="rowcard" key={i}>
                <span className="mark">
                  <Icon d={attnIcon(a.icon)} size={20} />
                </span>
                <span className="grow">
                  <span className="t">{a.title}</span>
                  <span className="s">{a.detail}</span>
                </span>
                <button className="btn btn-subtle btn-sm" onClick={() => goto(a.tab)}>
                  {attnLabel(a.icon)}
                </button>
              </div>
            ))}
            {d && d.attention.length === 0 ? (
              <p className="muted" style={{ padding: '16px 20px', fontWeight: 500 }}>
                {t('po.allClear')}
              </p>
            ) : null}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2>{t('po.newestOrders')}</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => goto('orders')}>
              {t('po.viewAllOrders')}
            </button>
          </div>
          <table>
            <thead>
              <tr>
                <th>{t('po.order')}</th>
                <th>{t('po.salon')}</th>
                <th>{t('po.placed')}</th>
                <th className="right">{t('po.value')}</th>
                <th>{t('po.status')}</th>
              </tr>
            </thead>
            <tbody>
              {(d?.recentOrders ?? []).map((o) => (
                <tr key={o.id} className="clickable" onClick={() => goto('orders')}>
                  <td className="bold">{o.ref}</td>
                  <td className="muted">{o.salonName ?? '—'}</td>
                  <td className="muted tnum">{dateShort(o.createdAt.slice(0, 10))}</td>
                  <td className="right bold tnum">{money(o.total)}</td>
                  <td>
                    <span
                      className={`badge ${o.status === 'delivered' ? 'success' : o.status === 'disputed' ? 'danger' : 'info'}`}
                    >
                      {t(statusKey[o.status] ?? o.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {d && d.recentOrders.length === 0 ? (
            <p className="muted" style={{ padding: '16px 20px', fontWeight: 500 }}>
              {t('po.noOrdersYet')}
            </p>
          ) : null}
        </div>
      </div>
    </>
  );
}

// ── Salons ───────────────────────────────────────────────────────
/** Escape one CSV cell (RFC 4180): quote when it holds a comma,
 *  quote or newline, doubling any inner quotes. */
const csvCell = (v: string | number) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function Salons({ user, say }: { user: PortalUser; say: (m: string) => void }) {
  const { t } = useTranslation();
  const [salons, setSalons] = useState<z.infer<typeof PortalSalonListSchema> | null>(null);
  useEffect(() => {
    void pGet(PortalSalonListSchema, '/portal/salons').then(setSalons);
  }, []);
  const connected = (salons?.salons ?? []).filter((s) => s.status !== 'declined');

  const exportCsv = () => {
    if (!connected.length) {
      say(t('po.nothingToExport'));
      return;
    }
    const header = [
      t('po.salon'), t('po.customerNo'), t('po.connectedSince'),
      t('po.orders'), t('po.valueCsv'), t('po.open'), t('po.status'),
    ];
    const body = connected.map((s) => [
      s.name,
      s.customerNo || '',
      s.connected ?? '',
      s.orders,
      s.value,
      s.openOrders,
      t(`po.connStatus_${s.status}`),
    ]);
    // Lead with a BOM so Excel reads UTF-8 (č, š, etc.) correctly.
    const csv = '﻿' + [header, ...body].map((r) => r.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const slug = user.supplierName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const today = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug || 'velnes'}-salons-${today}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    say(t('po.exported', { n: connected.length }));
  };

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-context">
          <span className="k">{t('po.tabSalons')}</span>
          <span className="v">{t('po.connectedCount', { n: connected.length })}</span>
        </div>
        <div className="toolbar-actions">
          <button className="btn btn-subtle" onClick={exportCsv}>
            {t('po.export')}
          </button>
        </div>
      </div>
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
            {connected.map((s) => (
              <tr key={s.businessId}>
                <td className="bold">{s.name}</td>
                <td className="muted tnum">{s.customerNo || '—'}</td>
                <td className="muted tnum">{s.connected ? dateShort(s.connected) : '—'}</td>
                <td className="right tnum">{s.orders}</td>
                <td className="right bold tnum">{money(s.value)}</td>
                <td className="right tnum">{s.openOrders}</td>
                <td>
                  <span
                    className={`badge ${s.status === 'connected' ? 'success' : s.status === 'pending' ? 'warning' : ''}`}
                  >
                    {t(`po.connStatus_${s.status}`)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="note" style={{ margin: '16px 20px' }}>
          {t('po.salonsNote')}
        </div>
      </div>
    </>
  );
}

// ── Catalog ──────────────────────────────────────────────────────
const USE_LABEL: Record<string, string> = { pro: 'po.usePro', retail: 'po.useRetail', both: 'po.useBoth' };

type CatProduct = z.infer<typeof SupplierProductListSchema>['products'][number];

function Catalog({ user, say }: { user: PortalUser; say: (m: string) => void }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<CatProduct[]>([]);
  const [edit, setEdit] = useState<'new' | CatProduct | null>(null);
  const [bulk, setBulk] = useState(false);
  const canEdit = user.role === 'sr_owner' || user.role === 'sr_catalog';
  const reload = useCallback(() => {
    void pGet(SupplierProductListSchema, '/portal/catalog').then((r) => setRows(r.products));
  }, []);
  useEffect(reload, [reload]);

  const toggle = async (p: CatProduct) => {
    try {
      await pPatch(z.object({ ok: z.literal(true) }), `/portal/catalog/${p.id}`, {
        active: p.active === false,
      });
      say(p.active === false ? t('po.availOn') : t('po.availOff'));
      reload();
    } catch (e) {
      say(e instanceof PortalApiError ? e.message : 'failed');
    }
  };

  const brands = [...new Set(rows.map((r) => r.brand).filter(Boolean))];

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-context">
          <span className="k">{t('po.tabCatalog')}</span>
          <span className="v">{t('po.productsCount', { n: rows.length })}</span>
        </div>
        {canEdit ? (
          <div className="toolbar-actions">
            <button className="btn btn-secondary" onClick={() => setBulk(true)}>
              {t('po.bulkUpdate')}
            </button>
            <AddPop
              items={[
                {
                  icon: I.products,
                  label: t('po.addProduct'),
                  sub: t('po.addProductSub'),
                  onPick: () => setEdit('new'),
                },
                {
                  icon: I.mail,
                  label: t('po.importList'),
                  sub: t('po.importListSub'),
                  onPick: () => say(t('po.importSoon')),
                },
              ]}
            />
          </div>
        ) : null}
      </div>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>{t('po.product')}</th>
              <th>{t('po.brand')}</th>
              <th>{t('po.articleNo')}</th>
              <th className="right">{t('po.buy')}</th>
              <th className="right">{t('po.advisedRetail')}</th>
              <th className="right">{t('po.stock')}</th>
              <th>{t('po.use')}</th>
              <th>{t('po.availability')}</th>
              {canEdit ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className={p.active === false ? 'dim' : ''}>
                <td>
                  <span className="bold">{p.name}</span>{' '}
                  {p.sample ? <span className="badge accent">{t('po.sample')}</span> : null}
                  <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                    {t('po.eanPack', { ean: p.ean || '—', pack: p.pack })}
                  </span>
                </td>
                <td className="muted">{p.brand}</td>
                <td className="muted tnum">{p.sku}</td>
                <td className="right bold tnum">{p.buy ? money(p.buy) : '—'}</td>
                <td className="right muted tnum">{p.rrp ? money(p.rrp) : '—'}</td>
                <td className="right tnum">
                  {p.stock === 0 ? <span className="badge danger">0</span> : p.stock}
                </td>
                <td>
                  <span className={`badge ${p.use === 'pro' ? '' : 'accent'}`}>{t(USE_LABEL[p.use] ?? 'po.useBoth')}</span>
                </td>
                <td>
                  {canEdit ? (
                    <span className="rowact" style={{ alignItems: 'center', gap: 8 }}>
                      <button
                        className={`toggle ${p.active !== false ? 'on' : ''}`}
                        role="switch"
                        aria-checked={p.active !== false}
                        aria-label={t('po.availabilityFor', { name: p.name })}
                        onClick={() => void toggle(p)}
                      >
                        <span className="knob" />
                      </button>
                      <span className="muted" style={{ fontSize: 12 }}>
                        {p.active !== false ? t('po.availableShort') : t('po.pausedShort')}
                      </span>
                    </span>
                  ) : (
                    <span className={`badge ${p.active !== false ? 'success' : ''}`}>
                      {p.active !== false ? t('po.availableShort') : t('po.pausedShort')}
                    </span>
                  )}
                </td>
                {canEdit ? (
                  <td className="right">
                    <button className="btn btn-ghost btn-sm" onClick={() => setEdit(p)}>
                      {t('po.edit')}
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="note" style={{ margin: '16px 20px' }}>
          {t('po.catalogNote')}
        </div>
      </div>
      {edit ? (
        <ProductPanel
          product={edit === 'new' ? null : edit}
          brands={brands}
          onClose={() => setEdit(null)}
          onSaved={(msg) => {
            setEdit(null);
            reload();
            say(msg);
          }}
          say={say}
        />
      ) : null}
      {bulk ? (
        <BulkPricePanel
          count={rows.length}
          onClose={() => setBulk(false)}
          onSaved={(n) => {
            setBulk(false);
            reload();
            say(t('po.bulkApplied', { n }));
          }}
          say={say}
        />
      ) : null}
    </>
  );
}

function BulkPricePanel({
  count,
  onClose,
  onSaved,
  say,
}: {
  count: number;
  onClose: () => void;
  onSaved: (n: number) => void;
  say: (m: string) => void;
}) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<'buy' | 'rrp' | 'both'>('buy');
  const [percent, setPercent] = useState('');
  const pct = Number(percent);
  const valid = percent.trim() !== '' && !Number.isNaN(pct) && pct >= -90 && pct <= 500 && pct !== 0;

  const apply = async () => {
    if (!valid) {
      say(t('po.bulkNeedPercent'));
      return;
    }
    try {
      const r = await pPost(z.object({ updated: z.number() }), '/portal/catalog/bulk', { target, percent: pct });
      onSaved(r.updated);
    } catch (e) {
      say(e instanceof PortalApiError ? e.message : String(e));
    }
  };

  return (
    <Panel onClose={onClose}>
      <div className="panel-head plain">
        <div>
          <h2>{t('po.bulkTitle')}</h2>
          <p className="sub">{t('po.bulkSub', { n: count })}</p>
        </div>
        <div className="panel-actions">
          <span className={`panel-status${percent.trim() ? ' warn' : ''}`}>
            {percent.trim() ? t('drawer.statusUnsaved') : t('drawer.statusSaved')}
          </span>
          <button className="btn btn-primary btn-sm" disabled={!valid} onClick={() => void apply()}>
            {t('po.bulkApply')}
          </button>
          <button className="iconbtn" aria-label={t('po.cancel')} onClick={onClose}>
            <Icon d={I.x} size={20} />
          </button>
        </div>
      </div>
      <div className="panel-body">
        <label className="field">
          <span>{t('po.bulkWhich')}</span>
          <select
            className="select"
            style={{ width: '100%' }}
            value={target}
            onChange={(e) => setTarget(e.target.value as typeof target)}
          >
            <option value="buy">{t('po.purchasePrice')}</option>
            <option value="rrp">{t('po.advisedRetail')}</option>
            <option value="both">{t('po.bulkBoth')}</option>
          </select>
        </label>
        <label className="field">
          <span>{t('po.bulkPercent')}</span>
          <input
            className="input"
            type="number"
            step="0.5"
            placeholder="e.g. 5 or -10"
            value={percent}
            autoFocus
            onChange={(e) => setPercent(e.target.value)}
          />
          <span className="hint">{t('po.bulkPercentHint')}</span>
        </label>
        <div className="note">{t('po.bulkNote')}</div>
      </div>
    </Panel>
  );
}

function ProductPanel({
  product,
  brands,
  onClose,
  onSaved,
  say,
}: {
  product: CatProduct | null;
  brands: string[];
  onClose: () => void;
  onSaved: (msg: string) => void;
  say: (m: string) => void;
}) {
  const { t } = useTranslation();
  const editing = product !== null;
  const [confirmDel, setConfirmDel] = useState(false);
  const [f, setF] = useState({
    name: product?.name ?? '',
    brand: product?.brand ?? brands[0] ?? '',
    category: product?.category ?? '',
    sku: product?.sku ?? '',
    ean: product?.ean ?? '',
    size: product?.size ?? '',
    pack: String(product?.pack ?? 6),
    buy: product ? String(product.buy) : '',
    rrp: product ? String(product.rrp) : '',
    moq: String(product?.moq ?? 1),
    stock: String(product?.stock ?? 0),
    use: (product?.use ?? 'both') as 'retail' | 'pro' | 'both',
    descr: product?.descr ?? '',
  });
  const snap = JSON.stringify({
    name: product?.name ?? '', brand: product?.brand ?? brands[0] ?? '', category: product?.category ?? '',
    sku: product?.sku ?? '', ean: product?.ean ?? '', size: product?.size ?? '',
    pack: String(product?.pack ?? 6), buy: product ? String(product.buy) : '', rrp: product ? String(product.rrp) : '',
    moq: String(product?.moq ?? 1), stock: String(product?.stock ?? 0), use: product?.use ?? 'both', descr: product?.descr ?? '',
  });
  const dirty = JSON.stringify(f) !== snap;
  const valid = !!(f.name.trim() && f.brand.trim() && f.sku.trim() && f.buy.trim() !== '');

  const save = async () => {
    if (!valid) {
      say(t('po.productNameFirst'));
      return;
    }
    try {
      const payload = {
        name: f.name.trim(),
        brand: f.brand.trim(),
        category: f.category.trim(),
        sku: f.sku.trim(),
        ean: f.ean.trim(),
        size: f.size.trim(),
        pack: Number(f.pack) || 1,
        buy: Math.round(Number(f.buy) || 0),
        rrp: Math.round(Number(f.rrp) || 0),
        moq: Number(f.moq) || 1,
        stock: Number(f.stock) || 0,
        use: f.use,
        descr: f.descr.trim(),
      };
      if (editing) {
        await pPatch(z.object({ ok: z.literal(true) }), `/portal/catalog/${product.id}`, payload);
        onSaved(t('po.productUpdated'));
      } else {
        await pPost(z.object({ id: z.string() }), '/portal/catalog', PortalProductCreateSchema.parse(payload));
        onSaved(t('po.productPublished'));
      }
    } catch (e) {
      say(e instanceof PortalApiError ? e.message : String(e));
    }
  };

  const remove = async () => {
    if (!product) return;
    try {
      await pDelete(z.object({ ok: z.literal(true) }), `/portal/catalog/${product.id}`);
      onSaved(t('po.productDeleted'));
    } catch (e) {
      say(e instanceof PortalApiError ? e.message : String(e));
      setConfirmDel(false);
    }
  };

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });

  return (
    <Panel onClose={onClose}>
      <div className="panel-head plain">
        <div>
          <h2>{editing ? product.name : t('po.addProductTitle')}</h2>
          <p className="sub">{editing ? t('po.editProductSub') : t('po.addProductPanelSub')}</p>
        </div>
        <div className="panel-actions">
          <span className={`panel-status${dirty ? ' warn' : ''}`}>
            {dirty ? t('drawer.statusUnsaved') : t('drawer.statusSaved')}
          </span>
          <button className="btn btn-primary btn-sm" disabled={!valid || (editing && !dirty)} onClick={() => void save()}>
            {editing ? t('po.saveChanges') : t('po.publishProduct')}
          </button>
          <button className="iconbtn" aria-label={t('po.cancel')} onClick={onClose}>
            <Icon d={I.x} size={20} />
          </button>
        </div>
      </div>
      <div className="panel-body">
        <div className="grid2">
          <label className="field span2">
            <span>
              {t('po.officialName')}
              <span className="req">*</span>
            </span>
            <input className="input" value={f.name} autoFocus placeholder="Thera-Band resistance set" onChange={set('name')} />
          </label>
          <label className="field">
            <span>
              {t('po.brand')}
              <span className="req">*</span>
            </span>
            {brands.length ? (
              <select className="select" style={{ width: '100%' }} value={f.brand} onChange={set('brand')}>
                {brands.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            ) : (
              <input className="input" value={f.brand} onChange={set('brand')} />
            )}
          </label>
          <label className="field">
            <span>{t('po.category')}</span>
            <input className="input" value={f.category} onChange={set('category')} />
          </label>
          <label className="field">
            <span>
              {t('po.articleNo')}
              <span className="req">*</span>
            </span>
            <input className="input" value={f.sku} onChange={set('sku')} />
          </label>
          <label className="field">
            <span>{t('po.ean')}</span>
            <input className="input" value={f.ean} onChange={set('ean')} />
          </label>
          <label className="field">
            <span>{t('po.size')}</span>
            <input className="input" value={f.size} placeholder="300 ml" onChange={set('size')} />
          </label>
          <label className="field">
            <span>{t('po.piecesPerBox')}</span>
            <input className="input" type="number" min={1} value={f.pack} onChange={set('pack')} />
          </label>
          <label className="field">
            <span>
              {t('po.purchasePrice')}
              <span className="req">*</span>
            </span>
            <input className="input" type="number" min={0} value={f.buy} onChange={set('buy')} />
          </label>
          <label className="field">
            <span>{t('po.advisedRetail')}</span>
            <input className="input" type="number" min={0} value={f.rrp} onChange={set('rrp')} />
            <span className="hint">{t('po.rrpHint')}</span>
          </label>
          <label className="field">
            <span>{t('po.minimumOrder')}</span>
            <input className="input" type="number" min={1} value={f.moq} onChange={set('moq')} />
          </label>
          <label className="field">
            <span>{t('po.stock')}</span>
            <input className="input" type="number" min={0} value={f.stock} onChange={set('stock')} />
          </label>
          <label className="field">
            <span>{t('po.use')}</span>
            <select className="select" style={{ width: '100%' }} value={f.use} onChange={set('use')}>
              <option value="retail">{t('po.useRetail')}</option>
              <option value="pro">{t('po.usePro')}</option>
              <option value="both">{t('po.useBoth')}</option>
            </select>
          </label>
          <label className="field span2">
            <span>{t('po.description')}</span>
            <textarea className="input" rows={3} value={f.descr} onChange={set('descr')} />
          </label>
        </div>
        <div className="note">{editing ? t('po.editProductNote') : t('po.addProductNote')}</div>
        {editing ? (
          <div className="card" style={{ padding: '16px 20px', borderColor: 'var(--danger)' }}>
            <div className="hstack" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <span>
                <span className="bold" style={{ display: 'block' }}>{t('po.deleteProduct')}</span>
                <span className="muted" style={{ fontSize: 12 }}>{t('po.deleteProductSub')}</span>
              </span>
              {confirmDel ? (
                <span className="rowact" style={{ gap: 8 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => setConfirmDel(false)}>
                    {t('po.cancel')}
                  </button>
                  <button
                    className="btn btn-sm"
                    style={{ background: 'var(--danger)', color: '#fff' }}
                    onClick={() => void remove()}
                  >
                    {t('po.confirmDelete')}
                  </button>
                </span>
              ) : (
                <button
                  className="btn btn-subtle btn-sm"
                  style={{ color: 'var(--danger)' }}
                  onClick={() => setConfirmDel(true)}
                >
                  {t('po.deleteProduct')}
                </button>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

// ── Orders ───────────────────────────────────────────────────────
const statusKey: Record<string, string> = {
  submitted: 'sup.statusSubmitted', accepted: 'sup.statusAccepted', partial: 'sup.statusPartial',
  processing: 'sup.statusProcessing', shipped: 'sup.statusShipped',
  partdelivered: 'sup.statusPartdelivered', delivered: 'sup.statusDelivered',
  cancelled: 'sup.statusCancelled', disputed: 'sup.statusDisputed',
  draft: 'sup.statusSubmitted', approval: 'sup.statusSubmitted',
};

type DetailMode = 'details' | 'invoice' | 'creditnote';

function Orders({
  say,
  focusOrderId,
  clearFocus,
}: {
  say: (m: string) => void;
  focusOrderId?: string | null;
  clearFocus?: () => void;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<PurchaseOrder[]>([]);
  const [track, setTrack] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<{ order: PurchaseOrder; mode: DetailMode } | null>(null);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const reload = useCallback(() => {
    void pGet(PurchaseOrderListSchema, '/portal/orders').then((r) => setRows(r.orders));
  }, []);
  useEffect(reload, [reload]);

  // Opened from a notification: jump straight to that order's detail.
  useEffect(() => {
    if (!focusOrderId || !rows.length) return;
    const o = rows.find((x) => x.id === focusOrderId);
    if (o) setDetail({ order: o, mode: 'details' });
    else say(t('po.orderNotFound'));
    clearFocus?.();
  }, [focusOrderId, rows, clearFocus, say, t]);

  const move = async (id: string, to: string, opts?: { track?: string; reason?: string }) => {
    try {
      await pPost(PurchaseOrderSchema, `/portal/orders/${id}/transitions`, {
        to,
        ...(opts?.track !== undefined ? { track: opts.track } : {}),
        ...(opts?.reason !== undefined ? { reason: opts.reason } : {}),
      });
      say(
        to === 'shipped'
          ? t('po.shipped')
          : to === 'accepted'
            ? t('po.orderAccepted')
            : to === 'cancelled'
              ? t('po.orderDeclined')
              : t('po.processingStarted'),
      );
      reload();
    } catch (e) {
      say(e instanceof PortalApiError ? e.message : 'failed');
    }
  };
  // From the detail panel: run the transition, then close the drawer.
  const decideFromPanel = async (id: string, to: string, reason?: string) => {
    await move(id, to, reason !== undefined ? { reason } : undefined);
    setDetail(null);
  };

  const open = rows.filter((o) => !['delivered', 'cancelled'].includes(o.status));
  // The statuses actually present, in lifecycle order, for the filter.
  const STATUS_ORDER = [
    'submitted', 'accepted', 'partial', 'processing', 'shipped',
    'partdelivered', 'delivered', 'disputed', 'cancelled',
  ];
  const statuses = STATUS_ORDER.filter((s) => rows.some((o) => o.status === s));
  const needle = q.trim().toLowerCase();
  const needleDigits = needle.replace(/[^\d]/g, ''); // "8,460" / "MKD 8460" → "8460"
  const filtered = rows.filter((o) => {
    if (statusFilter !== 'all' && o.status !== statusFilter) return false;
    if (!needle) return true;
    const text = [o.ref, o.salonName ?? '', o.locationName ?? '', o.byName, money(o.total)]
      .some((v) => v.toLowerCase().includes(needle));
    // Match the price by digits too, so "8,460" finds a total of 8460.
    const byValue = needleDigits !== '' && String(o.total).includes(needleDigits);
    return text || byValue;
  });
  const filtering = needle !== '' || statusFilter !== 'all';

  if (!rows.length)
    return (
      <>
        <div className="toolbar">
          <div className="toolbar-context">
            <span className="k">{t('po.tabOrders')}</span>
            <span className="v">{t('po.openCount', { n: 0 })}</span>
          </div>
        </div>
        <div className="empty">
          <h3>{t('po.noOrders')}</h3>
          <p>{t('po.noOrdersSub')}</p>
        </div>
      </>
    );

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-context">
          <span className="k">{t('po.tabOrders')}</span>
          <span className="v">
            {filtering ? t('po.showingCount', { n: filtered.length }) : t('po.openCount', { n: open.length })}
          </span>
        </div>
        <div className="toolbar-actions">
          <div className="search" style={{ width: 300 }}>
            <Icon d={I.search} size={20} />
            <input
              className="input"
              placeholder={t('po.searchOrdersPh')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <select
            className="select"
            aria-label={t('po.filterByStatus')}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">{t('po.allStatuses')}</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {t(statusKey[s] ?? s)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>{t('po.order')}</th>
              <th>{t('po.salon')}</th>
              <th>{t('po.location')}</th>
              <th>{t('po.placed')}</th>
              <th className="right">{t('po.value')}</th>
              <th>{t('po.status')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((o) => (
              <tr key={o.id} className="clickable" onClick={() => setDetail({ order: o, mode: 'details' })}>
                <td>
                  <span className="bold">{o.ref}</span>
                  <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                    {t('po.linesBy', { n: o.lines.length, by: o.byName })}
                  </span>
                </td>
                <td className="muted">{o.salonName ?? '—'}</td>
                <td className="muted">{o.locationName ?? '—'}</td>
                <td className="muted tnum">{dateShort(o.createdAt.slice(0, 10))}</td>
                <td className="right bold tnum">{money(o.total)}</td>
                <td>
                  <span
                    className={`badge ${o.status === 'delivered' ? 'success' : o.status === 'disputed' ? 'danger' : 'info'}`}
                  >
                    {t(statusKey[o.status] ?? o.status)}
                  </span>
                </td>
                <td className="right" onClick={(e) => e.stopPropagation()}>
                  <span className="rowact">
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
                        <button className="btn btn-primary btn-sm" onClick={() => void move(o.id, 'shipped', { track: track[o.id] ?? '' })}>
                          {t('po.ship')}
                        </button>
                      </span>
                    ) : o.status === 'disputed' ? (
                      <button className="btn btn-secondary btn-sm" onClick={() => setDetail({ order: o, mode: 'creditnote' })}>
                        {t('po.creditNote')}
                      </button>
                    ) : ['delivered', 'shipped', 'partdelivered'].includes(o.status) ? (
                      <button className="btn btn-secondary btn-sm" onClick={() => setDetail({ order: o, mode: 'invoice' })}>
                        {t('po.invoice')}
                      </button>
                    ) : null}
                    <button className="btn btn-ghost btn-sm" onClick={() => setDetail({ order: o, mode: 'details' })}>
                      {t('po.details')}
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 ? (
          <p className="muted" style={{ padding: '20px', fontWeight: 500 }}>
            {t('po.noOrderMatch')}
          </p>
        ) : null}
      </div>
      {detail ? (
        <OrderDetail
          order={detail.order}
          mode={detail.mode}
          onClose={() => setDetail(null)}
          onDecide={decideFromPanel}
          say={say}
        />
      ) : null}
    </>
  );
}

/** The full order, from the real lines: quantities, free units,
 *  received/damaged, prices and total. Opened as an invoice view for
 *  finished orders and a credit-note view for disputed ones — the
 *  formal fiscal document itself waits for the fiscalization decision. */
function OrderDetail({
  order,
  mode,
  onClose,
  onDecide,
  say,
}: {
  order: PurchaseOrder;
  mode: DetailMode;
  onClose: () => void;
  onDecide: (id: string, to: string, reason?: string) => Promise<void>;
  say: (m: string) => void;
}) {
  const { t } = useTranslation();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const anyFree = order.lines.some((l) => l.free > 0);
  const anyDamage = order.lines.some((l) => l.dmg > 0);
  const canDecide = order.status === 'submitted';
  const title =
    mode === 'invoice' ? t('po.invoiceTitle', { ref: order.ref }) : mode === 'creditnote' ? t('po.creditNoteTitle', { ref: order.ref }) : t('po.orderDetails');

  const decline = async () => {
    if (!reason.trim()) {
      say(t('po.declineNeedsReason'));
      return;
    }
    await onDecide(order.id, 'cancelled', reason.trim());
  };

  return (
    <Panel onClose={onClose}>
      <div className="panel-head plain">
        <div>
          <h2>{order.ref}</h2>
          <p className="sub">{title}</p>
        </div>
        <div className="panel-actions">
          {canDecide ? (
            <>
              <button className="btn btn-subtle btn-sm" style={{ color: 'var(--danger)' }} onClick={() => setDeclining(true)}>
                {t('po.decline')}
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => void onDecide(order.id, 'accepted')}>
                {t('po.acceptOrder')}
              </button>
            </>
          ) : (
            <span
              className={`badge ${order.status === 'delivered' ? 'success' : order.status === 'disputed' || order.status === 'cancelled' ? 'danger' : 'info'}`}
            >
              {t(statusKey[order.status] ?? order.status)}
            </span>
          )}
          <button className="iconbtn" aria-label={t('po.cancel')} onClick={onClose}>
            <Icon d={I.x} size={20} />
          </button>
        </div>
      </div>
      <div className="panel-body">
        {declining ? (
          <div className="card" style={{ padding: '16px 20px', borderColor: 'var(--danger)' }}>
            <label className="field">
              <span>
                {t('po.declineReason')}
                <span className="req">*</span>
              </span>
              <textarea
                className="input"
                rows={2}
                autoFocus
                placeholder={t('po.declineReasonPh')}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <span className="hint">{t('po.declineReasonHint')}</span>
            </label>
            <div className="rowact" style={{ gap: 8, marginTop: 10 }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setDeclining(false);
                  setReason('');
                }}
              >
                {t('po.cancel')}
              </button>
              <button
                className="btn btn-sm"
                style={{ background: 'var(--danger)', color: '#fff' }}
                disabled={!reason.trim()}
                onClick={() => void decline()}
              >
                {t('po.confirmDecline')}
              </button>
            </div>
          </div>
        ) : null}
        {order.status === 'cancelled' && order.supplierNote ? (
          <div className="note warn">{t('po.declinedReasonShown', { reason: order.supplierNote })}</div>
        ) : null}
        <div className="card" style={{ padding: '16px 20px' }}>
          <div className="kv">
            <span className="k">{t('po.salon')}</span>
            <span className="v">{order.salonName ?? '—'}</span>
          </div>
          <div className="kv">
            <span className="k">{t('po.location')}</span>
            <span className="v">{order.locationName ?? '—'}</span>
          </div>
          <div className="kv">
            <span className="k">{t('po.placed')}</span>
            <span className="v tnum">{dateShort(order.createdAt.slice(0, 10))}</span>
          </div>
          <div className="kv">
            <span className="k">{t('po.orderedBy')}</span>
            <span className="v">{order.byName}</span>
          </div>
          <div className="kv">
            <span className="k">{t('po.tracking')}</span>
            <span className="v tnum">{order.track || t('po.noTracking')}</span>
          </div>
          {order.expected ? (
            <div className="kv">
              <span className="k">{t('po.expected')}</span>
              <span className="v tnum">{dateShort(order.expected)}</span>
            </div>
          ) : null}
        </div>

        <div className="card">
          <div className="card-header">
            <h2>{t('po.lines')}</h2>
          </div>
          <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>{t('po.product')}</th>
                <th className="right">{t('po.qty')}</th>
                {anyFree ? <th className="right">{t('po.freeUnits')}</th> : null}
                {anyDamage ? <th className="right">{t('po.damaged')}</th> : null}
                <th className="right">{t('po.unitPrice')}</th>
                <th className="right">{t('po.lineTotal')}</th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((l) => (
                <tr key={l.id}>
                  <td>
                    <span className="bold">{l.name}</span>
                    <span className="muted tnum" style={{ display: 'block', fontSize: 12 }}>
                      {l.sku}
                    </span>
                  </td>
                  <td className="right tnum">{l.qty}</td>
                  {anyFree ? <td className="right tnum">{l.free ? `+${l.free}` : '—'}</td> : null}
                  {anyDamage ? (
                    <td className="right tnum">{l.dmg ? <span className="badge danger">{l.dmg}</span> : '—'}</td>
                  ) : null}
                  <td className="right tnum">{money(l.price)}</td>
                  <td className="right bold tnum">{money(l.qty * l.price)}</td>
                </tr>
              ))}
              <tr>
                <td className="bold">{t('po.total')}</td>
                <td colSpan={1 + (anyFree ? 1 : 0) + (anyDamage ? 1 : 0)} />
                <td className="right muted" style={{ fontSize: 12 }}>
                  {anyFree ? t('po.freeAtZero') : ''}
                </td>
                <td className="right bold tnum">{money(order.total)}</td>
              </tr>
            </tbody>
          </table>
          </div>
        </div>

        <div className="note">
          {mode === 'invoice'
            ? t('po.invoiceNote')
            : mode === 'creditnote'
              ? t('po.creditNoteNote')
              : t('po.detailsNote')}
        </div>
      </div>
    </Panel>
  );
}

// ── Promotions ───────────────────────────────────────────────────
function Promotions({ user, say }: { user: PortalUser; say: (m: string) => void }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<z.infer<typeof SupplierPromotionListSchema>['promotions']>([]);
  const [products, setProducts] = useState<z.infer<typeof SupplierProductListSchema>['products']>([]);
  const [adding, setAdding] = useState(false);
  const canAdd = user.role === 'sr_owner' || user.role === 'sr_account';
  const reload = useCallback(() => {
    void pGet(SupplierPromotionListSchema, '/portal/promotions')
      .then((r) => setRows(r.promotions))
      .catch(() => setRows([]));
    void pGet(SupplierProductListSchema, '/portal/catalog').then((r) => setProducts(r.products));
  }, []);
  useEffect(reload, [reload]);
  const prodName = (id: string) => products.find((p) => p.id === id)?.name ?? '—';

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-context">
          <span className="k">{t('po.tabPromotions')}</span>
          <span className="v">{t('po.runningCount', { n: rows.length })}</span>
        </div>
        {canAdd ? (
          <div className="toolbar-actions">
            <button className="btn btn-primary btn-add" onClick={() => setAdding(true)}>
              {t('po.add')} <Icon d={I.plus} size={20} w={2.5} />
            </button>
          </div>
        ) : null}
      </div>
      <div className="card">
        {rows.map((o) => (
          <div className="rowcard" key={o.id}>
            <span className="mark on">%</span>
            <span className="grow">
              <span className="t">{o.title}</span>
              <span className="s">
                {o.productIds.map(prodName).join(', ')} · {dateShort(o.starts)} → {dateShort(o.ends)}
              </span>
              <span className="s">
                {o.audience} · {o.terms || '—'}
              </span>
            </span>
          </div>
        ))}
        {rows.length === 0 ? (
          <p className="muted" style={{ padding: '16px 20px', fontWeight: 500 }}>
            {t('po.noPromos')}
          </p>
        ) : null}
        <div className="note" style={{ margin: '16px 20px' }}>
          {t('po.promoNote')}
        </div>
      </div>
      {adding ? (
        <AddPromotionPanel
          products={products}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            reload();
            say(t('po.promoPublished'));
          }}
          say={say}
        />
      ) : null}
    </>
  );
}

function AddPromotionPanel({
  products,
  onClose,
  onSaved,
  say,
}: {
  products: z.infer<typeof SupplierProductListSchema>['products'];
  onClose: () => void;
  onSaved: () => void;
  say: (m: string) => void;
}) {
  const { t } = useTranslation();
  const [f, setF] = useState({
    title: '',
    kind: 'pct' as 'pct' | 'amt' | 'tier' | 'bxgy' | 'gift' | 'bundle' | 'training',
    min: '0',
    from: '2026-08-10',
    until: '2026-09-30',
    limit: '0',
    audience: 'All connected salons',
    terms: '',
  });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const dirty = f.title.trim() !== '' || picked.size > 0;
  const valid = f.title.trim() !== '' && picked.size > 0;

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const save = async () => {
    if (!f.title.trim()) {
      say(t('po.promoTitleFirst'));
      return;
    }
    if (!picked.size) {
      say(t('po.pickAProduct'));
      return;
    }
    try {
      await pPost(z.object({ id: z.string() }), '/portal/promotions', {
        title: f.title.trim(),
        kind: f.kind,
        productIds: [...picked],
        starts: f.from,
        ends: f.until,
        minOrder: Number(f.min) || 0,
        usageLimit: Number(f.limit) || 0,
        terms: f.terms.trim(),
        audience: f.audience,
      });
      onSaved();
    } catch (e) {
      say(e instanceof PortalApiError ? e.message : String(e));
    }
  };

  return (
    <Panel onClose={onClose}>
      <div className="panel-head plain">
        <div>
          <h2>{t('po.createPromoTitle')}</h2>
          <p className="sub">{t('po.createPromoSub')}</p>
        </div>
        <div className="panel-actions">
          <span className={`panel-status${dirty ? ' warn' : ''}`}>
            {dirty ? t('drawer.statusUnsaved') : t('drawer.statusSaved')}
          </span>
          <button className="btn btn-primary btn-sm" disabled={!valid} onClick={() => void save()}>
            {t('po.publishPromo')}
          </button>
          <button className="iconbtn" aria-label={t('po.cancel')} onClick={onClose}>
            <Icon d={I.x} size={20} />
          </button>
        </div>
      </div>
      <div className="panel-body">
        <div className="grid2">
          <label className="field span2">
            <span>
              {t('po.title')}
              <span className="req">*</span>
            </span>
            <input
              className="input"
              value={f.title}
              autoFocus
              placeholder="Buy 10, get 2 free"
              onChange={(e) => setF({ ...f, title: e.target.value })}
            />
          </label>
          <label className="field">
            <span>{t('po.type')}</span>
            <select
              className="select"
              style={{ width: '100%' }}
              value={f.kind}
              onChange={(e) => setF({ ...f, kind: e.target.value as typeof f.kind })}
            >
              <option value="pct">{t('po.kindPct')}</option>
              <option value="amt">{t('po.kindAmt')}</option>
              <option value="tier">{t('po.kindTier')}</option>
              <option value="bxgy">{t('po.kindBxgy')}</option>
              <option value="gift">{t('po.kindGift')}</option>
              <option value="bundle">{t('po.kindBundle')}</option>
              <option value="training">{t('po.kindTraining')}</option>
            </select>
          </label>
          <label className="field">
            <span>{t('po.minimumOrder')}</span>
            <input className="input" type="number" min={0} value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} />
          </label>
          <label className="field">
            <span>{t('po.starts')}</span>
            <input className="input" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
          </label>
          <label className="field">
            <span>{t('po.ends')}</span>
            <input className="input" type="date" value={f.until} onChange={(e) => setF({ ...f, until: e.target.value })} />
          </label>
          <label className="field">
            <span>{t('po.stockLimit')}</span>
            <input className="input" type="number" min={0} value={f.limit} onChange={(e) => setF({ ...f, limit: e.target.value })} />
            <span className="hint">{t('po.stockLimitHint')}</span>
          </label>
          <label className="field span2">
            <span>{t('po.audience')}</span>
            <select
              className="select"
              style={{ width: '100%' }}
              value={f.audience}
              onChange={(e) => setF({ ...f, audience: e.target.value })}
            >
              <option>{t('po.audAll')}</option>
              <option>{t('po.audMk')}</option>
              <option>{t('po.audKey')}</option>
              <option>{t('po.audNever')}</option>
            </select>
          </label>
        </div>
        <div className="field">
          <span>
            {t('po.products')}
            <span className="req">*</span>
          </span>
          {products.map((p) => (
            <button
              key={p.id}
              type="button"
              className="checkrow"
              onClick={() => toggle(p.id)}
            >
              <span className={`check ${picked.has(p.id) ? 'on' : ''}`}>
                <Icon d={I.check} size={14} w={3.5} />
              </span>
              <span style={{ fontWeight: 500 }}>
                {p.name} <span className="muted">· {money(p.buy)}</span>
              </span>
            </button>
          ))}
        </div>
        <label className="field">
          <span>{t('po.commercialTerms')}</span>
          <textarea
            className="input"
            rows={2}
            placeholder={t('po.termsPh')}
            value={f.terms}
            onChange={(e) => setF({ ...f, terms: e.target.value })}
          />
        </label>
        <div className="note">{t('po.addPromoNote')}</div>
      </div>
    </Panel>
  );
}

// ── Academy (pixel shell, honest empty) ──────────────────────────
function Academy({ say, user }: { say: (m: string) => void; user: PortalUser }) {
  const { t } = useTranslation();
  const canAdd = user.role === 'sr_owner' || user.role === 'sr_trainer';
  return (
    <>
      <div className="toolbar">
        <div className="toolbar-context">
          <span className="k">{t('po.academyTitle')}</span>
          <span className="v">{t('po.coursesCount', { n: 0 })}</span>
        </div>
        {canAdd ? (
          <div className="toolbar-actions">
            <button className="btn btn-primary btn-add" onClick={() => say(t('po.academyEngineSoon'))}>
              {t('po.add')} <Icon d={I.plus} size={20} w={2.5} />
            </button>
          </div>
        ) : null}
      </div>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>{t('po.training')}</th>
              <th>{t('po.when')}</th>
              <th>{t('po.where')}</th>
              <th>{t('po.trainer')}</th>
              <th className="right">{t('po.places')}</th>
              <th className="right">{t('po.price')}</th>
              <th>{t('po.certificate')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={8} className="muted" style={{ padding: '20px', fontWeight: 500 }}>
                {t('po.academyEmpty')}
              </td>
            </tr>
          </tbody>
        </table>
        <div className="note" style={{ margin: '16px 20px' }}>
          {t('po.academyNote')}
        </div>
      </div>
    </>
  );
}

// ── Reports (real where derivable) ───────────────────────────────
function Reports() {
  const { t } = useTranslation();
  const [d, setD] = useState<z.infer<typeof PortalReportsSchema> | null>(null);
  useEffect(() => {
    void pGet(PortalReportsSchema, '/portal/reports').then(setD);
  }, []);
  const maxVal = Math.max(...(d?.bySalon ?? []).map((s) => s.value), 1);

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-context">
          <span className="k">{t('po.reportsTitle')}</span>
          <span className="v">{t('po.last90')}</span>
        </div>
      </div>
      <div className="stacked">
        <div className="grid4">
          <Stat label={t('po.orderValue')} value={d ? money(d.orderValue) : '—'} hint={t('po.ordersN', { n: d?.orders ?? 0 })} />
          <Stat label={t('po.averageOrder')} value={d ? money(d.averageOrder) : '—'} hint={t('po.acrossSalons')} />
          <Stat
            label={t('po.repeatRate')}
            value={d ? (d.repeatRate === null ? '—' : `${d.repeatRate}%`) : '—'}
            hint={t('po.repeatRateHint')}
          />
          <Stat
            label={t('po.promotionUptake')}
            value={d ? (d.promotionUptake === null ? '—' : t('po.salonsN', { n: d.promotionUptake })) : '—'}
            hint={t('po.uptakePending')}
          />
        </div>
        <div className="card">
          <div className="card-header">
            <h2>{t('po.bySalon')}</h2>
          </div>
          <table>
            <thead>
              <tr>
                <th>{t('po.salon')}</th>
                <th className="right">{t('po.orders')}</th>
                <th className="right">{t('po.value')}</th>
                <th>{t('po.share')}</th>
              </tr>
            </thead>
            <tbody>
              {(d?.bySalon ?? []).map((s) => (
                <tr key={s.name}>
                  <td className="bold">{s.name}</td>
                  <td className="right tnum">{s.orders}</td>
                  <td className="right bold tnum">{money(s.value)}</td>
                  <td style={{ minWidth: 140 }}>
                    <div className="bar-h">
                      <span style={{ width: `${Math.round((s.value / maxVal) * 100)}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
              {d && d.bySalon.length === 0 ? (
                <tr>
                  <td className="muted" style={{ fontWeight: 500 }}>
                    {t('po.noSalesYet')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="grid2">
          <div className="card">
            <div className="card-header">
              <h2>{t('po.tabPromotions')}</h2>
            </div>
            <table>
              <tbody>
                {(d?.promotions ?? []).map((p) => (
                  <tr key={p.title}>
                    <td className="bold">{p.title}</td>
                    <td className="right muted tnum">{t('po.uptakeDash')}</td>
                  </tr>
                ))}
                {d && d.promotions.length === 0 ? (
                  <tr>
                    <td className="muted" style={{ fontWeight: 500 }}>
                      {t('po.noPromos')}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="card">
            <div className="card-header">
              <h2>{t('po.training')}</h2>
            </div>
            <p className="muted" style={{ padding: '16px 20px', fontWeight: 500 }}>
              {t('po.trainingReportPending')}
            </p>
          </div>
        </div>
        <div className="note">{t('po.reportsNote')}</div>
      </div>
    </>
  );
}

// ── Settings (real company, team and role kit) ───────────────────
function Settings({ user, say }: { user: PortalUser; say: (m: string) => void }) {
  const { t } = useTranslation();
  const [company, setCompany] = useState<z.infer<typeof PortalCompanySchema> | null>(null);
  const [members, setMembers] = useState<z.infer<typeof PortalTeamListSchema>['members']>([]);
  const [roles, setRoles] = useState<z.infer<typeof PortalRoleListSchema>['roles']>([]);
  const [usersPop, setUsersPop] = useState<string | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const [editing, setEditing] = useState<'new' | (typeof members)[number] | null>(null);
  const [roleOpen, setRoleOpen] = useState<'new' | string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('sr_account');
  const [roleScope, setRoleScope] = useState('');
  const [roleBase, setRoleBase] = useState('sr_account');
  const [snap, setSnap] = useState('');
  const isOwner = user.role === 'sr_owner';
  const memberDirty = `${name}|${email}|${role}` !== snap;

  const load = useCallback(
    () =>
      void Promise.all([
        pGet(PortalCompanySchema, '/portal/company').then(setCompany),
        pGet(PortalTeamListSchema, '/portal/team').then((r) => setMembers(r.members)),
        pGet(PortalRoleListSchema, '/portal/roles').then((r) => setRoles(r.roles)),
      ]),
    [],
  );
  useEffect(load, [load]);
  useEffect(() => {
    if (!usersPop) return;
    const onPointer = (e: PointerEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setUsersPop(null);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [usersPop]);

  const openMember = (m: 'new' | (typeof members)[number]) => {
    if (m === 'new') {
      const first = roles[0]?.id ?? 'sr_account';
      setName('');
      setEmail('');
      setRole(first);
      setSnap(`||${first}`);
    } else {
      setName(m.name);
      setEmail(m.email);
      setRole(m.role);
      setSnap(`${m.name}|${m.email}|${m.role}`);
    }
    setEditing(m);
  };
  const saveMember = async () => {
    if (!name.trim()) {
      say(t('po.namePersonFirst'));
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      say(t('po.emailIncomplete'));
      return;
    }
    try {
      if (editing === 'new') {
        await pPost(z.object({ id: z.string() }), '/portal/team', { name: name.trim(), email: email.trim(), role });
        say(t('po.teamInvited'));
      } else if (editing) {
        await pPatch(z.object({ ok: z.literal(true) }), `/portal/team/${editing.id}`, {
          name: name.trim(),
          email: email.trim(),
          role,
        });
        say(t('po.memberSaved'));
      }
      setEditing(null);
      load();
    } catch (e) {
      say(e instanceof PortalApiError ? e.message : String(e));
    }
  };
  const removeMember = async (id: string) => {
    try {
      await pDelete(z.object({ ok: z.literal(true) }), `/portal/team/${id}`);
      say(t('po.memberRemoved'));
      setEditing(null);
      load();
    } catch (e) {
      say(e instanceof PortalApiError ? e.message : String(e));
    }
  };
  const saveRole = async () => {
    if (!name.trim()) {
      say(t('po.roleNameFirst'));
      return;
    }
    try {
      await pPost(z.object({ id: z.string() }), '/portal/roles', { name: name.trim(), scope: roleScope.trim(), base: roleBase });
      say(t('po.roleCreated'));
      setRoleOpen(null);
      load();
    } catch (e) {
      say(e instanceof PortalApiError ? e.message : String(e));
    }
  };
  const patchRole = async (id: string, body: Record<string, unknown>, msg: string) => {
    try {
      await pPatch(z.object({ ok: z.literal(true) }), `/portal/roles/${id}`, body);
      say(msg);
      await load();
    } catch (e) {
      say(e instanceof PortalApiError ? e.message : String(e));
    }
  };
  const removeRole = async (id: string) => {
    try {
      await pDelete(z.object({ ok: z.literal(true) }), `/portal/roles/${id}`);
      say(t('po.roleRemoved'));
      load();
    } catch (e) {
      say(e instanceof PortalApiError ? e.message : String(e));
    }
  };

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-context">
          <span className="k">{t('po.tabSettings')}</span>
          <span className="v">{company?.name ?? user.supplierName}</span>
        </div>
        {isOwner ? (
          <div className="toolbar-actions">
            <AddPop
              items={[
                { icon: I.users, label: t('po.teamMember'), sub: t('po.teamMemberSub'), onPick: () => openMember('new') },
                {
                  icon: I.user,
                  label: t('po.roleItem'),
                  sub: t('po.roleItemSub'),
                  onPick: () => {
                    setName('');
                    setRoleScope('');
                    setRoleBase(roles[0]?.id ?? 'sr_owner');
                    setSnap('|');
                    setRoleOpen('new');
                  },
                },
              ]}
            />
          </div>
        ) : null}
      </div>
      <div className="stacked">
        <div className="card">
          <div className="card-header">
            <h2>{t('po.company')}</h2>
          </div>
          <div className="grid2" style={{ padding: 20, gap: 16 }}>
            <label className="field">
              <span>{t('po.supplierName')}</span>
              <input className="input" value={company?.name ?? ''} readOnly />
            </label>
            <label className="field">
              <span>{t('po.territory')}</span>
              <input className="input" value={company?.territory ?? ''} readOnly />
            </label>
            <label className="field">
              <span>{t('po.minimumOrder')}</span>
              <input className="input" value={company?.minOrder ?? ''} readOnly />
            </label>
            <label className="field">
              <span>{t('po.deliveryTime')}</span>
              <input className="input" value={company?.lead ?? ''} readOnly />
            </label>
            <label className="field">
              <span>{t('po.paymentTerms')}</span>
              <input className="input" value={company?.terms ?? ''} readOnly />
            </label>
            <label className="field">
              <span>{t('po.ordersInbox')}</span>
              <input className="input" value={company?.contact ?? ''} readOnly />
            </label>
          </div>
          <div className="note" style={{ margin: '0 20px 20px' }}>
            {t('po.companyNote')}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2>{t('po.roles')}</h2>
            <span className="muted" style={{ fontWeight: 500 }}>
              {t('po.rolesHint')}
            </span>
          </div>
          {roles.map((r2) => (
            <div key={r2.id} className="rowcard">
              <span className={`mark${r2.locked ? ' on' : ''}`}>
                <Icon d={r2.std ? I.user : I.users} size={20} />
              </span>
              <span className="grow">
                <span className="t">
                  {r2.name}{' '}
                  {r2.std ? (
                    <span className="badge tag-wide">{t('po.stdBadge')}</span>
                  ) : (
                    <span className="badge accent tag-wide">{t('po.customBadge')}</span>
                  )}
                  {r2.locked ? <span className="badge warning tag-wide">{t('po.lockedBadge')}</span> : null}
                </span>
                <span className="s">{r2.scope}</span>
              </span>
              <span className="pop" ref={usersPop === r2.id ? popRef : undefined}>
                <button
                  className={`badge badge-count${usersPop === r2.id ? ' on' : ''}`}
                  aria-haspopup="menu"
                  aria-expanded={usersPop === r2.id}
                  onClick={() => setUsersPop(usersPop === r2.id ? null : r2.id)}
                >
                  {r2.users} {r2.users === 1 ? t('po.userOne') : t('po.usersMany')}
                </button>
                {usersPop === r2.id ? (
                  <div className="menu menu-wide" role="menu">
                    <div className="menu-label">{r2.name}</div>
                    {r2.userNames.length ? (
                      r2.userNames.map((u) => (
                        <div key={u.email} className="menu-row" style={{ cursor: 'default' }}>
                          <span className="avatar">{initials(u.name)}</span>
                          <span className="grow">
                            <span className="mi-t">{u.name}</span>
                            <span className="mi-s">{u.email}</span>
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="menu-row" style={{ cursor: 'default' }}>
                        <span className="grow">
                          <span className="mi-t">{t('po.nobodyYet')}</span>
                        </span>
                      </div>
                    )}
                  </div>
                ) : null}
              </span>
              <span className="acts">
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setName(r2.name);
                    setRoleScope(r2.scope);
                    setSnap(`${r2.name}|${r2.scope}`);
                    setRoleOpen(r2.id);
                  }}
                >
                  {r2.locked ? t('po.view') : t('po.edit')}
                </button>
                {isOwner && !r2.locked && !r2.std && !r2.users ? (
                  <button className="btn btn-ghost btn-sm" onClick={() => void removeRole(r2.id)}>
                    {t('po.remove')}
                  </button>
                ) : null}
              </span>
            </div>
          ))}
          <p className="muted" style={{ padding: '14px 20px', fontWeight: 500, fontSize: 12 }}>
            {t('po.roleKitNote')}
          </p>
        </div>

        <div className="card">
          <div className="card-header">
            <h2>{t('po.people')}</h2>
          </div>
          <table>
            <thead>
              <tr>
                <th>{t('po.colName')}</th>
                <th>{t('po.roleLabel')}</th>
                <th>{t('po.lastActive')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className={m.status === 'invited' ? 'dim' : ''}>
                  <td>
                    <span className="bold">{m.name}</span>
                    <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                      {m.email}
                    </span>
                  </td>
                  <td>{m.roleName}</td>
                  <td className="muted tnum">{m.status === 'invited' ? t('po.inviteSent') : '—'}</td>
                  <td className="right">
                    {isOwner ? (
                      <button className="btn btn-ghost btn-sm" onClick={() => openMember(m)}>
                        {t('po.edit')}
                      </button>
                    ) : null}
                    {m.id === user.id ? <span className="badge">{t('po.you')}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing ? (
        <Panel onClose={() => setEditing(null)}>
          <div className="panel-head plain">
            <div>
              <h2>{editing === 'new' ? t('po.newUser') : editing.name}</h2>
              <p className="sub">{t('po.portalTitle')}</p>
            </div>
            <div className="panel-actions">
              <span className={`panel-status${memberDirty ? ' warn' : ''}`}>
                {memberDirty ? t('drawer.statusUnsaved') : t('drawer.statusSaved')}
              </span>
              <button className="btn btn-primary btn-sm" disabled={editing === 'new' && !memberDirty} onClick={() => void saveMember()}>
                {editing === 'new' ? t('po.sendInvite') : t('po.saveChanges')}
              </button>
              <button className="iconbtn" aria-label={t('po.cancel')} onClick={() => setEditing(null)}>
                <Icon d={I.x} size={20} />
              </button>
            </div>
          </div>
          <div className="panel-body">
            <div className="grid2">
              <label className="field">
                <span>
                  {t('po.fullName')}
                  <span className="req">*</span>
                </span>
                <input className="input" value={name} autoFocus placeholder="Sara Ilieva" onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="field">
                <span>
                  Email<span className="req">*</span>
                </span>
                <input
                  className="input"
                  type="email"
                  value={email}
                  placeholder="sara@beautypro.mk"
                  onChange={(e) => setEmail(e.target.value)}
                />
                <span className="hint">{editing === 'new' ? t('po.emailHintNew') : t('po.emailHintEdit')}</span>
              </label>
              <label className="field span2">
                <span>
                  {t('po.roleLabel')}
                  <span className="req">*</span>
                </span>
                <select className="select" style={{ width: '100%' }} value={role} onChange={(e) => setRole(e.target.value)}>
                  {roles.map((r2) => (
                    <option key={r2.id} value={r2.id}>
                      {r2.name}
                    </option>
                  ))}
                </select>
                <span className="hint">{t('po.roleSelectHint')}</span>
              </label>
            </div>
            <div className="card">
              <div className="card-header">
                <h2>{t('po.whatEachRole')}</h2>
              </div>
              {roles.map((r2) => (
                <div key={r2.id} className="rowcard">
                  <span className={`mark${role === r2.id ? ' on' : ''}`}>
                    <Icon d={I.user} size={20} />
                  </span>
                  <span className="grow">
                    <span className="t">{r2.name}</span>
                    <span className="s">{r2.scope}</span>
                  </span>
                  {role === r2.id ? <span className="badge success">{t('po.selected')}</span> : null}
                </div>
              ))}
            </div>
            <div className="note">{editing === 'new' ? t('po.inviteNote') : t('po.roleChangeNote')}</div>
            {editing !== 'new' && editing.id !== user.id && isOwner ? (
              <button className="btn btn-subtle" style={{ color: 'var(--danger)', alignSelf: 'flex-start' }} onClick={() => void removeMember(editing.id)}>
                {t('po.remove')}
              </button>
            ) : null}
          </div>
        </Panel>
      ) : null}

      {roleOpen ? (
        <Panel onClose={() => setRoleOpen(null)}>
          {(() => {
            const r2 = roleOpen === 'new' ? null : roles.find((x) => x.id === roleOpen);
            const locked = !!r2?.locked;
            const dirty = `${name}|${roleScope}` !== snap;
            const save = () => {
              if (r2) void patchRole(r2.id, { name: name.trim(), scope: roleScope.trim() }, t('po.roleUpdated'));
              else void saveRole();
              if (r2) setRoleOpen(null);
            };
            return (
              <>
                <div className="panel-head plain">
                  <div>
                    <h2>{r2 ? r2.name : t('po.createRoleTitle')}</h2>
                    <p className="sub">{r2 ? (r2.std ? t('po.stdRoleSub') : t('po.customRoleSub')) : t('po.roles')}</p>
                  </div>
                  <div className="panel-actions">
                    <span className={`panel-status${dirty && !locked ? ' warn' : ''}`}>
                      {dirty && !locked ? t('drawer.statusUnsaved') : t('drawer.statusSaved')}
                    </span>
                    <button className="btn btn-primary btn-sm" disabled={!locked && !dirty} onClick={() => (locked ? setRoleOpen(null) : save())}>
                      {locked ? t('po.close') : r2 ? t('po.saveChanges') : t('po.createRole')}
                    </button>
                    <button className="iconbtn" aria-label={t('po.cancel')} onClick={() => setRoleOpen(null)}>
                      <Icon d={I.x} size={20} />
                    </button>
                  </div>
                </div>
                <div className="panel-body">
                  <div className="grid2">
                    <label className="field span2">
                      <span>
                        {t('po.roleName')}
                        <span className="req">*</span>
                      </span>
                      <input className="input" value={name} disabled={locked} autoFocus={!r2} placeholder="Regional account manager" onChange={(e) => setName(e.target.value)} />
                    </label>
                    <label className="field span2">
                      <span>{t('po.roleDescription')}</span>
                      <input className="input" value={roleScope} disabled={locked} placeholder={t('po.roleDescPh')} onChange={(e) => setRoleScope(e.target.value)} />
                    </label>
                    {r2 ? null : (
                      <label className="field span2">
                        <span>{t('po.startFrom')}</span>
                        <select className="select" style={{ width: '100%' }} value={roleBase} onChange={(e) => setRoleBase(e.target.value)}>
                          {roles.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name}
                            </option>
                          ))}
                        </select>
                        <span className="hint">{t('po.startFromHint')}</span>
                      </label>
                    )}
                  </div>
                  {locked ? <div className="note warn">{t('po.roleFixedNote')}</div> : null}
                  {r2 ? (
                    PO_PERM_GROUPS.map(([g, list]) => (
                      <div key={g} className="field">
                        <span>{t(`po.permGroup_${g}`)}</span>
                        {list.map(([key]) => {
                          const val = r2.perms[key] ?? 'none';
                          return (
                            <div key={key} className="togglerow" style={{ alignItems: 'center' }}>
                              <span style={{ display: 'flex', flexDirection: 'column' }}>
                                <span className="l">{t(`po.perm_${key.replace('.', '_')}`)}</span>
                                <span className="h">{key}</span>
                              </span>
                              {locked || !isOwner ? (
                                <span className={`scopetag${val === 'none' ? '' : ' on'}`}>{t(`po.scope_${val}`)}</span>
                              ) : (
                                <select
                                  className="scopesel"
                                  data-on={val === 'none' ? 0 : 1}
                                  value={val}
                                  onChange={(e) => void patchRole(r2.id, { perms: { [key]: e.target.value } }, t('po.permChanged'))}
                                >
                                  {PO_SCOPES.filter(
                                    // Flat permissions have no "own salons" middle
                                    // ground — unless that is the stored value.
                                    ([o]) => !PO_FLAT.includes(key) || o !== 'own' || val === 'own',
                                  ).map(([o]) => (
                                    <option key={o} value={o}>
                                      {t(`po.scope_${o}`)}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))
                  ) : (
                    <div className="note">{t('po.roleNameFirstNote')}</div>
                  )}
                </div>
              </>
            );
          })()}
        </Panel>
      ) : null}
    </>
  );
}

// ── Shared Add pop (menu of items) ───────────────────────────────
function AddPop({ items }: { items: { icon: string; label: string; sub: string; onPick: () => void }[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);
  return (
    <div className="pop" ref={ref}>
      <button
        className={`btn btn-primary btn-add${open ? ' open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {t('po.add')} <Icon d={open ? I.left : I.plus} size={20} w={2.5} />
      </button>
      {open ? (
        <div className="menu menu-wide" role="menu">
          {items.map((it) => (
            <button
              key={it.label}
              className="menu-row"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                it.onPick();
              }}
            >
              <Icon d={it.icon} size={20} />
              <span className="grow" style={{ textAlign: 'left' }}>
                <span>{it.label}</span>
                <span className="menu-sub">{it.sub}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const supStatusTone: Record<string, string> = {
  open: 'info',
  in_progress: 'warning',
  resolved: 'success',
  closed: '',
};
function supFmt(at: string) {
  try {
    return new Date(at).toLocaleString();
  } catch {
    return at;
  }
}

/** The supplier's support desk to Revelapps HQ — same door as the
 *  salon, in the portal and over mail. */
function PortalSupport({
  say,
  focusId,
  clearFocus,
}: {
  say: (m: string) => void;
  focusId?: string | null;
  clearFocus?: () => void;
}) {
  const { t } = useTranslation();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<SupportCategory>('other');
  const [body, setBody] = useState('');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void pGet(SupportTicketListSchema, '/portal/support/tickets').then((r) => setTickets(r.tickets));
  }, []);
  useEffect(load, [load]);
  // A bell click opens the ticket it named, once the list is in.
  useEffect(() => {
    if (focusId && tickets.some((x) => x.id === focusId)) {
      setSelId(focusId);
      setComposing(false);
      clearFocus?.();
    }
  }, [focusId, tickets, clearFocus]);
  const sel = tickets.find((x) => x.id === selId) ?? null;

  const create = async () => {
    setBusy(true);
    try {
      const r = await pPost(z.object({ id: z.string() }), '/portal/support/tickets', {
        subject,
        category,
        body,
      });
      say(t('support.sent'));
      setSubject('');
      setBody('');
      setCategory('other');
      setComposing(false);
      load();
      setSelId(r.id);
    } catch (e) {
      say(e instanceof PortalApiError ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  };
  const sendReply = async () => {
    if (!sel) return;
    setBusy(true);
    try {
      await pPost(z.object({ ok: z.literal(true) }), `/portal/support/tickets/${sel.id}/reply`, {
        body: reply,
      });
      setReply('');
      say(t('support.replied'));
      load();
    } catch (e) {
      say(e instanceof PortalApiError ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 20 }}>
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="card-header">
          <h2>{t('support.title')}</h2>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              setComposing(true);
              setSelId(null);
            }}
          >
            {t('support.new')}
          </button>
        </div>
        {tickets.length === 0 ? (
          <div className="empty" style={{ padding: 24 }}>
            <p>{t('support.empty')}</p>
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {tickets.map((r) => (
              <li key={r.id}>
                <button
                  className="ticketrow"
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '12px 16px',
                    border: 'none',
                    borderTop: '1px solid var(--line)',
                    background: selId === r.id ? 'var(--wash)' : 'transparent',
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    setSelId(r.id);
                    setComposing(false);
                  }}
                >
                  <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span className="bold">{r.subject}</span>
                    <span className={`badge ${supStatusTone[r.status] ?? ''}`}>
                      {t(`support.status.${r.status}`)}
                    </span>
                  </span>
                  <span className="muted" style={{ display: 'block', fontSize: 12, marginTop: 2 }}>
                    {t(`support.cat.${r.category}`)} · {supFmt(r.updatedAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card" style={{ minHeight: 320 }}>
        {composing ? (
          <div style={{ padding: 20, display: 'grid', gap: 14 }}>
            <h2>{t('support.newTitle')}</h2>
            <label className="field">
              <span>
                {t('support.subject')}
                <span className="req">*</span>
              </span>
              <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </label>
            <label className="field">
              <span>{t('support.category')}</span>
              <select
                className="select"
                style={{ width: '100%' }}
                value={category}
                onChange={(e) => setCategory(e.target.value as SupportCategory)}
              >
                {SUPPORT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`support.cat.${c}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>
                {t('support.message')}
                <span className="req">*</span>
              </span>
              <textarea
                className="input"
                style={{ height: 140 }}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
            <p className="muted" style={{ fontWeight: 500, fontSize: 12, margin: 0 }}>
              {t('support.honestNote')}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => setComposing(false)}>
                {t('common.cancel')}
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || subject.trim().length < 3 || !body.trim()}
                onClick={() => void create()}
              >
                {t('support.send')}
              </button>
            </div>
          </div>
        ) : sel ? (
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="card-header" style={{ padding: 0 }}>
              <h2>{sel.subject}</h2>
              <span className={`badge ${supStatusTone[sel.status] ?? ''}`}>
                {t(`support.status.${sel.status}`)}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {sel.messages.map((m, i) => (
                <div
                  key={i}
                  style={{
                    alignSelf: m.authorKind === 'hq' ? 'flex-start' : 'flex-end',
                    maxWidth: '80%',
                    background: m.authorKind === 'hq' ? 'var(--wash)' : 'var(--accent-wash, #eef2ff)',
                    borderRadius: 12,
                    padding: '10px 14px',
                  }}
                >
                  <span className="muted" style={{ display: 'block', fontSize: 12, fontWeight: 600 }}>
                    {m.authorKind === 'hq' ? t('support.fromHq') : m.authorName} · {supFmt(m.at)}
                  </span>
                  <span style={{ whiteSpace: 'pre-wrap' }}>{m.body}</span>
                </div>
              ))}
            </div>
            {sel.status === 'closed' ? (
              <p className="muted" style={{ fontWeight: 500 }}>
                {t('support.closedNote')}
              </p>
            ) : (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <textarea
                  className="input"
                  style={{ height: 64, flex: 1 }}
                  placeholder={t('support.replyPlaceholder')}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                />
                <button
                  className="btn btn-primary"
                  disabled={busy || !reply.trim()}
                  onClick={() => void sendReply()}
                >
                  {t('support.reply')}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="empty" style={{ padding: 40 }}>
            <h3>{t('support.pickTitle')}</h3>
            <p>{t('support.pickSub')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
