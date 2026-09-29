import { useTranslation } from 'react-i18next';
import { sortAmenities, type AmenityKey } from '@velnes/contracts';
import { AMENITY_ICONS } from '@velnes/ui/amenity-icons';
import { t } from '../../lib/i18n-core.js';

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
 * 2026-09-29): a card under Location listing all of them, two columns,
 * the vocabulary's order. Nothing at all when the location has none —
 * a salon that has not said is not a salon without.
 */
export function SalonAmenities({ keys, idPrefix }: { keys: readonly AmenityKey[]; idPrefix: string }) {
  useTranslation();
  const sorted = sortAmenities(keys);
  if (!sorted.length) return null;
  return (
    <div className="scard" id={`${idPrefix}-amenities`}>
      <h2>{t('c.sal.amenities')}</h2>
      <ul className="amen-list">
        {sorted.map((k) => (
          <li key={k} className="amen-row">
            <AmenityIcon k={k} />
            <span>{t(`amenity.${k}`)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
