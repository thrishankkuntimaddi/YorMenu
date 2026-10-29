import { Tenant } from '../tenant.js';
import { Row, Tx, by, newId, nowStr } from '../db.js';
import { Realtime } from '../realtime.js';
import { Role, Permission, PERMISSIONS } from '../permissions.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { parseSettings, businessDate, Settings } from '../settings.js';
import { calculateBill, Discount } from '../billing.js';
import { kotEscPos, KotTicket, toBase64 } from '../printing.js';
import { fmtDateTime } from '../time.js';
import { assertSubscribed } from '../subscription.js';

export type Ctx = { t: Tenant; userId: number; role: Role; perms: ReadonlySet<Permission>; rt: Realtime };
const ALL_PERMS: ReadonlySet<Permission> = new Set(PERMISSIONS);

export const LIVE_STATUSES = ['open', 'dining_done', 'billed'];
const KITCHEN_PENDING = ['queued', 'cooking'];

/*
 * An order document holds its items and KOTs:
 *   orders/{id} = { ...order fields, items: [...], kots: [...], item_ids: [...], kot_ids: [...], bill_id }
 * so the floor, kitchen and order screens each need one query.
 */

export async function settingsOf(t: Tenant, tx?: Tx): Promise<Settings> {
  return parseSettings((await t.restaurant(tx)).settings);
}

function need(ctx: Ctx, perm: Permission) {
  if (!ctx.perms.has(perm)) throw forbidden();
}

export function orderWhere(o: { order_type: string; id: number; order_no?: number; table_label?: string | null }): string {
  if (o.order_type === 'dine_in') return `Table ${o.table_label ?? '?'}`;
  return `${o.order_type === 'takeaway' ? 'Parcel' : 'Delivery'} #${o.order_no ?? o.id}`;
}

async function loadOrder(t: Tenant, id: number, tx?: Tx): Promise<Row> {
  const o = await t.find('orders', id, tx);
  if (!o) throw notFound('Order not found');
  return o;
}

async function withLabels(t: Tenant, o: Row): Promise<Row> {
  const [table, serverName] = await Promise.all([o.table_id ? t.find('tables', o.table_id) : null, t.userName(o.server_id)]);
  return { ...o, table_label: table?.label ?? null, server_name: serverName };
}

async function assertOrderAccess(ctx: Ctx, order: Row) {
  if (ctx.role !== 'server') return;
  const s = await settingsOf(ctx.t);
  if (!s.serversSeeAllTables && order.server_id && order.server_id !== ctx.userId) {
    throw forbidden('This table is handled by another server');
  }
}

/** A banner + beep on the phones of the people who need to act next (not the one who did it). */
async function alertRoles(ctx: Ctx, roles: string[], orderId: number, kind: string, text: (where: string) => string, toServer = false) {
  const o = await withLabels(ctx.t, await loadOrder(ctx.t, orderId)).catch(() => null);
  if (!o) return;
  const payload = { kind, orderId, where: orderWhere(o), message: text(orderWhere(o)) };
  ctx.rt.emitToRoles(ctx.t.rid, roles, 'notify', payload, ctx.userId);
  if (toServer && o.server_id && o.server_id !== ctx.userId) ctx.rt.emitToUser(ctx.t.rid, o.server_id, 'notify', payload);
}

function changed(ctx: Ctx, orderId: number, extra: string[] = []) {
  ctx.rt.emit(ctx.t.rid, 'order:changed', { orderId });
  ctx.rt.emit(ctx.t.rid, 'floor:changed');
  for (const e of extra) ctx.rt.emit(ctx.t.rid, e, { orderId });
}

const liveItemsOf = (o: Row) => (o.items as Row[]).filter((i) => i.status !== 'cancelled');

export async function orderDetail(t: Tenant, id: number, perms?: ReadonlySet<Permission>) {
  // Everything after the order itself is read at the same time.
  const [raw, settings] = await Promise.all([loadOrder(t, id), settingsOf(t)]);
  const [o, bill] = await Promise.all([withLabels(t, raw), raw.bill_id ? t.find('bills', raw.bill_id) : undefined]);
  const kotNo = new Map((o.kots as Row[]).map((k) => [k.id, k.kot_no]));
  const items = (o.items as Row[]).map((i) => ({ ...i, kot_no: kotNo.get(i.kot_id) ?? null }));
  const kots = await Promise.all((o.kots as Row[]).map(async (k) => ({ ...k, created_by_name: await t.userName(k.created_by) })));
  let billOut: Row | null = null;
  if (o.bill_id) {
    if (bill && bill.status !== 'void') {
      billOut = { ...bill, breakdown: JSON.parse(bill.breakdown), cashier_name: await t.userName(bill.cashier_id), bill_label: `${settings.billPrefix}${bill.bill_no}` };
    }
  }
  const hidePhone = perms && !perms.has('customer.viewPhone');
  const { items: _i, kots: _k, item_ids: _ii, kot_ids: _ki, guest_keys: _gk, guest_names: gn, ...rest } = o;
  return {
    ...rest,
    // Guest phones approved to order for this table (their secret keys stay out of the screens).
    guest_phones: ((gn ?? []) as Row[]).map((g) => ({ name: g.name, phone: hidePhone ? maskPhone(g.phone) : g.phone })),
    customer_phone: hidePhone ? maskPhone(o.customer_phone) : o.customer_phone,
    customer_address: hidePhone && o.customer_address ? '(hidden)' : o.customer_address,
    where: orderWhere(o),
    items,
    kots,
    bill: perms && !perms.has('bill.view') && billOut ? { ...billOut, payments: [] } : billOut,
    totals: calculateBill(items, settings),
  };
}

/** Daily running number for parcel/delivery labels ("Parcel #12"). */
function nextOrderNo(r: Row, date: string) {
  return r.order_seq_date === date ? (r.order_seq ?? 0) + 1 : 1;
}

export async function createOrder(ctx: Ctx, input: {
  type: 'dine_in' | 'takeaway' | 'delivery'; tableId?: number; guests?: number;
  customerName?: string; customerPhone?: string; customerAddress?: string; serverId?: number | null; notes?: string;
}) {
  need(ctx, 'order.create');
  const { t } = ctx;
  if (input.type === 'dine_in' && !input.tableId) throw badRequest('Pick a table for dine-in');
  let serverId: number | null = ctx.role === 'server' ? ctx.userId : null;
  if (ctx.role !== 'server' && input.serverId) {
    const s = await t.must('users', input.serverId, 'Server');
    if (!s.active) throw badRequest('That staff member is inactive');
    serverId = s.id;
  }
  const id = await t.tx(async (tx) => {
    const r = await t.restaurant(tx);
    assertSubscribed(r);
    let table: Row | null = null;
    if (input.type === 'dine_in') {
      table = await t.must('tables', input.tableId!, 'Table', tx);
      if (!table.active) throw conflict('This table is disabled');
      if (table.live_order_id) {
        const live = await t.find('orders', table.live_order_id, tx);
        if (live && LIVE_STATUSES.includes(live.status)) {
          throw Object.assign(conflict(`Table ${table.label} already has a running order`), { details: { orderId: live.id } });
        }
      }
    }
    const settings = parseSettings(r.settings);
    const date = businessDate(settings.timezone);
    const orderNo = nextOrderNo(r, date);
    t.updateRestaurant({ order_seq: orderNo, order_seq_date: date }, tx);
    const row = t.newDoc('orders', {
      order_no: orderNo, business_date: date, order_type: input.type, table_id: table?.id ?? null, status: 'open', server_id: serverId,
      guests: input.guests ?? 0, customer_name: input.customerName ?? '', customer_phone: input.customerPhone ?? '',
      customer_address: input.customerAddress ?? '', notes: input.notes ?? '', created_by: ctx.userId, opened_at: nowStr(),
      dining_done_at: null, closed_at: null, bill_id: null, items: [], kots: [], item_ids: [], kot_ids: [],
    }, tx);
    if (table) t.update('tables', table.id, { live_order_id: row.id }, tx);
    t.audit(ctx.userId, 'order.create', 'order', row.id, { type: input.type, tableId: table?.id ?? null }, tx);
    return row.id;
  });
  changed(ctx, id);
  return orderDetail(t, id, ctx.perms);
}

export async function updateOrder(ctx: Ctx, orderId: number, patch: {
  guests?: number; customerName?: string; customerPhone?: string; customerAddress?: string; notes?: string; serverId?: number | null;
}) {
  need(ctx, 'order.create');
  const { t } = ctx;
  const o = await loadOrder(t, orderId);
  await assertOrderAccess(ctx, o);
  if (!LIVE_STATUSES.includes(o.status)) throw conflict('This order is already closed');
  let serverId = o.server_id;
  if (patch.serverId !== undefined && ctx.role !== 'server') {
    serverId = patch.serverId ? (await t.must('users', patch.serverId, 'Server')).id : null;
  }
  await t.update('orders', orderId, {
    guests: patch.guests ?? o.guests, customer_name: patch.customerName ?? o.customer_name, customer_phone: patch.customerPhone ?? o.customer_phone,
    customer_address: patch.customerAddress ?? o.customer_address, notes: patch.notes ?? o.notes, server_id: serverId,
  });
  changed(ctx, orderId);
  return orderDetail(t, orderId, ctx.perms);
}

export type KotLine = { menuItemId: number; qty: number; note?: string };

/** "Start cooking": sends only the new items to the kitchen as one KOT. */
export async function addKot(ctx: Ctx, orderId: number, lines: KotLine[], source: 'staff' | 'qr' = 'staff') {
  need(ctx, 'order.kot');
  const { t } = ctx;
  if (!lines.length) throw badRequest('Add at least one item');
  const pre = await loadOrder(t, orderId);
  await assertOrderAccess(ctx, pre);

  const { kotId, settings } = await t.tx(async (tx) => {
    const o = await loadOrder(t, orderId, tx);
    if (o.status === 'billed') throw conflict('Bill is already generated. Reopen the table to add items.');
    if (!['open', 'dining_done'].includes(o.status)) throw conflict('This order is already closed');
    const r = await t.restaurant(tx);
    const menu: Row[] = [];
    for (const l of lines) {
      const m = await t.must('menu_items', l.menuItemId, 'Menu item', tx);
      if (!m.active || !m.available) throw conflict(`${m.name} is not available right now`);
      menu.push(m);
    }
    const settings = parseSettings(r.settings);
    const date = businessDate(settings.timezone);
    const kotNo = r.kot_seq_date === date ? (r.kot_seq ?? 0) + 1 : 1;
    t.updateRestaurant({ kot_seq: kotNo, kot_seq_date: date }, tx);
    const now = nowStr();
    const kot = { id: newId(), kot_no: kotNo, business_date: date, source, created_by: ctx.userId, created_at: now, printed_at: null };
    const items = lines.map((l, i) => {
      const m = menu[i];
      const kitchen = m.send_to_kitchen ? 1 : 0;
      return {
        id: newId(), kot_id: kot.id, menu_item_id: m.id, name: m.name, price: m.price, qty: l.qty, note: l.note ?? '', kitchen,
        status: kitchen ? 'queued' : 'ready', cancel_reason: '', created_by: ctx.userId, created_at: now,
        ready_at: kitchen ? null : now, ready_by: null, served_at: null, served_by: null, cancelled_by: null,
      };
    });
    t.update('orders', orderId, {
      status: 'open', server_id: o.server_id ?? (ctx.role === 'server' ? ctx.userId : null),
      items: [...o.items, ...items], kots: [...o.kots, kot],
      item_ids: [...o.item_ids, ...items.map((i) => i.id)], kot_ids: [...o.kot_ids, kot.id],
    }, tx);
    t.audit(ctx.userId, 'kot.create', 'kot', kot.id, { orderId, kotNo, items: lines.length, source }, tx);
    return { kotId: kot.id, settings };
  });

  changed(ctx, orderId);
  ctx.rt.emit(t.rid, 'kot:new', { kotId, orderId });
  if (settings.businessMode !== 'counter') await alertRoles(ctx, ['chef'], orderId, 'kot', (w) => `New KOT · ${w} · ${lines.reduce((s, l) => s + l.qty, 0)} items${source === 'qr' ? ' (from guest phone)' : ''}`);
  // A network KOT printer is reached through the counter PC (desktop app print station).
  if (settings.kotPrinter?.host && settings.businessMode !== 'counter') {
    const ticket = await kotTicket(t, kotId);
    if (ticket.items.length) {
      await queuePrint(ctx, 'kot', settings.kotPrinter, kotEscPos(ticket, settings.paperWidth === '58' ? 32 : 48), `KOT #${ticket.kotNo} ${ticket.where}`, { kotId, orderId });
    }
  }
  return orderDetail(t, orderId, ctx.perms);
}

/** Put a print job where the desktop app's print station will pick it up. */
export async function queuePrint(ctx: { t: Tenant; userId: number | null; rt: Realtime }, target: 'kot' | 'bill',
  printer: { host: string; port: number }, data: Uint8Array, label: string, meta: Row = {}) {
  const row = await ctx.t.insert('print_jobs', {
    target, host: printer.host, port: printer.port, data: toBase64(data), label, meta, status: 'queued',
    created_by: ctx.userId, created_at: nowStr(), claimed_at: null, done_at: null, error: '',
  });
  ctx.rt.emit(ctx.t.rid, 'print:new', { id: row.id });
  return row.id;
}

async function findOrderBy(t: Tenant, field: 'item_ids' | 'kot_ids', id: number): Promise<Row> {
  // Kitchen and serving work on running orders, which this device already holds in memory.
  const live = (await liveOrders(t)).find((o) => (o[field] as number[]).includes(id));
  const rows = live ? [live] : await t.list('orders', [field, 'array-contains', id]);
  if (!rows.length) throw notFound(field === 'item_ids' ? 'Item not found' : 'KOT not found');
  return rows[0];
}

export async function kotTicket(t: Tenant, kotId: number): Promise<KotTicket & { orderId: number }> {
  const o = await withLabels(t, await findOrderBy(t, 'kot_ids', kotId));
  const k = (o.kots as Row[]).find((x) => x.id === kotId)!;
  const items = (o.items as Row[]).filter((i) => i.kot_id === kotId && i.kitchen && i.status !== 'cancelled')
    .map((i) => ({ name: i.name, qty: i.qty, note: i.note }));
  const settings = await settingsOf(t);
  return {
    orderId: o.id, restaurant: (await t.restaurant()).name, kotNo: k.kot_no, where: orderWhere(o),
    createdAt: fmtDateTime(settings.timezone, k.created_at), by: (await t.userName(k.created_by)) ?? (k.source === 'qr' ? 'QR' : ''), items,
  };
}

export async function markKotPrinted(t: Tenant, kotId: number) {
  const pre = await findOrderBy(t, 'kot_ids', kotId);
  await t.tx(async (tx) => {
    const o = await loadOrder(t, pre.id, tx);
    t.update('orders', o.id, { kots: (o.kots as Row[]).map((k) => (k.id === kotId ? { ...k, printed_at: k.printed_at ?? nowStr() } : k)) }, tx);
  });
}

const TRANSITIONS: Record<string, string[]> = {
  queued: ['cooking', 'ready'],
  cooking: ['ready', 'queued'],
  ready: ['served', 'cooking'],
  served: [],
  cancelled: [],
};

function applyItemStatus(ctx: Ctx, item: Row, status: string): Row {
  if (!TRANSITIONS[item.status]?.includes(status)) {
    throw conflict(`Can't move "${item.name}" from ${item.status} to ${status}`);
  }
  need(ctx, status === 'served' ? 'order.serve' : 'kitchen.update');
  const now = nowStr();
  if (status === 'ready') return { ...item, status, ready_at: now, ready_by: ctx.userId };
  if (status === 'served') return { ...item, status, served_at: now, served_by: ctx.userId };
  return { ...item, status };
}

/** Change several items of one order in a transaction. */
async function updateItems(ctx: Ctx, orderId: number, fn: (o: Row) => Row[] | null, orderPatch: (o: Row) => Row = () => ({})) {
  return ctx.t.tx(async (tx) => {
    const o = await loadOrder(ctx.t, orderId, tx);
    const items = fn(o);
    if (items) ctx.t.update('orders', orderId, { items, ...orderPatch(o) }, tx);
    return o;
  });
}

async function notifyReady(ctx: Ctx, orderId: number, names: string[]) {
  if (!names.length) return;
  const o = await withLabels(ctx.t, await loadOrder(ctx.t, orderId));
  const payload = { kind: 'ready', orderId, where: orderWhere(o), message: `${orderWhere(o)}: ${names.join(', ')} ready to serve` };
  if (o.server_id) ctx.rt.emitToUser(ctx.t.rid, o.server_id, 'notify', payload);
  else ctx.rt.emitToRoles(ctx.t.rid, ['server'], 'notify', payload);
  ctx.rt.emitToRoles(ctx.t.rid, ['cashier', 'manager', 'owner', 'trustee'], 'notify', payload);
}

export async function setItemStatus(ctx: Ctx, itemId: number, status: string) {
  const { t } = ctx;
  const pre = await findOrderBy(t, 'item_ids', itemId);
  if (status === 'served') await assertOrderAccess(ctx, pre);
  let item: Row | undefined;
  const o = await updateItems(ctx, pre.id, (o) => {
    if (!['open', 'dining_done'].includes(o.status)) throw conflict('This order is already closed');
    item = (o.items as Row[]).find((i) => i.id === itemId);
    if (!item) throw notFound('Item not found');
    const next = applyItemStatus(ctx, item, status);
    return (o.items as Row[]).map((i) => (i.id === itemId ? next : i));
  });
  if (status === 'ready') await notifyReady(ctx, o.id, [`${item!.qty} x ${item!.name}`]);
  changed(ctx, o.id, ['kitchen:changed']);
  return orderDetail(t, o.id, ctx.perms);
}

/** Bump every eligible item of a KOT at once (kitchen "All ready"). */
export async function setKotStatus(ctx: Ctx, kotId: number, status: 'cooking' | 'ready') {
  need(ctx, 'kitchen.update');
  const pre = await findOrderBy(ctx.t, 'kot_ids', kotId);
  let moved: Row[] = [];
  await updateItems(ctx, pre.id, (o) => {
    moved = (o.items as Row[]).filter((i) => i.kot_id === kotId && i.kitchen && KITCHEN_PENDING.includes(i.status) && i.status !== status
      && TRANSITIONS[i.status].includes(status));
    if (!moved.length) return null;
    const ids = new Set(moved.map((i) => i.id));
    return (o.items as Row[]).map((i) => (ids.has(i.id) ? applyItemStatus(ctx, i, status) : i));
  });
  if (status === 'ready') await notifyReady(ctx, pre.id, moved.map((i) => `${i.qty} x ${i.name}`));
  changed(ctx, pre.id, ['kitchen:changed']);
  return { updated: moved.length };
}

export async function serveAllReady(ctx: Ctx, orderId: number) {
  need(ctx, 'order.serve');
  const o = await loadOrder(ctx.t, orderId);
  await assertOrderAccess(ctx, o);
  await updateItems(ctx, orderId, (o) => (o.items as Row[]).map((i) => (i.status === 'ready' ? applyItemStatus(ctx, i, 'served') : i)));
  changed(ctx, orderId);
  return orderDetail(ctx.t, orderId, ctx.perms);
}

export async function cancelItem(ctx: Ctx, itemId: number, reason: string) {
  const { t } = ctx;
  const pre = await findOrderBy(t, 'item_ids', itemId);
  await assertOrderAccess(ctx, pre);
  let cancelled: Row | null = null;
  await t.tx(async (tx) => {
    const o = await loadOrder(t, pre.id, tx);
    if (o.status === 'billed') throw conflict('Bill is already generated. Reopen the table first.');
    if (!['open', 'dining_done'].includes(o.status)) throw conflict('This order is already closed');
    const item = (o.items as Row[]).find((i) => i.id === itemId)!;
    if (item.status === 'cancelled') return;
    need(ctx, item.status === 'queued' ? 'order.cancelQueuedItem' : 'order.cancelAnyItem');
    if (!reason.trim()) throw badRequest('Give a reason for cancelling');
    cancelled = item;
    t.update('orders', o.id, {
      items: (o.items as Row[]).map((i) => (i.id === itemId ? { ...i, status: 'cancelled', cancel_reason: reason, cancelled_by: ctx.userId, cancelled_at: nowStr() } : i)),
    }, tx);
    t.audit(ctx.userId, 'item.cancel', 'order_item', itemId, { orderId: o.id, name: item.name, qty: item.qty, was: item.status, reason }, tx);
  });
  if (cancelled) changed(ctx, pre.id, ['kitchen:changed']);
  return orderDetail(t, pre.id, ctx.perms);
}

/** Server taps "Dining complete": food part is over, table waits for the bill. */
export async function completeDining(ctx: Ctx, orderId: number, force = false) {
  need(ctx, 'order.complete');
  const { t } = ctx;
  const pre = await loadOrder(t, orderId);
  await assertOrderAccess(ctx, pre);
  if (pre.status === 'dining_done') return orderDetail(t, orderId, ctx.perms);
  await t.tx(async (tx) => {
    const o = await loadOrder(t, orderId, tx);
    if (o.status !== 'open') throw conflict('This order is not running');
    const items = liveItemsOf(o);
    if (!items.length) throw conflict('Nothing was ordered. Cancel the order instead.');
    if (!force && items.some((i) => KITCHEN_PENDING.includes(i.status))) throw conflict('Some items are still being prepared in the kitchen');
    const now = nowStr();
    t.update('orders', orderId, {
      status: 'dining_done', dining_done_at: now,
      items: (o.items as Row[]).map((i) => (i.status === 'ready' ? { ...i, status: 'served', served_at: now, served_by: ctx.userId } : i)),
    }, tx);
    t.audit(ctx.userId, 'order.dining_done', 'order', orderId, {}, tx);
  });
  changed(ctx, orderId);
  await alertRoles(ctx, ['cashier'], orderId, 'bill', (w) => `${w} finished eating. Ready for the bill.`);
  return orderDetail(t, orderId, ctx.perms);
}

/** Cashier "Close table": freezes the order and issues the bill number. */
export async function generateBill(ctx: Ctx, orderId: number, discount: Discount, force = false) {
  need(ctx, 'bill.generate');
  if (discount && discount.value > 0) need(ctx, 'bill.discount');
  const { t } = ctx;
  await t.tx(async (tx) => {
    const o = await loadOrder(t, orderId, tx);
    if (!LIVE_STATUSES.includes(o.status)) throw conflict('This order is already closed');
    const r = await t.restaurant(tx);
    assertSubscribed(r);
    const existing = o.bill_id ? await t.find('bills', o.bill_id, tx) : undefined;
    const table = o.table_id ? await t.find('tables', o.table_id, tx) : undefined;
    const items = liveItemsOf(o);
    if (!items.length) throw conflict('Nothing to bill');
    if (!force && items.some((i) => KITCHEN_PENDING.includes(i.status))) throw conflict('Some items are still being prepared in the kitchen');
    const settings = parseSettings(r.settings);
    const totals = calculateBill(items, settings, discount);
    const breakdown = JSON.stringify({ lines: totals.lines, taxes: totals.taxes, taxMode: settings.taxMode, discountInput: discount ?? null });
    const now = nowStr();
    const amounts = {
      subtotal: totals.subtotal, discount: totals.discount, service_charge: totals.serviceCharge, tax_total: totals.taxTotal,
      round_off: totals.roundOff, grand_total: totals.grandTotal, total_qty: totals.totalQty, breakdown, cashier_id: ctx.userId, updated_at: now,
    };
    let billId: number;
    if (existing && existing.status === 'unpaid') {
      billId = existing.id;
      t.update('bills', existing.id, amounts, tx);
      t.audit(ctx.userId, 'bill.regenerate', 'bill', existing.id, { billNo: existing.bill_no, grandTotal: totals.grandTotal }, tx);
    } else {
      const billNo = (r.bill_seq ?? 0) + 1;
      t.updateRestaurant({ bill_seq: billNo }, tx);
      const bill = t.newDoc('bills', {
        ...amounts, order_id: orderId, bill_no: billNo, business_date: businessDate(settings.timezone), status: 'unpaid',
        created_at: now, paid_at: null, void_reason: '', payments: [],
        order_type: o.order_type, order_no: o.order_no, table_label: table?.label ?? null, server_id: o.server_id,
        customer_name: o.customer_name, customer_phone: o.customer_phone,
      }, tx);
      billId = bill.id;
      t.audit(ctx.userId, 'bill.generate', 'bill', bill.id, { billNo, grandTotal: totals.grandTotal }, tx);
    }
    t.update('orders', orderId, {
      status: 'billed', bill_id: billId, dining_done_at: o.dining_done_at ?? now,
      items: (o.items as Row[]).map((i) => (['ready', 'queued', 'cooking'].includes(i.status) ? { ...i, status: 'served', served_at: now, served_by: ctx.userId } : i)),
    }, tx);
  });
  changed(ctx, orderId, ['kitchen:changed', 'bills:changed']);
  await alertRoles(ctx, ['cashier'], orderId, 'bill', (w) => `Bill ready for ${w}. Collect payment.`, true);
  return orderDetail(t, orderId, ctx.perms);
}

/** Counter / food-stall billing: a parcel order with the items, billed and (optionally) paid at once. */
export async function quickBill(ctx: Ctx, input: {
  items: KotLine[]; method: PaymentInput['method'] | null; customerName?: string; customerPhone?: string; discount?: Discount;
}) {
  const quick = { ...ctx, perms: new Set([...ctx.perms, 'order.create', 'order.kot'] as Permission[]) };
  need(ctx, 'bill.generate');
  if (input.method) need(ctx, 'bill.pay');
  if (input.discount && input.discount.value > 0) need(ctx, 'bill.discount');
  const order = await createOrder(quick, { type: 'takeaway', customerName: input.customerName, customerPhone: input.customerPhone });
  await addKot(quick, order.id, input.items.map((l) => ({ ...l })), 'staff');
  const billed = await generateBill(quick, order.id, input.discount ?? null, true);
  if (!input.method) return billed;
  return payBill(quick, billed.bill!.id, [{ method: input.method, amount: billed.bill!.grand_total }]);
}

export async function reopenOrder(ctx: Ctx, orderId: number) {
  need(ctx, 'bill.reopen');
  const { t } = ctx;
  await t.tx(async (tx) => {
    const o = await loadOrder(t, orderId, tx);
    if (o.status !== 'billed') throw conflict('Only a billed, unpaid table can be reopened');
    t.update('orders', orderId, { status: 'open' }, tx);
    t.audit(ctx.userId, 'order.reopen', 'order', orderId, {}, tx);
  });
  changed(ctx, orderId, ['bills:changed']);
  return orderDetail(t, orderId, ctx.perms);
}

export async function requestCleaning(ctx: Ctx, tableId: number) {
  need(ctx, 'cleaning.request');
  const { t } = ctx;
  const table = await t.must('tables', tableId, 'Table');
  const pending = (await t.list('cleaning_tasks', ['status', '==', 'pending'], ['table_id', '==', table.id]))[0];
  if (pending) return pending;
  const task = await t.tx(async (tx) => {
    const row = t.newDoc('cleaning_tasks', { table_id: table.id, status: 'pending', requested_by: ctx.userId, done_by: null, created_at: nowStr(), done_at: null }, tx);
    t.update('tables', table.id, { needs_cleaning: 1 }, tx);
    return row;
  });
  ctx.rt.emit(t.rid, 'cleaning:changed');
  ctx.rt.emit(t.rid, 'floor:changed');
  ctx.rt.emitToRoles(t.rid, ['cleaner'], 'notify', { kind: 'cleaning', message: `Please clean table ${table.label}` });
  return task;
}

export async function finishCleaning(ctx: Ctx, taskId: number) {
  need(ctx, 'cleaning.done');
  const { t } = ctx;
  const task = await t.tx(async (tx) => {
    const task = await t.must('cleaning_tasks', taskId, 'Cleaning task', tx);
    if (task.status === 'done') return task;
    const done = { ...task, status: 'done', done_by: ctx.userId, done_at: nowStr() };
    t.update('cleaning_tasks', taskId, { status: 'done', done_by: ctx.userId, done_at: done.done_at }, tx);
    t.update('tables', task.table_id, { needs_cleaning: 0 }, tx);
    return done;
  });
  ctx.rt.emit(t.rid, 'cleaning:changed');
  ctx.rt.emit(t.rid, 'floor:changed');
  return task;
}

export type PaymentInput = { method: 'cash' | 'card' | 'upi' | 'other'; amount: number; reference?: string };

/** The order is finished: free its table. */
function releaseTable(t: Tenant, o: Row, table: Row | undefined, tx: Tx) {
  if (table && table.live_order_id === o.id) t.update('tables', table.id, { live_order_id: null }, tx);
}

/** Settlement: money received, bill closed for good. */
export async function payBill(ctx: Ctx, billId: number, payments: PaymentInput[]) {
  need(ctx, 'bill.pay');
  const { t } = ctx;
  const o = await t.tx(async (tx) => {
    const bill = await t.must('bills', billId, 'Bill', tx);
    if (bill.status === 'paid') throw conflict('This bill is already paid');
    if (bill.status === 'void') throw conflict('This bill was voided');
    const o = await loadOrder(t, bill.order_id, tx);
    const table = o.table_id ? await t.find('tables', o.table_id, tx) : undefined;
    if (o.status !== 'billed') throw conflict('The table was reopened. Generate the bill again before taking payment.');
    const sum = payments.reduce((s, p) => s + p.amount, 0);
    if (sum !== bill.grand_total) {
      throw badRequest(`Payments add up to ₹${(sum / 100).toFixed(2)} but the bill is ₹${(bill.grand_total / 100).toFixed(2)}`);
    }
    const now = nowStr();
    t.update('bills', billId, {
      status: 'paid', paid_at: now,
      payments: payments.filter((p) => p.amount > 0).map((p) => ({ method: p.method, amount: p.amount, reference: p.reference ?? '', received_by: ctx.userId, created_at: now })),
    }, tx);
    t.update('orders', o.id, { status: 'paid', closed_at: now }, tx);
    releaseTable(t, o, table, tx);
    t.audit(ctx.userId, 'bill.pay', 'bill', billId, { billNo: bill.bill_no, payments }, tx);
    return o;
  });
  changed(ctx, o.id, ['bills:changed']);
  await alertRoles(ctx, [], o.id, 'paid', (w) => `${w} paid. Thank you!`, true);
  const settings = await settingsOf(t);
  if (o.order_type === 'dine_in' && o.table_id && settings.autoCleaning) {
    await requestCleaning({ ...ctx, perms: ALL_PERMS }, o.table_id);
  }
  return orderDetail(t, o.id, ctx.perms);
}

export async function voidBill(ctx: Ctx, billId: number, reason: string) {
  need(ctx, 'bill.void');
  const { t } = ctx;
  if (!reason.trim()) throw badRequest('Give a reason for voiding');
  const orderId = await t.tx(async (tx) => {
    const bill = await t.must('bills', billId, 'Bill', tx);
    if (bill.status === 'void') throw conflict('Already void');
    const o = await loadOrder(t, bill.order_id, tx);
    const table = o.table_id ? await t.find('tables', o.table_id, tx) : undefined;
    const now = nowStr();
    t.update('bills', billId, { status: 'void', void_reason: reason, updated_at: now }, tx);
    t.update('orders', o.id, { status: 'cancelled', closed_at: now }, tx);
    releaseTable(t, o, table, tx);
    t.audit(ctx.userId, 'bill.void', 'bill', billId, { billNo: bill.bill_no, grandTotal: bill.grand_total, wasPaid: bill.status === 'paid', reason }, tx);
    return o.id;
  });
  changed(ctx, orderId, ['bills:changed', 'kitchen:changed']);
  return orderDetail(t, orderId, ctx.perms);
}

export async function cancelOrder(ctx: Ctx, orderId: number, reason: string) {
  const { t } = ctx;
  const pre = await loadOrder(t, orderId);
  await assertOrderAccess(ctx, pre);
  await t.tx(async (tx) => {
    const o = await loadOrder(t, orderId, tx);
    if (!LIVE_STATUSES.includes(o.status)) throw conflict('This order is already closed');
    const bill = o.bill_id ? await t.find('bills', o.bill_id, tx) : undefined;
    const table = o.table_id ? await t.find('tables', o.table_id, tx) : undefined;
    const items = liveItemsOf(o);
    // Anyone who can open a table can undo an empty one; otherwise managers only.
    need(ctx, items.length ? 'order.cancel' : 'order.create');
    if (items.length && !reason.trim()) throw badRequest('Give a reason for cancelling');
    const now = nowStr();
    t.update('orders', orderId, {
      status: 'cancelled', closed_at: now,
      items: (o.items as Row[]).map((i) => (i.status === 'cancelled' ? i : { ...i, status: 'cancelled', cancel_reason: reason || 'order cancelled', cancelled_by: ctx.userId, cancelled_at: now })),
    }, tx);
    if (bill && bill.status === 'unpaid') t.update('bills', bill.id, { status: 'void', void_reason: reason || 'order cancelled', updated_at: now }, tx);
    releaseTable(t, o, table, tx);
    t.audit(ctx.userId, 'order.cancel', 'order', orderId, { reason, items: items.length }, tx);
  });
  changed(ctx, orderId, ['kitchen:changed', 'bills:changed']);
  return orderDetail(t, orderId, ctx.perms);
}

export async function moveOrder(ctx: Ctx, orderId: number, tableId: number) {
  need(ctx, 'order.move');
  const { t } = ctx;
  const pre = await loadOrder(t, orderId);
  await assertOrderAccess(ctx, pre);
  await t.tx(async (tx) => {
    const o = await loadOrder(t, orderId, tx);
    if (o.order_type !== 'dine_in' || !LIVE_STATUSES.includes(o.status)) throw conflict('Only running dine-in orders can be moved');
    const target = await t.must('tables', tableId, 'Table', tx);
    const from = o.table_id ? await t.find('tables', o.table_id, tx) : undefined;
    if (target.live_order_id && target.live_order_id !== o.id) {
      const busy = await t.find('orders', target.live_order_id, tx);
      if (busy && LIVE_STATUSES.includes(busy.status)) throw conflict(`Table ${target.label} is busy`);
    }
    t.update('orders', orderId, { table_id: target.id }, tx);
    t.update('tables', target.id, { live_order_id: o.id }, tx);
    if (from && from.id !== target.id) releaseTable(t, o, from, tx);
    t.audit(ctx.userId, 'order.move', 'order', orderId, { from: from?.label, to: target.label }, tx);
  });
  changed(ctx, orderId);
  return orderDetail(t, orderId, ctx.perms);
}

export async function liveOrders(t: Tenant): Promise<Row[]> {
  return (await t.list('orders', ['status', 'in', LIVE_STATUSES])).sort(by('id'));
}

/** Live table grid for the floor view. */
export async function floor(t: Tenant) {
  const [sections, tables, orders, bills] = await Promise.all([
    t.list('sections'), t.list('tables', ['active', '==', 1]), liveOrders(t), t.list('bills', ['status', '==', 'unpaid']),
  ]);
  const tableLabel = new Map(tables.map((x) => [x.id, x.label]));
  const unpaid = new Map(bills.map((b) => [b.order_id, b]));
  const rows = await Promise.all(orders.map(async (o) => {
    const items = o.items as Row[];
    const live = items.filter((i) => i.status !== 'cancelled');
    const b = unpaid.get(o.id);
    return {
      id: o.id, order_no: o.order_no, order_type: o.order_type, table_id: o.table_id, status: o.status, opened_at: o.opened_at,
      server_id: o.server_id, customer_name: o.customer_name, customer_phone: o.customer_phone, guests: o.guests,
      server_name: await t.userName(o.server_id), table_label: o.table_id ? tableLabel.get(o.table_id) ?? null : null,
      amount: live.reduce((s, i) => s + i.price * i.qty, 0),
      in_kitchen: items.filter((i) => KITCHEN_PENDING.includes(i.status)).length,
      ready: items.filter((i) => i.status === 'ready').length,
      item_count: items.length,
      bill_total: b?.grand_total ?? null, bill_no: b?.bill_no ?? null,
    };
  }));
  const byTable = new Map(rows.filter((o) => o.table_id).map((o) => [o.table_id, o]));
  const stateOf = (o: Row | undefined, needsCleaning: number) => {
    if (!o) return needsCleaning ? 'cleaning' : 'free';
    if (o.status === 'billed') return 'billed';
    if (o.status === 'dining_done') return 'dining_done';
    if (o.in_kitchen > 0) return 'cooking';
    if (o.ready > 0) return 'ready';
    return o.item_count ? 'running' : 'seated';
  };
  return {
    sections: sections.sort(by('sort', 'id')).map((s) => ({ id: s.id, name: s.name, sort: s.sort })),
    tables: tables.sort(by('sort', 'id')).map((tb) => {
      const o = byTable.get(tb.id);
      return {
        id: tb.id, section_id: tb.section_id, label: tb.label, seats: tb.seats, needs_cleaning: tb.needs_cleaning ?? 0, sort: tb.sort,
        state: stateOf(o, tb.needs_cleaning ?? 0), order: o ?? null,
      };
    }),
    others: rows.filter((o) => !o.table_id).map((o) => ({ ...o, where: orderWhere(o), state: stateOf(o, 0) })),
  };
}

/** "98xxxxxx21" style: enough to recognise, not enough to copy. */
export function maskPhone(phone: string): string {
  const d = (phone ?? '').replace(/\D/g, '');
  if (d.length < 6) return d ? '•'.repeat(d.length) : '';
  return d.slice(0, 2) + '•'.repeat(d.length - 4) + d.slice(-2);
}
