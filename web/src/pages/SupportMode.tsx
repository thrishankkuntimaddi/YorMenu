import { useEffect, useMemo, useState } from 'react';
import { setSupportRestaurant } from '../api';
import { clearCatalog } from '../catalog';
import { SessionCtx, type Session } from '../session';
import type { Me, Role } from '../types';
import { Icon } from '../icons';
import MenuAdmin from './MenuAdmin';
import TablesAdmin from './TablesAdmin';
import Staff from './Staff';

const PERMS = ['menu.edit', 'menu.availability', 'tables.edit', 'staff.view', 'staff.edit'];
const ROLES: Role[] = ['owner', 'trustee', 'manager', 'cashier', 'server', 'chef', 'cleaner'];

/**
 * A platform admin sets up one restaurant's menu, tables and staff (when the owner asks),
 * using the restaurant's own screens. Orders, bills and customers are not reachable.
 */
export default function SupportMode({ rest, adminName, onExit }: {
  rest: { id: number; code: string; name: string; address: string; phone: string; gstin: string };
  adminName: string; onExit: () => void;
}) {
  const [tab, setTab] = useState<'menu' | 'tables' | 'staff'>('menu');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setSupportRestaurant(rest.id);
    clearCatalog();
    setReady(true);
    return () => { setSupportRestaurant(null); clearCatalog(); };
  }, [rest.id]);

  const session = useMemo<Session>(() => {
    const me = {
      user: { id: 0, name: `YorMenu support (${adminName})`, role: 'owner', lang: 'en' },
      permissions: PERMS, manages: ROLES,
      support: { supportName: '', supportPhone: '', supportWhatsapp: '', supportEmail: '', supportHours: '', companyName: 'YorMenu' },
      restaurant: { ...rest, settings: {} },
    } as unknown as Me;
    return {
      me, loading: false, can: (p: string) => PERMS.includes(p),
      login: async () => {}, logout: onExit, refresh: async () => {},
    };
  }, [rest, adminName, onExit]);

  return (
    <div className="app">
      <header className="topbar">
        <button className="btn ghost back-btn" onClick={onExit} aria-label="Back to platform"><Icon name="back" size={22} /></button>
        <div className="grow" style={{ minWidth: 0 }}>
          <b>{rest.name}</b> <span className="faint small">{rest.code}</span>
          <div className="small muted">Support mode: changes are made for the restaurant and logged in its Activity.</div>
        </div>
      </header>
      <div className="tabs" style={{ padding: '0 12px', margin: 0, flex: 'none' }}>
        {([['menu', 'Menu'], ['tables', 'Floor plan & QR'], ['staff', 'Staff & logins']] as const).map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      <main className="main">
        {ready && (
          <SessionCtx.Provider value={session}>
            {tab === 'menu' && <MenuAdmin />}
            {tab === 'tables' && <TablesAdmin />}
            {tab === 'staff' && <Staff />}
          </SessionCtx.Provider>
        )}
      </main>
    </div>
  );
}
