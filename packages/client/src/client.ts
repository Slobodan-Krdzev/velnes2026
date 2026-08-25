import { API_PREFIX, RefreshResponseSchema } from '@velnes/contracts';
import type { z } from 'zod';

/**
 * The one HTTP client: attaches the access token, refreshes once on
 * 401 (rotating the stored refresh token), and parses every response
 * with its contract schema at the boundary.
 */

const REFRESH_KEY = 'velnes.refresh';
let accessToken: string | null = null;

export const setAccessToken = (t: string | null) => {
  accessToken = t;
};
export const getRefreshToken = () => localStorage.getItem(REFRESH_KEY);
export const setRefreshToken = (t: string | null) => {
  if (t) localStorage.setItem(REFRESH_KEY, t);
  else localStorage.removeItem(REFRESH_KEY);
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public refusalCode?: string,
    public refusalParams?: Record<string, string | number>,
  ) {
    super(message);
  }
}

async function rawFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
  if (init.body) headers.set('content-type', 'application/json');
  return fetch(`${API_PREFIX}${path}`, { ...init, headers });
}

/** One refresh at a time; concurrent 401s share it. */
let refreshing: Promise<boolean> | null = null;
async function tryRefresh(): Promise<boolean> {
  refreshing ??= (async () => {
    const rt = getRefreshToken();
    if (!rt) return false;
    const res = await fetch(`${API_PREFIX}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt }),
    });
    if (!res.ok) {
      setRefreshToken(null);
      setAccessToken(null);
      return false;
    }
    const body = RefreshResponseSchema.parse(await res.json());
    setAccessToken(body.accessToken);
    setRefreshToken(body.refreshToken);
    return true;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export async function api<S extends z.ZodType>(
  schema: S,
  path: string,
  init: RequestInit = {},
): Promise<z.infer<S>> {
  let res = await rawFetch(path, init);
  if (res.status === 401 && (await tryRefresh())) res = await rawFetch(path, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      code?: string;
      params?: Record<string, string | number>;
    };
    throw new ApiError(
      res.status,
      body.error ?? 'ERROR',
      body.message ?? body.error ?? 'Request failed',
      body.code,
      body.params,
    );
  }
  return schema.parse(await res.json()) as z.infer<S>;
}

export const get = <S extends z.ZodType>(schema: S, path: string) => api(schema, path);
export const post = <S extends z.ZodType>(schema: S, path: string, body: unknown) =>
  api(schema, path, { method: 'POST', body: JSON.stringify(body) });
export const patch = <S extends z.ZodType>(schema: S, path: string, body: unknown) =>
  api(schema, path, { method: 'PATCH', body: JSON.stringify(body) });
