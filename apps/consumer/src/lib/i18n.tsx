import { LANGS, type Lang } from '@velnes/i18n';
import { useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSession } from './api/session.js';
import { LANG_LABEL, applyLang, i18n, isLang } from './i18n-core.js';

export { LANG_LABEL, i18n, initialLang } from './i18n-core.js';

/**
 * The consumer app's language — docs/I18N.md.
 *
 * Three sources, in order of authority:
 *   1. the signed-in account's own choice (`client_users.lang`, set at
 *      registration and editable under My Velnes);
 *   2. what this browser chose last time (`velnes.client.lang`);
 *   3. the browser's own language, when it is one of ours.
 * English is the fallback, never a guess about where someone is.
 */

/** The account's language wins the moment it is known; `<html lang>`
 *  follows the instance so screen readers follow the words. */
export function LangSync() {
  const { profile } = useSession();
  const remote = profile?.lang;
  useEffect(() => {
    if (isLang(remote)) applyLang(remote);
    else applyLang(i18n.language as Lang);
  }, [remote]);
  return null;
}

/** Read the language, and change it — for the account too when signed in. */
export function useLang() {
  const { i18n: inst } = useTranslation();
  const { signedIn, api } = useSession();
  const qc = useQueryClient();
  const lang = (isLang(inst.language) ? inst.language : 'en') as Lang;
  const setLang = useCallback(
    (l: Lang) => {
      applyLang(l);
      if (!signedIn) return;
      void api('/me', { method: 'PATCH', body: JSON.stringify({ lang: l }) })
        .then(() => qc.invalidateQueries({ queryKey: ['me'] }))
        .catch(() => {
          /* the browser keeps the choice; the account catches up next time */
        });
    },
    [signedIn, api, qc],
  );
  return { lang, setLang, langs: LANGS, label: LANG_LABEL };
}
