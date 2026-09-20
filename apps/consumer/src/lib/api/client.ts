/** Thin fetch wrapper for the key-free public surface. The consumer app
 *  reads everything through `/api/v1/public` — no auth token yet (the
 *  consumer account principal arrives with the account phase). */
const P = '/api/v1/public';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function pub<T>(path: string): Promise<T> {
  const res = await fetch(`${P}${path}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new ApiError(res.status, body.error ?? 'ERROR', body.message ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

/**
 * A public POST that carries the client's token when there is one.
 *
 * The doors it reaches are key-free and answer a signed-out visitor
 * perfectly well; the token only lets them recognise a returning client
 * and order results by that client's own bookings. A stale or missing
 * token is not an error there — it simply means no history to rank with,
 * which is why this never refuses to send.
 */
export async function pubPost<T>(path: string, body: unknown, token?: string | null): Promise<T> {
  const res = await fetch(`${P}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new ApiError(res.status, data.error ?? 'ERROR', data.message ?? res.statusText);
  }
  return res.json() as Promise<T>;
}
