import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { WhenSchema, type DiscoverySuggestion, type PriceBand, type SearchFacets, type When } from '@velnes/contracts';
import { fmtMKD, slugify } from '../../lib/api/mappers.js';
import { t } from '../../lib/i18n-core.js';
import { useCategories, useMostChosen, useSuggestions, useTowns } from '../../lib/api/queries.js';
import { useSession } from '../../lib/api/session.js';
import { distanceKm, useUserLocation } from '../../lib/geo.js';
import { FAMOUS_TOWNS, matchTowns, normTown } from '../../lib/towns.js';
import { IcPin, IcSearch, IcSpark } from './cards.js';
import { SUGGEST_ICONS, iconFor } from './suggestIcons.js';
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
 *
 * **What? before typing is discovery, not a database** (Alex,
 * 2026-09-29): the door's suggestions — search *intents*, each carrying
 * the What / Where / When it stands for and the honest reason it is
 * offered — shaped by the viewer's own account when they allow it, by
 * the town or position known, or by what is on offer. Picking one fills
 * every dimension it names and moves to the next unanswered question;
 * typing is the other mode, and is the shared suggestions as before.
 */

export type WhatPick = { kind: 'text'; text: string } | { kind: 'category'; slug: string; name: string } | null;

interface SheetState {
  what: WhatPick;
  nearby: boolean;
  radiusKm: number | null;
  city: string | null;
  now: boolean;
  /** A day with a free start — exclusive with `now`. */
  when: When | null;
  priceBand: PriceBand | null;
}
const EMPTY: SheetState = { what: null, nearby: false, radiusKm: null, city: null, now: false, when: null, priceBand: null };

type Section = 'what' | 'where' | 'when' | 'price';

/**
 * When? — "Any time", "Available now" (a bookable start no more than 30
 * minutes away, soonest first), and since 2026-09-30 (Alex) the days
 * the door admits on: today, tomorrow, this weekend — only what has a
 * free start that day, in the salon's own clock. A chosen date is
 * still not here: the door takes words, not dates, so a shared link
 * stays true next week; a date picker means a `date` on both doors.
 */
export type WhenKind = 'any' | 'now' | When;
const WHEN_OPTIONS: { kind: WhenKind; icon: keyof typeof SUGGEST_ICONS; title: string; sub: string | null }[] = [
  { kind: 'any', icon: 'calendar', title: 'c.ss.anyTime', sub: null },
  { kind: 'now', icon: 'bolt', title: 'c.now', sub: 'c.nowTitle' },
  { kind: 'today', icon: 'calendar', title: 'c.when.today', sub: 'c.when.sub' },
  { kind: 'tomorrow', icon: 'calendar', title: 'c.when.tomorrow', sub: 'c.when.sub' },
  { kind: 'weekend', icon: 'calendar', title: 'c.when.weekend', sub: 'c.when.sub' },
];

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
/** Quick-pick towns: how many, and how far from the person. */
const TOWN_PICKS = 5;
const TOWN_REACH_KM = 100;

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
    when: WhenSchema.safeParse(params.get('when')).data ?? null,
    priceBand: band === 'low' || band === 'mid' || band === 'high' ? band : null,
  };
}

function SearchSheet({ opts, onClose }: { opts: OpenOptions; onClose: () => void }) {
  useTranslation(); // re-render on a language change; strings come from the shared instance
  const nav = useNavigate();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const geo = useUserLocation();
  const { token } = useSession();
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
  /**
   * Quick picks (Alex, 2026-09-29): at most five towns, only ones that
   * have salons — a town with nothing to book is not a suggestion —
   * and, when the person's position is known, only those within 100 km
   * of them (a town's place is the centre of its salons' pins). Most
   * salons first, the well-known order breaking ties. If nothing is
   * within reach the five with most salons stand in, since an empty row
   * of towns says less than a far one. Any other town can be typed.
   */
  const rank = (name: string) => {
    const i = FAMOUS_TOWNS.findIndex((f) => normTown(f) === normTown(name));
    return i < 0 ? FAMOUS_TOWNS.length : i;
  };
  const withSalons = towns
    .filter((tw) => tw.salons > 0)
    .slice()
    .sort((a, b) => b.salons - a.salons || rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
  const pos = geo.position;
  const within = pos
    ? withSalons.filter((tw) => tw.lat != null && tw.lng != null && distanceKm(pos, { lat: tw.lat, lng: tw.lng }) <= TOWN_REACH_KM)
    : withSalons;
  const famous = (within.length ? within : withSalons).slice(0, TOWN_PICKS);
  const townSub = (n: number) =>
    n === 0 ? t('c.ss.noSalonsYet') : n === 1 ? t('c.cards.salonOne', { n: 1 }) : t('c.cards.salonMany', { n });
  /** Nearby needs a position: ask now if never asked, take a fresh fix
   *  if allowed, so it is in hand by the time Search is pressed. */
  const askForPosition = () => {
    if (geo.status !== 'on') {
      if (geo.decision === null) geo.decide(true);
      else if (geo.decision === 'allowed') geo.locate();
    }
  };
  const pickNearby = () => {
    if (st.nearby) {
      patch({ nearby: false, radiusKm: null });
      return;
    }
    // Nearby means within 10 km (Alex, 2026-09-29): one answer, no chips
    // — the results page still narrows or widens it afterwards.
    patch({ nearby: true, city: null, radiusKm: NEAR_KM });
    askForPosition();
  };

  /**
   * Discovery: the door's suggestions for the empty field, shaped by the
   * viewer (token), the town chosen here so far, and the position when
   * there is one — so answering Where first changes what What offers.
   */
  const sugg = useSuggestions(geo.position, st.nearby ? null : st.city, token);

  /**
   * After a suggestion the sheet walks on in order — Where next, then
   * When — even when the suggestion already answered them: its answer
   * is lit in the opened card, so the person confirms or changes it on
   * the way rather than discovering it later in a collapsed row. Only a
   * suggestion that said nothing about What stays on What.
   */
  const nextSection = (next: SheetState): Section => (!next.what && !next.now ? 'what' : 'where');

  /**
   * A suggestion is a search intent: apply every dimension it names,
   * leave the rest as they were, and move on — nothing runs until
   * Search. A salon is a destination and opens at once, as it always
   * has. Nearby is dropped when the person refused location: the sheet
   * never claims to know where they are.
   */
  const applyIntent = (sg: DiscoverySuggestion) => {
    const it = sg.intent;
    if (it.salon) {
      onClose();
      nav(`/salon/${it.salon.slug}`);
      return;
    }
    const next: SheetState = { ...st };
    if (it.category) {
      next.what = { kind: 'category', slug: slugify(it.category.name), name: it.category.name };
      setText('');
    }
    if (it.city) {
      next.city = it.city;
      next.nearby = false;
      next.radiusKm = null;
    } else if (it.nearby && !nearBlocked) {
      next.nearby = true;
      next.city = null;
      next.radiusKm = NEAR_KM;
      askForPosition();
    }
    if (it.now) {
      next.now = true;
      next.when = null;
    }
    setSt(next);
    setSection(nextSection(next));
  };

  const whatText = text.trim();
  const whatLabel = st.what?.kind === 'category' ? st.what.name : st.what?.kind === 'text' ? st.what.text : whatText || null;
  const whereLabel = st.nearby
    ? st.radiusKm ? t('c.ss.nearbyKm', { km: st.radiusKm }) : t('c.ss.nearby')
    : (st.city ?? null);
  const whenLabel = st.now ? t('c.now') : st.when ? t(`c.when.${st.when}`) : null;
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
  const anything = Boolean(whatLabel || st.nearby || st.city || st.now || st.when || st.priceBand);

  const search = () => {
    if (!asks) return;
    const p = new URLSearchParams();
    const what: WhatPick = whatText.length >= 2 ? { kind: 'text', text: whatText } : st.what;
    let path = '/search';
    if (what?.kind === 'category') path = `/s/${what.slug}`;
    else if (what?.kind === 'text') p.set('q', what.text);
    else p.set('q', t('c.home.nowQuery')); // "now" alone: anything, now
    if (st.now) p.set('now', '1');
    else if (st.when) p.set('when', st.when);
    if (st.city && !st.nearby) p.set('city', st.city);
    if (st.nearby) {
      // A position never rides in a URL (SEARCH.md §9): the results page
      // resolves `near=1` — a radius once there is a fix, nothing if the
      // person said no — and the chosen distance comes along for it.
      p.set('near', '1');
      p.set('km', String(NEAR_KM));
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
                <Discovery
                  data={sugg.data ?? null}
                  loading={sugg.isLoading}
                  fallback={sugg.isError ? browse : []}
                  onPick={applyIntent}
                  onPickCategory={pickCategory}
                />
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
            {WHEN_OPTIONS.map((o) => {
              const on = o.kind === 'now' ? st.now : o.kind === 'any' ? !st.now && !st.when : st.when === o.kind;
              const pick = () => patch({ now: o.kind === 'now', when: o.kind === 'now' || o.kind === 'any' ? null : o.kind });
              return (
                <button key={o.kind} type="button" className={`ss-opt${on ? ' on' : ''}`} onClick={pick} aria-pressed={on}>
                  <span className="ss-opt-ic">{SUGGEST_ICONS[o.icon]}</span>
                  <span>
                    <b>{t(o.title)}</b>
                    {o.sub ? <span className="sm muted">{t(o.sub)}</span> : null}
                  </span>
                </button>
              );
            })}
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

/** The words a suggestion wears, from its kind — so it localises here. */
function wordsFor(sg: DiscoverySuggestion): { title: string; sub: string | null } {
  const cat = sg.intent.category?.name ?? '';
  const n = sg.salons ?? 0;
  switch (sg.kind) {
    case 'salon_again':
      return { title: t('c.sugg.salonAgain', { salon: sg.intent.salon?.name ?? '' }), sub: t(sg.reason === 'favourite' ? 'c.sugg.favouriteSub' : 'c.sugg.visitedSub') };
    case 'category_again':
      return { title: t('c.sugg.categoryAgain', { cat }), sub: t('c.sugg.historySub') };
    case 'category_now':
      return { title: t('c.sugg.categoryNow', { cat }), sub: t('c.sugg.nowNearSub') };
    case 'category_town':
      return { title: t('c.sugg.categoryTown', { cat, town: sg.intent.city ?? '' }), sub: n === 1 ? t('c.sugg.townOne') : t('c.sugg.townMany', { n }) };
    case 'category_near':
      return { title: t('c.sugg.categoryNear', { cat }), sub: n === 1 ? t('c.sugg.nearOne', { km: sg.intent.radiusKm ?? 10 }) : t('c.sugg.nearMany', { n, km: sg.intent.radiusKm ?? 10 }) };
    case 'category_popular':
      return { title: cat, sub: t('c.sugg.popularSub') };
    case 'category_offer':
      return { title: cat, sub: n === 1 ? t('c.sugg.offerOne') : t('c.sugg.offerMany', { n }) };
    case 'now_all':
      return { title: t('c.now'), sub: t(sg.intent.nearby ? 'c.sugg.nowAllNearSub' : 'c.sugg.nowAllSub') };
  }
}

/**
 * The empty field's list: the door's suggestions as rows — icon for the
 * meaning, title dominant, a subtitle only where it carries something.
 * While the door answers, three quiet placeholders; if it failed, the
 * shelf of categories, which is honest and never wrong.
 */
function Discovery({
  data,
  loading,
  fallback,
  onPick,
  onPickCategory,
}: {
  data: { how: 'history' | 'context' | 'default'; suggestions: DiscoverySuggestion[] } | null;
  loading: boolean;
  fallback: { id: string; name: string }[];
  onPick: (s: DiscoverySuggestion) => void;
  onPickCategory: (slug: string, name: string) => void;
}) {
  if (loading && !data)
    return (
      <div className="ss-list" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="ss-opt ss-opt-skel" aria-hidden="true">
            <span className="ss-opt-ic" />
            <span className="ss-opt-tx" style={{ flex: 1 }}>
              <span className="skel-line w60" />
              <span className="skel-line w40" />
            </span>
          </div>
        ))}
      </div>
    );
  const rows = data?.suggestions ?? [];
  if (!rows.length) {
    if (!fallback.length) return null;
    return (
      <div className="ss-list">
        <div className="ss-sub">{t('c.res.browse')}</div>
        {fallback.slice(0, 8).map((c) => (
          <button key={c.id} type="button" className="ss-opt" onClick={() => onPickCategory(slugify(c.name), c.name)}>
            <span className="ss-opt-ic">{SUGGEST_ICONS.sparkle}</span>
            <span className="ss-opt-tx">
              <b>{c.name}</b>
            </span>
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="ss-list">
      <div className="ss-sub">
        {IcSpark}
        {t(data?.how === 'history' ? 'c.sugg.forYou' : 'c.sugg.ideas')}
      </div>
      {rows.map((sg) => {
        const w = wordsFor(sg);
        return (
          <button key={sg.id} type="button" className="ss-opt" onClick={() => onPick(sg)}>
            <span className="ss-opt-ic">{SUGGEST_ICONS[iconFor(sg)]}</span>
            <span className="ss-opt-tx">
              <b>{w.title}</b>
              {w.sub ? <span className="sm muted">{w.sub}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
