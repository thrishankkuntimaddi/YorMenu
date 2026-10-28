import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { api, tokens, setUnauthorizedHandler, getCore } from './api';
import { startLive, disconnectSocket } from './live';
import { authReady } from './firebase';
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

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!tokens.staff()) { setMe(null); setLoading(false); return; }
    try {
      await authReady();
      const m = await api.get<Me>('/me');
      setMe(m);
      startLive(m.restaurant.id, m.user.id);
    } catch { setMe(null); } finally { setLoading(false); }
  }, []);

  const logout = useCallback(() => {
    tokens.setStaff(null);
    getCore().sessions.clear();
    setMe(null);
    void disconnectSocket();
    void api.post('/auth/logout').catch(() => {});
  }, []);

  useEffect(() => { setUnauthorizedHandler(logout); refresh(); }, [refresh, logout]);

  const login = async (restaurantCode: string, username: string, password: string) => {
    await api.post('/auth/login', { restaurantCode, username, password });
    tokens.setStaff('staff');
    try { localStorage.setItem('yormenu.lastCode', restaurantCode); } catch { /* ignore */ }
    await refresh();
  };

  const can = (perm: string) => !!me?.permissions.includes(perm);
  return <Ctx.Provider value={{ me, loading, login, logout, refresh, can }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
