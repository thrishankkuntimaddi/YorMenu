import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { all, one, run, tx } from '../db.js';
import { conflict, notFound } from '../errors.js';
import { hashPassword, platformAuth } from '../auth.js';
import { parse, id } from '../validate.js';
import { settingsSchema } from '../settings.js';

/** Super-admin area: onboard and suspend restaurants. Sees no orders or bills. */
export function platformRoutes({ db, secret }: AppDeps) {
  const r = Router();
  r.use('/platform', platformAuth(db, secret));

  r.get('/platform/restaurants', (_req, res) => {
    res.json(all(db,
      `SELECT r.id, r.code, r.name, r.address, r.phone, r.active, r.created_at,
              (SELECT COUNT(*) FROM users u WHERE u.restaurant_id = r.id) AS staff,
              (SELECT COUNT(*) FROM tables t WHERE t.restaurant_id = r.id) AS tables
       FROM restaurants r ORDER BY r.id`));
  });

  r.post('/platform/restaurants', (req, res) => {
    const b = parse(z.object({
      code: z.string().trim().regex(/^[A-Za-z0-9-]{3,20}$/, '3-20 letters, numbers or dashes'),
      name: z.string().trim().min(2).max(100),
      address: z.string().max(300).default(''),
      phone: z.string().max(30).default(''),
      owner: z.object({ name: z.string().trim().min(1), username: z.string().trim().min(3).max(40), password: z.string().min(6) }),
    }), req.body);
    if (one(db, 'SELECT id FROM restaurants WHERE code = ? COLLATE NOCASE', b.code)) throw conflict('That restaurant code is taken');
    const rid = tx(db, () => {
      const rest = run(db, 'INSERT INTO restaurants (code, name, address, phone, settings) VALUES (?, ?, ?, ?, ?)',
        b.code.toUpperCase(), b.name, b.address, b.phone, JSON.stringify(settingsSchema.parse({})));
      run(db, `INSERT INTO users (restaurant_id, username, name, role, password_hash) VALUES (?, ?, ?, 'owner', ?)`,
        rest.id, b.owner.username, b.owner.name, hashPassword(b.owner.password));
      return rest.id;
    });
    res.status(201).json({ id: rid, code: b.code.toUpperCase() });
  });

  r.patch('/platform/restaurants/:id', (req, res) => {
    const rid = parse(id, req.params.id);
    const b = parse(z.object({ active: z.boolean() }), req.body);
    const changed = run(db, 'UPDATE restaurants SET active = ? WHERE id = ?', b.active ? 1 : 0, rid).changes;
    if (!changed) throw notFound('Restaurant not found');
    res.json({ ok: true });
  });

  return r;
}
