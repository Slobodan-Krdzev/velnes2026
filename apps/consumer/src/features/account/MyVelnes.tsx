import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DHeader } from '../../app/chrome.js';
import { TabBar } from '../../app/TabBar.js';
import type { z } from 'zod';
import type { ClientAppointmentSchema } from '@velnes/contracts';
import { SalonMap } from '../../components/SalonMap.js';
import { useWheelScroll } from '../../lib/useWheelScroll.js';
import { ApiError } from '../../lib/api/client.js';
import { fmtMKD, minutesLbl } from '../../lib/api/mappers.js';
import {
  useFavourites,
  useMyAppointments,
  useMyNotifications,
  useMySalons,
  useSession,
} from '../../lib/api/session.js';

type Appt = z.infer<typeof ClientAppointmentSchema>;

/** My Velnes — the account layer, prototype markup, real data. The
 *  sections here are the ones the platform can actually answer today:
 *  General, Appointments and Notifications. Favourites, Billing,
 *  Loyalty and Premium are absent rather than shown empty, because
 *  nothing backs them yet. */

const BELL = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 9a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7" /><path d="M10.2 20a2 2 0 0 0 3.6 0" /></svg>
);
const BACK = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 6 8.5 12l6 6" /></svg>
);

const SECS = [
  { id: 'general', t: 'General', sub: 'Account info & password' },
  { id: 'appts', t: 'Appointments', sub: 'Upcoming & history' },
  // Third, where the prototype puts it.
  { id: 'favs', t: 'Favourites', sub: 'Salons, pros & services' },
  { id: 'notifs', t: 'Notifications', sub: '' },
] as const;
type SecId = (typeof SECS)[number]['id'] | 'over' | 'appt';

const TITLES: Record<string, string> = {
  over: 'My Velnes',
  general: 'General',
  appts: 'Appointments',
  appt: 'Appointment',
  favs: 'Favourites',
  notifs: 'Notifications',
};

function initials(p: { first: string; last: string; email: string }) {
  return ((p.first[0] ?? p.email[0] ?? 'V') + (p.last[0] ?? '')).toUpperCase();
}

function Avatar({ size, fs }: { size: number; fs: number }) {
  const { profile } = useSession();
  if (!profile) return null;
  if (profile.avatar)
    return (
      <span
        className="avdot"
        style={{ width: size, height: size, background: `url(${profile.avatar}) center/cover` }}
      ></span>
    );
  return (
    <span className="avdot" style={{ width: size, height: size, fontSize: fs }}>
      {initials(profile)}
    </span>
  );
}

/** Upcoming means: not cancelled, and not yet in the past. */
function bucketOf(a: Appt): 'up' | 'past' | 'canc' {
  if (a.status === 'cancelled') return 'canc';
  const when = new Date(`${a.date}T${a.end}:00`);
  return when.getTime() >= Date.now() ? 'up' : 'past';
}

function StatusBadge({ a }: { a: Appt }) {
  const b = bucketOf(a);
  if (b === 'canc') return <span className="acc-badge off">Cancelled</span>;
  if (b === 'past') return <span className="acc-badge mut">Completed</span>;
  return <span className="acc-badge ok">Confirmed</span>;
}

function ApptRow({ a, onOpen }: { a: Appt; onOpen: () => void }) {
  return (
    <div className="acc-card" style={{ cursor: 'pointer' }} onClick={onOpen}>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3>{a.serviceName}</h3>
          <div className="sm muted">
            {a.salonName} · {a.locationName}
            {a.employeeName ? ` · ${a.employeeName}` : ''}
          </div>
          <div className="sm" style={{ color: 'var(--ink)', fontWeight: 700, marginTop: '3px' }}>
            {a.date} · {a.time}–{a.end} · {minutesLbl(a.durationMin)}
          </div>
          <div style={{ marginTop: '7px', display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
            <StatusBadge a={a} />
            <b style={{ marginLeft: 'auto', color: 'var(--ink)' }}>{fmtMKD(a.price)}</b>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MyVelnes({ section = 'over' }: { section?: SecId }) {
  const nav = useNavigate();
  const params = useParams();
  const qc = useQueryClient();
  const { profile, signedIn, signOut, api } = useSession();
  const appts = useMyAppointments();
  const notifs = useMyNotifications();
  const salons = useMySalons();
  const [tab, setTab] = useState<'up' | 'past' | 'canc'>('up');
  // The section chips are a rail too: the wheel slides them.
  const chipsRef = useRef<HTMLDivElement | null>(null);
  useWheelScroll(chipsRef);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const unread = notifs.data?.unread ?? 0;
  const list = useMemo(() => appts.data?.appointments ?? [], [appts.data]);
  const current = params.id ? list.find((a) => a.id === params.id) : undefined;

  if (!signedIn || !profile) {
    return (
      <>
        <div className="only-d">
          <DHeader />
        </div>
        <div className="a-env">
          <section className="acc">
            <div className="auth-wrap">
            <div className="acc-empty">
              <b>Sign in to see your Velnes</b>
              Your appointments, notifications and account live here.
              <br />
              <button className="btn btn-p" onClick={() => nav('/login')}>
                Log in
              </button>
              </div>
            </div>
          </section>
        </div>
        <div className="only-m">
          <TabBar active="profile" />
        </div>
      </>
    );
  }

  const go = (s: SecId) => nav(s === 'over' ? '/account' : `/account/${s}`);

  const cancel = async (id: string) => {
    setBusy(true);
    setErr('');
    try {
      await api(`/me/appointments/${id}/cancel`, { method: 'POST' });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['my-appointments'] }),
        qc.invalidateQueries({ queryKey: ['my-notifications'] }),
      ]);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not cancel — please try again.');
    }
    setBusy(false);
  };

  const markRead = async (id: string | null) => {
    await api('/me/notifications/read', { method: 'POST', body: JSON.stringify({ id }) });
    await qc.invalidateQueries({ queryKey: ['my-notifications'] });
  };

  const sec: SecId = current ? 'appt' : section;
  const parent = sec === 'appt' ? 'appts' : '';

  return (
    <>
      {/* The account page had no chrome at all: signing in dropped you
          somewhere with no way back to anything but the browser's own
          back button. */}
      <div className="only-d">
        <DHeader />
      </div>
      <div className="a-env">
        <section className="acc">
          <div className="acc-shell" id="acc-shell">
          <aside className="acc-side">
            <div className="acc-me" onClick={() => go('over')}>
              <Avatar size={46} fs={15} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <b>{`${profile.first} ${profile.last}`.trim()}</b>
                <div
                  className="sm muted"
                  style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {profile.email}
                </div>
              </div>
              <button
                className="acc-bell acc-topbell"
                onClick={(e) => {
                  e.stopPropagation();
                  go('notifs');
                }}
                aria-label="Notifications"
              >
                {BELL}
                <span className="acc-bdg" hidden={unread === 0}>
                  {unread}
                </span>
              </button>
            </div>
            <div className="acc-chips" ref={chipsRef}>
              {SECS.map((s) => (
                <button
                  key={s.id}
                  className="acc-chip"
                  aria-current={sec === s.id || (sec === 'appt' && s.id === 'appts')}
                  onClick={() => go(s.id)}
                >
                  {s.t}
                  {s.id === 'notifs' && unread > 0 ? <span className="cnt2">{unread}</span> : null}
                </button>
              ))}
              <button
                className="acc-chip"
                style={{ color: 'var(--muted)' }}
                onClick={() => {
                  signOut();
                  nav('/');
                }}
              >
                Log out
              </button>
            </div>
            <nav className="acc-menu">
              {SECS.map((s) => (
                <button
                  key={s.id}
                  aria-current={sec === s.id || (sec === 'appt' && s.id === 'appts')}
                  onClick={() => go(s.id)}
                >
                  <span>
                    {s.t}
                    {s.sub ? <span className="sub">{s.sub}</span> : null}
                  </span>
                  {s.id === 'notifs' && unread > 0 ? (
                    <span className="cnt">{unread}</span>
                  ) : (
                    <span className="chev">›</span>
                  )}
                </button>
              ))}
              <button
                onClick={() => {
                  signOut();
                  nav('/');
                }}
                style={{ color: 'var(--muted)' }}
              >
                <span>Log out</span>
              </button>
            </nav>
          </aside>

          <main className="acc-pane">
            <div className="acc-pane-top" id="acc-pane-top">
              {sec !== 'over' ? (
                <>
                  {parent ? (
                    <button className="acc-back" onClick={() => go('appts')} aria-label="Back">
                      {BACK}
                    </button>
                  ) : null}
                  <span className="acc-tt serif">{TITLES[sec]}</span>
                </>
              ) : null}
            </div>
            <div className="acc-pane-bd" id="acc-pane-bd">
              {/* ---- landing ---- */}
              {sec === 'over' ? (
                <>
                  <div className="acc-hero">
                    <Avatar size={64} fs={20} />
                    <div>
                      <h2 className="serif">{`${profile.first} ${profile.last}`.trim()}</h2>
                      <div className="sm muted">
                        {profile.email}
                        {profile.phone ? ` · ${profile.phone}` : ''}
                      </div>
                      <div style={{ marginTop: '7px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <span className="tiny-tag">
                          {list.filter((a) => bucketOf(a) === 'up').length} upcoming
                        </span>
                        <span className="tiny-tag">{salons.data?.salons.length ?? 0} salons</span>
                      </div>
                    </div>
                  </div>
                  <div className="acc-lbl">Next appointment</div>
                  {list.filter((a) => bucketOf(a) === 'up').length ? (
                    list
                      .filter((a) => bucketOf(a) === 'up')
                      .slice(-1)
                      .map((a) => (
                        <ApptRow key={a.id} a={a} onOpen={() => nav(`/account/appointments/${a.id}`)} />
                      ))
                  ) : (
                    <div className="acc-empty">
                      <b>Nothing booked yet</b>
                      When you book, your appointment appears here.
                      <br />
                      <button className="btn btn-p" onClick={() => nav('/')}>
                        Find a salon
                      </button>
                    </div>
                  )}
                  {salons.data?.salons.length ? (
                    <>
                      <div className="acc-lbl">Your salons</div>
                      <div className="acc-card">
                        {salons.data.salons.map((s) => (
                          <div
                            key={s.name}
                            className="acc-row"
                            style={{ cursor: s.slug ? 'pointer' : 'default' }}
                            onClick={() => s.slug && nav(`/salon/${s.slug}`)}
                          >
                            <div className="bd">
                              <b>{s.name}</b>
                              <div className="sm muted">
                                {s.visits} {s.visits === 1 ? 'visit' : 'visits'} · since {s.since}
                              </div>
                            </div>
                            <span className="muted">›</span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : null}
                </>
              ) : null}

              {/* ---- general ---- */}
              {sec === 'general' ? <General /> : null}

              {/* ---- appointments ---- */}
              {sec === 'appts' ? (
                <>
                  <div className="acc-seg">
                    {(
                      [
                        ['up', 'Upcoming'],
                        ['past', 'Past'],
                        ['canc', 'Cancelled'],
                      ] as const
                    ).map(([id, label]) => (
                      <button key={id} aria-selected={tab === id} onClick={() => setTab(id)}>
                        {label}
                      </button>
                    ))}
                  </div>
                  {appts.isLoading ? null : list.filter((a) => bucketOf(a) === tab).length ? (
                    list
                      .filter((a) => bucketOf(a) === tab)
                      .map((a) => (
                        <ApptRow key={a.id} a={a} onOpen={() => nav(`/account/appointments/${a.id}`)} />
                      ))
                  ) : (
                    <div className="acc-empty">
                      {tab === 'up' ? (
                        <>
                          <b>No upcoming appointments</b>
                          You don’t have any upcoming appointments.
                          <br />
                          <button className="btn btn-p" onClick={() => nav('/')}>
                            Find a salon
                          </button>
                        </>
                      ) : tab === 'past' ? (
                        <>
                          <b>No past appointments</b>
                          Appointments you complete will appear here.
                        </>
                      ) : (
                        <>
                          <b>No cancelled appointments</b>
                          Cancelled appointments will appear here.
                        </>
                      )}
                    </div>
                  )}
                </>
              ) : null}

              {/* ---- one appointment ---- */}
              {sec === 'appt' && current ? (
                <>
                  <div className="acc-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'flex-start' }}>
                      <div>
                        <h3 style={{ fontSize: '19px' }}>{current.serviceName}</h3>
                        <div className="sm muted">
                          {current.salonName} · {current.locationName}
                        </div>
                      </div>
                      <StatusBadge a={current} />
                    </div>
                    <div style={{ height: '10px' }}></div>
                    <div className="acc-kv">
                      <span>Date</span>
                      <b>{current.date}</b>
                    </div>
                    <div className="acc-kv">
                      <span>Time</span>
                      <b>
                        {current.time} – {current.end}
                      </b>
                    </div>
                    <div className="acc-kv">
                      <span>Duration</span>
                      <b>{minutesLbl(current.durationMin)}</b>
                    </div>
                    {current.employeeName ? (
                      <div className="acc-kv">
                        <span>Professional</span>
                        <b>{current.employeeName}</b>
                      </div>
                    ) : null}
                    <div className="acc-kv">
                      <span>Price</span>
                      <b>{fmtMKD(current.price)}</b>
                    </div>
                    <div className="acc-kv">
                      <span>Booking reference</span>
                      <b>{current.ref}</b>
                    </div>
                  </div>
                  {current.locationAddress || current.lat != null ? (
                    <div className="acc-card">
                      <div className="acc-lbl">Where</div>
                      {current.lat != null && current.lng != null ? (
                        <SalonMap
                          pins={[
                            {
                              lat: current.lat,
                              lng: current.lng,
                              label: current.salonName,
                              sub: current.locationAddress ?? '',
                              here: true,
                            },
                          ]}
                          height={170}
                          zoom={16}
                          radius={12}
                          labels={false}
                        />
                      ) : null}
                      <div className="sm" style={{ color: 'var(--ink)', marginTop: '8px' }}>
                        {current.locationAddress}
                      </div>
                    </div>
                  ) : null}
                  {bucketOf(current) === 'up' ? (
                    <>
                      <div className="acc-card">
                        <div className="acc-lbl">Cancellation policy</div>
                        <div className="sm" style={{ color: 'var(--ink)' }}>
                          Free cancellation up to {current.cancelHours} hours before your appointment.
                        </div>
                      </div>
                      {err ? <div className="acc-err">{err}</div> : null}
                      <div style={{ display: 'grid', gap: '10px' }}>
                        {current.salonSlug ? (
                          <button
                            className="btn btn-p"
                            style={{ width: '100%' }}
                            onClick={() => nav(`/salon/${current.salonSlug}`)}
                          >
                            Book again
                          </button>
                        ) : null}
                        <button
                          className="btn btn-g"
                          style={{ width: '100%' }}
                          disabled={busy}
                          onClick={() => void cancel(current.id)}
                        >
                          {busy ? 'Cancelling…' : 'Cancel appointment'}
                        </button>
                      </div>
                    </>
                  ) : current.salonSlug ? (
                    <button
                      className="btn btn-p"
                      style={{ width: '100%' }}
                      onClick={() => nav(`/salon/${current.salonSlug}`)}
                    >
                      Book again
                    </button>
                  ) : null}
                </>
              ) : null}

              {/* ---- favourites ---- */}
              {sec === 'favs' ? <Favourites /> : null}

              {/* ---- notifications ---- */}
              {sec === 'notifs' ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
                    <button className="acc-link" onClick={() => void markRead(null)}>
                      Mark all as read
                    </button>
                  </div>
                  {notifs.data?.notifications.length ? (
                    <div className="acc-card">
                      {notifs.data.notifications.map((n) => (
                        <div
                          key={n.id}
                          className="acc-row"
                          style={{ cursor: 'pointer' }}
                          onClick={() => {
                            void markRead(n.id);
                            if (n.refType === 'appointment' && n.refId)
                              nav(`/account/appointments/${n.refId}`);
                          }}
                        >
                          <span
                            style={{
                              width: '8px',
                              height: '8px',
                              borderRadius: '50%',
                              background: n.read ? 'transparent' : 'var(--brand)',
                              flex: '0 0 auto',
                            }}
                          ></span>
                          <div className="bd">
                            <b style={{ fontWeight: n.read ? 600 : 800 }}>{n.title}</b>
                            <div className="sm muted">{n.body}</div>
                          </div>
                          <span className="muted">›</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="acc-empty">
                      <b>No notifications</b>
                      You’re all caught up.
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </main>
          </div>
        </section>
      </div>
      <div className="only-m">
        <TabBar active="profile" unread={unread} />
      </div>
    </>
  );
}

/** General: what the account actually holds, and the doors that change
 *  it. Email is the sign-in identity and stays read-only. */
/**
 * Favourites — Phase C, docs/FAVOURITES.md.
 *
 * The prototype's markup: a card per kind, a row per thing, a heart that
 * removes it, a way through to book. What the prototype's row carries
 * and this one does not is a star rating — reviews do not exist, so it
 * comes out rather than being invented.
 */
function Favourites() {
  const nav = useNavigate();
  const { data, isLoading, isError, toggle } = useFavourites();

  if (isLoading)
    return <div className="sm muted" style={{ padding: '18px 4px' }}>Loading your favourites…</div>;
  if (isError || !data)
    return (
      <div className="acc-err">
        Could not load your favourites just now. Refresh to try again.
      </div>
    );

  const total = data.salons.length + data.services.length + data.pros.length;
  if (!total)
    return (
      <div className="acc-empty">
        <b>No favourites yet</b>
        Save salons and professionals you love so they&rsquo;re easy to find again.
        <br />
        <button className="btn btn-p" onClick={() => nav('/')}>
          Explore Velnes
        </button>
      </div>
    );

  type Fav = (typeof data.salons)[number];
  const row = (f: Fav, cta: { label: string; go: () => void }) => (
    <div className="acc-row" key={`${f.kind}-${f.id}`}>
      {f.photo ? (
        <div className="ph" style={{ backgroundImage: `url("${f.photo}")` }}></div>
      ) : (
        <span className="avdot" style={{ width: '44px', height: '44px', fontSize: '14px', flex: '0 0 auto' }}>
          {f.name
            .split(' ')
            .map((w: string) => w[0])
            .join('')
            .slice(0, 2)}
        </span>
      )}
      <div className="bd">
        <b>{f.name}</b>
        <div className="sm muted">{f.sub}</div>
      </div>
      <button
        className="acc-link"
        style={{ fontSize: '19px', lineHeight: '1' }}
        aria-label={`Remove ${f.name} from favourites`}
        onClick={() => void toggle(f.kind, f.id)}
      >
        ♥
      </button>
      <button
        className="btn btn-g"
        style={{ minHeight: '36px', padding: '6px 13px', fontSize: '13px' }}
        onClick={cta.go}
      >
        {cta.label}
      </button>
    </div>
  );

  return (
    <>
      {data.salons.length ? (
        <div className="acc-card">
          <div className="acc-lbl">Salons</div>
          {data.salons.map((f) =>
            row(f, { label: 'View salon', go: () => nav(`/salon/${f.salonSlug}`) }),
          )}
        </div>
      ) : null}

      {data.pros.length ? (
        <div className="acc-card">
          <div className="acc-lbl">Professionals</div>
          {data.pros.map((f) =>
            row(f, { label: 'View salon', go: () => nav(`/salon/${f.salonSlug}`) }),
          )}
        </div>
      ) : null}

      {data.services.length ? (
        <div className="acc-card">
          <div className="acc-lbl">Services</div>
          {data.services.map((f) =>
            row(f, {
              label: 'Book',
              // Straight to the salon page with the treatment already in
              // the cart — the link that page has always understood.
              go: () => nav(`/salon/${f.salonSlug}?service=${encodeURIComponent(f.id)}`),
            }),
          )}
        </div>
      ) : null}

      {data.hidden ? (
        <div className="sm muted" style={{ padding: '10px 4px' }}>
          {data.hidden === 1
            ? 'One more is saved but not bookable right now — it will come back here if it returns.'
            : `${data.hidden} more are saved but not bookable right now — they will come back here if they return.`}
        </div>
      ) : null}
    </>
  );
}

function General() {
  const qc = useQueryClient();
  const { profile, api } = useSession();
  const [edit, setEdit] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [d, setD] = useState({
    first: profile?.first ?? '',
    last: profile?.last ?? '',
    phone: profile?.phone ?? '',
    dob: profile?.dob ?? '',
    lang: profile?.lang ?? 'en',
  });
  const [pw, setPw] = useState({ current: '', next: '' });
  const [savingPers, setSavingPers] = useState(false);
  if (!profile) return null;

  /** The personalisation switch saves on the spot — a toggle that needs
   *  an Edit button and a Save button is a toggle nobody trusts. */
  const setPersonalised = async (on: boolean) => {
    setErr('');
    setMsg('');
    setSavingPers(true);
    try {
      await api('/me', { method: 'PATCH', body: JSON.stringify({ personalisedResults: on }) });
      await qc.invalidateQueries({ queryKey: ['me'] });
      // Results are ordered with this, so what is on screen is now stale.
      await qc.invalidateQueries({ queryKey: ['category-services'] });
      setMsg(on ? 'Results will use your bookings.' : 'Results will ignore your bookings.');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not save that — please try again.');
    } finally {
      setSavingPers(false);
    }
  };

  const save = async () => {
    setErr('');
    try {
      await api('/me', {
        method: 'PATCH',
        body: JSON.stringify({
          first: d.first,
          last: d.last,
          phone: d.phone || null,
          dob: d.dob || null,
          lang: d.lang,
        }),
      });
      await qc.invalidateQueries({ queryKey: ['me'] });
      setEdit(false);
      setMsg('Saved.');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not save — please try again.');
    }
  };

  const changePw = async () => {
    setErr('');
    setMsg('');
    try {
      await api('/me/password', { method: 'POST', body: JSON.stringify(pw) });
      setPw({ current: '', next: '' });
      setPwOpen(false);
      setMsg('Password changed.');
      await qc.invalidateQueries({ queryKey: ['my-notifications'] });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not change your password.');
    }
  };

  return (
    <>
      <div className="acc-card">
        <div className="acc-lbl">Account info</div>
        {edit ? (
          <>
            <label className="acc-flbl">First name</label>
            <input className="acc-inp" value={d.first} onChange={(e) => setD({ ...d, first: e.target.value })} />
            <label className="acc-flbl">Last name</label>
            <input className="acc-inp" value={d.last} onChange={(e) => setD({ ...d, last: e.target.value })} />
            <label className="acc-flbl">Phone</label>
            <input className="acc-inp" value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value })} />
            <label className="acc-flbl">Date of birth</label>
            <input
              className="acc-inp"
              type="date"
              value={d.dob}
              onChange={(e) => setD({ ...d, dob: e.target.value })}
            />
            <label className="acc-flbl">Preferred language</label>
            <select
              className="acc-inp"
              value={d.lang}
              onChange={(e) => setD({ ...d, lang: e.target.value as 'en' | 'mk' | 'sq' })}
            >
              <option value="en">English</option>
              <option value="mk">Македонски</option>
              <option value="sq">Shqip</option>
            </select>
            <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
              <button className="btn btn-p" style={{ flex: 1 }} onClick={save}>
                Save
              </button>
              <button className="btn btn-g" style={{ flex: 1 }} onClick={() => setEdit(false)}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="acc-kv">
              <span>Name</span>
              <b>{`${profile.first} ${profile.last}`.trim()}</b>
            </div>
            <div className="acc-kv">
              <span>Phone</span>
              <b>{profile.phone ?? '—'}</b>
            </div>
            <div className="acc-kv">
              <span>Date of birth</span>
              <b>{profile.dob ?? '—'}</b>
            </div>
            <div className="acc-kv">
              <span>Preferred language</span>
              <b>{{ en: 'English', mk: 'Македонски', sq: 'Shqip' }[profile.lang]}</b>
            </div>
            <button className="btn btn-g" style={{ width: '100%', marginTop: '12px' }} onClick={() => setEdit(true)}>
              Edit info
            </button>
          </>
        )}
      </div>

      <div className="acc-card">
        <div className="acc-lbl">Sign-in</div>
        <div className="acc-kv">
          <span>Email</span>
          <b>
            {profile.email} {profile.emailVerified ? <span className="acc-badge ok">Verified</span> : null}
          </b>
        </div>
        <div className="sm muted" style={{ margin: '6px 0 2px' }}>
          Your email is used to sign in and can’t be changed in the app.
        </div>
        {pwOpen ? (
          <>
            <label className="acc-flbl">Current password</label>
            <input
              type="password"
              className="acc-inp"
              value={pw.current}
              onChange={(e) => setPw({ ...pw, current: e.target.value })}
            />
            <label className="acc-flbl">New password</label>
            <input
              type="password"
              className="acc-inp"
              value={pw.next}
              onChange={(e) => setPw({ ...pw, next: e.target.value })}
            />
            <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
              <button className="btn btn-p" style={{ flex: 1 }} onClick={changePw}>
                Change password
              </button>
              <button className="btn btn-g" style={{ flex: 1 }} onClick={() => setPwOpen(false)}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="acc-kv" style={{ marginTop: '14px' }}>
              <span>Password</span>
              <b>••••••••</b>
            </div>
            <button className="btn btn-g" style={{ width: '100%', marginTop: '10px' }} onClick={() => setPwOpen(true)}>
              Change password
            </button>
          </>
        )}
        {err ? <div className="acc-err">{err}</div> : null}
        {msg ? (
          <div className="sm" style={{ color: 'var(--ok)', marginTop: '8px' }}>
            {msg}
          </div>
        ) : null}
      </div>

      <div className="acc-card">
        <div className="acc-lbl">Search results</div>
        <div className="acc-kv" style={{ alignItems: 'flex-start' }}>
          <span style={{ maxWidth: '62%' }}>
            Use my bookings to order results
            <br />
            <span className="sm muted">
              Treatments you have booked before, and the salons you booked them at, come
              first. Only your own bookings are used, and no salon is told about them.
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={profile.personalisedResults}
            aria-label="Use my bookings to order results"
            disabled={savingPers}
            className={`btn ${profile.personalisedResults ? 'btn-p' : 'btn-g'}`}
            style={{ minHeight: '34px', padding: '6px 14px', fontSize: '13px' }}
            onClick={() => setPersonalised(!profile.personalisedResults)}
          >
            {profile.personalisedResults ? 'On' : 'Off'}
          </button>
        </div>
      </div>
    </>
  );
}
