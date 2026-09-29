import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { SalonMap } from '../../components/SalonMap.js';
import { distanceKm, distanceLbl, useUserLocation } from '../../lib/geo.js';
import { t } from '../../lib/i18n-core.js';
import { IcPin } from './cards.js';

/**
 * The map, as another way to explore the same answer (Alex,
 * 2026-09-29): the map fills the screen behind a floating close and a
 * locate-me control, and a draggable sheet of the results rides over
 * its bottom. One `selectedId` — the salon's slug, which is what a pin
 * is — drives both the marker (icon, pan) and the card (ring, scroll):
 * a tap on either side selects on both. Nothing here touches the
 * search state; closing returns to the results exactly as they were.
 *
 * Three snap points, as shares of the viewport: collapsed (the handle
 * and the count, the map nearly whole), default (a swipeable row of
 * compact cards — the opening state), expanded (the same cards as a
 * list that scrolls inside). The map is told the default sheet height
 * once, so framing and panning aim at what stays visible; dragging the
 * sheet never touches Leaflet.
 */

export interface MapResult {
  /** The salon's slug — the pin's identity and the card's. */
  id: string;
  lat: number;
  lng: number;
  name: string;
  city: string;
  /** CSS background-image value, and whether it is a real photograph. */
  photo: string;
  hasPhoto: boolean;
  bookable: boolean;
  /** The result this salon is here for: its best treatment for the
   *  question, and what it costs — null when prices are hidden. */
  treatment: string;
  price: string | null;
  /** "HH:MM" when the door was asked for now and this can start soon. */
  availableAt: string | null;
  href: string;
}

export type SheetState = 'collapsed' | 'default' | 'expanded';
export const SHEET_SHARE: Record<SheetState, number> = { collapsed: 0.14, default: 0.44, expanded: 0.88 };

/** Where a drag ends: the nearest snap, biased by the direction of a
 *  decisive move so a flick goes one state further rather than back. */
export function snapTo(heightPx: number, viewportPx: number, dragged: number): SheetState {
  const share = heightPx / Math.max(1, viewportPx);
  const order: SheetState[] = ['collapsed', 'default', 'expanded'];
  let best: SheetState = 'default';
  let dist = Infinity;
  for (const s of order) {
    const d = Math.abs(share - SHEET_SHARE[s]);
    if (d < dist) {
      dist = d;
      best = s;
    }
  }
  // A decisive flick (more than 1/12 of the screen) moves one step in
  // its direction even if the nearest snap is where it started.
  // `dragged` is positive when the finger moved up (the sheet grew).
  const flick = Math.abs(dragged) > viewportPx / 12;
  if (flick) {
    const i = order.indexOf(best);
    if (dragged > 0 && i < order.length - 1 && share > SHEET_SHARE[best]) return order[i + 1]!;
    if (dragged < 0 && i > 0 && share < SHEET_SHARE[best]) return order[i - 1]!;
  }
  return best;
}

function useViewportHeight() {
  const [h, setH] = useState(() => (typeof window === 'undefined' ? 800 : window.innerHeight));
  useEffect(() => {
    const read = () => setH(window.visualViewport?.height ?? window.innerHeight);
    read();
    window.addEventListener('resize', read);
    window.visualViewport?.addEventListener('resize', read);
    return () => {
      window.removeEventListener('resize', read);
      window.visualViewport?.removeEventListener('resize', read);
    };
  }, []);
  return h;
}

export function MapResults({ results, onClose }: { results: MapResult[]; onClose: () => void }) {
  useTranslation();
  const nav = useNavigate();
  const geo = useUserLocation();
  const vh = useViewportHeight();
  const [state, setState] = useState<SheetState>('default');
  const [liveH, setLiveH] = useState<number | null>(null); // while dragging
  const [selected, setSelected] = useState<string | null>(results[0]?.id ?? null);
  const [lookAt, setLookAt] = useState<{ lat: number; lng: number; key: number } | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number; startH: number } | null>(null);
  const snapH = Math.round(SHEET_SHARE[state] * vh);
  const sheetH = liveH ?? snapH;
  const defaultH = Math.round(SHEET_SHARE.default * vh);

  // The page behind must not move while the map is up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const body = document.body;
    const y = window.scrollY;
    const prev = { position: body.style.position, top: body.style.top, width: body.style.width, overflow: body.style.overflow };
    body.style.position = 'fixed';
    body.style.top = `-${y}px`;
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.width = prev.width;
      body.style.overflow = prev.overflow;
      window.scrollTo(0, y);
    };
  }, [onClose]);

  /** Bring the selected card into view in whichever layout is up. */
  const reveal = useCallback(
    (id: string) => {
      const i = results.findIndex((r) => r.id === id);
      if (i < 0) return;
      const rail = railRef.current;
      if (rail) {
        const card = rail.children[i] as HTMLElement | undefined;
        if (card) rail.scrollTo({ left: card.offsetLeft - (rail.clientWidth - card.clientWidth) / 2, behavior: 'smooth' });
      }
      const list = listRef.current;
      if (list) (list.children[i] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
    [results],
  );

  /** One selection for both sides. From the map: the sheet rises to at
   *  least its default, so the card can be seen. */
  const select = useCallback(
    (id: string, from: 'map' | 'card') => {
      setSelected(id);
      if (from === 'map' && state === 'collapsed') setState('default');
      // After the layout settles.
      setTimeout(() => reveal(id), 30);
    },
    [state, reveal],
  );

  // Swiping the rail selects the card that settled in the middle.
  const onRailScroll = () => {
    const rail = railRef.current;
    if (!rail) return;
    window.clearTimeout((rail as unknown as { _t?: number })._t);
    (rail as unknown as { _t?: number })._t = window.setTimeout(() => {
      const mid = rail.scrollLeft + rail.clientWidth / 2;
      let best = 0;
      let dist = Infinity;
      Array.from(rail.children).forEach((c, i) => {
        const el = c as HTMLElement;
        const d = Math.abs(el.offsetLeft + el.clientWidth / 2 - mid);
        if (d < dist) {
          dist = d;
          best = i;
        }
      });
      const id = results[best]?.id;
      if (id && id !== selected) setSelected(id);
    }, 120);
  };

  // Dragging the sheet by its handle or header; the map and the list
  // keep their own gestures.
  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { startY: e.clientY, startH: sheetH };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const h = drag.current.startH + (drag.current.startY - e.clientY);
    setLiveH(Math.max(SHEET_SHARE.collapsed * vh * 0.6, Math.min(SHEET_SHARE.expanded * vh, h)));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dragged = drag.current.startY - e.clientY;
    const h = drag.current.startH + dragged;
    drag.current = null;
    setLiveH(null);
    setState(snapTo(h, vh, dragged));
  };

  const pins = useMemo(() => results.map((r) => ({ id: r.id, lat: r.lat, lng: r.lng, label: r.name })), [results]);
  const n = results.length;
  const count = geo.position
    ? n === 1 ? t('c.map.countNearOne') : t('c.map.countNear', { n })
    : n === 1 ? t('c.map.countOne') : t('c.map.count', { n });

  const locateBlocked = geo.decision === 'refused' || geo.status === 'unsupported';
  const locate = () => {
    if (geo.status === 'on' && geo.position) {
      setLookAt({ lat: geo.position.lat, lng: geo.position.lng, key: Date.now() });
      return;
    }
    if (locateBlocked) return;
    if (geo.decision === null) geo.decide(true);
    else geo.locate();
  };
  // A fix that arrives after the button was pressed is looked at once.
  const wanted = useRef(false);
  useEffect(() => {
    if (geo.status === 'on' && geo.position && wanted.current) {
      wanted.current = false;
      setLookAt({ lat: geo.position.lat, lng: geo.position.lng, key: Date.now() });
    }
  }, [geo.status, geo.position]);

  const card = (r: MapResult, compact: boolean) => {
    const on = r.id === selected;
    const away =
      geo.position ? t('c.res.fromYou', { d: distanceLbl(distanceKm(geo.position, { lat: r.lat, lng: r.lng })) }) : null;
    return (
      <article
        key={r.id}
        className={`mr-card${on ? ' on' : ''}${compact ? ' compact' : ''}`}
        aria-pressed={on}
        role="button"
        tabIndex={0}
        onClick={() => select(r.id, 'card')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            select(r.id, 'card');
          }
        }}
      >
        <div className={`ph${r.hasPhoto ? '' : ' tile'}`} style={{ backgroundImage: r.photo }} />
        <div className="bd">
          <h4>{r.name}</h4>
          <div className="sm muted">
            {IcPin} {away ? `${r.city} · ${away}` : r.city}
          </div>
          <div className="mr-line">
            <span className="treat">{r.treatment}</span>
            {r.price ? <b>{r.price}</b> : null}
          </div>
          {r.availableAt ? <div className="avail" style={{ fontSize: 12 }}>{t('c.availNow', { t: r.availableAt })}</div> : null}
          <button
            type="button"
            className="btn btn-g"
            style={{ minHeight: 34, padding: '4px 12px', fontSize: 13, marginTop: 6 }}
            onClick={(e) => {
              e.stopPropagation();
              nav(r.href);
            }}
          >
            {t('c.res.viewBook')}
          </button>
        </div>
      </article>
    );
  };

  return (
    <div className="mr" role="dialog" aria-modal="true" aria-label={t('c.res.mapView')}>
      <div className="mr-map">
        <SalonMap
          pins={pins}
          you={geo.position}
          center={null}
          zoom={13}
          height="100%"
          radius={0}
          labels={false}
          selectedId={selected}
          onSelect={(id) => select(id, 'map')}
          bottomInset={defaultH}
          chrome="none"
          lookAt={lookAt}
        />
      </div>
      <button type="button" className="mr-close" onClick={onClose} aria-label={t('c.res.close')}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
      <button
        type="button"
        className="mr-locate"
        style={{ bottom: sheetH + 14 }}
        onClick={() => {
          wanted.current = geo.status !== 'on';
          locate();
        }}
        disabled={locateBlocked}
        aria-label={t('c.map.locateMe')}
        title={locateBlocked ? t('c.geo.enableHint') : t('c.map.locateMe')}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="6.5" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" /></svg>
      </button>

      <div className={`mr-sheet ${state}${liveH != null ? ' dragging' : ''}`} style={{ height: sheetH }} data-state={state}>
        <div className="mr-grip" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          <span className="mr-handle" aria-hidden="true" />
          <div className="mr-count">{count}</div>
        </div>
        {n === 0 ? (
          <div className="mr-empty sm muted">{t('c.res.noPins')}</div>
        ) : state === 'expanded' ? (
          <div className="mr-list" ref={listRef}>
            {results.map((r) => card(r, false))}
          </div>
        ) : (
          <div className="mr-rail" ref={railRef} onScroll={onRailScroll}>
            {results.map((r) => card(r, true))}
          </div>
        )}
      </div>
    </div>
  );
}
