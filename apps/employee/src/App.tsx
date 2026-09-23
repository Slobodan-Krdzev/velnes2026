import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createI18n } from '@velnes/i18n';
import { SessionProvider, useSession } from '@velnes/client';
import { useMemo, useState } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { EmployeeApp } from './Employee.js';
import { Join } from './Join.js';
import { MoLogin } from './MoLogin.js';
import './employee.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 15_000 } },
});

/** The one path the app answers besides its root: a personal sign-in
 *  link. Read once at boot; cleared from the address bar when done. */
function joinTokenFromUrl(): string | null {
  const m = /^\/join\/([A-Za-z0-9_-]{16,})\/?$/.exec(window.location.pathname);
  return m ? m[1]! : null;
}

function Gate() {
  const { me, booting } = useSession();
  const { t } = useTranslation();
  const [joinToken, setJoinToken] = useState<string | null>(joinTokenFromUrl);
  if (joinToken)
    return (
      <Join
        token={joinToken}
        onDone={() => {
          window.history.replaceState({}, '', '/');
          setJoinToken(null);
        }}
      />
    );
  if (booting)
    return (
      <div className="mo-app">
        <div className="mo-body muted">{t('shell.loading')}</div>
      </div>
    );
  return me ? <EmployeeApp /> : <MoLogin />;
}

export function App() {
  const i18n = useMemo(() => createI18n('en'), []);
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <Gate />
        </SessionProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}
