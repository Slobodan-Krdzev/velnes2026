import { API_PREFIX } from '@velnes/contracts';
import type { z } from 'zod';

/** The portal's own little client: one 8-hour token, its user
 *  snapshot beside it. A 401 anywhere drops the session. */

const KEY = 'velnes.portal';
export type PortalUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  supplierId: string;
  supplierName: string;
};
export const getSession = (): { token: string; user: PortalUser } | null => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null');
  } catch {
    return null;
  }
};
export const setSession = (s: { token: string; user: PortalUser } | null) => {
  if (s) localStorage.setItem(KEY, JSON.stringify(s));
  else localStorage.removeItem(KEY);
};

export class PortalApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<S extends z.ZodType>(schema: S, path: string, init?: RequestInit): Promise<z.infer<S>> {
  const s = getSession();
  const res = await fetch(`${API_PREFIX}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(s ? { authorization: `Bearer ${s.token}` } : {}),
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401) {
    setSession(null);
    window.dispatchEvent(new Event('portal-signout'));
  }
  if (!res.ok)
    throw new PortalApiError(res.status, String(data.error ?? 'ERROR'), String(data.message ?? 'failed'));
  return schema.parse(data) as z.infer<S>;
}

export const pGet = <S extends z.ZodType>(schema: S, path: string) => call(schema, path);
export const pPost = <S extends z.ZodType>(schema: S, path: string, body?: unknown) =>
  call(schema, path, { method: 'POST', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
export const pPatch = <S extends z.ZodType>(schema: S, path: string, body: unknown) =>
  call(schema, path, { method: 'PATCH', body: JSON.stringify(body) });
