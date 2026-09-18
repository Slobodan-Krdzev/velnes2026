import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { useEffect, useRef } from 'react';

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
}: {
  pins: MapPin[];
  height: number | string;
  zoom?: number;
  interactive?: boolean;
  radius?: number | string;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    const box = boxRef.current;
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
    const markers = pins.map((p) => {
      const m = L.marker([p.lat, p.lng], { icon: p.here ? HERE : PIN }).addTo(map);
      m.bindPopup(
        `<b style="font-family:inherit">${escapeHtml(p.label)}</b>${p.sub ? `<br><span>${escapeHtml(p.sub)}</span>` : ''}`,
      );
      if (p.onClick) m.on('click', p.onClick);
      return m;
    });
    if (markers.length === 1) map.setView([pins[0]!.lat, pins[0]!.lng], zoom);
    else map.fitBounds(L.featureGroup(markers).getBounds().pad(0.25));
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 0);
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [pins, zoom, interactive]);

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
