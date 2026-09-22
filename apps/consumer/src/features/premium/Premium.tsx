import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { t } from '../../lib/i18n-core.js';
import { useSession } from '../../lib/api/session.js';

/**
 * Velnes Premium, explained to the people it is for — Alex, 2026-09-22.
 *
 * The rules on this page are the platform's real ones (PREMIUM_RULES /
 * PREMIUM_LOYALTY_MULT, the last-minute offer phases): members earn
 * ×1.5 loyalty at every salon, and get the first window on last-minute
 * offers before they go public. Joining is not open yet — the page says
 * so plainly rather than drawing a button that does nothing.
 */

const IcStar = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" /></svg>
);
const IcBolt = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg>
);
const IcHeart = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" aria-hidden="true"><path d="M12 20s-7.4-4.6-7.4-9.4A4.3 4.3 0 0 1 12 8a4.3 4.3 0 0 1 7.4 2.6C19.4 15.4 12 20 12 20z" /></svg>
);
const IcTag = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 4h7l9 9-7 7-9-9z" /><circle cx="8.5" cy="8.5" r="1.4" /></svg>
);

export function Premium() {
  useTranslation();
  const nav = useNavigate();
  const { signedIn } = useSession();
  const perks = [
    { ic: IcBolt, title: t('c.prem.firstTitle'), body: t('c.prem.firstBody') },
    { ic: IcStar, title: t('c.prem.pointsTitle'), body: t('c.prem.pointsBody') },
    { ic: IcTag, title: t('c.prem.pricesTitle'), body: t('c.prem.pricesBody') },
    { ic: IcHeart, title: t('c.prem.everywhereTitle'), body: t('c.prem.everywhereBody') },
  ];
  return (
    <section data-screen="premium" className="prem">
      <div className="prem-wrap">
        <div className="prem-hero">
          <span className="prem-badge">{IcStar} Velnes Premium</span>
          <h1 className="serif">{t('c.prem.title')}</h1>
          <p className="prem-lead">{t('c.prem.lead')}</p>
        </div>
        <div className="prem-grid">
          {perks.map((p) => (
            <div className="prem-card" key={p.title}>
              <span className="prem-ic">{p.ic}</span>
              <b>{p.title}</b>
              <p>{p.body}</p>
            </div>
          ))}
        </div>
        <div className="prem-how">
          <h2>{t('c.prem.howTitle')}</h2>
          <ol>
            <li>{t('c.prem.how1')}</li>
            <li>{t('c.prem.how2')}</li>
            <li>{t('c.prem.how3')}</li>
          </ol>
        </div>
        <div className="prem-cta">
          <b>{t('c.prem.soonTitle')}</b>
          <p>{t('c.prem.soonBody')}</p>
          <div className="prem-actions">
            {signedIn ? (
              <button className="btn btn-p" onClick={() => nav('/account')}>{t('c.prem.toAccount')}</button>
            ) : (
              <button className="btn btn-p" onClick={() => nav('/register')}>{t('c.prem.join')}</button>
            )}
            <button className="btn btn-g" onClick={() => nav('/search')}>{t('c.prem.browse')}</button>
          </div>
        </div>
      </div>
    </section>
  );
}
