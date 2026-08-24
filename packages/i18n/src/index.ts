import i18next, { type i18n } from 'i18next';
import { en, type TranslationKey } from './en.js';
import { mk } from './mk.js';
import { sq } from './sq.js';

export type { TranslationKey };
export { en, mk, sq };

export const LANGS = ['en', 'mk', 'sq'] as const;
export type Lang = (typeof LANGS)[number];

export const resources = {
  en: { translation: en },
  mk: { translation: mk },
  sq: { translation: sq },
} as const;

/** Create a configured i18next instance (each app calls this once). */
export function createI18n(lng: Lang = 'en'): i18n {
  const instance = i18next.createInstance();
  void instance.init({
    resources,
    lng,
    fallbackLng: 'en',
    interpolation: { escapeValue: false }, // React escapes
    returnEmptyString: false,
  });
  return instance;
}
