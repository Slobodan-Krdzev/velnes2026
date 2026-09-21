import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * Where the person is. Asked once, remembered, and then kept current:
 * somebody looking for a salon is often walking to one, so the position
 * is watched rather than sampled.
 *
 * Nothing is sent to the server — the coordinates live in this browser
 * and are used to centre the map and measure distance locally. The
 * platform learns nothing about where anyone stands.
 */

const ON_KEY = 'velnes.geo.on';
const LAST_KEY = 'velnes.geo.last';

export interface UserPosition {
  lat: number;
  lng: number;
  /** Metres of uncertainty the device reported. */
  accuracy: number;
  /** When it was taken (epoch ms) — a remembered fix can be stale. */
  at: number;
}

export type GeoStatus =
  | 'off'
  | 'asking'
  | 'on'
  /** The person said no, or the browser is holding an earlier no. */
  | 'denied'
  /** They did not refuse — the device simply could not produce a fix.
   *  Worth telling them apart: one is a decision, the other is weather. */
  | 'unavailable'
  | 'unsupported';

interface GeoCtx {
  status: GeoStatus;
  position: UserPosition | null;
  /** Ask (once) and start following. */
  enable: () => void;
  /** Stop following and forget the remembered fix. */
  disable: () => void;
}

const Ctx = createContext<GeoCtx>({
  status: 'off',
  position: null,
  enable: () => {},
  disable: () => {},
});

function readLast(): UserPosition | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as UserPosition;
    return typeof p?.lat === 'number' && typeof p?.lng === 'number' ? p : null;
  } catch {
    return null;
  }
}
const readOn = () => {
  try {
    return localStorage.getItem(ON_KEY) === '1';
  } catch {
    return false;
  }
};

export function GeoProvider({ children }: { children: ReactNode }) {
  const supported = typeof navigator !== 'undefined' && 'geolocation' in navigator;
  const [position, setPosition] = useState<UserPosition | null>(readLast);
  const [status, setStatus] = useState<GeoStatus>(() =>
    !supported ? 'unsupported' : readOn() ? 'on' : 'off',
  );
  const watchId = useRef<number | null>(null);

  const remember = useCallback((p: GeolocationPosition) => {
    const next: UserPosition = {
      lat: Number(p.coords.latitude.toFixed(6)),
      lng: Number(p.coords.longitude.toFixed(6)),
      accuracy: Math.round(p.coords.accuracy),
      at: Date.now(),
    };
    setPosition(next);
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify(next));
    } catch {
      /* private mode: this session only */
    }
  }, []);

  /** Follow the person until the app closes. */
  const startWatch = useCallback(() => {
    if (!supported || watchId.current !== null) return;
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        remember(p);
        setStatus('on');
      },
      (err) => {
        // Permission taken away in the browser's own settings: stop
        // pretending we know, and stop asking on every render.
        if (err.code === err.PERMISSION_DENIED) {
          setStatus('denied');
          try {
            localStorage.removeItem(ON_KEY);
          } catch {
            /* ignore */
          }
          if (watchId.current !== null) {
            navigator.geolocation.clearWatch(watchId.current);
            watchId.current = null;
          }
        }
        // A timeout or a temporarily unavailable fix keeps the last
        // known position — it is still the best answer we have.
      },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
    );
  }, [remember, supported]);

  const enable = useCallback(() => {
    if (!supported) return setStatus('unsupported');
    setStatus('asking');

    const got = (p: GeolocationPosition) => {
      remember(p);
      setStatus('on');
      try {
        localStorage.setItem(ON_KEY, '1');
      } catch {
        /* ignore */
      }
      startWatch();
    };

    /**
     * Ask twice before giving up.
     *
     * A high-accuracy fix wants GPS, and on a desktop indoors that
     * often just runs out the clock — which is why the button "worked
     * sometimes": same click, same code, different weather. The second
     * ask drops the accuracy requirement and will accept a fix up to
     * five minutes old, which the browser can usually answer from wifi
     * immediately.
     *
     * A refusal is final and is not retried: asking again would only
     * produce the same no.
     */
    navigator.geolocation.getCurrentPosition(got, (err) => {
      if (err.code === err.PERMISSION_DENIED) return setStatus('denied');
      navigator.geolocation.getCurrentPosition(
        got,
        (again) => setStatus(again.code === again.PERMISSION_DENIED ? 'denied' : 'unavailable'),
        { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
      );
    }, { enableHighAccuracy: true, timeout: 8_000 });
  }, [remember, startWatch, supported]);

  const disable = useCallback(() => {
    if (watchId.current !== null && supported) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    setPosition(null);
    setStatus('off');
    try {
      localStorage.removeItem(ON_KEY);
      localStorage.removeItem(LAST_KEY);
    } catch {
      /* ignore */
    }
  }, [supported]);

  // Enabled once is enabled for good: a return visit picks the watch
  // back up without another prompt. The Permissions API also tells us
  // when the browser already holds a grant from an earlier visit.
  useEffect(() => {
    if (!supported) return;
    if (readOn()) startWatch();
    else
      navigator.permissions
        ?.query({ name: 'geolocation' as PermissionName })
        .then((res) => {
          if (res.state === 'granted') {
            try {
              localStorage.setItem(ON_KEY, '1');
            } catch {
              /* ignore */
            }
            startWatch();
          } else if (res.state === 'denied') setStatus('denied');
        })
        .catch(() => {
          /* no Permissions API: the button asks */
        });
    return () => {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      }
    };
  }, [startWatch, supported]);

  const value = useMemo(
    () => ({ status, position, enable, disable }),
    [status, position, enable, disable],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUserLocation() {
  return useContext(Ctx);
}

/** Great-circle distance in kilometres. */
export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(la1) * Math.cos(la2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** "700 m" up close, "2,4 km" further out — the prototype's comma. */
export function distanceLbl(km: number): string {
  if (km < 1) return `${Math.round(km * 100) * 10} m`;
  return `${km.toFixed(1).replace('.', ',')} km`;
}
