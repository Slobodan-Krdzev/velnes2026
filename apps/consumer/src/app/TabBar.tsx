import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

/**
 * The phone's bottom bar, in one place.
 *
 * Home and the results page each carried their own copy of this markup,
 * and the account page carried none — so signing in dropped you onto a
 * screen with no way back to anything except the browser's own back
 * button. Three copies would have been worse than two, so there is one.
 *
 * Favourites used to be a button with no handler on both of the copies
 * that existed. It goes to the favourites section now; a tab that does
 * nothing is the same failure as an inert filter chip.
 */

const IcHome = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 11 12 4l8 7v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z" /></svg>
);
const IcSearch = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4.2-4.2" /></svg>
);
const IcCal = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3.5v3M16 3.5v3" /></svg>
);
const IcHeart = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M12 20s-7.4-4.6-7.4-9.4A4.3 4.3 0 0 1 12 8a4.3 4.3 0 0 1 7.4 2.6C19.4 15.4 12 20 12 20z" /></svg>
);
const IcPerson = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7.2 7.2 0 0 1 14 0" /></svg>
);

export type Tab = 'home' | 'search' | 'bookings' | 'favs' | 'profile';

export function TabBar({ active, unread = 0 }: { active: Tab; unread?: number }) {
  const nav = useNavigate();
  const { t } = useTranslation();
  const tab = (id: Tab, to: string, icon: React.ReactNode, label: string) => (
    <button
      className={`tab-i${active === id ? ' on' : ''}`}
      aria-current={active === id ? 'page' : undefined}
      onClick={() => nav(to)}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <nav className="tabbar">
      {tab('home', '/', IcHome, t('c.tab.home'))}
      {tab('search', '/search', IcSearch, t('c.tab.search'))}
      {tab('bookings', '/account/appts', IcCal, t('c.tab.bookings'))}
      {tab('favs', '/account/favs', IcHeart, t('c.tab.favs'))}
      <button
        className={`tab-i${active === 'profile' ? ' on' : ''}`}
        aria-current={active === 'profile' ? 'page' : undefined}
        onClick={() => nav('/account')}
      >
        <span className="vnav-ic">
          {IcPerson}
          <span className="acc-bdg" hidden={unread === 0}>
            {unread}
          </span>
        </span>
        {t('c.tab.profile')}
      </button>
    </nav>
  );
}
