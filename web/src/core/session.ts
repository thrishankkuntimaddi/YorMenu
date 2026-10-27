import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signOut, type Auth } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { DB, one } from './db';
import { HttpError, forbidden } from './errors';
import { Tenant } from './tenant';
import { Permission, Role, effectivePerms, parseOverrides } from './permissions';
import type { Handler, Req } from './http';

export type StaffAuth = { kind: 'staff'; userId: number; rid: number; role: Role; name: string; tenant: Tenant; perms: ReadonlySet<Permission>; code: string };
export type PlatformAuth = { kind: 'platform'; adminId: string; name: string };

/**
 * Staff sign in with restaurant code + username. Firebase Auth needs an email, so each
 * login gets a private address like "server1.v1.demo@staff.yormenu.app" (never emailed).
 * The version number changes when an owner resets the password (a new login is made).
 */
export function staffEmail(code: string, username: string, version = 1) {
  return `${username.trim().toLowerCase()}.v${version}.${code.trim().toLowerCase()}@staff.yormenu.app`;
}
export const loginKey = (code: string, username: string) => `${code.trim().toUpperCase()}_${username.trim().toLowerCase()}`;

/**
 * Creates a Firebase login without signing the current person out, by using a
 * short-lived second Firebase app. Returns the new login's uid.
 */
export async function createLogin(main: FirebaseApp, email: string, password: string): Promise<string> {
  const helper = initializeApp(main.options, `create-${Date.now()}-${Math.random()}`);
  try {
    const auth = getAuth(helper);
    const emu = (getAuth(main) as Auth & { emulatorConfig?: { host: string; port: number } }).emulatorConfig;
    if (emu) connectAuthEmulator(auth, `http://${emu.host}:${emu.port}`, { disableWarnings: true });
    const cred = await createUserWithEmailAndPassword(auth, email, password).catch((e) => {
      if (e?.code === 'auth/email-already-in-use') throw new HttpError(409, 'That username is taken in this restaurant');
      if (e?.code === 'auth/weak-password') throw new HttpError(400, 'Use at least 6 characters for the password');
      throw e;
    });
    await signOut(auth);
    return cred.user.uid;
  } finally {
    await deleteApp(helper);
  }
}

type Cache = { uid: string; at: number; staff?: StaffAuth | null; platform?: PlatformAuth | null };

/** Resolves who is signed in on this device. Security rules check the same documents on every read and write. */
export class Sessions {
  private cache: Cache | null = null;
  constructor(private db: DB, private auth: Auth) {}

  clear() { this.cache = null; }

  async staff(): Promise<StaffAuth | null> {
    const u = this.auth.currentUser;
    if (!u) return null;
    // Re-read every time (2 small reads): a disabled person or a changed permission takes effect on the next tap.
    const m = await one(doc(this.db, `members/${u.uid}`));
    let staff: StaffAuth | null = null;
    if (m && m.active) {
      const rest = await one(doc(this.db, `restaurants/${m.rid}`));
      if (rest && rest.active) {
        staff = {
          kind: 'staff', userId: m.user_id, rid: m.rid, role: m.role, name: m.name, code: rest.code,
          tenant: new Tenant(this.db, m.rid), perms: effectivePerms(m.role, parseOverrides(rest.permissions)),
        };
      }
    }
    this.cache = { uid: u.uid, at: Date.now(), staff };
    return staff;
  }

  async platform(): Promise<PlatformAuth | null> {
    const u = this.auth.currentUser;
    if (!u) return null;
    if (this.cache?.uid === u.uid && this.cache.platform !== undefined && Date.now() - this.cache.at < 30_000) return this.cache.platform;
    const snap = await getDoc(doc(this.db, `platform_admins/${u.uid}`)).catch(() => null);
    const a = snap?.exists() ? snap.data() : null;
    const platform = a && a.active ? { kind: 'platform' as const, adminId: u.uid, name: a.name } : null;
    this.cache = { uid: u.uid, at: Date.now(), platform };
    return platform;
  }

  /** Middleware: a signed-in, active staff member of an active restaurant. */
  staffAuth(): Handler {
    return async (req: Req, _res, next) => {
      const s = await this.staff();
      if (!s) return next(new HttpError(401, 'Please log in again'));
      req.staff = s;
      next();
    };
  }
  platformAuth(): Handler {
    return async (req: Req, _res, next) => {
      const p = await this.platform();
      if (!p) return next(new HttpError(401, 'Please log in again'));
      req.platform = p;
      next();
    };
  }
}

export function requirePerm(perm: Permission): Handler {
  return (req, _res, next) => {
    if (!req.staff || !req.staff.perms.has(perm)) return next(forbidden());
    next();
  };
}
