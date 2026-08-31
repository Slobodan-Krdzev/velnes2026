import {
  LoginResponseSchema,
  MeResponseSchema,
  type Lang,
  type MeResponse,
  type PermKey,
} from '@velnes/contracts';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  get,
  getRefreshToken,
  patch,
  post,
  setAccessToken,
  setOnAuthExpired,
  setRefreshToken,
} from './client.js';

interface Session {
  me: MeResponse | null;
  booting: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setLang: (lang: Lang) => Promise<void>;
  can: (key: PermKey) => boolean;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [booting, setBooting] = useState(true);
  const { i18n } = useTranslation();

  const i18nRef = useRef(i18n);
  i18nRef.current = i18n;
  const adopt = useCallback((m: MeResponse | null) => {
    setMe(m);
    if (m) void i18nRef.current.changeLanguage(m.lang);
  }, []);

  // A dead session (refresh refused) drops straight to the login
  // screen — no button should answer "Unauthorized".
  useEffect(() => {
    setOnAuthExpired(() => adopt(null));
    return () => setOnAuthExpired(null);
  }, [adopt]);

  // Boot: if a refresh token survives, restore the session. Once.
  useEffect(() => {
    (async () => {
      try {
        if (getRefreshToken()) adopt(await get(MeResponseSchema, '/auth/me'));
      } catch {
        adopt(null);
      } finally {
        setBooting(false);
      }
    })();
  }, [adopt]);

  const value = useMemo<Session>(
    () => ({
      me,
      booting,
      login: async (email, password) => {
        const res = await post(LoginResponseSchema, '/auth/login', { email, password });
        setAccessToken(res.accessToken);
        setRefreshToken(res.refreshToken);
        adopt(await get(MeResponseSchema, '/auth/me'));
      },
      logout: async () => {
        const rt = getRefreshToken();
        if (rt) await post(MeResponseSchema.partial(), '/auth/logout', { refreshToken: rt }).catch(() => null);
        setAccessToken(null);
        setRefreshToken(null);
        adopt(null);
      },
      setLang: async (lang) => {
        adopt(await patch(MeResponseSchema, '/auth/me', { lang }));
      },
      can: (key) => (me?.perms[key] ?? 'none') !== 'none',
    }),
    [me, booting, adopt],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}
