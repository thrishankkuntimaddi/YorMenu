import { Router, Request } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { requirePerm } from '../auth.js';
import { badRequest, conflict, forbidden } from '../errors.js';
import { can } from '../permissions.js';
import { parse, id, paise, dateStr } from '../validate.js';
import * as orders from '../services/orders.js';
import { billTicket, billText, normalisePhone } from '../services/bills.js';
import { billEscPos, kotEscPos, sendToPrinter } from '../printing.js';
import { listGuestRequests, handleGuestRequest } from '../services/guest.js';
import { salesSummary, itemSales, staffPerformance, cancelledItems, toCsv } from '../services/reports.js';
import { businessDate } from '../settings.js';

export function opsRoutes({ rt }: AppDeps) {
  const r = Router();
  const ctx = (req: Request): orders.Ctx => ({ t: req.staff!.tenant, userId: req.staff!.userId, role: req.staff!.role, rt });
  const pid = (req: Request) => parse(id, req.params.id);

  // ---- Floor & orders ----
  r.get('/floor', requirePerm('floor.view'), (req, res) => res.json(orders.floor(req.staff!.tenant)));

  r.get('/orders/:id', requirePerm('floor.view'), (req, res) => res.json(orders.orderDetail(req.staff!.tenant, pid(req), req.staff!.role)));

  r.post('/orders', (req, res) => {
    const b = parse(z.object({
      type: z.enum(['dine_in', 'takeaway', 'delivery']), tableId: id.optional(), guests: z.number().int().min(0).max(500).optional(),
      customerName: z.string().max(80).optional(), customerPhone: z.string().max(20).optional(), customerAddress: z.string().max(300).optional(),
      serverId: id.nullable().optional(), notes: z.string().max(300).optional(),
    }), req.body);
    res.status(201).json(orders.createOrder(ctx(req), b));
  });

  r.patch('/orders/:id', (req, res) => {
    const b = parse(z.object({
      guests: z.number().int().min(0).max(500).optional(), customerName: z.string().max(80).optional(),
      customerPhone: z.string().max(20).optional(), customerAddress: z.string().max(300).optional(),
      notes: z.string().max(300).optional(), serverId: id.nullable().optional(),
    }), req.body);
    res.json(orders.updateOrder(ctx(req), pid(req), b));
  });

  r.post('/orders/:id/kot', (req, res) => {
    const b = parse(z.object({
      items: z.array(z.object({ menuItemId: id, qty: z.number().int().min(1).max(999), note: z.string().max(120).optional() })).min(1).max(100),
    }), req.body);
    res.status(201).json(orders.addKot(ctx(req), pid(req), b.items));
  });

  r.post('/orders/:id/serve-ready', (req, res) => res.json(orders.serveAllReady(ctx(req), pid(req))));
  r.post('/orders/:id/complete', (req, res) => {
    const b = parse(z.object({ force: z.boolean().default(false) }), req.body);
    res.json(orders.completeDining(ctx(req), pid(req), b.force));
  });
  const discountSchema = z.object({ type: z.enum(['amount', 'percent']), value: z.number().min(0) }).nullable().optional();
  r.post('/orders/:id/bill', (req, res) => {
    const b = parse(z.object({ discount: discountSchema, force: z.boolean().default(false) }), req.body);
    if (b.discount?.type === 'amount') b.discount.value = Math.round(b.discount.value);
    res.json(orders.generateBill(ctx(req), pid(req), b.discount, b.force));
  });
  r.post('/orders/:id/reopen', (req, res) => res.json(orders.reopenOrder(ctx(req), pid(req))));
  r.post('/orders/:id/cancel', (req, res) => {
    const b = parse(z.object({ reason: z.string().max(200).default('') }), req.body);
    res.json(orders.cancelOrder(ctx(req), pid(req), b.reason));
  });
  r.post('/orders/:id/move', (req, res) => {
    const b = parse(z.object({ tableId: id }), req.body);
    res.json(orders.moveOrder(ctx(req), pid(req), b.tableId));
  });

  r.post('/items/:id/status', (req, res) => {
    const b = parse(z.object({ status: z.enum(['queued', 'cooking', 'ready', 'served']) }), req.body);
    res.json(orders.setItemStatus(ctx(req), pid(req), b.status));
  });
  r.post('/items/:id/cancel', (req, res) => {
    const b = parse(z.object({ reason: z.string().max(200) }), req.body);
    res.json(orders.cancelItem(ctx(req), pid(req), b.reason));
  });

  // ---- Kitchen ----
  r.get('/kitchen', requirePerm('kitchen.view'), (req, res) => {
    const t = req.staff!.tenant;
    const kots = t.all(
      `SELECT k.id, k.kot_no, k.order_id, k.source, k.created_at, k.printed_at, o.order_type, o.id AS oid, tb.label AS table_label,
              u.name AS created_by_name, s.name AS server_name
       FROM kots k JOIN orders o ON o.id = k.order_id LEFT JOIN tables tb ON tb.id = o.table_id
       LEFT JOIN users u ON u.id = k.created_by LEFT JOIN users s ON s.id = o.server_id
       WHERE k.restaurant_id = ? AND o.status IN ('open','dining_done') AND EXISTS (
         SELECT 1 FROM order_items oi WHERE oi.kot_id = k.id AND oi.kitchen = 1 AND oi.status IN ('queued','cooking','ready'))
       ORDER BY k.id`, t.rid);
    const items = t.all(
      `SELECT oi.id, oi.kot_id, oi.name, oi.qty, oi.note, oi.status, oi.created_at, oi.ready_at FROM order_items oi
       JOIN kots k ON k.id = oi.kot_id JOIN orders o ON o.id = k.order_id
       WHERE oi.restaurant_id = ? AND oi.kitchen = 1 AND o.status IN ('open','dining_done') AND oi.status != 'cancelled' ORDER BY oi.id`, t.rid);
    const byKot = new Map<number, any[]>();
    for (const it of items) (byKot.get(it.kot_id) ?? byKot.set(it.kot_id, []).get(it.kot_id)!).push(it);
    res.json(kots.map((k) => ({ ...k, where: orders.orderWhere({ order_type: k.order_type, id: k.oid, table_label: k.table_label }), items: byKot.get(k.id) ?? [] })));
  });
  r.post('/kots/:id/status', (req, res) => {
    const b = parse(z.object({ status: z.enum(['cooking', 'ready']) }), req.body);
    res.json(orders.setKotStatus(ctx(req), pid(req), b.status));
  });
  r.get('/kots/:id/ticket', (req, res) => {
    if (!can(req.staff!.role, 'floor.view') && !can(req.staff!.role, 'kitchen.view')) throw forbidden();
    res.json(orders.kotTicket(req.staff!.tenant, pid(req)));
  });
  r.post('/kots/:id/printed', (req, res) => {
    if (!can(req.staff!.role, 'floor.view') && !can(req.staff!.role, 'kitchen.view')) throw forbidden();
    const t = req.staff!.tenant;
    t.run(`UPDATE kots SET printed_at = COALESCE(printed_at, datetime('now')) WHERE id = ? AND restaurant_id = ?`, pid(req), t.rid);
    res.json({ ok: true });
  });
  r.post('/kots/:id/print', requirePerm('order.kot'), async (req, res) => {
    const t = req.staff!.tenant;
    const s = orders.settingsOf(t);
    if (!s.kotPrinter?.host) throw conflict('No kitchen printer is set up in Settings');
    await sendToPrinter(s.kotPrinter.host, s.kotPrinter.port, kotEscPos(orders.kotTicket(t, pid(req))))
      .catch((e) => { throw conflict(`Printer error: ${e.message}`); });
    res.json({ ok: true });
  });

  // ---- Bills ----
  r.get('/bills', requirePerm('bill.view'), (req, res) => {
    const t = req.staff!.tenant;
    const q = parse(z.object({ from: dateStr.optional(), to: dateStr.optional(), q: z.string().max(40).optional(), status: z.enum(['unpaid', 'paid', 'void']).optional() }), req.query);
    const today = businessDate(orders.settingsOf(t).timezone);
    const params: (string | number)[] = [t.rid];
    let where = 'b.restaurant_id = ?';
    const num = q.q?.replace(/\D/g, '');
    if (q.q && num) {
      where += ' AND (b.bill_no = ? OR o.customer_phone LIKE ?)';
      params.push(Number(num), `%${num}%`);
    } else {
      where += ' AND b.business_date BETWEEN ? AND ?';
      params.push(q.from ?? today, q.to ?? today);
    }
    if (q.status) { where += ' AND b.status = ?'; params.push(q.status); }
    res.json(t.all(
      `SELECT b.id, b.bill_no, b.business_date, b.grand_total, b.status, b.created_at, b.paid_at, b.order_id, o.order_type,
              o.customer_name, o.customer_phone, tb.label AS table_label, u.name AS cashier_name,
              (SELECT GROUP_CONCAT(DISTINCT p.method) FROM payments p WHERE p.bill_id = b.id) AS methods
       FROM bills b JOIN orders o ON o.id = b.order_id LEFT JOIN tables tb ON tb.id = o.table_id LEFT JOIN users u ON u.id = b.cashier_id
       WHERE ${where} ORDER BY b.bill_no DESC LIMIT 500`, ...params));
  });
  r.get('/bills/:id/ticket', requirePerm('bill.view'), (req, res) => res.json(billTicket(req.staff!.tenant, pid(req))));
  r.post('/bills/:id/pay', (req, res) => {
    const b = parse(z.object({
      payments: z.array(z.object({ method: z.enum(['cash', 'card', 'upi', 'other']), amount: paise, reference: z.string().max(60).optional() })).max(5),
    }), req.body);
    res.json(orders.payBill(ctx(req), pid(req), b.payments));
  });
  r.post('/bills/:id/void', (req, res) => {
    const b = parse(z.object({ reason: z.string().max(200) }), req.body);
    res.json(orders.voidBill(ctx(req), pid(req), b.reason));
  });
  r.post('/bills/:id/whatsapp', requirePerm('bill.view'), (req, res) => {
    const t = req.staff!.tenant;
    const b = parse(z.object({ phone: z.string().max(20).optional() }), req.body);
    const ticket = billTicket(t, pid(req));
    const phone = normalisePhone(b.phone || ticket.customerPhone, orders.settingsOf(t).countryCode);
    if (!phone) throw badRequest('Enter the customer\'s 10-digit mobile number');
    if (b.phone) {
      const bill = t.must('bills', pid(req));
      t.run('UPDATE orders SET customer_phone = ? WHERE id = ? AND restaurant_id = ?', b.phone, bill.order_id, t.rid);
    }
    const text = billText(ticket);
    t.audit(req.staff!.userId, 'bill.whatsapp', 'bill', pid(req), { phone });
    res.json({ url: `https://wa.me/${phone}?text=${encodeURIComponent(text)}`, text, phone });
  });
  r.post('/bills/:id/print', requirePerm('bill.view'), async (req, res) => {
    const t = req.staff!.tenant;
    const s = orders.settingsOf(t);
    if (!s.billPrinter?.host) throw conflict('No bill printer is set up in Settings');
    await sendToPrinter(s.billPrinter.host, s.billPrinter.port, billEscPos(billTicket(t, pid(req))))
      .catch((e) => { throw conflict(`Printer error: ${e.message}`); });
    res.json({ ok: true });
  });

  // ---- Cleaning ----
  r.get('/cleaning', requirePerm('cleaning.view'), (req, res) => {
    const t = req.staff!.tenant;
    res.json(t.all(
      `SELECT c.*, tb.label AS table_label, s.name AS section, u.name AS requested_by_name FROM cleaning_tasks c
       JOIN tables tb ON tb.id = c.table_id JOIN sections s ON s.id = tb.section_id LEFT JOIN users u ON u.id = c.requested_by
       WHERE c.restaurant_id = ? AND (c.status = 'pending' OR c.done_at > datetime('now', '-2 hours')) ORDER BY c.status DESC, c.id`, t.rid));
  });
  r.post('/cleaning', (req, res) => {
    const b = parse(z.object({ tableId: id }), req.body);
    res.status(201).json(orders.requestCleaning(ctx(req), b.tableId));
  });
  r.post('/cleaning/:id/done', (req, res) => res.json(orders.finishCleaning(ctx(req), pid(req))));

  // ---- Guest (QR) requests ----
  r.get('/guest-requests', requirePerm('guest.handle'), (req, res) => {
    const status = parse(z.enum(['pending', 'accepted', 'rejected']).default('pending'), req.query.status);
    res.json(listGuestRequests(req.staff!.tenant, status));
  });
  r.post('/guest-requests/:id/:action', requirePerm('guest.handle'), (req, res) => {
    const action = parse(z.enum(['accept', 'reject']), req.params.action);
    res.json(handleGuestRequest(ctx(req), pid(req), action === 'accept'));
  });

  // ---- Reports ----
  const range = (req: Request) => {
    const t = req.staff!.tenant;
    const today = businessDate(orders.settingsOf(t).timezone);
    const q = parse(z.object({ from: dateStr.default(today), to: dateStr.default(today), format: z.enum(['json', 'csv']).default('json') }), req.query);
    if (q.from > q.to) throw badRequest('Start date is after end date');
    return q;
  };
  const send = (res: any, q: { format: string }, name: string, rows: any) => {
    if (q.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
      return res.send(toCsv(rows));
    }
    res.json(rows);
  };
  r.get('/reports/summary', requirePerm('reports.view'), (req, res) => {
    const q = range(req);
    const s = salesSummary(req.staff!.tenant, q.from, q.to);
    send(res, q, `sales-${q.from}-${q.to}`, q.format === 'csv' ? s.byDay : s);
  });
  r.get('/reports/items', requirePerm('reports.view'), (req, res) => {
    const q = range(req);
    send(res, q, `items-${q.from}-${q.to}`, itemSales(req.staff!.tenant, q.from, q.to));
  });
  r.get('/reports/staff', requirePerm('reports.view'), (req, res) => {
    const q = range(req);
    send(res, q, `staff-${q.from}-${q.to}`, staffPerformance(req.staff!.tenant, q.from, q.to));
  });
  r.get('/reports/cancellations', requirePerm('reports.view'), (req, res) => {
    const q = range(req);
    send(res, q, `cancelled-${q.from}-${q.to}`, cancelledItems(req.staff!.tenant, q.from, q.to));
  });
  r.get('/reports/bills', requirePerm('reports.view'), (req, res) => {
    const q = range(req);
    const t = req.staff!.tenant;
    send(res, q, `bills-${q.from}-${q.to}`, t.all(
      `SELECT b.bill_no, b.business_date, o.order_type, tb.label AS table_label, b.subtotal / 100.0 AS subtotal, b.discount / 100.0 AS discount,
              b.tax_total / 100.0 AS tax, b.grand_total / 100.0 AS grand_total, b.status,
              (SELECT GROUP_CONCAT(p.method || ':' || (p.amount / 100.0)) FROM payments p WHERE p.bill_id = b.id) AS payments
       FROM bills b JOIN orders o ON o.id = b.order_id LEFT JOIN tables tb ON tb.id = o.table_id
       WHERE b.restaurant_id = ? AND b.business_date BETWEEN ? AND ? ORDER BY b.bill_no`, t.rid, q.from, q.to));
  });

  return r;
}
