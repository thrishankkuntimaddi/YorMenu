import { z } from 'zod';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { signInWithEmailAndPassword, signOut, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';
import { Router } from '../http.js';
import type { AppDeps } from '../index.js';
import { one, nowStr } from '../db.js';
import { HttpError, badRequest } from '../errors.js';
import { loginKey } from '../session.js';
import { editableRoles } from '../permissions.js';
import { parse } from '../validate.js';
import { parseSettings } from '../settings.js';
import { platformContact } from './platform.js';

function authError(e: any, fallback: string): never {
  if (e?.code === 'auth/too-many-requests') throw new HttpError(429, 'Too many wrong passwords. Wait a few minutes, or ask your manager to reset it.');
  if (e?.code === 'auth/network-request-failed') throw new HttpError(503, 'No internet connection');
  throw new HttpError(401, fallback);
}

export function authRoutes({ db, auth, sessions }: AppDeps) {
  const r = new Router();

  /** Restaurant code + username + password, like a POS. */
  r.post('/auth/login', async (req, res) => {
    const b = parse(z.object({ restaurantCode: z.string().trim().min(1), username: z.string().trim().min(1), password: z.string().min(1) }), req.body);
    const wrong = 'Wrong restaurant code, username or password';
    const link = await one(doc(db, `logins/${loginKey(b.restaurantCode, b.username)}`)).catch(() => undefined);
    if (!link) throw new HttpError(401, wrong);
    sessions.clear();
    const cred = await signInWithEmailAndPassword(auth, link.email, b.password).catch((e) => authError(e, wrong));
    const m = await one(doc(db, `members/${cred.user.uid}`));
    if (!m || !m.active) { await signOut(auth); throw new HttpError(403, 'Your account is disabled. Ask your manager.'); }
    const rest = await one(doc(db, `restaurants/${m.rid}`)).catch(() => undefined);
    if (!rest || !rest.active) {
      await signOut(auth);
      throw new HttpError(403, `This restaurant is suspended${rest?.suspend_reason ? `: ${rest.suspend_reason}` : ''}. Call YorMenu support.`);
    }
    await updateDoc(doc(db, `restaurants/${m.rid}/users/${m.user_id}`), { last_login_at: nowStr() }).catch(() => {});
    res.json({ ok: true });
  });

  r.post('/auth/platform/login', async (req, res) => {
    const b = parse(z.object({ username: z.string().trim().min(1), password: z.string().min(1) }), req.body);
    sessions.clear();
    const cred = await signInWithEmailAndPassword(auth, b.username.toLowerCase(), b.password).catch((e) => authError(e, 'Wrong email or password'));
    const a = await getDoc(doc(db, `platform_admins/${cred.user.uid}`)).catch(() => null);
    if (!a?.exists() || !a.data().active) { await signOut(auth); throw new HttpError(401, 'This login is not a platform admin'); }
    await updateDoc(doc(db, `platform_admins/${cred.user.uid}`), { last_login_at: nowStr() }).catch(() => {});
    res.json({ ok: true, name: a.data().name });
  });

  r.post('/auth/logout', async (_req, res) => {
    sessions.clear();
    await signOut(auth);
    res.json({ ok: true });
  });

  r.get('/me', sessions.staffAuth(), async (req, res) => {
    const s = req.staff!;
    const [rest, user] = await Promise.all([s.tenant.restaurant(), s.tenant.find('users', s.userId)]);
    const settings = parseSettings(rest.settings);
    res.json({
      user: { id: s.userId, name: s.name, role: s.role, lang: user?.lang || settings.language },
      permissions: [...s.perms],
      manages: editableRoles(s.role),
      support: await platformContact(db),
      restaurant: {
        id: rest.id, code: rest.code, name: rest.name, address: rest.address, phone: rest.phone, gstin: rest.gstin,
        settings: { ...settings, kotPrinter: undefined, billPrinter: undefined },
      },
    });
  });

  /** Support contact for the login screen and public website. */
  r.get('/public/support', async (_req, res) => { res.json(await platformContact(db)); });

  r.post('/auth/change-password', sessions.staffAuth(), async (req, res) => {
    const b = parse(z.object({ current: z.string().min(1), next: z.string().min(6, 'Use at least 6 characters') }), req.body);
    const u = auth.currentUser!;
    try {
      await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email!, b.current));
    } catch { throw badRequest('Current password is wrong'); }
    await updatePassword(u, b.next);
    res.json({ ok: true });
  });

  return r;
}
