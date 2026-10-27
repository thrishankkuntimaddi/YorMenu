import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { one, run } from '../db.js';
import { HttpError, badRequest } from '../errors.js';
import { hashPassword, verifyPassword, signToken, staffAuth, rateLimit } from '../auth.js';
import { permissionsFor } from '../permissions.js';
import { parse } from '../validate.js';
import { parseSettings } from '../settings.js';

export function authRoutes({ db, secret }: AppDeps) {
  const r = Router();
  const limiter = rateLimit(20, 60_000);

  r.post('/auth/login', limiter, (req, res) => {
    const body = parse(z.object({
      restaurantCode: z.string().trim().min(1), username: z.string().trim().min(1), password: z.string().min(1),
    }), req.body);
    const user = one(db,
      `SELECT u.*, r.active AS r_active FROM users u JOIN restaurants r ON r.id = u.restaurant_id
       WHERE r.code = ? COLLATE NOCASE AND u.username = ? COLLATE NOCASE`, body.restaurantCode, body.username);
    if (!user || !verifyPassword(body.password, user.password_hash)) throw new HttpError(401, 'Wrong restaurant code, username or password');
    if (!user.active) throw new HttpError(403, 'Your account is disabled. Ask your manager.');
    if (!user.r_active) throw new HttpError(403, 'This restaurant is suspended');
    const token = signToken(secret, { kind: 'staff', sub: user.id, rid: user.restaurant_id, tv: user.token_version });
    res.json({ token });
  });

  r.post('/auth/platform/login', limiter, (req, res) => {
    const body = parse(z.object({ username: z.string().min(1), password: z.string().min(1) }), req.body);
    const admin = one(db, 'SELECT * FROM platform_admins WHERE username = ?', body.username);
    if (!admin || !verifyPassword(body.password, admin.password_hash)) throw new HttpError(401, 'Wrong username or password');
    res.json({ token: signToken(secret, { kind: 'platform', sub: admin.id, tv: admin.token_version }), name: admin.name });
  });

  r.get('/me', staffAuth(db, secret), (req, res) => {
    const s = req.staff!;
    const rest = s.tenant.restaurant();
    const settings = parseSettings(rest.settings);
    res.json({
      user: { id: s.userId, name: s.name, role: s.role },
      permissions: permissionsFor(s.role),
      restaurant: {
        id: rest.id, code: rest.code, name: rest.name, address: rest.address, phone: rest.phone, gstin: rest.gstin,
        settings: { ...settings, kotPrinter: undefined, billPrinter: undefined },
      },
    });
  });

  r.post('/auth/change-password', staffAuth(db, secret), (req, res) => {
    const body = parse(z.object({ current: z.string().min(1), next: z.string().min(6, 'Use at least 6 characters') }), req.body);
    const s = req.staff!;
    const user = s.tenant.must('users', s.userId);
    if (!verifyPassword(body.current, user.password_hash)) throw badRequest('Current password is wrong');
    run(db, 'UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ? AND restaurant_id = ?',
      hashPassword(body.next), s.userId, s.rid);
    const tv = user.token_version + 1;
    res.json({ token: signToken(secret, { kind: 'staff', sub: s.userId, rid: s.rid, tv }) });
  });

  return r;
}
