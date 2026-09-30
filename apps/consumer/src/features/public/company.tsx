import { t } from '../../lib/i18n-core.js';
import { mailto, supportEmail } from '../../lib/support.js';
import { IcBolt, IcHeart, IcMark, IcPin, IcSpark } from '../discovery/cards.js';
import { PubCard, PubCta, PubEmpty, PubGrid, PubHero, PubLink, PublicPage, PubSection } from './Public.js';

/** /about — what Velnes is and how it works, and nothing it is not:
 *  no founding story, team or offices, because none is on record. */
export function About() {
  return (
    <PublicPage screen="about" title={t('c.pub.about.title')} description={t('c.pub.meta.about')}>
      <PubHero title={t('c.pub.about.title')} lead={t('c.pub.about.lead')} />
      <PubSection>
        <PubGrid cols={2}>
          <PubCard icon={IcSpark} title={t('c.pub.about.whatTitle')} body={t('c.pub.about.whatBody')} />
          <PubCard icon={IcBolt} title={t('c.pub.about.whyTitle')} body={t('c.pub.about.whyBody')} />
        </PubGrid>
      </PubSection>
      <PubSection title={t('c.pub.about.howTitle')}>
        <PubGrid cols={3}>
          <PubCard title={t('c.pub.about.p1')} body={t('c.pub.about.p1b')} />
          <PubCard title={t('c.pub.about.p2')} body={t('c.pub.about.p2b')} />
          <PubCard title={t('c.pub.about.p3')} body={t('c.pub.about.p3b')} />
        </PubGrid>
      </PubSection>
      <PubSection>
        <PubCard icon={IcPin} title={t('c.pub.about.whereTitle')} body={t('c.pub.about.whereBody')} />
      </PubSection>
      <PubCta
        title={t('c.pub.exploreVelnes')}
        primary={{ label: t('c.pub.findTreatment'), to: '/search' }}
        secondary={{ label: t('c.pub.forBiz'), to: '/for-business' }}
      />
    </PublicPage>
  );
}

/** /careers — an honest empty state; vacancies, when there are any,
 *  go where the empty state is. */
export function Careers() {
  return (
    <PublicPage screen="careers" title={t('c.pub.car.title')} description={t('c.pub.meta.car')} narrow>
      <PubHero title={t('c.pub.car.title')} lead={t('c.pub.car.lead')} />
      <PubSection>
        <PubEmpty title={t('c.pub.car.emptyTitle')} body={t('c.pub.car.emptyBody')} />
      </PubSection>
      <PubCta
        title={t('c.pub.car.contact')}
        primary={{ label: t('c.pub.contactUs'), to: '/contact' }}
        secondary={{ label: t('c.home.fAbout'), to: '/about' }}
      />
    </PublicPage>
  );
}

/** /press — the description, the name and the mark. No coverage is
 *  listed because none exists. */
export function Press() {
  return (
    <PublicPage screen="press" title={t('c.pub.press.title')} description={t('c.pub.meta.press')} narrow>
      <PubHero title={t('c.pub.press.title')} lead={t('c.pub.press.lead')} />
      <PubSection title={t('c.pub.press.aboutTitle')}>
        <p className="pub-p">{t('c.pub.press.aboutBody')}</p>
      </PubSection>
      <PubSection title={t('c.pub.press.brandTitle')}>
        <div className="pub-brand">
          <span className="pub-brand-mark">{IcMark}</span>
          <span className="serif pub-brand-name">Velnes</span>
        </div>
        <p className="pub-p">{t('c.pub.press.brandBody')}</p>
      </PubSection>
      <PubCta
        title={t('c.pub.press.enqTitle')}
        body={t('c.pub.press.enqBody')}
        primary={{ label: t('c.pub.writeTo', { email: supportEmail() }), to: mailto('Press') }}
        secondary={{ label: t('c.home.fAbout'), to: '/about' }}
      />
    </PublicPage>
  );
}

/** /contact — the one address that really answers, by audience. */
export function Contact() {
  const email = supportEmail();
  const rows = [
    { ic: IcHeart, title: t('c.pub.contact.custTitle'), body: t('c.pub.contact.custBody'), subject: 'Booking' },
    { ic: IcSpark, title: t('c.pub.contact.bizTitle'), body: t('c.pub.contact.bizBody'), subject: 'Business' },
    { ic: IcBolt, title: t('c.pub.contact.genTitle'), body: t('c.pub.contact.genBody'), subject: undefined },
  ];
  return (
    <PublicPage screen="contact" title={t('c.pub.contact.title')} description={t('c.pub.meta.contact')} narrow>
      <PubHero title={t('c.pub.contact.title')} lead={t('c.pub.contact.lead')} />
      <PubSection>
        <div className="pub-contact">
          {rows.map((r) => (
            <article className="pub-card" key={r.title}>
              <span className="pub-ic">{r.ic}</span>
              <h3>{r.title}</h3>
              <p>{r.body}</p>
              <PubLink className="pub-mail" to={mailto(r.subject)}>
                {email}
              </PubLink>
            </article>
          ))}
        </div>
      </PubSection>
      <p className="pub-sub">{t('c.pub.contact.salonNote')}</p>
      <PubCta
        title={t('c.pub.contact.help')}
        primary={{ label: t('c.pub.helpCenter'), to: '/help' }}
        secondary={{ label: t('c.pub.partnerSupport'), to: '/partner-support' }}
      />
    </PublicPage>
  );
}
