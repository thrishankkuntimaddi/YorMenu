import { createCore, type Core } from './core';
import { authReady, fbAuth, fbDb, firebaseApp } from './firebase';

/*
 * The app's API. Requests like api.get('/floor') are answered inside the app by the
 * YorMenu core, which reads and writes Firestore directly (free Spark plan, no server).
 * Firestore security rules check every read and write.
 */
let core: Core | null = null;
export function getCore(): Core {
  if (!core) core = createCore(firebaseApp(), fbDb(), fbAuth());
  return core;
}

const MARK_KEY = 'yormenu.session';
function safeGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k: string, v: string | null) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } }

/** Which kind of person last signed in on this device (Firebase keeps the actual login). */
export const tokens = {
  staff: () => (safeGet(MARK_KEY) === 'staff' ? 'staff' : null),
  setStaff: (t: string | null) => safeSet(MARK_KEY, t ? 'staff' : null),
  platform: () => (safeGet(MARK_KEY) === 'platform' ? 'platform' : null),
  setPlatform: (t: string | null) => safeSet(MARK_KEY, t ? 'platform' : null),
};

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: any) { super(message); }
}

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) { onUnauthorized = fn; }

async function request<T>(method: string, url: string, body?: unknown, kind: 'staff' | 'platform' = 'staff'): Promise<T> {
  await authReady();
  const r = await getCore().dispatch(method, url, body);
  if (r.status >= 400) {
    if (r.status === 401 && kind === 'staff' && tokens.staff()) onUnauthorized();
    throw new ApiError(r.status, r.body?.error || `Request failed (${r.status})`, r.body?.details);
  }
  return r.body as T;
}

function saveBlob(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export const api = {
  get: <T = any>(url: string) => request<T>('GET', url),
  post: <T = any>(url: string, body: unknown = {}) => request<T>('POST', url, body),
  patch: <T = any>(url: string, body: unknown = {}) => request<T>('PATCH', url, body),
  put: <T = any>(url: string, body: unknown = {}) => request<T>('PUT', url, body),
  del: <T = any>(url: string) => request<T>('DELETE', url),
  platform: {
    get: <T = any>(url: string) => request<T>('GET', url, undefined, 'platform'),
    post: <T = any>(url: string, body: unknown = {}) => request<T>('POST', url, body, 'platform'),
    patch: <T = any>(url: string, body: unknown = {}) => request<T>('PATCH', url, body, 'platform'),
    put: <T = any>(url: string, body: unknown = {}) => request<T>('PUT', url, body, 'platform'),
    open: async (_url: string) => { throw new ApiError(400, 'Files are not stored in this version'); },
  },
  /** Make a report file in the app and save it. */
  async download(url: string, filename?: string) {
    const r = await getCore().dispatch('GET', url);
    if (r.status >= 400 || !r.file) throw new ApiError(r.status, r.body?.error || 'Download failed');
    saveBlob(r.file.blob, filename ?? r.file.filename);
  },
  open: async (_url: string) => { throw new ApiError(400, 'Files are not stored in this version'); },
};

/** Read a picked file as base64 (without the data: prefix). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('Could not read the file'));
    r.readAsDataURL(file);
  });
}
