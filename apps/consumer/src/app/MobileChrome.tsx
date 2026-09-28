import { useLocation } from 'react-router-dom';
import { useMyNotifications, useSession } from '../lib/api/session.js';
import { TabBar, type Tab } from './TabBar.js';

/**
 * The phone and tablet chrome, once, on every screen — Alex, 2026-09-22.
 *
 * Below 900px the fixed bottom tab bar is rendered here, above the
 * routes. There used to be a fixed top bar as well (the mark, the
 * business link); it went on 2026-09-28 (Alex): each screen starts
 * with its own first row — the home and the results with the search
 * pill, a salon with its back-and-name — and that row is where the
 * mark now lives. Above 900px this renders nothing visible; the desktop
 * header is the pages' own.
 */

function activeTab(pathname: string): Tab | null {
  if (pathname === '/') return 'home';
  if (pathname.startsWith('/s/') || pathname.startsWith('/search')) return 'search';
  if (pathname.startsWith('/account/favs')) return 'favs';
  if (pathname.startsWith('/account/appts') || pathname.startsWith('/account/appointments')) return 'bookings';
  if (pathname.startsWith('/account') || pathname === '/login' || pathname === '/register') return 'profile';
  return null;
}

export function MobileChrome() {
  const { pathname } = useLocation();
  const { signedIn } = useSession();
  const notifs = useMyNotifications();
  const unread = signedIn ? (notifs.data?.unread ?? 0) : 0;
  return (
    <div className="m-chrome">
      <TabBar active={activeTab(pathname)} unread={unread} />
    </div>
  );
}
