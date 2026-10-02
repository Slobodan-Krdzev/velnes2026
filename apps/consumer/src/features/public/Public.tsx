import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { t } from '../../lib/i18n-core.js';
import { usePageMeta } from '../../lib/pageMeta.js';
import { IcArr } from '../discovery/cards.js';

/**
 * The public information pages (Alex, 2026-09-30): one small kit —
 * hero, section, card grid, numbered steps, questions, a call-to-action
 * panel, an empty state — so the sixteen pages read as one site rather
 * than sixteen designs. One tree for every width, like the Premium
 * page: the global header, tab bar and footer are the chrome; the kit
 * only lays out the middle.
 */

/** A link that stays in the app for an app path and leaves it for a URL. */
export function PubLink({
  to,
  className,
  children,
}: {
  to: string;
  className?: string;
  children: ReactNode;
}) {
  const nav = useNavigate();
  const external = /^(https?:|mailto:|tel:)/.test(to);
  return (
    <a
      className={className}
      href={to}
      {...(external && /^https?:/.test(to) ? { target: '_blank', rel: 'noreferrer' } : {})}
      onClick={(e) => {
        if (external || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        nav(to);
      }}
    >
      {children}
    </a>
  );
}

export function PublicPage({
  screen,
  title,
  description,
  noindex = false,
  narrow = false,
  children,
}: {
  screen: string;
  title: string;
  description: string;
  noindex?: boolean;
  narrow?: boolean;
  children: ReactNode;
}) {
  useTranslation();
  usePageMeta({ title, description, noindex });
  return (
    <section data-screen={screen} className={`pub${narrow ? ' pub-narrow' : ''}`}>
      <div className="pub-wrap">{children}</div>
    </section>
  );
}

export function PubHero({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  children?: ReactNode;
}) {
  return (
    <header className="pub-hero">
      {eyebrow ? <span className="pub-eyebrow">{eyebrow}</span> : null}
      <h1 className="serif">{title}</h1>
      {lead ? <p className="pub-lead">{lead}</p> : null}
      {children}
    </header>
  );
}

export function PubSection({
  title,
  sub,
  children,
}: {
  title?: string;
  sub?: string;
  children: ReactNode;
}) {
  return (
    <section className="pub-sec">
      {title ? <h2 className="serif">{title}</h2> : null}
      {sub ? <p className="pub-sub">{sub}</p> : null}
      {children}
    </section>
  );
}

export function PubGrid({ cols = 2, children }: { cols?: 2 | 3; children: ReactNode }) {
  return <div className={`pub-grid cols-${cols}`}>{children}</div>;
}

export function PubCard({ icon, title, body }: { icon?: ReactNode; title: string; body: string }) {
  return (
    <article className="pub-card">
      {icon ? <span className="pub-ic">{icon}</span> : null}
      <h3>{title}</h3>
      <p>{body}</p>
    </article>
  );
}

export function PubSteps({ steps }: { steps: { title?: string; body: string }[] }) {
  return (
    <ol className="pub-steps">
      {steps.map((s, i) => (
        <li key={i}>
          <span className="pub-n">{i + 1}</span>
          <div>
            {s.title ? <h3>{s.title}</h3> : null}
            <p>{s.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Questions that open one at a time — the browser's own disclosure,
 *  so keyboard and screen readers get it for free. */
export function PubFaq({ items }: { items: { q: string; a: string }[] }) {
  return (
    <div className="pub-faq">
      {items.map((it) => (
        <details key={it.q}>
          <summary>{it.q}</summary>
          <p>{it.a}</p>
        </details>
      ))}
    </div>
  );
}

export function PubList({ items }: { items: string[] }) {
  return (
    <ul className="pub-list">
      {items.map((s) => (
        <li key={s}>{s}</li>
      ))}
    </ul>
  );
}

export function PubCta({
  title,
  body,
  primary,
  secondary,
}: {
  title: string;
  body?: string;
  primary: { label: string; to: string };
  secondary?: { label: string; to: string };
}) {
  return (
    <div className="pub-cta">
      <b>{title}</b>
      {body ? <p>{body}</p> : null}
      <div className="pub-actions">
        <PubLink className="btn btn-p" to={primary.to}>
          {primary.label} {IcArr}
        </PubLink>
        {secondary ? (
          <PubLink className="btn btn-g" to={secondary.to}>
            {secondary.label}
          </PubLink>
        ) : null}
      </div>
    </div>
  );
}

export function PubEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="pub-empty">
      <b>{title}</b>
      <p>{body}</p>
    </div>
  );
}

/** "Still need help?" — the one way to reach Velnes, under the pages
 *  where a reader may be stuck. */
export function PubContact({ email }: { email: string }) {
  return (
    <div className="pub-cta">
      <b>{t('c.pub.stillNeed')}</b>
      <p>{t('c.pub.stillNeedSub')}</p>
      <div className="pub-actions">
        <PubLink className="btn btn-p" to={`mailto:${email}`}>
          {t('c.pub.writeTo', { email })}
        </PubLink>
        <PubLink className="btn btn-g" to="/contact">
          {t('c.pub.contactUs')}
        </PubLink>
      </div>
    </div>
  );
}

/** The plain-language legal pages: a date, and a line saying what the
 *  page is — a description of the product as it is. */
export function PubUpdated({ date }: { date: string }) {
  return (
    <p className="pub-updated">
      {t('c.pub.lastUpdated', { date })} · {t('c.pub.plainNote')}
    </p>
  );
}
