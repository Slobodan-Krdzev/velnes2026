import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createI18n } from '@velnes/i18n';
import { useMemo, type ReactNode } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ToastProvider } from './lib/toast.js';
import { CalendarPage } from './pages/calendar/Calendar.js';
import { CatalogPage } from './pages/catalog/Catalog.js';
import { CustomersPage } from './pages/customers/Customers.js';
import { FlightdeckPage } from './pages/flightdeck/Flightdeck.js';
import { ReportsPage } from './pages/reports/Reports.js';
import { MarketingPage } from './pages/marketing/Marketing.js';
import { SettingsPage } from './pages/settings/Settings.js';
import { SuppliersPage } from './pages/suppliers/Suppliers.js';
import { InvoicesPage } from './pages/till/Invoices.js';
import { TillPage } from './pages/till/Till.js';
import { Login } from './pages/Login.js';
import { Register } from './pages/Register.js';
import { SessionProvider, useSession } from '@velnes/client';
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
              <Route path="/register" element={<Register />} />
              <Route
                element={
                  <Protected>
                    <Shell />
                  </Protected>
                }
              >
                <Route path="/" element={<FlightdeckPage />} />
                <Route path="/calendar" element={<CalendarPage />} />
                <Route path="/till" element={<TillPage />} />
                <Route path="/till/invoices" element={<InvoicesPage />} />
                <Route path="/catalog" element={<CatalogPage />} />
                <Route path="/suppliers" element={<SuppliersPage />} />
                <Route path="/customers" element={<CustomersPage />} />
                <Route path="/customers/:id" element={<CustomersPage />} />
                <Route path="/marketing" element={<MarketingPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
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
