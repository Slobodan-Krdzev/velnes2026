import { LANGS, type Lang } from '@velnes/i18n';
import type { PermKey } from '@velnes/contracts';
import { Badge, I, Icon, VelnesMark } from '@velnes/ui';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useLocations } from '../api/queries.js';
import { useOutsideClose } from '../lib/pop.js';
import { useSession } from '@velnes/client';

/** Location scope — the prototype's loc-switch: chosen once in the
 *  topbar, honoured by every screen. 'all' = every assigned location. */
const ScopeContext = createContext<{ scope: string; setScope: (s: string) => void }>({
  scope: 'all',
  setScope: () => {},
});
export const useScope = () => useContext(ScopeContext);

/** Navigation exactly as the prototype's NAV/FOOT tiles. */
const NAV: { to: string; key: string; icon: string; size: number; perm: PermKey | null }[] = [
  { to: '/', key: 'nav.flightdeck', icon: I.home, size: 28, perm: null },
  { to: '/calendar', key: 'nav.calendar', icon: I.calendar, size: 30, perm: 'appointments.view_own' },
  { to: '/till', key: 'nav.till', icon: I.register, size: 26, perm: 'pos.checkout' },
  { to: '/catalog', key: 'nav.catalog', icon: I.products, size: 30, perm: 'catalog.view' },
  { to: '/suppliers', key: 'nav.suppliers', icon: I.invoice, size: 28, perm: 'suppliers.manage' },
  { to: '/customers', key: 'nav.customers', icon: I.users, size: 30, perm: 'customers.view_assigned' },
  { to: '/marketing', key: 'nav.marketing', icon: I.mail, size: 30, perm: 'marketing.personal_offers' },
  { to: '/reports', key: 'nav.reports', icon: I.reports, size: 30, perm: 'reports.view_own' },
];
const FOOT: typeof NAV = [
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
  const { me, logout, setLang, can } = useSession();
  const navigate = useNavigate();
  const routerLoc = useLocation();
  const locations = useLocations();
  const [scope, setScope] = useState('all');
  const [scopeMenu, setScopeMenu] = useState(false);
  const [envMenu, setEnvMenu] = useState(false);
  const scopeRef = useOutsideClose(scopeMenu, () => setScopeMenu(false));
  const envRef = useOutsideClose(envMenu, () => setEnvMenu(false));
  const scopeValue = useMemo(() => ({ scope, setScope }), [scope]);

  // The prototype's per-route body modes: the register and the calendar
  // are fixed screens — #view takes the viewport height and the page
  // never scrolls. Without these classes the till's tile rows collapse.
  useEffect(() => {
    document.body.classList.toggle('till-mode', routerLoc.pathname === '/till');
    document.body.classList.toggle('cal-mode', routerLoc.pathname === '/calendar');
    return () => {
      document.body.classList.remove('till-mode', 'cal-mode');
    };
  }, [routerLoc.pathname]);
  if (!me) return null;

  const myLocs = (locations.data?.locations ?? []).filter(
    (l) => !me.locationIds.length || me.locationIds.includes(l.id),
  );
  const current = [...NAV, ...FOOT].find((n) =>
    n.to === '/' ? routerLoc.pathname === '/' : routerLoc.pathname.startsWith(n.to),
  );
  const title = current ? t(current.key) : t('app.workspace');
  const scopeWord = SCOPE_WORD[current?.to ?? ''] ?? '';
  const scopeLabel =
    scope === 'all'
      ? t('shell.allLocations')
      : (myLocs.find((l) => l.id === scope)?.name ?? '');
  const allSelected = scope === 'all';

  const tile = (n: (typeof NAV)[number]) => (
    <button
      key={n.to}
      className={`tile${(n.to === '/' ? routerLoc.pathname === '/' : routerLoc.pathname.startsWith(n.to)) ? ' active' : ''}`}
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
          <div className="applogo" title="Velnes">
            <VelnesMark size={34} />
          </div>
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
            <div className="pop" ref={envRef}>
              <button
                className="avatar"
                aria-haspopup="menu"
                aria-expanded={envMenu}
                title={me.name}
                onClick={() => setEnvMenu((v) => !v)}
              >
                {inits(me.name)}
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
                    <span className="avatar">{inits(me.name)}</span>
                    <span>
                      <span className="mi-t" style={{ fontWeight: 700 }}>
                        {me.name}
                      </span>
                      <span className="mi-s">{me.email}</span>
                    </span>
                  </div>
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
                    <span className="check">
                      <Icon d={I.arrowleft} size={14} w={2.5} />
                    </span>
                    <span className="grow">
                      <span className="mi-t">{t('shell.signOut')}</span>
                    </span>
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <main id="view">
          <ScopeContext.Provider value={scopeValue}>
            <Outlet />
          </ScopeContext.Provider>
        </main>
      </div>
    </>
  );
}
