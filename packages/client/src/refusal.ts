import type { TFunction } from 'i18next';
import { ApiError } from './client.js';

/** Render a booking refusal localized when it carries a structured
 *  code; the server's English sentence is the fallback. */
export function refusalText(t: TFunction, e: unknown): string {
  if (e instanceof ApiError) {
    if (e.refusalCode) return t(`refusal.${e.refusalCode}`, e.refusalParams ?? {});
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}
