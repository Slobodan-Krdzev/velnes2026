import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { z } from 'zod';
import type {
  ClientAppointmentsSchema,
  ClientNotificationsSchema,
  ClientProfileSchema,
  ClientSalonLinksSchema,
} from '@velnes/contracts';
import { ApiError } from './client.js';

/** The consumer session: one account across every salon. The token is
 *  the fourth principal's — it opens the /client doors and nothing
 *  else. Kept in localStorage so a reload stays signed in. */

const C = '/api/v1/client';
const TOKEN_KEY = 'velnes.client.token';

export type ClientProfile = z.infer<typeof ClientProfileSchema>;
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
