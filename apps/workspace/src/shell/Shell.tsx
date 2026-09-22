import { useQuery } from '@tanstack/react-query';
import { PlatformNoticeListSchema } from '@velnes/contracts';
import { get } from '@velnes/client';
import { LANGS, type Lang } from '@velnes/i18n';
import type { PermKey } from '@velnes/contracts';
import { Badge, I, Icon, VelnesMark } from '@velnes/ui';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useLocations } from '../api/queries.js';
import { useOutsideClose } from '../lib/pop.js';
import { useToast } from '../lib/toast.js';
import { useSession } from '@velnes/client';
import { WA_SUPPORT, WhatsAppGlyph, WhatsAppPopup } from './WhatsAppSupport.js';
import { Assistant } from './Assistant.js';
import { SignInLinkPanel } from '../pages/settings/SignInLinkPanel.js';

/** Location scope — the prototype's loc-switch: chosen once in the
 *  topbar, honoured by every screen. 'all' = every assigned location. */
const ScopeContext = createContext<{ scope: string; setScope: (s: string) => void }>({
  scope: 'all',
  setScope: () => {},
});
export const useScope = () => useContext(ScopeContext);

/** Navigation as the prototype's NAV/FOOT tiles — minus the flightdeck
 *  tile: the top Velnes logo is the flightdeck door instead (see the
 *  clickable .applogo below). */
const NAV: { to: string; key: string; icon: string; size: number; perm: PermKey | null }[] = [
  { to: '/calendar', key: 'nav.calendar', icon: I.calendar, size: 30, perm: 'appointments.view_own' },
  { to: '/till', key: 'nav.till', icon: I.register, size: 26, perm: 'pos.checkout' },
  { to: '/catalog', key: 'nav.catalog', icon: I.products, size: 30, perm: 'catalog.view' },
  { to: '/suppliers', key: 'nav.suppliers', icon: I.invoice, size: 28, perm: 'suppliers.manage' },
  { to: '/customers', key: 'nav.customers', icon: I.users, size: 30, perm: 'customers.view_assigned' },
  { to: '/marketing', key: 'nav.marketing', icon: I.mail, size: 30, perm: 'marketing.personal_offers' },
  { to: '/reports', key: 'nav.reports', icon: I.reports, size: 30, perm: 'reports.view_own' },
];
const FOOT: typeof NAV = [
  { to: '/support', key: 'nav.support', icon: I.info, size: 26, perm: null },
  { to: '/settings', key: 'nav.settings', icon: I.gear, size: 26, perm: 'users.manage' },
];

const SCOPE_WORD: Record<string, string> = {
  '/calendar': 'Booking',
  '/till': 'POS',
  '/catalog': 'Catalog',
  '/customers': 'Customers',
  '/reports': 'Reports',
  '/settings': 'Settings',
};

const inits = (name: string) =>
  name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2);

export function Shell() {
  const { t, i18n } = useTranslation();
  const { me, logout, setLang, can, preview, exitPreview } = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const routerLoc = useLocation();
  const locations = useLocations();
  const [scope, setScope] = useState('all');
  const [scopeMenu, setScopeMenu] = useState(false);
  const [envMenu, setEnvMenu] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [waOpen, setWaOpen] = useState(false);
  // The account menu's "Employee app": my own sign-in link, any role.
  const [linkOpen, setLinkOpen] = useState(false);
  const notifRef = useOutsideClose(notifOpen, () => setNotifOpen(false));
  // Platform notices — HQ speaks, the bell listens. Seen-state is a
  // per-browser convenience, not business truth.
  const notices = useQuery({
    queryKey: ['notices'],
    queryFn: () => get(PlatformNoticeListSchema, '/notices'),
    refetchInterval: 120_000,
  });
  const latest = notices.data?.notices[0]?.createdAt ?? '';
  const seen = (() => {
    try {
      return localStorage.getItem('velnes.noticesSeen') ?? '';
    } catch {
      return '';
    }
  })();
  const unseen = !!latest && latest > seen;
  const scopeRef = useOutsideClose(scopeMenu, () => setScopeMenu(false));
  const envRef = useOutsideClose(envMenu, () => setEnvMenu(false));
  const scopeValue = useMemo(() => ({ scope, setScope }), [scope]);

  // The prototype's per-route body modes: the register and the calendar
  // are fixed screens — #view takes the viewport height and the page
  // never scrolls. Without these classes the till's tile rows collapse.
  useEffect(() => {
    document.body.classList.toggle('till-mode', routerLoc.pathname === '/till');
    document.body.classList.toggle('cal-mode', routerLoc.pathname === '/calendar');
    // The WhatsApp button lives only on Support — leaving closes its popup.
    if (!routerLoc.pathname.startsWith('/support')) setWaOpen(false);
    return () => {
      document.body.classList.remove('till-mode', 'cal-mode');
    };
  }, [routerLoc.pathname]);
  // The prototype's preview-mode: the topbar tints, the page keeps
  // room for the bar pinned to the bottom.
  useEffect(() => {
    document.body.classList.toggle('preview-mode', !!preview);
    return () => {
      document.body.classList.remove('preview-mode');
    };
  }, [preview]);
  if (!me) return null;

  const myLocs = (locations.data?.locations ?? []).filter(
    (l) => !me.locationIds.length || me.locationIds.includes(l.id),
  );
  const onDeck = routerLoc.pathname === '/';
  const current = [...NAV, ...FOOT].find((n) => routerLoc.pathname.startsWith(n.to));
  // The flightdeck has no tile now — the logo is its door — but it still
  // owns the page title when the deck is showing.
  const title = onDeck ? t('nav.flightdeck') : current ? t(current.key) : t('app.workspace');
  const scopeWord = SCOPE_WORD[current?.to ?? ''] ?? '';
  const scopeLabel =
    scope === 'all'
      ? t('shell.allLocations')
      : (myLocs.find((l) => l.id === scope)?.name ?? '');
  const allSelected = scope === 'all';

  const tile = (n: (typeof NAV)[number]) => (
    <button
      key={n.to}
      className={`tile${routerLoc.pathname.startsWith(n.to) ? ' active' : ''}`}
      title={t(n.key)}
      aria-label={t(n.key)}
      onClick={() => navigate(n.to)}
    >
      <Icon d={n.icon} size={n.size} w={1.9} />
    </button>
  );

  return (
    <>
      <aside className="sidebar">
        <div className="sidebar-group">
          <button
            className={`applogo${onDeck ? ' active' : ''}`}
            title={t('nav.flightdeck')}
            aria-label={t('nav.flightdeck')}
            aria-current={onDeck ? 'page' : undefined}
            onClick={() => navigate('/')}
          >
            <VelnesMark size={34} />
          </button>
          <nav id="nav-main" className="sidebar-group">
            {NAV.filter((n) => !n.perm || can(n.perm)).map(tile)}
          </nav>
        </div>
        <nav id="nav-foot" className="sidebar-group">
          {FOOT.filter((n) => !n.perm || can(n.perm)).map(tile)}
        </nav>
      </aside>

      <div className="shell">
        <header className="topbar">
          <div className="topbar-left">
            <h1 id="page-title">{title}</h1>
            <div id="loc-switch">
              {myLocs.length < 2 ? (
                <span
                  className="locsw"
                  style={{ borderStyle: 'dashed', color: 'var(--ink-muted)' }}
                >
                  <span className="locdot" />
                  <span className="k">{scopeWord}</span>
                  {myLocs[0]?.name ?? ''}
                </span>
              ) : (
                <div className="pop" ref={scopeRef}>
                  <button
                    className={`locsw${allSelected ? '' : ' multi'}`}
                    aria-haspopup="menu"
                    aria-expanded={scopeMenu}
                    onClick={() => setScopeMenu((v) => !v)}
                  >
                    <span className={`locdot${allSelected ? '' : ' off'}`} />
                    <span className="k">{scopeWord}</span>
                    <span>{scopeLabel}</span>
                    <Icon d={I.down} size={16} w={2.5} />
                  </button>
                  {scopeMenu ? (
                    <div className="menu menu-left menu-wide" role="menu">
                      <div className="menu-label">{t('shell.showDataFor')}</div>
                      <button
                        className="menu-row"
                        onClick={() => {
                          setScope('all');
                          setScopeMenu(false);
                        }}
                      >
                        <span className={`check${allSelected ? ' on' : ''}`}>
                          <Icon d={I.check} size={14} w={3.5} />
                        </span>
                        <span className="grow">
                          <span className="mi-t">{t('shell.allLocations')}</span>
                          <span className="mi-s">{t('shell.locations', { count: myLocs.length })}</span>
                        </span>
                      </button>
                      <div className="menu-sep" />
                      {myLocs.map((l) => (
                        <button
                          key={l.id}
                          className="menu-row"
                          onClick={() => {
                            setScope(l.id);
                            setScopeMenu(false);
                          }}
                        >
                          <span className={`check${scope === l.id ? ' on' : ''}`}>
                            <Icon d={I.check} size={14} w={3.5} />
                          </span>
                          <span className="grow">
                            <span className="mi-t">{l.name}</span>
                            <span className="mi-s">{l.city ?? ''}</span>
                          </span>
                          <Badge tone={l.lifecycle === 'ACTIVE' ? 'success' : 'warning'}>
                            {l.lifecycle === 'ACTIVE' ? t('shell.open') : t('shell.setup')}
                          </Badge>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
          <div className="topbar-mid" id="topbar-mid" />
          <div className="topbar-right">
            <button className="iconbtn" aria-label={t('common.search')}>
              <Icon d={I.search} size={24} w={2} />
            </button>
            <div className="pop" ref={notifRef}>
              <button
                className="iconbtn"
                style={{ position: 'relative' }}
                aria-label={t('shell.notices')}
                aria-haspopup="menu"
                aria-expanded={notifOpen}
                onClick={() => {
                  setNotifOpen((v) => !v);
                  if (latest) {
                    try {
                      localStorage.setItem('velnes.noticesSeen', latest);
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
                  <div className="menu-label">{t('shell.notices')}</div>
                  {(notices.data?.notices ?? []).length === 0 ? (
                    <div className="menu-label" style={{ fontWeight: 500 }}>
                      {t('shell.noNotices')}
                    </div>
                  ) : (
                    (notices.data?.notices ?? []).map((n) => (
                      <button
                        key={n.id}
                        className="menu-row"
                        onClick={() => {
                          setNotifOpen(false);
                          // A notice knows its screen: category news opens
                          // its shelf, a support reply opens its ticket.
                          if (n.kind === 'support')
                            navigate('/support', { state: { ticket: n.refId } });
                          else if (n.kind.startsWith('category'))
                            navigate('/catalog', { state: { tab: 'categories' } });
                          else if (n.kind.startsWith('booking') && n.refId)
                            navigate('/calendar', { state: { appointment: n.refId } });
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
                title={me.name}
                onClick={() => setEnvMenu((v) => !v)}
              >
                {me.avatar ? (
                  <img src={me.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
                ) : (
                  inits(me.name)
                )}
              </button>
              {envMenu ? (
                <div className="menu menu-wide menu-scroll" role="menu">
                  <div className="menu-label">{t('shell.signedIn')}</div>
                  <div
                    style={{
                      padding: '4px 12px 10px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                    }}
                  >
                    <span className="avatar">
                      {me.avatar ? (
                        <img src={me.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
                      ) : (
                        inits(me.name)
                      )}
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column' }}>
                      <span className="mi-t" style={{ fontWeight: 700 }}>
                        {me.name}
                      </span>
                      <span className="mi-s" style={{ display: 'block' }}>
                        {me.email}
                      </span>
                    </span>
                  </div>
                  <button
                    className="menu-row"
                    onClick={() => {
                      setLinkOpen(true);
                      setEnvMenu(false);
                    }}
                  >
                    {t('shell.employeeApp')}
                  </button>
                  {can('users.manage') ? (
                    <button
                      className="menu-row"
                      onClick={() => {
                        navigate('/settings', { state: { tab: 'team', profile: me.id } });
                        setEnvMenu(false);
                      }}
                    >
                      {t('shell.settings')}
                    </button>
                  ) : null}
                  <div className="menu-sep" />
                  <div className="menu-label">{t('shell.language')}</div>
                  {LANGS.map((l) => (
                    <button
                      key={l}
                      className="menu-row"
                      aria-label={t(`lang.${l}`)}
                      onClick={() => {
                        void setLang(l as Lang);
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
                  <button
                    className="menu-row"
                    onClick={() => {
                      void logout().then(() => navigate('/login'));
                    }}
                  >
                    {t('shell.signOut')}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        {linkOpen ? <SignInLinkPanel employee={{ id: me.id, name: me.name }} self onClose={() => setLinkOpen(false)} /> : null}
        <main id="view">
          <ScopeContext.Provider value={scopeValue}>
            <Outlet />
          </ScopeContext.Provider>
        </main>
      </div>

      {WA_SUPPORT && routerLoc.pathname.startsWith('/support') ? (
        <button
          aria-label={t('support.waButton')}
          aria-expanded={waOpen}
          onClick={() => setWaOpen((v) => !v)}
          style={{
            position: 'fixed', left: 'calc(var(--sidebar) + 20px)', bottom: 20, zIndex: 55,
            display: 'flex', alignItems: 'center', gap: 10, padding: '7px 16px 7px 7px',
            background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-control)',
            boxShadow: '0 14px 34px -12px rgba(0,0,0,.38), 0 2px 6px rgba(0,0,0,.08)', cursor: 'pointer',
          }}
        >
          <span style={{ display: 'grid', placeItems: 'center', width: 36, height: 36, borderRadius: 999, background: '#25D366', color: '#fff', flex: 'none' }}>
            <WhatsAppGlyph size={22} />
          </span>
          <span style={{ fontWeight: 700 }}>{t('support.waButton')}</span>
          <span className="muted" style={{ transform: waOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s', fontSize: 18 }}>›</span>
        </button>
      ) : null}
      <WhatsAppPopup
        open={waOpen && routerLoc.pathname.startsWith('/support')}
        onClose={() => setWaOpen(false)}
      />

      <Assistant />

      {preview ? (
        <div className="supportbar previewbar" id="previewbar">
          <Icon d={I.user} size={20} />
          <span>
            {t('preview.previewingAs')} <span className="who">{me.name}</span> —{' '}
            {me.roleName ?? t(`eset.access_${me.access}`)}
          </span>
          <span className="sep">|</span>
          <span>
            {me.locationIds.length === (locations.data?.locations.length ?? 0)
              ? t('shell.allLocations')
              : me.locationIds
                  .map((id) => locations.data?.locations.find((l) => l.id === id)?.name ?? '')
                  .filter(Boolean)
                  .join(', ')}
          </span>
          <span className="grow" />
          <span>{t('preview.exactly')}</span>
          <button
            className="btn btn-secondary"
            onClick={() => {
              void exitPreview().then(() => {
                navigate('/settings', { state: { tab: 'team' } });
                toast(t('preview.back'));
              });
            }}
          >
            {t('preview.exit')}
          </button>
        </div>
      ) : null}
    </>
  );
}
