import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './map.css';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { useEffect, useMemo, useRef } from 'react';

/** Real OpenStreetMap, same Leaflet setup the registration wizard uses.
 *  The pins are the ones salons dropped themselves — never derived from
 *  the address text, which is only what we print. */

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
}: {
  pins: MapPin[];
  height: number | string;
  zoom?: number;
  interactive?: boolean;
  radius?: number | string;
  /** Names beside the pins. On a results map that is the whole point;
   *  on a single-salon map the page already says the name. */
  labels?: boolean;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
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
    if (!box || !pins.length) return;
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
    if (markers.length === 1) map.setView([pins[0]!.lat, pins[0]!.lng], zoom);
    else
      // Never zoom past street level just because two salons share a
      // corner, and leave room for the labels.
      map.fitBounds(L.featureGroup(markers).getBounds().pad(0.3), { maxZoom: 15 });

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
    setTimeout(() => map.invalidateSize(), 0);
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [stable, zoom, interactive, labels]);

  if (!pins.length) return null;
  return (
    <div
      ref={boxRef}
      role="application"
      aria-label="Map"
      style={{ height, borderRadius: radius, overflow: 'hidden', border: '1px solid var(--line-soft)' }}
    />
  );
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
