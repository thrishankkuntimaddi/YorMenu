const TOKEN_KEY = 'yormenu.token';
const PLATFORM_KEY = 'yormenu.platformToken';

function safeGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k: string, v: string | null) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } }

export const tokens = {
  staff: () => safeGet(TOKEN_KEY),
  setStaff: (t: string | null) => safeSet(TOKEN_KEY, t),
  platform: () => safeGet(PLATFORM_KEY),
  setPlatform: (t: string | null) => safeSet(PLATFORM_KEY, t),
};

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: any) { super(message); }
}

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) { onUnauthorized = fn; }

async function request<T>(method: string, url: string, body?: unknown, token = tokens.staff()): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const isJson = res.headers.get('content-type')?.includes('json');
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    if (res.status === 401 && token === tokens.staff() && token) onUnauthorized();
    throw new ApiError(res.status, (isJson && data?.error) || `Request failed (${res.status})`, isJson ? data?.details : undefined);
  }
  return data as T;
}

export const api = {
  get: <T = any>(url: string) => request<T>('GET', url),
  post: <T = any>(url: string, body: unknown = {}) => request<T>('POST', url, body),
  patch: <T = any>(url: string, body: unknown = {}) => request<T>('PATCH', url, body),
  put: <T = any>(url: string, body: unknown = {}) => request<T>('PUT', url, body),
  del: <T = any>(url: string) => request<T>('DELETE', url),
  platform: {
    get: <T = any>(url: string) => request<T>('GET', url, undefined, tokens.platform()),
    post: <T = any>(url: string, body: unknown = {}) => request<T>('POST', url, body, tokens.platform()),
    patch: <T = any>(url: string, body: unknown = {}) => request<T>('PATCH', url, body, tokens.platform()),
  },
  /** Download a CSV report with the auth header. */
  async download(url: string, filename: string) {
    const res = await fetch(`/api${url}`, { headers: { Authorization: `Bearer ${tokens.staff()}` } });
    if (!res.ok) throw new ApiError(res.status, 'Download failed');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
};
