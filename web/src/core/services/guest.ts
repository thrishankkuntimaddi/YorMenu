import { doc, setDoc } from 'firebase/firestore';
import { DB, Row, all, by, newId, nowStr, one, q } from '../db.js';
import { Tenant } from '../tenant.js';
import { conflict, notFound, badRequest } from '../errors.js';
import { Ctx, addKot, createOrder, settingsOf, liveOrders, maskPhone, LIVE_STATUSES } from './orders.js';
import { GUEST_KEY_RE, setGuestLive, syncGuestOrder } from '../guestLive.js';
import { arrayUnion } from 'firebase/firestore';
import { parseSettings } from '../settings.js';

/*
 * Guests are not signed in. They can read:
 *   qr_tokens/{token}                 → { rid, table_id, label }
 *   restaurants/{rid}/public/profile  → name, address, phone, ordering on/off, tax note
 *   restaurants/{rid}/menu_categories, menu_items
 *   guest_live/{key}                  → their own table's live order, once staff approved their phone
 * and create a pending guest_requests document. Everything else needs a staff login.
 *
 * Safety: scanning a QR code only shows the menu. To order, the guest sends a "join"
 * request with name + mobile and a secret key made on their phone; staff approve that
 * phone for the table. Orders are accepted only from approved phones, and still need
 * a staff member to send them to the kitchen.
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
    rid: link.rid,
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

export type GuestRequestBody = {
  kind: string; items?: { menuItemId: number; qty: number; note?: string }[]; note?: string;
  key?: string; name?: string; phone?: string;
};

export async function createGuestRequest(db: DB, token: string, body: GuestRequestBody) {
  const { link, profile } = await resolveQr(db, token);
  if (body.kind !== 'call_waiter' && !(body.key && GUEST_KEY_RE.test(body.key))) throw badRequest('Please start again from the QR code');
  if (body.kind === 'join') {
    if (!profile.qrOrdering) throw conflict('Ordering from the table is turned off. Please call a server.');
    if (!body.name?.trim()) throw badRequest('Enter your name');
    if (!/^\d{10}$/.test(body.phone ?? '')) throw badRequest('Enter your 10-digit mobile number');
  }
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
    payload: JSON.stringify({ items: body.items ?? [], note: body.note ?? '', key: body.key ?? '', name: body.name?.trim() ?? '', phone: body.phone ?? '' }),
    status: 'pending', handled_by: null, order_id: null, created_at: nowStr(), handled_at: null,
  });
  return { id, status: 'pending' };
}

/** The running order a guest phone is approved for (found by its key, so it follows table moves). */
function orderOfKey(orders: Row[], key: string | undefined) {
  return key ? orders.find((o) => (o.guest_keys ?? []).includes(key)) : undefined;
}

export async function listGuestRequests(t: Tenant, status = 'pending', canSeePhone = true) {
  const [rows, tables, menuRows, live] = await Promise.all([
    t.list('guest_requests', ['status', '==', status]), t.list('tables'), t.list('menu_items'), liveOrders(t),
  ]);
  const label = new Map(tables.map((x) => [x.id, x.label]));
  const menu = new Map(menuRows.map((m) => [m.id, m]));
  const liveByTable = new Map(live.filter((o) => o.table_id).map((o) => [o.table_id, o]));
  const phone = (p: string) => (canSeePhone ? p : maskPhone(p));
  return Promise.all(rows.sort(by((g: Row) => -g.id)).slice(0, 200).map(async (g) => {
    const payload = JSON.parse(g.payload);
    const linked = orderOfKey(live, payload.key);
    const atTable = liveByTable.get(g.table_id);
    const { key: _key, ...shown } = payload;
    return {
      ...g, table_label: label.get(g.table_id) ?? '?', handled_by_name: await t.userName(g.handled_by),
      payload: { ...shown, phone: shown.phone ? phone(shown.phone) : '' },
      // Is this phone approved, and who already orders from this table?
      verified: !!linked,
      order_table_label: linked?.table_id ? label.get(linked.table_id) ?? null : null,
      table_phones: (atTable?.guest_names ?? []).map((x: Row) => ({ name: x.name, phone: phone(x.phone) })),
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
  const payload = JSON.parse(g.payload);
  const key: string | undefined = payload.key || undefined;
  let orderId: number | null = null;
  try {
    if (accept && g.kind === 'join') {
      orderId = await approvePhone(ctx, g.table_id, key!, payload.name, payload.phone);
    } else if (accept && g.kind === 'order') {
      const o = orderOfKey(await liveOrders(t), key);
      if (!o) throw conflict('This phone is not approved for any table. Dismiss it, or approve the phone first.');
      orderId = o.id;
      await addKot(ctx, o.id, payload.items, 'qr');
    } else if (accept && g.kind === 'request_bill') {
      orderId = orderOfKey(await liveOrders(t), key)?.id ?? null;
    }
  } catch (e) {
    // Could not carry it out: put the request back so it is not lost.
    await t.update('guest_requests', id, { status: 'pending', handled_by: null, handled_at: null });
    throw e;
  }
  if (orderId) await t.update('guest_requests', id, { order_id: orderId });
  if (key) {
    if (g.kind === 'join' && !accept) await setGuestLive(t.db, key, t.rid, { status: 'denied' });
    await setGuestLive(t.db, key, t.rid, { requests: { [`r${id}`]: accept ? 'accepted' : 'rejected' } }).catch(() => {});
  }
  ctx.rt.emit(t.rid, 'guest:request', { id });
  return { id, status: accept ? 'accepted' : 'rejected', orderId };
}

/** Let a guest's phone order for a table: links it to the running order (opening one if the table is free). */
async function approvePhone(ctx: Ctx, tableId: number, key: string, name: string, phone: string) {
  const { t } = ctx;
  if (!key || !GUEST_KEY_RE.test(key)) throw badRequest('This request is broken; ask the guest to scan again');
  const table = await t.must('tables', tableId, 'Table');
  const live = table.live_order_id ? await t.find('orders', table.live_order_id) : null;
  const orderId = live && LIVE_STATUSES.includes(live.status) ? live.id
    : (await createOrder(ctx, { type: 'dine_in', tableId, customerName: name, customerPhone: phone })).id;
  const o = await t.must('orders', orderId, 'Order');
  const patch: Row = {
    guest_keys: arrayUnion(key),
    guest_names: arrayUnion({ name, phone }),
  };
  if (!o.customer_name && name) patch.customer_name = name;
  if (!o.customer_phone && phone) patch.customer_phone = phone;
  await t.update('orders', orderId, patch);
  await t.audit(ctx.userId, 'guest.approve', 'order', orderId, { table: table.label, name });
  ctx.rt.emit(t.rid, 'order:changed', { orderId });
  ctx.rt.emit(t.rid, 'floor:changed');
  return orderId;
}

/** Staff stop phone ordering for an order (e.g. the wrong person joined). */
export async function removeGuestPhones(ctx: Ctx, orderId: number) {
  const { t } = ctx;
  const o = await t.must('orders', orderId, 'Order');
  const keys: string[] = o.guest_keys ?? [];
  await t.update('orders', orderId, { guest_keys: [], guest_names: [] });
  await Promise.all(keys.map((k) => setGuestLive(t.db, k, t.rid, { status: 'ended' })));
  await t.audit(ctx.userId, 'guest.remove', 'order', orderId, { phones: keys.length });
  ctx.rt.emit(t.rid, 'order:changed', { orderId });
  return { ok: true };
}

export { syncGuestOrder };
export { settingsOf };
