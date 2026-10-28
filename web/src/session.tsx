import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { api, tokens, setUnauthorizedHandler, getCore, ApiError } from './api';
import { startLive, disconnectSocket } from './live';
import { authReady } from './firebase';
import { clearCatalog } from './catalog';
import type { Me } from './types';

type Session = {
  me: Me | null;
  loading: boolean;
  login: (restaurantCode: string, username: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  can: (perm: string) => boolean;
};

export type { Session };
/** Exported so the platform's support mode can stand in as the restaurant's owner. */
export const SessionCtx = createContext<Session>(null as unknown as Session);
const Ctx = SessionCtx;

/*
 * The last "who am I" is kept on the device, so a person who is already signed in goes
 * straight to their screen when the app opens, instead of seeing the login page while
 * Firebase restores the login. It is checked again with the server right away; the
 * Firestore security rules guard the data whatever this copy says.
 */
const ME_KEY = 'yormenu.me';
function savedMe(): Me | null {
  if (!tokens.staff()) return null;
  try { return JSON.parse(localStorage.getItem(ME_KEY) || 'null'); } catch { return null; }
}
function saveMe(m: Me | null) {
  try { if (m) localStorage.setItem(ME_KEY, JSON.stringify(m)); else localStorage.removeItem(ME_KEY); } catch { /* private mode */ }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMeState] = useState<Me | null>(savedMe);
  const [loading, setLoading] = useState(() => !!tokens.staff() && !savedMe());

  const setMe = useCallback((m: Me | null) => {
    setMeState((prev) => {
      // A different login or restaurant: never show the previous one's menu or tables.
      if (!m || !prev || prev.user.id !== m.user.id || prev.restaurant.id !== m.restaurant.id) clearCatalog();
      return m;
    });
    saveMe(m);
  }, []);

  const refresh = useCallback(async () => {
    if (!tokens.staff()) { setMe(null); setLoading(false); return; }
    try {
      await authReady();
      const m = await api.get<Me>('/me');
      setMe(m);
      startLive(m.restaurant.id, m.user.id);
    } catch (e) {
      // Only a real "not signed in" ends the session. No internet keeps the saved one on screen.
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) setMe(null);
      else {
        const saved = savedMe();
        if (saved) startLive(saved.restaurant.id, saved.user.id);
        else setMe(null);
      }
    } finally { setLoading(false); }
  }, [setMe]);

  const logout = useCallback(() => {
    tokens.setStaff(null);
    getCore().sessions.clear();
    setMe(null);
    void disconnectSocket();
    void api.post('/auth/logout').catch(() => {});
  }, [setMe]);

  useEffect(() => { setUnauthorizedHandler(logout); refresh(); }, [refresh, logout]);

  const login = async (restaurantCode: string, username: string, password: string) => {
    clearCatalog();
    saveMe(null);
    await api.post('/auth/login', { restaurantCode, username, password });
    tokens.setStaff('staff');
    try { localStorage.setItem('yormenu.lastCode', restaurantCode); } catch { /* ignore */ }
    await refresh();
  };

  const can = (perm: string) => !!me?.permissions.includes(perm);
  return <Ctx.Provider value={{ me, loading, login, logout, refresh, can }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
