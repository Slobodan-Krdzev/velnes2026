import type { CSSProperties } from 'react';
import { t } from '../lib/i18n-core.js';
import { useCallback, useEffect, useState } from 'react';
import './gallery.css';

/** The salon's own photos — the ones it uploads under Settings ›
 *  Company — browsable in the prototype's gallery frame. The counter
 *  and dots were decorative there; here they count what is really
 *  loaded, and a click opens the photo full size. */

export interface GalleryPhoto {
  id: string;
  name: string;
  /** The uploaded photograph, or null when the salon has only named
   *  the space and the workspace shows a colour tile for it. */
  img: string | null;
  tone: string | null;
}

const CHEV_L = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 6 8.5 12l6 6" /></svg>
);
const CHEV_R = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.5 6l6 6-6 6" /></svg>
);
const CLOSE = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
);

export function SalonGallery({
  photos,
  salonName,
  /** `gal` is the desktop frame, `m-gal` the mobile one — both the
   *  prototype's own classes. */
  variant,
  fallback,
}: {
  photos: GalleryPhoto[];
  salonName: string;
  variant: 'gal' | 'm-gal';
  /** What to show when a salon has uploaded nothing yet. */
  fallback: string;
}) {
  const [i, setI] = useState(0);
  const [open, setOpen] = useState(false);
  const n = photos.length;
  const at = Math.min(i, Math.max(0, n - 1));
  const go = useCallback(
    (d: number) => {
      if (!n) return;
      setI((x) => (x + d + n) % n);
    },
    [n],
  );

  // Arrow keys move through the photos while the lightbox is open;
  // Escape closes it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, go]);

  const current = photos[at];
  // A photograph if there is one; the salon's own tile colour if not;
  // the page's decorative default only when the gallery is empty.
  const frame: CSSProperties = current?.img
    ? { backgroundImage: `url("${current.img}")` }
    : current?.tone
      ? { background: current.tone }
      : { backgroundImage: fallback };

  return (
    <>
      <div className={variant} style={frame}>
        {current && !current.img ? <span className="galtile">{current.name}</span> : null}
        {photos.some((p) => p.img) ? (
          <button
            className="ph-open"
            aria-label={t('c.gal.open', { salon: salonName })}
            onClick={() => setOpen(true)}
            style={current?.img ? undefined : { cursor: 'default' }}
          />
        ) : null}
        {n > 1 ? (
          <>
            <button
              className="galnav prev"
              aria-label={t('c.gal.prev')}
              onClick={(e) => {
                e.stopPropagation();
                go(-1);
              }}
            >
              {CHEV_L}
            </button>
            <button
              className="galnav next"
              aria-label={t('c.gal.next')}
              onClick={(e) => {
                e.stopPropagation();
                go(1);
              }}
            >
              {CHEV_R}
            </button>
            <span className="count">
              {at + 1} / {n}
            </span>
            <span className="dots">
              {photos.map((p, k) => (
                <i
                  key={p.id}
                  className={k === at ? 'on' : ''}
                  role="button"
                  aria-label={t('c.gal.photo', { n: k + 1 })}
                  onClick={(e) => {
                    e.stopPropagation();
                    setI(k);
                  }}
                ></i>
              ))}
            </span>
          </>
        ) : null}
      </div>

      {open && current?.img ? (
        <div
          className="gallightbox"
          role="dialog"
          aria-label={t('c.gal.photosOf', { salon: salonName })}
          onClick={() => setOpen(false)}
        >
          <button className="close" aria-label={t('c.res.close')} onClick={() => setOpen(false)}>
            {CLOSE}
          </button>
          {n > 1 ? (
            <button
              className="galnav prev"
              aria-label={t('c.gal.prev')}
              onClick={(e) => {
                e.stopPropagation();
                go(-1);
              }}
            >
              {CHEV_L}
            </button>
          ) : null}
          <img src={current.img} alt={current.name || salonName} onClick={(e) => e.stopPropagation()} />
          {n > 1 ? (
            <button
              className="galnav next"
              aria-label={t('c.gal.next')}
              onClick={(e) => {
                e.stopPropagation();
                go(1);
              }}
            >
              {CHEV_R}
            </button>
          ) : null}
          <span className="cap">
            {current.name || salonName}
            {n > 1 ? ` · ${at + 1} of ${n}` : ''}
          </span>
        </div>
      ) : null}
    </>
  );
}
