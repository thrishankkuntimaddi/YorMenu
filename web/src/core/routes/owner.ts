import { z } from 'zod';
import { doc, setDoc, updateDoc, deleteDoc, runTransaction, collection, getDocs } from 'firebase/firestore';
import { Router, type Req as Request } from '../http.js';
import type { AppDeps } from '../index.js';
import { requirePerm } from '../session.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { parse, id, dateStr } from '../validate.js';
import { DB, Row, all, by, newId, nowStr, one, q } from '../db.js';
import { businessDate } from '../settings.js';
import { settingsOf } from '../services/orders.js';
import { normalisePhone } from '../services/bills.js';
import { DOC_KEYS, DOC_TYPES, complianceOverview, docState } from '../services/compliance.js';
import { headline, periodRange, reportBundle, summaryText, toCsvBundle, toXlsx } from '../services/exports.js';
import { platformContact } from './platform.js';

const TICKET_CATEGORIES = ['technical', 'billing', 'printer', 'whatsapp', 'account', 'compliance', 'feature', 'other'] as const;
const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

/*
 * Support tickets and licence records live in top-level collections tagged with
 * restaurant_id, so the platform team can see them across restaurants. Security rules
 * only let a restaurant read and write its own.
 */
export async function restaurantDoc(db: DB, coll: 'compliance_docs' | 'support_tickets', rid: number, docId: number, what: string) {
  const row = await one(doc(db, `${coll}/${docId}`)).catch(() => undefined);
  if (!row || row.restaurant_id !== rid) throw notFound(`${what} not found`);
  return row;
}

/** Short running numbers for tickets ("#12") and restaurants, shared by everyone. */
export async function nextCounter(db: DB, name: string): Promise<number> {
  const ref = doc(db, `counters/${name}`);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const n = (snap.exists() ? snap.data().n : 0) + 1;
    tx.set(ref, { n });
    return n;
  });
}

export async function ticketMessages(db: DB, ticketId: number) {
  return (await getDocs(collection(db, `support_tickets/${ticketId}/messages`))).docs.map((d) => d.data()).sort(by('id'));
}

export async function addTicketMessage(db: DB, ticket: Row, author: { kind: 'staff' | 'platform'; id: number | string; name: string }, body: string) {
  const mid = newId();
  await setDoc(doc(db, `support_tickets/${ticket.id}/messages/${mid}`), {
    id: mid, restaurant_id: ticket.restaurant_id, author_kind: author.kind, author_id: String(author.id), author_name: author.name, body, created_at: nowStr(),
  });
}

/** Owner/manager tools: licences, support, report downloads. */
export function ownerRoutes({ db }: AppDeps) {
  const r = new Router();

  // ---------- Licences ----------
  r.get('/compliance', requirePerm('compliance.manage'), async (req, res) => {
    const t = req.staff!.tenant;
    const docs = (await all(q(db, 'compliance_docs', ['restaurant_id', '==', t.rid]))).sort(by((d: Row) => -d.id));
    const out = await Promise.all(docs.map(async (d) => ({ ...d, state: docState(d), uploaded_by_name: await t.userName(d.uploaded_by) })));
    res.json({ types: DOC_TYPES, docs: out, overview: complianceOverview(docs) });
  });

  r.post('/compliance', requirePerm('compliance.manage'), async (req, res) => {
    const s = req.staff!;
    const b = parse(z.object({
      docType: z.enum(DOC_KEYS), number: z.string().trim().max(60).default(''),
      issuedOn: dateStr.nullable().optional(), expiresOn: dateStr.nullable().optional(),
    }).passthrough(), req.body);
    if (b.issuedOn && b.expiresOn && b.expiresOn < b.issuedOn) throw badRequest('Expiry date is before the issue date');
    if (!b.number) throw badRequest('Add the licence / certificate number');
    const docId = newId();
    await setDoc(doc(db, `compliance_docs/${docId}`), {
      id: docId, restaurant_id: s.rid, doc_type: b.docType, number: b.number, issued_on: b.issuedOn ?? null, expires_on: b.expiresOn ?? null,
      file_name: '', status: 'pending', review_note: '', uploaded_by: s.userId, reviewed_by: null, created_at: nowStr(), reviewed_at: null,
    });
    await s.tenant.audit(s.userId, 'compliance.upload', 'compliance_doc', docId, { docType: b.docType, number: b.number });
    res.status(201).json({ id: docId });
  });

  r.delete('/compliance/:id', requirePerm('compliance.manage'), async (req, res) => {
    const s = req.staff!;
    const d = await restaurantDoc(db, 'compliance_docs', s.rid, parse(id, req.params.id), 'Document');
    if (d.status === 'verified' && s.role !== 'owner' && s.role !== 'trustee') throw forbidden('Only the owner can delete a verified document');
    await deleteDoc(doc(db, `compliance_docs/${d.id}`));
    await s.tenant.audit(s.userId, 'compliance.delete', 'compliance_doc', d.id, { docType: d.doc_type });
    res.json({ ok: true });
  });

  // ---------- Support ----------
  r.get('/support/contact', async (_req, res) => { res.json(await platformContact(db)); });

  r.get('/support/tickets', requirePerm('support.raise'), async (req, res) => {
    const t = req.staff!.tenant;
    const tickets = await all(q(db, 'support_tickets', ['restaurant_id', '==', t.rid]));
    res.json(await Promise.all(tickets.sort(by('updated_at', 'id')).reverse().slice(0, 200)
      .map(async (k) => ({ ...k, created_by_name: await t.userName(k.created_by) }))));
  });

  r.post('/support/tickets', requirePerm('support.raise'), async (req, res) => {
    const s = req.staff!;
    const b = parse(z.object({
      category: z.enum(TICKET_CATEGORIES), priority: z.enum(PRIORITIES).default('normal'),
      subject: z.string().trim().min(3).max(120), message: z.string().trim().min(3).max(4000),
    }), req.body);
    const tid = await nextCounter(db, 'tickets');
    const now = nowStr();
    const ticket = {
      id: tid, restaurant_id: s.rid, created_by: s.userId, created_by_name: s.name, category: b.category, priority: b.priority, subject: b.subject,
      status: 'open', created_at: now, updated_at: now, closed_at: null, messages: 1, last_by: 'staff',
    };
    await setDoc(doc(db, `support_tickets/${tid}`), ticket);
    await addTicketMessage(db, ticket, { kind: 'staff', id: s.userId, name: s.name }, b.message);
    await s.tenant.audit(s.userId, 'support.open', 'ticket', tid, { subject: b.subject });
    res.status(201).json({ id: tid });
  });

  r.get('/support/tickets/:id', requirePerm('support.raise'), async (req, res) => {
    const s = req.staff!;
    const k = await restaurantDoc(db, 'support_tickets', s.rid, parse(id, req.params.id), 'Ticket');
    res.json({ ...k, messages: await ticketMessages(db, k.id) });
  });

  r.post('/support/tickets/:id/messages', requirePerm('support.raise'), async (req, res) => {
    const s = req.staff!;
    const k = await restaurantDoc(db, 'support_tickets', s.rid, parse(id, req.params.id), 'Ticket');
    if (k.status === 'closed') throw conflict('This ticket is closed. Open a new one.');
    const b = parse(z.object({ body: z.string().trim().min(1).max(4000) }), req.body);
    await addTicketMessage(db, k, { kind: 'staff', id: s.userId, name: s.name }, b.body);
    await updateDoc(doc(db, `support_tickets/${k.id}`), {
      updated_at: nowStr(), status: ['waiting', 'resolved'].includes(k.status) ? 'open' : k.status, messages: (k.messages ?? 0) + 1, last_by: 'staff',
    });
    res.status(201).json({ ok: true });
  });

  r.post('/support/tickets/:id/close', requirePerm('support.raise'), async (req, res) => {
    const s = req.staff!;
    const k = await restaurantDoc(db, 'support_tickets', s.rid, parse(id, req.params.id), 'Ticket');
    await updateDoc(doc(db, `support_tickets/${k.id}`), { status: 'closed', closed_at: nowStr(), updated_at: nowStr() });
    res.json({ ok: true });
  });

  // ---------- Report files ----------
  const range = async (req: Request) => {
    const t = req.staff!.tenant;
    const today = businessDate((await settingsOf(t)).timezone);
    const qq = parse(z.object({
      period: z.enum(['day', 'week', 'month', 'custom']).default('custom'),
      from: dateStr.optional(), to: dateStr.optional(), anchor: dateStr.optional(),
    }).passthrough(), { ...req.query, ...(req.method === 'POST' ? req.body : {}) });
    const [from, to] = qq.period === 'custom' ? [qq.from ?? today, qq.to ?? today] : periodRange(qq.period, qq.anchor ?? today);
    if (from > to) throw badRequest('Start date is after end date');
    if (qq.period === 'custom' && (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000 > 366) throw badRequest('Pick at most one year at a time');
    return { period: qq.period, from, to };
  };

  r.get('/reports/export', requirePerm('reports.export'), async (req, res) => {
    const s = req.staff!;
    const format = parse(z.enum(['xlsx', 'csv']), req.query.format);
    const { from, to } = await range(req);
    const b = await reportBundle(s.tenant, from, to);
    const name = `${b.restaurant.code}-report-${from}${from === to ? '' : `-to-${to}`}`;
    await s.tenant.audit(s.userId, 'reports.download', 'report', null, { from, to, format });
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
      return res.send('﻿' + toCsvBundle(b));
    }
    res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`);
    res.send(await toXlsx(b));
  });

  /** Owner's WhatsApp summary of a period (opens WhatsApp with the text written). */
  r.post('/reports/send', requirePerm('reports.export'), async (req, res) => {
    const s = req.staff!;
    const b = parse(z.object({ whatsappTo: z.string().max(20).optional() }).passthrough(), req.body);
    const { from, to } = await range(req);
    const bundle = await reportBundle(s.tenant, from, to);
    const owner = (await s.tenant.list('users', ['role', '==', 'owner'])).find((u) => u.active && u.phone);
    const phone = normalisePhone(b.whatsappTo || owner?.phone || '', (await settingsOf(s.tenant)).countryCode);
    const text = summaryText(bundle);
    await s.tenant.audit(s.userId, 'reports.send', 'report', null, { from, to });
    res.status(201).json({
      summary: headline(bundle), emailStatus: '', emailedTo: '',
      whatsappUrl: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`,
    });
  });

  return r;
}
