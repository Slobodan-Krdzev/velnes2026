import { Button, Input } from '@velnes/ui';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client.js';
import { useSession } from '../session.js';

/** The prototype's viewLogin(), markup verbatim. */
export function Login() {
  const { t } = useTranslation();
  const { login } = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setWorking(true);
    setError(null);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INVALID_CREDENTIALS')
        setError(t('login.invalid'));
      else if (err instanceof ApiError && err.code === 'NOT_ACTIVE')
        setError(t('login.notActive'));
      else setError(t('login.error'));
    } finally {
      setWorking(false);
    }
  };

  return (
    <div
      className="auth-wrap"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--surface-muted)',
      }}
    >
      <form className="card" style={{ width: 'min(420px,94vw)', padding: 28 }} onSubmit={submit}>
        <h1 style={{ margin: '0 0 4px' }}>Velnes</h1>
        <p className="muted" style={{ fontWeight: 500, margin: '0 0 18px' }}>
          {t('login.subtitle')}
        </p>
        <div className="field">
          <label htmlFor="login-email">{t('login.email')}</label>
          <Input
            id="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="login-pass">{t('login.password')}</label>
          <Input
            id="login-pass"
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
        <Button type="submit" disabled={working} style={{ marginTop: 14, width: '100%' }}>
          {working ? t('login.working') : t('login.submit')}
        </Button>
      </form>
    </div>
  );
}
