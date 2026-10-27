import { z } from 'zod';
import { doc, setDoc, updateDoc, writeBatch, collection } from 'firebase/firestore';
import { createUserWithEmailAndPassword, deleteUser, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';
import { Router, type Req as Request } from '../http.js';
import type { AppDeps } from '../index.js';
import { DB, Row, all, by, newId, nowStr, one, q } from '../db.js';
import { badRequest, conflict, notFound, HttpError } from '../errors.js';
import { createLogin } from '../session.js';
import { parse, id } from '../validate.js';
import { settingsSchema } from '../settings.js';
import { permsMap } from '../permissions.js';
import { DOC_TYPES, complianceOverview, docState } from '../services/compliance.js';
import { publishProfile } from '../services/guest.js';
import { addTicketMessage, ticketMessages, nextCounter } from './owner.js';
import { addStaff, updateStaff } from './admin.js';

const CONTACT_DEFAULTS = {
  supportName: '', supportPhone: '', supportWhatsapp: '', supportEmail: '', supportHours: '9 AM – 10 PM, all days', companyName: 'YorMenu', announcement: '',
};
type Contact = typeof CONTACT_DEFAULTS;

/** Support contact shown to every restaurant, on the login page and on the website. Edited by platform admins. */
export async function platformContact(db: DB): Promise<Contact> {
  const saved = await one(doc(db, 'platform_settings/contact')).catch(() => undefined);
  return { ...CONTACT_DEFAULTS, ...(saved ?? {}) };
}

const contactSchema = z.object({
  supportName: z.string().max(80).default(''), supportPhone: z.string().max(20).default(''), supportWhatsapp: z.string().max(20).default(''),
  supportEmail: z.string().max(120).default(''), supportHours: z.string().max(80).default(CONTACT_DEFAULTS.supportHours),
  companyName: z.string().max(60).default('YorMenu'), announcement: z.string().max(300).default(''),
});

const STATUSES = ['open', 'in_progress', 'waiting', 'resolved', 'closed'] as const;
const LIVE_TICKET = ['open', 'in_progress', 'waiting'];

/** Create a restaurant, its code lookup, public profile and first owner login. */
export async function createRestaurant(deps: Pick<AppDeps, 'db' | 'app'>, b: {
  code: string; name: string; address?: string; city?: string; state?: string; phone?: string; email?: string; gstin?: string; plan?: string; platformNotes?: string;
  owner: { name: string; username: string; password: string; phone?: string; email?: string };
}) {
  const { db, app } = deps;
  const code = b.code.trim().toUpperCase();
  if (await one(doc(db, `restaurant_codes/${code}`)).catch(() => undefined)) throw conflict('That restaurant code is taken');
  const rid = await nextCounter(db, 'restaurants');
  const rest = {
    id: rid, code, name: b.name, address: b.address ?? '', city: b.city ?? '', state: b.state ?? '', phone: b.phone ?? '', email: b.email ?? '',
    gstin: b.gstin ?? '', plan: b.plan ?? 'free', platform_notes: b.platformNotes ?? '', active: 1, suspend_reason: '',
    settings: JSON.stringify(settingsSchema.parse({})), permissions: '{}', perms: permsMap({}),
    bill_seq: 0, kot_seq: 0, kot_seq_date: null, order_seq: 0, order_seq_date: null, created_at: nowStr(),
  };
  const batch = writeBatch(db);
  batch.set(doc(db, `restaurant_codes/${code}`), { rid });
  batch.set(doc(db, `restaurants/${rid}`), rest);
  await batch.commit();
  await publishProfile(db, rid, rest);
  await addStaff(app, db, rid, code, { ...b.owner, role: 'owner' });
  return { id: rid, code };
}

/**
 * Super-admin area: onboard restaurants, support them, check their licences.
 * By design (and by security rules) it never reads orders, bills or customer data.
 */
export function platformRoutes({ db, app, auth, sessions }: AppDeps) {
  const r = new Router();

  /** One-time setup: the first platform admin. Security rules allow it only once, ever. */
  r.post('/platform/bootstrap', async (req, res) => {
    const b = parse(z.object({
      email: z.string().trim().email(), password: z.string().min(10, 'Use at least 10 characters'), name: z.string().trim().min(1).max(60),
      contact: contactSchema.partial().optional(),
    }), req.body);
    const cred = await createUserWithEmailAndPassword(auth, b.email.toLowerCase(), b.password).catch((e) => {
      throw new HttpError(e?.code === 'auth/email-already-in-use' ? 409 : 400, e?.message ?? 'Could not create the login');
    });
    const batch = writeBatch(db);
    batch.set(doc(db, `platform_admins/${cred.user.uid}`), { id: cred.user.uid, email: b.email.toLowerCase(), name: b.name, phone: '', active: 1, created_at: nowStr(), last_login_at: null });
    batch.set(doc(db, '_system/bootstrap'), { at: nowStr(), by: cred.user.uid });
    await batch.commit().catch(async () => {
      await deleteUser(cred.user).catch(() => {});
      throw new HttpError(403, 'Setup is already done');
    });
    sessions.clear();
    if (b.contact) await setDoc(doc(db, 'platform_settings/contact'), contactSchema.parse(b.contact));
    res.status(201).json({ ok: true });
  });

  r.use('/platform', sessions.platformAuth());
  const audit = (req: Request, action: string, rid: number | null, details: unknown = {}) => {
    const aid = newId();
    return setDoc(doc(db, `platform_audit/${aid}`), { id: aid, admin_id: req.platform!.adminId, admin_name: req.platform!.name, action, restaurant_id: rid, details: JSON.stringify(details), created_at: nowStr() });
  };
  const restaurant = async (rid: number) => {
    const x = await one(doc(db, `restaurants/${rid}`));
    if (!x) throw notFound('Restaurant not found');
    return x;
  };
  const users = (rid: number) => all(collection(db, `restaurants/${rid}/users`));

  // ---------- Me & other admins ----------
  r.get('/platform/me', async (req, res) => {
    const a = (await one(doc(db, `platform_admins/${req.platform!.adminId}`)))!;
    res.json({ id: a.id, username: a.email, name: a.name, phone: a.phone, email: a.email, last_login_at: a.last_login_at });
  });
  r.put('/platform/me', async (req, res) => {
    const b = parse(z.object({ name: z.string().trim().min(1).max(60), phone: z.string().max(20) }).passthrough(), req.body);
    await updateDoc(doc(db, `platform_admins/${req.platform!.adminId}`), { name: b.name, phone: b.phone });
    res.json({ ok: true });
  });
  r.post('/platform/me/password', async (req, res) => {
    const b = parse(z.object({ current: z.string().min(1), next: z.string().min(10, 'Use at least 10 characters') }), req.body);
    const u = auth.currentUser!;
    try { await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email!, b.current)); } catch { throw badRequest('Current password is wrong'); }
    await updatePassword(u, b.next);
    await audit(req, 'admin.password', null);
    res.json({ ok: true });
  });
  r.get('/platform/admins', async (_req, res) => {
    const admins = await all(collection(db, 'platform_admins'));
    res.json(admins.sort(by('name')).map((a) => ({ id: a.id, name: a.name, email: a.email, phone: a.phone, active: a.active, last_login_at: a.last_login_at })));
  });
  r.post('/platform/admins', async (req, res) => {
    const b = parse(z.object({ email: z.string().trim().email(), password: z.string().min(10, 'Use at least 10 characters'), name: z.string().trim().min(1).max(60), phone: z.string().max(20).default('') }), req.body);
    const uid = await createLogin(app, b.email.toLowerCase(), b.password);
    await setDoc(doc(db, `platform_admins/${uid}`), { id: uid, email: b.email.toLowerCase(), name: b.name, phone: b.phone, active: 1, created_at: nowStr(), last_login_at: null });
    await audit(req, 'admin.create', null, { email: b.email });
    res.status(201).json({ id: uid });
  });
  r.patch('/platform/admins/:id', async (req, res) => {
    const b = parse(z.object({ active: z.boolean() }), req.body);
    if (req.params.id === req.platform!.adminId) throw badRequest("You can't disable yourself");
    const a = await one(doc(db, `platform_admins/${req.params.id}`));
    if (!a) throw notFound('Admin not found');
    await updateDoc(doc(db, `platform_admins/${req.params.id}`), { active: +b.active });
    await audit(req, b.active ? 'admin.enable' : 'admin.disable', null, { email: a.email });
    res.json({ ok: true });
  });

  // ---------- Dashboard ----------
  r.get('/platform/dashboard', async (_req, res) => {
    const [rests, tickets, docs] = await Promise.all([all(collection(db, 'restaurants')), all(collection(db, 'support_tickets')), all(collection(db, 'compliance_docs'))]);
    const staff = (await Promise.all(rests.map((x) => users(x.id)))).flat().filter((u) => u.active);
    const docCounts = { pending: 0, expiring: 0, expired: 0, verified: 0, rejected: 0 };
    for (const d of docs) docCounts[docState(d) as keyof typeof docCounts]++;
    const name = new Map(rests.map((x) => [x.id, x]));
    const prio = ['urgent', 'high', 'normal', 'low'];
    const open = tickets.filter((k) => LIVE_TICKET.includes(k.status));
    const lastLogin = new Map<number, string>();
    for (const u of staff) if (u.last_login_at && (lastLogin.get(u.restaurant_id) ?? '') < u.last_login_at) lastLogin.set(u.restaurant_id, u.last_login_at);
    const weekAgo = nowStr(new Date(Date.now() - 7 * 86400_000));
    res.json({
      restaurants: { total: rests.length, active: rests.filter((x) => x.active).length, suspended: rests.filter((x) => !x.active).length },
      staff: staff.length, docs: docCounts,
      openTickets: open.length, urgentTickets: open.filter((k) => k.priority === 'urgent' || k.priority === 'high').length,
      recentTickets: open.sort(by((k: Row) => prio.indexOf(k.priority))).slice(0, 8)
        .map((k) => ({ id: k.id, subject: k.subject, priority: k.priority, status: k.status, category: k.category, updated_at: k.updated_at, restaurant: name.get(k.restaurant_id)?.name, code: name.get(k.restaurant_id)?.code })),
      inactive: rests.filter((x) => x.active && (lastLogin.get(x.id) ?? '') < weekAgo).slice(0, 10)
        .map((x) => ({ id: x.id, code: x.code, name: x.name, last_login: lastLogin.get(x.id) ?? null })),
    });
  });

  // ---------- Restaurants ----------
  r.get('/platform/restaurants', async (_req, res) => {
    const [rests, docs, tickets] = await Promise.all([all(collection(db, 'restaurants')), all(collection(db, 'compliance_docs')), all(collection(db, 'support_tickets'))]);
    const out = await Promise.all(rests.map(async (x) => {
      const us = await users(x.id);
      return {
        id: x.id, code: x.code, name: x.name, address: x.address, city: x.city, state: x.state, phone: x.phone, email: x.email, gstin: x.gstin, plan: x.plan,
        active: x.active, suspend_reason: x.suspend_reason, created_at: x.created_at, staff: us.filter((u) => u.active).length,
        last_login: us.map((u) => u.last_login_at).filter(Boolean).sort().at(-1) ?? null,
        open_tickets: tickets.filter((k) => k.restaurant_id === x.id && LIVE_TICKET.includes(k.status)).length,
        compliance: complianceOverview(docs.filter((d) => d.restaurant_id === x.id)),
      };
    }));
    res.json(out.sort(by((x: Row) => -x.active, 'name')));
  });

  const profile = z.object({
    name: z.string().trim().min(2).max(100), address: z.string().max(300).default(''), city: z.string().max(60).default(''),
    state: z.string().max(60).default(''), phone: z.string().max(30).default(''), email: z.string().max(120).default(''),
    gstin: z.string().max(20).default(''), plan: z.enum(['free', 'basic', 'pro']).default('free'), platformNotes: z.string().max(2000).default(''),
  });

  r.post('/platform/restaurants', async (req, res) => {
    const b = parse(profile.extend({
      code: z.string().trim().regex(/^[A-Za-z0-9-]{3,20}$/, '3-20 letters, numbers or dashes'),
      owner: z.object({
        name: z.string().trim().min(1), username: z.string().trim().regex(/^[A-Za-z0-9._-]{3,40}$/, '3-40 letters, numbers, dots or dashes'),
        password: z.string().min(6), phone: z.string().max(20).default(''), email: z.string().max(120).default(''),
      }),
    }), req.body);
    const out = await createRestaurant({ db, app }, b);
    await audit(req, 'restaurant.create', out.id, { code: out.code, name: b.name });
    res.status(201).json(out);
  });

  r.get('/platform/restaurants/:id', async (req, res) => {
    const rid = parse(id, req.params.id);
    const x = await restaurant(rid);
    const [us, docs, tickets, history] = await Promise.all([
      users(rid), all(q(db, 'compliance_docs', ['restaurant_id', '==', rid])), all(q(db, 'support_tickets', ['restaurant_id', '==', rid])),
      all(q(db, 'platform_audit', ['restaurant_id', '==', rid])),
    ]);
    const roleOrder = ['owner', 'trustee', 'manager'];
    const staffByRole = new Map<string, number>();
    for (const u of us.filter((u) => u.active)) staffByRole.set(u.role, (staffByRole.get(u.role) ?? 0) + 1);
    res.json({
      id: x.id, code: x.code, name: x.name, address: x.address, city: x.city, state: x.state, phone: x.phone, email: x.email, gstin: x.gstin,
      plan: x.plan, platform_notes: x.platform_notes, active: x.active, suspend_reason: x.suspend_reason, created_at: x.created_at,
      // Only the people a support agent needs to call. Never floor staff phone numbers.
      contacts: us.filter((u) => roleOrder.includes(u.role)).sort(by((u: Row) => roleOrder.indexOf(u.role), 'name'))
        .map((u) => ({ id: u.id, name: u.name, username: u.username, role: u.role, phone: u.phone, email: u.email ?? '', active: u.active, last_login_at: u.last_login_at, locked_until: null })),
      staffByRole: [...staffByRole].map(([role, n]) => ({ role, n })),
      tickets: tickets.sort(by('updated_at')).reverse().slice(0, 20).map((k) => ({ id: k.id, subject: k.subject, category: k.category, priority: k.priority, status: k.status, updated_at: k.updated_at })),
      history: history.sort(by((h: Row) => -h.id)).slice(0, 30).map((h) => ({ action: h.action, details: h.details, created_at: h.created_at, admin: h.admin_name ?? null })),
      docs: docs.sort(by((d: Row) => -d.id)).map((d) => ({ ...d, state: docState(d) })),
      compliance: complianceOverview(docs), docTypes: DOC_TYPES,
    });
  });

  r.patch('/platform/restaurants/:id', async (req, res) => {
    const rid = parse(id, req.params.id);
    const cur = await restaurant(rid);
    const b = parse(profile.partial().extend({ active: z.boolean().optional(), suspendReason: z.string().max(300).optional() }), req.body);
    if (b.active === false && cur.active && !b.suspendReason?.trim()) throw badRequest('Give a reason for suspending (the owner will see it)');
    const next = {
      name: b.name ?? cur.name, address: b.address ?? cur.address, city: b.city ?? cur.city, state: b.state ?? cur.state, phone: b.phone ?? cur.phone,
      email: b.email ?? cur.email, gstin: b.gstin ?? cur.gstin, plan: b.plan ?? cur.plan, platform_notes: b.platformNotes ?? cur.platform_notes,
      active: b.active === undefined ? cur.active : +b.active, suspend_reason: b.active === true ? '' : (b.suspendReason ?? cur.suspend_reason),
    };
    await updateDoc(doc(db, `restaurants/${rid}`), next);
    await publishProfile(db, rid, { ...cur, ...next });
    await audit(req, b.active === undefined || !!b.active === !!cur.active ? 'restaurant.update' : b.active ? 'restaurant.activate' : 'restaurant.suspend', rid, { reason: b.suspendReason ?? '' });
    res.json({ ok: true });
  });

  /** Owner forgot the password: support sets a temporary one (a fresh login replaces the old). */
  r.post('/platform/restaurants/:id/reset-login', async (req, res) => {
    const rid = parse(id, req.params.id);
    const b = parse(z.object({ userId: id, password: z.string().min(6, 'Use at least 6 characters') }), req.body);
    const x = await restaurant(rid);
    const u = await one(doc(db, `restaurants/${rid}/users/${b.userId}`));
    if (!u || !['owner', 'trustee', 'manager'].includes(u.role)) throw notFound('Login not found');
    await updateStaff(app, db, rid, x.code, u, { password: b.password });
    await audit(req, 'restaurant.reset_login', rid, { username: u.username, role: u.role });
    res.json({ ok: true });
  });

  // ---------- Support tickets ----------
  r.get('/platform/tickets', async (req, res) => {
    const qq = parse(z.object({ status: z.enum([...STATUSES, 'active', 'all']).default('active') }), req.query);
    const [tickets, rests] = await Promise.all([all(collection(db, 'support_tickets')), all(collection(db, 'restaurants'))]);
    const rest = new Map(rests.map((x) => [x.id, x]));
    const prio = ['urgent', 'high', 'normal', 'low'];
    res.json(tickets.filter((k) => (qq.status === 'all' ? true : qq.status === 'active' ? LIVE_TICKET.includes(k.status) : k.status === qq.status))
      .sort(by((k: Row) => prio.indexOf(k.priority))).slice(0, 300)
      .map((k) => ({ ...k, restaurant: rest.get(k.restaurant_id)?.name, code: rest.get(k.restaurant_id)?.code, created_by_phone: '' })));
  });
  const ticket = async (tid: number) => {
    const k = await one(doc(db, `support_tickets/${tid}`));
    if (!k) throw notFound('Ticket not found');
    return k;
  };
  r.get('/platform/tickets/:id', async (req, res) => {
    const k = await ticket(parse(id, req.params.id));
    const [x, u] = await Promise.all([restaurant(k.restaurant_id), one(doc(db, `restaurants/${k.restaurant_id}/users/${k.created_by}`))]);
    res.json({
      ...k, restaurant: x.name, code: x.code, restaurant_phone: x.phone, created_by_name: u?.name ?? k.created_by_name ?? null,
      created_by_phone: u?.phone ?? '', created_by_role: u?.role ?? '', messages: await ticketMessages(db, k.id),
    });
  });
  r.post('/platform/tickets/:id/messages', async (req, res) => {
    const k = await ticket(parse(id, req.params.id));
    const b = parse(z.object({ body: z.string().trim().min(1).max(4000), status: z.enum(STATUSES).optional() }), req.body);
    await addTicketMessage(db, k, { kind: 'platform', id: req.platform!.adminId, name: `${req.platform!.name} (YorMenu support)` }, b.body);
    const status = b.status ?? (k.status === 'open' ? 'in_progress' : k.status);
    await updateDoc(doc(db, `support_tickets/${k.id}`), { status, updated_at: nowStr(), closed_at: status === 'closed' ? nowStr() : k.closed_at, messages: (k.messages ?? 0) + 1, last_by: 'platform' });
    await audit(req, 'ticket.reply', k.restaurant_id, { ticket: k.id, status });
    res.status(201).json({ ok: true });
  });
  r.patch('/platform/tickets/:id', async (req, res) => {
    const k = await ticket(parse(id, req.params.id));
    const b = parse(z.object({ status: z.enum(STATUSES).optional(), priority: z.enum(['low', 'normal', 'high', 'urgent']).optional() }), req.body);
    const status = b.status ?? k.status;
    await updateDoc(doc(db, `support_tickets/${k.id}`), { status, priority: b.priority ?? k.priority, updated_at: nowStr(), closed_at: ['closed', 'resolved'].includes(status) ? nowStr() : null });
    await audit(req, 'ticket.update', k.restaurant_id, { ticket: k.id, ...b });
    res.json({ ok: true });
  });

  // ---------- Licence review ----------
  r.get('/platform/compliance', async (req, res) => {
    const qq = parse(z.object({ state: z.enum(['pending', 'expiring', 'expired', 'verified', 'rejected', 'all']).default('pending') }), req.query);
    const [docs, rests] = await Promise.all([all(collection(db, 'compliance_docs')), all(collection(db, 'restaurants'))]);
    const rest = new Map(rests.map((x) => [x.id, x]));
    const rows = docs.sort(by((d: Row) => -d.id)).slice(0, 500).map((d) => ({ ...d, state: docState(d), restaurant: rest.get(d.restaurant_id)?.name, code: rest.get(d.restaurant_id)?.code }));
    res.json(qq.state === 'all' ? rows : rows.filter((d) => d.state === qq.state));
  });
  r.post('/platform/compliance/:id/review', async (req, res) => {
    const d = await one(doc(db, `compliance_docs/${parse(id, req.params.id)}`));
    if (!d) throw notFound('Document not found');
    const b = parse(z.object({ status: z.enum(['verified', 'rejected', 'pending']), note: z.string().max(300).default('') }), req.body);
    if (b.status === 'rejected' && !b.note.trim()) throw badRequest('Tell the restaurant why it was rejected');
    await updateDoc(doc(db, `compliance_docs/${d.id}`), { status: b.status, review_note: b.note, reviewed_by: req.platform!.adminId, reviewed_at: nowStr() });
    await audit(req, `compliance.${b.status}`, d.restaurant_id, { doc: d.id, type: d.doc_type, note: b.note });
    res.json({ ok: true });
  });

  // ---------- Platform settings ----------
  r.get('/platform/settings', async (_req, res) => { res.json(await platformContact(db)); });
  r.put('/platform/settings', async (req, res) => {
    const b = parse(contactSchema, req.body);
    await setDoc(doc(db, 'platform_settings/contact'), b);
    await audit(req, 'settings.update', null, b);
    res.json({ ok: true });
  });

  r.get('/platform/audit', async (_req, res) => {
    const [rows, rests] = await Promise.all([all(collection(db, 'platform_audit')), all(collection(db, 'restaurants'))]);
    const rest = new Map(rests.map((x) => [x.id, x]));
    res.json(rows.sort(by((x: Row) => -x.id)).slice(0, 200).map((x) => ({
      id: x.id, action: x.action, details: x.details, created_at: x.created_at, admin: x.admin_name ?? null,
      restaurant: x.restaurant_id ? rest.get(x.restaurant_id)?.name ?? null : null, code: x.restaurant_id ? rest.get(x.restaurant_id)?.code ?? null : null,
    })));
  });

  return r;
}

