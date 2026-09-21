import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSession } from './api/session.js';

/**
 * Where the person is — and, separately, whether they said we may ask.
 *
 * Two things live here and they are deliberately different kinds of
 * thing:
 *
 *   - **The decision** is remembered: allowed or refused, once. It sits
 *     in localStorage for everyone and on the account for a signed-in
 *     customer, so it follows them across devices. Null means nobody
 *     has asked yet, and the home page asks exactly once.
 *   - **The position** is never remembered. When the decision is
 *     "allowed", the home page takes a fresh, precise fix the moment
 *     it opens, uses it, and forgets it when the app closes. Nothing
 *     about where anyone stood is written anywhere — not here, not on
 *     the server. Alex settled that on 2026-09-21: remember the
 *     answer, not the place.
 *
 * The doors still receive a rounded lat/lng inside a request so that
 * distance can be ranked, and store nothing from it, exactly as before.
 */

const DECISION_KEY = 'velnes.geo.decision';
/** Keys an earlier version used to remember a position. Removed on
 *  sight: a stored position is now the one thing this must not hold. */
const LEGACY_KEYS = ['velnes.geo.on', 'velnes.geo.last'];

export interface UserPosition {
  lat: number;
  lng: number;
  /** Metres of uncertainty the device reported. */
  accuracy: number;
  /** When it was taken (epoch ms). */
  at: number;
}

export type GeoStatus =
  | 'off'
  | 'asking'
  | 'on'
  /** The browser refused, or is holding an earlier refusal. */
  | 'denied'
  /** No refusal — the device simply could not produce a fix. One is a
   *  decision, the other is weather; they get different words. */
  | 'unavailable'
  | 'unsupported';

export type GeoDecision = 'allowed' | 'refused' | null;

interface GeoCtx {
  status: GeoStatus;
  position: UserPosition | null;
  /** What the person told Velnes, if anything yet. */
  decision: GeoDecision;
  /** Record the answer — and act on it: allowed locates now, refused
   *  stops. Saved to the account too when signed in. */
  decide: (allowed: boolean) => void;
  /** Take a fresh, precise fix right now. */
  locate: () => void;
  /** Stop following and forget the fix. Leaves the decision alone. */
  disable: () => void;
}

const Ctx = createContext<GeoCtx>({
  status: 'off',
  position: null,
  decision: null,
  decide: () => {},
  locate: () => {},
  disable: () => {},
});

function readDecision(): GeoDecision {
  try {
    const v = localStorage.getItem(DECISION_KEY);
    return v === 'allowed' || v === 'refused' ? v : null;
  } catch {
    return null;
  }
}
function writeDecision(d: GeoDecision) {
  try {
    if (d) localStorage.setItem(DECISION_KEY, d);
    else localStorage.removeItem(DECISION_KEY);
  } catch {
    /* private mode: this session only */
  }
}

export function GeoProvider({ children }: { children: ReactNode }) {
  const supported = typeof navigator !== 'undefined' && 'geolocation' in navigator;
  const { profile, signedIn, api } = useSession();
  const qc = useQueryClient();

  const [position, setPosition] = useState<UserPosition | null>(null);
  const [status, setStatus] = useState<GeoStatus>(() => (supported ? 'off' : 'unsupported'));
  const [decision, setDecision] = useState<GeoDecision>(readDecision);
  const watchId = useRef<number | null>(null);

  // Nothing from the previous model survives: a remembered position is
  // precisely what must not exist any more.
  useEffect(() => {
    try {
      for (const k of LEGACY_KEYS) localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  }, []);

  const take = useCallback((p: GeolocationPosition) => {
    setPosition({
      lat: Number(p.coords.latitude.toFixed(6)),
      lng: Number(p.coords.longitude.toFixed(6)),
      accuracy: Math.round(p.coords.accuracy),
      at: Date.now(),
    });
  }, []);

  const stopWatch = useCallback(() => {
    if (watchId.current !== null && supported) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
  }, [supported]);

  /** Follow the person while the app is open — someone looking for a
   *  salon is often walking to one. Memory only; never written down. */
  const startWatch = useCallback(() => {
    if (!supported || watchId.current !== null) return;
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        take(p);
        setStatus('on');
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setStatus('denied');
          stopWatch();
        }
        // A timeout keeps the last fix of this session — still the
        // best answer there is until the next one arrives.
      },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
    );
  }, [supported, take, stopWatch]);

  const disable = useCallback(() => {
    stopWatch();
    setPosition(null);
    setStatus((s) => (s === 'unsupported' ? s : 'off'));
  }, [stopWatch]);

  /**
   * A fresh, precise fix, now.
   *
   * Two asks before giving up. High accuracy wants GPS, and on a desktop
   * indoors that often just runs out the clock; the second ask drops the
   * accuracy requirement and will take a fix a few minutes old, which
   * the browser can usually answer from wifi at once. A refusal is final
   * and is not retried: asking again only produces the same no.
   */
  const locate = useCallback(() => {
    if (!supported) return setStatus('unsupported');
    setStatus('asking');
    const got = (p: GeolocationPosition) => {
      take(p);
      setStatus('on');
      startWatch();
    };
    navigator.geolocation.getCurrentPosition(
      got,
      (err) => {
        if (err.code === err.PERMISSION_DENIED) return setStatus('denied');
        navigator.geolocation.getCurrentPosition(
          got,
          (again) =>
            setStatus(again.code === again.PERMISSION_DENIED ? 'denied' : 'unavailable'),
          { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
        );
      },
      { enableHighAccuracy: true, timeout: 8_000 },
    );
  }, [supported, take, startWatch]);

  /** Save the answer on the account, when there is one to save it on. */
  const saveToAccount = useCallback(
    async (allowed: boolean) => {
      if (!signedIn) return;
      try {
        await api('/me', { method: 'PATCH', body: JSON.stringify({ locationAllowed: allowed }) });
        await qc.invalidateQueries({ queryKey: ['me'] });
      } catch {
        // The local decision stands; the account catches up next time.
      }
    },
    [signedIn, api, qc],
  );

  const decide = useCallback(
    (allowed: boolean) => {
      const d: GeoDecision = allowed ? 'allowed' : 'refused';
      setDecision(d);
      writeDecision(d);
      void saveToAccount(allowed);
      if (allowed) locate();
      else disable();
    },
    [saveToAccount, locate, disable],
  );

  /**
   * The account and this device agree on the decision.
   *
   * Signing in on a new device: the account's answer wins and is
   * written here, so the home page does not ask a question already
   * answered. Signing in from a device that decided while signed out:
   * that answer goes up, so the next device inherits it.
   */
  const remote = profile?.locationAllowed;
  useEffect(() => {
    if (!signedIn) return;
    if (remote === true || remote === false) {
      const d: GeoDecision = remote ? 'allowed' : 'refused';
      if (d !== decision) {
        setDecision(d);
        writeDecision(d);
      }
    } else if (remote === null && decision !== null) {
      void saveToAccount(decision === 'allowed');
    }
  }, [signedIn, remote, decision, saveToAccount]);

  useEffect(() => () => stopWatch(), [stopWatch]);

  const value = useMemo(
    () => ({ status, position, decision, decide, locate, disable }),
    [status, position, decision, decide, locate, disable],
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
