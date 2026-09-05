import {
  LoginResponseSchema,
  MeResponseSchema,
  PreviewResponseSchema,
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
  getAccessToken,
  getRefreshToken,
  patch,
  post,
  setAccessToken,
  setOnAuthExpired,
  setOnTokenRefreshed,
  setRefreshToken,
} from './client.js';

interface Session {
  me: MeResponse | null;
  booting: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginById: (employeeId: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setLang: (lang: Lang) => Promise<void>;
  can: (key: PermKey) => boolean;
  /** The prototype's preview mode: while set, `me` IS the previewed
   *  user — the access token, roles, scopes and data all follow. */
  preview: { employeeId: string } | null;
  startPreview: (employeeId: string) => Promise<MeResponse>;
  exitPreview: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [booting, setBooting] = useState(true);
  const [preview, setPreview] = useState<{ employeeId: string; ownerToken: string | null } | null>(
    null,
  );
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
    setOnAuthExpired(() => {
      previewRef.current = null;
      setPreview(null);
      adopt(null);
    });
    return () => setOnAuthExpired(null);
  }, [adopt]);

  // A refresh mid-preview swapped the owner's token back in. Re-issue
  // the preview token silently so the borrowed view keeps holding; if
  // the door now refuses, fall back to the owner honestly.
  const previewRef = useRef(preview);
  previewRef.current = preview;
  useEffect(() => {
    setOnTokenRefreshed(() => {
      const p = previewRef.current;
      if (!p) return;
      void post(PreviewResponseSchema, '/auth/preview', {
        employeeId: p.employeeId,
        renew: true,
      })
        .then((res) => {
          setAccessToken(res.accessToken);
          adopt(res.employee);
        })
        .catch(() => {
          setPreview(null);
          void get(MeResponseSchema, '/auth/me')
            .then(adopt)
            .catch(() => adopt(null));
        });
    });
    return () => setOnTokenRefreshed(null);
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
      loginById: async (employeeId, password) => {
        const res = await post(LoginResponseSchema, '/auth/login-id', { employeeId, password });
        setAccessToken(res.accessToken);
        setRefreshToken(res.refreshToken);
        adopt(await get(MeResponseSchema, '/auth/me'));
      },
      logout: async () => {
        const rt = getRefreshToken();
        if (rt) await post(MeResponseSchema.partial(), '/auth/logout', { refreshToken: rt }).catch(() => null);
        setAccessToken(null);
        setRefreshToken(null);
        previewRef.current = null;
        setPreview(null);
        adopt(null);
      },
      setLang: async (lang) => {
        adopt(await patch(MeResponseSchema, '/auth/me', { lang }));
      },
      can: (key) => (me?.perms[key] ?? 'none') !== 'none',
      preview: preview ? { employeeId: preview.employeeId } : null,
      startPreview: async (employeeId) => {
        const res = await post(PreviewResponseSchema, '/auth/preview', { employeeId });
        // The ref must lead the state: the renewal hook reads it
        // synchronously, a render earlier than setPreview lands.
        previewRef.current = { employeeId, ownerToken: getAccessToken() };
        setPreview(previewRef.current);
        setAccessToken(res.accessToken);
        adopt(res.employee);
        return res.employee;
      },
      exitPreview: async () => {
        if (!preview) return;
        previewRef.current = null;
        setAccessToken(preview.ownerToken);
        setPreview(null);
        // An expired owner token recovers through the ordinary
        // refresh-on-401 path — the refresh token never left.
        adopt(await get(MeResponseSchema, '/auth/me'));
      },
    }),
    [me, booting, adopt, preview],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}
