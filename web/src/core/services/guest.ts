import { doc, setDoc } from 'firebase/firestore';
import { DB, Row, all, by, newId, nowStr, one, q } from '../db.js';
import { Tenant } from '../tenant.js';
import { conflict, notFound, badRequest } from '../errors.js';
import { Ctx, addKot, createOrder, settingsOf, LIVE_STATUSES } from './orders.js';
import { parseSettings } from '../settings.js';

/*
 * Guests are not signed in. They can read:
 *   qr_tokens/{token}                 → { rid, table_id, label }
 *   restaurants/{rid}/public/profile  → name, address, phone, ordering on/off, tax note
 *   restaurants/{rid}/menu_categories, menu_items
 * and create a pending guest_requests document. Everything else needs a staff login.
 */

/** Keep the public profile in step with the restaurant settings. */
export async function publishProfile(db: DB, rid: number, rest: Row) {
  const s = parseSettings(rest.settings);
  await setDoc(doc(db, `restaurants/${rid}/public/profile`), {
    name: rest.name, address: rest.address ?? '', phone: rest.phone ?? '', active: rest.active ?? 1, qrOrdering: s.qrOrdering,
    taxNote: s.taxMode === 'exclusive' && s.taxes.length ? `+ ${s.taxes.map((x) => `${x.name} ${x.rate}%`).join(' + ')}` : '',
  });
}

export async function resolveQr(db: DB, token: string) {
  const link = await one(doc(db, `qr_tokens/${token}`));
  if (!link) throw notFound('This QR code is not valid');
  const profile = await one(doc(db, `restaurants/${link.rid}/public/profile`));
  if (!profile || !profile.active) throw notFound('This QR code is not valid');
  return { link, profile };
}

export async function publicMenu(db: DB, token: string) {
  const { link, profile } = await resolveQr(db, token);
  const [categories, items] = await Promise.all([
    all(q(db, `restaurants/${link.rid}/menu_categories`, ['active', '==', 1])),
    all(q(db, `restaurants/${link.rid}/menu_items`, ['active', '==', 1])),
  ]);
  return {
    restaurant: { name: profile.name, address: profile.address, phone: profile.phone },
    table: { label: link.label },
    qrOrdering: profile.qrOrdering,
    taxNote: profile.taxNote,
    categories: categories.sort(by('sort', 'id')).map((c) => ({ id: c.id, name: c.name })),
    items: items.sort(by('sort', 'id')).map((m) => ({
      id: m.id, category_id: m.category_id, name: m.name, description: m.description, price: m.price, is_veg: m.is_veg, is_special: m.is_special, available: m.available,
    })),
  };
}

export async function createGuestRequest(db: DB, token: string, body: { kind: string; items?: { menuItemId: number; qty: number; note?: string }[]; note?: string }) {
  const { link, profile } = await resolveQr(db, token);
  if (body.kind === 'order') {
    if (!profile.qrOrdering) throw conflict('Ordering from the table is turned off. Please call a server.');
    if (!body.items?.length) throw badRequest('Your cart is empty');
    for (const it of body.items) {
      const m = await one(doc(db, `restaurants/${link.rid}/menu_items/${it.menuItemId}`));
      if (!m || !m.active || !m.available) throw conflict('Some items are no longer available, please refresh');
    }
  }
  const id = newId();
  // Staff screens listen to pending requests directly, so no extra signal is needed.
  await setDoc(doc(db, `restaurants/${link.rid}/guest_requests/${id}`), {
    id, restaurant_id: link.rid, token, table_id: link.table_id, table_label: link.label, kind: body.kind,
    payload: JSON.stringify({ items: body.items ?? [], note: body.note ?? '' }),
    status: 'pending', handled_by: null, order_id: null, created_at: nowStr(), handled_at: null,
  });
  return { id, status: 'pending' };
}

export async function listGuestRequests(t: Tenant, status = 'pending') {
  const [rows, tables, menuRows] = await Promise.all([t.list('guest_requests', ['status', '==', status]), t.list('tables'), t.list('menu_items')]);
  const label = new Map(tables.map((x) => [x.id, x.label]));
  const menu = new Map(menuRows.map((m) => [m.id, m]));
  return Promise.all(rows.sort(by((g: Row) => -g.id)).slice(0, 200).map(async (g) => {
    const payload = JSON.parse(g.payload);
    return {
      ...g, table_label: label.get(g.table_id) ?? '?', handled_by_name: await t.userName(g.handled_by), payload,
      items: (payload.items ?? []).map((i: any) => ({ ...i, name: menu.get(i.menuItemId)?.name ?? '?', price: menu.get(i.menuItemId)?.price ?? 0 })),
    };
  }));
}

export async function handleGuestRequest(ctx: Ctx, id: number, accept: boolean) {
  const { t } = ctx;
  // Claim the request first so two staff can't both accept it.
  const g = await t.tx(async (tx) => {
    const g = await t.must('guest_requests', id, 'Request', tx);
    if (g.status !== 'pending') throw conflict('Someone already handled this request');
    t.update('guest_requests', id, { status: accept ? 'accepted' : 'rejected', handled_by: ctx.userId, handled_at: nowStr() }, tx);
    return g;
  });
  let orderId: number | null = null;
  if (accept && g.kind === 'order') {
    const payload = JSON.parse(g.payload);
    const table = await t.find('tables', g.table_id);
    const live = table?.live_order_id ? await t.find('orders', table.live_order_id) : null;
    orderId = live && LIVE_STATUSES.includes(live.status) ? live.id : (await createOrder(ctx, { type: 'dine_in', tableId: g.table_id })).id;
    await addKot(ctx, orderId!, payload.items, 'qr');
    await t.update('guest_requests', id, { order_id: orderId });
  }
  ctx.rt.emit(t.rid, 'guest:request', { id });
  return { id, status: accept ? 'accepted' : 'rejected', orderId };
}

export { settingsOf };
