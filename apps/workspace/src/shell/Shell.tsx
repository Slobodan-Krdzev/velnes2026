import { LANGS, type Lang } from '@velnes/i18n';
import type { PermKey } from '@velnes/contracts';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useSession } from '../session.js';
import './shell.css';

/** Navigation: each area names the permission that reveals it — the
 *  screen hides, the server still decides. */
const NAV: { to: string; key: string; perm: PermKey | null }[] = [
  { to: '/', key: 'nav.flightdeck', perm: null },
  { to: '/calendar', key: 'nav.calendar', perm: 'appointments.view_own' },
  { to: '/till', key: 'nav.till', perm: 'pos.checkout' },
  { to: '/catalog', key: 'nav.catalog', perm: 'catalog.view' },
  { to: '/customers', key: 'nav.customers', perm: 'customers.view_assigned' },
  { to: '/reports', key: 'nav.reports', perm: 'reports.view_own' },
  { to: '/settings', key: 'nav.settings', perm: 'users.manage' },
];

export function Shell() {
  const { t, i18n } = useTranslation();
  const { me, logout, setLang, can } = useSession();
  const navigate = useNavigate();
  if (!me) return null;

  return (
    <div className="shell">
      <aside className="shell-side">
        <div className="shell-logo">V</div>
        <nav className="shell-nav">
          {NAV.filter((n) => !n.perm || can(n.perm)).map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) => `shell-navitem${isActive ? ' on' : ''}`}
            >
              {t(n.key)}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="shell-main">
        <header className="shell-header">
          <div className="shell-title">{t('app.workspace')}</div>
          <div className="shell-tools">
            <select
              className="input shell-lang"
              aria-label={t('shell.language')}
              value={i18n.language}
              onChange={(e) => void setLang(e.target.value as Lang)}
            >
              {LANGS.map((l) => (
                <option key={l} value={l}>
                  {t(`lang.${l}`)}
                </option>
              ))}
            </select>
            <span className="shell-user">
              <span className="shell-avatar">{me.name.split(' ').map((p) => p[0]).join('')}</span>
              {me.name}
            </span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                void logout().then(() => navigate('/login'));
              }}
            >
              {t('shell.signOut')}
            </button>
          </div>
        </header>
        <main className="shell-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
