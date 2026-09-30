import { t } from '../../lib/i18n-core.js';
import { supportEmail } from '../../lib/support.js';
import { PubHero, PubLink, PublicPage, PubUpdated } from './Public.js';

/**
 * The plain-language legal pages (Alex, 2026-09-30).
 *
 * No approved legal text exists on the platform, so these describe
 * what the product verifiably does — the data it keeps, the rules a
 * booking follows, what the browser stores — and claim nothing else:
 * no governing law, no controller identity, no retention periods, no
 * compliance statements. Each carries its date and says it is a
 * description. Wording beyond that is for a lawyer, not for code.
 */
const UPDATED = '30 September 2026';

function Sections({ items }: { items: { h: string; b: string }[] }) {
  const email = supportEmail();
  return (
    <div className="pub-legal">
      {items.map((it) => (
        <section key={it.h}>
          <h2 className="serif">{t(it.h)}</h2>
          <p>{t(it.b, { email })}</p>
        </section>
      ))}
    </div>
  );
}

export function Privacy() {
  return (
    <PublicPage screen="privacy" title={t('c.pub.priv.title')} description={t('c.pub.meta.priv')} narrow>
      <PubHero title={t('c.pub.priv.title')} lead={t('c.pub.priv.lead')}>
        <PubUpdated date={UPDATED} />
      </PubHero>
      <Sections items={['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10'].map((k) => ({ h: `c.pub.priv.${k}`, b: `c.pub.priv.${k}b` }))} />
      <p className="pub-sub">
        <PubLink to="/cookies">{t('c.home.fCookies')}</PubLink> · <PubLink to="/terms">{t('c.home.fTerms')}</PubLink>
      </p>
    </PublicPage>
  );
}

export function Terms() {
  return (
    <PublicPage screen="terms" title={t('c.pub.terms.title')} description={t('c.pub.meta.terms')} narrow>
      <PubHero title={t('c.pub.terms.title')} lead={t('c.pub.terms.lead')}>
        <PubUpdated date={UPDATED} />
      </PubHero>
      <Sections items={['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't10', 't11'].map((k) => ({ h: `c.pub.terms.${k}`, b: `c.pub.terms.${k}b` }))} />
      <p className="pub-sub">
        <PubLink to="/privacy">{t('c.home.fPrivacy')}</PubLink> · <PubLink to="/cookies">{t('c.home.fCookies')}</PubLink>
      </p>
    </PublicPage>
  );
}

export function Cookies() {
  const email = supportEmail();
  return (
    <PublicPage screen="cookies" title={t('c.pub.ck.title')} description={t('c.pub.meta.ck')} narrow>
      <PubHero title={t('c.pub.ck.title')} lead={t('c.pub.ck.lead')}>
        <PubUpdated date={UPDATED} />
      </PubHero>
      <div className="pub-legal">
        <section>
          <h2 className="serif">{t('c.pub.ck.c1')}</h2>
          <p>{t('c.pub.ck.c1b')}</p>
        </section>
        <section>
          <h2 className="serif">{t('c.pub.ck.c2')}</h2>
          <dl className="pub-dl">
            {['k1', 'k2', 'k3', 'k4'].map((k) => (
              <div key={k}>
                <dt>{t(`c.pub.ck.${k}`)}</dt>
                <dd>{t(`c.pub.ck.${k}b`)}</dd>
              </div>
            ))}
          </dl>
        </section>
        {['c3', 'c4', 'c5'].map((k) => (
          <section key={k}>
            <h2 className="serif">{t(`c.pub.ck.${k}`)}</h2>
            <p>{t(`c.pub.ck.${k}b`, { email })}</p>
          </section>
        ))}
      </div>
      <p className="pub-sub">
        <PubLink to="/privacy">{t('c.home.fPrivacy')}</PubLink> · <PubLink to="/terms">{t('c.home.fTerms')}</PubLink>
      </p>
    </PublicPage>
  );
}
