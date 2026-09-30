import { t } from '../../lib/i18n-core.js';
import { businessOnboardingUrl, workspaceUrl } from '../../lib/business.js';
import { supportEmail } from '../../lib/support.js';
import { IcClock, IcHeart, IcPin, IcSpark } from '../discovery/cards.js';
import { PubCard, PubCta, PubGrid, PubHero, PubLink, PubList, PublicPage, PubSection, PubSteps } from './Public.js';

const IcScissors = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="7" cy="18" r="2.6" /><circle cx="17" cy="18" r="2.6" /><path d="M8.8 16.2 17 4M15.2 16.2 7 4" /></svg>
);
const IcPeople = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" /><circle cx="17" cy="9" r="2.5" /><path d="M16 14.5c3 0 5.5 2 5.5 5" /></svg>
);
const IcCal = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3.5v3M16 3.5v3" /></svg>
);
const IcTill = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><rect x="4" y="9" width="16" height="11" rx="2" /><path d="M8 9V6.5A2.5 2.5 0 0 1 10.5 4h3A2.5 2.5 0 0 1 16 6.5V9M4 13h16" /></svg>
);
const IcPage = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><rect x="4" y="3.5" width="16" height="17" rx="2.5" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>
);
const IcBox = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></svg>
);

/** /for-business — what a salon gets, and the real door in. Every
 *  capability named here is one the workspace has (docs/WORKSPACE.md
 *  and the phase docs); the CTA is the onboarding the header opens. */
export function ForBusiness() {
  const onboarding = businessOnboardingUrl();
  const features = [
    { ic: IcScissors, title: t('c.pub.biz.f1'), body: t('c.pub.biz.f1b') },
    { ic: IcPin, title: t('c.pub.biz.f2'), body: t('c.pub.biz.f2b') },
    { ic: IcPeople, title: t('c.pub.biz.f3'), body: t('c.pub.biz.f3b') },
    { ic: IcCal, title: t('c.pub.biz.f4'), body: t('c.pub.biz.f4b') },
    { ic: IcTill, title: t('c.pub.biz.f5'), body: t('c.pub.biz.f5b') },
    { ic: IcHeart, title: t('c.pub.biz.f6'), body: t('c.pub.biz.f6b') },
    { ic: IcPage, title: t('c.pub.biz.f7'), body: t('c.pub.biz.f7b') },
    { ic: IcSpark, title: t('c.pub.biz.f8'), body: t('c.pub.biz.f8b') },
  ];
  return (
    <PublicPage screen="for-business" title={t('c.pub.biz.ctaTitle')} description={t('c.pub.meta.biz')}>
      <PubHero eyebrow={t('c.hdr.business')} title={t('c.pub.biz.title')} lead={t('c.pub.biz.lead')}>
        <div className="pub-actions" style={{ justifyContent: 'center', marginTop: '18px' }}>
          <PubLink className="btn btn-p" to={onboarding}>
            {t('c.pub.listBiz')}
          </PubLink>
          <PubLink className="btn btn-g" to="/business-benefits">
            {t('c.home.fBizBenefits')}
          </PubLink>
        </div>
      </PubHero>
      <p className="pub-sub" style={{ textAlign: 'center', maxWidth: '60ch', margin: '0 auto 8px' }}>{t('c.pub.biz.who')}</p>
      <PubSection>
        <PubGrid cols={2}>
          {features.map((f) => (
            <PubCard key={f.title} icon={f.ic} title={f.title} body={f.body} />
          ))}
        </PubGrid>
      </PubSection>
      <PubSection title={t('c.pub.biz.startTitle')}>
        <PubSteps steps={[{ body: t('c.pub.biz.st1') }, { body: t('c.pub.biz.st2') }, { body: t('c.pub.biz.st3') }]} />
      </PubSection>
      <PubCta
        title={t('c.pub.biz.ctaTitle')}
        body={t('c.pub.biz.ctaBody')}
        primary={{ label: t('c.pub.listBiz'), to: onboarding }}
        secondary={{ label: t('c.pub.partnerSupport'), to: '/partner-support' }}
      />
    </PublicPage>
  );
}

export function BusinessBenefits() {
  const items = [
    { ic: IcSpark, k: 'b1' },
    { ic: IcCal, k: 'b2' },
    { ic: IcClock, k: 'b3' },
    { ic: IcPeople, k: 'b4' },
    { ic: IcScissors, k: 'b5' },
    { ic: IcHeart, k: 'b6' },
    { ic: IcPage, k: 'b7' },
    { ic: IcBox, k: 'b8' },
  ];
  return (
    <PublicPage screen="business-benefits" title={t('c.home.fBizBenefits')} description={t('c.pub.meta.ben')}>
      <PubHero eyebrow={t('c.hdr.business')} title={t('c.pub.ben.title')} lead={t('c.pub.ben.lead')} />
      <PubSection>
        <PubGrid cols={2}>
          {items.map((it) => (
            <PubCard key={it.k} icon={it.ic} title={t(`c.pub.ben.${it.k}`)} body={t(`c.pub.ben.${it.k}b`)} />
          ))}
        </PubGrid>
      </PubSection>
      <PubCta
        title={t('c.pub.biz.ctaTitle')}
        body={t('c.pub.biz.ctaBody')}
        primary={{ label: t('c.pub.listBiz'), to: businessOnboardingUrl() }}
        secondary={{ label: t('c.home.fResources'), to: '/business-resources' }}
      />
    </PublicPage>
  );
}

export function BusinessResources() {
  const guides = Array.from({ length: 12 }, (_, i) => `r${i + 1}`);
  return (
    <PublicPage screen="business-resources" title={t('c.pub.res.title')} description={t('c.pub.meta.res')}>
      <PubHero eyebrow={t('c.hdr.business')} title={t('c.pub.res.title')} lead={t('c.pub.res.lead')} />
      <PubSection>
        <PubGrid cols={3}>
          {guides.map((k) => (
            <PubCard key={k} title={t(`c.pub.res.${k}`)} body={t(`c.pub.res.${k}b`)} />
          ))}
        </PubGrid>
      </PubSection>
      <PubCta
        title={t('c.pub.res.ctaTitle')}
        body={t('c.pub.res.ctaBody')}
        primary={{ label: t('c.pub.partnerSupport'), to: '/partner-support' }}
        secondary={{ label: t('c.pub.openWorkspace'), to: workspaceUrl() }}
      />
    </PublicPage>
  );
}

export function PartnerSupport() {
  const email = supportEmail();
  return (
    <PublicPage screen="partner-support" title={t('c.pub.ps.title')} description={t('c.pub.meta.ps')} narrow>
      <PubHero eyebrow={t('c.hdr.business')} title={t('c.pub.ps.title')} lead={t('c.pub.ps.lead')} />
      <PubSection>
        <PubGrid cols={2}>
          <PubCard icon={IcPage} title={t('c.pub.ps.ticketTitle')} body={t('c.pub.ps.ticketBody')} />
          <PubCard icon={IcSpark} title={t('c.pub.ps.mailTitle')} body={t('c.pub.ps.mailBody')} />
        </PubGrid>
        <div className="pub-actions" style={{ marginTop: '14px' }}>
          <PubLink className="btn btn-p" to={workspaceUrl()}>
            {t('c.pub.openWorkspace')}
          </PubLink>
          <PubLink className="btn btn-g" to={`mailto:${email}`}>
            {t('c.pub.writeTo', { email })}
          </PubLink>
        </div>
      </PubSection>
      <PubSection title={t('c.pub.ps.topics')}>
        <PubList items={Array.from({ length: 9 }, (_, i) => t(`c.pub.ps.t${i + 1}`))} />
      </PubSection>
      <PubCta
        title={t('c.pub.res.title')}
        body={t('c.pub.res.lead')}
        primary={{ label: t('c.home.fResources'), to: '/business-resources' }}
        secondary={{ label: t('c.pub.listBiz'), to: businessOnboardingUrl() }}
      />
    </PublicPage>
  );
}
