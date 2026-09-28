import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { PriceBand, SearchFacets } from '@velnes/contracts';
import { fmtMKD, slugify } from '../../lib/api/mappers.js';
import { t } from '../../lib/i18n-core.js';
import { useCategories, useMostChosen, useTowns } from '../../lib/api/queries.js';
import { useUserLocation } from '../../lib/geo.js';
import { FAMOUS_TOWNS, matchTowns, normTown } from '../../lib/towns.js';
import { IcBolt, IcPin, IcSearch, IcSpark } from './cards.js';
import { SugListM } from './cards.js';
import { useSuggest, type SuggestItem } from './useSuggest.js';

/**
 * The phone's one search-and-filter sheet — Alex, 2026-09-28.
 *
 * A form, not a live filter: What / Where / When / Price are sections
 * of one card, the active one open and the others folded into a row
 * that states their answer. Choosing changes only the sheet's own
 * state; nothing runs and the URL does not move until **Search**. Then
 * everything is applied together, as one URL, so a narrowed answer is
 * the thing that gets shared and the back button undoes it at once.
 *
 * Built from what the doors can honestly answer. **When** is "Any
 * time" or "Available now" — a bookable start no more than 30 minutes
 * away, the door's own now-mode — and nothing about dates, because the
 * search door knows no dates yet. **Where** is "Nearby" (the results
 * page's own location flow: the question if it was never asked, then
 * 2 / 5 / 10 km) or one of the towns salons are actually in. **Price**
 * is the door's three bands, shown only when the current answer has
 * them. A salon in the suggestions is a destination, not a filter, and
 * still opens directly.
 *
 * Opened from the home pill, the results pill and the Search tab; it
 * lives once, above the routes, and reads the URL it opens over so a
 * results page's filters come back as its answers.
 */

export type WhatPick = { kind: 'text'; text: string } | { kind: 'category'; slug: string; name: string } | null;

interface SheetState {
  what: WhatPick;
  nearby: boolean;
  radiusKm: number | null;
  city: string | null;
  now: boolean;
  priceBand: PriceBand | null;
}
const EMPTY: SheetState = { what: null, nearby: false, radiusKm: null, city: null, now: false, priceBand: null };

type Section = 'what' | 'where' | 'when' | 'price';

interface OpenOptions {
  /** The price bands of the answer the sheet opens over, when any. */
  facets?: SearchFacets | null;
  section?: Section;
}
interface SheetApi {
  open: (opts?: OpenOptions) => void;
  close: () => void;
  isOpen: boolean;
}
const Ctx = createContext<SheetApi | null>(null);

export function useSearchSheet(): SheetApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('useSearchSheet outside SearchSheetProvider');
  return api;
}

const NEAR_KM = 10;

export function SearchSheetProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<OpenOptions>({});
  const api = useMemo<SheetApi>(
    () => ({
      open: (o = {}) => {
        setOpts(o);
        setOpen(true);
      },
      close: () => setOpen(false),
      isOpen: open,
    }),
    [open],
  );
  return (
    <Ctx.Provider value={api}>
      {children}
      {open ? <SearchSheet opts={opts} onClose={() => setOpen(false)} /> : null}
    </Ctx.Provider>
  );
}

/** The state a results URL already holds, so the sheet opens on it. */
function fromUrl(params: URLSearchParams, pathname: string, catName: string | null): SheetState {
  const km = Number(params.get('km'));
  const band = params.get('price');
  const q = params.get('q');
  const catSlug = pathname.startsWith('/s/') ? decodeURIComponent(pathname.slice(3)) : null;
  return {
    what: catSlug ? { kind: 'category', slug: catSlug, name: catName ?? catSlug } : q ? { kind: 'text', text: q } : null,
    nearby: Number.isFinite(km) && km > 0,
    radiusKm: Number.isFinite(km) && km > 0 ? km : null,
    city: params.get('city'),
    now: params.get('now') === '1',
    priceBand: band === 'low' || band === 'mid' || band === 'high' ? band : null,
  };
}

function SearchSheet({ opts, onClose }: { opts: OpenOptions; onClose: () => void }) {
  useTranslation(); // re-render on a language change; strings come from the shared instance
  const nav = useNavigate();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const geo = useUserLocation();
  const towns = useTowns().data?.towns ?? [];
  const mostChosen = useMostChosen().data?.categories ?? [];
  const onOffer = useCategories().data?.categories ?? [];
  /** What an empty field offers: the most booked categories first, then
   *  every other category on offer — the same fallback the results
   *  landing uses, so a platform with no bookings yet (a fresh
   *  production) still offers its whole shelf rather than a blank. */
  const browse = useMemo(() => {
    const seen = new Set(mostChosen.map((c) => c.id));
    return [...mostChosen, ...onOffer.filter((c) => !seen.has(c.id))];
  }, [mostChosen, onOffer]);
  const facets = opts.facets ?? null;

  // A category page names its category in the title the results page
  // derived; here the slug is enough and the name is looked up from the
  // most-chosen list when it happens to be there.
  const catNameFor = (slug: string) => browse.find((c) => slugify(c.name) === slug)?.name ?? null;
  const [st, setSt] = useState<SheetState>(() => {
    const base = fromUrl(params, pathname, null);
    if (base.what?.kind === 'category') base.what = { ...base.what, name: catNameFor(base.what.slug) ?? base.what.name };
    return base;
  });
  const [section, setSection] = useState<Section>(opts.section ?? 'what');
  const [text, setText] = useState(st.what?.kind === 'text' ? st.what.text : '');
  /** Where, typed: filters the suggested towns, or names one of your own. */
  const [whereText, setWhereText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const suggest = useSuggest(text);

  useEffect(() => {
    if (section === 'what') {
      input.current?.focus();
      input.current?.select();
    }
  }, [section]);

  // Escape closes, and the page behind does not scroll while it is up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const patch = (p: Partial<SheetState>) => setSt((s) => ({ ...s, ...p }));

  /** A suggestion: a category becomes the answer to What; a treatment
   *  or a salon is a destination and opens at once, as it always has. */
  const choose = useCallback(
    (item: SuggestItem) => {
      if (item.kind === 'category' && item.slug) {
        patch({ what: { kind: 'category', slug: item.slug, name: item.label } });
        setText('');
        setSection('where');
        return;
      }
      onClose();
      nav(item.href, { replace: true });
    },
    [nav, onClose],
  );
  const pickCategory = (slug: string, name: string) => {
    patch({ what: { kind: 'category', slug, name } });
    setText('');
    setSection('where');
  };

  /** Nearby: the button's own flow — the question if never asked, a
   *  fresh fix if allowed — started now so the position is in hand by
   *  the time Search is pressed. The URL still carries the intent. */
  const nearBlocked = geo.decision === 'refused' || geo.status === 'unsupported';
  const pickTown = (name: string) => {
    patch({ city: name, nearby: false, radiusKm: null });
    setWhereText('');
    setSection('when');
  };
  const typedTown = whereText.trim();
  /** Autocomplete over the platform's towns and the gazetteer. */
  const townMatches = matchTowns(typedTown, towns);
  const typedIsKnown = townMatches.some((tw) => normTown(tw.name) === normTown(typedTown));
  /** The well-known places as quick picks, with the platform's counts. */
  const famous = FAMOUS_TOWNS.map((name) => ({
    name,
    salons: towns.find((tw) => normTown(tw.name) === normTown(name))?.salons ?? 0,
  }));
  const townSub = (n: number) =>
    n === 0 ? t('c.ss.noSalonsYet') : n === 1 ? t('c.cards.salonOne', { n: 1 }) : t('c.cards.salonMany', { n });
  const pickNearby = () => {
    if (st.nearby) {
      patch({ nearby: false, radiusKm: null });
      return;
    }
    patch({ nearby: true, city: null, radiusKm: st.radiusKm ?? NEAR_KM });
    if (geo.status !== 'on') {
      if (geo.decision === null) geo.decide(true);
      else if (geo.decision === 'allowed') geo.locate();
    }
  };

  const whatText = text.trim();
  const whatLabel = st.what?.kind === 'category' ? st.what.name : st.what?.kind === 'text' ? st.what.text : whatText || null;
  const whereLabel = st.nearby
    ? st.radiusKm ? t('c.ss.nearbyKm', { km: st.radiusKm }) : t('c.ss.nearby')
    : (st.city ?? null);
  const whenLabel = st.now ? t('c.now') : null;
  const priceLabel =
    facets?.price && st.priceBand
      ? st.priceBand === 'low'
        ? t('c.res.upTo', { p: fmtMKD(facets.price.lowMax) })
        : st.priceBand === 'mid'
          ? `${fmtMKD(facets.price.lowMax)}–${fmtMKD(facets.price.midMax)}`
          : t('c.res.over', { p: fmtMKD(facets.price.midMax) })
      : null;

  /** Something must be asked: a treatment or category, or "now", which
   *  is the whole-catalogue question on its own. A town or a price
   *  alone is a narrowing of nothing. */
  const asks = Boolean(whatLabel && (st.what?.kind === 'category' || whatText.length >= 2 || st.what?.kind === 'text')) || st.now;
  const anything = Boolean(whatLabel || st.nearby || st.city || st.now || st.priceBand);

  const search = () => {
    if (!asks) return;
    const p = new URLSearchParams();
    const what: WhatPick = whatText.length >= 2 ? { kind: 'text', text: whatText } : st.what;
    let path = '/search';
    if (what?.kind === 'category') path = `/s/${what.slug}`;
    else if (what?.kind === 'text') p.set('q', what.text);
    else p.set('q', t('c.home.nowQuery')); // "now" alone: anything, now
    if (st.now) p.set('now', '1');
    if (st.city && !st.nearby) p.set('city', st.city);
    if (st.nearby) {
      // A position never rides in a URL (SEARCH.md §9): the results page
      // resolves `near=1` — a radius once there is a fix, nothing if the
      // person said no — and the chosen distance comes along for it.
      p.set('near', '1');
      if (st.radiusKm && st.radiusKm !== NEAR_KM) p.set('km', String(st.radiusKm));
      else if (st.radiusKm) p.set('km', String(NEAR_KM));
    }
    if (st.priceBand && facets?.price) p.set('price', st.priceBand);
    onClose();
    const qs = p.toString();
    nav(qs ? `${path}?${qs}` : path);
  };

  const row = (id: Section, title: string, value: string | null, placeholder: string) => (
    <button type="button" className="ss-row" onClick={() => setSection(id)} aria-expanded={false}>
      <span className="ss-row-k">{title}</span>
      <span className={`ss-row-v${value ? ' set' : ''}`}>{value ?? placeholder}</span>
    </button>
  );

  return (
    <div className="ss" role="dialog" aria-modal="true" aria-label={t('c.res.search')}>
      <div className="ss-top">
        <button type="button" className="ss-close" onClick={onClose} aria-label={t('c.res.close')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
      <div className="ss-body">
        {/* ── What? ─────────────────────────────────────────────── */}
        {section === 'what' ? (
          <section className="ss-card open">
            <h2 className="ss-h">{t('c.ss.what')}</h2>
            {st.what?.kind === 'category' ? (
              <div className="ss-picked">
                <span className="chip on">
                  {IcSpark}
                  {st.what.name}
                </span>
                <button type="button" className="ss-link" onClick={() => patch({ what: null })}>
                  {t('c.ss.change')}
                </button>
              </div>
            ) : null}
            <div className="m-search ss-field">
              {IcSearch}
              <input
                ref={input}
                value={text}
                placeholder={t('c.res.searchPh')}
                aria-label={t('c.res.search')}
                onChange={(e) => {
                  setText(e.target.value);
                  if (st.what?.kind === 'category') patch({ what: null });
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && whatText.length >= 2) {
                    patch({ what: { kind: 'text', text: whatText } });
                    setSection('where');
                  }
                }}
              />
              {text ? (
                <button type="button" className="ss-x" onClick={() => setText('')} aria-label={t('c.res.clear')}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
                </button>
              ) : null}
            </div>
            <div className="ss-list">
              {suggest.short ? (
                browse.length ? (
                  <>
                    <div className="ss-sub">
                      {IcSpark}
                      {mostChosen.length ? t('c.cards.mostChosen') : t('c.res.browse')}
                    </div>
                    {browse.slice(0, 8).map((c) => (
                      <button key={c.id} type="button" className="ss-opt" onClick={() => pickCategory(slugify(c.name), c.name)}>
                        <span className="ss-opt-ic">{IcSearch}</span>
                        <span>
                          <b>{c.name}</b>
                        </span>
                      </button>
                    ))}
                  </>
                ) : null
              ) : (
                <SugListM q={text} active={-1} onChoose={choose} onOpenCategory={(slug) => pickCategory(slug, catNameFor(slug) ?? slug)} />
              )}
            </div>
          </section>
        ) : (
          row('what', t('c.ss.what'), whatLabel, t('c.ss.whatPh'))
        )}

        {/* ── Where? ────────────────────────────────────────────── */}
        {section === 'where' ? (
          <section className="ss-card open">
            <h2 className="ss-h">{t('c.ss.where')}</h2>
            <button
              type="button"
              className={`ss-opt${st.nearby ? ' on' : ''}`}
              onClick={pickNearby}
              disabled={nearBlocked}
              aria-pressed={st.nearby}
            >
              <span className="ss-opt-ic">{IcPin}</span>
              <span>
                <b>{t('c.ss.nearby')}</b>
                <span className="sm muted">{nearBlocked ? t('c.geo.enableHint') : t('c.ss.nearbySub')}</span>
              </span>
            </button>
            {st.nearby ? (
              <div className="ss-chips">
                {[2, 5, 10].map((km) => (
                  <button key={km} type="button" className={`chip${st.radiusKm === km ? ' on' : ''}`} onClick={() => patch({ radiusKm: km })} aria-pressed={st.radiusKm === km}>
                    {t('c.res.withinKm', { km })}
                  </button>
                ))}
              </div>
            ) : null}
            {/* A town, typed or picked. The suggestions are the towns
                salons are actually in, most first — a name here is a
                promise there is something to book — and anything typed
                can be used as it is; a town with nothing in it answers
                honestly on the results page. */}
            <div className="m-search ss-field" style={{ marginTop: 6 }}>
              {IcPin}
              <input
                value={whereText}
                placeholder={t('c.ss.wherePh')}
                aria-label={t('c.ss.wherePh')}
                onChange={(e) => setWhereText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && typedTown) pickTown(townMatches[0]?.name ?? typedTown);
                }}
              />
              {whereText ? (
                <button type="button" className="ss-x" onClick={() => setWhereText('')} aria-label={t('c.res.clear')}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
                </button>
              ) : null}
            </div>
            {typedTown && !typedIsKnown ? (
              <button type="button" className="ss-opt" onClick={() => pickTown(typedTown)}>
                <span className="ss-opt-ic">{IcSearch}</span>
                <span>
                  <b>{t('c.ss.useTown', { town: typedTown })}</b>
                </span>
              </button>
            ) : null}
            {(typedTown ? townMatches : famous).map((tw) => (
              <button
                key={tw.name}
                type="button"
                className={`ss-opt${!st.nearby && normTown(st.city ?? '') === normTown(tw.name) ? ' on' : ''}`}
                onClick={() => pickTown(tw.name)}
                aria-pressed={!st.nearby && normTown(st.city ?? '') === normTown(tw.name)}
              >
                <span className="ss-opt-ic">{IcPin}</span>
                <span>
                  <b>{tw.name}</b>
                  <span className="sm muted">{townSub(tw.salons)}</span>
                </span>
              </button>
            ))}
          </section>
        ) : (
          row('where', t('c.ss.where'), whereLabel, t('c.ss.anywhere'))
        )}

        {/* ── When? ─────────────────────────────────────────────── */}
        {section === 'when' ? (
          <section className="ss-card open">
            <h2 className="ss-h">{t('c.ss.when')}</h2>
            <button type="button" className={`ss-opt${!st.now ? ' on' : ''}`} onClick={() => patch({ now: false })} aria-pressed={!st.now}>
              <span className="ss-opt-ic">{IcSearch}</span>
              <span>
                <b>{t('c.ss.anyTime')}</b>
              </span>
            </button>
            <button type="button" className={`ss-opt${st.now ? ' on' : ''}`} onClick={() => patch({ now: true })} aria-pressed={st.now}>
              <span className="ss-opt-ic">{IcBolt}</span>
              <span>
                <b>{t('c.now')}</b>
                <span className="sm muted">{t('c.nowTitle')}</span>
              </span>
            </button>
          </section>
        ) : (
          row('when', t('c.ss.when'), whenLabel, t('c.ss.anyTime'))
        )}

        {/* ── Price — only when this answer has bands ───────────── */}
        {facets?.price ? (
          section === 'price' ? (
            <section className="ss-card open">
              <h2 className="ss-h">{t('c.ss.price')}</h2>
              <div className="ss-chips">
                <button type="button" className={`chip${!st.priceBand ? ' on' : ''}`} onClick={() => patch({ priceBand: null })}>
                  {t('c.res.anyPrice')}
                </button>
                <button type="button" className={`chip${st.priceBand === 'low' ? ' on' : ''}`} onClick={() => patch({ priceBand: 'low' })}>
                  {t('c.res.upTo', { p: fmtMKD(facets.price.lowMax) })}
                </button>
                <button type="button" className={`chip${st.priceBand === 'mid' ? ' on' : ''}`} onClick={() => patch({ priceBand: 'mid' })}>
                  {fmtMKD(facets.price.lowMax)}–{fmtMKD(facets.price.midMax)}
                </button>
                <button type="button" className={`chip${st.priceBand === 'high' ? ' on' : ''}`} onClick={() => patch({ priceBand: 'high' })}>
                  {t('c.res.over', { p: fmtMKD(facets.price.midMax) })}
                </button>
              </div>
            </section>
          ) : (
            row('price', t('c.ss.price'), priceLabel, t('c.res.anyPrice'))
          )
        ) : null}
      </div>
      <div className="ss-foot">
        <button
          type="button"
          className="ss-link"
          onClick={() => {
            setSt(EMPTY);
            setText('');
            setWhereText('');
            setSection('what');
          }}
          disabled={!anything && !text}
        >
          {t('c.ss.clearAll')}
        </button>
        <button type="button" className="btn btn-p ss-go" onClick={search} disabled={!asks}>
          {IcSearch}
          {t('c.res.search')}
        </button>
      </div>
    </div>
  );
}
