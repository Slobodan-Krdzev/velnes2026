import { SupplierLoginResponseSchema } from '@velnes/contracts';
import { createI18n, type Lang } from '@velnes/i18n';
import { useEffect, useMemo, useState } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { getSession, PortalApiError, pPost, setSession, type PortalUser } from './api.js';
import { Portal } from './Portal.js';

export function App() {
  const lang = (localStorage.getItem('velnes.portal.lang') as Lang) || 'en';
  const i18n = useMemo(() => createI18n(lang), [lang]);
  const [user, setUser] = useState<PortalUser | null>(getSession()?.user ?? null);

  useEffect(() => {
    const out = () => setUser(null);
    window.addEventListener('portal-signout', out);
    return () => window.removeEventListener('portal-signout', out);
  }, []);

  const setLang = (l: Lang) => {
    localStorage.setItem('velnes.portal.lang', l);
    void i18n.changeLanguage(l);
  };

  return (
    <I18nextProvider i18n={i18n}>
      {user ? (
        <Portal
          user={user}
          setLang={setLang}
          signOut={() => {
            setSession(null);
            setUser(null);
          }}
        />
      ) : (
        <PortalLogin onDone={setUser} />
      )}
    </I18nextProvider>
  );
}

function PortalLogin({ onDone }: { onDone: (u: PortalUser) => void }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setWorking(true);
    setError(null);
    try {
      const r = await pPost(SupplierLoginResponseSchema, '/portal/auth/login', { email, password });
      setSession({ token: r.accessToken, user: r.user });
      onDone(r.user);
    } catch (err) {
      setError(err instanceof PortalApiError ? t('login.invalid') : t('login.error'));
    } finally {
      setWorking(false);
    }
  };

  return (
    <div
      className="auth-wrap"
      style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-muted)' }}
    >
      <form className="card" style={{ width: 'min(420px,94vw)', padding: 28 }} onSubmit={submit}>
        <h1 style={{ margin: '0 0 4px' }}>Velnes</h1>
        <p className="muted" style={{ fontWeight: 500, margin: '0 0 18px' }}>
          {t('po.signInSub')}
        </p>
        <div className="field">
          <label htmlFor="po-email">{t('login.email')}</label>
          <input
            id="po-email"
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="po-pass">{t('login.password')}</label>
          <input
            id="po-pass"
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        {error ? (
          <p role="alert" style={{ color: 'var(--danger)', fontWeight: 600, marginTop: 10 }}>
            {error}
          </p>
        ) : null}
        <button className="btn btn-primary" type="submit" disabled={working} style={{ marginTop: 14, width: '100%' }}>
          {working ? t('login.working') : t('login.submit')}
        </button>
      </form>
    </div>
  );
}
