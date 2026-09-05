import { ApiError, useSession } from '@velnes/client';
import { VelnesMark } from '@velnes/ui';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { getRoster, initials, setRoster, type RosterEntry } from './roster.js';

/** moLogin — the prototype's tap-your-name, made real. A bound device
 *  shows the salon's roster; tapping a name asks for that person's
 *  password (login-by-id). An unbound device (or "not this salon")
 *  falls back to the email + password sign-in that binds it. */
export function MoLogin() {
  const { t } = useTranslation();
  const { login, loginById } = useSession();
  const roster = getRoster();
  const [picked, setPicked] = useState<RosterEntry | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const errText = (err: unknown) =>
    err instanceof ApiError && err.code === 'INVALID_CREDENTIALS'
      ? t('login.invalid')
      : err instanceof ApiError && err.code === 'NOT_ACTIVE'
        ? t('login.notActive')
        : t('login.error');

  const submitEmail = async (e: FormEvent) => {
    e.preventDefault();
    setWorking(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(errText(err));
    } finally {
      setWorking(false);
    }
  };

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!picked) return;
    setWorking(true);
    setError(null);
    try {
      await loginById(picked.id, password);
    } catch (err) {
      setError(errText(err));
    } finally {
      setWorking(false);
    }
  };

  const head = (sub: string) => (
    <div className="mo-head">
      <div>
        <div
          className="t"
          style={{ color: 'var(--accent-deep)', display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <VelnesMark size={26} /> Velnes
        </div>
        <div className="s">{sub}</div>
      </div>
    </div>
  );

  // ── Password step for a tapped name. ──
  if (roster && picked) {
    return (
      <div className="mo-app">
        {head(t('mo.signInShift'))}
        <form className="mo-body" onSubmit={submitPassword}>
          <button
            type="button"
            className="mo-card"
            style={{ display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left' }}
            onClick={() => {
              setPicked(null);
              setPassword('');
              setError(null);
            }}
          >
            <span className="avatar">{initials(picked.name)}</span>
            <span style={{ display: 'flex', flexDirection: 'column' }}>
              <span className="bold">{picked.name}</span>
              <span className="muted" style={{ fontSize: 12, fontWeight: 500 }}>
                {t('mo.notYou')}
              </span>
            </span>
          </button>
          <label className="field">
            <span>{t('login.password')}</span>
            <input
              className="input"
              type="password"
              value={password}
              autoFocus
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
          <button className="btn btn-primary" type="submit" disabled={working || !password}>
            {working ? t('login.working') : t('login.submit')}
          </button>
        </form>
      </div>
    );
  }

  // ── Bound device: tap your name. ──
  if (roster && roster.staff.length) {
    return (
      <div className="mo-app">
        {head(t('mo.signInShift'))}
        <div className="mo-body">
          <p className="muted" style={{ fontWeight: 500 }}>
            {t('mo.tapName')}
          </p>
          {roster.staff.map((e) => (
            <button
              key={e.id}
              className="mo-card"
              style={{ display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left' }}
              onClick={() => {
                setPicked(e);
                setError(null);
              }}
            >
              <span className="avatar">{initials(e.name)}</span>
              <span style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="bold">{e.name}</span>
                <span className="muted" style={{ fontSize: 12, fontWeight: 500 }}>
                  {e.role}
                </span>
              </span>
            </button>
          ))}
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginTop: 8 }}
            onClick={() => setRoster(null)}
          >
            {t('mo.notThisSalon')}
          </button>
        </div>
      </div>
    );
  }

  // ── Unbound device: email + password (binds it on success). ──
  return (
    <div className="mo-app">
      {head(t('mo.signInShift'))}
      <form className="mo-body" onSubmit={submitEmail}>
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
