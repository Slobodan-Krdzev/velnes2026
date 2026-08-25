import type { HqLoginResponseSchema} from '@velnes/contracts';
import { HqMeResponseSchema } from '@velnes/contracts';
import { createI18n, type Lang } from '@velnes/i18n';
import { useEffect, useMemo, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import type { z } from 'zod';
import { getToken, hqGet, setToken } from './api.js';
import { Hq } from './Hq.js';
import { HqLogin } from './HqLogin.js';

type HqUser = z.infer<typeof HqMeResponseSchema>;

export function App() {
  const lang = (localStorage.getItem('velnes.hq.lang') as Lang) || 'en';
  const i18n = useMemo(() => createI18n(lang), [lang]);
  const [user, setUser] = useState<HqUser | null>(null);
  const [booting, setBooting] = useState(!!getToken());

  useEffect(() => {
    const out = () => setUser(null);
    window.addEventListener('hq-signout', out);
    return () => window.removeEventListener('hq-signout', out);
  }, []);

  useEffect(() => {
    if (!getToken()) return;
    hqGet(HqMeResponseSchema, '/hq/me')
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setBooting(false));
  }, []);

  const setLang = (l: Lang) => {
    localStorage.setItem('velnes.hq.lang', l);
    void i18n.changeLanguage(l);
  };

  return (
    <I18nextProvider i18n={i18n}>
      {booting ? null : user ? (
        <Hq
          user={user}
          setLang={setLang}
          signOut={() => {
            setToken(null);
            setUser(null);
          }}
        />
      ) : (
        <HqLogin
          onDone={(r: z.infer<typeof HqLoginResponseSchema>) => {
            setToken(r.accessToken);
            setUser(r.user);
          }}
        />
      )}
    </I18nextProvider>
  );
}
