import L from 'leaflet';
import { t } from '../lib/i18n-core.js';
import 'leaflet/dist/leaflet.css';
import './map.css';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { useEffect, useMemo, useRef, useState } from 'react';

/** Real OpenStreetMap, same Leaflet setup the registration wizard uses.
 *  The pins are the ones salons dropped themselves — never derived from
 *  the address text, which is only what we print. */

/** Somewhere to look when nothing else is known yet. */
const SKOPJE: [number, number] = [41.9981, 21.4254];

const PIN = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  shadowSize: [41, 41],
});

/** The brand pin for the salon you are looking at, so it reads apart
 *  from the neighbours on a results map. */
const HERE = L.divIcon({
  className: '',
  html:
    '<span style="display:grid;place-items:center;width:30px;height:30px;border-radius:50% 50% 50% 4px;' +
    'transform:rotate(-45deg);background:var(--brand);box-shadow:0 4px 12px rgba(45,26,18,.35)">' +
    '<span style="width:9px;height:9px;border-radius:50%;background:#FFF9F7"></span></span>',
  iconSize: [30, 30],
  iconAnchor: [15, 30],
  popupAnchor: [0, -28],
});

/**
 * The Velnes marker for a results map (Alex, 2026-09-29): a compact
 * coral dot with a white ring and a soft shadow, and a stronger,
 * larger one with a short name pill when selected. Plain `divIcon`s in
 * the brand token — nothing about them stops a cluster group from
 * taking them later. The name rides on the selected pin only, and only
 * when it is short enough to read on a phone; the card carries the rest.
 */
function velnesPin(p: MapPin, selected: boolean): L.DivIcon {
  // The selected pin says what the card says in a line: the name, and
  // under it the price and a start when the door gave one. Nothing the
  // platform does not know — no rating, since none exist yet.
  const detail = [p.price, p.sub2].filter(Boolean).map((x) => escapeHtml(x!)).join(' · ');
  const pill = selected
    ? `<span class="vpin-lbl"><b>${escapeHtml(p.label)}</b>${detail ? `<small>${detail}</small>` : ''}</span>`
    : '';
  return L.divIcon({
    className: '',
    html: `<span class="vpin${selected ? ' sel' : ''}" role="img"><span class="vpin-dot"></span>${pill}</span>`,
    iconSize: selected ? [30, 30] : [22, 22],
    iconAnchor: selected ? [15, 15] : [11, 11],
  });
}

/** The person's own position: a dot, not a pin — they are not a place
 *  you can book. */
const YOU = L.divIcon({
  className: '',
  html:
    '<span class="you-dot"><span class="you-core"></span></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

export interface MapPin {
  /** What selecting this pin selects — a results map keys pins by it. */
  id?: string;
  lat: number;
  lng: number;
  label: string;
  sub?: string;
  /** The subject of the page — rendered in brand colour. */
  here?: boolean;
  /**
   * A card for the pin: the salon's own photograph, a line about it,
   * and a way into its page. Supplied together or not at all — a pin
   * with `href` opens this instead of navigating on the first click,
   * because a map you cannot touch without leaving it is a map you
   * cannot explore.
   */
  /** A ready-to-use CSS `background-image` value, or null for no
   *  photograph at all — see `hasPhoto` in the mappers. */
  photo?: string | null;
  /** Something true about the salon. Never a rating: there are no
   *  reviews on this platform yet, and a star nobody earned is worse
   *  than no star. */
  badge?: string | null;
  price?: string | null;
  /** A second line for the selected Velnes marker (a start time, say). */
  sub2?: string | null;
  href?: string;
  onClick?: () => void;
}

export function SalonMap({
  pins,
  height,
  zoom = 15,
  interactive = true,
  radius = 14,
  labels = true,
  you = null,
  center = null,
  emptyNote,
  selectedId = null,
  onSelect,
  bottomInset = 0,
  chrome = 'full',
  lookAt = null,
}: {
  pins: MapPin[];
  height: number | string;
  zoom?: number;
  interactive?: boolean;
  radius?: number | string;
  /** Names beside the pins. On a results map that is the whole point;
   *  on a single-salon map the page already says the name. */
  labels?: boolean;
  /** Where the person is, if they have shared it. Drawn as a live dot
   *  and followed as they move. */
  you?: { lat: number; lng: number; accuracy?: number } | null;
  /** What the map should look at. Defaults to the pins. */
  center?: { lat: number; lng: number } | null;
  /** Shown over the map when there is nothing to pin. */
  emptyNote?: string | undefined;
  /**
   * Results mode (Alex, 2026-09-29): pins are Velnes markers keyed by
   * `id`, one of them selected, and a tap selects rather than opening a
   * popup — the sheet under the map carries the salon. No tooltips, no
   * popups in this mode.
   */
  selectedId?: string | null;
  onSelect?: ((id: string) => void) | undefined;
  /** How much of the bottom of the box something else covers (the
   *  results sheet), so framing and panning aim at what can be seen. */
  bottomInset?: number;
  /** 'none' hides Leaflet's own zoom buttons — a phone pinches. */
  chrome?: 'full' | 'none';
  /** A place to look at now (the locate-me control): a new `key` pans
   *  there, into the visible part of the map. */
  lookAt?: { lat: number; lng: number; key: number } | null;
}) {
  const results = Boolean(onSelect);
  const markersById = useRef(new Map<string, L.Marker>());
  const insetRef = useRef(bottomInset);
  insetRef.current = bottomInset;
  const boxRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const youRef = useRef<{ dot: L.Marker; ring: L.Circle } | null>(null);
  const centred = useRef(false);
  // Bumped whenever a map is built, so the dot and the centring redraw
  // onto the new one instead of holding a reference to the old.
  const [built, setBuilt] = useState(0);
  // Callers build the pin list inline, so its identity changes on every
  // render. Redrawing on the content, not the array, keeps the map from
  // being torn down and rebuilt underneath the person using it.
  const sig = pins.map((p) => `${p.lat},${p.lng},${p.label},${p.here ? 1 : 0}`).join('|');
  const live = useRef(pins);
  live.current = pins;
  const stable = useMemo(() => live.current, [sig]);

  useEffect(() => {
    const box = boxRef.current;
    const pins = stable;
    if (!box) return;
    // No layout (headless tests, hidden environment) → nothing to draw.
    if (!box.clientWidth) return;
    let map: L.Map;
    try {
      map = L.map(box, {
        // In results mode the attribution sits at the top, where the
        // sheet cannot cover it (it stays: it is required).
        attributionControl: !results,
        zoomControl: interactive && chrome === 'full',
        // The map zooms to the wheel like every other map anybody has
        // used. Only where the map is interactive at all — a static
        // thumbnail that resized under the page scroll would be a trap.
        scrollWheelZoom: interactive,
        dragging: interactive,
        doubleClickZoom: interactive,
        touchZoom: interactive,
      });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors',
      }).addTo(map);
      if (results) L.control.attribution({ position: 'topright', prefix: false }).addTo(map);
    } catch {
      return;
    }
    const labelled: L.Marker[] = [];
    markersById.current = new Map();
    const markers = pins.map((p) => {
      if (results) {
        // A Velnes marker: selection is a state, set from outside, and a
        // tap reports the pin — the card under the map says the rest.
        const m = L.marker([p.lat, p.lng], { icon: velnesPin(p, false), keyboard: true, title: p.label }).addTo(map);
        if (p.id) markersById.current.set(p.id, m);
        m.on('click', () => p.id && onSelect?.(p.id));
        return m;
      }
      const m = L.marker([p.lat, p.lng], { icon: p.here ? HERE : PIN }).addTo(map);
      if (labels)
        m.bindTooltip(
          `${escapeHtml(p.label)}${p.sub ? `<small>${escapeHtml(p.sub)}</small>` : ''}`,
          {
            permanent: true,
            direction: 'right',
            offset: [10, -10],
            className: `velnes-lbl${p.here ? ' here' : ''}`,
          },
        );
      if (labels && !p.here) labelled.push(m);
      // A pin that can show a card shows one, and the card is what
      // carries you onward. Clicking the pin itself never navigates:
      // one tap to look, one to go.
      if (p.href) {
        m.bindPopup(pinCard(p), { className: 'velnes-pop', minWidth: 218, offset: [0, -6] });
        // A real href, so the row can be middle-clicked or copied — but
        // a plain click stays inside the app instead of reloading it.
        m.on('popupopen', (e) => {
          const go = e.popup.getElement()?.querySelector<HTMLAnchorElement>('.pop-go');
          go?.addEventListener('click', (ev) => {
            if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
            ev.preventDefault();
            p.onClick?.();
          });
        });
      }
      else if (!labels || p.here)
        m.bindPopup(
          `<b style="font-family:inherit">${escapeHtml(p.label)}</b>${p.sub ? `<br><span>${escapeHtml(p.sub)}</span>` : ''}`,
        );
      if (p.onClick && !p.href) {
        m.on('click', p.onClick);
        m.getElement()?.style.setProperty('cursor', 'pointer');
      }
      return m;
    });
    // Framing, in order of what the person cares about: where they are
    // (with the results around them), then the results, then the city.
    const inset = insetRef.current;
    if (results) {
      // The results, framed in the part of the map the sheet leaves
      // visible; a single result is centred there, never zoomed in on.
      if (markers.length === 1) {
        map.setView([pins[0]!.lat, pins[0]!.lng], Math.min(zoom, 15));
        map.panBy([0, inset / 2], { animate: false });
      } else if (markers.length)
        map.fitBounds(L.featureGroup(markers).getBounds().pad(0.15), {
          paddingTopLeft: [24, 72],
          paddingBottomRight: [24, inset + 24],
          maxZoom: 15,
        });
      else if (center) map.setView([center.lat, center.lng], 13);
      else map.setView(SKOPJE, 12);
    } else if (center) map.setView([center.lat, center.lng], markers.length ? zoom : 13);
    else if (markers.length === 1) map.setView([pins[0]!.lat, pins[0]!.lng], zoom);
    else if (markers.length)
      // Never zoom past street level just because two salons share a
      // corner, and leave room for the labels.
      map.fitBounds(L.featureGroup(markers).getBounds().pad(0.3), { maxZoom: 15 });
    else map.setView(SKOPJE, 12);

    // Names are only useful while they can be told apart. Zoomed out
    // over several cities they pile on top of each other, so only the
    // best match keeps its label until the map is close enough to read.
    const LABEL_ZOOM = 11;
    const syncLabels = () => {
      const near = map.getZoom() >= LABEL_ZOOM;
      for (const m of labelled) {
        if (near) m.openTooltip();
        else m.closeTooltip();
      }
    };
    map.on('zoomend', syncLabels);
    syncLabels();
    mapRef.current = map;
    setBuilt((n) => n + 1);
    setTimeout(() => map.invalidateSize(), 0);
    return () => {
      map.remove();
      mapRef.current = null;
      // The markers died with the map; forget them.
      youRef.current = null;
      centred.current = false;
    };
  }, [stable, zoom, interactive, labels, results, chrome]);

  // Selection, in results mode: the icons swap in place — no marker is
  // rebuilt — and the selected pin is brought into the visible part of
  // the map only when it is outside it, so browsing never makes the map
  // jump under the person.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !results) return;
    for (const [id, m] of markersById.current) {
      const p = stable.find((x) => x.id === id);
      if (!p) continue;
      const sel = id === selectedId;
      m.setIcon(velnesPin(p, sel));
      m.setZIndexOffset(sel ? 1000 : 0);
    }
    const sel = selectedId ? markersById.current.get(selectedId) : null;
    if (!sel) return;
    const size = map.getSize();
    const visibleH = Math.max(80, size.y - insetRef.current);
    const pt = map.latLngToContainerPoint(sel.getLatLng());
    const margin = 36;
    const inside = pt.x > margin && pt.x < size.x - margin && pt.y > margin + 40 && pt.y < visibleH - margin;
    if (inside) return;
    // Aim the marker at the centre of what can be seen.
    const target = L.point(size.x / 2, visibleH / 2);
    map.panBy(pt.subtract(target), { animate: true, duration: 0.35 });
  }, [selectedId, results, stable, built]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !lookAt) return;
    const size = map.getSize();
    const target = L.point(size.x / 2, Math.max(80, size.y - insetRef.current) / 2);
    const pt = map.latLngToContainerPoint(L.latLng(lookAt.lat, lookAt.lng));
    map.panBy(pt.subtract(target), { animate: true, duration: 0.4 });
  }, [lookAt?.key, lookAt, built]);

  // Follow the person as they move — but gently: re-centre when they
  // first arrive and whenever they walk off the edge, never while they
  // are panning around a map they are reading. Not in results mode: the
  // results are what is framed there, and the dot is a companion.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !center || results) {
      centred.current = false;
      return;
    }
    const at = L.latLng(center.lat, center.lng);
    if (!centred.current) {
      map.setView(at, Math.max(map.getZoom(), zoom));
      centred.current = true;
    } else if (!map.getBounds().pad(-0.15).contains(at)) {
      map.panTo(at);
    }
  }, [center?.lat, center?.lng, center, zoom, built, results]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!you) {
      youRef.current?.dot.remove();
      youRef.current?.ring.remove();
      youRef.current = null;
      return;
    }
    const at: [number, number] = [you.lat, you.lng];
    if (youRef.current) {
      youRef.current.dot.setLatLng(at);
      youRef.current.ring.setLatLng(at).setRadius(you.accuracy ?? 40);
    } else {
      // The person, not a salon: the conventional blue, so it can never
      // be mistaken for a place to book among coral pins.
      const ring = L.circle(at, {
        radius: you.accuracy ?? 40,
        color: '#2F6FED',
        weight: 1,
        fillColor: '#2F6FED',
        fillOpacity: 0.12,
      }).addTo(map);
      const dot = L.marker(at, { icon: YOU, zIndexOffset: 500 }).addTo(map);
      dot.bindTooltip(t('c.map.youAreHere'), { direction: 'top', offset: [0, -8] });
      youRef.current = { dot, ring };
    }
  }, [you?.lat, you?.lng, you?.accuracy, you, built]);

  return (
    <div
      ref={boxRef}
      role="application"
      aria-label={t('c.map.map')}
      style={{
        height,
        borderRadius: radius,
        overflow: 'hidden',
        border: '1px solid var(--line-soft)',
        position: 'relative',
        /**
         * Leaflet numbers its own insides from 400 (panes) to 1000
         * (controls), and without a stacking context here those compete
         * with the rest of the page directly — so a map in a card
         * painted straight over the sticky "Book now" bar, which sits at
         * 70. Isolating keeps Leaflet's numbers a private matter between
         * Leaflet and this box.
         */
        isolation: 'isolate',
        zIndex: 0,
      }}
    >
      {!pins.length && emptyNote ? <span className="map-note">{emptyNote}</span> : null}
    </div>
  );
}

/**
 * The card a pin opens.
 *
 * Built as a string because Leaflet popups take HTML, so every value
 * that came from a salon goes through `escapeHtml` on the way in — a
 * salon names itself, and a salon naming itself `<script>` must be a
 * salon with an odd name rather than an incident.
 *
 * What it shows is what the platform actually knows: the photograph the
 * salon uploaded, where it is, whether it can be booked, and its
 * cheapest treatment here. There is deliberately no rating — reviews do
 * not exist yet (docs/SEARCH.md §14, docs/CONSUMER-APP.md), and stars
 * nobody earned would be the exact failure the honest-emptiness rule
 * exists to prevent.
 */
function pinCard(p: MapPin): string {
  // No photograph, no strip. An empty grey box is not a placeholder for
  // a picture, it is a picture of nothing — and plenty of salons have
  // not uploaded a gallery yet.
  const photo = p.photo
    ? `<span class="pop-ph" style="background-image:${escapeHtml(p.photo)}"></span>`
    : '';
  const badge = p.badge ? `<span class="pop-badge">${escapeHtml(p.badge)}</span>` : '';
  const price = p.price ? `<span class="pop-price">${escapeHtml(p.price)}</span>` : '';
  return (
    `<span class="pop-card">${photo}` +
    `<b class="pop-name">${escapeHtml(p.label)}</b>` +
    (p.sub ? `<span class="pop-sub">${escapeHtml(p.sub)}</span>` : '') +
    (badge || price ? `<span class="pop-meta">${badge}${price}</span>` : '') +
    `<a class="pop-go" href="${escapeHtml(p.href ?? '#')}">${t('c.cards.viewSalon')}` +
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M13 6l6 6-6 6"/></svg>' +
    '</a></span>'
  );
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
