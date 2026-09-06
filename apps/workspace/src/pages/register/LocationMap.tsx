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

/** A real OpenStreetMap map. Click or drag the pin to set the exact
 *  spot; "Find address" geocodes the street + city through Nominatim
 *  and drops the pin there. Reports lat/lng up on every move. */
export function LocationMap({
  lat,
  lng,
  query,
  onPick,
}: {
  lat: number | null;
  lng: number | null;
  query: string;
  onPick: (lat: number, lng: number) => void;
}) {
  const { t } = useTranslation();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const [finding, setFinding] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Init once. Guarded — a headless environment (tests) may not give
  // Leaflet a real box; the address search still works without it.
  useEffect(() => {
    if (!boxRef.current || mapRef.current) return;
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
    // Leaflet needs a size recalculation once it is actually on screen.
    setTimeout(() => map.invalidateSize(), 0);
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  const findAddress = async () => {
    const q = query.trim();
    if (!q) return;
    setFinding(true);
    setNote(null);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`,
        { headers: { accept: 'application/json' } },
      );
      const hits = (await res.json()) as { lat: string; lon: string }[];
      const hit = hits[0];
      if (!hit) {
        setNote(t('reg.mapNotFound'));
        return;
      }
      const la = round(Number(hit.lat));
      const lo = round(Number(hit.lon));
      const map = mapRef.current;
      if (map) {
        map.setView([la, lo], 16);
        if (markerRef.current) markerRef.current.setLatLng([la, lo]);
        else markerRef.current = L.marker([la, lo], { icon: PIN, draggable: true }).addTo(map);
      }
      onPick(la, lo);
    } catch {
      setNote(t('reg.mapNotFound'));
    } finally {
      setFinding(false);
    }
  };

  return (
    <div className="field">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span>{t('reg.pinHint')}</span>
        <button
          type="button"
          className="btn btn-subtle btn-sm"
          disabled={finding || !query.trim()}
          onClick={() => void findAddress()}
        >
          {finding ? t('reg.mapFinding') : t('reg.mapFind')}
        </button>
      </div>
      <div
        ref={boxRef}
        role="application"
        aria-label={t('reg.pinHint')}
        style={{ height: 300, borderRadius: 14, overflow: 'hidden', border: '1px solid var(--line)' }}
      />
      {lat != null && lng != null ? (
        <span className="hint tnum">
          {lat}, {lng}
        </span>
      ) : (
        <span className="hint">{t('reg.pinNone')}</span>
      )}
      {note ? (
        <span className="hint" style={{ color: 'var(--danger)' }}>
          {note}
        </span>
      ) : null}
    </div>
  );
}

const round = (n: number) => Math.round(n * 1e5) / 1e5;
