import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { badRequest, conflict, forbidden } from '../errors.js';
import { hashPassword, requirePerm } from '../auth.js';
import { ROLES, Role, canManageRole } from '../permissions.js';
import { parse, id, paise } from '../validate.js';
import { parseSettings, settingsSchema } from '../settings.js';

const newQrToken = () => crypto.randomBytes(12).toString('base64url');
const bool = z.boolean();

function uniqueViolation(e: unknown, msg: string): never {
  if (e instanceof Error && /UNIQUE constraint/.test(e.message)) throw conflict(msg);
  throw e;
}

export function adminRoutes({ rt }: AppDeps) {
  const r = Router();
  const ping = (rid: number, what: string) => { rt.emit(rid, `${what}:changed`); rt.emit(rid, 'floor:changed'); };

  /** Everything the POS screens need to draw tables and the menu. */
  r.get('/catalog', (req, res) => {
    const t = req.staff!.tenant;
    res.json({
      sections: t.all('SELECT * FROM sections WHERE restaurant_id = ? ORDER BY sort, id', t.rid),
      tables: t.all('SELECT id, section_id, label, seats, active, sort FROM tables WHERE restaurant_id = ? ORDER BY sort, id', t.rid),
      categories: t.all('SELECT * FROM menu_categories WHERE restaurant_id = ? ORDER BY sort, id', t.rid),
      items: t.all('SELECT * FROM menu_items WHERE restaurant_id = ? AND active = 1 ORDER BY sort, id', t.rid),
      servers: t.all(`SELECT id, name FROM users WHERE restaurant_id = ? AND active = 1 AND role IN ('server','manager','cashier','owner','trustee') ORDER BY name`, t.rid),
    });
  });

  // ---- Sections (clusters like Hut, AC, Garden) ----
  r.post('/sections', requirePerm('tables.edit'), (req, res) => {
    const t = req.staff!.tenant;
    const b = parse(z.object({ name: z.string().trim().min(1).max(40), sort: z.number().int().default(0) }), req.body);
    try {
      const out = t.run('INSERT INTO sections (restaurant_id, name, sort) VALUES (?, ?, ?)', t.rid, b.name, b.sort);
      ping(t.rid, 'catalog');
      res.status(201).json(t.find('sections', out.id));
    } catch (e) { uniqueViolation(e, 'A section with that name exists'); }
  });
  r.patch('/sections/:id', requirePerm('tables.edit'), (req, res) => {
    const t = req.staff!.tenant;
    const s = t.must('sections', parse(id, req.params.id), 'Section');
    const b = parse(z.object({ name: z.string().trim().min(1).max(40).optional(), sort: z.number().int().optional() }), req.body);
    try {
      t.run('UPDATE sections SET name = ?, sort = ? WHERE id = ? AND restaurant_id = ?', b.name ?? s.name, b.sort ?? s.sort, s.id, t.rid);
    } catch (e) { uniqueViolation(e, 'A section with that name exists'); }
    ping(t.rid, 'catalog');
    res.json(t.find('sections', s.id));
  });
  r.delete('/sections/:id', requirePerm('tables.edit'), (req, res) => {
    const t = req.staff!.tenant;
    const s = t.must('sections', parse(id, req.params.id), 'Section');
    const n = t.one('SELECT COUNT(*) AS n FROM tables WHERE restaurant_id = ? AND section_id = ?', t.rid, s.id)!.n;
    if (n) throw conflict('Move or delete the tables in this section first');
    t.run('DELETE FROM sections WHERE id = ? AND restaurant_id = ?', s.id, t.rid);
    ping(t.rid, 'catalog');
    res.json({ ok: true });
  });

  // ---- Tables ----
  r.post('/tables', requirePerm('tables.edit'), (req, res) => {
    const t = req.staff!.tenant;
    const b = parse(z.object({
      sectionId: id,
      labels: z.array(z.string().trim().min(1).max(20)).min(1).max(200).optional(),
      prefix: z.string().trim().max(15).optional(),
      count: z.number().int().min(1).max(200).optional(),
      start: z.number().int().min(0).default(1),
      seats: z.number().int().min(1).max(50).default(4),
    }), req.body);
    t.must('sections', b.sectionId, 'Section');
    const labels = b.labels ?? Array.from({ length: b.count ?? 1 }, (_, i) => `${b.prefix ?? ''}${b.start + i}`);
    const maxSort = t.one('SELECT COALESCE(MAX(sort), 0) AS m FROM tables WHERE restaurant_id = ?', t.rid)!.m;
    try {
      t.tx(() => labels.forEach((label, i) =>
        t.run('INSERT INTO tables (restaurant_id, section_id, label, seats, qr_token, sort) VALUES (?, ?, ?, ?, ?, ?)',
          t.rid, b.sectionId, label, b.seats, newQrToken(), maxSort + i + 1)));
    } catch (e) { uniqueViolation(e, 'One of those table names already exists'); }
    t.audit(req.staff!.userId, 'tables.add', 'section', b.sectionId, { labels });
    ping(t.rid, 'catalog');
    res.status(201).json({ added: labels.length });
  });
  r.patch('/tables/:id', requirePerm('tables.edit'), (req, res) => {
    const t = req.staff!.tenant;
    const tb = t.must('tables', parse(id, req.params.id), 'Table');
    const b = parse(z.object({
      label: z.string().trim().min(1).max(20).optional(), sectionId: id.optional(), seats: z.number().int().min(1).max(50).optional(),
      active: bool.optional(), sort: z.number().int().optional(), regenerateQr: bool.optional(),
    }), req.body);
    if (b.sectionId) t.must('sections', b.sectionId, 'Section');
    try {
      t.run('UPDATE tables SET label = ?, section_id = ?, seats = ?, active = ?, sort = ?, qr_token = ? WHERE id = ? AND restaurant_id = ?',
        b.label ?? tb.label, b.sectionId ?? tb.section_id, b.seats ?? tb.seats, b.active === undefined ? tb.active : (b.active ? 1 : 0),
        b.sort ?? tb.sort, b.regenerateQr ? newQrToken() : tb.qr_token, tb.id, t.rid);
    } catch (e) { uniqueViolation(e, 'A table with that name exists'); }
    ping(t.rid, 'catalog');
    res.json(t.find('tables', tb.id));
  });
  r.delete('/tables/:id', requirePerm('tables.edit'), (req, res) => {
    const t = req.staff!.tenant;
    const tb = t.must('tables', parse(id, req.params.id), 'Table');
    const used = t.one('SELECT COUNT(*) AS n FROM orders WHERE restaurant_id = ? AND table_id = ?', t.rid, tb.id)!.n;
    if (used) {
      // Keep history intact: hide instead of delete.
      const live = t.one(`SELECT id FROM orders WHERE restaurant_id = ? AND table_id = ? AND status IN ('open','dining_done','billed')`, t.rid, tb.id);
      if (live) throw conflict('This table has a running order');
      t.run('UPDATE tables SET active = 0 WHERE id = ? AND restaurant_id = ?', tb.id, t.rid);
    } else {
      t.run('DELETE FROM cleaning_tasks WHERE restaurant_id = ? AND table_id = ?', t.rid, tb.id);
      t.run('DELETE FROM guest_requests WHERE restaurant_id = ? AND table_id = ?', t.rid, tb.id);
      t.run('DELETE FROM tables WHERE id = ? AND restaurant_id = ?', tb.id, t.rid);
    }
    t.audit(req.staff!.userId, 'tables.remove', 'table', tb.id, { label: tb.label });
    ping(t.rid, 'catalog');
    res.json({ ok: true, archived: !!used });
  });
  r.get('/tables/qr', requirePerm('tables.edit'), (req, res) => {
    const t = req.staff!.tenant;
    res.json(t.all(
      `SELECT tb.id, tb.label, tb.qr_token, s.name AS section FROM tables tb JOIN sections s ON s.id = tb.section_id
       WHERE tb.restaurant_id = ? AND tb.active = 1 ORDER BY s.sort, tb.sort, tb.id`, t.rid));
  });

  // ---- Menu ----
  r.post('/menu/categories', requirePerm('menu.edit'), (req, res) => {
    const t = req.staff!.tenant;
    const b = parse(z.object({ name: z.string().trim().min(1).max(40), sort: z.number().int().default(0) }), req.body);
    try {
      const out = t.run('INSERT INTO menu_categories (restaurant_id, name, sort) VALUES (?, ?, ?)', t.rid, b.name, b.sort);
      ping(t.rid, 'catalog');
      res.status(201).json(t.find('menu_categories', out.id));
    } catch (e) { uniqueViolation(e, 'That category exists'); }
  });
  r.patch('/menu/categories/:id', requirePerm('menu.edit'), (req, res) => {
    const t = req.staff!.tenant;
    const c = t.must('menu_categories', parse(id, req.params.id), 'Category');
    const b = parse(z.object({ name: z.string().trim().min(1).max(40).optional(), sort: z.number().int().optional(), active: bool.optional() }), req.body);
    try {
      t.run('UPDATE menu_categories SET name = ?, sort = ?, active = ? WHERE id = ? AND restaurant_id = ?',
        b.name ?? c.name, b.sort ?? c.sort, b.active === undefined ? c.active : (b.active ? 1 : 0), c.id, t.rid);
    } catch (e) { uniqueViolation(e, 'That category exists'); }
    ping(t.rid, 'catalog');
    res.json(t.find('menu_categories', c.id));
  });
  r.delete('/menu/categories/:id', requirePerm('menu.edit'), (req, res) => {
    const t = req.staff!.tenant;
    const c = t.must('menu_categories', parse(id, req.params.id), 'Category');
    const n = t.one('SELECT COUNT(*) AS n FROM menu_items WHERE restaurant_id = ? AND category_id = ? AND active = 1', t.rid, c.id)!.n;
    if (n) throw conflict('Move or delete the items in this category first');
    t.run('UPDATE menu_categories SET active = 0 WHERE id = ? AND restaurant_id = ?', c.id, t.rid);
    ping(t.rid, 'catalog');
    res.json({ ok: true });
  });

  // No defaults here: a partial update must only touch the fields it sends.
  const itemFields = z.object({
    categoryId: id, name: z.string().trim().min(1).max(80), code: z.string().trim().max(20),
    description: z.string().max(300), price: paise, isVeg: bool, available: bool,
    isSpecial: bool, sendToKitchen: bool, sort: z.number().int(),
  });
  const itemSchema = itemFields.extend({
    code: itemFields.shape.code.default(''), description: itemFields.shape.description.default(''),
    isVeg: bool.default(true), available: bool.default(true), isSpecial: bool.default(false),
    sendToKitchen: bool.default(true), sort: z.number().int().default(0),
  });
  r.post('/menu/items', requirePerm('menu.edit'), (req, res) => {
    const t = req.staff!.tenant;
    const b = parse(itemSchema, req.body);
    t.must('menu_categories', b.categoryId, 'Category');
    const out = t.run(
      `INSERT INTO menu_items (restaurant_id, category_id, name, code, description, price, is_veg, available, is_special, send_to_kitchen, sort)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      t.rid, b.categoryId, b.name, b.code, b.description, b.price, +b.isVeg, +b.available, +b.isSpecial, +b.sendToKitchen, b.sort);
    t.audit(req.staff!.userId, 'menu.add', 'menu_item', out.id, { name: b.name, price: b.price });
    ping(t.rid, 'catalog');
    res.status(201).json(t.find('menu_items', out.id));
  });
  r.patch('/menu/items/:id', (req, res) => {
    const s = req.staff!;
    const t = s.tenant;
    const m = t.must('menu_items', parse(id, req.params.id), 'Menu item');
    const b = parse(itemFields.partial(), req.body);
    const onlyAvailability = Object.keys(b).every((k) => k === 'available');
    const allowed = onlyAvailability ? ['owner', 'trustee', 'manager', 'chef'] : ['owner', 'trustee', 'manager'];
    if (!allowed.includes(s.role)) throw forbidden();
    if (b.categoryId) t.must('menu_categories', b.categoryId, 'Category');
    const v = (k: keyof typeof b, col: string) => (b[k] === undefined ? m[col] : typeof b[k] === 'boolean' ? +(b[k] as boolean) : b[k]);
    t.run(
      `UPDATE menu_items SET category_id = ?, name = ?, code = ?, description = ?, price = ?, is_veg = ?, available = ?, is_special = ?,
       send_to_kitchen = ?, sort = ? WHERE id = ? AND restaurant_id = ?`,
      v('categoryId', 'category_id'), v('name', 'name'), v('code', 'code'), v('description', 'description'), v('price', 'price'),
      v('isVeg', 'is_veg'), v('available', 'available'), v('isSpecial', 'is_special'), v('sendToKitchen', 'send_to_kitchen'), v('sort', 'sort'),
      m.id, t.rid);
    if (b.price !== undefined && b.price !== m.price) t.audit(s.userId, 'menu.price', 'menu_item', m.id, { name: m.name, from: m.price, to: b.price });
    ping(t.rid, 'catalog');
    res.json(t.find('menu_items', m.id));
  });
  r.delete('/menu/items/:id', requirePerm('menu.edit'), (req, res) => {
    const t = req.staff!.tenant;
    const m = t.must('menu_items', parse(id, req.params.id), 'Menu item');
    t.run('UPDATE menu_items SET active = 0 WHERE id = ? AND restaurant_id = ?', m.id, t.rid);
    t.audit(req.staff!.userId, 'menu.remove', 'menu_item', m.id, { name: m.name });
    ping(t.rid, 'catalog');
    res.json({ ok: true });
  });

  // ---- Staff ----
  r.get('/staff', requirePerm('staff.view'), (req, res) => {
    const t = req.staff!.tenant;
    res.json(t.all('SELECT id, username, name, role, phone, active, created_at FROM users WHERE restaurant_id = ? ORDER BY active DESC, role, name', t.rid));
  });
  r.post('/staff', requirePerm('staff.edit'), (req, res) => {
    const s = req.staff!;
    const t = s.tenant;
    const b = parse(z.object({
      name: z.string().trim().min(1).max(60), username: z.string().trim().regex(/^[A-Za-z0-9._-]{3,40}$/, '3-40 letters/numbers'),
      role: z.enum(ROLES), password: z.string().min(6, 'Use at least 6 characters'), phone: z.string().max(20).default(''),
    }), req.body);
    if (!canManageRole(s.role, b.role)) throw forbidden(`You can't create a ${b.role}`);
    try {
      const out = t.run('INSERT INTO users (restaurant_id, username, name, role, phone, password_hash) VALUES (?, ?, ?, ?, ?, ?)',
        t.rid, b.username, b.name, b.role, b.phone, hashPassword(b.password));
      t.audit(s.userId, 'staff.add', 'user', out.id, { username: b.username, role: b.role });
      res.status(201).json({ id: out.id });
    } catch (e) { uniqueViolation(e, 'That username is taken in this restaurant'); }
  });
  r.patch('/staff/:id', requirePerm('staff.edit'), (req, res) => {
    const s = req.staff!;
    const t = s.tenant;
    const u = t.must('users', parse(id, req.params.id), 'Staff member');
    const b = parse(z.object({
      name: z.string().trim().min(1).max(60).optional(), role: z.enum(ROLES).optional(), phone: z.string().max(20).optional(),
      active: bool.optional(), password: z.string().min(6, 'Use at least 6 characters').optional(),
    }), req.body);
    if (!canManageRole(s.role, u.role as Role) || (b.role && !canManageRole(s.role, b.role))) throw forbidden();
    if (u.id === s.userId && (b.active === false || (b.role && b.role !== u.role))) throw badRequest("You can't disable yourself or change your own role");
    if (u.role === 'owner' && (b.active === false || (b.role && b.role !== 'owner'))) {
      const owners = t.one(`SELECT COUNT(*) AS n FROM users WHERE restaurant_id = ? AND role = 'owner' AND active = 1`, t.rid)!.n;
      if (owners <= 1) throw conflict('A restaurant needs at least one active owner');
    }
    const bump = b.password || b.active === false || (b.role && b.role !== u.role) ? 1 : 0;
    t.run(
      `UPDATE users SET name = ?, role = ?, phone = ?, active = ?, password_hash = ?, token_version = token_version + ?
       WHERE id = ? AND restaurant_id = ?`,
      b.name ?? u.name, b.role ?? u.role, b.phone ?? u.phone, b.active === undefined ? u.active : +b.active,
      b.password ? hashPassword(b.password) : u.password_hash, bump, u.id, t.rid);
    t.audit(s.userId, 'staff.update', 'user', u.id, { ...b, password: b.password ? '***' : undefined });
    res.json({ ok: true });
  });

  // ---- Settings ----
  r.get('/settings', requirePerm('settings.edit'), (req, res) => {
    const rest = req.staff!.tenant.restaurant();
    res.json({ name: rest.name, address: rest.address, phone: rest.phone, gstin: rest.gstin, settings: parseSettings(rest.settings) });
  });
  r.put('/settings', requirePerm('settings.edit'), (req, res) => {
    const s = req.staff!;
    const b = parse(z.object({
      name: z.string().trim().min(2).max(100), address: z.string().max(300), phone: z.string().max(30), gstin: z.string().max(20),
      settings: settingsSchema,
    }), req.body);
    s.tenant.db.prepare('UPDATE restaurants SET name = ?, address = ?, phone = ?, gstin = ?, settings = ? WHERE id = ?')
      .run(b.name, b.address, b.phone, b.gstin, JSON.stringify(b.settings), s.rid);
    s.tenant.audit(s.userId, 'settings.update', 'restaurant', s.rid);
    rt.emit(s.rid, 'settings:changed');
    res.json({ ok: true });
  });

  r.get('/audit', requirePerm('audit.view'), (req, res) => {
    const t = req.staff!.tenant;
    const before = req.query.before ? parse(id, req.query.before) : Number.MAX_SAFE_INTEGER;
    res.json(t.all(
      `SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.restaurant_id = ? AND a.id < ? ORDER BY a.id DESC LIMIT 100`, t.rid, before));
  });

  return r;
}
