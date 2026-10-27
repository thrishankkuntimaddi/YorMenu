import { FirebaseError } from 'firebase/app';
import { HttpError } from './errors';
import type { StaffAuth, PlatformAuth } from './session';

/*
 * A tiny Express-shaped router that runs inside the app. Screens still call
 * api.get('/floor') etc.; instead of going over the network to a server, the
 * request is answered here by talking to Firestore (protected by security rules).
 */

export type Req = {
  method: string; path: string; params: Record<string, string>; query: Record<string, string>; body: any;
  staff?: StaffAuth; platform?: PlatformAuth;
};
export type FileOut = { blob: Blob; filename: string };
export class Res {
  statusCode = 200;
  headers: Record<string, string> = {};
  body: unknown = undefined;
  file: FileOut | null = null;
  done = false;
  status(n: number) { this.statusCode = n; return this; }
  setHeader(k: string, v: string) { this.headers[k.toLowerCase()] = v; return this; }
  json(b: unknown) { this.body = b; this.done = true; return this; }
  send(b: unknown) {
    if (b instanceof Blob || b instanceof Uint8Array || typeof b === 'string') {
      const blob = b instanceof Blob ? b : new Blob([b as BlobPart], { type: this.headers['content-type'] ?? 'application/octet-stream' });
      const name = /filename="([^"]+)"/.exec(this.headers['content-disposition'] ?? '')?.[1] ?? 'download';
      this.file = { blob, filename: name };
    } else this.body = b;
    this.done = true;
    return this;
  }
}
export type Next = (err?: unknown) => void;
export type Handler = (req: Req, res: Res, next: Next) => unknown;

type Layer = { method: string | null; prefix: boolean; re: RegExp; keys: string[]; handlers: Handler[] };

function compile(path: string, prefix: boolean) {
  const keys: string[] = [];
  const src = path.replace(/\/:([A-Za-z_]+)/g, (_m, k) => { keys.push(k); return '/([^/]+)'; });
  return { re: new RegExp(`^${src}${prefix ? '(?:/|$)' : '/?$'}`), keys };
}

export class Router {
  layers: Layer[] = [];
  private add(method: string | null, path: string, handlers: Handler[], prefix = false) {
    const { re, keys } = compile(path, prefix);
    this.layers.push({ method, prefix, re, keys, handlers });
    return this;
  }
  use(pathOrHandler: string | Handler | Router, ...rest: (Handler | Router)[]) {
    const [path, hs] = typeof pathOrHandler === 'string' ? [pathOrHandler, rest] : ['', [pathOrHandler, ...rest]];
    return this.add(null, path, hs.map((h) => (h instanceof Router ? h.handle : h)), true);
  }
  get(p: string, ...h: Handler[]) { return this.add('GET', p, h); }
  post(p: string, ...h: Handler[]) { return this.add('POST', p, h); }
  put(p: string, ...h: Handler[]) { return this.add('PUT', p, h); }
  patch(p: string, ...h: Handler[]) { return this.add('PATCH', p, h); }
  delete(p: string, ...h: Handler[]) { return this.add('DELETE', p, h); }

  /** Run the request through matching layers in order, Express style. */
  handle: Handler = async (req, res, next) => {
    for (const layer of this.layers) {
      if (res.done) return;
      if (layer.method && layer.method !== req.method) continue;
      const m = layer.re.exec(req.path);
      if (!m) continue;
      const params = { ...req.params };
      layer.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      req.params = params;
      // One shared request object, so middleware can attach the session for later handlers.
      for (const h of layer.handlers) {
        let called = false;
        let err: unknown;
        await h(req, res, (e?: unknown) => { called = true; err = e; });
        if (err) throw err;
        if (res.done) return;
        if (!called) break;
      }
    }
    next();
  };
}

/** Errors to HTTP-like results the screens already understand. */
export function toHttpError(e: unknown): HttpError {
  if (e instanceof HttpError) return e;
  if (e instanceof FirebaseError) {
    if (e.code === 'permission-denied' || e.code === 'firestore/permission-denied') return new HttpError(403, 'You do not have permission to do this');
    if (e.code === 'unavailable') return new HttpError(503, 'No internet connection. Please try again.');
    if (e.code === 'not-found') return new HttpError(404, 'Not found');
    return new HttpError(500, e.message);
  }
  if ((e as Error)?.name === 'ZodError') return new HttpError(400, (e as Error).message);
  console.error(e);
  return new HttpError(500, 'Something went wrong');
}
