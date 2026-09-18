import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DHeader } from '../../app/chrome.js';
import { categoryVM, fmtMKD, salonVM, type SalonVM } from '../../lib/api/mappers.js';
import { useCategories, useSalons } from '../../lib/api/queries.js';
import { useMyNotifications } from '../../lib/api/session.js';
import { SalonMap } from '../../components/SalonMap.js';
import { IcArr, IcClock, IcPin, IcSpark, IcVok, useSalonLive } from './cards.js';

function useCategoryResults(categorySlug: string | undefined) {
  const catsQ = useCategories();
  const salonsQ = useSalons();
  const cats = useMemo(() => (catsQ.data?.categories ?? []).map(categoryVM), [catsQ.data]);
  const cat = cats.find((c) => c.slug === categorySlug);
  const all = useMemo(() => (salonsQ.data?.salons ?? []).map(salonVM), [salonsQ.data]);
  const matches = cat ? all.filter((s) => s.serviceCategories.includes(cat.name)) : [];
  // Bookable salons lead — the best match must actually answer the doors.
  const rows = [...matches.filter((s) => s.bookable), ...matches.filter((s) => !s.bookable)];
  return { cat, rows, best: rows[0], alts: rows.slice(1), loaded: Boolean(catsQ.data && salonsQ.data) };
}

/** The live line under a result: today's first open slot, from-price. */
function useLiveLine(s: SalonVM) {
  const { svc, slots } = useSalonLive(s.slug);
  return {
    av: slots[0] ? `Available today at ${slots[0]}` : null,
    pr: svc ? fmtMKD(Math.min(svc.price, svc.priceFrom ?? svc.price)) : null,
  };
}

function BestD({ s }: { s: SalonVM }) {
  const nav = useNavigate();
  const { av, pr } = useLiveLine(s);
  return (
    <article className="best">
      <span className="flag" style={{ zIndex: 2 }}>Best match</span>
      <div className="grid">
        <div className="ph" style={{ backgroundImage: s.photo }}></div>
        <div className="bd">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
            <h3>
              {s.name} <span className="vok">{IcVok}</span>
            </h3>
            {av ? <span className="tiny-tag" style={{ background: '#EAF2E4', color: '#3E5A34' }}>Available today</span> : null}
          </div>
          <div className="sm muted">
            {IcPin} {s.city}
          </div>
          {s.pitch ? <p style={{ margin: '2px 0', fontSize: '14px' }}>{s.pitch}</p> : null}
          {av ? <span className="avail">{IcClock} {av}</span> : null}
        </div>
      </div>
      <div className="foot">
        <span className="sm muted">Flexible cancellation up to 2 h before</span>
        {pr ? (
          <span className="price">
            <b>from {pr}</b>
          </span>
        ) : null}
        <button className="btn btn-p" onClick={() => nav(`/salon/${s.slug}`)}>
          Book now {IcArr}
        </button>
      </div>
    </article>
  );
}

function AltD({ s }: { s: SalonVM }) {
  const nav = useNavigate();
  const { av, pr } = useLiveLine(s);
  return (
    <article className="card alt">
      <div className="ph" style={{ backgroundImage: s.photo }}></div>
      <div>
        <h4>
          {s.name} <span className="vok">{IcVok}</span>
        </h4>
        <div className="sm muted">
          {IcPin} {s.city}
        </div>
        {av ? <span className="avail">{IcClock} {av}</span> : null}
      </div>
      <div className="why">{s.pitch}</div>
      <div className="pr">
        {pr ? <b>from {pr}</b> : null}
        <br />
        <button
          className="btn btn-g"
          style={{ minHeight: '38px', padding: '6px 14px', fontSize: '13.5px', marginTop: '6px' }}
          onClick={() => nav(`/salon/${s.slug}`)}
        >
          View &amp; book {IcArr}
        </button>
      </div>
    </article>
  );
}

function BestM({ s }: { s: SalonVM }) {
  const nav = useNavigate();
  const { av, pr } = useLiveLine(s);
  return (
    <article className="m-best">
      <div className="ph" style={{ backgroundImage: s.photo }}>
        <span className="flag">Best match</span>
      </div>
      <div className="bd">
        <h3>
          {s.name} <span className="vok">{IcVok}</span>
        </h3>
        <div className="sm muted">
          {IcPin} {s.city}
        </div>
        {s.pitch ? <div style={{ fontSize: '13.5px' }}>{s.pitch}</div> : null}
        {av ? <span className="avail">{IcClock} {av}</span> : null}
      </div>
      <div className="foot">
        <button className="btn btn-p" style={{ flex: 1 }} onClick={() => nav(`/salon/${s.slug}`)}>
          Book now {IcArr}
        </button>
        {pr ? (
          <span className="pr">
            <b>from {pr}</b>
          </span>
        ) : null}
      </div>
    </article>
  );
}

function AltM({ s }: { s: SalonVM }) {
  const nav = useNavigate();
  const { av, pr } = useLiveLine(s);
  return (
    <article className="card m-alt">
      <div className="ph" style={{ backgroundImage: s.photo }}></div>
      <div>
        <h4>
          {s.name} <span className="vok">{IcVok}</span>
        </h4>
        <div className="sm muted">
          {IcPin} {s.city}
          {av ? (
            <>
              {' · '}
              <span className="avail" style={{ fontSize: '12px' }}>{av}</span>
            </>
          ) : null}
        </div>
        <div className="why">{s.pitch}</div>
        <div className="row">
          <b>{pr ? `from ${pr}` : ''}</b>
          <button
            className="btn btn-g"
            style={{ minHeight: '36px', padding: '5px 13px', fontSize: '13px' }}
            onClick={() => nav(`/salon/${s.slug}`)}
          >
            View &amp; book
          </button>
        </div>
      </div>
    </article>
  );
}

export function Results() {
  const nav = useNavigate();
  const { category } = useParams();
  const unread = useMyNotifications().data?.unread ?? 0;
  const { cat, rows, best, alts, loaded } = useCategoryResults(category);
  const title = cat?.name ?? '';
  // Only salons that actually dropped a pin appear on the map — no
  // guessed coordinates from address text.
  const pins = rows
    .filter((s) => s.lat != null && s.lng != null)
    .map((s, i) => ({
      lat: s.lat!,
      lng: s.lng!,
      label: s.name,
      sub: s.city,
      here: i === 0,
      onClick: () => nav(`/salon/${s.slug}`),
    }));
  return (
    <>
      <div className="d-env">
        <DHeader />
        <section data-screen="results">
          <div className="d-topbar">
            <div className="d-wrap in">
              <div className="pillsearch">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4.2-4.2" /></svg>
                <input value={title} data-res="q" readOnly />
                <button style={{ border: '0', background: 'none', color: 'var(--muted)' }} onClick={() => nav('/')} aria-label="Clear">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
                </button>
              </div>
              <span className="chip">{IcPin}Near me</span>
              <span className="chip">{IcClock}Now</span>
              <span style={{ width: '1px', alignSelf: 'stretch', background: 'var(--line-soft)' }}></span>
              <button className="chip">
                Adjust filters <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 9.5l6 6 6-6" /></svg>
              </button>
            </div>
          </div>
          <div className="d-wrap res-layout">
            <div>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '14px', marginBottom: '12px' }}>
                <div>
                  <div className="spark" style={{ display: 'inline-flex', gap: '8px', alignItems: 'center', fontWeight: '700', color: 'var(--ink)', fontSize: '16px' }}>
                    {IcSpark}Velnes thinks along with you
                  </div>
                  <div className="sm muted" style={{ marginTop: '2px' }}>Only live bookable options – carefully selected for you.</div>
                </div>
              </div>
              <div id="d-reslist">
                {best ? <BestD s={best} /> : loaded ? (
                  <div className="sm muted" style={{ padding: '18px 4px' }}>No salons offer {title} yet — new salons join Velnes every week.</div>
                ) : null}
                {alts.length ? (
                  <>
                    <h2 className="serif" style={{ fontSize: '19px', margin: '22px 0 2px' }}>Smart alternatives</h2>
                    <div className="sm muted" style={{ marginBottom: '12px' }}>Also great options, if you&rsquo;d like something different.</div>
                    {alts.map((s) => (
                      <AltD key={s.slug} s={s} />
                    ))}
                  </>
                ) : null}
              </div>
              <div className="trustband">
                <span className="note">
                  <span style={{ display: 'grid', placeItems: 'center', width: '26px', height: '26px', borderRadius: '50%', background: 'var(--warm)', color: 'var(--ok)' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                  </span>
                  <span>
                    <b style={{ color: 'var(--ink)' }}>Every option is live &amp; bookable</b>
                    <br />No waiting, no requests.
                  </span>
                </span>
                <span className="note">
                  <span className="spark">{IcSpark}</span>
                  <span>
                    <b style={{ color: 'var(--ink)' }}>No perfect match? No problem.</b>
                    <br />Velnes finds smart alternatives that do fit your moment.
                  </span>
                </span>
              </div>
            </div>
            <aside className="res-map">
              {pins.length ? (
                <SalonMap pins={pins} height="100%" radius={0} />
              ) : (
                <>
                  <svg viewBox="0 0 520 760" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', inset: '0', width: '100%', height: '100%' }} aria-hidden="true">
                    <rect width="520" height="760" fill="#F0F3E9" />
                    <path d="M0 210 C130 180 260 240 520 200" fill="none" stroke="#D6E5EC" strokeWidth="30" strokeLinecap="round" />
                    <path d="M340 540 C420 560 480 620 520 700 L520 760 L360 760 Z" fill="#E4EDD6" />
                    <g stroke="#fff" fill="none" strokeLinecap="round">
                      <path d="M70 0 L110 760" strokeWidth="6" />
                      <path d="M0 380 C170 340 350 420 520 380" strokeWidth="6" />
                      <path d="M260 0 C280 250 230 500 300 760" strokeWidth="6" />
                    </g>
                  </svg>
                  <div className="sm muted" style={{ position: 'absolute', inset: 'auto 16px 16px', textAlign: 'center' }}>
                    None of these salons has placed itself on the map yet.
                  </div>
                </>
              )}
            </aside>
          </div>
        </section>
      </div>
      <div className="m-env">
        <section data-screen="results">
          <div className="m-page">
            <div className="m-topbar">
              <div className="searchrow">
                <div className="m-search" style={{ boxShadow: 'none', border: '1px solid var(--line)' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4.2-4.2" /></svg>
                  <input value={title} data-res="q" readOnly />
                  <button style={{ border: '0', background: 'none', color: 'var(--muted)' }} onClick={() => nav('/')}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
                  </button>
                </div>
                <button className="map-btn" aria-label="Map view">
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5z" /><path d="M9 4v13M15 6.5v13" /></svg>
                  Map
                </button>
              </div>
            </div>
            <div className="m-chiprow">
              <span className="chip">{IcPin}Near me</span>
              <span className="chip">{IcClock}Now</span>
              <span className="chip">Filters</span>
            </div>
            <div style={{ padding: '12px 16px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
              <span className="spark" style={{ display: 'inline-flex', gap: '7px', alignItems: 'center', fontWeight: '700', color: 'var(--ink)' }}>
                {IcSpark}Velnes thinks along with you
              </span>
            </div>
            <div id="m-reslist">
              {best ? <BestM s={best} /> : loaded ? (
                <div className="sm muted" style={{ padding: '18px 16px' }}>No salons offer {title} yet — new salons join Velnes every week.</div>
              ) : null}
              {alts.length ? (
                <>
                  <div style={{ padding: '6px 16px 4px' }}>
                    <h2 className="serif" style={{ fontSize: '18px' }}>Smart alternatives</h2>
                    <div className="sm muted">Also great options, if you&rsquo;d like something different.</div>
                  </div>
                  {alts.map((s) => (
                    <AltM key={s.slug} s={s} />
                  ))}
                </>
              ) : null}
            </div>
            <div className="m-band">
              <span className="i">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg> Every option is live &amp; bookable
              </span>
              <span className="i">{IcSpark} No perfect match? Velnes finds alternatives that do fit.</span>
            </div>
            <nav className="tabbar">
              <button className="tab-i" onClick={() => nav('/')}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 11 12 4l8 7v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z" /></svg>Home
              </button>
              <button className="tab-i on">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4.2-4.2" /></svg>Search
              </button>
              <button className="tab-i">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3.5v3M16 3.5v3" /></svg>Bookings
              </button>
              <button className="tab-i">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M12 20s-7.4-4.6-7.4-9.4A4.3 4.3 0 0 1 12 8a4.3 4.3 0 0 1 7.4 2.6C19.4 15.4 12 20 12 20z" /></svg>Favorites
              </button>
              <button className="tab-i">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7.2 7.2 0 0 1 14 0" /></svg>Profile
              </button>
            </nav>
          </div>
        </section>
      </div>
    </>
  );
}
