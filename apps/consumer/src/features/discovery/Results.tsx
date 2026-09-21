import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DHeader } from '../../app/chrome.js';
import {
  categoryVM,
  fmtMKD,
  type CategoryVM,
  minutesLbl,
  priceLbl,
  serviceVM,
  type ServiceVM,
} from '../../lib/api/mappers.js';
import {
  useCategories,
  useMostChosen,
  useRankedCategoryServices,
  useSearch,
  type SearchFilters,
} from '../../lib/api/queries.js';
import type { SearchFacets } from '@velnes/contracts';
import { useMyNotifications, useSession } from '../../lib/api/session.js';
import { distanceKm, distanceLbl, useUserLocation } from '../../lib/geo.js';
import { GeoNotice } from '../../components/GeoNotice.js';
import { SalonMap } from '../../components/SalonMap.js';
import {
  CatCard,
  IcArr,
  IcClock,
  IcMark,
  IcPin,
  IcSpark,
  IcVok,
  SugListM,
  SugPanelD,
  useSalonLive,
} from './cards.js';
import { useSearchBox } from './useSearchBox.js';
import { TabBar } from '../../app/TabBar.js';

/** What "near me" means, in kilometres. The distance chips can widen
 *  or narrow it afterwards; this is where the button starts. */
const NEAR_KM = 10;

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
function useCategoryResults(
  categorySlug: string | undefined,
  query: string | null,
  filters: SearchFilters,
) {
  const catsQ = useCategories();
  const { token } = useSession();
  const { position } = useUserLocation();
  const cats = useMemo(() => (catsQ.data?.categories ?? []).map(categoryVM), [catsQ.data]);
  const cat = cats.find((c) => c.slug === categorySlug);

  // Two entrances, one room. Only one of these is ever enabled: a
  // category card knows its id, a typed query knows its text, and both
  // end up ranked by the same scorer behind the same admission.
  const byCategory = useRankedCategoryServices(
    query ? undefined : cat?.id,
    position,
    token,
    filters,
  );
  const byText = useSearch(query, position, token, filters);
  const answered = query ? byText.data : byCategory.data;

  const rows = useMemo(
    () => (answered?.services ?? []).map(serviceVM),
    [answered],
  );
  return {
    cat,
    /** Every category on offer, for the landing screen below. */
    cats,
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
    /** What could be narrowed, described before anything was — so a
     *  choice can always be undone without reloading a different page. */
    facets: answered?.facets ?? { categories: [], price: null },
    /** Treatments a price band removed for publishing no price at all.
     *  Said out loud: a salon that hides its prices disappearing from a
     *  price filter looks like a missing salon. */
    hiddenUnpriced: answered?.hiddenUnpriced ?? 0,
    /** Said out loud when the answer had to be broadened to fill a page. */
    widened: query ? (byText.data?.widened ?? null) : (byCategory.data?.widened ?? null),
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

/**
 * What a price filter did to salons that publish no prices.
 *
 * They cannot be in any band, so they are gone — and a salon
 * disappearing from a list looks like a missing salon unless the page
 * says which of its own controls removed it.
 */
function unpricedNote(n: number): string | null {
  if (!n) return null;
  return n === 1
    ? 'One treatment is hidden while a price filter is on, because its salon does not publish prices.'
    : `${n} treatments are hidden while a price filter is on, because their salons do not publish prices.`;
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

/**
 * The filter bar — step 8 of docs/SEARCH.md.
 *
 * Every control here is a *server-side admission*: choosing one asks
 * the door a narrower question and the door answers it. Nothing is
 * re-sorted or hidden on this side, because the order is the product
 * and a page that quietly re-filters it is showing an answer nobody can
 * explain afterwards.
 *
 * A control appears only when it can do something. Bands the door was
 * unable to compute honestly, and a category list with one entry in it,
 * are absent rather than inert — leaving a dead control on the page is
 * the same failure as a fake availability badge.
 *
 * Deliberately missing, and staying missing until the data behind them
 * is real: **Now** (needs live availability) and any rating filter
 * (needs reviews).
 */
function FilterBar({
  facets,
  filters,
  set,
  canDistance,
}: {
  facets: SearchFacets;
  filters: SearchFilters;
  set: (patch: Partial<SearchFilters>) => void;
  canDistance: boolean;
}) {
  const bands = facets.price;
  const cats = facets.categories;
  if (!bands && !cats.length && !canDistance) return null;
  return (
    <div className="filterbar">
      {cats.length ? (
        <div className="chips">
          <Pick on={!filters.categoryId} set={() => set({ categoryId: null })}>
            All
          </Pick>
          {cats.map((c) => (
            <Pick
              key={c.id}
              on={filters.categoryId === c.id}
              set={() => set({ categoryId: c.id })}
            >
              {c.name} <span className="muted">{c.count}</span>
            </Pick>
          ))}
        </div>
      ) : null}
      {bands ? (
        <div className="chips">
          <Pick on={!filters.priceBand} set={() => set({ priceBand: null })}>
            Any price
          </Pick>
          <Pick on={filters.priceBand === 'low'} set={() => set({ priceBand: 'low' })}>
            Up to {fmtMKD(bands.lowMax)}
          </Pick>
          <Pick on={filters.priceBand === 'mid'} set={() => set({ priceBand: 'mid' })}>
            {fmtMKD(bands.lowMax)}&ndash;{fmtMKD(bands.midMax)}
          </Pick>
          <Pick on={filters.priceBand === 'high'} set={() => set({ priceBand: 'high' })}>
            Over {fmtMKD(bands.midMax)}
          </Pick>
        </div>
      ) : null}
      {/* A distance only means something once somebody has said where
          they are, so it appears with their location and not before. */}
      {canDistance ? (
        <div className="chips">
          <Pick on={!filters.radiusKm} set={() => set({ radiusKm: null })}>
            Any distance
          </Pick>
          {[2, 5, 10].map((km) => (
            <Pick key={km} on={filters.radiusKm === km} set={() => set({ radiusKm: km })}>
              Within {km} km
            </Pick>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Pick({
  on,
  set,
  children,
}: {
  on: boolean;
  set: () => void;
  children: React.ReactNode;
}) {
  return (
    <button className={`chip${on ? ' on' : ''}`} onClick={set} aria-pressed={on}>
      {children}
    </button>
  );
}

/**
 * What the search screen shows before anything has been asked.
 *
 * Tapping Search used to open whichever category sorted first, so the
 * phone ran a search nobody typed. This is the honest alternative: the
 * field is up there waiting, and underneath is everything there is to
 * browse — ordered by what the platform actually books most, which is
 * the same aggregate the suggestion panel uses and the only ordering
 * here that is not arbitrary.
 */
function SearchLanding({ cats }: { cats: CategoryVM[] }) {
  if (!cats.length) return null;
  return (
    <>
      <h2 className="serif" style={{ fontSize: '19px', margin: '0 0 2px' }}>
        Browse treatments
      </h2>
      <div className="sm muted" style={{ marginBottom: '14px' }}>
        Or type what you are after — a treatment, a salon, or the thing you
        would call it.
      </div>
      <div className="catgrid">
        {cats.map((c) => (
          <CatCard key={c.id} c={c} />
        ))}
      </div>
    </>
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
  const { signedIn } = useSession();
  const [mapOpen, setMapOpen] = useState(false);
  /** The mobile search sheet, which is where typing happens on a phone. */
  const [sheet, setSheet] = useState(false);
  const sheetInput = useRef<HTMLInputElement>(null);
  const [params, setParams] = useSearchParams();
  const query = params.get('q');

  /**
   * Filters live in the URL, so a narrowed answer is the thing that
   * gets shared and the back button undoes one choice at a time. The
   * viewer's position deliberately stays out of it — §9 — so `km` here
   * is only a preference, and means nothing until they say where they
   * are.
   */
  const filters = useMemo<SearchFilters>(() => {
    const band = params.get('price');
    const km = Number(params.get('km'));
    return {
      priceBand: band === 'low' || band === 'mid' || band === 'high' ? band : null,
      categoryId: params.get('cat'),
      radiusKm: Number.isFinite(km) && km > 0 ? km : null,
    };
  }, [params]);
  const setFilters = useCallback(
    (patch: Partial<SearchFilters>) => {
      const next = new URLSearchParams(params);
      const put = (k: string, v: string | number | null) => {
        if (v === null) next.delete(k);
        else next.set(k, String(v));
      };
      if ('priceBand' in patch) put('price', patch.priceBand ?? null);
      if ('categoryId' in patch) put('cat', patch.categoryId ?? null);
      if ('radiusKm' in patch) put('km', patch.radiusKm ?? null);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const {
    cat, cats, rows, best, alts, loaded, unknown, personalised, rankVersion,
    directSalon, salons, widened, how, facets, hiddenUnpriced,
  } = useCategoryResults(category, query, filters);

  /**
   * Nothing has been asked yet — this is the search screen itself
   * rather than an answer to anything, so it offers what there is to
   * browse instead of reporting an empty result.
   */
  const landing = !query && !category;
  const chosen = useMostChosen().data?.categories ?? [];
  const browse = useMemo(() => {
    if (!landing) return [];
    const order = new Map(chosen.map((c, i) => [c.id, i]));
    // Most booked first, then the rest in the taxonomy's own order —
    // and every category the shelf carries is here, so the screen is a
    // way in rather than a shortlist.
    return [...cats].sort(
      (a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999),
    );
  }, [landing, cats, chosen]);

  /**
   * The text named one salon and nothing else. Go there, replacing this
   * entry so the back button returns to where the search was typed
   * rather than to a results page nobody saw.
   */
  useEffect(() => {
    if (directSalon?.slug) nav(`/salon/${directSalon.slug}`, { replace: true });
  }, [directSalon, nav]);
  const title = query ?? cat?.name ?? category ?? '';

  /**
   * The results page carries the same search bar the home page does,
   * and it is a real one: the box shows what was asked, and asking
   * something else from here does not mean going home first.
   *
   * Seeded from the URL, and re-seeded whenever the URL changes under
   * it — but never while somebody is mid-edit, which is why this
   * watches the derived title rather than the input.
   */
  const box = useSearchBox(() => setSheet(false));
  const seeded = useRef<string | null>(null);
  const setBoxQ = box.setQ;
  useEffect(() => {
    if (seeded.current === title) return;
    seeded.current = title;
    setBoxQ(title);
  }, [title, setBoxQ]);

  /**
   * The sheet is always mounted and merely hidden, so `autoFocus` never
   * fires — it only applies when an element first mounts. Without this
   * the sheet opens onto a keyboard with nowhere to type.
   */
  useEffect(() => {
    if (!sheet) return;
    const el = sheetInput.current;
    el?.focus();
    el?.select();
  }, [sheet]);
  // Only a typed query can have been broadened; a category card asked
  // for exactly what it got.
  /**
   * "Near me" turns the location on **and** limits the answer to 10km.
   *
   * It used to only start the geolocation, which centred the map and
   * let distance into the ordering — but every result stayed, however
   * far away. A button called "near me" that leaves a salon 800km up
   * the list is answering a different question from the one it asks.
   *
   * The distance chips still widen or narrow it afterwards; this is the
   * shortcut, not the only way to set a radius. Turning it off clears
   * both, since a radius with no location is a filter that cannot run.
   */
  /**
   * The radius is only ever written once there is a location for it to
   * apply to. Writing `km=10` on the click and taking it back when the
   * browser said no looked like the button breaking — the URL flashed
   * and went blank — when what had happened was a refusal. The intent
   * is held here until the position arrives, and dropped if it never
   * does.
   */
  const [wantNear, setWantNear] = useState(false);
  const radius = filters.radiusKm;
  /** Lit means "filtering near you", not merely "location is on". */
  const nearOn = geo.status === 'on' && radius != null;
  /**
   * The button is disabled only when the *person* turned location off
   * (or the device has none to give). A browser-level block does not
   * disable it: the block can be lifted in the browser at any moment,
   * and the next click is how the app finds out — a disabled button
   * would have needed a reload to notice. Alex, 2026-09-21.
   */
  const nearBlocked = geo.decision === 'refused' || geo.status === 'unsupported';
  const toggleNear = useCallback(() => {
    if (nearOn) {
      setWantNear(false);
      geo.disable();
      setFilters({ radiusKm: null });
      return;
    }
    if (nearBlocked) return;
    setWantNear(true);
    if (geo.status === 'on') setFilters({ radiusKm: NEAR_KM });
    // Never asked yet — this click is the question. Otherwise: a fresh
    // fix, since the decision is already yes.
    else if (geo.decision === null) geo.decide(true);
    else geo.locate();
  }, [nearOn, nearBlocked, geo, setFilters]);

  useEffect(() => {
    if (!wantNear) return;
    if (geo.status === 'on') {
      if (radius == null) setFilters({ radiusKm: NEAR_KM });
      setWantNear(false);
    } else if (geo.status !== 'asking') {
      // Denied, unavailable, unsupported: the wish cannot be granted.
      setWantNear(false);
    }
  }, [wantNear, geo.status, radius, setFilters]);

  /**
   * A radius already in the URL — a shared link, a back button — that
   * the location can never honour is dropped, so no chip claims a
   * filter that is not running. Only on a definite no: `off` is also
   * the state before the answer, and clearing on it was the flicker.
   */
  useEffect(() => {
    const dead =
      geo.decision === 'refused' ||
      geo.status === 'denied' ||
      geo.status === 'unavailable' ||
      geo.status === 'unsupported';
    if (radius != null && dead) setFilters({ radiusKm: null });
  }, [radius, geo.decision, geo.status, setFilters]);

  /** Why "Near me" did nothing. It is the one control here that can
   *  fail for reasons outside the app, so it has to explain itself
   *  rather than just sitting there unlit. */
  const geoNote =
    geo.status === 'denied'
      ? 'Location is blocked for this site in your browser — allow it in the address-bar site settings, then press “Near me” again.'
      : geo.decision === 'refused'
        ? `Enable the button for better results — ${signedIn ? 'turn location on under My Velnes › General, or' : 'turn location on'}`
        : geo.status === 'unsupported'
          ? 'This browser cannot share a location, so “Near me” has nothing to go on.'
          : geo.status === 'unavailable'
            ? 'Your device could not work out where you are just now. Try again in a moment.'
            : null;
  const nearLabel = geo.status === 'asking' ? 'Locating…' : 'Near me';
  /**
   * The way back after a refusal, right where the sentence is. The
   * home page asks its question once and never again, so "turn it on
   * in the prompt" would point at a door that no longer exists; this
   * link is that door. Signed in, the My Velnes switch is the other.
   */
  const geoAction =
    geo.decision === 'refused' && geo.status !== 'denied' ? (
      <button
        type="button"
        onClick={() => {
          setWantNear(true);
          geo.decide(true);
        }}
        style={{
          background: 'none',
          border: 0,
          padding: 0,
          font: 'inherit',
          fontWeight: 600,
          color: 'inherit',
          textDecoration: 'underline',
          textUnderlineOffset: '3px',
          cursor: 'pointer',
        }}
      >
        {signedIn ? 'turn it on here' : 'here'}
      </button>
    ) : null;

  const note = query ? searchNote(how, widened, title) : searchNote(null, widened, title);
  const unpriced = unpricedNote(hiddenUnpriced);
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
        // The card the pin opens. Everything on it is something the
        // platform actually knows — the salon's own photograph, whether
        // it can be booked, and what this treatment costs there. No
        // rating: there are no reviews yet, and a star nobody earned is
        // worse than no star at all.
        photo: s.salon.hasPhoto ? s.salon.photo : null,
        badge: s.salon.bookable ? 'Instant booking' : null,
        price: priceLbl(s),
        href: `/salon/${s.salon.slug}`,
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
              {box.open ? <div className="sug-scrim" aria-hidden="true" /> : null}
              <div className={`pillsearch-wrap${box.open ? ' open' : ''}`} ref={box.boxRef}>
                <div className="pillsearch">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4.2-4.2" /></svg>
                  <input data-res="q" placeholder="What are you looking for?" aria-label="Search" aria-controls="d-sugg" {...box.inputProps} />
                  <button
                    style={{ border: '0', background: 'none', color: 'var(--muted)' }}
                    onClick={() => nav('/')}
                    aria-label="Clear"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
                  </button>
                </div>
                {box.open ? (
                  <SugPanelD
                    q={box.q}
                    active={box.keys.active}
                    onChoose={box.choose}
                    onOpenCategory={box.openCat}
                  />
                ) : null}
              </div>
              <button
                className={`chip${nearOn ? ' on' : ''}`}
                onClick={toggleNear}
                disabled={nearBlocked}
                aria-pressed={nearOn}
                title={
                  geoNote ??
                  (nearOn
                    ? `Within ${NEAR_KM} km of you — click to stop`
                    : `Show only what is within ${NEAR_KM} km of you`)
                }
              >
                {IcPin}
                {nearLabel}
              </button>
            </div>
            {geoNote ? (
              <div className="d-wrap">
                <GeoNotice action={geoAction}>{geoNote}</GeoNotice>
              </div>
            ) : null}
          </div>
          <div className={`d-wrap res-layout${landing ? ' solo' : ''}`}>
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
              {landing ? <SearchLanding cats={browse} /> : null}
              {landing ? null : (
                <FilterBar
                  facets={facets}
                  filters={filters}
                  set={setFilters}
                  canDistance={geo.status === 'on'}
                />
              )}
              <div id="d-reslist" hidden={landing}>
                {salons.length ? <SalonHits salons={salons} title={title} /> : null}
                {note ? (
                  <div className="sm muted" style={{ margin: '0 0 12px' }}>{note}</div>
                ) : null}
                {unpriced ? (
                  <div className="sm muted" style={{ margin: '0 0 12px' }}>{unpriced}</div>
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
            <aside className="res-map" hidden={landing}>
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
                {/* The phone's results screen has no header of its own, so
                    the mark sits here and doubles as the way home. */}
                <button className="m-mark" onClick={() => nav('/')} aria-label="Velnes home">
                  {IcMark}
                </button>
                {/* On a phone the bar opens the full-screen sheet, exactly
                    as it does on the home page — typing into a 40px strip
                    under a sticky header is not the same feature. */}
                <div
                  className="m-search"
                  style={{ boxShadow: 'none', border: '1px solid var(--line)' }}
                  onClick={() => setSheet(true)}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4.2-4.2" /></svg>
                  <input value={title} placeholder="What are you looking for?" data-res="q" readOnly aria-label="Search" />
                  <button
                    style={{ border: '0', background: 'none', color: 'var(--muted)' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      nav('/');
                    }}
                    aria-label="Clear"
                  >
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
                className={`chip${nearOn ? ' on' : ''}`}
                onClick={toggleNear}
                disabled={nearBlocked}
                aria-pressed={nearOn}
                title={
                  geoNote ??
                  (nearOn
                    ? `Within ${NEAR_KM} km of you — click to stop`
                    : `Show only what is within ${NEAR_KM} km of you`)
                }
              >
                {IcPin}
                {nearLabel}
              </button>

            </div>
            {rows.length ? (
              <div style={{ padding: '12px 16px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                <span className="spark" style={{ display: 'inline-flex', gap: '7px', alignItems: 'center', fontWeight: '700', color: 'var(--ink)' }}>
                  {IcSpark}Velnes thinks along with you
                </span>
              </div>
            ) : null}
            {landing ? (
              <div style={{ padding: '10px 16px 0' }}>
                <SearchLanding cats={browse} />
              </div>
            ) : (
              <div style={{ padding: '10px 16px 0' }}>
                <FilterBar
                  facets={facets}
                  filters={filters}
                  set={setFilters}
                  canDistance={geo.status === 'on'}
                />
              </div>
            )}
            {geoNote ? (
              <div style={{ padding: '4px 16px 10px' }}>
                <GeoNotice action={geoAction}>{geoNote}</GeoNotice>
              </div>
            ) : null}
            <div id="m-reslist" hidden={landing}>
              {salons.length ? (
                <div style={{ padding: '10px 16px 0' }}>
                  <SalonHits salons={salons} title={title} />
                </div>
              ) : null}
              {note ? (
                <div className="sm muted" style={{ padding: '4px 16px 10px' }}>{note}</div>
              ) : null}
              {unpriced ? (
                <div className="sm muted" style={{ padding: '4px 16px 10px' }}>{unpriced}</div>
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
            <TabBar active="search" unread={unread} />

            {/* The same sheet the home page opens, and the same one
                search behind it. A results page nobody can search from
                is a dead end with a search bar drawn on it. */}
            <div className={sheet ? 'm-sheet open' : 'm-sheet'}>
              <div className="top">
                <div className="m-search">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4.2-4.2" /></svg>
                  <input
                    ref={sheetInput}
                    placeholder="What are you looking for?"
                    aria-label="Search"
                    {...box.inputProps}
                  />
                </div>
                <button className="iconb" onClick={() => setSheet(false)} aria-label="Close">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
                </button>
              </div>
              <div className="list">
                <SugListM
                  q={box.q}
                  active={box.keys.active}
                  onChoose={box.choose}
                  onOpenCategory={box.openCat}
                />
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
