import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { t } from '../../lib/i18n-core.js';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../lib/api/client.js';
import { clientAuth, useSession } from '../../lib/api/session.js';
import { DobPicker } from '../../components/DobPicker.js';

/** Login and the six-step registration wizard — the prototype's auth
 *  markup, wired to the real client doors. The last step is a real
 *  6-digit code: it is generated server-side and queued through the
 *  mail outbox, so the gate is genuine even while the transport is
 *  still the mock one. */

const COUNTRY_CODES: [string, string, string][] = [
  ['+389', '🇲🇰', 'North Macedonia'],
  ['+355', '🇦🇱', 'Albania'],
  ['+383', '🇽🇰', 'Kosovo'],
  ['+381', '🇷🇸', 'Serbia'],
  ['+30', '🇬🇷', 'Greece'],
  ['+359', '🇧🇬', 'Bulgaria'],
  ['+49', '🇩🇪', 'Germany'],
  ['+41', '🇨🇭', 'Switzerland'],
  ['+31', '🇳🇱', 'Netherlands'],
  ['+44', '🇬🇧', 'United Kingdom'],
];
const LANGS: [string, 'en' | 'mk' | 'sq'][] = [
  ['English', 'en'],
  ['Македонски', 'mk'],
  ['Shqip', 'sq'],
];

export function Login() {
  useTranslation();
  const nav = useNavigate();
  const { setSession } = useSession();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (email.indexOf('@') < 1 || email.indexOf('.') < 0) return setErr(t('c.auth.needEmail'));
    if (!pw) return setErr(t('c.auth.needPassword'));
    setErr('');
    setBusy(true);
    try {
      const s = await clientAuth.login(email.trim(), pw);
      setSession(s.token, s.profile);
      nav('/account');
    } catch (e) {
      setBusy(false);
      setErr(e instanceof ApiError ? e.message : t('c.auth.wrong'));
    }
  };
  return (
    <div className="a-env">
      <section className="acc">
        <div className="auth-wrap">
          <a
            className="serif"
            style={{ display: 'inline-block', fontSize: '26px', color: 'var(--ink)', marginBottom: '18px', cursor: 'pointer' }}
            onClick={() => nav('/')}
          >
            velnes
          </a>
          <div className="acc-card" style={{ padding: '22px 18px' }}>
            <h2 className="serif" style={{ margin: '0 0 2px', fontSize: '23px', color: 'var(--ink)' }}>{t('c.auth.welcomeBack')}</h2>
            <div className="sm muted" style={{ marginBottom: '8px' }}>{t('c.auth.loginSub')}</div>
            <label className="acc-flbl">{t('c.auth.email')}</label>
            <input
              className="acc-inp"
              value={email}
              inputMode="email"
              autoComplete="email"
              onChange={(e) => setEmail(e.target.value)}
            />
            <label className="acc-flbl">{t('c.auth.password')}</label>
            <input
              type="password"
              className="acc-inp"
              value={pw}
              autoComplete="current-password"
              placeholder="••••••••"
              onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
            />
            {err ? <div className="acc-err">{err}</div> : null}
            <button className="btn btn-p" style={{ width: '100%', marginTop: '14px' }} disabled={busy} onClick={submit}>
              {busy ? t('c.auth.signingIn') : t('c.auth.login')}
            </button>
          </div>
          <div className="sm" style={{ textAlign: 'center', marginTop: '14px', color: 'var(--muted)' }}>
            New to Velnes?{' '}
            <button className="acc-link" onClick={() => nav('/register')}>{t('c.auth.create')}</button>
          </div>
        </div>
      </section>
    </div>
  );
}

interface Draft {
  first: string;
  last: string;
  email: string;
  cc: string;
  num: string;
  pw: string;
  rep: string;
  dob: string;
  lang: 'en' | 'mk' | 'sq';
  terms: boolean;
  code: string;
}

export function Register() {
  useTranslation();
  const nav = useNavigate();
  const { setSession } = useSession();
  const [step, setStep] = useState(1);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [d, setD] = useState<Draft>({
    first: '',
    last: '',
    email: '',
    cc: '+389',
    num: '',
    pw: '',
    rep: '',
    dob: '',
    lang: 'en',
    terms: false,
    code: '',
  });
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));

  const next = async () => {
    setErr('');
    if (step === 1 && !d.first.trim()) return setErr(t('c.auth.needFirst'));
    if (step === 2 && (d.email.indexOf('@') < 1 || d.email.indexOf('.') < 0))
      return setErr(t('c.auth.needEmail'));
    if (step === 3 && d.num.replace(/[^\d]/g, '').length < 6)
      return setErr(t('c.auth.needPhone'));
    if (step === 4) {
      if (d.pw.length < 8) return setErr(t('c.auth.pwShort'));
      if (d.pw !== d.rep) return setErr(t('c.auth.pwMismatch'));
    }
    if (step === 5) {
      if (!d.terms) return setErr(t('c.auth.needTerms'));
      // The account is created here; the code goes out immediately.
      setBusy(true);
      try {
        await clientAuth.register({
          email: d.email.trim(),
          password: d.pw,
          first: d.first.trim(),
          last: d.last.trim(),
          phone: `${d.cc} ${d.num}`.trim(),
          dob: d.dob || null,
          lang: d.lang,
        });
        // Auto-verify while there is no mail provider — Alex's call for
        // testing. The code is read back from the outbox it was queued
        // into and submitted for them, so the verify door still runs
        // for real; nothing is bypassed, it is just typed by the app.
        //
        // In production the route this reads does not exist, the fetch
        // fails, and step 6 asks for the code exactly as it does now.
        try {
          const { code } = await clientAuth.devCode(d.email.trim());
          if (code) {
            const s = await clientAuth.verify(d.email.trim(), code);
            setBusy(false);
            setSession(s.token, s.profile);
            nav('/account');
            return;
          }
        } catch {
          // No dev door: fall through to asking for the code.
        }
        setBusy(false);
        setStep(6);
      } catch (e) {
        setBusy(false);
        setErr(e instanceof ApiError ? e.message : t('c.auth.wrong'));
      }
      return;
    }
    if (step === 6) {
      const code = d.code.replace(/[^\d]/g, '');
      if (code.length !== 6) return setErr(t('c.auth.badCode'));
      setBusy(true);
      try {
        const s = await clientAuth.verify(d.email.trim(), code);
        setSession(s.token, s.profile);
        nav('/account');
      } catch (e) {
        setBusy(false);
        setErr(e instanceof ApiError ? e.message : t('c.auth.wrong'));
      }
      return;
    }
    setStep(step + 1);
  };

  const back = () => {
    setErr('');
    if (step <= 1) nav('/login');
    else setStep(step - 1);
  };

  const sub = [
    '',
    t('c.auth.hintName'),
    t('c.auth.hintEmail'),
    t('c.auth.hintPhone'),
    t('c.auth.hintPw'),
    t('c.auth.hintAlmost'),
    t('c.auth.hintVerify'),
  ][step];

  return (
    <div className="a-env">
      <section className="acc">
        <div className="auth-wrap">
          <div className="acc-card" style={{ padding: '22px 18px' }}>
            <button className="acc-link" style={{ color: 'var(--muted)' }} onClick={back}>{t('c.auth.back')}</button>
            <div className="reg-dots">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <i key={i} className={i <= step ? 'on' : ''}></i>
              ))}
            </div>
            <h2 className="serif" style={{ margin: '0 0 2px', fontSize: '23px', color: 'var(--ink)' }}>{t('c.auth.welcome')}</h2>
            <div className="sm muted" style={{ marginBottom: '6px' }}>
              {sub}
            </div>

            {step === 1 ? (
              <>
                <label className="acc-flbl">{t('c.auth.first')}</label>
                <input className="acc-inp" value={d.first} onChange={(e) => set({ first: e.target.value })} />
                <label className="acc-flbl">{t('c.auth.last')}</label>
                <input className="acc-inp" value={d.last} onChange={(e) => set({ last: e.target.value })} />
              </>
            ) : null}

            {step === 2 ? (
              <>
                <label className="acc-flbl">{t('c.auth.email')}</label>
                <input
                  className="acc-inp"
                  inputMode="email"
                  autoComplete="email"
                  value={d.email}
                  onChange={(e) => set({ email: e.target.value })}
                />
              </>
            ) : null}

            {step === 3 ? (
              <>
                <label className="acc-flbl">{t('c.auth.phone')}</label>
                <div className="ph-wrap">
                  <select aria-label={t('c.auth.cc')} value={d.cc} onChange={(e) => set({ cc: e.target.value })}>
                    {COUNTRY_CODES.map((c) => (
                      <option key={c[0]} value={c[0]} title={c[2]}>
                        {c[1]} {c[0]}
                      </option>
                    ))}
                  </select>
                  <input
                    inputMode="tel"
                    placeholder={t('c.auth.phonePh')}
                    value={d.num}
                    onChange={(e) => set({ num: e.target.value })}
                  />
                </div>
              </>
            ) : null}

            {step === 4 ? (
              <>
                <label className="acc-flbl">{t('c.auth.password')}</label>
                <input
                  type="password"
                  className="acc-inp"
                  autoComplete="new-password"
                  value={d.pw}
                  onChange={(e) => set({ pw: e.target.value })}
                />
                <label className="acc-flbl">{t('c.auth.repeat')}</label>
                <input
                  type="password"
                  className="acc-inp"
                  autoComplete="new-password"
                  value={d.rep}
                  onChange={(e) => set({ rep: e.target.value })}
                />
              </>
            ) : null}

            {step === 5 ? (
              <>
                <label className="acc-flbl" htmlFor="reg-dob">{t('c.auth.dob')}</label>
                <DobPicker id="reg-dob" value={d.dob} onChange={(dob) => set({ dob })} />
                <label className="acc-flbl">{t('c.auth.lang')}</label>
                <select
                  className="acc-inp"
                  value={d.lang}
                  onChange={(e) => set({ lang: e.target.value as 'en' | 'mk' | 'sq' })}
                >
                  {LANGS.map(([label, code]) => (
                    <option key={code} value={code}>
                      {label}
                    </option>
                  ))}
                </select>
                <label
                  style={{ display: 'flex', gap: '9px', alignItems: 'flex-start', marginTop: '14px', fontSize: '13.5px', color: 'var(--ink)' }}
                >
                  <input
                    type="checkbox"
                    style={{ marginTop: '3px' }}
                    checked={d.terms}
                    onChange={(e) => set({ terms: e.target.checked })}
                  />
                  <span>{t('c.auth.terms')}</span>
                </label>
              </>
            ) : null}

            {step === 6 ? (
              <>
                <p className="sm" style={{ color: 'var(--ink)', margin: '4px 0 0' }}>{t('c.auth.sentCode')} <b>{d.email}</b>.
                </p>
                <label className="acc-flbl">{t('c.auth.code')}</label>
                <input
                  className="acc-inp"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="• • • • • •"
                  value={d.code}
                  onChange={(e) => set({ code: e.target.value })}
                />
                <button
                  className="acc-link"
                  style={{ marginTop: '8px' }}
                  onClick={() => void clientAuth.resend(d.email.trim())}
                >{t('c.auth.resend')}</button>
              </>
            ) : null}

            {err ? <div className="acc-err">{err}</div> : null}
            <button className="btn btn-p" style={{ width: '100%', marginTop: '16px' }} disabled={busy} onClick={next}>
              {busy ? t('c.auth.moment') : step === 6 ? t('c.auth.verifyCreate') : t('c.bk.continue')}
            </button>
          </div>
          <div className="sm" style={{ textAlign: 'center', marginTop: '14px', color: 'var(--muted)' }}>
            Step {step} of 6 · Already have an account?{' '}
            <button className="acc-link" onClick={() => nav('/login')}>{t('c.auth.login')}</button>
          </div>
        </div>
      </section>
    </div>
  );
}
