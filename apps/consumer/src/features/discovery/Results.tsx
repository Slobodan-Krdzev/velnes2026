import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DHeader } from '../../app/chrome.js';
import {
  categoryVM,
  minutesLbl,
  priceLbl,
  serviceVM,
  type ServiceVM,
} from '../../lib/api/mappers.js';
import { useCategories, useRankedCategoryServices, useSearch } from '../../lib/api/queries.js';
import { useMyNotifications, useSession } from '../../lib/api/session.js';
import { distanceKm, distanceLbl, useUserLocation } from '../../lib/geo.js';
import { SalonMap } from '../../components/SalonMap.js';
import { IcArr, IcClock, IcPin, IcSpark, IcVok, useSalonLive } from './cards.js';

/** A salon the text matched by name without earning a direct opening. */
type SalonHit = { id: string; slug: string; name: string; city: string | null };

/**
 * What a category card opens onto: every treatment published in that
 * category, across every listed salon.
 *
 * The URL carries a slugified category name, and the category list the
 * app already holds turns that back into the id the door wants. The
 * order is the server's — bookable first, then cheapest — and nothing
 * here re-sorts it: ranking by where somebody is and what they have
 * booked before is the §5 work, and it will land behind that one door
 * rather than in this component.
 */
function useCategoryResults(categorySlug: string | undefined, query: string | null) {
  const catsQ = useCategories();
  const { token } = useSession();
  const { position } = useUserLocation();
  const cats = useMemo(() => (catsQ.data?.categories ?? []).map(categoryVM), [catsQ.data]);
  const cat = cats.find((c) => c.slug === categorySlug);

  // Two entrances, one room. Only one of these is ever enabled: a
  // category card knows its id, a typed query knows its text, and both
  // end up ranked by the same scorer behind the same admission.
  const byCategory = useRankedCategoryServices(query ? undefined : cat?.id, position, token);
  const byText = useSearch(query, position, token);
  const answered = query ? byText.data : byCategory.data;

  const rows = useMemo(
    () => (answered?.services ?? []).map(serviceVM),
    [answered],
  );
  return {
    cat,
    rows,
    best: rows[0],
    alts: rows.slice(1),
    loaded: query
      ? Boolean(byText.data) || byText.isError
      : Boolean(catsQ.data) && (!cat || Boolean(byCategory.data)),
    /** The slug names nothing browsable: either never a category, or one
     *  no salon publishes in any more, since the shelf now carries only
     *  categories with something behind them. Either way the honest
     *  answer is the same, and it is not "nothing under ''". */
    unknown: !query && Boolean(catsQ.data) && !cat,
    /** Whether the viewer's own bookings shaped this order. Shown, so
     *  the order is never mysterious. */
    personalised: answered?.personalised ?? false,
    /** Which config version produced this order. Development only — it
     *  is how a surprising order gets explained, and it is noise to
     *  everybody else. */
    rankVersion: answered?.rankVersion ?? null,
    /** A salon named outright. The page redirects rather than rendering.
     *  Only a submitted search can produce one. */
    directSalon: query ? (byText.data?.directSalon ?? null) : null,
    /** Salons the text reached but that were not certain enough to open
     *  alone — two sharing a name, or a partial one. Offered rather than
     *  guessed between. */
    salons: query ? (byText.data?.salons ?? []) : [],
    /** Said out loud when the answer had to be broadened to fill a page. */
    widened: query ? (byText.data?.widened ?? null) : null,
    how: query ? (byText.data?.how ?? null) : null,
  };
}

function useLiveLine(s: ServiceVM) {
  const { slots } = useSalonLive(s.salon.slug);
  const { position } = useUserLocation();
  const km =
    position && s.salon.lat != null && s.salon.lng != null
      ? distanceKm(position, { lat: s.salon.lat, lng: s.salon.lng })
      : null;
  return {
    av: slots[0] ? `Available today at ${slots[0]}` : null,
    // The price of this treatment, not the salon's cheapest anything.
    pr: priceLbl(s),
    away: km === null ? null : `${distanceLbl(km)} from you`,
  };
}

/** Where a result card sends you: the salon page, with the treatment
 *  already named so the salon page can open on it. */
function salonHref(s: ServiceVM) {
  return `/salon/${s.salon.slug}?service=${encodeURIComponent(s.id)}`;
}

/** What an empty result page says. A category the shelf no longer
 *  carries is not the same as one nobody has published in yet, and
 *  saying "nothing under Spa-Inclusive" about a slug that names no
 *  category at all would be a small lie. */
function emptyLine(title: string, unknown: boolean, typed: boolean) {
  if (typed) return `Nothing matched “${title}” — try a treatment, a salon, or a category.`;
  return unknown
    ? 'Nothing to browse under that name — try a category from the home page.'
    : `Nothing published under ${title} yet — new salons join Velnes every week.`;
}

/**
 * Said out loud whenever the answer is not literally what was asked
 * for. A page that quietly broadens a search and presents the result as
 * the search is the one dishonest thing this surface must never do — so
 * every broadening the door reports gets a sentence here.
 */
function searchNote(
  how: string | null,
  widened: 'category' | 'radius' | null,
  title: string,
): string | null {
  if (widened === 'radius') return 'Not much within your distance, so we looked further out.';
  if (how === 'fuzzy') return `Nothing is called “${title}” — these are the closest we found.`;
  if (widened === 'category') return `Showing ${title} first, then others like it.`;
  return null;
}

/** Salons the text reached but that were not certain enough to open on
 *  their own — two sharing a name, or half a name typed. Offered rather
 *  than guessed between. */
function SalonHits({ salons, title }: { salons: SalonHit[]; title: string }) {
  return (
    <div style={{ marginBottom: '18px' }}>
      <h2 className="serif" style={{ fontSize: '17px', margin: '0 0 2px' }}>
        {salons.length > 1 ? `Salons called “${title}”` : 'The salon you meant?'}
      </h2>
      <div className="sm muted" style={{ marginBottom: '8px' }}>
        {salons.length > 1
          ? 'More than one carries that name — pick the one you meant.'
          : 'Matched by name.'}
      </div>
      {salons.map((s) => (
        <a
          key={s.id}
          className="sug-card"
          href={`/salon/${s.slug}`}
          style={{ display: 'block', marginBottom: '6px' }}
        >
          <b>{s.name}</b>
          {s.city ? <span className="sm muted">{s.city}</span> : null}
        </a>
      ))}
    </div>
  );
}

/** The line under a result's title: which salon, and how far. */
function whereLine(s: ServiceVM, away: string | null) {
  return `${s.salon.name}${away ?? s.salon.city ? ` · ${away ?? s.salon.city}` : ''}`;
}

function BestD({ s }: { s: ServiceVM }) {
  const nav = useNavigate();
  const { av, pr, away } = useLiveLine(s);
  return (
    <article className="best">
      <span className="flag" style={{ zIndex: 2 }}>Best match</span>
      <div className="grid">
        <div className="ph" style={{ backgroundImage: s.salon.photo }}></div>
        <div className="bd">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
            <h3>{s.name}</h3>
            {av ? <span className="tiny-tag" style={{ background: '#EAF2E4', color: '#3E5A34' }}>Available today</span> : null}
          </div>
          <div className="sm muted">
            {IcPin} {whereLine(s, away)} <span className="vok">{IcVok}</span>
          </div>
          <p style={{ margin: '2px 0', fontSize: '14px' }}>{minutesLbl(s.durationMin)}</p>
          {av ? <span className="avail">{IcClock} {av}</span> : null}
        </div>
      </div>
      <div className="foot">
        <span className="sm muted">Flexible cancellation up to 2 h before</span>
        {pr ? (
          <span className="price">
            <b>{pr}</b>
          </span>
        ) : null}
        <button className="btn btn-p" onClick={() => nav(salonHref(s))}>
          Book now {IcArr}
        </button>
      </div>
    </article>
  );
}

function AltD({ s }: { s: ServiceVM }) {
  const nav = useNavigate();
  const { av, pr, away } = useLiveLine(s);
  return (
    <article className="card alt">
      <div className="ph" style={{ backgroundImage: s.salon.photo }}></div>
      <div>
        <h4>{s.name}</h4>
        <div className="sm muted">
          {IcPin} {whereLine(s, away)} <span className="vok">{IcVok}</span>
        </div>
        {av ? <span className="avail">{IcClock} {av}</span> : null}
      </div>
      <div className="why">{minutesLbl(s.durationMin)}</div>
      <div className="pr">
        {pr ? <b>{pr}</b> : null}
        <br />
        <button
          className="btn btn-g"
          style={{ minHeight: '38px', padding: '6px 14px', fontSize: '13.5px', marginTop: '6px' }}
          onClick={() => nav(salonHref(s))}
        >
          View &amp; book {IcArr}
        </button>
      </div>
    </article>
  );
}

function BestM({ s }: { s: ServiceVM }) {
  const nav = useNavigate();
  const { av, pr, away } = useLiveLine(s);
  return (
    <article className="m-best">
      <div className="ph" style={{ backgroundImage: s.salon.photo }}>
        <span className="flag">Best match</span>
      </div>
      <div className="bd">
        <h3>{s.name}</h3>
        <div className="sm muted">
          {IcPin} {whereLine(s, away)} <span className="vok">{IcVok}</span>
        </div>
        <div style={{ fontSize: '13.5px' }}>{minutesLbl(s.durationMin)}</div>
        {av ? <span className="avail">{IcClock} {av}</span> : null}
      </div>
      <div className="foot">
        <button className="btn btn-p" style={{ flex: 1 }} onClick={() => nav(salonHref(s))}>
          Book now {IcArr}
        </button>
        {pr ? (
          <span className="pr">
            <b>{pr}</b>
          </span>
        ) : null}
      </div>
    </article>
  );
}

function AltM({ s }: { s: ServiceVM }) {
  const nav = useNavigate();
  const { av, pr, away } = useLiveLine(s);
  return (
    <article className="card m-alt">
      <div className="ph" style={{ backgroundImage: s.salon.photo }}></div>
      <div>
        <h4>{s.name}</h4>
        <div className="sm muted">
          {IcPin} {whereLine(s, away)}
          {av ? (
            <>
              {' · '}
              <span className="avail" style={{ fontSize: '12px' }}>{av}</span>
            </>
          ) : null}
        </div>
        <div className="why">{minutesLbl(s.durationMin)}</div>
        <div className="row">
          <b>{pr ?? ''}</b>
          <button
            className="btn btn-g"
            style={{ minHeight: '36px', padding: '5px 13px', fontSize: '13px' }}
            onClick={() => nav(salonHref(s))}
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
  const geo = useUserLocation();
  const [mapOpen, setMapOpen] = useState(false);
  const [params] = useSearchParams();
  const query = params.get('q');
  const {
    cat, rows, best, alts, loaded, unknown, personalised, rankVersion,
    directSalon, salons, widened, how,
  } = useCategoryResults(category, query);

  /**
   * The text named one salon and nothing else. Go there, replacing this
   * entry so the back button returns to where the search was typed
   * rather than to a results page nobody saw.
   */
  useEffect(() => {
    if (directSalon?.slug) nav(`/salon/${directSalon.slug}`, { replace: true });
  }, [directSalon, nav]);
  const title = query ?? cat?.name ?? category ?? '';
  // Only a typed query can have been broadened; a category card asked
  // for exactly what it got.
  const note = query ? searchNote(how, widened, title) : null;
  // One pin per salon, not one per treatment: a salon offering four
  // services in this category is still one place on the map. Only
  // salons that really dropped a pin appear — no coordinates guessed
  // from address text.
  const pins = useMemo(() => {
    const seen = new Set<string>();
    return rows
      .filter((s) => {
        if (s.salon.lat == null || s.salon.lng == null) return false;
        if (seen.has(s.salon.slug)) return false;
        seen.add(s.salon.slug);
        return true;
      })
      .map((s, i) => ({
        lat: s.salon.lat!,
        lng: s.salon.lng!,
        label: s.salon.name,
        sub: s.salon.city,
        here: i === 0,
        onClick: () => nav(`/salon/${s.salon.slug}`),
      }));
  }, [rows, nav]);
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
              <button
                className={`chip${geo.status === 'on' ? ' on' : ''}`}
                onClick={geo.status === 'on' ? geo.disable : geo.enable}
                title={
                  geo.status === 'on'
                    ? 'Following your location — click to stop'
                    : 'Centre the map on you'
                }
              >
                {IcPin}
                {geo.status === 'asking' ? 'Locating…' : 'Near me'}
              </button>
              <span className="chip">{IcClock}Now</span>
              <span style={{ width: '1px', alignSelf: 'stretch', background: 'var(--line-soft)' }}></span>
              <button className="chip">
                Adjust filters <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 9.5l6 6 6-6" /></svg>
              </button>
            </div>
          </div>
          <div className="d-wrap res-layout">
            <div>
              {/* Claiming an order when nothing was ordered — a page
                  showing only a salon we matched by name — is a small
                  boast about work that did not happen. */}
              {rows.length ? (
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '14px', marginBottom: '12px' }}>
                <div>
                  <div className="spark" style={{ display: 'inline-flex', gap: '8px', alignItems: 'center', fontWeight: '700', color: 'var(--ink)', fontSize: '16px' }}>
                    {IcSpark}Velnes thinks along with you
                  </div>
                  <div className="sm muted" style={{ marginTop: '2px' }}>
                    {personalised
                      ? 'Ordered using your own bookings and where you are — you can turn this off in My Velnes.'
                      : geo.status === 'on'
                        ? 'Ordered by how near they are, and what they cost.'
                        : 'Ordered by what they cost, and how soon you can book.'}
                    {import.meta.env.DEV && rankVersion ? (
                      <span style={{ opacity: 0.6 }}> · ranking v{rankVersion}</span>
                    ) : null}
                  </div>
                </div>
              </div>
              ) : null}
              <div id="d-reslist">
                {salons.length ? <SalonHits salons={salons} title={title} /> : null}
                {note ? (
                  <div className="sm muted" style={{ margin: '0 0 12px' }}>{note}</div>
                ) : null}
                {/* "Nothing matched" would be a lie when the salon block
                    above is standing there having matched. */}
                {best ? <BestD s={best} /> : loaded && !salons.length ? (
                  <div className="sm muted" style={{ padding: '18px 4px' }}>{emptyLine(title, unknown, Boolean(query))}</div>
                ) : null}
                {alts.length ? (
                  <>
                    <h2 className="serif" style={{ fontSize: '19px', margin: '22px 0 2px' }}>Smart alternatives</h2>
                    <div className="sm muted" style={{ marginBottom: '12px' }}>Also great options, if you&rsquo;d like something different.</div>
                    {alts.map((s) => (
                      <AltD key={s.id} s={s} />
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
              <SalonMap
                pins={pins}
                you={geo.position}
                center={geo.position}
                zoom={13}
                height="100%"
                radius={0}
                emptyNote={
                  pins.length
                    ? undefined
                    : loaded
                      ? 'No salon here has placed itself on the map yet.'
                      : undefined
                }
              />
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
                <button className="map-btn" aria-label="Map view" onClick={() => setMapOpen(true)}>
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5z" /><path d="M9 4v13M15 6.5v13" /></svg>
                  Map
                </button>
              </div>
            </div>
            <div className="m-chiprow">
              <button
                className={`chip${geo.status === 'on' ? ' on' : ''}`}
                onClick={geo.status === 'on' ? geo.disable : geo.enable}
                title={
                  geo.status === 'on'
                    ? 'Following your location — click to stop'
                    : 'Centre the map on you'
                }
              >
                {IcPin}
                {geo.status === 'asking' ? 'Locating…' : 'Near me'}
              </button>
              <span className="chip">{IcClock}Now</span>
              <span className="chip">Filters</span>
            </div>
            {rows.length ? (
              <div style={{ padding: '12px 16px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                <span className="spark" style={{ display: 'inline-flex', gap: '7px', alignItems: 'center', fontWeight: '700', color: 'var(--ink)' }}>
                  {IcSpark}Velnes thinks along with you
                </span>
              </div>
            ) : null}
            <div id="m-reslist">
              {salons.length ? (
                <div style={{ padding: '10px 16px 0' }}>
                  <SalonHits salons={salons} title={title} />
                </div>
              ) : null}
              {note ? (
                <div className="sm muted" style={{ padding: '4px 16px 10px' }}>{note}</div>
              ) : null}
              {best ? <BestM s={best} /> : loaded && !salons.length ? (
                <div className="sm muted" style={{ padding: '18px 16px' }}>{emptyLine(title, unknown, Boolean(query))}</div>
              ) : null}
              {alts.length ? (
                <>
                  <div style={{ padding: '6px 16px 4px' }}>
                    <h2 className="serif" style={{ fontSize: '18px' }}>Smart alternatives</h2>
                    <div className="sm muted">Also great options, if you&rsquo;d like something different.</div>
                  </div>
                  {alts.map((s) => (
                    <AltM key={s.id} s={s} />
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
            {mapOpen ? (
              <div className="mapsheet open" style={{ display: 'flex', flexDirection: 'column' }}>
                <div className="ms-head">
                  <h2 className="serif">
                    {pins.length} {pins.length === 1 ? 'place' : 'places'} near you
                  </h2>
                  <button className="iconb" onClick={() => setMapOpen(false)} aria-label="Close">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
                  </button>
                </div>
                <div style={{ flex: 1, minHeight: 0 }}>
                  <SalonMap
                    pins={pins}
                    you={geo.position}
                    center={geo.position}
                    zoom={13}
                    height="100%"
                    radius={0}
                  />
                </div>
              </div>
            ) : null}
            <nav className="tabbar">
              <button className="tab-i" onClick={() => nav('/')}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 11 12 4l8 7v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z" /></svg>Home
              </button>
              <button className="tab-i on">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4.2-4.2" /></svg>Search
              </button>
              <button className="tab-i" onClick={() => nav('/account/appts')}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3.5v3M16 3.5v3" /></svg>Bookings
              </button>
              <button className="tab-i">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M12 20s-7.4-4.6-7.4-9.4A4.3 4.3 0 0 1 12 8a4.3 4.3 0 0 1 7.4 2.6C19.4 15.4 12 20 12 20z" /></svg>Favorites
              </button>
              <button className="tab-i" onClick={() => nav('/account')}>
                <span className="vnav-ic">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7.2 7.2 0 0 1 14 0" /></svg>
                  <span className="acc-bdg" hidden={unread === 0}>{unread}</span>
                </span>
                Profile
              </button>
            </nav>
          </div>
        </section>
      </div>
    </>
  );
}
