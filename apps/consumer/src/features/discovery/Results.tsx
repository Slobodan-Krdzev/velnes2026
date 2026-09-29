import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { categoryVM, type CategoryVM, minutesLbl, priceLbl, serviceVM, type ServiceVM } from '../../lib/api/mappers.js';
import {
  useCategories,
  useMostChosen,
  useRankedCategoryServices,
  useSearch,
  type SearchFilters,
} from '../../lib/api/queries.js';

import { useSession } from '../../lib/api/session.js';
import { distanceKm, distanceLbl, useUserLocation } from '../../lib/geo.js';
import { GeoNotice } from '../../components/GeoNotice.js';
import { useTranslation } from 'react-i18next';
import { t } from '../../lib/i18n-core.js';
import { SalonMap } from '../../components/SalonMap.js';
import {
  CatCard,
  IcArr,
  IcClock,
  IcMark,
  IcBolt,
  IcPin,
  IcSpark,
  IcVok,
  SugPanelD,
} from './cards.js';
import { useSearchBox } from './useSearchBox.js';
import { useSearchSheet } from './SearchSheet.js';
import { FiltersSheet } from './FiltersSheet.js';
import { MapResults, type MapResult } from './MapResults.js';
import { AmenityKeySchema } from '@velnes/contracts';

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
export function useCategoryResults(
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
    facets: answered?.facets ?? { categories: [], price: null, prices: [], amenities: [] },
    /** Treatments a price band removed for publishing no price at all.
     *  Said out loud: a salon that hides its prices disappearing from a
     *  price filter looks like a missing salon. */
    hiddenUnpriced: answered?.hiddenUnpriced ?? 0,
    /** Said out loud when the answer had to be broadened to fill a page. */
    widened: query ? (byText.data?.widened ?? null) : (byCategory.data?.widened ?? null),
    /** Whether the door was asked for *now* (flag, or the word in the
     *  query), and how many results can start within the half hour. */
    nowRequested: answered?.nowRequested ?? false,
    availableNow: answered?.availableNow ?? 0,
    how: query ? (byText.data?.how ?? null) : null,
  };
}

/**
 * The line under a result. The availability on it is the door's own
 * `availableAt` — a start within the next half hour, from the same gate
 * the booking goes through — and only when *now* was asked. The earlier
 * "Available today at …" came from `useSalonLive`, which reads the
 * salon's *first* treatment, not the one on the card; a true-looking
 * line about the wrong treatment is exactly the claim SEARCH.md §14
 * deferred.
 */
function useLiveLine(s: ServiceVM) {
  const { position } = useUserLocation();
  const km =
    position && s.salon.lat != null && s.salon.lng != null
      ? distanceKm(position, { lat: s.salon.lat, lng: s.salon.lng })
      : null;
  return {
    av: s.availableAt ? t('c.availNow', { t: s.availableAt }) : null,
    // The price of this treatment, not the salon's cheapest anything.
    pr: priceLbl(s),
    away: km === null ? null : t('c.res.fromYou', { d: distanceLbl(km) }),
  };
}

/** Where a result card sends you: the salon page, with the treatment
 *  already named so the salon page can open on it. */
function salonHref(s: ServiceVM) {
  return `/salon/${s.salon.slug}?service=${encodeURIComponent(s.id)}`;
}

/**
 * While the door is answering: the shape of the answer, greyed, so the
 * page does not sit blank (Alex, 2026-09-28). Three cards — the best
 * match and two alternatives — in the layout's own proportions.
 */
function Skeleton({ phone = false }: { phone?: boolean }) {
  return (
    <div className={`skel${phone ? ' skel-m' : ''}`} role="status" aria-live="polite" aria-label={t('c.res.loading')}>
      {[0, 1, 2].map((i) => (
        <div key={i} className={`skel-card${i === 0 ? ' best' : ''}`}>
          <div className="skel-ph" />
          <div className="skel-bd">
            <div className="skel-line w60" />
            <div className="skel-line w40" />
            <div className="skel-line w80" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** What an empty result page says. A category the shelf no longer
 *  carries is not the same as one nobody has published in yet, and
 *  saying "nothing under Spa-Inclusive" about a slug that names no
 *  category at all would be a small lie. */
function emptyLine(
  title: string,
  unknown: boolean,
  typed: boolean,
  narrowed: { km: number | null; city: string | null },
) {
  // A filter that emptied the page is the reason, and is named — "nothing
  // published" about a category three salons publish in, 40 km away,
  // was a lie the radius told (Alex, 2026-09-28).
  if (narrowed.km) return t('c.res.emptyRadius', { q: title, km: narrowed.km });
  if (narrowed.city) return t('c.res.emptyCity', { q: title, city: narrowed.city });
  if (typed) return t('c.res.emptyTyped', { q: title });
  return unknown ? t('c.res.emptyUnknown') : t('c.res.emptyCategory', { q: title });
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
  km: number | null,
): string | null {
  // Near me changed the answer: say how far the person asked for, so
  // "showing what is further out" is a fact and not a shrug.
  if (widened === 'radius') return km ? t('c.res.widenedRadiusKm', { km }) : t('c.res.widenedRadius');
  if (how === 'fuzzy') return t('c.res.fuzzy', { q: title });
  if (widened === 'category') return t('c.res.widenedCategory', { q: title });
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
  return n === 1 ? t('c.res.unpricedOne') : t('c.res.unpricedMany', { n });
}

/** Salons the text reached but that were not certain enough to open on
 *  their own — two sharing a name, or half a name typed. Offered rather
 *  than guessed between. */
function SalonHits({ salons, title }: { salons: SalonHit[]; title: string }) {
  return (
    <div style={{ marginBottom: '18px' }}>
      <h2 className="serif" style={{ fontSize: '17px', margin: '0 0 2px' }}>
        {salons.length > 1 ? t('c.res.salonsCalled', { q: title }) : t('c.res.salonMeant')}
      </h2>
      <div className="sm muted" style={{ marginBottom: '8px' }}>
        {salons.length > 1 ? t('c.res.salonsPick') : t('c.res.matchedByName')}
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

/** "Show N results": the same hook the page uses, asked with the
 *  drawer's draft — a real number, or nothing while it is being counted. */
function LiveCount({ category, query, draft }: { category: string | undefined; query: string | null; draft: SearchFilters }) {
  const { rows, loaded } = useCategoryResults(category, query, draft);
  return <>{loaded ? t('c.filt.showN', { n: rows.length }) : t('c.res.showResults')}</>;
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
        {t('c.res.browse')}
      </h2>
      <div className="sm muted" style={{ marginBottom: '14px' }}>
        {t('c.res.browseSub')}
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

function BestD({ s, on = false, onSelect }: { s: ServiceVM; on?: boolean; onSelect?: (() => void) | undefined }) {
  const nav = useNavigate();
  const { av, pr, away } = useLiveLine(s);
  return (
    <article className={`best${on ? ' on' : ''}`} data-salon={s.salon.slug} onMouseEnter={onSelect} onClick={onSelect}>
      <span className="flag" style={{ zIndex: 2 }}>{t('c.res.bestMatch')}</span>
      <div className="grid">
        <div className="ph" style={{ backgroundImage: s.salon.photo }}></div>
        <div className="bd">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
            <h3>{s.name}</h3>
            {av ? <span className="tiny-tag" style={{ background: '#EAF2E4', color: '#3E5A34' }}>{t('c.now')}</span> : null}
          </div>
          <div className="sm muted">
            {IcPin} {whereLine(s, away)} <span className="vok">{IcVok}</span>
          </div>
          <p style={{ margin: '2px 0', fontSize: '14px' }}>{minutesLbl(s.durationMin)}</p>
          {av ? <span className="avail">{IcClock} {av}</span> : null}
        </div>
      </div>
      <div className="foot">
        <span className="sm muted">{t('c.res.cancel2h')}</span>
        {pr ? (
          <span className="price">
            <b>{pr}</b>
          </span>
        ) : null}
        <button className="btn btn-p" onClick={() => nav(salonHref(s))}>
          {t('c.res.bookNow')} {IcArr}
        </button>
      </div>
    </article>
  );
}

function AltD({ s, on = false, onSelect }: { s: ServiceVM; on?: boolean; onSelect?: (() => void) | undefined }) {
  const nav = useNavigate();
  const { av, pr, away } = useLiveLine(s);
  return (
    <article className={`card alt${on ? ' on' : ''}`} data-salon={s.salon.slug} onMouseEnter={onSelect} onClick={onSelect}>
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
          {t('c.res.viewBook')} {IcArr}
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
        <span className="flag">{t('c.res.bestMatch')}</span>
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
          {t('c.res.bookNow')} {IcArr}
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
            {t('c.res.viewBook')}
          </button>
        </div>
      </div>
    </article>
  );
}

export function Results() {
  // Subscribes the page to the language; everything below re-renders
  // on a switch and reads the module-level `t`.
  useTranslation();
  const nav = useNavigate();
  const { category } = useParams();
  const geo = useUserLocation();
  const { signedIn } = useSession();
  const [mapOpen, setMapOpen] = useState(false);
  /**
   * The phone searches and filters in one place: the search sheet
   * (SearchSheet.tsx, Alex 2026-09-28), which the pill opens over this
   * page with the current answer's price bands. The dropdown of filter
   * chips that used to hang from the pill, and the suggestions-only
   * sheet before it, are gone — one form, applied on Search.
   */
  const sheet = useSearchSheet();
  /** The phone's filters panel — price range, when, amenities — over the
   *  current answer; applied together on "Show results" (Alex, 2026-09-29). */
  const [filtersOpen, setFiltersOpen] = useState(false);
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
      now: params.get('now') === '1',
      city: params.get('city'),
      priceMin: Number.isFinite(Number(params.get('pmin'))) && params.get('pmin') ? Math.max(0, Math.round(Number(params.get('pmin')))) : null,
      priceMax: Number.isFinite(Number(params.get('pmax'))) && params.get('pmax') ? Math.max(0, Math.round(Number(params.get('pmax')))) : null,
      // Keys only — anything else in the URL is not an amenity.
      amenities: (params.get('am') ?? '')
        .split(',')
        .map((k) => AmenityKeySchema.safeParse(k))
        .flatMap((r) => (r.success ? [r.data] : [])),
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
      if ('now' in patch) put('now', patch.now ? 1 : null);
      if ('city' in patch) put('city', patch.city ?? null);
      if ('priceMin' in patch) put('pmin', patch.priceMin ?? null);
      if ('priceMax' in patch) put('pmax', patch.priceMax ?? null);
      if ('amenities' in patch) put('am', patch.amenities?.length ? patch.amenities.join(',') : null);
      // `near` is an intent, never a filter (see below): any write of
      // the real filters consumes it.
      next.delete('near');
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const {
    cat, cats, rows, best, alts, loaded, unknown, personalised, nowRequested, availableNow,
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
  const box = useSearchBox();
  const seeded = useRef<string | null>(null);
  const setBoxQ = box.setQ;
  useEffect(() => {
    if (seeded.current === title) return;
    seeded.current = title;
    setBoxQ(title);
  }, [title, setBoxQ]);

  // Arrived asking for the search box (a `focusSearch` stamp in the
  // route state): the desktop top bar's field gets the focus. The phone
  // has no field to focus — its Search tab opens the sheet instead.
  const routeLoc = useLocation();
  const asked = (routeLoc.state as { focusSearch?: number } | null)?.focusSearch;
  useEffect(() => {
    if (!asked || window.innerWidth < 900) return;
    const el = document.querySelector<HTMLInputElement>('.d-topbar input[data-res="q"]');
    el?.focus();
    el?.select();
  }, [asked]);
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
  /**
   * A radius in the URL with permission already given: take a fix on
   * entry. Otherwise a shared or reloaded `?km=10` counts as a filter
   * on the button yet reaches the door without a position, and does
   * nothing — the phantom the earlier fix was about, from the other
   * side.
   */
  useEffect(() => {
    if (radius != null && geo.decision === 'allowed' && geo.status === 'off') geo.locate();
    // Entry only, like the home page.
  }, []);
  /**
   * How many secondary refinements are on, for the Filters button. What,
   * Where and When — the query, Near me, Available now — are the search
   * itself and never count; the distance counts only once it differs
   * from what Near me set (Alex, 2026-09-29).
   */
  const nFilt =
    (filters.categoryId ? 1 : 0) +
    (filters.priceBand || filters.priceMin != null || filters.priceMax != null ? 1 : 0) +
    filters.amenities.length +
    (filters.radiusKm != null && filters.radiusKm !== NEAR_KM ? 1 : 0);
  /**
   * The desktop's one selection, shared by the cards and the map's
   * markers — the salon's slug, which is what a pin is. A hovered or
   * clicked card selects; a tapped marker selects and scrolls its first
   * card into view.
   */
  const [selectedSalon, setSelectedSalon] = useState<string | null>(null);
  const selectFromMap = useCallback((slug: string) => {
    setSelectedSalon(slug);
    document.querySelector<HTMLElement>(`#d-reslist [data-salon="${CSS.escape(slug)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, []);
  /** Filters on desktop and phone alike: one panel, two presentations. */
  const filtersPanel = filtersOpen ? (
    <FiltersSheet
      facets={facets}
      filters={filters}
      canDistance={geo.status === 'on'}
      nearOn={geo.status === 'on' && filters.radiusKm != null}
      onClose={() => setFiltersOpen(false)}
      onApply={(patch) => {
        setFilters(patch);
        setFiltersOpen(false);
      }}
      count={(draft) => <LiveCount category={category} query={query} draft={draft} />}
    />
  ) : null;
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
  /** The "yes" half of the button: a radius once there is a position
   *  for it, the question first if it was never asked, nothing at all
   *  when the person said no. */
  const askNear = useCallback(() => {
    if (nearBlocked) return;
    setWantNear(true);
    // A distance already chosen (the sheet's 2 / 5 / 10 km) is kept.
    if (geo.status === 'on') {
      if (radius == null) setFilters({ radiusKm: NEAR_KM });
    }
    // Never asked yet — this click is the question. Otherwise: a fresh
    // fix, since the decision is already yes.
    else if (geo.decision === null) geo.decide(true);
    else geo.locate();
  }, [nearBlocked, geo, radius, setFilters]);
  const toggleNear = useCallback(() => {
    if (nearOn) {
      setWantNear(false);
      geo.disable();
      setFilters({ radiusKm: null });
      return;
    }
    askNear();
  }, [nearOn, askNear, geo, setFilters]);

  /**
   * `?near=1` — "near me", asked from somewhere that has no position to
   * give: the home page's **Available now** chip. An intent, not a
   * filter: the viewer's position stays out of the URL (§9), so the
   * page resolves it the way the button does — a radius once there is
   * a fix, the question first if it was never asked, nothing if the
   * person said no — and takes the word out of the URL either way, so
   * a shared link never carries a wish it cannot grant.
   */
  const nearIntent = params.get('near') === '1';
  useEffect(() => {
    if (!nearIntent) return;
    const tidy = () => {
      const next = new URLSearchParams(params);
      next.delete('near');
      setParams(next, { replace: true });
    };
    if (geo.status === 'on') {
      // A fix in hand: the radius is written now (which drops `near`
      // with it), or was already chosen and only the word is tidied.
      if (radius == null) askNear();
      else tidy();
      return;
    }
    // No fix yet: the word goes, the question is asked; a chosen
    // distance stays in the URL and comes alive when the position does
    // (or is dropped by the dead-radius rule if it never does).
    tidy();
    askNear();
    // On the intent only: what it does next is the button's own logic.
  }, [nearIntent]);

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
      ? t('c.geo.blocked')
      : geo.decision === 'refused'
        ? `${t('c.geo.enableHint')} ${signedIn ? t('c.geo.turnOnSigned') : t('c.geo.turnOn')}`
        : geo.status === 'unsupported'
          ? typeof window !== 'undefined' && window.isSecureContext === false
            ? t('c.geo.unsupportedHttp')
            : t('c.geo.unsupported')
          : geo.status === 'unavailable'
            ? t('c.geo.unavailable')
            : null;
  const nearLabel = geo.status === 'asking' ? t('c.locating') : t('c.near');
  /**
   * "Available now" — the same question the word "now" asks in the
   * search bar, as a button. Lit when either asked it, so typing
   * "massage now" and pressing the chip look the same. Not admission:
   * when nothing can start within the half hour the door says so and
   * the ordinary answer follows, rather than an empty page.
   */
  const nowOn = filters.now || nowRequested;
  const toggleNow = useCallback(() => setFilters({ now: !filters.now }), [filters.now, setFilters]);
  const nowNote =
    nowRequested && loaded && rows.length > 0 && availableNow === 0
      ? t('c.nowNone')
      : null;
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
        {signedIn ? t('c.geo.hereSigned') : t('c.geo.here')}
      </button>
    ) : null;

  const note = query ? searchNote(how, widened, title, filters.radiusKm) : searchNote(null, widened, title, filters.radiusKm);
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
        id: s.salon.slug,
        lat: s.salon.lat!,
        lng: s.salon.lng!,
        label: s.salon.name,
        sub: s.salon.city,
        sub2: s.availableAt ? t('c.availNow', { t: s.availableAt }) : null,
        here: i === 0,
        // The card the pin opens. Everything on it is something the
        // platform actually knows — the salon's own photograph, whether
        // it can be booked, and what this treatment costs there. No
        // rating: there are no reviews yet, and a star nobody earned is
        // worse than no star at all.
        photo: s.salon.hasPhoto ? s.salon.photo : null,
        badge: s.salon.bookable ? t('c.res.instant') : null,
        price: priceLbl(s),
        href: `/salon/${s.salon.slug}`,
        onClick: () => nav(`/salon/${s.salon.slug}`),
      }));
  }, [rows, nav]);
  /** The phone's map: one card per salon — its best row for this
   *  question — keyed by the slug that is also its pin. */
  const mapResults = useMemo<MapResult[]>(() => {
    const seen = new Set<string>();
    const out: MapResult[] = [];
    for (const s of rows) {
      if (s.salon.lat == null || s.salon.lng == null || seen.has(s.salon.slug)) continue;
      seen.add(s.salon.slug);
      out.push({
        id: s.salon.slug,
        lat: s.salon.lat,
        lng: s.salon.lng,
        name: s.salon.name,
        city: s.salon.city,
        photo: s.salon.photo,
        hasPhoto: s.salon.hasPhoto,
        bookable: s.salon.bookable,
        treatment: s.name,
        price: priceLbl(s),
        availableAt: s.availableAt,
        href: salonHref(s),
      });
    }
    return out;
  }, [rows]);
  return (
    <>
      {filtersPanel}
      <div className="d-env">
        <section data-screen="results">
          <div className="d-topbar">
            <div className="d-wrap in">
              {box.open ? <div className="sug-scrim" aria-hidden="true" /> : null}
              <div className={`pillsearch-wrap${box.open ? ' open' : ''}`} ref={box.boxRef}>
                <div className="pillsearch">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4.2-4.2" /></svg>
                  <input data-res="q" placeholder={t('c.res.searchPh')} aria-label={t('c.res.search')} aria-controls="d-sugg" {...box.inputProps} />
                  <button
                    style={{ border: '0', background: 'none', color: 'var(--muted)' }}
                    onClick={() => nav('/')}
                    aria-label={t('c.res.clear')}
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
                    ? t('c.nearTitleOn', { km: NEAR_KM })
                    : t('c.nearTitleOff', { km: NEAR_KM }))
                }
              >
                {IcPin}
                {nearLabel}
              </button>
              <button
                className={`chip${nowOn ? ' on' : ''}`}
                onClick={toggleNow}
                aria-pressed={nowOn}
                title={t('c.nowTitle')}
              >
                {IcBolt}
                {t('c.now')}
              </button>
            </div>
            {nowNote ? (
              <div className="d-wrap">
                <GeoNotice icon="clock">{nowNote}</GeoNotice>
              </div>
            ) : null}
            {geoNote ? (
              <div className="d-wrap">
                <GeoNotice action={geoAction}>{geoNote}</GeoNotice>
              </div>
            ) : null}
          </div>
          <div className={`d-wrap res-layout${landing ? ' solo' : ''}`}>
            <div>
              {/* The results header (Alex, 2026-09-29): what was found,
                  whether the viewer's own account shaped the order, and
                  the way into the refinements — nothing else between the
                  search and the first result. */}
              {landing ? <SearchLanding cats={browse} /> : null}
              {!landing ? (
                <div className="res-head">
                  <div>
                    <h2 className="res-count">
                      {loaded
                        ? geo.status === 'on'
                          ? pins.length === 1 ? t('c.map.countNearOne') : t('c.map.countNear', { n: pins.length })
                          : pins.length === 1 ? t('c.map.countOne') : t('c.map.count', { n: pins.length })
                        : t('c.res.loading')}
                    </h2>
                    {personalised && rows.length ? (
                      <span className="res-personal" title={t('c.res.personalizedInfo')}>
                        {IcSpark}
                        {t('c.res.personalized')}
                        <span className="res-info" aria-label={t('c.res.personalizedInfo')} role="img">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8h.01" /></svg>
                        </span>
                      </span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className={`btn btn-g res-filt${nFilt ? ' on' : ''}`}
                    onClick={() => setFiltersOpen(true)}
                    aria-label={nFilt ? t('c.res.filtersApplied', { n: nFilt }) : t('c.res.filters')}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="15.5" cy="7" r="2" /><circle cx="9.5" cy="17" r="2" /></svg>
                    {t('c.res.filters')}
                    {nFilt ? <span className="res-filt-n">{nFilt}</span> : null}
                  </button>
                </div>
              ) : null}
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
                {best ? <BestD s={best} on={selectedSalon === best.salon.slug} onSelect={() => setSelectedSalon(best.salon.slug)} /> : loaded && !salons.length ? (
                  <div style={{ padding: '18px 4px' }}>
                    <div className="sm muted">{emptyLine(title, unknown, Boolean(query), { km: filters.radiusKm, city: filters.city })}</div>
                    {filters.radiusKm ? (
                      <button type="button" className="btn btn-g" style={{ marginTop: 12 }} onClick={() => setFilters({ radiusKm: null })}>
                        {t('c.res.showAllDistances')}
                      </button>
                    ) : filters.city ? (
                      <button type="button" className="btn btn-g" style={{ marginTop: 12 }} onClick={() => setFilters({ city: null })}>
                        {t('c.res.searchEverywhere')}
                      </button>
                    ) : null}
                  </div>
                ) : !loaded && !landing ? (
                  <Skeleton />
                ) : null}
                {alts.length ? (
                  <>
                    <h2 className="serif" style={{ fontSize: '19px', margin: '22px 0 2px' }}>{t('c.res.alts')}</h2>
                    <div className="sm muted" style={{ marginBottom: '12px' }}>{t('c.res.altsSub')}</div>
                    {alts.map((s) => (
                      <AltD key={s.id} s={s} on={selectedSalon === s.salon.slug} onSelect={() => setSelectedSalon(s.salon.slug)} />
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
                    <b style={{ color: 'var(--ink)' }}>{t('c.res.live')}</b>
                    <br />{t('c.res.noWaiting')}
                  </span>
                </span>
                <span className="note">
                  <span className="spark">{IcSpark}</span>
                  <span>
                    <b style={{ color: 'var(--ink)' }}>{t('c.res.noPerfect')}</b>
                    <br />{t('c.res.altFit')}
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
                labels={false}
                selectedId={selectedSalon}
                onSelect={selectFromMap}
                emptyNote={
                  pins.length
                    ? undefined
                    : loaded
                      ? t('c.res.noPins')
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
                <button className="m-mark" onClick={() => nav('/')} aria-label={t('c.hdr.home')}>
                  {IcMark}
                </button>
                {/* The pill opens the search sheet — the one place a phone
                    searches and filters (Alex, 2026-09-28); it shows what
                    was asked, and the × starts over. */}
                <div
                  className="m-search"
                  style={{ boxShadow: 'none', border: '1px solid var(--line)' }}
                  onClick={() => sheet.open({ facets })}
                >
                  <button type="button" className="m-sheet-open" aria-label={t('c.res.search')}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4.2-4.2" /></svg>
                  </button>
                  <input value={title} placeholder={t('c.res.searchPh')} data-res="q" aria-label={t('c.res.search')} readOnly />
                  <button
                    style={{ border: '0', background: 'none', color: 'var(--muted)' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      nav('/');
                    }}
                    aria-label={t('c.res.clear')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
                  </button>
                </div>
                {/* Once there is an answer, its filters: the sheet, opened
                    on Where (Alex, 2026-09-29). The map moved to a floating
                    button above the tab bar. */}
                {!landing ? (
                  <button
                    className={`map-btn filt-btn${nFilt ? ' on' : ''}`}
                    aria-label={nFilt ? t('c.res.filtersApplied', { n: nFilt }) : t('c.res.filters')}
                    title={t('c.res.filters')}
                    onClick={() => setFiltersOpen(true)}
                  >
                    {/* The icon alone; how many filters are on rides in the
                        same badge the profile tab wears for its notifications. */}
                    <span className="vnav-ic">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="15.5" cy="7" r="2" /><circle cx="9.5" cy="17" r="2" /></svg>
                      <span className="acc-bdg" hidden={nFilt === 0}>
                        {nFilt}
                      </span>
                    </span>
                  </button>
                ) : null}
              </div>
            </div>
            {!landing ? (
              <button className="m-mapfab" aria-label={t('c.res.mapView')} onClick={() => setMapOpen(true)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5z" /><path d="M9 4v13M15 6.5v13" /></svg>
                {t('c.res.map')}
              </button>
            ) : null}
            <div className="m-chiprow">
              <button
                className={`chip${nearOn ? ' on' : ''}`}
                onClick={toggleNear}
                disabled={nearBlocked}
                aria-pressed={nearOn}
                title={
                  geoNote ??
                  (nearOn
                    ? t('c.nearTitleOn', { km: NEAR_KM })
                    : t('c.nearTitleOff', { km: NEAR_KM }))
                }
              >
                {IcPin}
                {nearLabel}
              </button>
              <button
                className={`chip${nowOn ? ' on' : ''}`}
                onClick={toggleNow}
                aria-pressed={nowOn}
                title={t('c.nowTitle')}
              >
                {IcBolt}
                {t('c.now')}
              </button>
            </div>
            {nowNote ? (
              <div style={{ padding: '4px 16px 0' }}>
                <GeoNotice icon="clock">{nowNote}</GeoNotice>
              </div>
            ) : null}
            {rows.length ? (
              <div style={{ padding: '12px 16px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                <span className="spark" style={{ display: 'inline-flex', gap: '7px', alignItems: 'center', fontWeight: '700', color: 'var(--ink)' }}>
                  {IcSpark}{t('c.res.thinks')}
                </span>
              </div>
            ) : null}
            {landing ? (
              <div style={{ padding: '10px 16px 0' }}>
                <SearchLanding cats={browse} />
              </div>
            ) : null}
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
                <div style={{ padding: '18px 16px' }}>
                  <div className="sm muted">{emptyLine(title, unknown, Boolean(query), { km: filters.radiusKm, city: filters.city })}</div>
                  {filters.radiusKm ? (
                    <button type="button" className="btn btn-g" style={{ marginTop: 12 }} onClick={() => setFilters({ radiusKm: null })}>
                      {t('c.res.showAllDistances')}
                    </button>
                  ) : filters.city ? (
                    <button type="button" className="btn btn-g" style={{ marginTop: 12 }} onClick={() => setFilters({ city: null })}>
                      {t('c.res.searchEverywhere')}
                    </button>
                  ) : null}
                </div>
              ) : !loaded && !landing ? (
                <Skeleton phone />
              ) : null}
              {alts.length ? (
                <>
                  <div style={{ padding: '6px 16px 4px' }}>
                    <h2 className="serif" style={{ fontSize: '18px' }}>{t('c.res.alts')}</h2>
                    <div className="sm muted">{t('c.res.altsSub')}</div>
                  </div>
                  {alts.map((s) => (
                    <AltM key={s.id} s={s} />
                  ))}
                </>
              ) : null}
            </div>
            <div className="m-band">
              <span className="i">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg> {t('c.res.live')}
              </span>
              <span className="i">{IcSpark} {t('c.res.noPerfectM')}</span>
            </div>
            {mapOpen ? <MapResults results={mapResults} onClose={() => setMapOpen(false)} /> : null}

          </div>
        </section>
      </div>
    </>
  );
}
