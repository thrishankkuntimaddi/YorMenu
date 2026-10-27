import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useSession } from './session';
import { useLive, useOnline, beep, disconnectSocket } from './live';
import { useToast } from './ui';
import { Icon } from './icons';
import { api } from './api';
import { ROLE_LABEL } from './format';

const NAV = [
  { to: '/floor', label: 'Tables', icon: 'tables', perm: 'floor.view' },
  { to: '/kitchen', label: 'Kitchen', icon: 'kitchen', perm: 'kitchen.view' },
  { to: '/bills', label: 'Bills', icon: 'bills', perm: 'bill.view' },
  { to: '/requests', label: 'Requests', icon: 'bell', perm: 'guest.handle', badge: 'requests' },
  { to: '/cleaning', label: 'Cleaning', icon: 'broom', perm: 'cleaning.view', badge: 'cleaning' },
  { to: '/reports', label: 'Reports', icon: 'chart', perm: 'reports.view' },
  { to: '/admin/menu', label: 'Menu', icon: 'menu', perm: 'menu.availability' },
  { to: '/admin/tables', label: 'Floor plan', icon: 'grid', perm: 'tables.edit' },
  { to: '/admin/staff', label: 'Staff', icon: 'users', perm: 'staff.view' },
  { to: '/admin/settings', label: 'Settings', icon: 'gear', perm: 'settings.edit' },
  { to: '/admin/audit', label: 'Activity', icon: 'log', perm: 'audit.view' },
] as const;

export function homeFor(role: string) {
  if (role === 'chef') return '/kitchen';
  if (role === 'cleaner') return '/cleaning';
  return '/floor';
}

export default function Layout() {
  const { me, logout, can } = useSession();
  const online = useOnline();
  const toast = useToast();
  const nav = useNavigate();
  const [badges, setBadges] = useState<{ requests: number; cleaning: number }>({ requests: 0, cleaning: 0 });

  const loadBadges = async () => {
    const [r, c] = await Promise.all([
      can('guest.handle') ? api.get<any[]>('/guest-requests').catch(() => []) : Promise.resolve([]),
      can('cleaning.view') ? api.get<any[]>('/cleaning').catch(() => []) : Promise.resolve([]),
    ]);
    setBadges({ requests: r.length, cleaning: c.filter((x) => x.status === 'pending').length });
  };
  useEffect(() => { loadBadges(); /* eslint-disable-next-line */ }, [me?.user.id]);
  useLive(['guest:request', 'cleaning:changed', 'reconnect'], loadBadges);

  useLive(['notify'], (p: { kind: string; message: string; orderId?: number }) => {
    beep(p.kind === 'ready' ? 2 : 1);
    toast(p.message, 'alert', p.orderId ? () => nav(`/order/${p.orderId}`) : p.kind === 'guest' ? () => nav('/requests') : undefined);
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification(me?.restaurant.name ?? 'YorMenu', { body: p.message }); } catch { /* ignore */ }
    }
  });

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      const ask = () => { Notification.requestPermission().catch(() => {}); window.removeEventListener('click', ask); };
      window.addEventListener('click', ask, { once: true });
    }
  }, []);

  if (!me) return null;
  return (
    <div className="app">
      <header className="topbar no-print">
        <NavLink to={homeFor(me.user.role)} className="brand"><img src="/icon.svg" alt="" /><span>{me.restaurant.name}</span></NavLink>
        <nav className="nav">
          {NAV.filter((n) => can(n.perm)).map((n) => (
            <NavLink key={n.to} to={n.to}>
              <Icon name={n.icon} />{n.label}
              {'badge' in n && badges[n.badge] > 0 && <span className="dot">{badges[n.badge]}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="who">
          <span className={`online ${online ? '' : 'off'}`} title={online ? 'Live' : 'Reconnecting…'} />
          <div className="name"><b>{me.user.name}</b>{ROLE_LABEL[me.user.role]}</div>
          <button className="btn ghost sm" title="Log out" onClick={() => { disconnectSocket(); logout(); nav('/login'); }}><Icon name="logout" /></button>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
