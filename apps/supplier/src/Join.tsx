import { PASSWORD_MIN, SupplierJoinPreviewSchema, SupplierLoginResponseSchema } from '@velnes/contracts';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { PortalApiError, pGet, pPost, setSession, type PortalUser } from './api.js';

/**
 * `/join/<token>` — the invite mail's one way in (Alex, 2026-10-07).
 * The link says who is invited; the page asks for a password and, for
 * the supplier's first owner, the company's commercial details. The
 * claim activates the user and signs them in. A dead link says so.
 */
type Preview = ReturnType<typeof SupplierJoinPreviewSchema.parse>;

export function Join({ token, onDone, onCancel }: { token: string; onDone: (u: PortalUser) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'dead'; expired: boolean } | { kind: 'form'; p: Preview }>({ kind: 'loading' });
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [company, setCompany] = useState({ contact: '', territory: '', lead: '', terms: '', minOrder: 0 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    pGet(SupplierJoinPreviewSchema, `/portal/join/${encodeURIComponent(token)}`)
      .then((p) => {
        setName(p.name);
        setCompany(p.company);
        setState({ kind: 'form', p });
      })
      .catch((err: unknown) => setState({ kind: 'dead', expired: err instanceof PortalApiError && err.code === 'LINK_EXPIRED' }));
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (state.kind !== 'form') return;
    if (pw !== pw2) {
      setError(t('po.join.pwMismatch'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const r = await pPost(SupplierLoginResponseSchema, `/portal/join/${encodeURIComponent(token)}`, {
        name: name.trim(),
        password: pw,
        ...(state.p.firstOwner ? { company: { ...company, minOrder: Number(company.minOrder) || 0 } } : {}),
      });
      setSession({ token: r.accessToken, user: r.user });
      onDone(r.user);
    } catch (err) {
      if (err instanceof PortalApiError && (err.code === 'INVALID_LINK' || err.code === 'LINK_EXPIRED'))
        setState({ kind: 'dead', expired: err.code === 'LINK_EXPIRED' });
      else setError(t('login.error'));
    } finally {
      setSaving(false);
    }
  };

  const wrap = (children: React.ReactNode) => (
    <div className="auth-wrap" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-muted)', padding: '24px 0' }}>
      <div className="card" style={{ width: 'min(560px,94vw)', padding: 28 }}>
        <h1 style={{ margin: '0 0 4px' }}>Velnes</h1>
        {children}
      </div>
    </div>
  );

  if (state.kind === 'loading') return wrap(<p className="muted">{t('po.join.checking')}</p>);

  if (state.kind === 'dead')
    return wrap(
      <>
        <p role="alert" style={{ fontWeight: 600 }}>{state.expired ? t('po.join.expired') : t('po.join.invalid')}</p>
        <p className="muted">{t('po.join.askNew')}</p>
        <button className="btn btn-primary" onClick={onCancel}>{t('po.join.toSignIn')}</button>
      </>,
    );

  const { p } = state;
  const field = (id: string, label: string, value: string | number, set: (v: string) => void, extra: Record<string, unknown> = {}) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="input" value={value} onChange={(e) => set(e.target.value)} {...extra} />
    </div>
  );
  return wrap(
    <form onSubmit={submit} data-testid="join-form">
      <p className="muted" style={{ fontWeight: 500, margin: '0 0 6px' }}>
        {t(p.firstOwner ? 'po.join.ownerSub' : 'po.join.memberSub', { supplier: p.supplierName })}
      </p>
      <p style={{ margin: '0 0 18px', fontSize: 13 }} className="muted">{t('po.join.as', { email: p.email })}</p>

      <h3 style={{ margin: '0 0 10px' }}>{t('po.join.you')}</h3>
      {field('jn-name', t('po.join.name'), name, setName, { required: true, maxLength: 80, autoComplete: 'name' })}
      {field('jn-pw', t('login.password'), pw, setPw, { type: 'password', required: true, minLength: PASSWORD_MIN, autoComplete: 'new-password' })}
      {field('jn-pw2', t('po.join.pwRepeat'), pw2, setPw2, { type: 'password', required: true, minLength: PASSWORD_MIN, autoComplete: 'new-password' })}
      <p className="muted" style={{ fontSize: 12, margin: '-4px 0 14px' }}>{t('po.join.pwHint', { n: PASSWORD_MIN })}</p>

      {p.firstOwner ? (
        <>
          <h3 style={{ margin: '6px 0 2px' }}>{t('po.join.company', { supplier: p.supplierName })}</h3>
          <p className="muted" style={{ fontSize: 12, margin: '0 0 10px' }}>{t('po.join.companyHint')}</p>
          {field('jn-contact', t('po.join.contact'), company.contact, (v) => setCompany({ ...company, contact: v }), { maxLength: 200, placeholder: '+389 … · sales@…' })}
          {field('jn-territory', t('po.join.territory'), company.territory, (v) => setCompany({ ...company, territory: v }), { maxLength: 120 })}
          {field('jn-lead', t('po.join.lead'), company.lead, (v) => setCompany({ ...company, lead: v }), { maxLength: 80, placeholder: t('po.join.leadEg') })}
          {field('jn-terms', t('po.join.terms'), company.terms, (v) => setCompany({ ...company, terms: v }), { maxLength: 200, placeholder: t('po.join.termsEg') })}
          {field('jn-min', t('po.join.minOrder'), company.minOrder, (v) => setCompany({ ...company, minOrder: Number(v) || 0 }), { type: 'number', min: 0, step: 1, inputMode: 'numeric' })}
        </>
      ) : null}

      {error ? <p role="alert" style={{ color: 'var(--danger)', fontWeight: 600, marginTop: 10 }}>{error}</p> : null}
      <button className="btn btn-primary" type="submit" disabled={saving} style={{ marginTop: 14, width: '100%' }}>
        {saving ? t('login.working') : t('po.join.submit')}
      </button>
    </form>,
  );
}
