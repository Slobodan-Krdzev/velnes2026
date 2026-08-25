import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createI18n } from '@velnes/i18n';
import { useMemo, type ReactNode } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ToastProvider } from './lib/toast.js';
import { CalendarPage } from './pages/calendar/Calendar.js';
import { CatalogPage } from './pages/catalog/Catalog.js';
import { InvoicesPage } from './pages/till/Invoices.js';
import { TillPage } from './pages/till/Till.js';
import { Login } from './pages/Login.js';
import { SessionProvider, useSession } from './session.js';
import { Shell } from './shell/Shell.js';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 15_000 } },
});

function Protected({ children }: { children: ReactNode }) {
  const { me, booting } = useSession();
  const { t } = useTranslation();
  if (booting) return <div className="shell-content muted">{t('shell.loading')}</div>;
  if (!me) return <Navigate to="/login" replace />;
  return children;
}

function Placeholder({ title }: { title: string }) {
  const { t } = useTranslation();
  return <h1 style={{ fontSize: 20 }}>{t(title)}</h1>;
}

export function App() {
  const i18n = useMemo(() => createI18n('en'), []);
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
        <BrowserRouter>
          <SessionProvider>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route
                element={
                  <Protected>
                    <Shell />
                  </Protected>
                }
              >
                <Route path="/" element={<Placeholder title="nav.flightdeck" />} />
                <Route path="/calendar" element={<CalendarPage />} />
                <Route path="/till" element={<TillPage />} />
                <Route path="/till/invoices" element={<InvoicesPage />} />
                <Route path="/catalog" element={<CatalogPage />} />
                <Route path="/customers" element={<Placeholder title="nav.customers" />} />
                <Route path="/reports" element={<Placeholder title="nav.reports" />} />
                <Route path="/settings" element={<Placeholder title="nav.settings" />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </SessionProvider>
        </BrowserRouter>
        </ToastProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}
