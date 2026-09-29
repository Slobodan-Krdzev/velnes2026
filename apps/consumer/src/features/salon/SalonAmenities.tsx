import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { amenitiesByGroup, sortAmenities, type AmenityKey } from '@velnes/contracts';
import { AMENITY_ICONS } from '@velnes/ui/amenity-icons';
import { t } from '../../lib/i18n-core.js';

/** How many rows the card shows before "Show all amenities". */
const SHOWN = 6;

/** One amenity's icon: the shared path, drawn the way this app draws icons. */
export function AmenityIcon({ k }: { k: AmenityKey }) {
  return (
    <span className="amen-ic" aria-hidden="true">
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        dangerouslySetInnerHTML={{ __html: AMENITY_ICONS[k] }}
      />
    </span>
  );
}

/**
 * The facilities at the location the page is showing (Alex,
 * 2026-09-29): a card under Location with up to six rows, the
 * vocabulary's order, and "Show all amenities" opening the full grouped
 * list in the page's sheet. Nothing at all when the location has none —
 * a salon that has not said is not a salon without.
 */
export function SalonAmenities({ keys, idPrefix }: { keys: readonly AmenityKey[]; idPrefix: string }) {
  useTranslation();
  const [open, setOpen] = useState(false);
  const sorted = sortAmenities(keys);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!sorted.length) return null;
  const shown = sorted.slice(0, SHOWN);
  return (
    <div className="scard" id={`${idPrefix}-amenities`}>
      <h2>{t('c.sal.amenities')}</h2>
      <ul className="amen-list">
        {shown.map((k) => (
          <li key={k} className="amen-row">
            <AmenityIcon k={k} />
            <span>{t(`amenity.${k}`)}</span>
          </li>
        ))}
      </ul>
      {sorted.length > SHOWN ? (
        <button type="button" className="readall" style={{ margin: '10px 0 0' }} onClick={() => setOpen(true)}>
          {t('c.sal.showAllAmenities', { n: sorted.length })}
        </button>
      ) : null}
      {open ? (
        <div className="m-sheet open amen-sheet" role="dialog" aria-modal="true" aria-label={t('c.sal.amenities')}>
          <div className="top">
            <b style={{ flex: 1, color: 'var(--ink)', fontSize: 16 }}>{t('c.sal.amenities')}</b>
            <button className="iconb" onClick={() => setOpen(false)} aria-label={t('c.res.close')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
          <div className="list">
            {amenitiesByGroup(sorted).map((g) => (
              <div key={g.group} className="amen-group">
                <div className="h">{t(`amenityGroup.${g.group}`)}</div>
                <ul className="amen-list">
                  {g.keys.map((k) => (
                    <li key={k} className="amen-row">
                      <AmenityIcon k={k} />
                      <span>{t(`amenity.${k}`)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
