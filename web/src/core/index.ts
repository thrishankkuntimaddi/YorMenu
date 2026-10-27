import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import { DB } from './db';
import { HttpError } from './errors';
import { Realtime } from './realtime';
import { Sessions } from './session';
import { Res, Router, toHttpError, type FileOut } from './http';
import { authRoutes } from './routes/auth';
import { publicRoutes } from './routes/public';
import { platformRoutes } from './routes/platform';
import { adminRoutes } from './routes/admin';
import { opsRoutes } from './routes/ops';
import { peopleRoutes } from './routes/people';
import { ownerRoutes } from './routes/owner';

export type AppDeps = { app: FirebaseApp; db: DB; auth: Auth; rt: Realtime; sessions: Sessions };
export type Result = { status: number; body?: any; file?: FileOut };

/**
 * YorMenu's business rules running inside the app (website, desktop, APK), talking to
 * Firestore directly. Firestore security rules (firebase/firestore.rules) are the guard:
 * they check every read and write against the signed-in person's restaurant and role.
 */
export function createCore(app: FirebaseApp, db: DB, auth: Auth, opts: { rt?: Realtime } = {}) {
  const sessions = new Sessions(db, auth);
  const rt = opts.rt ?? new Realtime(db);
  const deps: AppDeps = { app, db, auth, rt, sessions };
  const root = new Router();
  root.get('/health', (_req, res) => { res.json({ ok: true }); });
  root.use(authRoutes(deps));
  root.use(publicRoutes(deps));
  root.use(platformRoutes(deps));
  root.use(sessions.staffAuth());
  root.use(adminRoutes(deps));
  root.use(opsRoutes(deps));
  root.use(peopleRoutes(deps));
  root.use(ownerRoutes(deps));

  /** Handle "GET /floor?x=1" the way the old HTTP API did. */
  async function dispatch(method: string, url: string, body?: unknown): Promise<Result> {
    const u = new URL(url, 'http://app');
    const res = new Res();
    try {
      await root.handle({ method, path: u.pathname, params: {}, query: Object.fromEntries(u.searchParams), body: body ?? {} }, res, (e) => { if (e) throw e; });
      if (!res.done) throw new HttpError(404, 'Not found');
      await rt.flush().catch((e) => console.warn('[live] flush failed', e));
      return { status: res.statusCode, body: res.body, file: res.file ?? undefined };
    } catch (e) {
      await rt.flush().catch(() => {});
      let err = toHttpError(e);
      // Firestore said no: if this person was disabled or their restaurant suspended, log them out.
      if (err.status === 403 && (e as { code?: string })?.code === 'permission-denied') {
        sessions.clear();
        const still = auth.currentUser && ((await sessions.staff().catch(() => null)) || (await sessions.platform().catch(() => null)));
        if (!still) err = new HttpError(401, 'Please log in again');
      }
      return { status: err.status, body: { error: err.message, details: err.details } };
    }
  }
  return { dispatch, sessions, deps };
}
export type Core = ReturnType<typeof createCore>;
