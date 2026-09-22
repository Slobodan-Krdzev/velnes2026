import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { t } from '../../lib/i18n-core.js';
import { LangMenu } from '../../app/LangMenu.js';
import { useLang } from '../../lib/i18n.js';
import { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DHeader } from '../../app/chrome.js';
import type { z } from 'zod';
import type { ClientAppointmentSchema } from '@velnes/contracts';
import { SalonMap } from '../../components/SalonMap.js';
import { useWheelScroll } from '../../lib/useWheelScroll.js';
import { useUserLocation } from '../../lib/geo.js';
import { ApiError } from '../../lib/api/client.js';
import { fmtMKD, minutesLbl } from '../../lib/api/mappers.js';
import {
  useFavourites,
  useMyAppointments,
  useMyNotifications,
  useMyOffers,
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

// Functions, not constants: the labels must follow a language switch,
// and a module-level `t()` would have run once, at load.
const secs = () => [
  { id: 'general' as const, t: t('c.acc.general'), sub: t('c.acc.generalSub') },
  { id: 'appts' as const, t: t('c.acc.appts'), sub: t('c.acc.apptsSub') },
  // Third, where the prototype puts it.
  { id: 'favs' as const, t: t('c.acc.favs'), sub: t('c.acc.favsSub') },
  { id: 'cards' as const, t: t('c.acc.cards'), sub: t('c.acc.cardsSub') },
  { id: 'notifs' as const, t: t('c.acc.notifs'), sub: '' },
];
type SecId = 'general' | 'appts' | 'favs' | 'notifs' | 'cards' | 'over' | 'appt';

const titles = (): Record<string, string> => ({
  over: t('c.acc.title'),
  general: t('c.acc.general'),
  appts: t('c.acc.appts'),
  appt: 'Appointment',
  favs: t('c.acc.favs'),
  cards: t('c.acc.cards'),
  notifs: t('c.acc.notifs'),
});

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
  if (b === 'canc') return <span className="acc-badge off">{t('c.acc.cancelled')}</span>;
  if (a.status === 'requested' && b === 'up') return <span className="acc-badge warn">{t('c.acc.awaiting')}</span>;
  if (b === 'past') return <span className="acc-badge mut">{t('c.acc.completed')}</span>;
  return <span className="acc-badge ok">{t('c.acc.confirmed')}</span>;
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
  useTranslation();
  const { lang, label } = useLang();
  const offers = useMyOffers();
  const langLabel = label[lang];
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
              <b>{t('c.acc.signIn')}</b>{t('c.acc.signInSub')}<br />
              <button className="btn btn-p" onClick={() => nav('/login')}>{t('c.acc.login')}</button>
              </div>
            </div>
          </section>
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
      setErr(e instanceof ApiError ? e.message : t('c.acc.cancelFailed'));
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
                aria-label={t('c.acc.notifs')}
              >
                {BELL}
                <span className="acc-bdg" hidden={unread === 0}>
                  {unread}
                </span>
              </button>
            </div>
            <div className="acc-chips" ref={chipsRef}>
              {secs().map((s) => (
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
              >{t('c.acc.logout')}</button>
            </div>
            <nav className="acc-menu">
              {secs().map((s) => (
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
              {/* The language lives on the profile page (Alex, 2026-09-22):
                  a row like the sections, with the pill on the right. */}
              <div className="acc-lang">
                <span>
                  {t('c.lang')}
                  <span className="sub">{langLabel}</span>
                </span>
                <LangMenu inline />
              </div>
              <button
                onClick={() => {
                  signOut();
                  nav('/');
                }}
                style={{ color: 'var(--muted)' }}
              >
                <span>{t('c.acc.logout')}</span>
              </button>
            </nav>
          </aside>

          <main className="acc-pane">
            <div className="acc-pane-top" id="acc-pane-top">
              {sec !== 'over' ? (
                <>
                  {parent ? (
                    <button className="acc-back" onClick={() => go('appts')} aria-label={t('c.acc.back')}>
                      {BACK}
                    </button>
                  ) : null}
                  <span className="acc-tt serif">{titles()[sec]}</span>
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
                          {t('c.acc.upcomingN', { n: list.filter((a) => bucketOf(a) === 'up').length })}
                        </span>
                        <span className="tiny-tag">{(salons.data?.salons.length ?? 0) === 1 ? t('c.cards.salonOne', { n: 1 }) : t('c.cards.salonMany', { n: salons.data?.salons.length ?? 0 })}</span>
                      </div>
                    </div>
                  </div>
                  <div className="acc-lbl">{t('c.acc.nextAppt')}</div>
                  {list.filter((a) => bucketOf(a) === 'up').length ? (
                    list
                      .filter((a) => bucketOf(a) === 'up')
                      .slice(-1)
                      .map((a) => (
                        <ApptRow key={a.id} a={a} onOpen={() => nav(`/account/appointments/${a.id}`)} />
                      ))
                  ) : (
                    <div className="acc-empty">
                      <b>{t('c.acc.nothingBooked')}</b>{t('c.acc.nothingBookedSub')}<br />
                      <button className="btn btn-p" onClick={() => nav('/')}>{t('c.acc.findSalon')}</button>
                    </div>
                  )}
                  {/* What salons promised this person, and nobody else: the
                      live personal offers, soonest to expire first. Absent
                      when there are none — a heading over nothing is noise. */}
                  {offers.data?.offers.length ? (
                    <>
                      <div className="acc-lbl">{t('c.acc.offers')}</div>
                      <div className="sm muted" style={{ margin: '-6px 0 10px' }}>{t('c.acc.offersSub')}</div>
                      {offers.data.offers.map((o) => (
                        <div key={o.id} className="acc-card acc-offer">
                          <div className="acc-kv" style={{ alignItems: 'flex-start', gap: '12px' }}>
                            <span style={{ minWidth: 0 }}>
                              <b>
                                {o.serviceName}
                                {o.variantLabel ? ` · ${o.variantLabel}` : ''}
                              </b>
                              <br />
                              <span className="sm muted">
                                {t('c.acc.offerAt', { salon: o.salon.name, loc: o.locationName })}
                                {' · '}
                                {t('c.acc.offerValid', { d: o.validUntil })}
                              </span>
                              {o.intent ? <div className="sm" style={{ marginTop: '4px' }}>{o.intent}</div> : null}
                            </span>
                            <span style={{ textAlign: 'right', flex: '0 0 auto' }}>
                              <span className="sm muted">{t('c.acc.yourPrice')}</span>
                              <br />
                              <b style={{ fontSize: '16px' }}>{fmtMKD(o.specialPrice)}</b>
                              {o.normalPrice > o.specialPrice ? (
                                <>
                                  <br />
                                  <span className="sm muted" style={{ textDecoration: 'line-through' }}>
                                    {fmtMKD(o.normalPrice)}
                                  </span>
                                </>
                              ) : null}
                            </span>
                          </div>
                          {o.salon.slug ? (
                            <button
                              className="btn btn-p"
                              style={{ marginTop: '10px', minHeight: '38px', padding: '6px 14px', fontSize: '13px' }}
                              onClick={() => nav(`/salon/${o.salon.slug}?service=${encodeURIComponent(o.serviceId)}&location=${encodeURIComponent(o.locationId)}`)}
                            >
                              {t('c.acc.offerBook')}
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </>
                  ) : null}
                  {/* The phone never shows the sidebar's language row, so the
                      same three chips live here; desktop hides this block. */}
                  <div className="acc-lbl acc-lang-m">{t('c.lang')}</div>
                  <div className="acc-card acc-lang-m">
                    <div className="acc-kv" style={{ flexWrap: 'wrap', gap: '10px' }}>
                      <span>{langLabel}</span>
                      <LangMenu inline />
                    </div>
                  </div>
                  {salons.data?.salons.length ? (
                    <>
                      <div className="acc-lbl">{t('c.acc.yourSalons')}</div>
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

              {/* ---- payment methods ---- */}
              {sec === 'cards' ? <Cards /> : null}

              {/* ---- appointments ---- */}
              {sec === 'appts' ? (
                <>
                  <div className="acc-seg">
                    {(
                      [
                        ['up', t('c.acc.upcoming')],
                        ['past', t('c.acc.past')],
                        ['canc', t('c.acc.cancelled')],
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
                          <b>{t('c.acc.noUpcoming')}</b>{t('c.acc.noUpcomingSub')}<br />
                          <button className="btn btn-p" onClick={() => nav('/')}>{t('c.acc.findSalon')}</button>
                        </>
                      ) : tab === 'past' ? (
                        <>
                          <b>{t('c.acc.noPast')}</b>{t('c.acc.noPastSub')}</>
                      ) : (
                        <>
                          <b>{t('c.acc.noCancelled')}</b>{t('c.acc.noCancelledSub')}</>
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
                      {current.status === 'requested' && bucketOf(current) === 'up' ? (
                        <div className="muted" style={{ fontSize: 13, marginTop: 6, flexBasis: '100%' }}>{t('c.acc.awaitingSub')}</div>
                      ) : null}
                    </div>
                    <div style={{ height: '10px' }}></div>
                    <div className="acc-kv">
                      <span>{t('c.acc.date')}</span>
                      <b>{current.date}</b>
                    </div>
                    <div className="acc-kv">
                      <span>{t('c.acc.time')}</span>
                      <b>
                        {current.time} – {current.end}
                      </b>
                    </div>
                    <div className="acc-kv">
                      <span>{t('c.acc.duration')}</span>
                      <b>{minutesLbl(current.durationMin)}</b>
                    </div>
                    {current.employeeName ? (
                      <div className="acc-kv">
                        <span>{t('c.acc.professional')}</span>
                        <b>{current.employeeName}</b>
                      </div>
                    ) : null}
                    <div className="acc-kv">
                      <span>{t('c.acc.price')}</span>
                      <b>{fmtMKD(current.price)}</b>
                    </div>
                    <div className="acc-kv">
                      <span>{t('c.acc.reference')}</span>
                      <b>{current.ref}</b>
                    </div>
                  </div>
                  {current.locationAddress || current.lat != null ? (
                    <div className="acc-card">
                      <div className="acc-lbl">{t('c.acc.where')}</div>
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
                        <div className="acc-lbl">{t('c.acc.policy')}</div>
                        <div className="sm" style={{ color: 'var(--ink)' }}>
                          Free cancellation up to {current.cancelHours} hours before your appointment.
                        </div>
                      </div>
                      {err ? <div className="acc-err">{err}</div> : null}
                      <div style={{ display: 'grid', gap: '10px' }}>
                        {current.status === 'booked' && !current.paid ? (
                          <>
                            <button className="btn btn-p" style={{ width: '100%' }} onClick={() => nav(`/pay/${current.id}`)}>
                              {t('c.acc.payNow', { amount: fmtMKD(current.price) })}
                            </button>
                            <div className="muted" style={{ fontSize: 13, marginTop: -4 }}>{t('c.acc.payNote')}</div>
                          </>
                        ) : null}
                        {current.paid ? <div className="acc-badge ok" style={{ justifySelf: 'start' }}>{t('c.acc.paidOnline')}</div> : null}
                        {current.salonSlug ? (
                          <button
                            className="btn btn-p"
                            style={{ width: '100%' }}
                            onClick={() => nav(`/salon/${current.salonSlug}`)}
                          >{t('c.acc.bookAgain')}</button>
                        ) : null}
                        <button
                          className="btn btn-g"
                          style={{ width: '100%' }}
                          disabled={busy}
                          onClick={() => void cancel(current.id)}
                        >
                          {busy ? 'Cancelling…' : t('c.acc.cancelAppt')}
                        </button>
                      </div>
                    </>
                  ) : current.salonSlug ? (
                    <button
                      className="btn btn-p"
                      style={{ width: '100%' }}
                      onClick={() => nav(`/salon/${current.salonSlug}`)}
                    >{t('c.acc.bookAgain')}</button>
                  ) : null}
                </>
              ) : null}

              {/* ---- favourites ---- */}
              {sec === 'favs' ? <Favourites /> : null}

              {/* ---- notifications ---- */}
              {sec === 'notifs' ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
                    <button className="acc-link" onClick={() => void markRead(null)}>{t('c.acc.markRead')}</button>
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
                      <b>{t('c.acc.noNotifs')}</b>{t('c.acc.noNotifsSub')}</div>
                  )}
                </>
              ) : null}
            </div>
          </main>
          </div>
        </section>
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
    return <div className="sm muted" style={{ padding: '18px 4px' }}>{t('c.acc.favsLoading')}</div>;
  if (isError || !data)
    return (
      <div className="acc-err">{t('c.acc.favsError')}</div>
    );

  const total = data.salons.length + data.services.length + data.pros.length;
  if (!total)
    return (
      <div className="acc-empty">
        <b>{t('c.acc.noFavs')}</b>
        {t('c.acc.noFavsSub')}
        <br />
        <button className="btn btn-p" onClick={() => nav('/')}>{t('c.acc.explore')}</button>
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
        aria-label={t('c.fav.remove', { name: f.name })}
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
          <div className="acc-lbl">{t('c.acc.salons')}</div>
          {data.salons.map((f) =>
            row(f, { label: t('c.acc.viewSalon'), go: () => nav(`/salon/${f.salonSlug}`) }),
          )}
        </div>
      ) : null}

      {data.pros.length ? (
        <div className="acc-card">
          <div className="acc-lbl">{t('c.acc.pros')}</div>
          {data.pros.map((f) =>
            row(f, { label: t('c.acc.viewSalon'), go: () => nav(`/salon/${f.salonSlug}`) }),
          )}
        </div>
      ) : null}

      {data.services.length ? (
        <div className="acc-card">
          <div className="acc-lbl">{t('c.acc.services')}</div>
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
            ? t('c.acc.hiddenOne')
            : t('c.acc.hiddenMany', { n: data.hidden })}
        </div>
      ) : null}
    </>
  );
}

/** Payment methods: the cards the account kept at checkout. Listing
 *  and forgetting live here; adding is "save this card" while paying. */
function Cards() {
  const { api } = useSession();
  const qc = useQueryClient();
  const cards = useQuery({
    queryKey: ['my-cards'],
    queryFn: () => api<{ cards: { id: string; brand: string; last4: string; expMonth: number; expYear: number; holder: string }[] }>('/me/cards'),
  });
  const [busy, setBusy] = useState<string | null>(null);
  const forget = async (id: string) => {
    setBusy(id);
    try {
      await api(`/me/cards/${id}`, { method: 'DELETE' });
      await qc.invalidateQueries({ queryKey: ['my-cards'] });
    } finally {
      setBusy(null);
    }
  };
  const list = cards.data?.cards ?? [];
  return (
    <div className="acc-card">
      <div className="acc-lbl">{t('c.acc.cards')}</div>
      <div className="muted" style={{ fontSize: 13.5, marginBottom: 14 }}>{t('c.acc.cardsNote')}</div>
      {cards.isLoading ? null : list.length === 0 ? (
        <div className="acc-empty">{t('c.acc.noCards')}</div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {list.map((c) => (
            <div className="acc-row" key={c.id} style={{ alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700 }}>{c.brand} ••{c.last4}</div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {String(c.expMonth).padStart(2, '0')}/{String(c.expYear).slice(-2)}
                  {c.holder ? ` · ${c.holder}` : ''}
                </div>
              </div>
              <button type="button" className="acc-link" disabled={busy === c.id} onClick={() => void forget(c.id)}>
                {t('c.acc.forgetCard')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function General() {
  const qc = useQueryClient();
  const { profile, api } = useSession();
  const geo = useUserLocation();
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
      setMsg(on ? t('c.acc.persOn') : t('c.acc.persOff'));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t('c.acc.saveFailed'));
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
      setErr(e instanceof ApiError ? e.message : t('c.acc.saveFailed2'));
    }
  };

  const changePw = async () => {
    setErr('');
    setMsg('');
    try {
      await api('/me/password', { method: 'POST', body: JSON.stringify(pw) });
      setPw({ current: '', next: '' });
      setPwOpen(false);
      setMsg(t('c.acc.pwChanged'));
      await qc.invalidateQueries({ queryKey: ['my-notifications'] });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t('c.acc.pwFailed'));
    }
  };

  return (
    <>
      <div className="acc-card">
        <div className="acc-lbl">{t('c.acc.info')}</div>
        {edit ? (
          <>
            <label className="acc-flbl">{t('c.acc.first')}</label>
            <input className="acc-inp" value={d.first} onChange={(e) => setD({ ...d, first: e.target.value })} />
            <label className="acc-flbl">{t('c.acc.last')}</label>
            <input className="acc-inp" value={d.last} onChange={(e) => setD({ ...d, last: e.target.value })} />
            <label className="acc-flbl">{t('c.acc.phone')}</label>
            <input className="acc-inp" value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value })} />
            <label className="acc-flbl">{t('c.acc.dob')}</label>
            <input
              className="acc-inp"
              type="date"
              value={d.dob}
              onChange={(e) => setD({ ...d, dob: e.target.value })}
            />
            <label className="acc-flbl">{t('c.acc.lang')}</label>
            <select
              className="acc-inp"
              value={d.lang}
              onChange={(e) => setD({ ...d, lang: e.target.value as 'en' | 'mk' | 'sq' })}
            >
              <option value="en">{t('lang.en')}</option>
              <option value="mk">{t('lang.mk')}</option>
              <option value="sq">{t('lang.sq')}</option>
            </select>
            <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
              <button className="btn btn-p" style={{ flex: 1 }} onClick={save}>{t('c.acc.save')}</button>
              <button className="btn btn-g" style={{ flex: 1 }} onClick={() => setEdit(false)}>{t('c.acc.cancel')}</button>
            </div>
          </>
        ) : (
          <>
            <div className="acc-kv">
              <span>{t('c.acc.name')}</span>
              <b>{`${profile.first} ${profile.last}`.trim()}</b>
            </div>
            <div className="acc-kv">
              <span>{t('c.acc.phone')}</span>
              <b>{profile.phone ?? '—'}</b>
            </div>
            <div className="acc-kv">
              <span>{t('c.acc.dob')}</span>
              <b>{profile.dob ?? '—'}</b>
            </div>
            <div className="acc-kv">
              <span>{t('c.acc.lang')}</span>
              <b>{{ en: 'English', mk: 'Македонски', sq: 'Shqip' }[profile.lang]}</b>
            </div>
            <button className="btn btn-g" style={{ width: '100%', marginTop: '12px' }} onClick={() => setEdit(true)}>{t('c.acc.edit')}</button>
          </>
        )}
      </div>

      <div className="acc-card">
        <div className="acc-lbl">{t('c.acc.signin')}</div>
        <div className="acc-kv">
          <span>{t('c.acc.email')}</span>
          <b>
            {profile.email} {profile.emailVerified ? <span className="acc-badge ok">{t('c.acc.verified')}</span> : null}
          </b>
        </div>
        <div className="sm muted" style={{ margin: '6px 0 2px' }}>{t('c.acc.emailNote')}</div>
        {pwOpen ? (
          <>
            <label className="acc-flbl">{t('c.acc.curPw')}</label>
            <input
              type="password"
              className="acc-inp"
              value={pw.current}
              onChange={(e) => setPw({ ...pw, current: e.target.value })}
            />
            <label className="acc-flbl">{t('c.acc.newPw')}</label>
            <input
              type="password"
              className="acc-inp"
              value={pw.next}
              onChange={(e) => setPw({ ...pw, next: e.target.value })}
            />
            <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
              <button className="btn btn-p" style={{ flex: 1 }} onClick={changePw}>{t('c.acc.changePw')}</button>
              <button className="btn btn-g" style={{ flex: 1 }} onClick={() => setPwOpen(false)}>{t('c.acc.cancel')}</button>
            </div>
          </>
        ) : (
          <>
            <div className="acc-kv" style={{ marginTop: '14px' }}>
              <span>{t('c.acc.password')}</span>
              <b>••••••••</b>
            </div>
            <button className="btn btn-g" style={{ width: '100%', marginTop: '10px' }} onClick={() => setPwOpen(true)}>{t('c.acc.changePw')}</button>
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
        <div className="acc-lbl">{t('c.acc.results')}</div>
        <div className="acc-kv" style={{ alignItems: 'flex-start' }}>
          <span style={{ maxWidth: '62%' }}>
            {t('c.acc.useBookings')}
            <br />
            <span className="sm muted">
              {t('c.acc.useBookingsSub')}
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={profile.personalisedResults}
            aria-label={t('c.acc.useBookings')}
            disabled={savingPers}
            className={`btn ${profile.personalisedResults ? 'btn-p' : 'btn-g'}`}
            style={{ minHeight: '34px', padding: '6px 14px', fontSize: '13px' }}
            onClick={() => setPersonalised(!profile.personalisedResults)}
          >
            {profile.personalisedResults ? t('c.acc.on') : t('c.acc.off')}
          </button>
        </div>
      </div>

      {/* The one place a refusal can be reversed in-app. "Near me"
          points here when it is disabled, so this must exist for the
          sentence there to be true. What is saved is the answer — the
          provider PATCHes it — never a position. */}
      <div className="acc-card">
        <div className="acc-lbl">{t('c.acc.location')}</div>
        <div className="acc-kv" style={{ alignItems: 'flex-start' }}>
          <span style={{ maxWidth: '62%' }}>
            {t('c.acc.useLocation')}
            <br />
            <span className="sm muted">
              {geo.status === 'denied'
                ? t('c.acc.locBlocked')
                : t('c.acc.locNote')}
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={geo.decision === 'allowed'}
            aria-label={t('c.acc.useLocationAria')}
            disabled={geo.status === 'unsupported'}
            className={`btn ${geo.decision === 'allowed' ? 'btn-p' : 'btn-g'}`}
            style={{ minHeight: '34px', padding: '6px 14px', fontSize: '13px' }}
            onClick={() => geo.decide(geo.decision !== 'allowed')}
          >
            {geo.decision === 'allowed' ? t('c.acc.on') : t('c.acc.off')}
          </button>
        </div>
      </div>
    </>
  );
}
