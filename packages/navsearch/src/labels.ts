import { en, mk, sq } from '@velnes/i18n';
import type { Labels } from './types.js';

/**
 * The three dictionaries as the index's label source: a destination
 * titled by its i18n key is found by that key's value in every
 * language, whichever one the screen is showing.
 */
export const labelsFromDictionaries: Labels = (key) => {
  const k = key as keyof typeof en;
  return { en: en[k], mk: mk[k], sq: sq[k] };
};
