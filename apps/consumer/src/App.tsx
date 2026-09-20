import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Login, Register } from './features/account/Auth.js';
import { MyVelnes } from './features/account/MyVelnes.js';
import { BookingProvider } from './features/booking/store.js';
import { BookConfirmed, BookIdentity, BookProfile, BookReview } from './features/booking/steps.js';
import { Home } from './features/discovery/Home.js';
import { Results } from './features/discovery/Results.js';
import { Salon } from './features/salon/Salon.js';
import { SessionProvider, useFavourites, useSession } from './lib/api/session.js';
import { GeoProvider } from './lib/geo.js';

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

export function App() {
  return (
    <QueryClientProvider client={qc}>
      <SessionProvider>
        <PendingFavourite />
        <GeoProvider>
          <BookingProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/s/:category" element={<Results />} />
              <Route path="/salon/:slug" element={<Salon />} />
              <Route path="/book/identity" element={<BookIdentity />} />
              <Route path="/book/profile" element={<BookProfile />} />
              <Route path="/book/review" element={<BookReview />} />
              <Route path="/book/confirmed" element={<BookConfirmed />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/account" element={<MyVelnes section="over" />} />
              <Route path="/account/general" element={<MyVelnes section="general" />} />
              <Route path="/account/appts" element={<MyVelnes section="appts" />} />
              <Route path="/account/favs" element={<MyVelnes section="favs" />} />
              <Route path="/account/notifs" element={<MyVelnes section="notifs" />} />
              <Route path="/account/appointments/:id" element={<MyVelnes section="appts" />} />
              <Route path="*" element={<Home />} />
            </Routes>
          </BrowserRouter>
          </BookingProvider>
        </GeoProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
