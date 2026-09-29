import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AmenityKey, SearchFacets } from '@velnes/contracts';
import { fmtMKD } from '../../lib/api/mappers.js';
import type { SearchFilters } from '../../lib/api/queries.js';
import { t } from '../../lib/i18n-core.js';
import { AmenityIcon } from '../salon/SalonAmenities.js';

/**
 * The filters — one panel, two presentations (Alex, 2026-09-29): a
 * bottom sheet on a phone, a right-hand drawer on a desk, the same
 * sections, state and semantics. Over the current answer, the
 * **secondary refinements**: treatment category (one, as the door
 * takes it), a **price range** on a histogram of the answer's own prices
 * with two handles (the ends meaning any price), **distance** once a
 * position is known, and the **amenities** present in the answer.
 * Chosen here, applied together on the CTA, which says how many results
 * that would be — a real count from the same hook the page uses.
 *
 * Not here: What, Where and When. The query, Near me and Available now
 * are the search itself and live in the search context above the
 * results; "Clear all" leaves them alone and only takes the refinements
 * off — distance going back to what Near me set, when Near me is on.
 */

const BUCKETS = 28;
const NEAR_KM = 10;
const AMENITIES_SHOWN = 6;

/** Bars for the histogram: how many prices fall in each of `n` equal
 *  slices between the lowest and the highest. */
export function histogram(prices: readonly number[], n = BUCKETS): number[] {
  if (!prices.length) return [];
  const lo = prices[0]!;
  const hi = prices[prices.length - 1]!;
  const bars = new Array<number>(n).fill(0);
  if (hi === lo) {
    bars[0] = prices.length;
    return bars;
  }
  for (const p of prices) {
    const i = Math.min(n - 1, Math.floor(((p - lo) / (hi - lo)) * n));
    bars[i] = (bars[i] ?? 0) + 1;
  }
  return bars;
}

export function FiltersSheet({
  facets,
  filters,
  canDistance,
  nearOn,
  onApply,
  onClose,
  count,
}: {
  facets: SearchFacets;
  filters: SearchFilters;
  /** A position is known, so a distance means something. */
  canDistance: boolean;
  /** Near me is on: "Clear all" returns the distance to its default. */
  nearOn: boolean;
  onApply: (patch: Partial<SearchFilters>) => void;
  onClose: () => void;
  /** The CTA's words for a draft — "Show 23 results" when known. */
  count?: (draft: SearchFilters) => ReactNode;
}) {
  useTranslation();
  const prices = facets.prices;
  const lo = prices[0] ?? 0;
  const hi = prices[prices.length - 1] ?? 0;
  const [cat, setCat] = useState<string | null>(filters.categoryId);
  const [min, setMin] = useState<number>(filters.priceMin ?? lo);
  const [max, setMax] = useState<number>(filters.priceMax ?? hi);
  const [radius, setRadius] = useState<number | null>(filters.radiusKm);
  const [amen, setAmen] = useState<AmenityKey[]>(filters.amenities);
  const [allAmen, setAllAmen] = useState(false);
  const bars = useMemo(() => histogram(prices), [prices]);
  const peak = Math.max(1, ...bars);

  // While the panel is up the page behind must not move; iOS ignores
  // overflow:hidden on the body for touch scrolling, so the body is
  // pinned where it is and put back afterwards.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const y = window.scrollY;
    const body = document.body;
    const prev = { position: body.style.position, top: body.style.top, width: body.style.width, overflow: body.style.overflow };
    body.style.position = 'fixed';
    body.style.top = `-${y}px`;
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.width = prev.width;
      body.style.overflow = prev.overflow;
      window.scrollTo(0, y);
    };
  }, [onClose]);

  const canPrice = prices.length >= 2 && hi > lo;
  const clampedMin = Math.min(min, max);
  const clampedMax = Math.max(min, max);
  const toggle = (k: AmenityKey) => setAmen((a) => (a.includes(k) ? a.filter((x) => x !== k) : [...a, k]));
  /** What the panel would apply, as the page's filters. */
  const draft: SearchFilters = {
    ...filters,
    categoryId: cat,
    priceBand: null,
    // The range only travels when it narrows: handles at the ends mean "any price".
    priceMin: canPrice && clampedMin > lo ? clampedMin : null,
    priceMax: canPrice && clampedMax < hi ? clampedMax : null,
    radiusKm: canDistance ? radius : filters.radiusKm,
    amenities: amen,
  };
  /** Clear all is an act, not a reset: every refinement comes off the
   *  answer at once and the panel closes — the search itself stays. */
  const clear = () =>
    onApply({ categoryId: null, priceBand: null, priceMin: null, priceMax: null, amenities: [], radiusKm: nearOn ? NEAR_KM : filters.radiusKm });
  const appliedRefinements =
    Boolean(filters.categoryId || filters.priceBand || filters.priceMin != null || filters.priceMax != null || filters.amenities.length) ||
    (filters.radiusKm != null && filters.radiusKm !== NEAR_KM);
  const draftRefinements =
    Boolean(cat || amen.length || draft.priceMin != null || draft.priceMax != null) || (canDistance && radius != null && radius !== NEAR_KM);
  const apply = () =>
    onApply({ categoryId: draft.categoryId, priceBand: null, priceMin: draft.priceMin, priceMax: draft.priceMax, amenities: draft.amenities, radiusKm: draft.radiusKm });
  const pct = (v: number) => (hi > lo ? ((v - lo) / (hi - lo)) * 100 : 0);
  const amenities = allAmen ? facets.amenities : facets.amenities.slice(0, AMENITIES_SHOWN);

  return (
    <>
      <div className="fs-scrim" onClick={onClose} aria-hidden="true" />
      <div className="fs" role="dialog" aria-modal="true" aria-label={t('c.res.filters')}>
        <div className="fs-top">
          <b>{t('c.res.filters')}</b>
          <button type="button" className="ss-close" onClick={onClose} aria-label={t('c.res.close')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <div className="fs-body">
          {/* ── Treatments & categories — one, as the door takes it ── */}
          {facets.categories.length > 1 ? (
            <section className="fs-sec">
              <h3>{t('c.filt.categories')}</h3>
              <div className="fs-radios" role="radiogroup" aria-label={t('c.filt.categories')}>
                <button type="button" role="radio" aria-checked={cat === null} className={`fs-radio${cat === null ? ' on' : ''}`} onClick={() => setCat(null)}>
                  <span className="dot" />
                  <span className="grow">{t('c.res.all')}</span>
                </button>
                {facets.categories.map((c) => (
                  <button key={c.id} type="button" role="radio" aria-checked={cat === c.id} className={`fs-radio${cat === c.id ? ' on' : ''}`} onClick={() => setCat(c.id)}>
                    <span className="dot" />
                    <span className="grow">{c.name}</span>
                    <span className="sm muted">{c.count}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {/* ── Price range ─────────────────────────────────────── */}
          <section className="fs-sec">
            <h3>{t('c.filt.price')}</h3>
            <p className="sm muted">{t('c.filt.priceSub')}</p>
            {canPrice ? (
              <>
                <div className="fs-hist" aria-hidden="true">
                  {bars.map((b, i) => {
                    const from = lo + ((hi - lo) * i) / bars.length;
                    const to = lo + ((hi - lo) * (i + 1)) / bars.length;
                    const inRange = to >= clampedMin && from <= clampedMax;
                    return <span key={i} className={`fs-bar${inRange ? ' in' : ''}`} style={{ height: `${Math.max(4, (b / peak) * 100)}%` }} />;
                  })}
                </div>
                <div className="fs-range">
                  <div className="fs-track" />
                  <div className="fs-fill" style={{ left: `${pct(clampedMin)}%`, right: `${100 - pct(clampedMax)}%` }} />
                  <input type="range" min={lo} max={hi} step={10} value={clampedMin} aria-label={t('c.filt.min')} onChange={(e) => setMin(Math.min(Number(e.target.value), clampedMax))} />
                  <input type="range" min={lo} max={hi} step={10} value={clampedMax} aria-label={t('c.filt.max')} onChange={(e) => setMax(Math.max(Number(e.target.value), clampedMin))} />
                </div>
                <div className="fs-minmax">
                  <span>
                    <small>{t('c.filt.min')}</small>
                    <b>{fmtMKD(clampedMin)}</b>
                  </span>
                  <span>
                    <small>{t('c.filt.max')}</small>
                    <b>{clampedMax >= hi ? `${fmtMKD(hi)}+` : fmtMKD(clampedMax)}</b>
                  </span>
                </div>
              </>
            ) : (
              <p className="sm muted">{t('c.filt.noPrices')}</p>
            )}
          </section>

          {/* ── Distance — a refinement of Near me, once there is a position ── */}
          {canDistance ? (
            <section className="fs-sec">
              <h3>{t('c.filt.distance')}</h3>
              <div className="fs-radios" role="radiogroup" aria-label={t('c.filt.distance')}>
                <button type="button" role="radio" aria-checked={radius === null} className={`fs-radio${radius === null ? ' on' : ''}`} onClick={() => setRadius(null)}>
                  <span className="dot" />
                  <span className="grow">{t('c.res.anyDistance')}</span>
                </button>
                {[2, 5, 10].map((km) => (
                  <button key={km} type="button" role="radio" aria-checked={radius === km} className={`fs-radio${radius === km ? ' on' : ''}`} onClick={() => setRadius(km)}>
                    <span className="dot" />
                    <span className="grow">{t('c.res.withinKm', { km })}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {/* ── Amenities — only those the answer actually has ────── */}
          {facets.amenities.length ? (
            <section className="fs-sec">
              <h3>{t('c.filt.amenities')}</h3>
              <div className="fs-amen">
                {amenities.map((a) => (
                  <button key={a.key} type="button" className={`fs-amen-row${amen.includes(a.key) ? ' on' : ''}`} onClick={() => toggle(a.key)} aria-pressed={amen.includes(a.key)}>
                    <AmenityIcon k={a.key} />
                    <span className="grow">{t(`amenity.${a.key}`)}</span>
                    <span className="sm muted">{a.count}</span>
                  </button>
                ))}
              </div>
              {facets.amenities.length > AMENITIES_SHOWN && !allAmen ? (
                <button type="button" className="ss-link" style={{ padding: '8px 0' }} onClick={() => setAllAmen(true)}>
                  {t('c.sal.showAllAmenities', { n: facets.amenities.length })}
                </button>
              ) : null}
            </section>
          ) : null}
        </div>
        <div className="ss-foot">
          <button type="button" className="ss-link" onClick={clear} disabled={!appliedRefinements && !draftRefinements}>
            {t('c.ss.clearAll')}
          </button>
          <button type="button" className="btn btn-p ss-go" onClick={apply}>
            {count ? count(draft) : t('c.res.showResults')}
          </button>
        </div>
      </div>
    </>
  );
}
