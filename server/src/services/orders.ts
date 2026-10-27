import { Tenant } from '../tenant.js';
import { Row } from '../db.js';
import { Realtime } from '../realtime.js';
import { Role, can, Permission } from '../permissions.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { parseSettings, businessDate, Settings } from '../settings.js';
import { calculateBill, Discount } from '../billing.js';
import { kotEscPos, sendToPrinter, KotTicket } from '../printing.js';
import { fmtDateTime } from '../time.js';

export type Ctx = { t: Tenant; userId: number; role: Role; rt: Realtime };

export const LIVE_STATUSES = ['open', 'dining_done', 'billed'];
const KITCHEN_PENDING = ['queued', 'cooking'];

export function settingsOf(t: Tenant): Settings {
  return parseSettings(t.restaurant().settings);
}

function need(ctx: Ctx, perm: Permission) {
  if (!can(ctx.role, perm)) throw forbidden();
}

export function orderWhere(o: { order_type: string; id: number; table_label?: string | null }): string {
  if (o.order_type === 'dine_in') return `Table ${o.table_label ?? '?'}`;
  return `${o.order_type === 'takeaway' ? 'Parcel' : 'Delivery'} #${o.id}`;
}

function loadOrder(t: Tenant, id: number): Row {
  const o = t.one(
    `SELECT o.*, tb.label AS table_label, s.name AS server_name FROM orders o
     LEFT JOIN tables tb ON tb.id = o.table_id
     LEFT JOIN users s ON s.id = o.server_id
     WHERE o.id = ? AND o.restaurant_id = ?`, id, t.rid);
  if (!o) throw notFound('Order not found');
  return o;
}

function assertOrderAccess(ctx: Ctx, order: Row) {
  if (ctx.role !== 'server') return;
  const s = settingsOf(ctx.t);
  if (!s.serversSeeAllTables && order.server_id && order.server_id !== ctx.userId) {
    throw forbidden('This table is handled by another server');
  }
}

function changed(ctx: Ctx, orderId: number, extra: string[] = []) {
  ctx.rt.emit(ctx.t.rid, 'order:changed', { orderId });
  ctx.rt.emit(ctx.t.rid, 'floor:changed');
  for (const e of extra) ctx.rt.emit(ctx.t.rid, e, { orderId });
}

export function orderDetail(t: Tenant, id: number, role?: Role) {
  const o = loadOrder(t, id);
  const items = t.all(
    `SELECT oi.*, k.kot_no FROM order_items oi JOIN kots k ON k.id = oi.kot_id
     WHERE oi.restaurant_id = ? AND oi.order_id = ? ORDER BY oi.id`, t.rid, id);
  const kots = t.all(
    `SELECT k.id, k.kot_no, k.source, k.created_at, k.printed_at, u.name AS created_by_name FROM kots k
     LEFT JOIN users u ON u.id = k.created_by WHERE k.restaurant_id = ? AND k.order_id = ? ORDER BY k.id`, t.rid, id);
  const bill = t.one(
    `SELECT b.*, u.name AS cashier_name FROM bills b LEFT JOIN users u ON u.id = b.cashier_id
     WHERE b.restaurant_id = ? AND b.order_id = ? AND b.status != 'void' ORDER BY b.id DESC LIMIT 1`, t.rid, id);
  const settings = settingsOf(t);
  let billOut: Row | null = null;
  if (bill) {
    const payments = t.all('SELECT method, amount, reference, created_at FROM payments WHERE restaurant_id = ? AND bill_id = ?', t.rid, bill.id);
    billOut = { ...bill, breakdown: JSON.parse(bill.breakdown), payments, bill_label: `${settings.billPrefix}${bill.bill_no}` };
  }
  return {
    ...o,
    where: orderWhere(o),
    items,
    kots,
    bill: role && !can(role, 'bill.view') && billOut ? { ...billOut, payments: [] } : billOut,
    totals: calculateBill(items, settings),
  };
}

export function createOrder(ctx: Ctx, input: {
  type: 'dine_in' | 'takeaway' | 'delivery'; tableId?: number; guests?: number;
  customerName?: string; customerPhone?: string; customerAddress?: string; serverId?: number | null; notes?: string;
}) {
  need(ctx, 'order.create');
  const { t } = ctx;
  let tableId: number | null = null;
  if (input.type === 'dine_in') {
    if (!input.tableId) throw badRequest('Pick a table for dine-in');
    const table = t.must('tables', input.tableId, 'Table');
    if (!table.active) throw conflict('This table is disabled');
    const live = t.one(
      `SELECT id FROM orders WHERE restaurant_id = ? AND table_id = ? AND status IN ('open','dining_done','billed')`, t.rid, table.id);
    if (live) throw Object.assign(conflict(`Table ${table.label} already has a running order`), { details: { orderId: live.id } });
    tableId = table.id;
  }
  let serverId: number | null = ctx.role === 'server' ? ctx.userId : null;
  if (ctx.role !== 'server' && input.serverId) {
    const s = t.must('users', input.serverId, 'Server');
    if (!s.active) throw badRequest('That staff member is inactive');
    serverId = s.id;
  }
  const id = t.tx(() => {
    const r = t.run(
      `INSERT INTO orders (restaurant_id, order_type, table_id, status, server_id, guests, customer_name, customer_phone, customer_address, notes, created_by)
       VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?)`,
      t.rid, input.type, tableId, serverId, input.guests ?? 0, input.customerName ?? '', input.customerPhone ?? '',
      input.customerAddress ?? '', input.notes ?? '', ctx.userId);
    t.audit(ctx.userId, 'order.create', 'order', r.id, { type: input.type, tableId });
    return r.id;
  });
  changed(ctx, id);
  return orderDetail(t, id, ctx.role);
}

export function updateOrder(ctx: Ctx, orderId: number, patch: {
  guests?: number; customerName?: string; customerPhone?: string; customerAddress?: string; notes?: string; serverId?: number | null;
}) {
  need(ctx, 'order.create');
  const { t } = ctx;
  const o = loadOrder(t, orderId);
  assertOrderAccess(ctx, o);
  if (!LIVE_STATUSES.includes(o.status)) throw conflict('This order is already closed');
  let serverId = o.server_id;
  if (patch.serverId !== undefined && ctx.role !== 'server') {
    serverId = patch.serverId ? t.must('users', patch.serverId, 'Server').id : null;
  }
  t.run(
    `UPDATE orders SET guests = ?, customer_name = ?, customer_phone = ?, customer_address = ?, notes = ?, server_id = ?
     WHERE id = ? AND restaurant_id = ?`,
    patch.guests ?? o.guests, patch.customerName ?? o.customer_name, patch.customerPhone ?? o.customer_phone,
    patch.customerAddress ?? o.customer_address, patch.notes ?? o.notes, serverId, orderId, t.rid);
  changed(ctx, orderId);
  return orderDetail(t, orderId, ctx.role);
}

function nextKotNo(t: Tenant, settings: Settings): { kotNo: number; date: string } {
  const date = businessDate(settings.timezone);
  const r = t.restaurant();
  const kotNo = r.kot_seq_date === date ? r.kot_seq + 1 : 1;
  t.db.prepare('UPDATE restaurants SET kot_seq = ?, kot_seq_date = ? WHERE id = ?').run(kotNo, date, t.rid);
  return { kotNo, date };
}

export type KotLine = { menuItemId: number; qty: number; note?: string };

/** "Start cooking": sends only the new items to the kitchen as one KOT. */
export function addKot(ctx: Ctx, orderId: number, lines: KotLine[], source: 'staff' | 'qr' = 'staff') {
  need(ctx, 'order.kot');
  const { t } = ctx;
  if (!lines.length) throw badRequest('Add at least one item');
  const settings = settingsOf(t);
  const o = loadOrder(t, orderId);
  assertOrderAccess(ctx, o);
  if (o.status === 'billed') throw conflict('Bill is already generated. Reopen the table to add items.');
  if (!['open', 'dining_done'].includes(o.status)) throw conflict('This order is already closed');

  const kotId = t.tx(() => {
    const menu = lines.map((l) => {
      const m = t.must('menu_items', l.menuItemId, 'Menu item');
      if (!m.active || !m.available) throw conflict(`${m.name} is not available right now`);
      return m;
    });
    const { kotNo, date } = nextKotNo(t, settings);
    const kot = t.run(
      'INSERT INTO kots (restaurant_id, order_id, kot_no, business_date, source, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      t.rid, orderId, kotNo, date, source, ctx.userId);
    lines.forEach((l, i) => {
      const m = menu[i];
      t.run(
        `INSERT INTO order_items (restaurant_id, order_id, kot_id, menu_item_id, name, price, qty, note, kitchen, status, created_by, ready_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        t.rid, orderId, kot.id, m.id, m.name, m.price, l.qty, l.note ?? '', m.send_to_kitchen ? 1 : 0,
        m.send_to_kitchen ? 'queued' : 'ready', ctx.userId, m.send_to_kitchen ? null : new Date().toISOString());
    });
    const serverId = o.server_id ?? (ctx.role === 'server' ? ctx.userId : null);
    t.run(`UPDATE orders SET status = 'open', server_id = ? WHERE id = ? AND restaurant_id = ?`, serverId, orderId, t.rid);
    t.audit(ctx.userId, 'kot.create', 'kot', kot.id, { orderId, kotNo, items: lines.length, source });
    return kot.id;
  });

  changed(ctx, orderId);
  ctx.rt.emit(t.rid, 'kot:new', { kotId, orderId });
  if (settings.kotPrinter?.host) {
    const ticket = kotTicket(t, kotId);
    if (ticket.items.length) {
      sendToPrinter(settings.kotPrinter.host, settings.kotPrinter.port, kotEscPos(ticket))
        .then(() => t.run(`UPDATE kots SET printed_at = datetime('now') WHERE id = ? AND restaurant_id = ?`, kotId, t.rid))
        .catch((e) => console.warn(`[print] KOT ${kotId} failed: ${e.message}`));
    }
  }
  return orderDetail(t, orderId, ctx.role);
}

export function kotTicket(t: Tenant, kotId: number): KotTicket & { orderId: number } {
  const k = t.one(
    `SELECT k.*, u.name AS by_name FROM kots k LEFT JOIN users u ON u.id = k.created_by
     WHERE k.id = ? AND k.restaurant_id = ?`, kotId, t.rid);
  if (!k) throw notFound('KOT not found');
  const o = loadOrder(t, k.order_id);
  const items = t.all(
    `SELECT name, qty, note FROM order_items WHERE restaurant_id = ? AND kot_id = ? AND kitchen = 1 AND status != 'cancelled' ORDER BY id`,
    t.rid, kotId) as { name: string; qty: number; note: string }[];
  const settings = settingsOf(t);
  return {
    orderId: o.id, restaurant: t.restaurant().name, kotNo: k.kot_no, where: orderWhere(o),
    createdAt: fmtDateTime(settings.timezone, k.created_at), by: k.by_name ?? (k.source === 'qr' ? 'QR' : ''), items,
  };
}

const TRANSITIONS: Record<string, string[]> = {
  queued: ['cooking', 'ready'],
  cooking: ['ready', 'queued'],
  ready: ['served', 'cooking'],
  served: [],
  cancelled: [],
};

function applyItemStatus(ctx: Ctx, item: Row, status: string) {
  if (!TRANSITIONS[item.status]?.includes(status)) {
    throw conflict(`Can't move "${item.name}" from ${item.status} to ${status}`);
  }
  need(ctx, status === 'served' ? 'order.serve' : 'kitchen.update');
  const { t } = ctx;
  if (status === 'ready') {
    t.run(`UPDATE order_items SET status = 'ready', ready_at = datetime('now'), ready_by = ? WHERE id = ? AND restaurant_id = ?`, ctx.userId, item.id, t.rid);
  } else if (status === 'served') {
    t.run(`UPDATE order_items SET status = 'served', served_at = datetime('now'), served_by = ? WHERE id = ? AND restaurant_id = ?`, ctx.userId, item.id, t.rid);
  } else {
    t.run('UPDATE order_items SET status = ? WHERE id = ? AND restaurant_id = ?', status, item.id, t.rid);
  }
}

function notifyReady(ctx: Ctx, orderId: number, names: string[]) {
  if (!names.length) return;
  const o = loadOrder(ctx.t, orderId);
  const payload = { kind: 'ready', orderId, where: orderWhere(o), message: `${orderWhere(o)}: ${names.join(', ')} ready to serve` };
  if (o.server_id) ctx.rt.emitToUser(ctx.t.rid, o.server_id, 'notify', payload);
  else ctx.rt.emitToRoles(ctx.t.rid, ['server'], 'notify', payload);
  ctx.rt.emitToRoles(ctx.t.rid, ['cashier', 'manager', 'owner', 'trustee'], 'notify', payload);
}

export function setItemStatus(ctx: Ctx, itemId: number, status: string) {
  const { t } = ctx;
  const item = t.must('order_items', itemId, 'Item');
  const o = loadOrder(t, item.order_id);
  if (!['open', 'dining_done'].includes(o.status)) throw conflict('This order is already closed');
  if (status === 'served') assertOrderAccess(ctx, o);
  t.tx(() => applyItemStatus(ctx, item, status));
  if (status === 'ready') notifyReady(ctx, o.id, [`${item.qty} x ${item.name}`]);
  changed(ctx, o.id, ['kitchen:changed']);
  return orderDetail(t, o.id, ctx.role);
}

/** Bump every eligible item of a KOT at once (kitchen "All ready"). */
export function setKotStatus(ctx: Ctx, kotId: number, status: 'cooking' | 'ready') {
  need(ctx, 'kitchen.update');
  const { t } = ctx;
  const kot = t.must('kots', kotId, 'KOT');
  const items = t.all(
    `SELECT * FROM order_items WHERE restaurant_id = ? AND kot_id = ? AND kitchen = 1 AND status IN ('queued','cooking')`, t.rid, kotId);
  const moved = items.filter((i) => TRANSITIONS[i.status].includes(status) && i.status !== status);
  t.tx(() => moved.forEach((i) => applyItemStatus(ctx, i, status)));
  if (status === 'ready') notifyReady(ctx, kot.order_id, moved.map((i) => `${i.qty} x ${i.name}`));
  changed(ctx, kot.order_id, ['kitchen:changed']);
  return { updated: moved.length };
}

export function serveAllReady(ctx: Ctx, orderId: number) {
  need(ctx, 'order.serve');
  const { t } = ctx;
  const o = loadOrder(t, orderId);
  assertOrderAccess(ctx, o);
  const items = t.all(`SELECT * FROM order_items WHERE restaurant_id = ? AND order_id = ? AND status = 'ready'`, t.rid, orderId);
  t.tx(() => items.forEach((i) => applyItemStatus(ctx, i, 'served')));
  changed(ctx, orderId);
  return orderDetail(t, orderId, ctx.role);
}

export function cancelItem(ctx: Ctx, itemId: number, reason: string) {
  const { t } = ctx;
  const item = t.must('order_items', itemId, 'Item');
  const o = loadOrder(t, item.order_id);
  assertOrderAccess(ctx, o);
  if (o.status === 'billed') throw conflict('Bill is already generated. Reopen the table first.');
  if (!['open', 'dining_done'].includes(o.status)) throw conflict('This order is already closed');
  if (item.status === 'cancelled') return orderDetail(t, o.id, ctx.role);
  need(ctx, item.status === 'queued' ? 'order.cancelQueuedItem' : 'order.cancelAnyItem');
  if (!reason.trim()) throw badRequest('Give a reason for cancelling');
  t.tx(() => {
    t.run(`UPDATE order_items SET status = 'cancelled', cancel_reason = ?, cancelled_by = ? WHERE id = ? AND restaurant_id = ?`, reason, ctx.userId, itemId, t.rid);
    t.audit(ctx.userId, 'item.cancel', 'order_item', itemId, { orderId: o.id, name: item.name, qty: item.qty, was: item.status, reason });
  });
  changed(ctx, o.id, ['kitchen:changed']);
  return orderDetail(t, o.id, ctx.role);
}

function liveItems(t: Tenant, orderId: number) {
  return t.all(`SELECT * FROM order_items WHERE restaurant_id = ? AND order_id = ? AND status != 'cancelled'`, t.rid, orderId);
}

/** Server taps "Dining complete": food part is over, table waits for the bill. */
export function completeDining(ctx: Ctx, orderId: number, force = false) {
  need(ctx, 'order.complete');
  const { t } = ctx;
  const o = loadOrder(t, orderId);
  assertOrderAccess(ctx, o);
  if (o.status === 'dining_done') return orderDetail(t, orderId, ctx.role);
  if (o.status !== 'open') throw conflict('This order is not running');
  const items = liveItems(t, orderId);
  if (!items.length) throw conflict('Nothing was ordered. Cancel the order instead.');
  if (!force && items.some((i) => KITCHEN_PENDING.includes(i.status))) {
    throw conflict('Some items are still being prepared in the kitchen');
  }
  t.tx(() => {
    t.run(`UPDATE order_items SET status = 'served', served_at = datetime('now'), served_by = ?
           WHERE restaurant_id = ? AND order_id = ? AND status = 'ready'`, ctx.userId, t.rid, orderId);
    t.run(`UPDATE orders SET status = 'dining_done', dining_done_at = datetime('now') WHERE id = ? AND restaurant_id = ?`, orderId, t.rid);
    t.audit(ctx.userId, 'order.dining_done', 'order', orderId);
  });
  changed(ctx, orderId);
  return orderDetail(t, orderId, ctx.role);
}

/** Cashier "Close table": freezes the order and issues the bill number. */
export function generateBill(ctx: Ctx, orderId: number, discount: Discount, force = false) {
  need(ctx, 'bill.generate');
  const { t } = ctx;
  const o = loadOrder(t, orderId);
  if (!LIVE_STATUSES.includes(o.status)) throw conflict('This order is already closed');
  const items = liveItems(t, orderId);
  if (!items.length) throw conflict('Nothing to bill');
  if (!force && items.some((i) => KITCHEN_PENDING.includes(i.status))) {
    throw conflict('Some items are still being prepared in the kitchen');
  }
  const settings = settingsOf(t);
  const totals = calculateBill(items, settings, discount);
  const breakdown = JSON.stringify({ lines: totals.lines, taxes: totals.taxes, taxMode: settings.taxMode, discountInput: discount ?? null });

  t.tx(() => {
    const existing = t.one(`SELECT * FROM bills WHERE restaurant_id = ? AND order_id = ? AND status = 'unpaid'`, t.rid, orderId);
    if (existing) {
      t.run(
        `UPDATE bills SET subtotal = ?, discount = ?, service_charge = ?, tax_total = ?, round_off = ?, grand_total = ?, total_qty = ?,
         breakdown = ?, cashier_id = ?, updated_at = datetime('now') WHERE id = ? AND restaurant_id = ?`,
        totals.subtotal, totals.discount, totals.serviceCharge, totals.taxTotal, totals.roundOff, totals.grandTotal, totals.totalQty,
        breakdown, ctx.userId, existing.id, t.rid);
      t.audit(ctx.userId, 'bill.regenerate', 'bill', existing.id, { billNo: existing.bill_no, grandTotal: totals.grandTotal });
    } else {
      const billNo = t.restaurant().bill_seq + 1;
      t.db.prepare('UPDATE restaurants SET bill_seq = ? WHERE id = ?').run(billNo, t.rid);
      const r = t.run(
        `INSERT INTO bills (restaurant_id, order_id, bill_no, business_date, subtotal, discount, service_charge, tax_total, round_off,
         grand_total, total_qty, breakdown, status, cashier_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?)`,
        t.rid, orderId, billNo, businessDate(settings.timezone), totals.subtotal, totals.discount, totals.serviceCharge, totals.taxTotal,
        totals.roundOff, totals.grandTotal, totals.totalQty, breakdown, ctx.userId);
      t.audit(ctx.userId, 'bill.generate', 'bill', r.id, { billNo, grandTotal: totals.grandTotal });
    }
    t.run(`UPDATE order_items SET status = 'served', served_at = datetime('now'), served_by = ?
           WHERE restaurant_id = ? AND order_id = ? AND status IN ('ready','queued','cooking')`, ctx.userId, t.rid, orderId);
    t.run(`UPDATE orders SET status = 'billed', dining_done_at = COALESCE(dining_done_at, datetime('now')) WHERE id = ? AND restaurant_id = ?`, orderId, t.rid);
  });
  changed(ctx, orderId, ['kitchen:changed', 'bills:changed']);
  return orderDetail(t, orderId, ctx.role);
}

export function reopenOrder(ctx: Ctx, orderId: number) {
  need(ctx, 'bill.reopen');
  const { t } = ctx;
  const o = loadOrder(t, orderId);
  if (o.status !== 'billed') throw conflict('Only a billed, unpaid table can be reopened');
  t.tx(() => {
    t.run(`UPDATE orders SET status = 'open' WHERE id = ? AND restaurant_id = ?`, orderId, t.rid);
    t.audit(ctx.userId, 'order.reopen', 'order', orderId);
  });
  changed(ctx, orderId, ['bills:changed']);
  return orderDetail(t, orderId, ctx.role);
}

export function requestCleaning(ctx: Ctx, tableId: number) {
  need(ctx, 'cleaning.request');
  const { t } = ctx;
  const table = t.must('tables', tableId, 'Table');
  const task = t.tx(() => {
    const pending = t.one(`SELECT * FROM cleaning_tasks WHERE restaurant_id = ? AND table_id = ? AND status = 'pending'`, t.rid, table.id);
    if (pending) return pending;
    const r = t.run(`INSERT INTO cleaning_tasks (restaurant_id, table_id, status, requested_by) VALUES (?, ?, 'pending', ?)`, t.rid, table.id, ctx.userId);
    t.run('UPDATE tables SET needs_cleaning = 1 WHERE id = ? AND restaurant_id = ?', table.id, t.rid);
    return t.find('cleaning_tasks', r.id)!;
  });
  ctx.rt.emit(t.rid, 'cleaning:changed');
  ctx.rt.emit(t.rid, 'floor:changed');
  ctx.rt.emitToRoles(t.rid, ['cleaner'], 'notify', { kind: 'cleaning', message: `Please clean table ${table.label}` });
  return task;
}

export function finishCleaning(ctx: Ctx, taskId: number) {
  need(ctx, 'cleaning.done');
  const { t } = ctx;
  const task = t.must('cleaning_tasks', taskId, 'Cleaning task');
  if (task.status === 'done') return task;
  t.tx(() => {
    t.run(`UPDATE cleaning_tasks SET status = 'done', done_by = ?, done_at = datetime('now') WHERE id = ? AND restaurant_id = ?`, ctx.userId, taskId, t.rid);
    t.run('UPDATE tables SET needs_cleaning = 0 WHERE id = ? AND restaurant_id = ?', task.table_id, t.rid);
  });
  ctx.rt.emit(t.rid, 'cleaning:changed');
  ctx.rt.emit(t.rid, 'floor:changed');
  return t.find('cleaning_tasks', taskId);
}

export type PaymentInput = { method: 'cash' | 'card' | 'upi' | 'other'; amount: number; reference?: string };

/** Settlement: money received, bill closed for good. */
export function payBill(ctx: Ctx, billId: number, payments: PaymentInput[]) {
  need(ctx, 'bill.pay');
  const { t } = ctx;
  const bill = t.must('bills', billId, 'Bill');
  if (bill.status === 'paid') throw conflict('This bill is already paid');
  if (bill.status === 'void') throw conflict('This bill was voided');
  const o = loadOrder(t, bill.order_id);
  if (o.status !== 'billed') throw conflict('The table was reopened. Generate the bill again before taking payment.');
  const sum = payments.reduce((s, p) => s + p.amount, 0);
  if (sum !== bill.grand_total) {
    throw badRequest(`Payments add up to ₹${(sum / 100).toFixed(2)} but the bill is ₹${(bill.grand_total / 100).toFixed(2)}`);
  }
  const settings = settingsOf(t);
  t.tx(() => {
    for (const p of payments) {
      if (p.amount <= 0) continue;
      t.run('INSERT INTO payments (restaurant_id, bill_id, method, amount, reference, received_by) VALUES (?, ?, ?, ?, ?, ?)',
        t.rid, billId, p.method, p.amount, p.reference ?? '', ctx.userId);
    }
    t.run(`UPDATE bills SET status = 'paid', paid_at = datetime('now') WHERE id = ? AND restaurant_id = ?`, billId, t.rid);
    t.run(`UPDATE orders SET status = 'paid', closed_at = datetime('now') WHERE id = ? AND restaurant_id = ?`, o.id, t.rid);
    t.audit(ctx.userId, 'bill.pay', 'bill', billId, { billNo: bill.bill_no, payments });
  });
  changed(ctx, o.id, ['bills:changed']);
  if (o.order_type === 'dine_in' && o.table_id && settings.autoCleaning) {
    requestCleaning({ ...ctx, role: 'owner' }, o.table_id);
  }
  return orderDetail(t, o.id, ctx.role);
}

export function voidBill(ctx: Ctx, billId: number, reason: string) {
  need(ctx, 'bill.void');
  const { t } = ctx;
  if (!reason.trim()) throw badRequest('Give a reason for voiding');
  const bill = t.must('bills', billId, 'Bill');
  if (bill.status === 'void') throw conflict('Already void');
  t.tx(() => {
    t.run(`UPDATE bills SET status = 'void', void_reason = ?, updated_at = datetime('now') WHERE id = ? AND restaurant_id = ?`, reason, billId, t.rid);
    t.run(`UPDATE orders SET status = 'cancelled', closed_at = datetime('now') WHERE id = ? AND restaurant_id = ?`, bill.order_id, t.rid);
    t.audit(ctx.userId, 'bill.void', 'bill', billId, { billNo: bill.bill_no, grandTotal: bill.grand_total, wasPaid: bill.status === 'paid', reason });
  });
  changed(ctx, bill.order_id, ['bills:changed', 'kitchen:changed']);
  return orderDetail(t, bill.order_id, ctx.role);
}

export function cancelOrder(ctx: Ctx, orderId: number, reason: string) {
  const { t } = ctx;
  const o = loadOrder(t, orderId);
  assertOrderAccess(ctx, o);
  if (!LIVE_STATUSES.includes(o.status)) throw conflict('This order is already closed');
  const items = liveItems(t, orderId);
  // Anyone who can open a table can undo an empty one; otherwise managers only.
  need(ctx, items.length ? 'order.cancel' : 'order.create');
  if (items.length && !reason.trim()) throw badRequest('Give a reason for cancelling');
  t.tx(() => {
    t.run(`UPDATE order_items SET status = 'cancelled', cancel_reason = ?, cancelled_by = ? WHERE restaurant_id = ? AND order_id = ? AND status != 'cancelled'`,
      reason || 'order cancelled', ctx.userId, t.rid, orderId);
    t.run(`UPDATE bills SET status = 'void', void_reason = ? WHERE restaurant_id = ? AND order_id = ? AND status = 'unpaid'`, reason || 'order cancelled', t.rid, orderId);
    t.run(`UPDATE orders SET status = 'cancelled', closed_at = datetime('now') WHERE id = ? AND restaurant_id = ?`, orderId, t.rid);
    t.audit(ctx.userId, 'order.cancel', 'order', orderId, { reason, items: items.length });
  });
  changed(ctx, orderId, ['kitchen:changed', 'bills:changed']);
  return orderDetail(t, orderId, ctx.role);
}

export function moveOrder(ctx: Ctx, orderId: number, tableId: number) {
  need(ctx, 'order.move');
  const { t } = ctx;
  const o = loadOrder(t, orderId);
  assertOrderAccess(ctx, o);
  if (o.order_type !== 'dine_in' || !LIVE_STATUSES.includes(o.status)) throw conflict('Only running dine-in orders can be moved');
  const target = t.must('tables', tableId, 'Table');
  const busy = t.one(`SELECT id FROM orders WHERE restaurant_id = ? AND table_id = ? AND status IN ('open','dining_done','billed')`, t.rid, target.id);
  if (busy) throw conflict(`Table ${target.label} is busy`);
  t.tx(() => {
    t.run('UPDATE orders SET table_id = ? WHERE id = ? AND restaurant_id = ?', target.id, orderId, t.rid);
    t.audit(ctx.userId, 'order.move', 'order', orderId, { from: o.table_label, to: target.label });
  });
  changed(ctx, orderId);
  return orderDetail(t, orderId, ctx.role);
}

/** Live table grid for the floor view. */
export function floor(t: Tenant) {
  const sections = t.all('SELECT id, name, sort FROM sections WHERE restaurant_id = ? ORDER BY sort, id', t.rid);
  const tables = t.all(
    'SELECT id, section_id, label, seats, needs_cleaning, sort FROM tables WHERE restaurant_id = ? AND active = 1 ORDER BY sort, id', t.rid);
  const orders = t.all(
    `SELECT o.id, o.order_type, o.table_id, o.status, o.opened_at, o.server_id, o.customer_name, o.customer_phone, o.guests,
            u.name AS server_name, tb.label AS table_label,
            COALESCE(SUM(CASE WHEN oi.status != 'cancelled' THEN oi.price * oi.qty END), 0) AS amount,
            COALESCE(SUM(CASE WHEN oi.status IN ('queued','cooking') THEN 1 END), 0) AS in_kitchen,
            COALESCE(SUM(CASE WHEN oi.status = 'ready' THEN 1 END), 0) AS ready,
            COUNT(oi.id) AS item_count,
            (SELECT b.grand_total FROM bills b WHERE b.restaurant_id = o.restaurant_id AND b.order_id = o.id AND b.status = 'unpaid') AS bill_total,
            (SELECT b.bill_no FROM bills b WHERE b.restaurant_id = o.restaurant_id AND b.order_id = o.id AND b.status = 'unpaid') AS bill_no
     FROM orders o
     LEFT JOIN order_items oi ON oi.order_id = o.id
     LEFT JOIN users u ON u.id = o.server_id
     LEFT JOIN tables tb ON tb.id = o.table_id
     WHERE o.restaurant_id = ? AND o.status IN ('open','dining_done','billed')
     GROUP BY o.id ORDER BY o.id`, t.rid);
  const byTable = new Map(orders.filter((o) => o.table_id).map((o) => [o.table_id, o]));
  const stateOf = (o: Row | undefined, needsCleaning: number) => {
    if (!o) return needsCleaning ? 'cleaning' : 'free';
    if (o.status === 'billed') return 'billed';
    if (o.status === 'dining_done') return 'dining_done';
    if (o.in_kitchen > 0) return 'cooking';
    if (o.ready > 0) return 'ready';
    return o.item_count ? 'running' : 'seated';
  };
  return {
    sections,
    tables: tables.map((tb) => {
      const o = byTable.get(tb.id);
      return { ...tb, state: stateOf(o, tb.needs_cleaning), order: o ?? null };
    }),
    others: orders.filter((o) => !o.table_id).map((o) => ({ ...o, where: orderWhere(o), state: stateOf(o, 0) })),
  };
}
