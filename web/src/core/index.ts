import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import { DB } from './db';
import { HttpError } from './errors';
import { Tenant } from './tenant';
import { one } from './db';
import { doc } from 'firebase/firestore';
import type { Permission } from './permissions';
import { Realtime } from './realtime';
import { LiveMirror } from './mirror';
import { Sessions } from './session';
import { Res, Router, toHttpError, type FileOut } from './http';
import { authRoutes } from './routes/auth';
import { publicRoutes } from './routes/public';
import { platformRoutes } from './routes/platform';
import { adminRoutes } from './routes/admin';
import { opsRoutes } from './routes/ops';
import { peopleRoutes } from './routes/people';
import { ownerRoutes } from './routes/owner';
import { signupRoutes, subscriptionRoutes } from './routes/signup';
import { backupRoutes } from './routes/backup';

/** What a platform admin may change for a restaurant in support mode. */
export const SUPPORT_PERMS: ReadonlySet<Permission> = new Set<Permission>(['menu.edit', 'menu.availability', 'tables.edit', 'staff.view', 'staff.edit']);

export type AppDeps = { app: FirebaseApp; db: DB; auth: Auth; rt: Realtime; sessions: Sessions };
export type Result = { status: number; body?: any; file?: FileOut };

/**
 * YorMenu's business rules running inside the app (website, desktop, APK), talking to
 * Firestore directly. Firestore security rules (firebase/firestore.rules) are the guard:
 * they check every read and write against the signed-in person's restaurant and role.
 */
export function createCore(app: FirebaseApp, db: DB, auth: Auth, opts: { rt?: Realtime; waitForLive?: boolean; mirror?: boolean } = {}) {
  // In the app, each device keeps the live floor in memory (see mirror.ts). Scripts read Firestore directly.
  const mirror = (opts.mirror ?? typeof window !== 'undefined') ? new LiveMirror(db, auth) : null;
  const sessions = new Sessions(db, auth, mirror);
  const rt = opts.rt ?? new Realtime(db);
  /*
   * Telling the other devices ("floor changed", "Table 5 food ready") does not hold up the
   * person who tapped: in the app it finishes in the background. Scripts and tests wait for it.
   */
  const waitForLive = opts.waitForLive ?? typeof window === 'undefined';
  let pendingLive: Promise<unknown> = Promise.resolve();
  const flushLive = () => {
    const p = rt.flush().catch((e) => console.warn('[live] flush failed', e));
    pendingLive = Promise.all([pendingLive, p]).then(() => undefined);
    return waitForLive ? p : Promise.resolve();
  };
  const deps: AppDeps = { app, db, auth, rt, sessions };
  const root = new Router();
  root.get('/health', (_req, res) => { res.json({ ok: true }); });
  root.use(authRoutes(deps));
  root.use(publicRoutes(deps));
  root.use(platformRoutes(deps));
  root.use(signupRoutes(deps));
  // Everything a restaurant's staff can do, once we know who they are.
  const staffRouter = new Router();
  staffRouter.use(adminRoutes(deps));
  staffRouter.use(opsRoutes(deps));
  staffRouter.use(peopleRoutes(deps));
  staffRouter.use(ownerRoutes(deps));
  staffRouter.use(subscriptionRoutes(deps));
  staffRouter.use(backupRoutes(deps));

  /*
   * Support mode: a platform admin sets up a restaurant's menu, tables and staff when the
   * owner asks. They act as "YorMenu support" with only those permissions; orders, bills
   * and customers stay out of reach (and Firestore rules refuse them anyway).
   */
  root.use('/platform/act/:rid', async (req, res, next) => {
    const p = await sessions.platform();
    if (!p) return next(new HttpError(401, 'Please log in again'));
    const rid = Number(req.params.rid);
    const rest = Number.isSafeInteger(rid) ? await one(doc(db, `restaurants/${rid}`)) : undefined;
    if (!rest) return next(new HttpError(404, 'Restaurant not found'));
    req.platform = p;
    req.staff = {
      kind: 'staff', userId: 0, rid, role: 'owner', name: `YorMenu support (${p.name})`, code: rest.code,
      tenant: new Tenant(db, rid), perms: SUPPORT_PERMS,
    };
    req.path = req.path.replace(/^\/platform\/act\/\d+/, '') || '/';
    await staffRouter.handle(req, res, next);
  });
  root.use(sessions.staffAuth(), staffRouter.handle);

  /** Handle "GET /floor?x=1" the way the old HTTP API did. */
  async function dispatch(method: string, url: string, body?: unknown): Promise<Result> {
    const u = new URL(url, 'http://app');
    const res = new Res();
    try {
      await root.handle({ method, path: u.pathname, params: {}, query: Object.fromEntries(u.searchParams), body: body ?? {} }, res, (e) => { if (e) throw e; });
      if (!res.done) throw new HttpError(404, 'Not found');
      await flushLive();
      return { status: res.statusCode, body: res.body, file: res.file ?? undefined };
    } catch (e) {
      await flushLive();
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
  /** Resolves when every "tell the other devices" write so far has finished. */
  const idle = () => pendingLive.then(() => undefined);
  return { dispatch, sessions, deps, idle, mirror };
}
export type Core = ReturnType<typeof createCore>;
