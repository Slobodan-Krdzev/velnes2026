import { useTranslation } from 'react-i18next';
/**
 * The location prompt — the prototype's own, `.gps-modal` / `.gps-card`.
 *
 * Our dialog comes before the browser's. It says why Velnes wants the
 * location and what it does with it, so the browser's bare "allow /
 * block" arrives with its reason already given. It is shown once, on
 * the home page, and only while nobody has answered.
 *
 * The prototype's copy is kept word for word except its second button,
 * which said "Not now — use default city". There is no default city in
 * this app; refusing disables "Near me" and says how to turn it back on.
 * Promising a fallback that does not exist is the one thing this dialog
 * must not do, given that its whole point is to be believed.
 */
export function GeoPrompt({ onAllow, onDeny }: { onAllow: () => void; onDeny: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="gps-modal" role="dialog" aria-modal="true" aria-labelledby="gps-title">
      <div className="gps-card">
        <div className="gps-ic">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s6.5-6 6.5-10.5a6.5 6.5 0 1 0-13 0C5.5 15 12 21 12 21z" /><circle cx="12" cy="10.5" r="2.4" /></svg>
        </div>
        <h2 id="gps-title">{t('c.geo.title')}</h2>
        <p>{t('c.geo.body')}</p>
        <button type="button" className="btn btn-p" onClick={onAllow} autoFocus>
          {t('c.geo.allow')}
        </button>
        <button type="button" className="gps-deny" onClick={onDeny}>
          {t('c.geo.deny')}
        </button>
      </div>
    </div>
  );
}
