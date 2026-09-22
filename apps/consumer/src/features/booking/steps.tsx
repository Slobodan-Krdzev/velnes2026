import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { i18n, t } from '../../lib/i18n-core.js';

/** Whether the dictionary can say this refusal in the app's language. */
const i18nHas = (key: string) => i18n.exists(key);
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fmtMKD, minutesLbl } from '../../lib/api/mappers.js';
import { ApiError, pubPost } from '../../lib/api/client.js';
import { useSession } from '../../lib/api/session.js';
import { IcArr } from '../discovery/cards.js';
import { SalonMap } from '../../components/SalonMap.js';
import { useBooking } from './store.js';

/** Guest identity steps — prototype markup, wired to the real booking
 *  door. The email verification-code step waits for the SMTP phase; the
 *  guest flow is the same unverified identity today's booking page uses. */

/** What a booked visit looks like coming back: the whole span, and a
 *  line per treatment underneath. */
export interface BookedVisit {
  ref: string;
  date: string;
  time: string;
  end: string;
  serviceName: string;
  items: { ref: string; serviceName: string; time: string; end: string; price: number; employeeName: string }[];
  locationName: string;
  employeeName: string;
  price: number;
}

const IcVok13 = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3.5l7 2.5v5c0 4.5-3 8-7 9.5-4-1.5-7-5-7-9.5V6z" /><path d="M9 12l2 2 4-4" /></svg>
);
const IcCheck = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);

export function BookIdentity() {
  useTranslation();
  const nav = useNavigate();
  const { draft, patch } = useBooking();
  const { signedIn } = useSession();
  // A signed-in client has already told us who they are.
  useEffect(() => {
    if (signedIn && draft) nav('/book/review', { replace: true });
  }, [signedIn, draft, nav]);
  const [email, setEmail] = useState(draft?.email ?? '');
  const [fw, setFw] = useState<'self' | 'other'>(draft?.forWhom ?? 'self');
  const [guest, setGuest] = useState(draft?.guestName ?? '');
  const [err, setErr] = useState('');
  if (!draft) {
    return (
      <section className="acc" data-screen="email">
        <div className="authwrap">
          <h1>{t('c.bk.confirm')}</h1>
          <div className="sub">{t('c.bk.pickFirst')}</div>
          <button className="btn btn-p" style={{ width: '100%', marginTop: '18px', minHeight: '50px' }} onClick={() => nav('/')}>
            Find a salon {IcArr}
          </button>
        </div>
      </section>
    );
  }
  const next = () => {
    if (!/.+@.+\..+/.test(email)) {
      setErr(t('c.bk.validEmail'));
      return;
    }
    if (fw === 'other' && !guest.trim()) {
      setErr(t('c.bk.guestName'));
      return;
    }
    patch({ email, forWhom: fw, guestName: guest });
    nav('/book/profile');
  };
  return (
    <section data-screen="email">
      <div className="authwrap">
        <h1>{t('c.bk.confirm')}</h1>
        <div className="sub">{t('c.bk.emailHold')}</div>
        <div className="minisum">
          <div className="r"><span className="k">{t('c.bk.for')}</span><span className="v">{fw === 'other' ? guest || 'Someone else' : 'Myself'}</span></div>
          <div className="r"><span className="k">{t('c.bk.salon')}</span><span className="v">{draft.salonName}</span></div>
          <div className="r">
            <span className="k">{draft.items.length > 1 ? 'Treatments' : 'Treatment'}</span>
            <span className="v">
              {draft.items.map((i) => i.name).join(' + ')} · {minutesLbl(draft.durationMin)}
            </span>
          </div>
          <div className="r"><span className="k">{t('c.bk.dateTime')}</span><span className="v">{draft.dayLbl} · {draft.time}</span></div>
          <div className="r"><span className="k">{t('c.bk.total')}</span><span className="v">{fmtMKD(draft.price)}</span></div>
        </div>
        <div className="fld">
          <label style={{ fontSize: '12.5px', fontWeight: '700', color: 'var(--ink)' }}>{t('c.bk.whoFor')}</label>
        </div>
        <div className="forwhom">
          <button className={fw === 'self' ? 'fwopt on' : 'fwopt'} type="button" onClick={() => setFw('self')}>
            <span className="fw-ic">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7.2 7.2 0 0 1 14 0" /></svg>
            </span>{t('c.bk.myself')}<span className="ok2">{IcCheck}</span>
          </button>
          <button className={fw === 'other' ? 'fwopt on' : 'fwopt'} type="button" onClick={() => setFw('other')}>
            <span className="fw-ic">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="9" cy="8.5" r="3" /><circle cx="16.5" cy="9.5" r="2.4" /><path d="M3.5 19a5.8 5.8 0 0 1 11 0M14.5 19a5 5 0 0 1 6-3.6" /></svg>
            </span>{t('c.bk.someoneElse')}<span className="ok2">{IcCheck}</span>
          </button>
        </div>
        {fw === 'other' ? (
          <div className="forother">
            <div className="fld">
              <label>{t('c.bk.theirName')}<small>{t('c.bk.required')}</small>
              </label>
              <input className="tin guest-name" type="text" autoComplete="off" placeholder={t('c.bk.guestPh')} value={guest} onChange={(e) => setGuest(e.target.value)} />
            </div>
            <div className="auth-note" style={{ marginTop: '10px' }}>{IcVok13} The salon will address the appointment to the guest name.</div>
          </div>
        ) : null}
        <div className="fld">
          <label htmlFor="em-d">{t('c.bk.yourEmail')}</label>
          <input className="tin em-in" id="em-d" type="email" inputMode="email" autoComplete="email" placeholder={t('c.bk.emailPh')} value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {err ? <div className="acc-err" style={{ marginTop: '8px' }}>{err}</div> : null}
        <button className="btn btn-p" style={{ width: '100%', marginTop: '18px', minHeight: '50px' }} onClick={next}>
          Continue {IcArr}
        </button>
        <div className="auth-note">{IcVok13} We only use your email for booking confirmations. No spam, no password.</div>
      </div>
    </section>
  );
}

export function BookProfile() {
  useTranslation();
  const nav = useNavigate();
  const { draft, patch } = useBooking();
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [phone, setPhone] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (!draft) {
    nav('/book/identity');
    return null;
  }
  const book = async () => {
    const name = draft.forWhom === 'other' ? draft.guestName : `${first} ${last}`.trim();
    if (!name) {
      setErr(t('c.bk.needName'));
      return;
    }
    if (phone.trim().length < 3) {
      setErr(t('c.bk.needPhone'));
      return;
    }
    setErr('');
    setBusy(true);
    try {
      const res = await pubPost<BookedVisit>('/book', {
        widgetKey: draft.publishableKey,
        key: crypto.randomUUID(),
        locationId: draft.locationId,
        serviceId: draft.serviceId,
        variantId: draft.variantId,
        items: draft.items.map((i) => ({
          serviceId: i.serviceId,
          ...(i.variantId ? { variantId: i.variantId } : {}),
        })),
        date: draft.date,
        time: draft.time,
        employeeId: draft.employeeId,
        name,
        phone: phone.trim(),
        email: draft.email,
      });
      patch({ name, phone: phone.trim() });
      nav('/book/confirmed', { state: res });
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError) setErr(i18nHas(`refusal.${e.code}`) ? t(`refusal.${e.code}`, e.params) : e.message);
      else setErr(t('c.bk.wrong'));
    }
  };
  return (
    <section data-screen="profile">
      <div className="authwrap">
        <h1 style={{ fontSize: '23px' }}>{t('c.bk.tellMore')}</h1>
        <div className="sub">{t('c.bk.tellMoreSub')}</div>
        <div className="fld2">
          <div className="fld">
            <label>{t('c.bk.first')}</label>
            <input className="tin" type="text" autoComplete="given-name" placeholder={t('c.bk.firstPh')} value={first} onChange={(e) => setFirst(e.target.value)} />
          </div>
          <div className="fld">
            <label>{t('c.bk.last')}</label>
            <input className="tin" type="text" autoComplete="family-name" placeholder={t('c.bk.lastPh')} value={last} onChange={(e) => setLast(e.target.value)} />
          </div>
        </div>
        <div className="fld">
          <label>{t('c.bk.mobile')}</label>
          <input className="tin" type="tel" inputMode="tel" autoComplete="tel" placeholder={t('c.bk.mobilePh')} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        {err ? <div className="acc-err" style={{ marginTop: '8px' }}>{err}</div> : null}
        <button className="btn btn-p" style={{ width: '100%', marginTop: '18px', minHeight: '50px' }} onClick={book} disabled={busy}>
          {busy ? 'Booking…' : t('c.bk.confirmBtn')} {IcArr}
        </button>
      </div>
    </section>
  );
}

export function BookConfirmed() {
  useTranslation();
  const nav = useNavigate();
  const { draft, setDraft } = useBooking();
  const state = (history.state?.usr ?? null) as BookedVisit | null;
  if (!state) {
    nav('/');
    return null;
  }
  const done = () => {
    setDraft(null);
    nav('/');
  };
  return (
    <section data-screen="confirm">
      <div className="confirm-wrap">
        <div className="okring">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        </div>
        <h1 className="serif" style={{ fontSize: '30px' }}>{t('c.bk.booked')}</h1>
        <p className="muted" style={{ margin: '8px 0 18px' }}>Your appointment is confirmed at {state.locationName}.</p>
        <div className="sumcard">
          <div className="row"><span className="k">{t('c.bk.salon')}</span><span className="v">{draft?.salonName ?? state.locationName}</span></div>
          <div className="row"><span className="k">{t('c.bk.for')}</span><span className="v">{draft?.forWhom === 'other' ? draft.guestName : 'Myself'}</span></div>
          {state.items.length > 1 ? (
            state.items.map((i) => (
              <div className="row" key={i.ref}>
                <span className="k">
                  {i.time}–{i.end}
                </span>
                <span className="v">
                  {i.serviceName}
                  {i.employeeName ? ` · ${i.employeeName}` : ''} · {fmtMKD(i.price)}
                </span>
              </div>
            ))
          ) : (
            <>
              <div className="row"><span className="k">{t('c.bk.treatment')}</span><span className="v">{state.serviceName}</span></div>
              <div className="row"><span className="k">{t('c.bk.professional')}</span><span className="v">{state.employeeName || 'Any available professional'}</span></div>
            </>
          )}
          <div className="row"><span className="k">{t('c.bk.email')}</span><span className="v">{draft?.email ?? '—'}</span></div>
          <div className="row"><span className="k">{t('c.bk.dateTime')}</span><span className="v">{state.date} · {state.time} – {state.end}</span></div>
          <div className="row"><span className="k">{t('c.bk.reference')}</span><span className="v">{state.ref.slice(0, 8).toUpperCase()}</span></div>
          <div className="row tot"><span className="k" style={{ color: 'var(--ink)', fontWeight: '700' }}>{t('c.bk.total')}</span><span className="v">{fmtMKD(state.price)}</span></div>
        </div>
        {draft?.lat != null && draft.lng != null ? (
          <div style={{ marginTop: '16px' }}>
            <SalonMap
              pins={[{ lat: draft.lat, lng: draft.lng, label: draft.salonName, sub: state.locationName, here: true }]}
              height={170}
              zoom={16}
              radius={12}
              labels={false}
            />
          </div>
        ) : null}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '18px' }}>
          <button className="btn btn-p" onClick={done}>{t('c.bk.backHome')}</button>
        </div>
      </div>
    </section>
  );
}

/** The signed-in path: nothing to ask, only to confirm. Books through
 *  the client door, which is what links the person to this salon as a
 *  customer and rings both bells. */
export function BookReview() {
  useTranslation();
  const nav = useNavigate();
  const { draft, setDraft } = useBooking();
  const { signedIn, profile, api } = useSession();
  const qc = useQueryClient();
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!signedIn) nav('/book/identity', { replace: true });
  }, [signedIn, nav]);
  if (!draft || !profile) return null;
  const book = async () => {
    setBusy(true);
    setErr('');
    try {
      const res = await api<BookedVisit>('/book', {
        method: 'POST',
        body: JSON.stringify({
          key: crypto.randomUUID(),
          slug: draft.slug,
          locationId: draft.locationId,
          serviceId: draft.serviceId,
          variantId: draft.variantId,
          items: draft.items.map((i) => ({
            serviceId: i.serviceId,
            ...(i.variantId ? { variantId: i.variantId } : {}),
          })),
          date: draft.date,
          time: draft.time,
          employeeId: draft.employeeId,
        }),
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['my-appointments'] }),
        qc.invalidateQueries({ queryKey: ['my-notifications'] }),
        qc.invalidateQueries({ queryKey: ['my-salons'] }),
      ]);
      setDraft({ ...draft, email: profile.email });
      nav('/book/confirmed', { state: res });
    } catch (e) {
      setBusy(false);
      setErr(e instanceof ApiError ? (i18nHas(`refusal.${e.code}`) ? t(`refusal.${e.code}`, e.params) : e.message) : t('c.bk.wrong'));
    }
  };
  return (
    <section data-screen="email">
      <div className="authwrap">
        <h1>{t('c.bk.confirm')}</h1>
        <div className="sub">
          Booking as {`${profile.first} ${profile.last}`.trim()} · {profile.email}
        </div>
        <div className="minisum">
          <div className="r"><span className="k">{t('c.bk.salon')}</span><span className="v">{draft.salonName}</span></div>
          <div className="r">
            <span className="k">{draft.items.length > 1 ? 'Treatments' : 'Treatment'}</span>
            <span className="v">
              {draft.items.map((i) => i.name).join(' + ')} · {minutesLbl(draft.durationMin)}
            </span>
          </div>
          <div className="r"><span className="k">{t('c.bk.professional')}</span><span className="v">{draft.employeeName}</span></div>
          <div className="r"><span className="k">{t('c.bk.dateTime')}</span><span className="v">{draft.dayLbl} · {draft.time}</span></div>
          <div className="r"><span className="k">{t('c.bk.total')}</span><span className="v">{fmtMKD(draft.price)}</span></div>
        </div>
        {err ? <div className="acc-err" style={{ marginTop: '10px' }}>{err}</div> : null}
        <button
          className="btn btn-p"
          style={{ width: '100%', marginTop: '18px', minHeight: '50px' }}
          disabled={busy}
          onClick={book}
        >
          {busy ? 'Booking…' : t('c.bk.confirmBtn')} {IcArr}
        </button>
        <div className="auth-note">{IcVok13} You can cancel from My Velnes at any time.</div>
      </div>
    </section>
  );
}
