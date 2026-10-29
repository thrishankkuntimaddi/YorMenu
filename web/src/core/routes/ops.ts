import { Router, type Req as Request, type Res as Response } from '../http.js';
import { z } from 'zod';
import type { AppDeps } from '../index.js';
import { requirePerm } from '../session.js';
import type { Permission } from '../permissions.js';
import { badRequest, conflict, forbidden } from '../errors.js';
import { parse, id, paise, dateStr } from '../validate.js';
import { Row, by, nowStr } from '../db.js';
import * as orders from '../services/orders.js';
import { billTicket, billText, normalisePhone } from '../services/bills.js';
import { billEscPos, kotEscPos } from '../printing.js';
import { listGuestRequests, handleGuestRequest, removeGuestPhones } from '../services/guest.js';
import { salesSummary, itemSales, staffPerformance, cancelledItems, toCsv } from '../services/reports.js';
import { businessDate } from '../settings.js';

export function opsRoutes({ rt }: AppDeps) {
  const r = new Router();
  const ctx = (req: Request): orders.Ctx => ({ t: req.staff!.tenant, userId: req.staff!.userId, role: req.staff!.role, perms: req.staff!.perms, rt });
  const has = (req: Request, p: Permission) => req.staff!.perms.has(p);
  const pid = (req: Request) => parse(id, req.params.id);

  // ---- Floor & orders ----
  r.get('/floor', requirePerm('floor.view'), async (req, res) => { res.json(await orders.floor(req.staff!.tenant)); });

  r.get('/orders/:id', requirePerm('floor.view'), async (req, res) => { res.json(await orders.orderDetail(req.staff!.tenant, pid(req), req.staff!.perms)); });

  r.post('/orders', async (req, res) => {
    const b = parse(z.object({
      type: z.enum(['dine_in', 'takeaway', 'delivery']), tableId: id.optional(), guests: z.number().int().min(0).max(500).optional(),
      customerName: z.string().max(80).optional(), customerPhone: z.string().max(20).optional(), customerAddress: z.string().max(300).optional(),
      serverId: id.nullable().optional(), notes: z.string().max(300).optional(),
    }), req.body);
    res.status(201).json(await orders.createOrder(ctx(req), b));
  });

  r.patch('/orders/:id', async (req, res) => {
    const b = parse(z.object({
      guests: z.number().int().min(0).max(500).optional(), customerName: z.string().max(80).optional(),
      customerPhone: z.string().max(20).optional(), customerAddress: z.string().max(300).optional(),
      notes: z.string().max(300).optional(), serverId: id.nullable().optional(),
    }), req.body);
    res.json(await orders.updateOrder(ctx(req), pid(req), b));
  });

  r.post('/orders/:id/kot', async (req, res) => {
    const b = parse(z.object({
      items: z.array(z.object({ menuItemId: id, qty: z.number().int().min(1).max(999), note: z.string().max(120).optional() })).min(1).max(100),
    }), req.body);
    res.status(201).json(await orders.addKot(ctx(req), pid(req), b.items));
  });

  r.post('/orders/:id/serve-ready', async (req, res) => { res.json(await orders.serveAllReady(ctx(req), pid(req))); });
  r.post('/orders/:id/complete', async (req, res) => {
    const b = parse(z.object({ force: z.boolean().default(false) }), req.body);
    res.json(await orders.completeDining(ctx(req), pid(req), b.force));
  });
  const discountSchema = z.object({ type: z.enum(['amount', 'percent']), value: z.number().min(0) }).nullable().optional();
  r.post('/orders/:id/bill', async (req, res) => {
    const b = parse(z.object({ discount: discountSchema, force: z.boolean().default(false) }), req.body);
    if (b.discount?.type === 'amount') b.discount.value = Math.round(b.discount.value);
    res.json(await orders.generateBill(ctx(req), pid(req), b.discount, b.force));
  });
  r.post('/orders/:id/reopen', async (req, res) => { res.json(await orders.reopenOrder(ctx(req), pid(req))); });
  r.post('/orders/:id/cancel', async (req, res) => {
    const b = parse(z.object({ reason: z.string().max(200).default('') }), req.body);
    res.json(await orders.cancelOrder(ctx(req), pid(req), b.reason));
  });
  r.post('/orders/:id/move', async (req, res) => {
    const b = parse(z.object({ tableId: id }), req.body);
    res.json(await orders.moveOrder(ctx(req), pid(req), b.tableId));
  });

  r.post('/items/:id/status', async (req, res) => {
    const b = parse(z.object({ status: z.enum(['queued', 'cooking', 'ready', 'served']) }), req.body);
    res.json(await orders.setItemStatus(ctx(req), pid(req), b.status));
  });
  r.post('/items/:id/cancel', async (req, res) => {
    const b = parse(z.object({ reason: z.string().max(200) }), req.body);
    res.json(await orders.cancelItem(ctx(req), pid(req), b.reason));
  });

  // ---- Kitchen ----
  r.get('/kitchen', requirePerm('kitchen.view'), async (req, res) => {
    const t = req.staff!.tenant;
    const [live, tables] = await Promise.all([orders.liveOrders(t), t.list('tables')]);
    const label = new Map(tables.map((x) => [x.id, x.label]));
    const out: Row[] = [];
    for (const o of live.filter((x) => ['open', 'dining_done'].includes(x.status))) {
      const where = orders.orderWhere({ ...o, table_label: o.table_id ? label.get(o.table_id) : null });
      for (const k of o.kots as Row[]) {
        const items = (o.items as Row[]).filter((i) => i.kot_id === k.id && i.kitchen && i.status !== 'cancelled');
        if (!items.some((i) => ['queued', 'cooking', 'ready'].includes(i.status))) continue;
        out.push({
          id: k.id, kot_no: k.kot_no, order_id: o.id, source: k.source, created_at: k.created_at, printed_at: k.printed_at, order_type: o.order_type,
          table_label: o.table_id ? label.get(o.table_id) ?? null : null, created_by_name: await t.userName(k.created_by),
          server_name: await t.userName(o.server_id), where,
          items: items.map((i) => ({ id: i.id, kot_id: i.kot_id, name: i.name, qty: i.qty, note: i.note, status: i.status, created_at: i.created_at, ready_at: i.ready_at })),
        });
      }
    }
    res.json(out.sort(by('id')));
  });
  r.post('/kots/:id/status', async (req, res) => {
    const b = parse(z.object({ status: z.enum(['cooking', 'ready']) }), req.body);
    res.json(await orders.setKotStatus(ctx(req), pid(req), b.status));
  });
  r.get('/kots/:id/ticket', async (req, res) => {
    if (!has(req, 'floor.view') && !has(req, 'kitchen.view')) throw forbidden();
    res.json(await orders.kotTicket(req.staff!.tenant, pid(req)));
  });
  r.post('/kots/:id/printed', async (req, res) => {
    if (!has(req, 'floor.view') && !has(req, 'kitchen.view')) throw forbidden();
    await orders.markKotPrinted(req.staff!.tenant, pid(req));
    res.json({ ok: true });
  });
  r.post('/kots/:id/print', requirePerm('order.kot'), async (req, res) => {
    const t = req.staff!.tenant;
    const s = await orders.settingsOf(t);
    if (!s.kotPrinter?.host) throw conflict('No kitchen printer is set up in Settings');
    const ticket = await orders.kotTicket(t, pid(req));
    await orders.queuePrint(ctx(req), 'kot', s.kotPrinter, kotEscPos(ticket, s.paperWidth === '58' ? 32 : 48), `KOT #${ticket.kotNo} ${ticket.where}`, { kotId: pid(req) });
    res.json({ ok: true, queued: true });
  });

  // ---- Print station (desktop app on the counter PC talks to the LAN printers) ----
  r.post('/printers/test', requirePerm('settings.edit'), async (req, res) => {
    const t = req.staff!.tenant;
    const b = parse(z.object({ target: z.enum(['kot', 'bill']) }), req.body);
    const s = await orders.settingsOf(t);
    const p = b.target === 'kot' ? s.kotPrinter : s.billPrinter;
    if (!p?.host) throw conflict(`Save the ${b.target === 'kot' ? 'kitchen' : 'bill'} printer IP in Settings first`);
    const data = kotEscPos({
      restaurant: (await t.restaurant()).name, kotNo: 0, where: 'TEST PRINT', createdAt: new Date().toLocaleString('en-IN', { timeZone: s.timezone }),
      by: req.staff!.name, items: [{ name: 'If you can read this,', qty: 1, note: '' }, { name: 'the printer works!', qty: 1, note: 'YorMenu' }],
    }, s.paperWidth === '58' ? 32 : 48);
    await orders.queuePrint(ctx(req), b.target, p, data, 'Test print');
    res.json({ ok: true, queued: true });
  });
  r.get('/print-jobs', requirePerm('print.station'), async (req, res) => {
    const t = req.staff!.tenant;
    // Jobs a station took but never finished (the PC was closed or lost power mid-print) are tried again.
    const [queued, printing] = await Promise.all([t.list('print_jobs', ['status', '==', 'queued']), t.list('print_jobs', ['status', '==', 'printing'])]);
    res.json([...queued, ...printing.filter(stuck)].sort(by('id')));
  });
  /** Claimed more than 3 minutes ago and still not done. Printing takes seconds, so that station is gone. */
  const stuck = (j: Row) => j.status === 'printing' && !!j.claimed_at && Date.now() - Date.parse(`${String(j.claimed_at).replace(' ', 'T')}Z`) > 3 * 60_000;
  /** First print station to claim a job prints it; any other station skips it. */
  r.post('/print-jobs/:id/claim', requirePerm('print.station'), async (req, res) => {
    const t = req.staff!.tenant;
    const job = await t.tx(async (tx) => {
      const j = await t.must('print_jobs', pid(req), 'Print job', tx);
      if (j.status !== 'queued' && !(j.status === 'printing' && stuck(j))) return null;
      t.update('print_jobs', j.id, { status: 'printing', claimed_at: nowStr(), claimed_by: req.staff!.userId }, tx);
      return j;
    });
    res.json({ job });
  });
  r.post('/print-jobs/:id/done', requirePerm('print.station'), async (req, res) => {
    const t = req.staff!.tenant;
    const b = parse(z.object({ ok: z.boolean(), error: z.string().max(300).default('') }), req.body);
    const j = await t.must('print_jobs', pid(req), 'Print job');
    await t.update('print_jobs', j.id, { status: b.ok ? 'done' : 'failed', done_at: nowStr(), error: b.error, data: b.ok ? '' : j.data });
    if (b.ok && j.meta?.kotId) await orders.markKotPrinted(t, j.meta.kotId).catch(() => {});
    if (!b.ok) rt.emitToRoles(t.rid, ['owner', 'manager', 'cashier'], 'notify', { kind: 'printer', message: `Printer problem (${j.label}): ${b.error}` });
    res.json({ ok: true });
  });

  // ---- Bills ----
  r.get('/bills', requirePerm('bill.view'), async (req, res) => {
    const t = req.staff!.tenant;
    const q = parse(z.object({ from: dateStr.optional(), to: dateStr.optional(), q: z.string().max(40).optional(), status: z.enum(['unpaid', 'paid', 'void']).optional() }), req.query);
    const today = businessDate((await orders.settingsOf(t)).timezone);
    const showPhone = has(req, 'customer.viewPhone');
    const num = q.q?.replace(/\D/g, '');
    let rows: Row[];
    if (q.q && num) {
      rows = [
        ...(await t.list('bills', ['bill_no', '==', Number(num)])),
        ...(showPhone && num.length >= 4 ? (await t.list('bills', ['business_date', '>=', isoDaysAgo(today, 90)])).filter((b) => (b.customer_phone ?? '').includes(num)) : []),
      ];
      rows = [...new Map(rows.map((b) => [b.id, b])).values()];
    } else {
      rows = await t.list('bills', ['business_date', '>=', q.from ?? today], ['business_date', '<=', q.to ?? today]);
    }
    if (q.status) rows = rows.filter((b) => b.status === q.status);
    res.json(await Promise.all(rows.sort(by((b: Row) => -b.bill_no)).slice(0, 500).map(async (b) => ({
      id: b.id, bill_no: b.bill_no, business_date: b.business_date, grand_total: b.grand_total, status: b.status, created_at: b.created_at,
      paid_at: b.paid_at, order_id: b.order_id, order_type: b.order_type, customer_name: b.customer_name,
      customer_phone: showPhone ? b.customer_phone : orders.maskPhone(b.customer_phone), table_label: b.table_label,
      cashier_name: await t.userName(b.cashier_id),
      methods: [...new Set((b.payments as Row[]).map((p) => p.method))].join(',') || null,
    }))));
  });
  r.get('/bills/:id/ticket', requirePerm('bill.view'), async (req, res) => { res.json(await billTicket(req.staff!.tenant, pid(req))); });
  /** Small shops: items → paid bill in one step (no table, no kitchen). Payment is optional (pay later). */
  r.post('/quick-bill', requirePerm('bill.generate'), async (req, res) => {
    const b = parse(z.object({
      items: z.array(z.object({ menuItemId: id, qty: z.number().int().min(1).max(999), note: z.string().max(120).optional() })).min(1).max(100),
      method: z.enum(['cash', 'card', 'upi', 'other']).nullable().default('cash'),
      customerName: z.string().max(80).optional(), customerPhone: z.string().max(20).optional(),
      discount: z.object({ type: z.enum(['amount', 'percent']), value: z.number().min(0) }).nullable().optional(),
    }), req.body);
    res.status(201).json(await orders.quickBill(ctx(req), b));
  });

  r.post('/bills/:id/pay', async (req, res) => {
    const b = parse(z.object({
      payments: z.array(z.object({ method: z.enum(['cash', 'card', 'upi', 'other']), amount: paise, reference: z.string().max(60).optional() })).max(5),
    }), req.body);
    res.json(await orders.payBill(ctx(req), pid(req), b.payments));
  });
  r.post('/bills/:id/void', async (req, res) => {
    const b = parse(z.object({ reason: z.string().max(200) }), req.body);
    res.json(await orders.voidBill(ctx(req), pid(req), b.reason));
  });
  r.post('/bills/:id/whatsapp', requirePerm('bill.whatsapp'), async (req, res) => {
    const t = req.staff!.tenant;
    const b = parse(z.object({ phone: z.string().max(20).optional() }), req.body);
    const ticket = await billTicket(t, pid(req));
    const phone = normalisePhone(b.phone || ticket.customerPhone, (await orders.settingsOf(t)).countryCode);
    if (!phone) throw badRequest('Enter the customer\'s 10-digit mobile number');
    if (b.phone) {
      const bill = await t.must('bills', pid(req));
      await t.update('orders', bill.order_id, { customer_phone: b.phone });
      await t.update('bills', bill.id, { customer_phone: b.phone });
    }
    await t.audit(req.staff!.userId, 'bill.whatsapp', 'bill', pid(req), { phone });
    const text = billText(ticket);
    res.json({ url: `https://wa.me/${phone}?text=${encodeURIComponent(text)}`, text, phone });
  });
  r.post('/bills/:id/print', requirePerm('bill.print'), async (req, res) => {
    const t = req.staff!.tenant;
    const s = await orders.settingsOf(t);
    if (!s.billPrinter?.host) throw conflict('No bill printer is set up in Settings');
    const ticket = await billTicket(t, pid(req));
    await orders.queuePrint(ctx(req), 'bill', s.billPrinter, billEscPos(ticket, s.paperWidth === '58' ? 32 : 48), `Bill ${ticket.billNo}`, { billId: pid(req) });
    res.json({ ok: true, queued: true });
  });

  // ---- Cleaning ----
  r.get('/cleaning', requirePerm('cleaning.view'), async (req, res) => {
    const t = req.staff!.tenant;
    const recent = nowStr(new Date(Date.now() - 2 * 3600_000));
    // Waiting tasks plus the last two hours of finished ones (not every task ever made).
    const [pending, done, tables, sections] = await Promise.all([
      t.list('cleaning_tasks', ['status', '==', 'pending']), t.list('cleaning_tasks', ['done_at', '>', recent]), t.list('tables'), t.list('sections'),
    ]);
    const tb = new Map(tables.map((x) => [x.id, x]));
    const sec = new Map(sections.map((x) => [x.id, x.name]));
    const tasks = [...new Map([...pending, ...done].map((c) => [c.id, c])).values()];
    const rows = tasks.filter((c) => c.status === 'pending' || (c.done_at && c.done_at > recent))
      .sort(by((c: Row) => (c.status === 'pending' ? 0 : 1), 'id'));
    res.json(await Promise.all(rows.map(async (c) => ({
      ...c, table_label: tb.get(c.table_id)?.label ?? '?', section: sec.get(tb.get(c.table_id)?.section_id) ?? '',
      requested_by_name: await t.userName(c.requested_by),
    }))));
  });
  r.post('/cleaning', async (req, res) => {
    const b = parse(z.object({ tableId: id }), req.body);
    res.status(201).json(await orders.requestCleaning(ctx(req), b.tableId));
  });
  r.post('/cleaning/:id/done', async (req, res) => { res.json(await orders.finishCleaning(ctx(req), pid(req))); });

  // ---- Guest (QR) requests ----
  r.get('/guest-requests', requirePerm('guest.handle'), async (req, res) => {
    const status = parse(z.enum(['pending', 'accepted', 'rejected']).default('pending'), req.query.status);
    res.json(await listGuestRequests(req.staff!.tenant, status, req.staff!.perms.has('customer.viewPhone')));
  });
  r.delete('/orders/:id/guest-phones', requirePerm('guest.handle'), async (req, res) => { res.json(await removeGuestPhones(ctx(req), pid(req))); });
  r.post('/guest-requests/:id/:action', requirePerm('guest.handle'), async (req, res) => {
    const action = parse(z.enum(['accept', 'reject']), req.params.action);
    res.json(await handleGuestRequest(ctx(req), pid(req), action === 'accept'));
  });

  // ---- Reports ----
  const range = async (req: Request) => {
    const t = req.staff!.tenant;
    const today = businessDate((await orders.settingsOf(t)).timezone);
    const q = parse(z.object({ from: dateStr.default(today), to: dateStr.default(today), format: z.enum(['json', 'csv']).default('json') }), req.query);
    if (q.from > q.to) throw badRequest('Start date is after end date');
    return q;
  };
  const send = async (req: Request, res: Response, q: { format: string }, name: string, rows: unknown) => {
    if (q.format === 'csv') {
      if (!has(req, 'reports.export')) throw forbidden('You are not allowed to download reports');
      await req.staff!.tenant.audit(req.staff!.userId, 'reports.download', 'report', null, { name, format: 'csv' });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
      res.send(toCsv(rows as Record<string, unknown>[]));
      return;
    }
    res.json(rows);
  };
  r.get('/reports/summary', requirePerm('reports.view'), async (req, res) => {
    const q = await range(req);
    const s = await salesSummary(req.staff!.tenant, q.from, q.to);
    await send(req, res, q, `sales-${q.from}-${q.to}`, q.format === 'csv' ? s.byDay : s);
  });
  r.get('/reports/items', requirePerm('reports.view'), async (req, res) => {
    const q = await range(req);
    await send(req, res, q, `items-${q.from}-${q.to}`, await itemSales(req.staff!.tenant, q.from, q.to));
  });
  r.get('/reports/staff', requirePerm('reports.view'), async (req, res) => {
    const q = await range(req);
    await send(req, res, q, `staff-${q.from}-${q.to}`, await staffPerformance(req.staff!.tenant, q.from, q.to));
  });
  r.get('/reports/cancellations', requirePerm('reports.view'), async (req, res) => {
    const q = await range(req);
    await send(req, res, q, `cancelled-${q.from}-${q.to}`, await cancelledItems(req.staff!.tenant, q.from, q.to));
  });
  r.get('/reports/bills', requirePerm('reports.view'), async (req, res) => {
    const q = await range(req);
    const t = req.staff!.tenant;
    const bills = (await t.list('bills', ['business_date', '>=', q.from], ['business_date', '<=', q.to])).sort(by('bill_no'));
    await send(req, res, q, `bills-${q.from}-${q.to}`, bills.map((b) => ({
      bill_no: b.bill_no, business_date: b.business_date, order_type: b.order_type, table_label: b.table_label, subtotal: b.subtotal / 100,
      discount: b.discount / 100, tax: b.tax_total / 100, grand_total: b.grand_total / 100, status: b.status,
      payments: (b.payments as Row[]).map((p) => `${p.method}:${p.amount / 100}`).join(',') || null,
    })));
  });

  return r;
}

function isoDaysAgo(today: string, n: number) {
  const d = new Date(today + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
