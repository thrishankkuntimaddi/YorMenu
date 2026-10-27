import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { tokens } from './api';

let socket: Socket | null = null;
let socketToken: string | null = null;
const statusListeners = new Set<(online: boolean) => void>();

export function getSocket(): Socket | null {
  const token = tokens.staff();
  if (!token) { socket?.disconnect(); socket = null; return null; }
  if (socket && socketToken === token) return socket;
  socket?.disconnect();
  socketToken = token;
  socket = io({ path: '/socket.io', auth: { token }, transports: ['websocket', 'polling'] });
  socket.on('connect', () => statusListeners.forEach((l) => l(true)));
  socket.on('disconnect', () => statusListeners.forEach((l) => l(false)));
  return socket;
}

export function disconnectSocket() { socket?.disconnect(); socket = null; socketToken = null; }

/** Run `fn` whenever any of the given server events fire (and on reconnect). */
export function useLive(events: string[], fn: (payload: any, event: string) => void) {
  const ref = useRef(fn);
  ref.current = fn;
  const key = events.join('|');
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const handlers = events.map((e) => [e, (p: any) => ref.current(p, e)] as const);
    handlers.forEach(([e, h]) => s.on(e, h));
    const onReconnect = () => ref.current({}, 'reconnect');
    s.io.on('reconnect', onReconnect);
    return () => { handlers.forEach(([e, h]) => s.off(e, h)); s.io.off('reconnect', onReconnect); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

export function useOnline() {
  const [online, setOnline] = useState(() => getSocket()?.connected ?? false);
  useEffect(() => { statusListeners.add(setOnline); return () => { statusListeners.delete(setOnline); }; }, []);
  return online;
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
