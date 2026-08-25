import { API_PREFIX } from '@velnes/contracts';
import type { z } from 'zod';

/** HQ's own little client: one token, 8 hours, no refresh chain —
 *  internal staff sign in again. A 401 anywhere drops the session. */

const KEY = 'velnes.hq.token';
export const getToken = () => localStorage.getItem(KEY);
export const setToken = (t: string | null) => {
  if (t) localStorage.setItem(KEY, t);
  else localStorage.removeItem(KEY);
};

export class HqApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<S extends z.ZodType>(
  schema: S,
  path: string,
  init?: RequestInit,
): Promise<z.infer<S>> {
  const res = await fetch(`${API_PREFIX}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(getToken() ? { authorization: `Bearer ${getToken()}` } : {}),
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401) {
    setToken(null);
    window.dispatchEvent(new Event('hq-signout'));
  }
  if (!res.ok)
    throw new HqApiError(res.status, String(data.error ?? 'ERROR'), String(data.message ?? 'failed'));
  return schema.parse(data) as z.infer<S>;
}

export const hqGet = <S extends z.ZodType>(schema: S, path: string) => call(schema, path);
export const hqPost = <S extends z.ZodType>(schema: S, path: string, body?: unknown) =>
  call(schema, path, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) });
