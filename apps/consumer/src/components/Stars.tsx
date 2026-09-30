import { useState } from 'react';
import { t } from '../lib/i18n-core.js';

/**
 * The one star control (Alex, 2026-09-30): read-only where a rating is
 * shown, a radio group where one is given. Coral, like everything the
 * brand emphasises; whole stars only; "4 out of 5 stars" for a reader
 * that cannot see them.
 */
const STAR = (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" /></svg>
);

/** Five stars filled to `value` (a decimal fills partially). */
export function Stars({ value, size = 16, className = '' }: { value: number; size?: number; className?: string }) {
  const label = t('c.rv.stars', { n: value });
  return (
    <span className={`stars ${className}`.trim()} role="img" aria-label={label} style={{ ['--star' as string]: `${size}px` }}>
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = Math.max(0, Math.min(1, value - (i - 1)));
        return (
          <span key={i} className="star" style={{ ['--fill' as string]: `${fill * 100}%` }}>
            <span className="off">{STAR}</span>
            <span className="on">{STAR}</span>
          </span>
        );
      })}
    </span>
  );
}

/** A compact "★ 4.8 (127)" — for cards; hides itself with nothing to say. */
export function RatingChip({ rating, className = '' }: { rating: { avg: number; count: number } | null | undefined; className?: string }) {
  if (!rating || rating.count < 1) return null;
  return (
    <span className={`rating ${className}`.trim()} aria-label={`${t('c.rv.stars', { n: rating.avg })} · ${rating.count === 1 ? t('c.rv.countOne') : t('c.rv.count', { n: rating.count })}`}>
      <span className="s">{STAR}</span>
      <b>{rating.avg.toFixed(1)}</b>
      <span className="c">({rating.count})</span>
    </span>
  );
}

/** Interactive: five radio buttons behind five stars. Arrow keys move,
 *  space and click choose; hover previews. */
export function StarInput({
  name,
  value,
  onChange,
  label,
}: {
  name: string;
  value: number | null;
  onChange: (v: number) => void;
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;
  return (
    <div className="stars-in" role="radiogroup" aria-label={label} onMouseLeave={() => setHover(null)}>
      {[1, 2, 3, 4, 5].map((i) => (
        <label key={i} className={`star-btn${i <= shown ? ' on' : ''}`} onMouseEnter={() => setHover(i)}>
          <input
            type="radio"
            name={name}
            value={i}
            checked={value === i}
            onChange={() => onChange(i)}
            aria-label={t('c.rv.stars', { n: i })}
          />
          {STAR}
        </label>
      ))}
    </div>
  );
}
