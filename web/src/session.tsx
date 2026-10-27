import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { api, tokens, setUnauthorizedHandler } from './api';
import type { Me } from './types';

type Session = {
  me: Me | null;
  loading: boolean;
  login: (restaurantCode: string, username: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  can: (perm: string) => boolean;
};

const Ctx = createContext<Session>(null as unknown as Session);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!tokens.staff()) { setMe(null); setLoading(false); return; }
    try { setMe(await api.get<Me>('/me')); } catch { setMe(null); } finally { setLoading(false); }
  }, []);

  const logout = useCallback(() => { tokens.setStaff(null); setMe(null); }, []);

  useEffect(() => { setUnauthorizedHandler(logout); refresh(); }, [refresh, logout]);

  const login = async (restaurantCode: string, username: string, password: string) => {
    const { token } = await api.post<{ token: string }>('/auth/login', { restaurantCode, username, password });
    tokens.setStaff(token);
    try { localStorage.setItem('yourmenu.lastCode', restaurantCode); } catch { /* ignore */ }
    await refresh();
  };

  const can = (perm: string) => !!me?.permissions.includes(perm);
  return <Ctx.Provider value={{ me, loading, login, logout, refresh, can }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
