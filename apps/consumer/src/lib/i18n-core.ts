import { createI18n, LANGS, type Lang } from '@velnes/i18n';

/**
 * The one i18next instance, created at module load — docs/I18N.md.
 *
 * React-free on purpose: the label helpers in `api/mappers.ts` ("30
 * min", "from 1.200 MKD") run outside components and must speak the
 * same language as the screens, so they import this rather than a
 * hook. The hooks and the account sync live in `i18n.tsx`.
 */

export const LANG_KEY = 'velnes.client.lang';
export const LANG_LABEL: Record<Lang, string> = { en: 'English', mk: 'Македонски', sq: 'Shqip' };

export function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && (LANGS as readonly string[]).includes(v);
}

/** Where to start, before any account is known: this browser's last
 *  choice, else its own language when it is one of ours, else English. */
export function initialLang(): Lang {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (isLang(stored)) return stored;
  } catch {
    /* private mode */
  }
  const nav = typeof navigator !== 'undefined' ? (navigator.languages ?? [navigator.language]) : [];
  for (const l of nav) {
    const short = String(l).slice(0, 2).toLowerCase();
    if (isLang(short)) return short;
  }
  return 'en';
}

export const i18n = createI18n(initialLang());

/** Remember, switch, and let the document say so. */
export function applyLang(l: Lang) {
  try {
    localStorage.setItem(LANG_KEY, l);
  } catch {
    /* private mode */
  }
  if (i18n.language !== l) void i18n.changeLanguage(l);
  if (typeof document !== 'undefined') document.documentElement.lang = l;
}

/**
 * Translate outside a component, or inside one whose page root already
 * subscribes with `useTranslation()` (a language change re-renders the
 * root and everything under it). Returns a plain string.
 */
export function t(key: string, opts?: Record<string, unknown>): string {
  return (opts ? i18n.t(key, opts) : i18n.t(key)) as string;
}
