import { DB, one } from '../db.js';
import { Tenant } from '../tenant.js';
import { Realtime } from '../realtime.js';
import { conflict, notFound, badRequest } from '../errors.js';
import { Ctx, addKot, createOrder, settingsOf } from './orders.js';

/** Resolve a table's QR token into its restaurant + table, for public pages. */
export function resolveQr(db: DB, token: string) {
  const table = one(db,
    `SELECT tb.id, tb.label, tb.restaurant_id FROM tables tb JOIN restaurants r ON r.id = tb.restaurant_id
     WHERE tb.qr_token = ? AND tb.active = 1 AND r.active = 1`, token);
  if (!table) throw notFound('This QR code is not valid');
  return { table, t: new Tenant(db, table.restaurant_id) };
}

export function publicMenu(db: DB, token: string) {
  const { table, t } = resolveQr(db, token);
  const r = t.restaurant();
  const s = settingsOf(t);
  const categories = t.all('SELECT id, name FROM menu_categories WHERE restaurant_id = ? AND active = 1 ORDER BY sort, id', t.rid);
  const items = t.all(
    `SELECT id, category_id, name, description, price, is_veg, is_special, available FROM menu_items
     WHERE restaurant_id = ? AND active = 1 ORDER BY sort, id`, t.rid);
  return {
    restaurant: { name: r.name, address: r.address, phone: r.phone },
    table: { label: table.label },
    qrOrdering: s.qrOrdering,
    taxNote: s.taxMode === 'exclusive' && s.taxes.length ? `+ ${s.taxes.map((x) => `${x.name} ${x.rate}%`).join(' + ')}` : '',
    categories,
    items,
  };
}

export function createGuestRequest(db: DB, rt: Realtime, token: string, body: { kind: string; items?: { menuItemId: number; qty: number; note?: string }[]; note?: string }) {
  const { table, t } = resolveQr(db, token);
  const s = settingsOf(t);
  if (body.kind === 'order') {
    if (!s.qrOrdering) throw conflict('Ordering from the table is turned off. Please call a server.');
    if (!body.items?.length) throw badRequest('Your cart is empty');
    for (const it of body.items) {
      const m = t.find('menu_items', it.menuItemId);
      if (!m || !m.active || !m.available) throw conflict('Some items are no longer available, please refresh');
    }
  }
  const recent = t.one(
    `SELECT COUNT(*) AS n FROM guest_requests WHERE restaurant_id = ? AND table_id = ? AND status = 'pending'`, t.rid, table.id)!;
  if (recent.n >= 5) throw conflict('Your earlier requests are still waiting for staff. Please hold on.');
  const r = t.run(
    `INSERT INTO guest_requests (restaurant_id, table_id, kind, payload, status) VALUES (?, ?, ?, ?, 'pending')`,
    t.rid, table.id, body.kind, JSON.stringify({ items: body.items ?? [], note: body.note ?? '' }));
  const label = { order: 'placed an order', call_waiter: 'is calling a server', request_bill: 'asked for the bill' }[body.kind];
  rt.emit(t.rid, 'guest:request', { id: r.id });
  rt.emitToRoles(t.rid, ['server', 'cashier', 'manager', 'owner', 'trustee'], 'notify', { kind: 'guest', message: `Table ${table.label} ${label}` });
  return { id: r.id, status: 'pending' };
}

export function listGuestRequests(t: Tenant, status = 'pending') {
  const rows = t.all(
    `SELECT g.*, tb.label AS table_label, u.name AS handled_by_name FROM guest_requests g
     JOIN tables tb ON tb.id = g.table_id LEFT JOIN users u ON u.id = g.handled_by
     WHERE g.restaurant_id = ? AND g.status = ? ORDER BY g.id DESC LIMIT 200`, t.rid, status);
  const menu = new Map(t.all('SELECT id, name, price FROM menu_items WHERE restaurant_id = ?', t.rid).map((m) => [m.id, m]));
  return rows.map((g) => {
    const payload = JSON.parse(g.payload);
    return {
      ...g,
      payload,
      items: (payload.items ?? []).map((i: any) => ({ ...i, name: menu.get(i.menuItemId)?.name ?? '?', price: menu.get(i.menuItemId)?.price ?? 0 })),
    };
  });
}

export function handleGuestRequest(ctx: Ctx, id: number, accept: boolean) {
  const { t } = ctx;
  const g = t.must('guest_requests', id, 'Request');
  if (g.status !== 'pending') throw conflict('Someone already handled this request');
  let orderId: number | null = null;
  if (accept && g.kind === 'order') {
    const payload = JSON.parse(g.payload);
    const live = t.one(
      `SELECT id FROM orders WHERE restaurant_id = ? AND table_id = ? AND status IN ('open','dining_done','billed')`, t.rid, g.table_id);
    orderId = live?.id ?? createOrder(ctx, { type: 'dine_in', tableId: g.table_id }).id;
    addKot(ctx, orderId!, payload.items, 'qr');
  }
  t.run(`UPDATE guest_requests SET status = ?, handled_by = ?, handled_at = datetime('now'), order_id = ? WHERE id = ? AND restaurant_id = ?`,
    accept ? 'accepted' : 'rejected', ctx.userId, orderId, id, t.rid);
  ctx.rt.emit(t.rid, 'guest:request', { id });
  return { id, status: accept ? 'accepted' : 'rejected', orderId };
}
