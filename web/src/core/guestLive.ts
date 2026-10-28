import { doc, getDoc, setDoc } from 'firebase/firestore';
import type { DB, Row } from './db';

/*
 * What a guest's phone sees after staff approve it for a table:
 *   guest_live/{key} = { rid, status, table_label, items, bill, requests, ... }
 * `key` is a long random secret made on the guest's phone and given to staff in the
 * "join table" request. The document can be read only by someone who knows the key
 * (no listing), and only staff of that restaurant can write it.
 */

export const GUEST_KEY_RE = /^[A-Za-z0-9]{24,48}$/;
const LIVE = ['open', 'dining_done', 'billed'];

export type GuestStatus = 'active' | 'denied' | 'ended' | 'closed';

/** Set the state of one guest phone (used when staff approve, deny or remove it). */
export async function setGuestLive(db: DB, key: string, rid: number, patch: Row) {
  if (!GUEST_KEY_RE.test(key)) return;
  await setDoc(doc(db, `guest_live/${key}`), { ...patch, rid, updated_at: Date.now() }, { merge: true });
}

/** Copy an order's current state to every guest phone that is linked to it. */
export async function syncGuestOrder(db: DB, rid: number, orderId: number) {
  const snap = await getDoc(doc(db, `restaurants/${rid}/orders/${orderId}`));
  if (!snap.exists()) return;
  const o = snap.data();
  const keys: string[] = o.guest_keys ?? [];
  if (!keys.length) return;
  const [table, bill] = await Promise.all([
    o.table_id ? getDoc(doc(db, `restaurants/${rid}/tables/${o.table_id}`)).then((s) => (s.exists() ? s.data() : null)) : null,
    o.bill_id ? getDoc(doc(db, `restaurants/${rid}/bills/${o.bill_id}`)).then((s) => (s.exists() ? s.data() : null)) : null,
  ]);
  const items = (o.items as Row[]).filter((i) => i.status !== 'cancelled')
    .map((i) => ({ name: i.name, qty: i.qty, price: i.price, status: i.status }));
  const state = {
    status: (LIVE.includes(o.status) ? 'active' : 'closed') as GuestStatus,
    order_status: o.status,
    order_id: o.id,
    table_label: table?.label ?? null,
    items,
    subtotal: items.reduce((s, i) => s + i.price * i.qty, 0),
    bill: bill && bill.status !== 'void' ? { bill_no: bill.bill_no, grand_total: bill.grand_total, status: bill.status } : null,
  };
  await Promise.all(keys.map((k) => setGuestLive(db, k, rid, state)));
}
