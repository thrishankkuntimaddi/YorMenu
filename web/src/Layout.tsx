import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from './session';
import { useLive, useOnline, beep, disconnectSocket } from './live';
import { Modal, useToast } from './ui';
import { Icon } from './icons';
import { api } from './api';
import { ROLE_LABEL } from './format';
import { LANGS, useT } from './i18n';
import PrintStation from './PrintStation';

type NavItem = { to: string; label: string; icon: string; perm: string; badge?: 'requests' | 'cleaning' };
const NAV: NavItem[] = [
  { to: '/floor', label: 'Tables', icon: 'tables', perm: 'floor.view' },
  { to: '/kitchen', label: 'Kitchen', icon: 'kitchen', perm: 'kitchen.view' },
  { to: '/bills', label: 'Bills', icon: 'bills', perm: 'bill.view' },
  { to: '/requests', label: 'Requests', icon: 'bell', perm: 'guest.handle', badge: 'requests' },
  { to: '/cleaning', label: 'Cleaning', icon: 'broom', perm: 'cleaning.view', badge: 'cleaning' },
  { to: '/reports', label: 'Reports', icon: 'chart', perm: 'reports.view' },
  { to: '/admin/menu', label: 'Menu', icon: 'menu', perm: 'menu.availability' },
  { to: '/admin/tables', label: 'Floor plan', icon: 'grid', perm: 'tables.edit' },
  { to: '/admin/staff', label: 'Staff', icon: 'users', perm: 'staff.view' },
  { to: '/admin/permissions', label: 'Permissions', icon: 'shield', perm: 'permissions.edit' },
  { to: '/admin/compliance', label: 'Licences', icon: 'badge', perm: 'compliance.manage' },
  { to: '/admin/settings', label: 'Settings', icon: 'gear', perm: 'settings.edit' },
  { to: '/admin/audit', label: 'Activity', icon: 'log', perm: 'audit.view' },
  { to: '/help', label: 'Help', icon: 'help', perm: '' },
];

export function homeFor(role: string) {
  if (role === 'chef') return '/kitchen';
  if (role === 'cleaner') return '/cleaning';
  return '/floor';
}

/** Owner's brand colour, applied to buttons and highlights everywhere. */
function useBrandColor(color: string | undefined) {
  useEffect(() => {
    const root = document.documentElement;
    if (!color) return;
    root.style.setProperty('--brand', color);
    root.style.setProperty('--danger', color);
    root.style.setProperty('--brand-soft', `color-mix(in srgb, ${color} 13%, var(--surface))`);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
    return () => { root.style.removeProperty('--brand'); root.style.removeProperty('--brand-soft'); root.style.removeProperty('--danger'); };
  }, [color]);
}

/** Logs the device out after the owner's idle limit, so a phone left on a table can't be used. */
function useIdleLogout(minutes: number, onIdle: () => void) {
  useEffect(() => {
    if (!minutes) return;
    let last = Date.now();
    const bump = () => { last = Date.now(); };
    const events = ['pointerdown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const timer = setInterval(() => { if (Date.now() - last > minutes * 60_000) onIdle(); }, 15_000);
    return () => { events.forEach((e) => window.removeEventListener(e, bump)); clearInterval(timer); };
  }, [minutes, onIdle]);
}

export default function Layout() {
  const { me, logout, can, refresh } = useSession();
  const online = useOnline();
  const toast = useToast();
  const nav = useNavigate();
  const loc = useLocation();
  const t = useT();
  const [badges, setBadges] = useState<{ requests: number; cleaning: number }>({ requests: 0, cleaning: 0 });
  const [more, setMore] = useState(false);

  const signOut = () => { disconnectSocket(); logout(); nav('/login'); };
  useBrandColor(me?.restaurant.settings.brandColor);
  useIdleLogout(me?.restaurant.settings.idleLogoutMinutes ?? 0, signOut);

  const loadBadges = async () => {
    const [r, c] = await Promise.all([
      can('guest.handle') ? api.get<any[]>('/guest-requests').catch(() => []) : Promise.resolve([]),
      can('cleaning.view') ? api.get<any[]>('/cleaning').catch(() => []) : Promise.resolve([]),
    ]);
    setBadges({ requests: r.length, cleaning: c.filter((x) => x.status === 'pending').length });
  };
  useEffect(() => { loadBadges(); /* eslint-disable-next-line */ }, [me?.user.id, me?.permissions.length]);
  useLive(['guest:request', 'cleaning:changed', 'reconnect'], loadBadges);
  useLive(['permissions:changed', 'settings:changed'], () => { refresh(); });
  useLive(['session:revoked'], () => { toast('This restaurant was suspended. Contact YorMenu support.', 'err'); signOut(); });

  useLive(['notify'], (p: { kind: string; message: string; orderId?: number }) => {
    beep(p.kind === 'ready' ? 2 : 1);
    const go = p.orderId ? () => nav(`/order/${p.orderId}`) : p.kind === 'guest' ? () => nav('/requests')
      : p.kind === 'support' ? () => nav('/help') : p.kind === 'compliance' ? () => nav('/admin/compliance') : undefined;
    toast(p.message, 'alert', go);
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
  useEffect(() => { setMore(false); }, [loc.pathname]);

  if (!me) return null;
  const items = NAV.filter((n) => !n.perm || can(n.perm));
  const primary = items.filter((n) => n.to !== '/help').slice(0, 4);
  const rest = items.filter((n) => !primary.some((x) => x.to === n.to));
  const onOrder = loc.pathname.startsWith('/order/');
  const badge = (n: NavItem) => (n.badge && badges[n.badge] > 0 ? <span className="dot">{badges[n.badge]}</span> : null);
  const setLang = async (lang: string) => { await api.patch('/me/prefs', { lang }).catch(() => {}); await refresh(); };

  return (
    <div className={`app ${onOrder ? '' : 'with-bottom-nav'}`}>
      {me.support.announcement && <div className="banner no-print">{me.support.announcement}</div>}
      <header className="topbar no-print">
        <NavLink to={homeFor(me.user.role)} className="brand"><img src="/icon.svg" alt="" /><span>{me.restaurant.name}</span></NavLink>
        <nav className="nav">
          {items.map((n) => (
            <NavLink key={n.to} to={n.to}><Icon name={n.icon} />{t(n.label)}{badge(n)}</NavLink>
          ))}
        </nav>
        <div className="who">
          <PrintStation />
          <span className={`online ${online ? '' : 'off'}`} title={online ? 'Live' : 'Reconnecting…'} />
          <div className="name"><b>{me.user.name}</b>{ROLE_LABEL[me.user.role]}</div>
          <button className="btn ghost sm" title={t('Log out')} aria-label={t('Log out')} onClick={signOut}><Icon name="logout" /></button>
        </div>
      </header>
      <Outlet />
      {!onOrder && (
        <nav className="bottom-nav no-print" aria-label="Main">
          {primary.map((n) => (
            <NavLink key={n.to} to={n.to}><Icon name={n.icon} size={22} />{t(n.label)}{badge(n)}</NavLink>
          ))}
          <button onClick={() => setMore(true)}><Icon name="more" size={22} />{t('More')}{rest.some((n) => badge(n)) && <span className="dot">•</span>}</button>
        </nav>
      )}
      {more && (
        <Modal title={`${me.user.name} · ${ROLE_LABEL[me.user.role]}`} onClose={() => setMore(false)}>
          <div className="sheet-links">
            {rest.map((n) => <NavLink key={n.to} to={n.to}><Icon name={n.icon} size={22} />{t(n.label)}{badge(n)}</NavLink>)}
            <button onClick={signOut}><Icon name="logout" size={22} />{t('Log out')}</button>
          </div>
          <div className="row between">
            <span className="muted">{t('Language')}</span>
            <div className="lang-switch">
              {LANGS.map((l) => <button key={l.code} className={(me.user.lang || 'en') === l.code ? 'on' : ''} onClick={() => setLang(l.code)}>{l.label}</button>)}
            </div>
          </div>
          {me.support.supportPhone && (
            <a className="btn block" href={`tel:${me.support.supportPhone}`}><Icon name="phone" />{t('Call support')} · {me.support.supportPhone}</a>
          )}
        </Modal>
      )}
    </div>
  );
}
