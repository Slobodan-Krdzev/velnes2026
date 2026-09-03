import type {
  HqMeResponseSchema} from '@velnes/contracts';
import {
  HqApproveResponseSchema,
  HqAuditListSchema,
  HqBusinessListSchema,
  HqCategoryListSchema,
  HqCategoryRequestListSchema,
  HqLocationQueueSchema,
  HqLocationReviewSchema,
  RegistrationStatusSchema,
  HqRegistrationListSchema,
} from '@velnes/contracts';
import type { Lang } from '@velnes/i18n';
import { I, Icon, VelnesMark } from '@velnes/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { PlatformNoticeListSchema } from '@velnes/contracts';
import { HqApiError, hqDelete, hqGet, hqPatch, hqPost } from './api.js';

/** The prototype's viewHQ: the customers pane is the intake table —
 *  new locations, new registrations, then every business on the
 *  platform. Suppliers and HQ team wait for their phases, honestly. */

type HqUser = z.infer<typeof HqMeResponseSchema>;
type Tab = 'customers' | 'categories' | 'suppliers' | 'team' | 'search' | 'audit';
const DecisionResp = z.object({ id: z.uuid(), lifecycle: z.string() });
const RegDecisionResp = z.object({ id: z.uuid(), status: RegistrationStatusSchema });

export function Hq({
  user,
  setLang,
  signOut,
}: {
  user: HqUser;
  setLang: (l: Lang) => void;
  signOut: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<Tab>('customers');
  const [toast, setToast] = useState<string | null>(null);
  const [envMenu, setEnvMenu] = useState(false);
  const envRef = useRef<HTMLDivElement | null>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement | null>(null);
  const [notices, setNotices] = useState<z.infer<typeof PlatformNoticeListSchema>['notices']>([]);
  useEffect(() => {
    const loadNotices = () =>
      void hqGet(PlatformNoticeListSchema, '/hq/notices')
        .then((r2) => setNotices(r2.notices))
        .catch(() => undefined);
    loadNotices();
    const iv = setInterval(loadNotices, 120_000);
    return () => clearInterval(iv);
  }, []);
  const latestNotice = notices[0]?.createdAt ?? '';
  const seenNotice = (() => {
    try {
      return localStorage.getItem('velnes.hq.noticesSeen') ?? '';
    } catch {
      return '';
    }
  })();
  const unseenNotice = !!latestNotice && latestNotice > seenNotice;
  useEffect(() => {
    if (!notifOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [notifOpen]);
  const say = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  // The prototype's env-hq mode: same chrome, the title says where
  // you are.
  useEffect(() => {
    document.body.classList.add('env-hq');
    return () => document.body.classList.remove('env-hq');
  }, []);
  useEffect(() => {
    if (!envMenu) return;
    const onPointer = (e: PointerEvent) => {
      if (envRef.current && !envRef.current.contains(e.target as Node)) setEnvMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEnvMenu(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [envMenu]);

  // The prototype's HQ_NAV, verbatim — plus the Categories shelfkeeper.
  const nav: { tab: Tab; label: string; icon: string; size: number }[] = [
    { tab: 'customers', label: t('hq.tabCustomers'), icon: I.users, size: 28 },
    { tab: 'categories', label: t('hq.tabCategories'), icon: I.tag, size: 26 },
    { tab: 'suppliers', label: t('hq.tabSuppliers'), icon: I.products, size: 28 },
    { tab: 'team', label: t('hq.tabTeam'), icon: I.user, size: 26 },
    { tab: 'search', label: t('hq.tabSearch'), icon: I.pulse, size: 26 },
    { tab: 'audit', label: t('hq.tabAudit'), icon: I.note, size: 26 },
  ];
  const inits = (n: string) =>
    n
      .split(' ')
      .map((p2) => p2[0])
      .join('')
      .slice(0, 2);
  const workspaceUrl = import.meta.env.VITE_WORKSPACE_URL ?? 'http://localhost:5173';

  return (
    <>
      <aside className="sidebar">
        <div className="sidebar-group">
          <div className="applogo" title="Revelapps HQ">
            <VelnesMark size={34} />
          </div>
          <nav id="nav-main" className="sidebar-group">
            {nav.map((n) => (
              <button
                key={n.tab}
                className={`tile${tab === n.tab ? ' active' : ''}`}
                title={n.label}
                aria-label={n.label}
                onClick={() => setTab(n.tab)}
              >
                <Icon d={n.icon} size={n.size} w={1.9} />
              </button>
            ))}
          </nav>
        </div>
        <nav id="nav-foot" className="sidebar-group">
          <button
            className="tile"
            title={t('hq.backToSalon')}
            aria-label={t('hq.backToSalon')}
            onClick={() => window.location.assign(workspaceUrl)}
          >
            <Icon d={I.arrowleft} size={24} w={1.9} />
          </button>
        </nav>
      </aside>

      <div className="shell">
        <header className="topbar">
          <div className="topbar-left">
            <h1 id="page-title">Revelapps HQ</h1>
          </div>
          <div className="topbar-mid" id="topbar-mid" />
          <div className="topbar-right">
            <div className="pop" ref={notifRef}>
              <button
                className="iconbtn"
                style={{ position: 'relative' }}
                aria-label={t('shell.notices')}
                aria-haspopup="menu"
                aria-expanded={notifOpen}
                onClick={() => {
                  setNotifOpen((v) => !v);
                  if (latestNotice) {
                    try {
                      localStorage.setItem('velnes.hq.noticesSeen', latestNotice);
                    } catch {
                      /* private mode — the dot just stays */
                    }
                  }
                }}
              >
                <Icon d={I.bell} size={24} w={2} />
                {unseenNotice ? <span className="dot" /> : null}
              </button>
              {notifOpen ? (
                <div className="menu menu-wide menu-scroll" role="menu">
                  <div className="menu-label">{t('shell.notices')}</div>
                  {notices.length === 0 ? (
                    <div className="menu-label" style={{ fontWeight: 500 }}>
                      {t('shell.noNotices')}
                    </div>
                  ) : (
                    notices.map((n) => (
                      <button
                        key={n.id}
                        className="menu-row"
                        onClick={() => {
                          setNotifOpen(false);
                          // A notice knows its screen: category talk
                          // lands on the Categories tab.
                          if (n.kind.startsWith('category')) setTab('categories');
                        }}
                      >
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
            <div className="pop" ref={envRef}>
              <button
                className="avatar"
                aria-haspopup="menu"
                aria-expanded={envMenu}
                title={user.name}
                onClick={() => setEnvMenu((v) => !v)}
              >
                {inits(user.name)}
              </button>
              {envMenu ? (
                <div className="menu menu-wide menu-scroll" role="menu">
                  <div className="menu-label">{t('shell.signedIn')}</div>
                  <div style={{ padding: '4px 12px 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="avatar">{inits(user.name)}</span>
                    <span>
                      <span className="mi-t" style={{ fontWeight: 700 }}>
                        {user.name}
                      </span>
                      <span className="mi-s">Revelapps HQ · {user.role}</span>
                    </span>
                  </div>
                  <div className="menu-sep" />
                  <div className="menu-label">{t('shell.language')}</div>
                  {(['en', 'mk', 'sq'] as const).map((l) => (
                    <button
                      key={l}
                      className="menu-row"
                      aria-label={t(`lang.${l}`)}
                      onClick={() => {
                        setLang(l);
                        setEnvMenu(false);
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
                      <span className="mi-t">{t('hq.signOut')}</span>
                    </span>
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <main id="view">
          {tab === 'customers' ? <Customers say={say} /> : null}
          {tab === 'categories' ? <Categories say={say} /> : null}
          {tab === 'suppliers' ? (
            <div className="empty">
              <h3>{t('hq.comingSoon')}</h3>
              <p>{t('hq.suppliersSoon')}</p>
            </div>
          ) : null}
          {tab === 'team' ? (
            <div className="empty">
              <h3>{t('hq.comingSoon')}</h3>
              <p>{t('hq.teamSoon')}</p>
            </div>
          ) : null}
          {tab === 'search' ? (
            <div className="empty">
              <h3>{t('hq.comingSoon')}</h3>
              <p>{t('hq.searchSoon')}</p>
            </div>
          ) : null}
          {tab === 'audit' ? <PlatformLog /> : null}
        </main>
      </div>
      {toast ? <div className="toast show">{toast}</div> : null}
    </>
  );
}

/** The Velnes taxonomy: the platform category shelves every salon
 *  picks from. Create and rename; renames follow every salon's items
 *  automatically because items reference the id, not the name. */
function Categories({ say }: { say: (m: string) => void }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<z.infer<typeof HqCategoryListSchema>['categories']>([]);
  const [name, setName] = useState('');
  const [type, setType] = useState<'services' | 'products'>('services');
  const [renaming, setRenaming] = useState<{ id: string; type: string; name: string } | null>(null);
  const [requests, setRequests] = useState<z.infer<typeof HqCategoryRequestListSchema>['requests']>([]);
  const [declining, setDeclining] = useState<{ id: string; reason: string } | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(
    () =>
      void Promise.all([
        hqGet(HqCategoryListSchema, '/hq/categories').then((r) => setRows(r.categories)),
        hqGet(HqCategoryRequestListSchema, '/hq/categories/requests').then((r) =>
          setRequests(r.requests),
        ),
      ]),
    [],
  );
  useEffect(load, [load]);
  const pending = requests.filter((r) => r.status === 'pending');

  const decide = async (id: string, action: 'approve' | 'decline', reason?: string) => {
    try {
      await hqPost(
        z.object({ ok: z.literal(true) }),
        `/hq/categories/requests/${id}/${action}`,
        action === 'decline' ? { reason } : undefined,
      );
      say(action === 'approve' ? t('hq.requestApproved') : t('hq.requestDeclined'));
      setDeclining(null);
      load();
    } catch (e) {
      say(e instanceof HqApiError ? e.message : String(e));
    }
  };
  const removeCategory = async (r: { id: string; type: string }) => {
    try {
      await hqDelete(z.object({ ok: z.literal(true) }), `/hq/categories/${r.type}/${r.id}`);
      say(t('hq.categoryRemoved'));
      load();
    } catch (e) {
      say(e instanceof HqApiError ? e.message : String(e));
    }
  };

  const add = async () => {
    try {
      await hqPost(z.object({ id: z.string() }), '/hq/categories', { name: name.trim(), type });
      setName('');
      setAdding(false);
      say(t('hq.categoryAdded'));
      load();
    } catch (e) {
      say(e instanceof HqApiError ? e.message : String(e));
    }
  };
  const rename = async () => {
    if (!renaming) return;
    try {
      await hqPatch(
        z.object({ ok: z.literal(true) }),
        `/hq/categories/${renaming.type}/${renaming.id}`,
        { name: renaming.name.trim() },
      );
      setRenaming(null);
      say(t('hq.categoryRenamed'));
      load();
    } catch (e) {
      say(e instanceof HqApiError ? e.message : String(e));
    }
  };

  const pane = (kind: 'services' | 'products') => (
    <div className="card">
      <div className="card-header">
        <h2>{kind === 'services' ? t('hq.svcCategories') : t('hq.prodCategories')}</h2>
      </div>
      <table>
        <tbody>
          {rows
            .filter((r) => r.type === kind)
            .map((r) => (
              <tr key={r.id}>
                <td className="bold">
                  {renaming?.id === r.id ? (
                    <input
                      className="input"
                      value={renaming.name}
                      aria-label={t('hq.renameCategory')}
                      onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                    />
                  ) : (
                    r.name
                  )}
                </td>
                <td className="right">
                  {renaming?.id === r.id ? (
                    <>
                      <button className="btn btn-primary btn-sm" onClick={() => void rename()}>
                        {t('hq.save')}
                      </button>{' '}
                      <button className="btn btn-subtle btn-sm" onClick={() => setRenaming(null)}>
                        {t('hq.cancel')}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setRenaming({ id: r.id, type: r.type, name: r.name })}
                      >
                        {t('hq.rename')}
                      </button>{' '}
                      <button
                        className="btn btn-subtle btn-sm"
                        onClick={() => void removeCategory(r)}
                      >
                        {t('hq.remove')}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {pending.length ? (
        <div className="card">
          <div className="card-header">
            <h2>
              {t('hq.categoryRequests')} <span className="badge warning">{pending.length}</span>
            </h2>
            <span className="muted" style={{ fontWeight: 500 }}>
              {t('hq.categoryRequestsSub')}
            </span>
          </div>
          <table>
            <tbody>
              {pending.map((r) => (
                <tr key={r.id}>
                  <td className="bold">{r.name}</td>
                  <td className="muted">
                    {r.type === 'services' ? t('hq.forServices') : t('hq.forProducts')}
                  </td>
                  <td className="muted">{r.tenantName}</td>
                  <td className="muted" style={{ maxWidth: 280 }}>
                    {r.note || '—'}
                  </td>
                  <td className="right" style={{ whiteSpace: 'nowrap' }}>
                    {declining?.id === r.id ? (
                      <span style={{ display: 'inline-flex', gap: 6 }}>
                        <input
                          className="input"
                          style={{ height: 34, width: 200 }}
                          placeholder={t('hq.declineReasonPh')}
                          value={declining.reason}
                          aria-label={t('hq.declineReasonPh')}
                          onChange={(e) => setDeclining({ id: r.id, reason: e.target.value })}
                        />
                        <button
                          className="btn btn-primary btn-sm"
                          disabled={!declining.reason.trim()}
                          onClick={() => void decide(r.id, 'decline', declining.reason.trim())}
                        >
                          {t('hq.decline')}
                        </button>
                        <button className="btn btn-subtle btn-sm" onClick={() => setDeclining(null)}>
                          {t('hq.cancel')}
                        </button>
                      </span>
                    ) : (
                      <>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => void decide(r.id, 'approve')}
                        >
                          {t('hq.approve')}
                        </button>{' '}
                        <button
                          className="btn btn-subtle btn-sm"
                          onClick={() => setDeclining({ id: r.id, reason: '' })}
                        >
                          {t('hq.decline')}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="card">
        <div className="card-header">
          <h2>{t('hq.tabCategories')}</h2>
          <button className="btn btn-primary btn-add" onClick={() => setAdding(true)}>
            {t('hq.addCategory')} <Icon d={I.plus} size={18} w={2.5} />
          </button>
        </div>
        <div className="note" style={{ margin: '16px 20px' }}>
          {t('hq.categoriesSub')}. {t('hq.categoriesNote')}
        </div>
      </div>
      <div className="grid2" style={{ gap: 24, alignItems: 'start' }}>
        {pane('services')}
        {pane('products')}
      </div>
      {adding ? (
        <div className="overlay" onClick={() => setAdding(false)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            style={{ maxWidth: 420 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h2>{t('hq.addCategory')}</h2>
            </div>
            <div className="modal-body" style={{ display: 'grid', gap: 14 }}>
              <label className="field">
                <span>{t('hq.categoryName')}</span>
                <input
                  className="input"
                  placeholder={t('hq.categoryNamePh')}
                  value={name}
                  autoFocus
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && name.trim()) void add();
                  }}
                />
              </label>
              <label className="field">
                <span>{t('hq.itemType')}</span>
                <select
                  className="select"
                  style={{ width: '100%' }}
                  value={type}
                  onChange={(e) => setType(e.target.value as 'services' | 'products')}
                >
                  <option value="services">{t('hq.forServices')}</option>
                  <option value="products">{t('hq.forProducts')}</option>
                </select>
              </label>
            </div>
            <div className="modal-foot">
              <button className="btn btn-secondary" onClick={() => setAdding(false)}>
                {t('hq.cancel')}
              </button>
              <button className="btn btn-primary" disabled={!name.trim()} onClick={() => void add()}>
                {t('hq.addCategory')}
              </button>
            </div>
            <button className="modal-close" aria-label={t('hq.cancel')} onClick={() => setAdding(false)}>
              <Icon d={I.x} size={20} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Customers({ say }: { say: (m: string) => void }) {
  const { t } = useTranslation();
  const [openLoc, setOpenLoc] = useState<string | null>(null);
  const [regs, setRegs] = useState<z.infer<typeof HqRegistrationListSchema> | null>(null);
  const [queue, setQueue] = useState<z.infer<typeof HqLocationQueueSchema> | null>(null);
  const [biz, setBiz] = useState<z.infer<typeof HqBusinessListSchema> | null>(null);
  const [regReq, setRegReq] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const reload = useCallback(() => {
    void hqGet(HqRegistrationListSchema, '/hq/registrations').then(setRegs);
    void hqGet(HqLocationQueueSchema, '/hq/locations').then(setQueue);
    void hqGet(HqBusinessListSchema, '/hq/businesses').then(setBiz);
  }, []);
  useEffect(reload, [reload]);

  if (openLoc)
    return (
      <LocReview
        id={openLoc}
        back={() => {
          setOpenLoc(null);
          reload();
        }}
        say={say}
      />
    );

  const pend = (regs?.registrations ?? []).filter(
    (r) => r.status === 'pending_review' || r.status === 'resubmitted',
  );
  const nlq = queue?.locations ?? [];

  const decide = async (id: string, what: 'approve' | 'decline' | 'request_changes') => {
    try {
      if (what === 'approve') {
        const r = await hqPost(HqApproveResponseSchema, `/hq/registrations/${id}/approve`);
        say(t('hq.activated', { name: r.ownerEmail }));
      } else if (what === 'decline') {
        await hqPost(RegDecisionResp, `/hq/registrations/${id}/decline`);
        say(t('hq.declined'));
      } else {
        if (!reason.trim()) {
          say(t('hq.reasonNeeded'));
          return;
        }
        await hqPost(RegDecisionResp, `/hq/registrations/${id}/request-changes`, { reason });
        say(t('hq.sentBack'));
        setRegReq(null);
        setReason('');
      }
      reload();
    } catch (e) {
      say(e instanceof HqApiError ? e.message : 'failed');
    }
  };

  return (
    <div className="stacked">
      {nlq.length ? (
        <div className="card">
          <div className="card-header">
            <h2>{t('hq.newLocations')}</h2>
            <span className="badge warning">{t('hq.awaiting', { n: nlq.length })}</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>{t('hq.location')}</th>
                <th>{t('hq.business')}</th>
                <th>{t('hq.city')}</th>
                <th>{t('hq.legalEntity')}</th>
                <th>{t('hq.state')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {nlq.map((l) => (
                <tr key={l.id}>
                  <td className="bold">{l.name}</td>
                  <td className="muted">{l.businessName}</td>
                  <td className="muted">{l.city ?? '—'}</td>
                  <td className="muted">
                    {l.legalName ?? '—'}{' '}
                    {l.legalStatus === 'pending' ? (
                      <span className="badge warning">{t('hq.newCompound')}</span>
                    ) : null}
                  </td>
                  <td>
                    <span className="badge warning">{l.lifecycle}</span>
                  </td>
                  <td className="right">
                    <button className="btn btn-secondary btn-sm" onClick={() => setOpenLoc(l.id)}>
                      {t('hq.review')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {pend.length ? (
        <div className="card">
          <div className="card-header">
            <h2>{t('hq.newRegistrations')}</h2>
            <span className="badge warning">{t('hq.awaiting', { n: pend.length })}</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>{t('hq.salon')}</th>
                <th>{t('hq.owner')}</th>
                <th>{t('hq.city')}</th>
                <th>{t('hq.legalEntity')}</th>
                <th>{t('hq.emailCheck')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pend.map((rw) => (
                <>
                  <tr key={rw.id}>
                    <td className="bold">
                      {rw.salonName}
                      <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                        {rw.salonType}
                      </span>
                    </td>
                    <td className="muted">
                      {rw.ownerName}
                      <span style={{ display: 'block', fontSize: 12 }}>{rw.ownerEmail}</span>
                    </td>
                    <td className="muted">{rw.city}</td>
                    <td className="muted">
                      {rw.legalName}
                      <span className="tnum" style={{ display: 'block', fontSize: 12 }}>
                        {rw.taxId}
                      </span>
                    </td>
                    <td>
                      {rw.emailVerifiedAt ? (
                        <span className="badge success">{t('hq.verified')}</span>
                      ) : (
                        <span className="badge">{t('hq.awaitingSmtp')}</span>
                      )}
                    </td>
                    <td className="right">
                      <span className="rowact">
                        <button className="btn btn-ghost btn-sm" onClick={() => void decide(rw.id, 'approve')}>
                          {t('hq.verifyActivate')}
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => setRegReq(regReq === rw.id ? null : rw.id)}
                        >
                          {t('hq.requestChanges')}
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--danger)' }}
                          onClick={() => void decide(rw.id, 'decline')}
                        >
                          {t('hq.decline')}
                        </button>
                      </span>
                    </td>
                  </tr>
                  {regReq === rw.id ? (
                    <tr key={`${rw.id}-reason`}>
                      <td colSpan={6}>
                        <div className="hstack" style={{ gap: 10 }}>
                          <input
                            className="input"
                            placeholder={t('hq.reasonPh')}
                            style={{ flex: 1 }}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                          />
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => void decide(rw.id, 'request_changes')}
                          >
                            {t('hq.sendBack')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {!nlq.length && !pend.length && regs && queue ? (
        <div className="note">{t('hq.noQueue')}</div>
      ) : null}

      <div className="card">
        <div className="card-header">
          <h2>{t('hq.businesses')}</h2>
          <span className="muted" style={{ fontWeight: 500 }}>
            {t('hq.accounts', { n: biz?.businesses.length ?? 0 })}
          </span>
        </div>
        <table>
          <thead>
            <tr>
              <th>{t('hq.business')}</th>
              <th>{t('hq.owner')}</th>
              <th>{t('hq.locationsCol')}</th>
              <th>{t('hq.teamCol')}</th>
              <th>{t('hq.bookingLinkCol')}</th>
            </tr>
          </thead>
          <tbody>
            {(biz?.businesses ?? []).map((b) => (
              <tr key={b.id}>
                <td className="bold">{b.name}</td>
                <td>
                  {b.ownerName ?? '—'}
                  <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                    {b.ownerEmail ?? ''}
                  </span>
                </td>
                <td className="tnum">
                  {b.locations}{' '}
                  {b.liveLocations ? (
                    <span className="badge success">{b.liveLocations} {t('hq.live')}</span>
                  ) : null}
                </td>
                <td className="tnum">{b.employees}</td>
                <td className="muted">{b.slug ? `velnes.mk/book/${b.slug}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LocReview({ id, back, say }: { id: string; back: () => void; say: (m: string) => void }) {
  const { t } = useTranslation();
  const [l, setL] = useState<z.infer<typeof HqLocationReviewSchema> | null>(null);
  const [reason, setReason] = useState('');
  useEffect(() => {
    void hqGet(HqLocationReviewSchema, `/hq/locations/${id}`).then(setL).catch(() => setL(null));
  }, [id]);
  if (!l) return <p className="muted">{t('hq.notFound')}</p>;

  const decide = async (action: 'approve' | 'request_changes') => {
    try {
      await hqPost(DecisionResp, `/hq/locations/${id}/decision`, {
        action,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      say(action === 'approve' ? t('hq.approvedToast') : t('hq.sentBack'));
      back();
    } catch (e) {
      say(e instanceof HqApiError ? e.message : 'failed');
    }
  };

  return (
    <div className="stacked">
      <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={back}>
        ← {t('hq.allNewLocations')}
      </button>
      <div className="card" style={{ padding: 20 }}>
        <div className="hstack" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>{l.name}</h2>
          <span className="badge warning">{l.lifecycle}</span>
        </div>
        <div className="kv">
          <span className="k">{t('hq.business')}</span>
          <span className="v">
            {l.businessName} <span className="badge success">{t('hq.verified').toLowerCase()}</span>
          </span>
        </div>
        <div className="kv">
          <span className="k">{t('hq.address')}</span>
          <span className="v">
            {l.address ?? '—'}, {l.city ?? '—'}
          </span>
        </div>
        <div className="kv">
          <span className="k">{t('hq.contact')}</span>
          <span className="v">
            {l.phone ?? '—'} · {l.tz}
          </span>
        </div>
        <div className="kv">
          <span className="k">{t('hq.invoicePrefix')}</span>
          <span className="v tnum">{l.invPrefix}</span>
        </div>
        <div className="kv">
          <span className="k">{t('hq.legalEntity')}</span>
          <span className="v">
            {l.legal ? (
              <>
                {l.legal.name} · {l.legal.taxId}{' '}
                <span className={`badge ${l.legal.status === 'verified' ? 'success' : 'warning'}`}>
                  {l.legal.status}
                </span>
              </>
            ) : (
              <span className="badge danger">{t('hq.noneAttached')}</span>
            )}
          </span>
        </div>
        {l.paymentAccount ? (
          <div className="kv">
            <span className="k">{t('hq.paymentAccount')}</span>
            <span className="v">
              {l.paymentAccount.provider}{' '}
              <span className={`badge ${l.paymentAccount.status === 'active' ? 'success' : 'warning'}`}>
                {l.paymentAccount.status}
              </span>
            </span>
          </div>
        ) : null}
        {l.compound ? (
          <div className="note warn" style={{ marginTop: 10 }}>
            {t('hq.compoundNote')}
          </div>
        ) : null}
        {l.log.length ? (
          <div className="note" style={{ marginTop: 10 }}>
            {l.log.map((e, i) => (
              <span key={i} style={{ display: 'block' }}>
                {e.from} → {e.to}
                {e.reason ? ` — ${e.reason}` : ''}
              </span>
            ))}
          </div>
        ) : null}
        <div className="field" style={{ marginTop: 14 }}>
          <label>{t('hq.reasonLabel')}</label>
          <input
            className="input"
            placeholder={t('hq.reasonPh2')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <div className="hstack" style={{ gap: 10, marginTop: 12 }}>
          <button className="btn btn-primary" onClick={() => void decide('approve')}>
            {l.compound ? t('hq.approveCompound') : t('hq.approve')}
          </button>
          <button className="btn btn-secondary" onClick={() => void decide('request_changes')}>
            {t('hq.requestChanges')}
          </button>
        </div>
        <div className="note" style={{ marginTop: 10 }}>
          {t('hq.approveNote')}
        </div>
      </div>
    </div>
  );
}

function PlatformLog() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<z.infer<typeof HqAuditListSchema> | null>(null);
  useEffect(() => {
    void hqGet(HqAuditListSchema, '/hq/audit?limit=80').then(setRows);
  }, []);
  return (
    <div className="card">
      <div className="card-header">
        <h2>{t('hq.tabAudit')}</h2>
      </div>
      <table>
        <thead>
          <tr>
            <th>{t('hq.when')}</th>
            <th>{t('hq.tenant')}</th>
            <th>{t('hq.who')}</th>
            <th>{t('hq.action')}</th>
            <th>{t('hq.what')}</th>
            <th>{t('hq.change')}</th>
          </tr>
        </thead>
        <tbody>
          {(rows?.entries ?? []).map((e) => (
            <tr key={e.id}>
              <td className="muted tnum" style={{ whiteSpace: 'nowrap' }}>
                {e.ts.slice(0, 16).replace('T', ' ')}
              </td>
              <td className="muted">{e.tenantName}</td>
              <td>{e.actorName}</td>
              <td className="bold">{e.action}</td>
              <td className="muted">{e.object}</td>
              <td className="muted">
                {e.before !== '—' || e.after !== '—' ? `${e.before} → ${e.after}` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
