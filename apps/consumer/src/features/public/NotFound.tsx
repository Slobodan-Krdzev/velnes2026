import { t } from '../../lib/i18n-core.js';
import { IcArr, IcMark } from '../discovery/cards.js';
import { PubLink, PublicPage } from './Public.js';

/**
 * The page for a URL that names nothing (Alex, 2026-09-30) — the
 * wildcard route, which used to render the home page silently. The app
 * is client-rendered, so the HTTP status is the host's (200); the page
 * says "noindex" for crawlers that run scripts, and keeps the person
 * inside Velnes with the two ways on: home, and search.
 */
export function NotFound() {
  const nowQuery = `/search?q=${encodeURIComponent(t('c.home.nowQuery'))}&near=1`;
  return (
    <PublicPage screen="not-found" title={t('c.pub.nf.title')} description={t('c.pub.meta.nf')} noindex narrow>
      <div className="pub-nf">
        <span className="pub-nf-mark">{IcMark}</span>
        <span className="pub-eyebrow">404</span>
        <h1 className="serif">{t('c.pub.nf.title')}</h1>
        <p className="pub-lead">{t('c.pub.nf.body')}</p>
        <div className="pub-actions" style={{ justifyContent: 'center' }}>
          <PubLink className="btn btn-p" to="/">
            {t('c.pub.goHome')}
          </PubLink>
          <PubLink className="btn btn-g" to="/search">
            {t('c.pub.searchVelnes')} {IcArr}
          </PubLink>
        </div>
        <p className="pub-sub" style={{ marginTop: '28px' }}>{t('c.pub.nf.tryTitle')}</p>
        <div className="pub-chips">
          <PubLink className="chip" to={nowQuery}>
            {t('c.pub.availableNow')}
          </PubLink>
          <PubLink className="chip" to="/treatments">
            {t('c.pub.browseTreatments')}
          </PubLink>
          <PubLink className="chip" to="/how-it-works">
            {t('c.pub.howItWorks')}
          </PubLink>
        </div>
      </div>
    </PublicPage>
  );
}
