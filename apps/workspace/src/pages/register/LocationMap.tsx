import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

// Vite serves the package's marker images as URLs; point Leaflet at them
// so the default pin renders (the classic bundler gotcha).
const PIN = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  shadowSize: [41, 41],
});

const SKOPJE: [number, number] = [41.9981, 21.4254];

/** A real OpenStreetMap. The salon types its address in the fields
 *  above; here it drops a pin on the exact spot, which sharpens where
 *  it shows up in searches. Click the map or drag the pin to move it. */
export function LocationMap({
  lat,
  lng,
  onPick,
}: {
  lat: number | null;
  lng: number | null;
  onPick: (lat: number, lng: number) => void;
}) {
  const { t } = useTranslation();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!boxRef.current || mapRef.current) return;
    // No layout (headless tests) → skip the map; the fallback control
    // below still lets the pin be set.
    if (!boxRef.current.clientWidth) return;
    let map: L.Map;
    try {
      const start: [number, number] = lat != null && lng != null ? [lat, lng] : SKOPJE;
      map = L.map(boxRef.current, { attributionControl: true }).setView(start, lat != null ? 16 : 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors',
      }).addTo(map);
    } catch {
      return;
    }

    const place = (ll: L.LatLng) => {
      if (markerRef.current) markerRef.current.setLatLng(ll);
      else {
        markerRef.current = L.marker(ll, { icon: PIN, draggable: true }).addTo(map);
        markerRef.current.on('dragend', () => {
          const p = markerRef.current!.getLatLng();
          onPick(round(p.lat), round(p.lng));
        });
      }
      onPick(round(ll.lat), round(ll.lng));
    };
    if (lat != null && lng != null) place(L.latLng(lat, lng));
    map.on('click', (e) => place(e.latlng));
    mapRef.current = map;
    setReady(true);
    setTimeout(() => map.invalidateSize(), 0);
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  return (
    <div className="field">
      <span>{t('reg.pinHint')}</span>
      <div
        ref={boxRef}
        role="application"
        aria-label={t('reg.pinHint')}
        style={{ height: 300, borderRadius: 14, overflow: 'hidden', border: '1px solid var(--line)' }}
      />
      {!ready ? (
        <button
          type="button"
          className="btn btn-subtle btn-sm"
          style={{ marginTop: 8, alignSelf: 'flex-start' }}
          onClick={() => onPick(SKOPJE[0], SKOPJE[1])}
        >
          {t('reg.pinFallback')}
        </button>
      ) : null}
      {lat != null && lng != null ? (
        <span className="hint tnum" style={{ marginTop: 6 }}>
          {lat}, {lng}
        </span>
      ) : (
        <span className="hint" style={{ marginTop: 6 }}>
          {t('reg.pinNone')}
        </span>
      )}
    </div>
  );
}

const round = (n: number) => Math.round(n * 1e5) / 1e5;
