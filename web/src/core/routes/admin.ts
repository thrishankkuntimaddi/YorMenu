import { z } from 'zod';
import { doc, setDoc, deleteDoc, writeBatch, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { Router } from '../http.js';
import type { AppDeps } from '../index.js';
import { Row, by, nowStr, one } from '../db.js';
import { badRequest, conflict, forbidden } from '../errors.js';
import { requirePerm, createLogin, staffEmail, loginKey } from '../session.js';
import { publishProfile } from '../services/guest.js';
import { ROLES, Role, canManageRole } from '../permissions.js';
import { parse, id, paise } from '../validate.js';
import { parseSettings, settingsSchema } from '../settings.js';
import { Tenant } from '../tenant.js';

export const newQrToken = () => {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const bool = z.boolean();
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function adminRoutes({ db, rt, app }: AppDeps) {
  const r = new Router();
  const ping = (rid: number, what: string) => { rt.emit(rid, `${what}:changed`); rt.emit(rid, 'floor:changed'); };
  const qrLink = (t: Tenant, token: string, tableId: number, label: string) => setDoc(doc(db, `qr_tokens/${token}`), { rid: t.rid, table_id: tableId, label });
  const qrUnlink = (token: string) => deleteDoc(doc(db, `qr_tokens/${token}`));

  /** Everything the POS screens need to draw tables and the menu. */
  r.get('/catalog', async (req, res) => {
    const t = req.staff!.tenant;
    const [sections, tables, categories, items, users] = await Promise.all([
      t.list('sections'), t.list('tables'), t.list('menu_categories'), t.list('menu_items', ['active', '==', 1]), t.list('users', ['active', '==', 1]),
    ]);
    res.json({
      sections: sections.sort(by('sort', 'id')),
      tables: tables.sort(by('sort', 'id')).map((x) => ({ id: x.id, section_id: x.section_id, label: x.label, seats: x.seats, active: x.active, sort: x.sort })),
      categories: categories.sort(by('sort', 'id')),
      items: items.sort(by('sort', 'id')),
      servers: users.filter((u) => ['server', 'manager', 'cashier', 'owner', 'trustee'].includes(u.role)).sort(by('name')).map((u) => ({ id: u.id, name: u.name })),
    });
  });

  // ---- Sections (clusters like Hut, AC, Garden) ----
  r.post('/sections', requirePerm('tables.edit'), async (req, res) => {
    const t = req.staff!.tenant;
    const b = parse(z.object({ name: z.string().trim().min(1).max(40), sort: z.number().int().default(0) }), req.body);
    if ((await t.list('sections')).some((s) => sameName(s.name, b.name))) throw conflict('A section with that name exists');
    const row = await t.insert('sections', { name: b.name, sort: b.sort });
    ping(t.rid, 'catalog');
    res.status(201).json(row);
  });
  r.patch('/sections/:id', requirePerm('tables.edit'), async (req, res) => {
    const t = req.staff!.tenant;
    const s = await t.must('sections', parse(id, req.params.id), 'Section');
    const b = parse(z.object({ name: z.string().trim().min(1).max(40).optional(), sort: z.number().int().optional() }), req.body);
    if (b.name && (await t.list('sections')).some((x) => x.id !== s.id && sameName(x.name, b.name!))) throw conflict('A section with that name exists');
    await t.update('sections', s.id, { name: b.name ?? s.name, sort: b.sort ?? s.sort });
    ping(t.rid, 'catalog');
    res.json(await t.find('sections', s.id));
  });
  r.delete('/sections/:id', requirePerm('tables.edit'), async (req, res) => {
    const t = req.staff!.tenant;
    const s = await t.must('sections', parse(id, req.params.id), 'Section');
    if ((await t.list('tables', ['section_id', '==', s.id])).length) throw conflict('Move or delete the tables in this section first');
    await t.remove('sections', s.id);
    ping(t.rid, 'catalog');
    res.json({ ok: true });
  });

  // ---- Tables ----
  r.post('/tables', requirePerm('tables.edit'), async (req, res) => {
    const t = req.staff!.tenant;
    const b = parse(z.object({
      sectionId: id,
      labels: z.array(z.string().trim().min(1).max(20)).min(1).max(200).optional(),
      prefix: z.string().trim().max(15).optional(),
      count: z.number().int().min(1).max(200).optional(),
      start: z.number().int().min(0).default(1),
      seats: z.number().int().min(1).max(50).default(4),
    }), req.body);
    await t.must('sections', b.sectionId, 'Section');
    const labels = b.labels ?? Array.from({ length: b.count ?? 1 }, (_, i) => `${b.prefix ?? ''}${b.start + i}`);
    const existing = await t.list('tables');
    if (labels.some((l) => existing.some((x) => sameName(x.label, l))) || new Set(labels.map((l) => l.toLowerCase())).size !== labels.length) {
      throw conflict('One of those table names already exists');
    }
    const maxSort = Math.max(0, ...existing.map((x) => x.sort ?? 0));
    await t.tx(async (tx) => {
      labels.forEach((label, i) => {
        const token = newQrToken();
        const row = t.newDoc('tables', {
          section_id: b.sectionId, label, seats: b.seats, qr_token: token, needs_cleaning: 0, active: 1, sort: maxSort + i + 1, live_order_id: null,
        }, tx);
        tx.set(doc(db, `qr_tokens/${token}`), { rid: t.rid, table_id: row.id, label });
      });
    });
    await t.audit(req.staff!.userId, 'tables.add', 'section', b.sectionId, { labels });
    ping(t.rid, 'catalog');
    res.status(201).json({ added: labels.length });
  });
  r.patch('/tables/:id', requirePerm('tables.edit'), async (req, res) => {
    const t = req.staff!.tenant;
    const tb = await t.must('tables', parse(id, req.params.id), 'Table');
    const b = parse(z.object({
      label: z.string().trim().min(1).max(20).optional(), sectionId: id.optional(), seats: z.number().int().min(1).max(50).optional(),
      active: bool.optional(), sort: z.number().int().optional(), regenerateQr: bool.optional(),
    }), req.body);
    if (b.sectionId) await t.must('sections', b.sectionId, 'Section');
    if (b.label && (await t.list('tables')).some((x) => x.id !== tb.id && sameName(x.label, b.label!))) throw conflict('A table with that name exists');
    const token = b.regenerateQr ? newQrToken() : tb.qr_token;
    await t.update('tables', tb.id, {
      label: b.label ?? tb.label, section_id: b.sectionId ?? tb.section_id, seats: b.seats ?? tb.seats,
      active: b.active === undefined ? tb.active : +b.active, sort: b.sort ?? tb.sort, qr_token: token,
    });
    if (b.regenerateQr) await qrUnlink(tb.qr_token);
    if (b.regenerateQr || (b.label && b.label !== tb.label)) await qrLink(t, token, tb.id, b.label ?? tb.label);
    ping(t.rid, 'catalog');
    res.json(await t.find('tables', tb.id));
  });
  r.delete('/tables/:id', requirePerm('tables.edit'), async (req, res) => {
    const t = req.staff!.tenant;
    const tb = await t.must('tables', parse(id, req.params.id), 'Table');
    const used = (await t.list('orders', ['table_id', '==', tb.id]));
    if (used.length) {
      // Keep history intact: hide instead of delete.
      if (used.some((o) => ['open', 'dining_done', 'billed'].includes(o.status))) throw conflict('This table has a running order');
      await t.update('tables', tb.id, { active: 0 });
    } else {
      const [tasks, reqs] = await Promise.all([t.list('cleaning_tasks', ['table_id', '==', tb.id]), t.list('guest_requests', ['table_id', '==', tb.id])]);
      await Promise.all([...tasks.map((x) => t.remove('cleaning_tasks', x.id)), ...reqs.map((x) => t.remove('guest_requests', x.id))]);
      await t.remove('tables', tb.id);
      await qrUnlink(tb.qr_token);
    }
    await t.audit(req.staff!.userId, 'tables.remove', 'table', tb.id, { label: tb.label });
    ping(t.rid, 'catalog');
    res.json({ ok: true, archived: used.length > 0 });
  });
  r.get('/tables/qr', requirePerm('tables.edit'), async (req, res) => {
    const t = req.staff!.tenant;
    const [tables, sections] = await Promise.all([t.list('tables', ['active', '==', 1]), t.list('sections')]);
    const sec = new Map(sections.map((s) => [s.id, s]));
    res.json(tables
      .sort(by((x: Row) => sec.get(x.section_id)?.sort ?? 0, 'sort', 'id'))
      .map((x) => ({ id: x.id, label: x.label, qr_token: x.qr_token, section: sec.get(x.section_id)?.name ?? '' })));
  });

  // ---- Menu ----
  r.post('/menu/categories', requirePerm('menu.edit'), async (req, res) => {
    const t = req.staff!.tenant;
    const b = parse(z.object({ name: z.string().trim().min(1).max(40), sort: z.number().int().default(0) }), req.body);
    if ((await t.list('menu_categories')).some((c) => c.active && sameName(c.name, b.name))) throw conflict('That category exists');
    const row = await t.insert('menu_categories', { name: b.name, sort: b.sort, active: 1 });
    ping(t.rid, 'catalog');
    res.status(201).json(row);
  });
  r.patch('/menu/categories/:id', requirePerm('menu.edit'), async (req, res) => {
    const t = req.staff!.tenant;
    const c = await t.must('menu_categories', parse(id, req.params.id), 'Category');
    const b = parse(z.object({ name: z.string().trim().min(1).max(40).optional(), sort: z.number().int().optional(), active: bool.optional() }), req.body);
    if (b.name && (await t.list('menu_categories')).some((x) => x.id !== c.id && x.active && sameName(x.name, b.name!))) throw conflict('That category exists');
    await t.update('menu_categories', c.id, { name: b.name ?? c.name, sort: b.sort ?? c.sort, active: b.active === undefined ? c.active : +b.active });
    ping(t.rid, 'catalog');
    res.json(await t.find('menu_categories', c.id));
  });
  r.delete('/menu/categories/:id', requirePerm('menu.edit'), async (req, res) => {
    const t = req.staff!.tenant;
    const c = await t.must('menu_categories', parse(id, req.params.id), 'Category');
    if ((await t.list('menu_items', ['category_id', '==', c.id])).some((m) => m.active)) throw conflict('Move or delete the items in this category first');
    await t.update('menu_categories', c.id, { active: 0 });
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
  r.post('/menu/items', requirePerm('menu.edit'), async (req, res) => {
    const t = req.staff!.tenant;
    const b = parse(itemSchema, req.body);
    await t.must('menu_categories', b.categoryId, 'Category');
    const row = await t.insert('menu_items', {
      category_id: b.categoryId, name: b.name, code: b.code, description: b.description, price: b.price, is_veg: +b.isVeg,
      available: +b.available, is_special: +b.isSpecial, send_to_kitchen: +b.sendToKitchen, active: 1, sort: b.sort,
    });
    await t.audit(req.staff!.userId, 'menu.add', 'menu_item', row.id, { name: b.name, price: b.price });
    ping(t.rid, 'catalog');
    res.status(201).json(row);
  });
  r.patch('/menu/items/:id', async (req, res) => {
    const s = req.staff!;
    const t = s.tenant;
    const m = await t.must('menu_items', parse(id, req.params.id), 'Menu item');
    const b = parse(itemFields.partial(), req.body);
    const onlyAvailability = Object.keys(b).every((k) => k === 'available');
    if (!s.perms.has(onlyAvailability ? 'menu.availability' : 'menu.edit') && !s.perms.has('menu.edit')) throw forbidden();
    if (b.categoryId) await t.must('menu_categories', b.categoryId, 'Category');
    const v = (k: keyof typeof b, col: string) => (b[k] === undefined ? m[col] : typeof b[k] === 'boolean' ? +(b[k] as boolean) : b[k]);
    await t.update('menu_items', m.id, {
      category_id: v('categoryId', 'category_id'), name: v('name', 'name'), code: v('code', 'code'), description: v('description', 'description'),
      price: v('price', 'price'), is_veg: v('isVeg', 'is_veg'), available: v('available', 'available'), is_special: v('isSpecial', 'is_special'),
      send_to_kitchen: v('sendToKitchen', 'send_to_kitchen'), sort: v('sort', 'sort'),
    });
    if (b.price !== undefined && b.price !== m.price) await t.audit(s.userId, 'menu.price', 'menu_item', m.id, { name: m.name, from: m.price, to: b.price });
    ping(t.rid, 'catalog');
    res.json(await t.find('menu_items', m.id));
  });
  r.delete('/menu/items/:id', requirePerm('menu.edit'), async (req, res) => {
    const t = req.staff!.tenant;
    const m = await t.must('menu_items', parse(id, req.params.id), 'Menu item');
    await t.update('menu_items', m.id, { active: 0 });
    await t.audit(req.staff!.userId, 'menu.remove', 'menu_item', m.id, { name: m.name });
    ping(t.rid, 'catalog');
    res.json({ ok: true });
  });

  // ---- Staff ----
  const ROLE_ORDER = ['owner', 'trustee', 'manager', 'cashier', 'server', 'chef', 'cleaner'];
  r.get('/staff', requirePerm('staff.view'), async (req, res) => {
    const users = await req.staff!.tenant.list('users');
    res.json(users.sort(by((u: Row) => -u.active, (u: Row) => ROLE_ORDER.indexOf(u.role), 'name'))
      .map((u) => ({ id: u.id, username: u.username, name: u.name, role: u.role, phone: u.phone, email: u.email ?? '', active: u.active, created_at: u.created_at })));
  });
  r.post('/staff', requirePerm('staff.edit'), async (req, res) => {
    const s = req.staff!;
    const t = s.tenant;
    const b = parse(z.object({
      name: z.string().trim().min(1).max(60), username: z.string().trim().regex(/^[A-Za-z0-9._-]{3,40}$/, '3-40 letters, numbers, dots or dashes'),
      role: z.enum(ROLES), password: z.string().min(6, 'Use at least 6 characters'), phone: z.string().max(20).default(''), email: z.string().max(120).default(''),
    }), req.body);
    if (!canManageRole(s.role, b.role)) throw forbidden(`You can't create a ${b.role}`);
    const id = await addStaff(app, db, t.rid, s.code, b);
    await t.audit(s.userId, 'staff.add', 'user', id, { username: b.username, role: b.role });
    res.status(201).json({ id });
  });
  r.patch('/staff/:id', requirePerm('staff.edit'), async (req, res) => {
    const s = req.staff!;
    const t = s.tenant;
    const u = await t.must('users', parse(id, req.params.id), 'Staff member');
    const b = parse(z.object({
      name: z.string().trim().min(1).max(60).optional(), role: z.enum(ROLES).optional(), phone: z.string().max(20).optional(), email: z.string().max(120).optional(),
      active: bool.optional(), password: z.string().min(6, 'Use at least 6 characters').optional(),
    }), req.body);
    if (!canManageRole(s.role, u.role as Role) || (b.role && !canManageRole(s.role, b.role))) throw forbidden();
    if (u.id === s.userId && (b.active === false || (b.role && b.role !== u.role))) throw badRequest("You can't disable yourself or change your own role");
    if (u.role === 'owner' && (b.active === false || (b.role && b.role !== 'owner'))) {
      const owners = (await t.list('users', ['role', '==', 'owner'])).filter((x) => x.active).length;
      if (owners <= 1) throw conflict('A restaurant needs at least one active owner');
    }
    await updateStaff(app, db, t.rid, s.code, u, b);
    await t.audit(s.userId, 'staff.update', 'user', u.id, { ...b, password: b.password ? '***' : undefined });
    res.json({ ok: true });
  });

  // ---- Settings ----
  r.get('/settings', requirePerm('settings.edit'), async (req, res) => {
    const rest = await req.staff!.tenant.restaurant();
    res.json({ name: rest.name, address: rest.address, phone: rest.phone, gstin: rest.gstin, settings: parseSettings(rest.settings) });
  });
  r.put('/settings', requirePerm('settings.edit'), async (req, res) => {
    const s = req.staff!;
    const b = parse(z.object({
      name: z.string().trim().min(2).max(100), address: z.string().max(300), phone: z.string().max(30), gstin: z.string().max(20),
      settings: settingsSchema,
    }), req.body);
    await s.tenant.updateRestaurant({ name: b.name, address: b.address, phone: b.phone, gstin: b.gstin, settings: JSON.stringify(b.settings) });
    await publishProfile(db, s.rid, await s.tenant.restaurant());
    await s.tenant.audit(s.userId, 'settings.update', 'restaurant', s.rid);
    rt.emit(s.rid, 'settings:changed');
    res.json({ ok: true });
  });

  r.get('/audit', requirePerm('audit.view'), async (req, res) => {
    const t = req.staff!.tenant;
    const before = req.query.before ? parse(id, req.query.before) : Number.MAX_SAFE_INTEGER;
    const snap = await getDocs(query(t.col('audit_log'), where('id', '<', before), orderBy('id', 'desc'), limit(100)));
    const rows = snap.docs.map((d) => d.data());
    res.json(await Promise.all(rows.map(async (a) => ({ ...a, user_name: await t.userName(a.user_id) }))));
  });

  return r;
}

type StaffInput = { name: string; username: string; role: string; password: string; phone?: string; email?: string };

/**
 * A staff member is three linked records:
 *   restaurants/{rid}/users/{id}   profile shown in the app
 *   members/{authUid}              what security rules check (restaurant, role, active)
 *   logins/{CODE}_{username}       turns code + username into the Firebase login
 */
export async function addStaff(app: AppDeps['app'], db: AppDeps['db'], rid: number, code: string, b: StaffInput, uidOverride?: number) {
  if (await one(doc(db, `logins/${loginKey(code, b.username)}`))) throw conflict('That username is taken in this restaurant');
  const email = staffEmail(code, b.username, 1);
  const authUid = await createLogin(app, email, b.password);
  const id = uidOverride ?? Date.now() * 1000 + Math.floor(Math.random() * 1000);
  const batch = writeBatch(db);
  batch.set(doc(db, `restaurants/${rid}/users/${id}`), {
    id, restaurant_id: rid, username: b.username, username_lc: b.username.toLowerCase(), name: b.name, role: b.role, phone: b.phone ?? '',
    email: b.email ?? '', active: 1, auth_uid: authUid, login_version: 1, lang: '', last_login_at: null, created_at: nowStr(),
  });
  batch.set(doc(db, `members/${authUid}`), { rid, user_id: id, role: b.role, name: b.name, active: 1 });
  batch.set(doc(db, `logins/${loginKey(code, b.username)}`), { email, rid, user_id: id });
  await batch.commit();
  return id;
}

/** Name/role/active changes, and owner password resets (a fresh login replaces the old one). */
export async function updateStaff(app: AppDeps['app'], db: AppDeps['db'], rid: number, code: string, u: Row,
  b: { name?: string; role?: string; phone?: string; email?: string; active?: boolean; password?: string }) {
  const name = b.name ?? u.name;
  const role = b.role ?? u.role;
  const active = b.active === undefined ? u.active : +b.active;
  let authUid = u.auth_uid;
  let version = u.login_version ?? 1;
  const batch = writeBatch(db);
  if (b.password) {
    version += 1;
    const email = staffEmail(code, u.username, version);
    authUid = await createLogin(app, email, b.password);
    batch.update(doc(db, `members/${u.auth_uid}`), { active: 0 });
    batch.set(doc(db, `logins/${loginKey(code, u.username)}`), { email, rid, user_id: u.id });
  }
  batch.set(doc(db, `members/${authUid}`), { rid, user_id: u.id, role, name, active });
  batch.update(doc(db, `restaurants/${rid}/users/${u.id}`), {
    name, role, phone: b.phone ?? u.phone, email: b.email ?? u.email ?? '', active, auth_uid: authUid, login_version: version,
  });
  await batch.commit();
}
