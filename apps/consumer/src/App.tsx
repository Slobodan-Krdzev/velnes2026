import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Login, Register } from './features/account/Auth.js';
import { MyVelnes } from './features/account/MyVelnes.js';
import { BookingProvider } from './features/booking/store.js';
import { BookConfirmed, BookIdentity, BookProfile, BookReview } from './features/booking/steps.js';
import { BookPay } from './features/booking/pay.js';
import { Home } from './features/discovery/Home.js';
import { Results } from './features/discovery/Results.js';
import { Salon } from './features/salon/Salon.js';
import { SessionProvider, useFavourites, useSession } from './lib/api/session.js';
import { GeoProvider } from './lib/geo.js';
import { I18nextProvider } from 'react-i18next';
import { LangSync, i18n } from './lib/i18n.js';

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

/**
 * A heart tapped while signed out is applied here, once, when a session
 * appears — Phase C, docs/FAVOURITES.md.
 *
 * Centrally rather than in each of the two places that establish a
 * session (signing in, and verifying a new account), so that a third
 * one added later cannot forget to do it.
 */
function PendingFavourite() {
  const { signedIn } = useSession();
  const { applyPending } = useFavourites();
  useEffect(() => {
    if (signedIn) void applyPending();
  }, [signedIn, applyPending]);
  return null;
}

/**
 * Every route starts at the top.
 *
 * The browser restores the previous scroll position on a history
 * change, which is right for a back button and wrong for everything
 * else: following a result three screens down would open the salon page
 * three screens down, in the middle of its gallery.
 *
 * Keyed on the path rather than the whole location, so changing a
 * filter — which writes `?price=low` into the URL — does not throw the
 * reader back to the top of the list they were reading.
 */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    // The phone layout scrolls its own panel rather than the window.
    for (const el of document.querySelectorAll('.m-page, .d-env')) el.scrollTop = 0;
  }, [pathname]);
  return null;
}

export function App() {
  return (
    <I18nextProvider i18n={i18n}>
    <QueryClientProvider client={qc}>
      <SessionProvider>
        <PendingFavourite />
        <LangSync />
        <GeoProvider>
          <BookingProvider>
          <BrowserRouter>
            <ScrollToTop />
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/s/:category" element={<Results />} />
              {/* One results page, two entrances: a category card and a
                  typed query. */}
              <Route path="/search" element={<Results />} />
              <Route path="/salon/:slug" element={<Salon />} />
              <Route path="/book/identity" element={<BookIdentity />} />
              <Route path="/book/profile" element={<BookProfile />} />
              <Route path="/book/review" element={<BookReview />} />
              <Route path="/book/pay" element={<BookPay />} />
              <Route path="/book/confirmed" element={<BookConfirmed />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/account" element={<MyVelnes section="over" />} />
              <Route path="/account/general" element={<MyVelnes section="general" />} />
              <Route path="/account/appts" element={<MyVelnes section="appts" />} />
              <Route path="/account/favs" element={<MyVelnes section="favs" />} />
              <Route path="/account/notifs" element={<MyVelnes section="notifs" />} />
              <Route path="/account/cards" element={<MyVelnes section="cards" />} />
              <Route path="/account/appointments/:id" element={<MyVelnes section="appts" />} />
              <Route path="*" element={<Home />} />
            </Routes>
          </BrowserRouter>
          </BookingProvider>
        </GeoProvider>
      </SessionProvider>
    </QueryClientProvider>
    </I18nextProvider>
  );
}
