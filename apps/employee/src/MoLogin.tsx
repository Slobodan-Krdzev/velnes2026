import { ApiError, useSession } from '@velnes/client';
import { VelnesMark } from '@velnes/ui';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

/** moLogin, adapted: real credentials instead of tap-your-name. */
export function MoLogin() {
  const { t } = useTranslation();
  const { login } = useSession();
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
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'INVALID_CREDENTIALS'
          ? t('login.invalid')
          : err instanceof ApiError && err.code === 'NOT_ACTIVE'
            ? t('login.notActive')
            : t('login.error'),
      );
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="mo-app">
      <div className="mo-head">
        <div>
          <div className="t" style={{ color: 'var(--accent-deep)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <VelnesMark size={26} /> Velnes
          </div>
          <div className="s">{t('mo.signInShift')}</div>
        </div>
      </div>
      <form className="mo-body" onSubmit={submit}>
        <label className="field">
          <span>{t('login.email')}</span>
          <input
            className="input"
            type="email"
            value={email}
            autoComplete="username"
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>{t('login.password')}</span>
          <input
            className="input"
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error ? (
          <p role="alert" style={{ color: 'var(--danger)', fontWeight: 600 }}>
            {error}
          </p>
        ) : null}
        <button className="btn btn-primary" type="submit" disabled={working}>
          {working ? t('login.working') : t('login.submit')}
        </button>
      </form>
    </div>
  );
}
