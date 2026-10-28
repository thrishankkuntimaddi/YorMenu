import { useEffect, useRef, useState } from 'react';
import { signOut } from 'firebase/auth';
import { collection, doc, onSnapshot, query, where, type Unsubscribe } from 'firebase/firestore';
import { fbAuth, fbDb } from './firebase';

/*
 * Live updates. The server writes "floor changed at T" signals and personal alerts
 * into Firestore; every signed-in device listens and reloads what it shows.
 * Screens use useLive(['floor:changed', ...], reload) exactly as before.
 */

type Handler = (payload: any, event: string) => void;
const handlers = new Map<string, Set<Handler>>();
const statusListeners = new Set<(online: boolean) => void>();
let online = false;
let stops: Unsubscribe[] = [];
let pollTimer: ReturnType<typeof setInterval> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let current: string | null = null;

function dispatch(event: string, payload: unknown = {}) {
  handlers.get(event)?.forEach((h) => { try { h(payload, event); } catch (e) { console.error(e); } });
}
let connectedOnce = false;
function setOnline(v: boolean) {
  if (v === online) return;
  online = v;
  statusListeners.forEach((l) => l(v));
  // Screens load by themselves when they open; only a connection that came BACK reloads them.
  if (v && connectedOnce && current) dispatch('reconnect');
  if (v) connectedOnce = true;
}

/** Start listening for one restaurant + person. Safe to call again with the same values. */
export async function startLive(rid: number, userId: number) {
  const key = `${rid}:${userId}`;
  if (current === key) return;
  stopLive();
  current = key;
  try {
    if (!fbAuth().currentUser) throw new Error('not signed in');
    if (current !== key) return;
    const db = fbDb();
    const seen = new Map<string, number>();
    let first = true;
    stops.push(onSnapshot(doc(db, `restaurants/${rid}/live/signals`), { includeMetadataChanges: true }, (snap) => {
      setOnline(!snap.metadata.fromCache && navigator.onLine);
      const data = snap.data() ?? {};
      for (const [field, v] of Object.entries(data)) {
        if (!v || typeof v !== 'object' || typeof (v as any).at !== 'number') continue;
        const at = (v as any).at as number;
        if (!first && (seen.get(field) ?? 0) < at) dispatch(field.replace(/_/g, ':'), (v as any).payload);
        seen.set(field, at);
      }
      first = false;
    }, () => fallBackToPolling(rid, userId)));
    const since = Date.now() - 5_000;
    stops.push(onSnapshot(query(collection(db, `restaurants/${rid}/inbox/${userId}/items`), where('at', '>', since)), (snap) => {
      for (const ch of snap.docChanges()) {
        if (ch.type !== 'added') continue;
        const p = ch.doc.data().payload;
        if (p?.kind === 'revoked') dispatch('session:revoked', p);
        else dispatch('notify', p);
      }
    }, () => { /* alerts are best-effort */ }));
    // Guests (not signed in) can't send signals, so watch their pending requests directly.
    let firstGuests = true;
    stops.push(onSnapshot(query(collection(db, `restaurants/${rid}/guest_requests`), where('status', '==', 'pending')), (snap) => {
      const added = snap.docChanges().filter((c) => c.type === 'added').map((c) => c.doc.data());
      if (!firstGuests && added.length) {
        dispatch('guest:request');
        const label: Record<string, string> = { join: 'wants to order from a phone', order: 'sent an order', call_waiter: 'is calling a server', request_bill: 'asked for the bill' };
        for (const g of added) dispatch('notify', { kind: 'guest', message: `Table ${g.table_label ?? ''} ${label[g.kind] ?? 'needs you'}` });
      } else if (!firstGuests && snap.docChanges().length) dispatch('guest:request');
      firstGuests = false;
    }, () => { /* only staff who handle guests can read these */ }));
  } catch (e) {
    console.warn('[live] falling back to polling:', (e as Error).message);
    fallBackToPolling(rid, userId);
  }
}

/** No live connection: refresh screens every 15 seconds, and try the live connection again in 30. */
function fallBackToPolling(rid: number, userId: number) {
  if (pollTimer) return;
  setOnline(navigator.onLine);
  pollTimer = setInterval(() => dispatch('reconnect'), 15_000);
  const key = `${rid}:${userId}`;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (current !== key) return;
    stopLive();
    void startLive(rid, userId);
  }, 30_000);
}

export function stopLive() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  stops.forEach((s) => s());
  stops = [];
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  current = null;
  setOnline(false);
}

export async function disconnectSocket() {
  stopLive();
  connectedOnce = false;
  try { await signOut(fbAuth()); } catch { /* ignore */ }
}

window.addEventListener('online', () => current && dispatch('reconnect'));

/** Run `fn` whenever any of the given events happen (and after reconnecting). */
export function useLive(events: string[], fn: Handler) {
  const ref = useRef(fn);
  ref.current = fn;
  const key = events.join('|');
  useEffect(() => {
    const h: Handler = (p, e) => ref.current(p, e);
    for (const e of events) (handlers.get(e) ?? handlers.set(e, new Set()).get(e)!).add(h);
    return () => { for (const e of events) handlers.get(e)?.delete(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

export function useOnline() {
  const [v, set] = useState(online);
  useEffect(() => { statusListeners.add(set); set(online); return () => { statusListeners.delete(set); }; }, []);
  return v;
}

/** Short beep for new KOTs / alerts; browsers allow it after first user tap. */
export function beep(times = 1) {
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AC();
    for (let i = 0; i < times; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.25;
      g.gain.setValueAtTime(0.2, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      o.start(t); o.stop(t + 0.2);
    }
  } catch { /* no audio */ }
}
