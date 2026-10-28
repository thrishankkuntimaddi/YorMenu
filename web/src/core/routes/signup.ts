import { z } from 'zod';
import { collection, doc, getDocs, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { Router } from '../http.js';
import type { AppDeps } from '../index.js';
import { Row, all, by, newId, nowStr, one, q } from '../db.js';
import { HttpError, badRequest, conflict, notFound } from '../errors.js';
import { parse } from '../validate.js';
import { requirePerm } from '../session.js';
import { createRestaurant, dateAfter } from './platform.js';
import { billingSchema, billingSettings, subscriptionState } from '../subscription.js';

/*
 * Self sign-up for shops, food stalls and restaurants:
 *   1. In the app, the owner fills a form, photographs their documents and picks a password.
 *      A login is made for them and the request is saved in signups/{uid} (photos in .../files).
 *   2. A platform admin checks the documents and approves: the shop is created with a
 *      system-made code, the owner's login is linked, and the free trial starts.
 * Subscriptions: the owner pays a plan by UPI and enters the reference; a platform admin
 * confirms it, which extends paid_until.
 */

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const FILE_KINDS = ['fssai', 'id', 'gst', 'shop_photo', 'other'] as const;

const signupSchema = z.object({
  businessType: z.enum(['counter', 'restaurant']),
  businessName: z.string().trim().min(2, 'Enter the shop name').max(100),
  ownerName: z.string().trim().min(2, 'Enter your name').max(60),
  mobile: z.string().regex(/^\d{10}$/, 'Enter a 10-digit mobile number'),
  email: z.string().trim().max(120).default(''),
  address: z.string().trim().min(5, 'Enter the address').max(300),
  city: z.string().trim().min(2, 'Enter the city / town').max(60),
  state: z.string().trim().min(2, 'Enter the state').max(60),
  gstin: z.string().trim().max(20).transform((v) => v.toUpperCase()).refine((v) => v === '' || GSTIN_RE.test(v), 'GSTIN should be 15 characters, like 37ABCDE1234F1Z5').default(''),
  fssai: z.string().trim().regex(/^(\d{14})?$/, 'FSSAI number has 14 digits').default(''),
  username: z.string().trim().regex(/^[A-Za-z0-9._-]{3,40}$/, 'Username: 3-40 letters or numbers'),
  password: z.string().min(6, 'Use at least 6 characters for the password'),
  files: z.array(z.object({
    kind: z.enum(FILE_KINDS), name: z.string().max(120),
    type: z.enum(['image/jpeg', 'image/png']), data: z.string().max(900_000),
  })).min(1, 'Add a photo of your FSSAI certificate or ID proof').max(4),
});

export function signupRoutes({ db, app, auth, sessions }: AppDeps) {
  const r = new Router();

  // ---------- public ----------
  r.get('/public/billing', async (_req, res) => {
    const b = await billingSettings(db);
    res.json({ trialDays: b.trialDays, plans: b.plans });
  });

  r.post('/public/register', async (req, res) => {
    const b = parse(signupSchema, req.body);
    if (b.files.every((f) => !['fssai', 'id'].includes(f.kind))) throw badRequest('Add a photo of your FSSAI certificate or an ID proof (Aadhaar / PAN)');
    sessions.clear();
    await signOut(auth).catch(() => {});
    const rand = Math.random().toString(36).slice(2, 8);
    const email = `${b.username.toLowerCase()}.${b.mobile}.${rand}@signup.yormenu.app`;
    const cred = await createUserWithEmailAndPassword(auth, email, b.password).catch((e) => {
      if (e?.code === 'auth/weak-password') throw badRequest('Use at least 6 characters for the password');
      if (e?.code === 'auth/network-request-failed') throw new HttpError(503, 'No internet connection');
      throw e;
    });
    const uid = cred.user.uid;
    const { files, password: _pw, ...details } = b;
    await setDoc(doc(db, `signups/${uid}`), {
      ...details, uid, login_email: email, status: 'pending', reason: '', code: null, rid: null,
      files: files.map((f) => ({ kind: f.kind, name: f.name })), created_at: nowStr(), reviewed_at: null,
    });
    await Promise.all(files.map((f, i) => setDoc(doc(db, `signups/${uid}/files/${i}`), { n: i, kind: f.kind, name: f.name, type: f.type, data: f.data })));
    res.status(201).json({ status: 'pending' });
  });

  /** The person who signed up on this device: how is their request doing? */
  r.get('/public/register/status', async (_req, res) => {
    const u = auth.currentUser;
    if (!u) return res.json({ status: 'none' });
    const s = await one(doc(db, `signups/${u.uid}`)).catch(() => undefined);
    if (!s) return res.json({ status: 'none' });
    res.json({ status: s.status, code: s.code, username: s.username, businessName: s.businessName, reason: s.reason });
  });

  // ---------- platform ----------
  const admin = sessions.platformAuth();

  r.get('/platform/signups', admin, async (req, res) => {
    const status = parse(z.enum(['pending', 'approved', 'rejected']).default('pending'), req.query.status);
    const rows = await all(q(db, 'signups', ['status', '==', status]));
    res.json(rows.sort(by((x: Row) => x.created_at)).reverse().slice(0, 200));
  });
  r.get('/platform/signups/:uid', admin, async (req, res) => {
    const s = await one(doc(db, `signups/${req.params.uid}`));
    if (!s) throw notFound('Sign-up not found');
    const files = (await getDocs(collection(db, `signups/${req.params.uid}/files`))).docs.map((d) => d.data()).sort(by('n'));
    res.json({ ...s, files });
  });
  r.post('/platform/signups/:uid/approve', admin, async (req, res) => {
    const s = await one(doc(db, `signups/${req.params.uid}`));
    if (!s) throw notFound('Sign-up not found');
    if (s.status !== 'pending') throw conflict('Already handled');
    const billing = await billingSettings(db);
    const out = await createRestaurant({ db, app }, {
      name: s.businessName, address: s.address, city: s.city, state: s.state, phone: s.mobile, email: s.email, gstin: s.gstin,
      owner: { name: s.ownerName, username: s.username, password: '', phone: s.mobile, email: s.email },
      ownerAuth: { uid: s.uid, email: s.login_email },
      settings: {
        businessMode: s.businessType,
        gstType: s.gstin ? 'regular5' : 'unregistered',
        ...(s.gstin ? {} : { taxMode: 'none', taxes: [] }),
      },
      trialDays: billing.trialDays || 1, signupUid: s.uid,
    });
    const batch = writeBatch(db);
    batch.update(doc(db, `signups/${s.uid}`), { status: 'approved', code: out.code, rid: out.id, reviewed_at: nowStr() });
    // The documents checked during sign-up count as verified licences.
    for (const [type, number] of [['fssai', s.fssai], ['gst', s.gstin]] as const) {
      if (!number) continue;
      const id = newId();
      batch.set(doc(db, `compliance_docs/${id}`), {
        id, restaurant_id: out.id, doc_type: type, number, issued_on: null, expires_on: null, file_name: 'sign-up photos',
        status: 'verified', review_note: 'Checked at sign-up', uploaded_by: null, reviewed_by: req.platform!.adminId, created_at: nowStr(), reviewed_at: nowStr(),
      });
    }
    const aid = newId();
    batch.set(doc(db, `platform_audit/${aid}`), { id: aid, admin_id: req.platform!.adminId, admin_name: req.platform!.name, action: 'signup.approve', restaurant_id: out.id, details: JSON.stringify({ code: out.code }), created_at: nowStr() });
    await batch.commit();
    res.json(out);
  });
  r.post('/platform/signups/:uid/reject', admin, async (req, res) => {
    const b = parse(z.object({ reason: z.string().trim().min(3, 'Tell them why').max(300) }), req.body);
    const s = await one(doc(db, `signups/${req.params.uid}`));
    if (!s) throw notFound('Sign-up not found');
    if (s.status !== 'pending') throw conflict('Already handled');
    await updateDoc(doc(db, `signups/${s.uid}`), { status: 'rejected', reason: b.reason, reviewed_at: nowStr() });
    res.json({ ok: true });
  });

  r.get('/platform/billing', admin, async (_req, res) => { res.json(await billingSettings(db)); });
  r.put('/platform/billing', admin, async (req, res) => {
    const b = parse(billingSchema, req.body);
    await setDoc(doc(db, 'platform_settings/billing'), b);
    res.json(b);
  });
  r.get('/platform/payments', admin, async (req, res) => {
    const status = parse(z.enum(['pending', 'confirmed', 'rejected']).default('pending'), req.query.status);
    const rows = await all(q(db, 'subscription_payments', ['status', '==', status]));
    const rests = new Map((await all(q(db, 'restaurants'))).map((x) => [x.id, x]));
    res.json(rows.sort(by((p: Row) => -p.id)).slice(0, 300).map((p) => ({ ...p, restaurant: rests.get(p.rid)?.name ?? '?', state: rests.get(p.rid) ? subscriptionState(rests.get(p.rid)!) : null })));
  });
  r.post('/platform/payments/:id/:action', admin, async (req, res) => {
    const action = parse(z.enum(['confirm', 'reject']), req.params.action);
    const note = parse(z.object({ note: z.string().max(200).default('') }), req.body).note;
    const p = await one(doc(db, `subscription_payments/${req.params.id}`));
    if (!p) throw notFound('Payment not found');
    if (p.status !== 'pending') throw conflict('Already handled');
    const batch = writeBatch(db);
    if (action === 'confirm') {
      const rest = await one(doc(db, `restaurants/${p.rid}`));
      if (!rest) throw notFound('Restaurant not found');
      const from = [rest.paid_until, rest.trial_ends].filter(Boolean).sort().pop() ?? null;
      batch.update(doc(db, `restaurants/${p.rid}`), { paid_until: dateAfter(p.days, from), plan_id: p.plan_id });
    }
    batch.update(doc(db, `subscription_payments/${p.id}`), { status: action === 'confirm' ? 'confirmed' : 'rejected', note, reviewed_at: nowStr() });
    await batch.commit();
    res.json({ ok: true });
  });
  /** Admin can also set the paid-until date by hand (cash payments, free months). */
  r.post('/platform/restaurants/:id/subscription', admin, async (req, res) => {
    const b = parse(z.object({ paidUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), planId: z.string().max(30).optional() }), req.body);
    await updateDoc(doc(db, `restaurants/${req.params.id}`), { paid_until: b.paidUntil, ...(b.planId ? { plan_id: b.planId } : {}) });
    res.json({ ok: true });
  });

  return r;
}

/** Owner's subscription page (staff login needed). */
export function subscriptionRoutes({ db }: AppDeps) {
  const r = new Router();
  r.get('/subscription', requirePerm('settings.edit'), async (req, res) => {
    const t = req.staff!.tenant;
    const [rest, billing, pays] = await Promise.all([
      t.restaurant(), billingSettings(db), all(q(db, 'subscription_payments', ['rid', '==', t.rid])),
    ]);
    const mode = JSON.parse(rest.settings || '{}').businessMode === 'counter' ? 'counter' : 'restaurant';
    res.json({
      state: subscriptionState(rest), code: rest.code, upiId: billing.upiId, payeeName: billing.payeeName,
      plans: billing.plans.filter((p) => p.for === 'all' || p.for === mode),
      payments: pays.sort(by((p: Row) => -p.id)).slice(0, 20),
    });
  });

  r.post('/subscription/payments', requirePerm('settings.edit'), async (req, res) => {
    const s = req.staff!;
    const b = parse(z.object({ planId: z.string(), utr: z.string().trim().regex(/^[A-Za-z0-9]{6,30}$/, 'Enter the UPI reference number (UTR) from your payment app') }), req.body);
    const billing = await billingSettings(db);
    const plan = billing.plans.find((p) => p.id === b.planId);
    if (!plan) throw badRequest('Pick a plan');
    const pending = await all(q(db, 'subscription_payments', ['rid', '==', s.rid]));
    if (pending.some((p) => p.utr === b.utr)) throw conflict('This payment reference was already sent');
    const id = newId();
    await setDoc(doc(db, `subscription_payments/${id}`), {
      id, rid: s.rid, code: s.code, plan_id: plan.id, plan_name: plan.name, amount: plan.price, days: plan.days, utr: b.utr,
      status: 'pending', by_name: s.name, created_at: nowStr(), reviewed_at: null, note: '',
    });
    await s.tenant.audit(s.userId, 'subscription.payment', 'restaurant', s.rid, { plan: plan.id, utr: b.utr });
    res.status(201).json({ id });
  });

  return r;
}
