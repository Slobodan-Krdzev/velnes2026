import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAvailability, useSalonDetail, useSalonServices } from '../../lib/api/queries.js';
import { fmtMKD, type CategoryVM, type SalonVM } from '../../lib/api/mappers.js';
import {
  rememberPendingFavourite,
  useFavourites,
  useSession,
} from '../../lib/api/session.js';
import type { FavouriteKind } from '@velnes/contracts';

/* Icons lifted from the prototype's SVG map — exact markup. */
export const IcArr = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h13M13 6l6 6-6 6" /></svg>
);
export const IcHeart = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round"><path d="M12 20s-7.4-4.6-7.4-9.4A4.3 4.3 0 0 1 12 8a4.3 4.3 0 0 1 7.4 2.6C19.4 15.4 12 20 12 20z" /></svg>
);
export const IcVok = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3.5l7 2.5v5c0 4.5-3 8-7 9.5-4-1.5-7-5-7-9.5V6z" /><path d="M9 12l2 2 4-4" /></svg>
);
export const IcSpark = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l1.7 5.2L19 10l-5.3 1.8L12 17l-1.7-5.2L5 10l5.3-1.8zM19 15l.9 2.6L22.5 19l-2.6.9L19 22.5l-.9-2.6L15.5 19l2.6-.9z" /></svg>
);
export const IcSearch = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4.2-4.2" /></svg>
);
export const IcPin = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s6.5-6 6.5-10.5a6.5 6.5 0 1 0-13 0C5.5 15 12 21 12 21z" /><circle cx="12" cy="10.5" r="2.4" /></svg>
);
export const IcClock = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
);
export const FlowerMark = (
  <svg viewBox="0 0 30 29" height="15" fill="#FFF9F7" aria-hidden="true"><path d="M29.7675 10.7637C28.8761 8.0534 25.9691 6.58211 23.2947 7.47263C20.0389 8.51802 18.7598 13.3965 15.7753 14.4806C15.8528 11.3057 20.1164 8.55674 20.1164 5.14953C20.1164 2.28438 17.8296 0 15.0001 0C12.1706 0 9.88382 2.28438 9.88382 5.11081C9.88382 8.55674 14.1861 11.267 14.2249 14.4419C11.2404 13.3965 9.96134 8.51802 6.70552 7.47263C4.03111 6.58211 1.12413 8.0534 0.271416 10.7637C-0.620057 13.4352 0.852811 16.3391 3.56599 17.2296C6.78304 18.275 10.659 15.1389 13.721 15.9519C11.7443 18.4299 6.78304 18.1589 4.8063 20.9466C3.13963 23.231 3.68227 26.4446 5.96909 28.1095C8.25591 29.7744 11.473 29.2323 13.1396 26.9479C15.1551 24.1602 13.2559 19.4753 15.0389 16.8425C16.8218 19.4753 14.9613 24.1602 16.9381 26.9479C18.6047 29.2323 21.783 29.7744 24.1086 28.1095C26.3954 26.4446 26.9381 23.2697 25.2714 20.9466C23.2947 18.1976 18.2947 18.4299 16.3567 15.9519C19.4187 15.1389 23.2559 18.275 26.5117 17.2296C29.1474 16.3391 30.6203 13.4352 29.7675 10.7637Z" /></svg>
);

/** Category card — renderCats' exact template. The generic mark stands in
 *  until HQ dresses the category with its own icon. */
export function CatCard({ c }: { c: CategoryVM }) {
  const nav = useNavigate();
  return (
    <a
      className="catcard"
      href="#"
      onClick={(e) => {
        e.preventDefault();
        nav(`/s/${c.slug}`);
      }}
    >
      <span className="cph" style={{ backgroundImage: c.img }}>
        <span className="cbadge">
          {c.iconUrl ? <img src={c.iconUrl} width={18} height={18} alt="" /> : IcSpark}
        </span>
      </span>
      <span className="cbd">
        <span>
          <b>{c.name}</b>
        </span>
        <span className="carr">{IcArr}</span>
      </span>
    </a>
  );
}

/**
 * The heart — Phase C, docs/FAVOURITES.md.
 *
 * One component behind every heart in the app, so they cannot disagree
 * about what is saved or behave differently from each other. The state
 * comes from the single favourites query rather than from each card, so
 * a salon hearted on the home page is hearted on the salon page too.
 *
 * Signed out it still draws, because hiding it hides the reason to have
 * an account. Tapping remembers the one thing you meant to save and
 * sends you to sign in; it is applied when you come back, once.
 */
export function FavHeart({
  kind,
  id,
  label,
  className = 'fav',
}: {
  kind: FavouriteKind;
  id: string;
  label: string;
  className?: string;
}) {
  const nav = useNavigate();
  const { signedIn } = useSession();
  const { saved, toggle } = useFavourites();
  const [failed, setFailed] = useState(false);
  const on = signedIn && saved(kind, id);
  return (
    <button
      className={on ? `${className} on` : className}
      aria-pressed={on}
      aria-label={on ? `Remove ${label} from favourites` : `Save ${label} to favourites`}
      title={failed ? 'Could not save that — try again' : undefined}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        if (!signedIn) {
          rememberPendingFavourite({ kind, id });
          nav('/login');
          return;
        }
        void toggle(kind, id).then((ok) => setFailed(!ok));
      }}
    >
      {IcHeart}
    </button>
  );
}

/** Salon recommendation card — the prototype's rc2 markup, fed real data.
 *  Rating/distance/price rows wait for their subsystems; the city line is
 *  what we can honestly say today. */
export function SalonCard({ s }: { s: SalonVM }) {
  const nav = useNavigate();
  return (
    <article className="rc2" onClick={() => nav(`/salon/${s.slug}`)}>
      <div className="rph" style={{ backgroundImage: s.photo }}>
        {s.serviceCategories[0] ? (
          <span
            className="flag"
            style={{ background: '#fff', color: 'var(--ink)', top: '10px', left: '10px', padding: '4px 11px', fontSize: '11.5px' }}
          >
            {s.serviceCategories[0]}
          </span>
        ) : null}
        <FavHeart kind="salon" id={s.id} label={s.name} />
      </div>
      <div className="rbd">
        <h3>{s.name}</h3>
        <div className="rrow2">
          <span>{s.city}</span>
        </div>
      </div>
    </article>
  );
}

/** "Available near you" — live data end to end: the salon's first online
 *  service, its real from-price, and today's first two open slots. */
export function useSalonLive(slug: string) {
  const detail = useSalonDetail(slug);
  const locationId = detail.data?.locations?.[0]?.id;
  const key = detail.data?.publishableKey;
  const services = useSalonServices(key, locationId);
  const svc = services.data?.services[0];
  const today = new Date().toISOString().slice(0, 10);
  const avail = useAvailability({ key, locationId, serviceId: svc?.id, date: today });
  const slots = (avail.data?.slots ?? []).filter((x) => x.free).map((x) => x.t);
  return { detail: detail.data, svc, slots: slots.slice(0, 2), today };
}

export function NearYouD({ s }: { s: SalonVM }) {
  const nav = useNavigate();
  const { detail, svc, slots, today } = useSalonLive(s.slug);
  if (!detail || !svc) return null;
  const from = Math.min(svc.price, svc.priceFrom ?? svc.price);
  return (
    <article className="card ac">
      <div className="ph" style={{ backgroundImage: s.photo }}></div>
      <div className="bd">
        <h3>{svc.name}</h3>
        <div className="meta">
          {s.name} · {s.city}
        </div>
        <div className="from">
          from <b>{fmtMKD(from)}</b>
        </div>
        <div className="slotrow">
          {slots.map((t) => (
            <button
              key={t}
              className="slot-s"
              onClick={() => nav(`/salon/${s.slug}?service=${svc.id}&date=${today}&time=${t}`)}
            >
              Today {t}
            </button>
          ))}
        </div>
      </div>
    </article>
  );
}

export function NearYouM({ s }: { s: SalonVM }) {
  const nav = useNavigate();
  const { detail, svc, slots, today } = useSalonLive(s.slug);
  if (!detail || !svc) return null;
  const from = Math.min(svc.price, svc.priceFrom ?? svc.price);
  return (
    <article className="card m-venue" style={{ gridTemplateColumns: '96px 1fr' }}>
      <div className="ph" style={{ backgroundImage: s.photo }}></div>
      <div>
        <h3 style={{ fontSize: '15px' }}>{svc.name}</h3>
        <div className="meta">
          <span>
            {s.name} · {s.city}
          </span>
          <span className="from">
            from <b>{fmtMKD(from)}</b>
          </span>
        </div>
        <div className="slotrow" style={{ marginTop: '7px' }}>
          {slots.map((t) => (
            <button
              key={t}
              className="slot-s"
              onClick={() => nav(`/salon/${s.slug}?service=${svc.id}&date=${today}&time=${t}`)}
            >
              Today {t}
            </button>
          ))}
        </div>
      </div>
    </article>
  );
}

/** Search suggestions, desktop panel flavor — real categories and salons
 *  matching the query (or the head of each list while it's empty). */
export function useSuggestions(q: string, cats: CategoryVM[], salons: SalonVM[]) {
  const needle = q.toLowerCase().trim();
  const mc = needle ? cats.filter((c) => c.name.toLowerCase().includes(needle)) : cats;
  const ms = needle ? salons.filter((s) => s.name.toLowerCase().includes(needle)) : salons;
  return { cats: mc.slice(0, 2), salons: ms.slice(0, 2), salonCount: (cat: CategoryVM) => salons.filter((s) => s.serviceCategories.includes(cat.name)).length };
}

export function SugPanelD({ q, cats, salons }: { q: string; cats: CategoryVM[]; salons: SalonVM[] }) {
  const nav = useNavigate();
  const sug = useSuggestions(q, cats, salons);
  return (
    <div className="sugg" id="d-sugg">
      {sug.cats.length ? (
        <div className="h">
          <span className="spark" style={{ display: 'inline-flex', gap: '7px', alignItems: 'center' }}>
            {IcSpark}
            <span style={{ color: 'var(--ink)' }}>Velnes thinks along with you</span>
          </span>
          <span className="tiny-tag">Most chosen</span>
        </div>
      ) : null}
      {sug.cats.map((c) => (
        <button key={c.id} className="sug-card" onClick={() => nav(`/s/${c.slug}`)}>
          <span className="ph" style={{ backgroundImage: c.img }}></span>
          <span>
            <b>{c.name}</b>
            <span className="sm muted">{sug.salonCount(c)} salons available</span>
          </span>
          <span className="btn btn-dark" style={{ minHeight: '42px' }}>
            View options {IcArr}
          </span>
        </button>
      ))}
      {sug.salons.length ? (
        <div className="h" style={{ paddingTop: '4px' }}>
          <span style={{ display: 'inline-flex', gap: '7px', alignItems: 'center', color: 'var(--muted)', fontWeight: '600' }}>
            {IcSearch}Search a specific salon
          </span>
        </div>
      ) : null}
      {sug.salons.map((s) => (
        <button key={s.slug} className="sug-card" onClick={() => nav(`/salon/${s.slug}`)}>
          <span className="ph" style={{ backgroundImage: s.photo }}></span>
          <span>
            <b>{s.name}</b>
            <span className="sm muted" style={{ display: 'inline-flex', gap: '6px', alignItems: 'center', marginTop: '4px' }}>
              <span className="vok">{IcVok}</span>
              Book directly at this salon
            </span>
          </span>
          <span className="btn btn-g" style={{ minHeight: '42px' }}>
            View salon {IcArr}
          </span>
        </button>
      ))}
      <div className="sug-foot">
        <span style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--ok)' }}></span>Every option is live &amp; bookable
        </span>
        <span style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }} className="spark">
          {IcSpark}
          <span className="muted">No match? We&rsquo;ll show smart alternatives.</span>
        </span>
      </div>
    </div>
  );
}

/** The mobile sheet's suggestion list — m-sug flavor of the same data. */
export function SugListM({ q, cats, salons, onGo }: { q: string; cats: CategoryVM[]; salons: SalonVM[]; onGo: () => void }) {
  const nav = useNavigate();
  const sug = useSuggestions(q, cats, salons);
  return (
    <div className="list">
      {sug.cats.length ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <span className="spark" style={{ display: 'inline-flex', gap: '7px', alignItems: 'center', fontWeight: '700', color: 'var(--ink)' }}>
            {IcSpark}Velnes thinks along with you
          </span>
          <span className="tiny-tag">Most chosen</span>
        </div>
      ) : null}
      {sug.cats.map((c) => (
        <button
          key={c.id}
          className="m-sug card"
          onClick={() => {
            onGo();
            nav(`/s/${c.slug}`);
          }}
        >
          <span className="ph" style={{ backgroundImage: c.img }}></span>
          <span>
            <b>{c.name}</b>
            <span className="sm muted">
              {sug.salonCount(c)} salons · <span className="avail" style={{ fontSize: '12px' }}>instantly bookable</span>
            </span>
          </span>
        </button>
      ))}
      {sug.salons.length ? (
        <div className="sm muted" style={{ display: 'flex', gap: '6px', alignItems: 'center', margin: '6px 0 10px' }}>
          {IcSearch}Search a specific salon
        </div>
      ) : null}
      {sug.salons.map((s) => (
        <button
          key={s.slug}
          className="m-sug card"
          onClick={() => {
            onGo();
            nav(`/salon/${s.slug}`);
          }}
        >
          <span className="ph" style={{ backgroundImage: s.photo }}></span>
          <span>
            <b>{s.name}</b>
            <span className="sm muted" style={{ display: 'block', marginTop: '4px' }}>
              Book directly at this salon
            </span>
            <span className="vok" style={{ marginTop: '4px' }}>
              {IcVok} Verified
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
