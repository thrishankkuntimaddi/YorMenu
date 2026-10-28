import { useEffect, useState } from 'react';

/*
 * The Android app is a shell around this website: new screens arrive by themselves, but the
 * shell (back button, sharing, printing) needs a new APK now and then. Offer it once a day.
 */
const REPO = 'thrishankkuntimaddi/YorMenu';
type Cap = { isNativePlatform?: () => boolean; nativePromise?: (p: string, m: string, o?: object) => Promise<any> };

const newer = (a: string, b: string) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};

export function useAppUpdate() {
  const [update, setUpdate] = useState<{ version: string; url: string } | null>(null);
  useEffect(() => {
    const cap = (window as unknown as { Capacitor?: Cap }).Capacitor;
    if (!cap?.isNativePlatform?.() || !cap.nativePromise) return;
    const day = new Date().toISOString().slice(0, 10);
    try { if (localStorage.getItem('yormenu.updateChecked') === day) return; } catch { /* ignore */ }
    (async () => {
      const info = await cap.nativePromise!('App', 'getInfo');
      const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
      if (!r.ok) return;
      const rel = await r.json();
      const latest = String(rel.tag_name || '').replace(/^v/, '');
      try { localStorage.setItem('yormenu.updateChecked', day); } catch { /* ignore */ }
      if (latest && info?.version && newer(latest, info.version)) {
        setUpdate({ version: latest, url: `https://github.com/${REPO}/releases/download/${rel.tag_name}/YorMenu-Android.apk` });
      }
    })().catch(() => {});
  }, []);
  return update;
}

/** The main script of the website this screen was loaded from (its name changes with every release). */
const scriptOf = (html: string) => /\/assets\/index-[\w-]+\.js/.exec(html)?.[0] ?? null;

/**
 * Screens left open all day (the counter PC, the kitchen tablet) keep running the version they
 * opened with. Check every 10 minutes, and when the app comes back to the front, whether a
 * newer version has been published, and offer a refresh (never forced in the middle of an order).
 */
export function useWebUpdate() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (import.meta.env.DEV) return;
    const mine = scriptOf(document.documentElement.outerHTML);
    if (!mine) return;
    let stopped = false;
    const check = async () => {
      if (stopped || document.hidden) return;
      try {
        const r = await fetch(`/index.html?check=${Date.now()}`, { cache: 'no-store' });
        const latest = r.ok ? scriptOf(await r.text()) : null;
        if (latest && latest !== mine) setReady(true);
      } catch { /* offline: try again later */ }
    };
    const timer = setInterval(check, 10 * 60_000);
    const onShow = () => { if (!document.hidden) void check(); };
    document.addEventListener('visibilitychange', onShow);
    return () => { stopped = true; clearInterval(timer); document.removeEventListener('visibilitychange', onShow); };
  }, []);
  return ready;
}

export function UpdateBanner() {
  const u = useAppUpdate();
  const web = useWebUpdate();
  const [hide, setHide] = useState(false);
  if (web) {
    return (
      <div className="banner no-print row" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
        <span>A new version of YorMenu is ready.</span>
        <button className="btn sm primary" onClick={() => window.location.reload()}>Refresh now</button>
      </div>
    );
  }
  if (!u || hide) return null;
  return (
    <div className="banner no-print row" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
      <span>New YorMenu app {u.version} is available.</span>
      <a className="btn sm primary" href={u.url} target="_blank" rel="noreferrer">Update</a>
      <button className="btn sm ghost" onClick={() => setHide(true)}>Later</button>
    </div>
  );
}
