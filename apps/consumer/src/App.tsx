import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { BookingProvider } from './features/booking/store.js';
import { BookConfirmed, BookIdentity, BookProfile } from './features/booking/steps.js';
import { Home } from './features/discovery/Home.js';
import { Results } from './features/discovery/Results.js';
import { Salon } from './features/salon/Salon.js';

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

export function App() {
  return (
    <QueryClientProvider client={qc}>
      <BookingProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/s/:category" element={<Results />} />
            <Route path="/salon/:slug" element={<Salon />} />
            <Route path="/book/identity" element={<BookIdentity />} />
            <Route path="/book/profile" element={<BookProfile />} />
            <Route path="/book/confirmed" element={<BookConfirmed />} />
            <Route path="*" element={<Home />} />
          </Routes>
        </BrowserRouter>
      </BookingProvider>
    </QueryClientProvider>
  );
}
