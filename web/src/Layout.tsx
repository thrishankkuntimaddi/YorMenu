import { Suspense, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from './session';
import { useLive, useOnline, beep, disconnectSocket } from './live';
import { Loading, Modal, useToast } from './ui';
import { Icon } from './icons';
import { api, getCore } from './api';
import { ROLE_LABEL } from './format';
import { LANGS, useT } from './i18n';
import PrintStation from './PrintStation';
import { UpdateBanner } from './appUpdate';
import type { Support } from './types';

type NavItem = { to: string; label: string; icon: string; perm: string; badge?: 'requests' | 'cleaning'; restaurantOnly?: boolean; counterOnly?: boolean };
const NAV: NavItem[] = [
  { to: '/quick', label: 'Billing', icon: 'bills', perm: 'bill.generate', counterOnly: true },
  { to: '/floor', label: 'Tables', icon: 'tables', perm: 'floor.view', restaurantOnly: true },
  { to: '/kitchen', label: 'Kitchen', icon: 'kitchen', perm: 'kitchen.view', restaurantOnly: true },
  { to: '/bills', label: 'Bills', icon: 'bills', perm: 'bill.view' },
  { to: '/requests', label: 'Requests', icon: 'bell', perm: 'guest.handle', badge: 'requests', restaurantOnly: true },
  { to: '/cleaning', label: 'Cleaning', icon: 'broom', perm: 'cleaning.view', badge: 'cleaning', restaurantOnly: true },
  { to: '/reports', label: 'Reports', icon: 'chart', perm: 'reports.view' },
  { to: '/admin/menu', label: 'Menu', icon: 'menu', perm: 'menu.availability' },
  { to: '/admin/tables', label: 'Floor plan', icon: 'grid', perm: 'tables.edit', restaurantOnly: true },
  { to: '/admin/staff', label: 'Staff', icon: 'users', perm: 'staff.view' },
  { to: '/admin/permissions', label: 'Permissions', icon: 'shield', perm: 'permissions.edit' },
  { to: '/admin/compliance', label: 'Licences', icon: 'badge', perm: 'compliance.manage' },
  { to: '/admin/settings', label: 'Settings', icon: 'gear', perm: 'settings.edit' },
  { to: '/admin/audit', label: 'Activity', icon: 'log', perm: 'audit.view' },
  { to: '/admin/subscription', label: 'Subscription', icon: 'badge', perm: 'settings.edit' },
  { to: '/printer', label: 'Printer', icon: 'printer', perm: '' },
  { to: '/help', label: 'Help', icon: 'help', perm: '' },
];

/** Screens that are a "home": the back button leaves the app from here instead of going back. */
const HOMES = ['/floor', '/kitchen', '/cleaning', '/quick', '/login', '/'];

/** Go back one screen inside YorMenu; if there is nothing to go back to, go home. */
export function goBack(nav: ReturnType<typeof useNavigate>, home: string) {
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
  if (idx > 0) nav(-1); else nav(home, { replace: true });
}

/** YorMenu support: who to call, shown on every device. */
export function SupportCard({ s }: { s: Support }) {
  const wa = (s.supportWhatsapp || s.supportPhone).replace(/\D/g, '');
  return (
    <div className="stack">
      <div><b>{s.supportName || `${s.companyName || 'YorMenu'} support`}</b>{s.supportHours && <div className="small muted">{s.supportHours}</div>}</div>
      {s.supportPhone && <a className="btn block primary" href={`tel:${s.supportPhone}`}><Icon name="phone" />Call {s.supportPhone}</a>}
      {wa && <a className="btn block" href={`https://wa.me/${wa.length === 10 ? `91${wa}` : wa}`} target="_blank" rel="noreferrer"><Icon name="whatsapp" />WhatsApp</a>}
      {s.supportEmail && <a className="btn block" href={`mailto:${s.supportEmail}`}><Icon name="mail" />{s.supportEmail}</a>}
    </div>
  );
}

export function homeFor(role: string, mode?: string) {
  if (mode === 'counter' && role !== 'chef' && role !== 'cleaner') return '/quick';
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
    // Capture, so scrolling inside a panel (not only the page) counts as activity.
    events.forEach((e) => window.addEventListener(e, bump, { passive: true, capture: true }));
    const timer = setInterval(() => { if (Date.now() - last > minutes * 60_000) onIdle(); }, 15_000);
    return () => { events.forEach((e) => window.removeEventListener(e, bump, { capture: true })); clearInterval(timer); };
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
  const [support, setSupport] = useState(false);

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
  useLive(['permissions:changed', 'settings:changed'], () => { getCore().sessions.clear(); refresh(); });
  useLive(['session:revoked'], () => { toast('This restaurant was suspended. Contact YorMenu support.', 'err'); signOut(); });

  useLive(['notify'], (p: { kind: string; message: string; orderId?: number }) => {
    const onKitchen = window.location.pathname === '/kitchen';
    if (p.kind === 'kot' && onKitchen) return; // the kitchen screen beeps and shows it itself
    beep(p.kind === 'ready' ? 2 : 1);
    const go = p.kind === 'kot' ? (onKitchen ? undefined : () => nav('/kitchen')) : p.orderId && can('floor.view') ? () => nav(`/order/${p.orderId}`) : p.kind === 'guest' ? () => nav('/requests')
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
  // Keep the open screen's button in view in the top menu (it scrolls sideways on phones).
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => { navRef.current?.querySelector('a.active')?.scrollIntoView({ block: 'nearest', inline: 'center' }); }, [loc.pathname]);

  // Phone back button (Android app): close a popup, else go back a screen, else leave the app on a home screen.
  const home = me ? homeFor(me.user.role, me.restaurant.settings.businessMode) : '/floor';
  const isHome = HOMES.includes(loc.pathname) || loc.pathname === home;
  useEffect(() => {
    const w = window as Window & { yormenuBack?: () => string };
    w.yormenuBack = () => {
      if (document.querySelector('.overlay')) { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return 'handled'; }
      if (isHome) return 'exit';
      goBack(nav, home);
      return 'handled';
    };
    return () => { w.yormenuBack = (w as Window & { yormenuBaseBack?: () => string }).yormenuBaseBack; };
  }, [isHome, nav, home]);

  // Fetch the most used screens in the background, so the first tap on them is instant.
  useEffect(() => {
    const t = setTimeout(() => { import('./pages/Floor'); import('./pages/OrderScreen'); import('./pages/Kitchen'); import('./pages/Bills'); }, 1500);
    return () => clearTimeout(t);
  }, []);

  if (!me) return null;
  const counter = me.restaurant.settings.businessMode === 'counter';
  const items = NAV.filter((n) => (!n.perm || can(n.perm)) && !(counter && n.restaurantOnly) && !(!counter && n.counterOnly));
  const onOrder = loc.pathname.startsWith('/order/');
  const badge = (n: NavItem) => (n.badge && badges[n.badge] > 0 ? <span className="dot">{badges[n.badge]}</span> : null);
  const setLang = async (lang: string) => { await api.patch('/me/prefs', { lang }).catch(() => {}); await refresh(); };

  return (
    <div className={`app ${onOrder ? 'on-order' : ''}`}>
      {me.support.announcement && <div className="banner no-print">{me.support.announcement}</div>}
      <UpdateBanner />
      {me.subscription && can('settings.edit') && (['grace', 'expired'].includes(me.subscription.status) || (me.subscription.status === 'trial' && (me.subscription.daysLeft ?? 99) <= 7)) && (
        <div className={`banner no-print ${me.subscription.status === 'trial' ? '' : 'danger'}`}>
          {me.subscription.status === 'trial' ? `Free trial ends in ${me.subscription.daysLeft} days. ` : me.subscription.status === 'grace' ? 'Your subscription has ended. Billing stops in a few days. ' : 'Your subscription has ended. New bills are blocked. '}
          <NavLink to="/admin/subscription"><b>Renew</b></NavLink>
        </div>
      )}
      <header className="topbar no-print">
        {!isHome && (
          <button className="btn ghost back-btn" onClick={() => goBack(nav, home)} aria-label={t('Back')} title={t('Back')}><Icon name="back" size={22} /></button>
        )}
        <NavLink to={home} className="brand"><img src="/icon.svg" alt="" /><span>{me.restaurant.name}</span></NavLink>
        <span className="grow" />
        <div className="who">
          <PrintStation />
          <select className="lang-select" aria-label={t('Language')} value={me.user.lang || 'en'} onChange={(e) => setLang(e.target.value)}>
            {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
          <span className={`online ${online ? '' : 'off'}`} title={online ? 'Live' : 'Reconnecting…'} />
          <div className="name"><b>{me.user.name}</b>{ROLE_LABEL[me.user.role]}</div>
          <button className="btn ghost sm" title={t('Log out')} aria-label={t('Log out')} onClick={signOut}><Icon name="logout" /></button>
        </div>
      </header>
      {/* Main menu: one row of big picture buttons along the top, on every device. */}
      <nav className="topnav no-print" aria-label="Main" ref={navRef}>
        {items.map((n) => (
          <NavLink key={n.to} to={n.to}><Icon name={n.icon} size={24} /><span>{t(n.label)}</span>{badge(n)}</NavLink>
        ))}
        <button onClick={() => setSupport(true)}><Icon name="phone" size={24} /><span>{t('Support')}</span></button>
      </nav>
      <main className="main">
        <Suspense fallback={<Loading />}><Outlet /></Suspense>
      </main>
      {support && <Modal title={t('YorMenu support')} onClose={() => setSupport(false)}><SupportCard s={me.support} /></Modal>}
    </div>
  );
}
