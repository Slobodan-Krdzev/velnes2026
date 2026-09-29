import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AmenityKey, SearchFacets } from '@velnes/contracts';
import { fmtMKD } from '../../lib/api/mappers.js';
import type { SearchFilters } from '../../lib/api/queries.js';
import { t } from '../../lib/i18n-core.js';
import { AmenityIcon } from '../salon/SalonAmenities.js';
import { SUGGEST_ICONS } from './suggestIcons.js';

/**
 * The phone's filters panel (Alex, 2026-09-29): over the current
 * answer, three questions — a **price range** on a histogram of the
 * answer's own prices with two handles, **when** (any time, or a start
 * within 30 minutes), and the **amenities** present in the answer —
 * chosen here and applied together on "Show results". The doors do the
 * filtering, as they do every filter: the panel only writes the URL.
 * The search sheet is for asking a different question; this is for
 * narrowing the answer to this one.
 */

const BUCKETS = 28;

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
  onApply,
  onClose,
}: {
  facets: SearchFacets;
  filters: SearchFilters;
  onApply: (patch: Partial<SearchFilters>) => void;
  onClose: () => void;
}) {
  useTranslation();
  const prices = facets.prices;
  const lo = prices[0] ?? 0;
  const hi = prices[prices.length - 1] ?? 0;
  const [min, setMin] = useState<number>(filters.priceMin ?? lo);
  const [max, setMax] = useState<number>(filters.priceMax ?? hi);
  const [now, setNow] = useState(filters.now);
  const [amen, setAmen] = useState<AmenityKey[]>(filters.amenities);
  const bars = useMemo(() => histogram(prices), [prices]);
  const peak = Math.max(1, ...bars);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const canPrice = prices.length >= 2 && hi > lo;
  const clampedMin = Math.min(min, max);
  const clampedMax = Math.max(min, max);
  const toggle = (k: AmenityKey) => setAmen((a) => (a.includes(k) ? a.filter((x) => x !== k) : [...a, k]));
  const clear = () => {
    setMin(lo);
    setMax(hi);
    setNow(false);
    setAmen([]);
  };
  const anything = now || amen.length > 0 || (canPrice && (clampedMin > lo || clampedMax < hi));
  const apply = () =>
    onApply({
      // The range only travels when it narrows: handles at the ends mean "any price".
      priceMin: canPrice && clampedMin > lo ? clampedMin : null,
      priceMax: canPrice && clampedMax < hi ? clampedMax : null,
      now,
      amenities: amen,
    });
  const pct = (v: number) => (hi > lo ? ((v - lo) / (hi - lo)) * 100 : 0);

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
                  <input
                    type="range"
                    min={lo}
                    max={hi}
                    step={10}
                    value={clampedMin}
                    aria-label={t('c.filt.min')}
                    onChange={(e) => setMin(Math.min(Number(e.target.value), clampedMax))}
                  />
                  <input
                    type="range"
                    min={lo}
                    max={hi}
                    step={10}
                    value={clampedMax}
                    aria-label={t('c.filt.max')}
                    onChange={(e) => setMax(Math.max(Number(e.target.value), clampedMin))}
                  />
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

          {/* ── When ─────────────────────────────────────────────── */}
          <section className="fs-sec">
            <h3>{t('c.filt.when')}</h3>
            <div className="ss-chips" style={{ margin: 0 }}>
              <button type="button" className={`chip${!now ? ' on' : ''}`} onClick={() => setNow(false)} aria-pressed={!now}>
                {t('c.ss.anyTime')}
              </button>
              <button type="button" className={`chip${now ? ' on' : ''}`} onClick={() => setNow(true)} aria-pressed={now} title={t('c.nowTitle')}>
                {SUGGEST_ICONS.bolt}
                {t('c.now')}
              </button>
            </div>
          </section>

          {/* ── Amenities — only those the answer actually has ────── */}
          {facets.amenities.length ? (
            <section className="fs-sec">
              <h3>{t('c.filt.amenities')}</h3>
              <div className="fs-amen">
                {facets.amenities.map((a) => (
                  <button
                    key={a.key}
                    type="button"
                    className={`fs-amen-row${amen.includes(a.key) ? ' on' : ''}`}
                    onClick={() => toggle(a.key)}
                    aria-pressed={amen.includes(a.key)}
                  >
                    <AmenityIcon k={a.key} />
                    <span className="grow">{t(`amenity.${a.key}`)}</span>
                    <span className="sm muted">{a.count}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </div>
        <div className="ss-foot">
          <button type="button" className="ss-link" onClick={clear} disabled={!anything}>
            {t('c.ss.clearAll')}
          </button>
          <button type="button" className="btn btn-p ss-go" onClick={apply}>
            {t('c.res.showResults')}
          </button>
        </div>
      </div>
    </>
  );
}
