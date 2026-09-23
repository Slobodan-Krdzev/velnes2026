import { ApiError, useSession } from '@velnes/client';
import { PASSWORD_MIN } from '@velnes/contracts';
import { VelnesMark } from '@velnes/ui';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { getRoster } from './roster.js';

/**
 * `/join/<token>` — a personal sign-in link opened on the phone (Alex,
 * 2026-09-23). The link carries who and which salon; the door signs
 * that one person in, binds this device to their salon (the roster is
 * rewritten by the app once signed in) and, the first time, asks them
 * to choose the password "tap your name" will use from then on. A
 * dead link says so and sends them to their salon for a new one.
 */
export function Join({ token, onDone }: { token: string; onDone: () => void }) {
  const { t } = useTranslation();
  const { signInWithLink, setPassword } = useSession();
  const [state, setState] = useState<
    { kind: 'working' } | { kind: 'dead'; expired: boolean } | { kind: 'password'; salon: string } | { kind: 'done'; salon: string }
  >({ kind: 'working' });
  const [rebound, setRebound] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const before = getRoster()?.tenantId ?? null;
    signInWithLink(token)
      .then(({ needsPassword, salonName, tenantId }) => {
        // The app rewrites the roster for the new salon; say so if the
        // phone belonged to another salon until now.
        setRebound(before != null && before !== tenantId);
        setState(needsPassword ? { kind: 'password', salon: salonName } : { kind: 'done', salon: salonName });
      })
      .catch((err: unknown) => {
        setState({ kind: 'dead', expired: err instanceof ApiError && err.code === 'LINK_EXPIRED' });
      });
  }, [signInWithLink, token]);

  // Signed in with a password already: straight into the app.
  useEffect(() => {
    if (state.kind === 'done') {
      const id = setTimeout(onDone, 900);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [state, onDone]);

  const savePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (pw !== pw2) {
      setError(t('join.pwMismatch'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setPassword(pw);
      onDone();
    } catch {
      setError(t('login.error'));
    } finally {
      setSaving(false);
    }
  };

  const head = (sub: string) => (
    <div className="mo-head">
      <div>
        <div className="t" style={{ color: 'var(--accent-deep)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <VelnesMark size={26} /> Velnes
        </div>
        <div className="s">{sub}</div>
      </div>
    </div>
  );

  if (state.kind === 'working')
    return (
      <div className="mo-app">
        {head(t('join.signingIn'))}
        <div className="mo-body muted">{t('join.checking')}</div>
      </div>
    );

  if (state.kind === 'dead')
    return (
      <div className="mo-app">
        {head(t('join.deadTitle'))}
        <div className="mo-body">
          <p role="alert" style={{ fontWeight: 600 }}>
            {state.expired ? t('join.expired') : t('join.invalid')}
          </p>
          <p className="muted">{t('join.askSalon')}</p>
          <button className="btn btn-primary" onClick={onDone}>
            {t('join.toSignIn')}
          </button>
        </div>
      </div>
    );

  if (state.kind === 'done')
    return (
      <div className="mo-app">
        {head(t('join.welcome', { salon: state.salon }))}
        <div className="mo-body muted">{t('join.opening')}</div>
      </div>
    );

  return (
    <div className="mo-app">
      {head(t('join.welcome', { salon: state.salon }))}
      <form className="mo-body" onSubmit={savePassword}>
        {rebound ? <p className="muted">{t('join.rebound', { salon: state.salon })}</p> : null}
        <p style={{ fontWeight: 600 }}>{t('join.choosePw')}</p>
        <p className="muted" style={{ fontSize: 13 }}>
          {t('join.pwHint', { n: PASSWORD_MIN })}
        </p>
        <label className="field">
          <span>{t('login.password')}</span>
          <input
            className="input"
            type="password"
            value={pw}
            autoComplete="new-password"
            minLength={PASSWORD_MIN}
            onChange={(e) => setPw(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>{t('join.pwRepeat')}</span>
          <input
            className="input"
            type="password"
            value={pw2}
            autoComplete="new-password"
            minLength={PASSWORD_MIN}
            onChange={(e) => setPw2(e.target.value)}
            required
          />
        </label>
        {error ? (
          <p role="alert" style={{ color: 'var(--danger)', fontWeight: 600 }}>
            {error}
          </p>
        ) : null}
        <button className="btn btn-primary" type="submit" disabled={saving || pw.length < PASSWORD_MIN}>
          {saving ? t('login.working') : t('join.continue')}
        </button>
      </form>
    </div>
  );
}
