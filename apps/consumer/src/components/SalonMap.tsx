import L from 'leaflet';
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
  lat: number;
  lng: number;
  label: string;
  sub?: string;
  /** The subject of the page — rendered in brand colour. */
  here?: boolean;
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
}) {
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
        attributionControl: true,
        zoomControl: interactive,
        scrollWheelZoom: false,
        dragging: interactive,
        doubleClickZoom: interactive,
        touchZoom: interactive,
      });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors',
      }).addTo(map);
    } catch {
      return;
    }
    const labelled: L.Marker[] = [];
    const markers = pins.map((p) => {
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
      else
        m.bindPopup(
          `<b style="font-family:inherit">${escapeHtml(p.label)}</b>${p.sub ? `<br><span>${escapeHtml(p.sub)}</span>` : ''}`,
        );
      if (p.onClick) {
        m.on('click', p.onClick);
        m.getElement()?.style.setProperty('cursor', 'pointer');
      }
      return m;
    });
    // Framing, in order of what the person cares about: where they are
    // (with the results around them), then the results, then the city.
    if (center) map.setView([center.lat, center.lng], markers.length ? zoom : 13);
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
  }, [stable, zoom, interactive, labels]);

  // Follow the person as they move — but gently: re-centre when they
  // first arrive and whenever they walk off the edge, never while they
  // are panning around a map they are reading.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !center) {
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
  }, [center?.lat, center?.lng, center, zoom, built]);

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
      const ring = L.circle(at, {
        radius: you.accuracy ?? 40,
        color: '#FF8D67',
        weight: 1,
        fillColor: '#FF8D67',
        fillOpacity: 0.12,
      }).addTo(map);
      const dot = L.marker(at, { icon: YOU, zIndexOffset: 500 }).addTo(map);
      dot.bindTooltip('You are here', { direction: 'top', offset: [0, -8] });
      youRef.current = { dot, ring };
    }
  }, [you?.lat, you?.lng, you?.accuracy, you, built]);

  return (
    <div
      ref={boxRef}
      role="application"
      aria-label="Map"
      style={{
        height,
        borderRadius: radius,
        overflow: 'hidden',
        border: '1px solid var(--line-soft)',
        position: 'relative',
      }}
    >
      {!pins.length && emptyNote ? <span className="map-note">{emptyNote}</span> : null}
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
