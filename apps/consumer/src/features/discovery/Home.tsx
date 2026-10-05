import { useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { categoryVM, salonVM } from '../../lib/api/mappers.js';
import { NO_FILTERS, useCategories, useNewest, useRecommended, useSalons, useSearch } from '../../lib/api/queries.js';
import { useSession } from '../../lib/api/session.js';
import { distanceKm, useUserLocation } from '../../lib/geo.js';
import { businessOnboardingUrl } from '../../lib/business.js';
import { GeoPrompt } from '../../components/GeoPrompt.js';
import { useTranslation } from 'react-i18next';
import { t } from '../../lib/i18n-core.js';
import { IcBolt, IcMark, IcSearch, IcSpark, NowNearD, NowNearM, SalonCard, SugPanelD } from './cards.js';
import { useSearchBox } from './useSearchBox.js';
import { useSearchSheet } from './SearchSheet.js';
import { CategoryRail } from './CategoryRail.js';
import { Rail } from './Rail.js';
import { BizFab } from './BizFab.js';
import { SkelRail } from '../../components/Skeleton.js';
import { useWheelScroll } from '../../lib/useWheelScroll.js';

/** The home screen — prototype markup verbatim (both environments), fed
 *  by the live discovery doors. Offers and testimonial blocks wait for
 *  their subsystems (no fabricated data).
 *
 *  The phone's order, since 2026-09-29 (Alex): search, the smart chips,
 *  then Recommended, Available now, Explore treatments (the treatment
 *  rail, moved down under its own heading), Newest — so nothing
 *  competes with the search box in the first screen. The desktop tree
 *  is unchanged. */
export function Home() {
  const nav = useNavigate();
  /**
   * The desktop search card. Its suggestions, keyboard handling and the
   * three ways out of a suggestion list are `useSearchBox`'s — the same
   * ones the results page uses.
   *
   * The phone has no search box of its own here any more: tapping the
   * pill, or Search in the tab bar, both go to the results screen,
   * which is where a phone types. Two controls called "search" that
   * opened different screens was the thing to fix. Since 2026-09-28
   * (Alex) the phone home has no hero and no top bar either: it opens
   * on the same sticky search pill the results screen has — the mark
   * beside it is the way home — with the suggestion chips under it.
   */
  useTranslation();
  const d = useSearchBox();
  /** The phone's search sheet — what the pill and the Search tab open. */
  const sheet = useSearchSheet();

  /**
   * Location, on the way in.
   *
   * Nobody has answered yet: the prompt asks, once, before anything
   * else. Answered yes: a fresh fix is taken every time this page opens
   * — the decision is what is remembered, never the place, so there is
   * nothing to reuse and nothing to be stale. Answered no: nothing
   * happens here at all; "Near me" says how to change that.
   */
  const geo = useUserLocation();
  const askGeo = geo.decision === null && geo.status !== 'unsupported';
  useEffect(() => {
    // Every entry, not only the first: a browser that said no last
    // time may have been allowed since, and this is where that is
    // found out. Only an ask already in flight, or a fix already in
    // hand, is left alone.
    if (geo.decision === 'allowed' && geo.status !== 'on' && geo.status !== 'asking') geo.locate();
    // Entry only: `locate` is stable, and a status change mid-visit
    // (a refusal, say) must not re-ask.
  }, [geo.decision]);

  const catsQ = useCategories();
  const salonsQ = useSalons();
  /**
   * "Available now near you": the search door asked for *now* alone —
   * every treatment that can start within the half hour, from the same
   * gate a booking goes through — sorted here by distance from the
   * viewer when a position is known (Alex, 2026-09-23). No position:
   * the door's own order, and a line saying location would sort it.
   */
  const { token } = useSession();
  const nowQ = useSearch('now', geo.position, token, { ...NO_FILTERS, now: true });
  /** "Recommended": the door's answer, and why — never the first four. */
  const recoQ = useRecommended(geo.position, token);
  const reco = useMemo(() => (recoQ.data?.salons ?? []).map(salonVM), [recoQ.data]);
  const recoTitle = recoQ.data?.how === 'history' ? t('c.home.recoForYou') : recoQ.data?.how === 'nearby' ? t('c.home.recoNearby') : t('c.home.recommended');
  // The phone's recommended row is swiped, and slides under a wheel too.
  const mRecoRef = useRef<HTMLDivElement | null>(null);
  useWheelScroll(mRecoRef);
  /** "Newest to Velnes": joined within the door's window, newest first;
   *  each card says how many days ago. Hidden when there are none. */
  const newestQ = useNewest();
  const newest = useMemo(() => {
    const now = Date.now();
    return (newestQ.data?.salons ?? []).map((s) =>
      salonVM({ ...s, reason: { kind: 'new', days: Math.floor((now - new Date(s.joinedAt).getTime()) / 86_400_000) } }),
    );
  }, [newestQ.data]);
  const mNewRef = useRef<HTMLDivElement | null>(null);
  useWheelScroll(mNewRef);
  const nowNear = useMemo(() => {
    const pos = geo.position;
    return (nowQ.data?.services ?? [])
      .filter((s) => s.availableAt)
      .map((s) => ({
        s,
        km: pos && s.salon.lat != null && s.salon.lng != null ? distanceKm(pos, { lat: s.salon.lat, lng: s.salon.lng }) : null,
      }))
      .sort((a, b) => (a.km ?? Number.POSITIVE_INFINITY) - (b.km ?? Number.POSITIVE_INFINITY))
      .slice(0, 6);
  }, [nowQ.data, geo.position]);
  const cats = useMemo(() => (catsQ.data?.categories ?? []).map(categoryVM), [catsQ.data]);
  const salons = useMemo(() => (salonsQ.data?.salons ?? []).map(salonVM), [salonsQ.data]);
  /**
   * Where "Search" goes.
   *
   * It used to open whichever category happened to sort first, which
   * made tapping Search silently run a search for Assessment — a
   * different answer every time the taxonomy changed, and never one
   * anybody asked for. `/search` with no query is the search screen
   * itself: the field, and everything there is to browse.
   */
  const goAll = () => nav('/search');
  const openWith = (v: string) => {
    d.setQ(v);
    d.setOpen(true);
  };
  /**
   * "Available now" — everything that can start within the half hour,
   * near the person. The word alone is the door's whole-catalogue *now*
   * question (in the viewer's own language, so the box reads naturally);
   * `near=1` asks the results page for a radius the way its Near-me
   * button would — a position never rides in a URL (SEARCH.md §9).
   */
  /** Every "Velnes for Business" door on this page: the workspace's onboarding. */
  const bizUrl = businessOnboardingUrl();
  const goNow = () => nav(`/search?q=${encodeURIComponent(t('c.home.nowQuery'))}&via=chip`);
  /**
   * The six chips, each a whole search (Alex, 2026-09-30): "Available
   * now" is anything that can start within the half hour; "Massage
   * tomorrow" and "Facial this weekend" carry a day the door admits on;
   * "Haircut near me" asks the results page for Near me the way its
   * button would (`near=1`, an intent — a position never rides in a
   * URL); "Manicure" is the word; "Couple massage" is massage for two —
   * only where two can be seen at the same time. The words go to the
   * door in English, which its synonyms know in every language.
   */
  // A chip is a treatment search, never a salon lookup (Alex, 2026-10-02):
  // `via=chip` tells the results page to leave salons that merely carry
  // the word out. A typed "Massage" still offers them.
  const goChip = (q: string, extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({ q, ...extra, via: 'chip' });
    nav(`/search?${p.toString()}`);
  };
  const chips = (
    <>
      <button className="qchip qchip-now" onClick={goNow}>{IcBolt}{t('c.home.chipNow')}</button>
      <button className="qchip" onClick={() => goChip('Massage', { when: 'tomorrow' })}>{t('c.home.chipMassage')}</button>
      <button className="qchip" onClick={() => goChip('Haircut', { near: '1' })}>{t('c.home.chipHaircut')}</button>
      <button className="qchip" onClick={() => goChip('Facial', { when: 'weekend' })}>{t('c.home.chipFacial')}</button>
      <button className="qchip" onClick={() => goChip('Manicure')}>{t('c.home.chipManicure')}</button>
      <button className="qchip" onClick={() => goChip('Massage', { party: '2' })}>{t('c.home.chipCouple')}</button>
    </>
  );
  /** Velnes Premium, in one band: what it gives, and the page that says
   *  the rest. After "Why Velnes" on both layouts (Alex, 2026-09-22). */
  const premBand = (
    <div className="prem-band">
      <span className="prem-band-eyebrow">{t('c.home.premEyebrow')}</span>
      <div className="prem-band-body">
        <span className="tx">
          <b>{t('c.home.premTitle')}</b>
          <p>{t('c.home.premSub')}</p>
        </span>
        <button className="btn btn-p" onClick={() => nav('/premium')}>
          {t('c.home.premBtn')}{' '}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h13M13 6l6 6-6 6" /></svg>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {askGeo ? <GeoPrompt onAllow={() => geo.decide(true)} onDeny={() => geo.decide(false)} /> : null}
      <div className="d-env">
        <section data-screen="home"><div className="d-hero"><div className="ph" style={{backgroundImage:'var(--im)'}}></div><div className="hero-in"><h1>{t('c.home.heroTitle')}</h1><p className="lead">{t('c.home.heroLead')}</p></div></div><div className="hero-curve"></div>{d.open ? <div className="sug-scrim" aria-hidden="true" /> : null}<div className={'searchcard'+(d.open?' open':'')+(d.q?' has':'')} id="d-search" ref={d.boxRef}><div className="field2"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4.2-4.2" /></svg><input id="d-q" placeholder={t('c.res.searchPh')} aria-controls="d-sugg" {...d.inputProps} /><span className="sp2"><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l1.7 5.2L19 10l-5.3 1.8L12 17l-1.7-5.2L5 10l5.3-1.8zM19 15l.9 2.6L22.5 19l-2.6.9L19 22.5l-.9-2.6L15.5 19l2.6-.9z" /></svg></span></div><div className="qchips">{chips}</div>{d.open ? <SugPanelD q={d.q} active={d.keys.active} onChoose={d.choose} onOpenCategory={d.openCat} /> : null}</div><div className="d-wrap"><CategoryRail categories={cats} /><div className="sec-h" style={{margin:'30px 0 14px'}}><h2>{recoTitle}</h2><a className="sm" style={{fontWeight:'700',color:'var(--brand-hover)'}} href="#" onClick={(e)=>{e.preventDefault();goAll();}}>{t('c.home.viewAll')}</a></div>{recoQ.isLoading && salonsQ.isLoading ? <SkelRail n={3} /> : <Rail track="reco2">{(reco.length ? reco : salons).map((s)=>(<SalonCard key={s.slug} s={s} />))}</Rail>}{newestQ.isLoading ? (<div style={{margin:'30px 0 14px'}}><SkelRail n={3} /></div>) : newest.length ? (<><div className="sec-h" style={{margin:'30px 0 14px'}}><h2>{t('c.home.newest')}</h2></div><p className="sm muted" style={{margin:'-6px 0 12px'}}>{t('c.home.newestSub', { n: newestQ.data?.days ?? 30 })}</p><Rail track="reco2">{newest.map((s)=>(<SalonCard key={s.slug} s={s} />))}</Rail></>) : null}<div className="trust4"><div className="t4"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3.5l7 2.5v5c0 4.5-3 8-7 9.5-4-1.5-7-5-7-9.5V6z" /><path d="M9 12l2 2 4-4" /></svg><span><b>{t('c.home.trusted')}</b><small>{t('c.home.trustedSub')}</small></span></div><div className="t4"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3.5v3M16 3.5v3" /></svg><span><b>{t('c.home.instant')}</b><small>{t('c.home.instantSub')}</small></span></div><div className="t4"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h7l9 9-7 7-9-9z" /><circle cx="8.5" cy="8.5" r="1.4" /></svg><span><b>{t('c.home.bestPrices')}</b><small>{t('c.home.bestPricesSub')}</small></span></div><div className="t4"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><rect x="5" y="10.5" width="14" height="9" rx="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></svg><span><b>{t('c.home.secure')}</b><small>{t('c.home.secureSub')}</small></span></div></div>{nowQ.isLoading ? (<div style={{margin:'30px 0 14px'}}><SkelRail n={3} /></div>) : nowNear.length ? (<><div className="sec-h"><h2>{t('c.home.available')}</h2><a className="sm" style={{fontWeight:'700',color:'var(--brand-hover)'}} href="#" onClick={(e)=>{e.preventDefault();goAll();}}>{t('c.home.viewAll')}</a></div><p className="sm muted" style={{margin:'-6px 0 12px'}}>{t('c.home.availableSub')}{geo.position ? '' : ` ${t('c.home.nearestHint')}`}</p><Rail track="avail4">{nowNear.map((n)=>(<NowNearD key={n.s.id} n={n} />))}</Rail></>) : null}<div className="sec-h"><h2>{t('c.home.why')}</h2></div><div className="why5"><div className="w"><span className="ic"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3.5v3M16 3.5v3" /></svg></span><span><b>{t('c.home.instantSub')}</b><p>{t('c.home.whyRtSub')}</p></span></div><div className="w"><span className="ic"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3.5l7 2.5v5c0 4.5-3 8-7 9.5-4-1.5-7-5-7-9.5V6z" /><path d="M9 12l2 2 4-4" /></svg></span><span><b>{t('c.home.whyPros')}</b><p>{t('c.home.whyProsSub')}</p></span></div><div className="w"><span className="ic"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h7l9 9-7 7-9-9z" /><circle cx="8.5" cy="8.5" r="1.4" /></svg></span><span><b>{t('c.home.whyDeals')}</b><p>{t('c.home.whyDealsSub')}</p></span></div><div className="w"><span className="ic"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="4" y="9" width="16" height="11" rx="2" /><path d="M4 13h16M12 9v11" /></svg></span><span><b>{t('c.home.whyMember')}</b><p>{t('c.home.whyMemberSub')}</p></span></div><div className="w"><span className="ic"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M12 20s-7.4-4.6-7.4-9.4A4.3 4.3 0 0 1 12 8a4.3 4.3 0 0 1 7.4 2.6C19.4 15.4 12 20 12 20z" /></svg></span><span><b>{t('c.home.whyAll')}</b><p>{t('c.home.whyAllSub')}</p></span></div></div>{premBand}<div className="proban"><span className="ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 15c0-5 4-9 10-9h4v3c0 5-4 9-10 9H5z" /><path d="M5 21c2-4 5-7 9-9" /></svg></span><span className="tx"><b>{t('c.home.proTitle')}</b><p>{t('c.home.proSub')}</p></span><a className="btn btn-w" href={bizUrl}>{t('c.home.proJoin')} <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h13M13 6l6 6-6 6" /></svg></a></div><div style={{height:'26px'}}></div><div className="closing2"><div className="cs cc"><div style={{flex:'1',minWidth:'0'}}><span className="eyeb">{t('c.home.forVisitors')}</span><h2>{t('c.home.selfCare')}</h2><p>{t('c.home.selfCareSub')}</p><button className="btn btn-p" onClick={()=>openWith('Massage')}>{t('c.home.joinFree')} <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h13M13 6l6 6-6 6" /></svg></button></div><div className="art" style={{backgroundImage:'var(--im)'}}></div></div><div className="cs cp"><div><span className="eyeb">{t('c.home.forPros')}</span><h2>{t('c.home.growTitle')}</h2><p>{t('c.home.growSub')}</p><a className="btn btn-od" href={bizUrl}>{t('c.home.listBiz')} <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h13M13 6l6 6-6 6" /></svg></a></div></div></div><div style={{height:'50px'}}></div></div></section>
      </div>
      <div className="m-env">
        <BizFab />
        <section data-screen="home"><div className="m-page m-home"><div className="m-topbar"><div className="searchrow"><button className="m-mark" onClick={()=>nav('/')} aria-label={t('c.hdr.home')}>{IcMark}</button><div className="m-search" style={{boxShadow:'none',border:'1px solid var(--line)'}} onClick={()=>sheet.open()}><button type="button" className="m-sheet-open" aria-label={t('c.res.search')}>{IcSearch}</button><input placeholder={t('c.res.searchPh')} aria-label={t('c.res.search')} readOnly /><span className="sp2" style={{color:'var(--brand)',display:'inline-flex'}}>{IcSpark}</span></div></div></div><div className="m-chiprow">{chips}</div><div className="m-sec home-sec first"><div className="h"><h2>{recoTitle}</h2><a className="sm" style={{fontWeight:'700',color:'var(--brand-hover)'}} href="#" onClick={(e)=>{e.preventDefault();goAll();}}>{t('c.home.viewAll')}</a></div></div>{recoQ.isLoading && salonsQ.isLoading ? <SkelRail n={2} m /> : <div className="m-reco" ref={mRecoRef}>{(reco.length ? reco : salons).map((s)=>(<SalonCard key={s.slug} s={s} />))}</div>}{nowQ.isLoading ? (<div style={{margin:'18px 0'}}><SkelRail n={2} m /></div>) : nowNear.length ? (<><div className="m-sec home-sec has-sub"><div className="h"><h2>{t('c.home.available')}</h2><a className="sm" style={{fontWeight:'700',color:'var(--brand-hover)'}} href="#" onClick={(e)=>{e.preventDefault();goAll();}}>{t('c.home.viewAll')}</a></div></div><p className="sm muted home-sub">{t('c.home.availableSub')}{geo.position ? '' : ` ${t('c.home.nearestHint')}`}</p><div className="m-avail">{nowNear.map((n)=>(<NowNearM key={n.s.id} n={n} />))}</div></>) : null}<div className="m-sec home-sec"><div className="h"><h2>{t('c.home.explore')}</h2></div></div><CategoryRail categories={cats} />{newestQ.isLoading ? (<div style={{margin:'18px 0'}}><SkelRail n={2} m /></div>) : newest.length ? (<><div className="m-sec home-sec has-sub"><div className="h"><h2>{t('c.home.newest')}</h2></div></div><p className="sm muted home-sub">{t('c.home.newestSub', { n: newestQ.data?.days ?? 30 })}</p><div className="m-reco" ref={mNewRef}>{newest.map((s)=>(<SalonCard key={s.slug} s={s} />))}</div></>) : null}<div className="m-trust"><div className="t4"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3.5l7 2.5v5c0 4.5-3 8-7 9.5-4-1.5-7-5-7-9.5V6z" /><path d="M9 12l2 2 4-4" /></svg><span><b>{t('c.home.trusted')}</b><small>{t('c.home.trustedSub')}</small></span></div><div className="t4"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3.5v3M16 3.5v3" /></svg><span><b>{t('c.home.instant')}</b><small>{t('c.home.instantSub')}</small></span></div><div className="t4"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h7l9 9-7 7-9-9z" /><circle cx="8.5" cy="8.5" r="1.4" /></svg><span><b>{t('c.home.bestPrices')}</b><small>{t('c.home.bestPricesSub')}</small></span></div><div className="t4"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><rect x="5" y="10.5" width="14" height="9" rx="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></svg><span><b>{t('c.home.secure')}</b><small>{t('c.home.secureSub')}</small></span></div></div><div className="m-band"><span className="i"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg> {t('c.cards.live')}</span><span className="i"><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l1.7 5.2L19 10l-5.3 1.8L12 17l-1.7-5.2L5 10l5.3-1.8zM19 15l.9 2.6L22.5 19l-2.6.9L19 22.5l-.9-2.6L15.5 19l2.6-.9z" /></svg> {t('c.cards.noMatch')}</span></div><div className="m-why"><div style={{display:'flex',gap:'11px',alignItems:'flex-start'}}><span style={{display:'grid',placeItems:'center',width:'38px',height:'38px',background:'#fff',borderRadius:'11px',color:'var(--brand)',flex:'0 0 auto'}}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3.5v3M16 3.5v3" /></svg></span><span><b style={{display:'block',fontSize:'13.5px',color:'var(--ink)'}}>{t('c.home.instantSub')}</b><span className="sm muted">{t('c.home.whyRtSub')}</span></span></div><div style={{display:'flex',gap:'11px',alignItems:'flex-start'}}><span style={{display:'grid',placeItems:'center',width:'38px',height:'38px',background:'#fff',borderRadius:'11px',color:'var(--brand)',flex:'0 0 auto'}}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3.5l7 2.5v5c0 4.5-3 8-7 9.5-4-1.5-7-5-7-9.5V6z" /><path d="M9 12l2 2 4-4" /></svg></span><span><b style={{display:'block',fontSize:'13.5px',color:'var(--ink)'}}>{t('c.home.whyPros')}</b><span className="sm muted">{t('c.home.whyProsSub')}</span></span></div><div style={{display:'flex',gap:'11px',alignItems:'flex-start'}}><span style={{display:'grid',placeItems:'center',width:'38px',height:'38px',background:'#fff',borderRadius:'11px',color:'var(--brand)',flex:'0 0 auto'}}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h7l9 9-7 7-9-9z" /><circle cx="8.5" cy="8.5" r="1.4" /></svg></span><span><b style={{display:'block',fontSize:'13.5px',color:'var(--ink)'}}>{t('c.home.whyDeals')}</b><span className="sm muted">{t('c.home.whyDealsSub')}</span></span></div></div>{premBand}<div className="proban m-proban"><span className="ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 15c0-5 4-9 10-9h4v3c0 5-4 9-10 9H5z" /><path d="M5 21c2-4 5-7 9-9" /></svg></span><span className="tx"><b>{t('c.home.proTitle')}</b><p>{t('c.home.proSub')}</p></span><a className="btn btn-w" href={bizUrl}>{t('c.home.proJoin')} <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h13M13 6l6 6-6 6" /></svg></a></div><div className="m-closing"><div className="cs cc"><span className="eyeb">{t('c.home.forVisitors')}</span><h2 className="serif">{t('c.home.selfCare')}</h2><p>{t('c.home.selfCareSub')}</p><button className="btn btn-p" onClick={()=>nav('/register')}>{t('c.home.joinFree')} <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h13M13 6l6 6-6 6" /></svg></button></div><div className="cs cp"><span className="eyeb">{t('c.home.forPros')}</span><h2>{t('c.home.growTitle')}</h2><p>{t('c.home.growSub')}</p><a className="btn btn-od" href={bizUrl}>{t('c.home.listBiz')} <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h13M13 6l6 6-6 6" /></svg></a></div></div></div></section>
      </div>
    </>
  );
}
