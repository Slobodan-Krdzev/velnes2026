import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { z } from 'zod';
import type {
  ClientAppointmentsSchema,
  ClientFavouritesSchema,
  ClientNotificationsSchema,
  ClientProfileSchema,
  ClientSalonLinksSchema,
  FavouriteKind,
} from '@velnes/contracts';
import { ApiError } from './client.js';

/** The consumer session: one account across every salon. The token is
 *  the fourth principal's — it opens the /client doors and nothing
 *  else. Kept in localStorage so a reload stays signed in. */

const C = '/api/v1/client';
const TOKEN_KEY = 'velnes.client.token';

export type ClientProfile = z.infer<typeof ClientProfileSchema>;
type Favourites = z.infer<typeof ClientFavouritesSchema>;
type Appointments = z.infer<typeof ClientAppointmentsSchema>;
type Notifications = z.infer<typeof ClientNotificationsSchema>;
type SalonLinks = z.infer<typeof ClientSalonLinksSchema>;

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
function writeToken(t: string | null) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: the session simply lasts this page */
  }
}

async function call<T>(path: string, init: RequestInit & { token?: string | null } = {}): Promise<T> {
  const { token, ...rest } = init;
  const res = await fetch(`${C}${path}`, {
    ...rest,
    headers: {
      ...(rest.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(rest.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new ApiError(res.status, body.error ?? 'ERROR', body.message ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

interface SessionCtx {
  token: string | null;
  signedIn: boolean;
  profile: ClientProfile | null;
  setSession: (token: string, profile: ClientProfile) => void;
  signOut: () => void;
  api: <T>(path: string, init?: RequestInit) => Promise<T>;
}

const Ctx = createContext<SessionCtx>({
  token: null,
  signedIn: false,
  profile: null,
  setSession: () => {},
  signOut: () => {},
  api: () => Promise.reject(new Error('no session')),
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [token, setToken] = useState<string | null>(readToken);

  const api = useCallback(
    <T,>(path: string, init: RequestInit = {}) => call<T>(path, { ...init, token }),
    [token],
  );

  // The profile is server truth: the token only says who you are.
  const me = useQuery({
    queryKey: ['me', token],
    queryFn: () => call<ClientProfile>('/me', { token }),
    enabled: Boolean(token),
    retry: false,
    staleTime: 60_000,
  });

  // A token the server no longer honours is not a session — whether it
  // is refused (401) or names an account that no longer exists (404).
  const dead =
    me.isError && me.error instanceof ApiError && [401, 404].includes(me.error.status);
  const signOut = useCallback(() => {
    writeToken(null);
    setToken(null);
    qc.clear();
  }, [qc]);
  if (dead && token) {
    writeToken(null);
  }

  const value = useMemo<SessionCtx>(
    () => ({
      token: dead ? null : token,
      signedIn: Boolean(token) && !dead,
      profile: dead ? null : (me.data ?? null),
      setSession: (t, p) => {
        writeToken(t);
        setToken(t);
        qc.setQueryData(['me', t], p);
      },
      signOut,
      api,
    }),
    [token, dead, me.data, qc, signOut, api],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  return useContext(Ctx);
}

/** The signed-out doors: register, the code, and login. */
export const clientAuth = {
  register: (body: {
    email: string;
    password: string;
    first: string;
    last: string;
    phone: string;
    dob: string | null;
    lang: 'en' | 'mk' | 'sq';
  }) => call<{ pending: true }>('/register', { method: 'POST', body: JSON.stringify(body) }),
  /**
   * The code that was just "sent", for testing — and only ever in
   * testing.
   *
   * The door behind this exists solely while the mail transport is the
   * mock one: no SMTP provider has been chosen, so the code sits in the
   * outbox rather than anybody's inbox, and reading it back is honest
   * rather than a shortcut. The moment a real transport is configured
   * the route is not registered at all, this 404s, and registration
   * falls back to the person typing what they were emailed.
   *
   * That is the whole safety argument: this cannot follow the app into
   * production, because in production it does not exist.
   */
  devCode: (email: string) =>
    call<{ code: string | null }>(`/dev/last-code?email=${encodeURIComponent(email)}`),
  resend: (email: string) =>
    call<{ pending: true }>('/resend-code', { method: 'POST', body: JSON.stringify({ email }) }),
  verify: (email: string, code: string) =>
    call<{ token: string; profile: ClientProfile }>('/verify-email', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    }),
  login: (email: string, password: string) =>
    call<{ token: string; profile: ClientProfile }>('/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
};

export function useMyAppointments() {
  const { api, signedIn } = useSession();
  return useQuery({
    queryKey: ['my-appointments'],
    queryFn: () => api<Appointments>('/me/appointments'),
    enabled: signedIn,
    staleTime: 15_000,
  });
}

export function useMyNotifications() {
  const { api, signedIn } = useSession();
  return useQuery({
    queryKey: ['my-notifications'],
    queryFn: () => api<Notifications>('/me/notifications'),
    enabled: signedIn,
    staleTime: 15_000,
  });
}

export function useMySalons() {
  const { api, signedIn } = useSession();
  return useQuery({
    queryKey: ['my-salons'],
    queryFn: () => api<SalonLinks>('/me/salons'),
    enabled: signedIn,
    staleTime: 60_000,
  });
}


/** Where a heart tapped while signed out waits for its owner to come
 *  back. One item, this tab only, applied once and then forgotten — not
 *  a second list of favourites living in the browser. */
const PENDING_KEY = 'velnes.client.pendingFavourite';

export interface PendingFavourite {
  kind: FavouriteKind;
  id: string;
}

/** Deliberately forgiving: a browser with storage disabled should make
 *  the heart do less, never make the page fail. */
export function rememberPendingFavourite(f: PendingFavourite) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(f));
  } catch {
    /* no storage — the tap is simply lost, which is the old behaviour */
  }
}
function takePendingFavourite(): PendingFavourite | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_KEY);
    const p = JSON.parse(raw) as PendingFavourite;
    return p && typeof p.id === 'string' ? p : null;
  } catch {
    return null;
  }
}

/**
 * The client's favourites — Phase C, docs/FAVOURITES.md.
 *
 * One query behind every heart in the app as well as the Favourites
 * section, so the two can never disagree about what is saved. Toggling
 * is optimistic: the heart fills under the finger and rolls back if the
 * write fails, because a heart that waits for a round trip feels broken
 * even when it is working.
 */
export function useFavourites() {
  const { api, signedIn } = useSession();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['my-favourites'],
    queryFn: () => api<Favourites>('/me/favourites'),
    enabled: signedIn,
    staleTime: 30_000,
  });

  const saved = useCallback(
    (kind: FavouriteKind, id: string) => {
      const d = q.data;
      if (!d) return false;
      const list = kind === 'salon' ? d.salons : kind === 'service' ? d.services : d.pros;
      return list.some((f) => f.id === id);
    },
    [q.data],
  );

  const toggle = useCallback(
    async (kind: FavouriteKind, id: string) => {
      const on = saved(kind, id);
      // Optimistic: move the heart now, put it back if the door refuses.
      const key = ['my-favourites'];
      const prev = qc.getQueryData<Favourites>(key);
      if (prev) {
        const pick = (d: Favourites) =>
          kind === 'salon' ? d.salons : kind === 'service' ? d.services : d.pros;
        const next: Favourites = {
          ...prev,
          salons: [...prev.salons],
          services: [...prev.services],
          pros: [...prev.pros],
        };
        const list = pick(next);
        if (on) {
          const i = list.findIndex((f) => f.id === id);
          if (i >= 0) list.splice(i, 1);
        } else {
          // A placeholder until the refetch brings the real row: enough
          // for the heart to read as filled, and nothing is rendered
          // from it in a list the user is looking at.
          list.unshift({
            kind,
            id,
            name: '',
            sub: '',
            salonSlug: '',
            salonName: '',
            photo: null,
            savedAt: new Date().toISOString(),
          });
        }
        qc.setQueryData(key, next);
      }
      try {
        await api(`/me/favourites/${kind}/${id}`, { method: on ? 'DELETE' : 'PUT' });
        await qc.invalidateQueries({ queryKey: key });
        // The order of results depends on what is favourited, so what is
        // on screen behind this is now stale.
        await qc.invalidateQueries({ queryKey: ['ranked-services'] });
        return true;
      } catch {
        if (prev) qc.setQueryData(key, prev);
        return false;
      }
    },
    [api, qc, saved],
  );

  /** Apply a heart that was tapped before signing in. Called once, when
   *  a session appears. */
  const applyPending = useCallback(async () => {
    const p = takePendingFavourite();
    if (!p) return;
    try {
      await api(`/me/favourites/${p.kind}/${p.id}`, { method: 'PUT' });
      await qc.invalidateQueries({ queryKey: ['my-favourites'] });
    } catch {
      /* the target may have gone while they were away; not worth a fuss */
    }
  }, [api, qc]);

  return { data: q.data, isLoading: q.isLoading, isError: q.isError, saved, toggle, applyPending };
}
