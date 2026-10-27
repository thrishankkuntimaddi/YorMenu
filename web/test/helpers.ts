import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { initializeFirestore, connectFirestoreEmulator, terminate } from 'firebase/firestore';
import { createCore, type Core } from '../src/core';
import { Realtime } from '../src/core/realtime';
import { seedRestaurant } from '../src/core/demo';

/*
 * Every "device" (a waiter's phone, the owner's PC, a guest) is its own Firebase app,
 * signed in separately, talking to the emulators with the real security rules.
 */
const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-yormenu';
const [FS_HOST, FS_PORT] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const apps: FirebaseApp[] = [];

type Out = { status: number; body: any; text: string; file?: { blob: Blob; filename: string }; headers: Record<string, string> };

export function device(events?: { rid: number; event: string; payload: unknown }[]) {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'demo-key', authDomain: 'localhost' }, `d${Date.now()}${Math.random()}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });
  const db = initializeFirestore(app, { ignoreUndefinedProperties: true });
  connectFirestoreEmulator(db, FS_HOST, Number(FS_PORT));
  let rt: Realtime | undefined;
  if (events) {
    rt = new Realtime(null);
    rt.emit = (rid, event, payload) => { events.push({ rid, event, payload }); };
    rt.emitToUser = (rid, _u, event, payload) => { events.push({ rid, event, payload }); };
    rt.emitToRoles = (rid, _r, event, payload) => { events.push({ rid, event, payload }); };
  }
  const core: Core = createCore(app, db, auth, { rt });
  const call = async (method: string, url: string, body?: unknown): Promise<Out> => {
    const r = await core.dispatch(method, url.replace(/^\/api/, ''), body);
    const type = r.file ? (r.file.blob.type || (r.file.filename.endsWith('.csv') ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')) : 'application/json';
    return { status: r.status, body: r.body, text: r.file ? (await r.file.blob.text()).replace(/^\uFEFF/, '') : '', file: r.file, headers: { 'content-type': type } };
  };
  return {
    app, db, auth, core, call,
    get: (url: string) => call('GET', url),
    post: (url: string, body: object = {}) => call('POST', url, body),
    patch: (url: string, body: object = {}) => call('PATCH', url, body),
    put: (url: string, body: object = {}) => call('PUT', url, body),
    del: (url: string) => call('DELETE', url),
  };
}
export type Device = ReturnType<typeof device>;

async function clearEmulators() {
  await fetch(`http://${FS_HOST}:${FS_PORT}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
}

export async function closeDevices() {
  for (const a of apps.splice(0)) {
    try { await terminate((a as any)._firestoreInstance ?? initializeFirestore(a, {})); } catch { /* ignore */ }
    await deleteApp(a).catch(() => {});
  }
}

export const ADMIN = { email: 'admin@example.com', password: 'a-long-password' };

export async function setup() {
  await closeDevices();
  await clearEmulators();
  const events: { rid: number; event: string; payload: unknown }[] = [];
  const platform = device();
  const boot = await platform.post('/platform/bootstrap', { ...ADMIN, name: 'Admin' });
  if (boot.status !== 201) throw new Error(`bootstrap failed ${JSON.stringify(boot.body)}`);
  const signInOwner = async (code: string, username: string, password: string) => {
    const d = device();
    const r = await d.post('/auth/login', { restaurantCode: code, username, password });
    if (r.status !== 200) throw new Error(`owner login failed ${JSON.stringify(r.body)}`);
    return d;
  };
  const a = await seedRestaurant(platform, signInOwner, 'AAA', 'Restaurant A');
  const b = await seedRestaurant(platform, signInOwner, 'BBB', 'Restaurant B');

  // Lookups by name, loaded once so tests can stay synchronous.
  const tables = new Map<string, number>();
  const items = new Map<string, number>();
  for (const [code, r] of [['AAA', a], ['BBB', b]] as const) {
    const owner = await signInOwner(code, 'owner', 'owner123');
    const cat = (await owner.get('/catalog')).body;
    for (const t of cat.tables) tables.set(`${r.rid}:${t.label}`, t.id);
    for (const i of cat.items) items.set(`${r.rid}:${i.name}`, i.id);
  }

  async function login(code: string, username: string, password: string) {
    const d = device(events);
    const res = await d.post('/auth/login', { restaurantCode: code, username, password });
    if (res.status !== 200) throw new Error(`login failed ${res.status} ${JSON.stringify(res.body)}`);
    return d;
  }
  async function platformLogin(email = ADMIN.email, password = ADMIN.password) {
    const d = device();
    const res = await d.post('/auth/platform/login', { username: email, password });
    if (res.status !== 200) throw new Error(`platform login failed ${JSON.stringify(res.body)}`);
    return d;
  }
  /** Not signed in at all (login screen, guest QR menu). */
  const anon = device();
  const tableId = (rid: number, label: string) => tables.get(`${rid}:${label}`)!;
  const itemId = (rid: number, name: string) => items.get(`${rid}:${name}`)!;
  return { a, b, login, platformLogin, anon, tableId, itemId, events, platform };
}
