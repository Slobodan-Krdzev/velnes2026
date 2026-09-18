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

export async function pubPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${P}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new ApiError(res.status, data.error ?? 'ERROR', data.message ?? res.statusText);
  }
  return res.json() as Promise<T>;
}
