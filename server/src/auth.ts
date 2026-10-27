import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { DB, one } from './db.js';
import { HttpError, forbidden } from './errors.js';
import { Tenant } from './tenant.js';
import { Permission, Role, can } from './permissions.js';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 32);
  const expected = Buffer.from(hashHex, 'hex');
  return expected.length === hash.length && crypto.timingSafeEqual(hash, expected);
}

export function loadJwtSecret(dataDir: string): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(dataDir, '.jwt-secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('hex');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export type StaffClaims = { kind: 'staff'; sub: number; rid: number; tv: number };
export type PlatformClaims = { kind: 'platform'; sub: number; tv: number };

export type StaffAuth = { kind: 'staff'; userId: number; rid: number; role: Role; name: string; tenant: Tenant };
export type PlatformAuth = { kind: 'platform'; adminId: number; name: string };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { staff?: StaffAuth; platform?: PlatformAuth }
  }
}

export function signToken(secret: string, claims: StaffClaims | PlatformClaims): string {
  return jwt.sign(claims, secret, { expiresIn: '7d' });
}

function bearer(req: Request): string | null {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : null;
}

/**
 * Resolve a staff token into a live session. The user row is re-read on every
 * request, so deactivating a person or their restaurant cuts access at once.
 */
export function resolveStaff(db: DB, secret: string, token: string | null): StaffAuth | null {
  if (!token) return null;
  let claims: StaffClaims;
  try { claims = jwt.verify(token, secret) as unknown as StaffClaims; } catch { return null; }
  if (claims.kind !== 'staff') return null;
  const user = one(db,
    `SELECT u.id, u.name, u.role, u.restaurant_id, u.token_version FROM users u
     JOIN restaurants r ON r.id = u.restaurant_id
     WHERE u.id = ? AND u.restaurant_id = ? AND u.active = 1 AND r.active = 1`,
    claims.sub, claims.rid);
  if (!user || user.token_version !== claims.tv) return null;
  return { kind: 'staff', userId: user.id, rid: user.restaurant_id, role: user.role, name: user.name, tenant: new Tenant(db, user.restaurant_id) };
}

export function staffAuth(db: DB, secret: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const s = resolveStaff(db, secret, bearer(req));
    if (!s) return next(new HttpError(401, 'Please log in again'));
    req.staff = s;
    next();
  };
}

export function platformAuth(db: DB, secret: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = bearer(req);
    try {
      const claims = jwt.verify(token ?? "", secret) as unknown as PlatformClaims;
      if (claims.kind !== 'platform') throw new Error();
      const admin = one(db, 'SELECT id, name, token_version FROM platform_admins WHERE id = ?', claims.sub);
      if (!admin || admin.token_version !== claims.tv) throw new Error();
      req.platform = { kind: 'platform', adminId: admin.id, name: admin.name };
      next();
    } catch {
      next(new HttpError(401, 'Please log in again'));
    }
  };
}

export function requirePerm(perm: Permission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.staff || !can(req.staff.role, perm)) return next(forbidden());
    next();
  };
}

/** Small in-memory limiter for login and public endpoints. */
export function rateLimit(limit: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req: Request, _res: Response, next: NextFunction) => {
    const key = `${req.ip}:${req.baseUrl}${req.path}`;
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) hits.set(key, { n: 1, reset: now + windowMs });
    else if (++h.n > limit) return next(new HttpError(429, 'Too many attempts, please wait a minute'));
    if (hits.size > 10000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    next();
  };
}
