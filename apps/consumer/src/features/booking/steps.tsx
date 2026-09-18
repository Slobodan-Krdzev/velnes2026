import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fmtMKD, minutesLbl } from '../../lib/api/mappers.js';
import { ApiError, pubPost } from '../../lib/api/client.js';
import { IcArr } from '../discovery/cards.js';
import { useBooking } from './store.js';

/** Guest identity steps — prototype markup, wired to the real booking
 *  door. The email verification-code step waits for the SMTP phase; the
 *  guest flow is the same unverified identity today's booking page uses. */

const IcVok13 = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3.5l7 2.5v5c0 4.5-3 8-7 9.5-4-1.5-7-5-7-9.5V6z" /><path d="M9 12l2 2 4-4" /></svg>
);
const IcCheck = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);

export function BookIdentity() {
  const nav = useNavigate();
  const { draft, patch } = useBooking();
  const [email, setEmail] = useState(draft?.email ?? '');
  const [fw, setFw] = useState<'self' | 'other'>(draft?.forWhom ?? 'self');
  const [guest, setGuest] = useState(draft?.guestName ?? '');
  const [err, setErr] = useState('');
  if (!draft) {
    return (
      <section className="acc" data-screen="email">
        <div className="authwrap">
          <h1>Confirm your booking</h1>
          <div className="sub">Pick a treatment at a salon first — your booking summary appears here.</div>
          <button className="btn btn-p" style={{ width: '100%', marginTop: '18px', minHeight: '50px' }} onClick={() => nav('/')}>
            Find a salon {IcArr}
          </button>
        </div>
      </section>
    );
  }
  const next = () => {
    if (!/.+@.+\..+/.test(email)) {
      setErr('Enter a valid email address.');
      return;
    }
    if (fw === 'other' && !guest.trim()) {
      setErr('Enter the guest name.');
      return;
    }
    patch({ email, forWhom: fw, guestName: guest });
    nav('/book/profile');
  };
  return (
    <section data-screen="email">
      <div className="authwrap">
        <h1>Confirm your booking</h1>
        <div className="sub">Enter your email to hold this appointment — no account or password needed.</div>
        <div className="minisum">
          <div className="r"><span className="k">For</span><span className="v">{fw === 'other' ? guest || 'Someone else' : 'Myself'}</span></div>
          <div className="r"><span className="k">Salon</span><span className="v">{draft.salonName}</span></div>
          <div className="r"><span className="k">Treatment</span><span className="v">{draft.serviceName} · {minutesLbl(draft.durationMin)}</span></div>
          <div className="r"><span className="k">Date &amp; time</span><span className="v">{draft.dayLbl} · {draft.time}</span></div>
          <div className="r"><span className="k">Total</span><span className="v">{fmtMKD(draft.price)}</span></div>
        </div>
        <div className="fld">
          <label style={{ fontSize: '12.5px', fontWeight: '700', color: 'var(--ink)' }}>Who is this appointment for?</label>
        </div>
        <div className="forwhom">
          <button className={fw === 'self' ? 'fwopt on' : 'fwopt'} type="button" onClick={() => setFw('self')}>
            <span className="fw-ic">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7.2 7.2 0 0 1 14 0" /></svg>
            </span>
            Myself<span className="ok2">{IcCheck}</span>
          </button>
          <button className={fw === 'other' ? 'fwopt on' : 'fwopt'} type="button" onClick={() => setFw('other')}>
            <span className="fw-ic">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="9" cy="8.5" r="3" /><circle cx="16.5" cy="9.5" r="2.4" /><path d="M3.5 19a5.8 5.8 0 0 1 11 0M14.5 19a5 5 0 0 1 6-3.6" /></svg>
            </span>
            Someone else<span className="ok2">{IcCheck}</span>
          </button>
        </div>
        {fw === 'other' ? (
          <div className="forother">
            <div className="fld">
              <label>
                Their name <small>(required)</small>
              </label>
              <input className="tin guest-name" type="text" autoComplete="off" placeholder="e.g. Sophie Petrov" value={guest} onChange={(e) => setGuest(e.target.value)} />
            </div>
            <div className="auth-note" style={{ marginTop: '10px' }}>{IcVok13} The salon will address the appointment to the guest name.</div>
          </div>
        ) : null}
        <div className="fld">
          <label htmlFor="em-d">Your email address</label>
          <input className="tin em-in" id="em-d" type="email" inputMode="email" autoComplete="email" placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
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
      setErr('Enter your name — the salon needs to know who is coming.');
      return;
    }
    if (phone.trim().length < 3) {
      setErr('Enter a mobile number — the salon may need to reach you.');
      return;
    }
    setErr('');
    setBusy(true);
    try {
      const res = await pubPost<{ ref: string; date: string; time: string; end: string; serviceName: string; locationName: string; employeeName: string; price: number }>('/book', {
        widgetKey: draft.publishableKey,
        key: crypto.randomUUID(),
        locationId: draft.locationId,
        serviceId: draft.serviceId,
        variantId: draft.variantId,
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
      if (e instanceof ApiError) setErr(e.message);
      else setErr('Something went wrong — please try again.');
    }
  };
  return (
    <section data-screen="profile">
      <div className="authwrap">
        <h1 style={{ fontSize: '23px' }}>Tell us a bit more</h1>
        <div className="sub">The salon needs a name and number for your booking — nothing else.</div>
        <div className="fld2">
          <div className="fld">
            <label>First name</label>
            <input className="tin" type="text" autoComplete="given-name" placeholder="Alex" value={first} onChange={(e) => setFirst(e.target.value)} />
          </div>
          <div className="fld">
            <label>Last name</label>
            <input className="tin" type="text" autoComplete="family-name" placeholder="Petrov" value={last} onChange={(e) => setLast(e.target.value)} />
          </div>
        </div>
        <div className="fld">
          <label>Mobile number</label>
          <input className="tin" type="tel" inputMode="tel" autoComplete="tel" placeholder="+389 70 123 456" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        {err ? <div className="acc-err" style={{ marginTop: '8px' }}>{err}</div> : null}
        <button className="btn btn-p" style={{ width: '100%', marginTop: '18px', minHeight: '50px' }} onClick={book} disabled={busy}>
          {busy ? 'Booking…' : 'Confirm booking'} {IcArr}
        </button>
      </div>
    </section>
  );
}

export function BookConfirmed() {
  const nav = useNavigate();
  const { draft, setDraft } = useBooking();
  const state = (history.state?.usr ?? null) as
    | { ref: string; date: string; time: string; end: string; serviceName: string; locationName: string; employeeName: string; price: number }
    | null;
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
        <h1 className="serif" style={{ fontSize: '30px' }}>Booked!</h1>
        <p className="muted" style={{ margin: '8px 0 18px' }}>Your appointment is confirmed at {state.locationName}.</p>
        <div className="sumcard">
          <div className="row"><span className="k">Salon</span><span className="v">{draft?.salonName ?? state.locationName}</span></div>
          <div className="row"><span className="k">For</span><span className="v">{draft?.forWhom === 'other' ? draft.guestName : 'Myself'}</span></div>
          <div className="row"><span className="k">Treatment</span><span className="v">{state.serviceName}</span></div>
          <div className="row"><span className="k">Professional</span><span className="v">{state.employeeName || 'Any available professional'}</span></div>
          <div className="row"><span className="k">Email</span><span className="v">{draft?.email ?? '—'}</span></div>
          <div className="row"><span className="k">Date &amp; time</span><span className="v">{state.date} · {state.time} – {state.end}</span></div>
          <div className="row"><span className="k">Booking reference</span><span className="v">{state.ref.slice(0, 8).toUpperCase()}</span></div>
          <div className="row tot"><span className="k" style={{ color: 'var(--ink)', fontWeight: '700' }}>Total</span><span className="v">{fmtMKD(state.price)}</span></div>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '18px' }}>
          <button className="btn btn-p" onClick={done}>Back to home</button>
        </div>
      </div>
    </section>
  );
}
