import { HqLoginResponseSchema } from '@velnes/contracts';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { HqApiError, hqPost } from './api.js';

export function HqLogin({
  onDone,
}: {
  onDone: (r: z.infer<typeof HqLoginResponseSchema>) => void;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setWorking(true);
    setError(null);
    try {
      onDone(await hqPost(HqLoginResponseSchema, '/hq/auth/login', { email, password }));
    } catch (err) {
      setError(err instanceof HqApiError ? t('login.invalid') : t('login.error'));
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
          {t('hq.signInSub')}
        </p>
        <div className="field">
          <label htmlFor="hq-email">{t('login.email')}</label>
          <input
            id="hq-email"
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="hq-pass">{t('login.password')}</label>
          <input
            id="hq-pass"
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
