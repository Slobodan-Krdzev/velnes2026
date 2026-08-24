import { Button, Card, Field, Input } from '@velnes/ui';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client.js';
import { useSession } from '../session.js';

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
    <div className="login-page">
      <Card className="login-card">
        <div className="login-brand">
          <span className="login-mark">V</span>
          <h1>{t('login.title')}</h1>
          <p className="muted">{t('login.subtitle')}</p>
        </div>
        <form onSubmit={submit} className="login-form">
          <Field label={t('login.email')}>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
          </Field>
          <Field label={t('login.password')}>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>
          {error ? <p className="error-text" role="alert">{error}</p> : null}
          <Button type="submit" disabled={working}>
            {working ? t('login.working') : t('login.submit')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
