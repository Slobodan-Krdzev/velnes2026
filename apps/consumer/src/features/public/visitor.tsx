import { useMemo } from 'react';
import { t } from '../../lib/i18n-core.js';
import { categoryVM } from '../../lib/api/mappers.js';
import { useCategories, useMostChosen } from '../../lib/api/queries.js';
import { supportEmail } from '../../lib/support.js';
import { CatCard, IcBolt, IcClock, IcHeart, IcPin, IcSpark, IcVok } from '../discovery/cards.js';
import { PubCard, PubContact, PubCta, PubFaq, PubGrid, PubHero, PublicPage, PubSection, PubSteps } from './Public.js';

const IcGlobe = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18" /></svg>
);

/** /treatments — what can be booked, from the same category door the
 *  home shelf and the search sheet use; every card opens the real
 *  results page. */
export function Treatments() {
  const catsQ = useCategories();
  const mostQ = useMostChosen();
  const cats = useMemo(() => (catsQ.data?.categories ?? []).map(categoryVM), [catsQ.data]);
  const most = useMemo(() => (mostQ.data?.categories ?? []).map(categoryVM).slice(0, 6), [mostQ.data]);
  const nowQuery = `/search?q=${encodeURIComponent(t('c.home.nowQuery'))}&near=1`;
  return (
    <PublicPage screen="treatments" title={t('c.pub.tr.title')} description={t('c.pub.meta.tr')}>
      <PubHero title={t('c.pub.tr.title')} lead={t('c.pub.tr.lead')} />
      {most.length ? (
        <PubSection title={t('c.pub.tr.mostChosen')} sub={t('c.pub.tr.mostChosenSub')}>
          <div className="pub-catgrid">
            {most.map((c) => (
              <CatCard key={c.id} c={c} />
            ))}
          </div>
        </PubSection>
      ) : null}
      <PubSection title={t('c.pub.tr.browse')} sub={t('c.pub.tr.browseSub')}>
        {cats.length ? (
          <div className="pub-catgrid">
            {cats.map((c) => (
              <CatCard key={c.id} c={c} />
            ))}
          </div>
        ) : catsQ.isSuccess ? (
          <p className="pub-sub">{t('c.pub.tr.empty')}</p>
        ) : null}
      </PubSection>
      <PubCta
        title={t('c.pub.tr.ctaTitle')}
        body={t('c.pub.tr.ctaBody')}
        primary={{ label: t('c.pub.findTreatment'), to: '/search' }}
        secondary={{ label: t('c.pub.availableNow'), to: nowQuery }}
      />
    </PublicPage>
  );
}

export function HowItWorks() {
  const features = [
    { ic: IcBolt, title: t('c.pub.how.f1'), body: t('c.pub.how.f1b') },
    { ic: IcPin, title: t('c.pub.how.f2'), body: t('c.pub.how.f2b') },
    { ic: IcHeart, title: t('c.pub.how.f3'), body: t('c.pub.how.f3b') },
    { ic: IcSpark, title: t('c.pub.how.f4'), body: t('c.pub.how.f4b') },
    { ic: IcGlobe, title: t('c.pub.how.f5'), body: t('c.pub.how.f5b') },
    { ic: IcClock, title: t('c.pub.how.f6'), body: t('c.pub.how.f6b') },
  ];
  return (
    <PublicPage screen="how-it-works" title={t('c.pub.how.title')} description={t('c.pub.meta.how')}>
      <PubHero title={t('c.pub.how.title')} lead={t('c.pub.how.lead')} />
      <PubSection>
        <PubSteps
          steps={[
            { title: t('c.pub.how.s1'), body: t('c.pub.how.s1b') },
            { title: t('c.pub.how.s2'), body: t('c.pub.how.s2b') },
            { title: t('c.pub.how.s3'), body: t('c.pub.how.s3b') },
            { title: t('c.pub.how.s4'), body: t('c.pub.how.s4b') },
          ]}
        />
      </PubSection>
      <PubSection title={t('c.pub.how.moreTitle')}>
        <PubGrid cols={3}>
          {features.map((f) => (
            <PubCard key={f.title} icon={f.ic} title={f.title} body={f.body} />
          ))}
        </PubGrid>
      </PubSection>
      <PubCta
        title={t('c.pub.how.ctaTitle')}
        body={t('c.pub.how.ctaBody')}
        primary={{ label: t('c.pub.findTreatment'), to: '/search' }}
        secondary={{ label: t('c.pub.helpCenter'), to: '/help' }}
      />
    </PublicPage>
  );
}

export function HelpCenter() {
  const g = (keys: string[]) => keys.map((k) => ({ q: t(`c.pub.help.${k}q`), a: t(`c.pub.help.${k}a`) }));
  const groups = [
    { title: t('c.pub.help.gBooking'), items: g(['b1', 'b2', 'b3', 'b4', 'b5']) },
    { title: t('c.pub.help.gSearch'), items: g(['s1', 's2', 's3', 's4']) },
    { title: t('c.pub.help.gAccount'), items: g(['a1', 'a2', 'a3', 'a4']) },
    { title: t('c.pub.help.gPayments'), items: g(['p1', 'p2', 'p3']) },
    { title: t('c.pub.help.gPolicies'), items: g(['o1', 'o2']) },
  ];
  return (
    <PublicPage screen="help" title={t('c.pub.help.title')} description={t('c.pub.meta.help')} narrow>
      <PubHero title={t('c.pub.help.title')} lead={t('c.pub.help.lead')} />
      {groups.map((gr) => (
        <PubSection key={gr.title} title={gr.title}>
          <PubFaq items={gr.items} />
        </PubSection>
      ))}
      <p className="pub-sub" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <span className="vok">{IcVok}</span>
        {t('c.pub.contact.salonNote')}
      </p>
      <PubContact email={supportEmail()} />
    </PublicPage>
  );
}
