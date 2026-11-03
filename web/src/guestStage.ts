import { rupees } from './format';
import type { SceneKind } from './scenes';

/** Written by staff devices: this phone's table, once a staff member approved it. */
export type Live = {
  status?: 'active' | 'denied' | 'ended' | 'closed';
  order_status?: string;
  table_label?: string | null;
  items?: { name: string; qty: number; price: number; status: string }[];
  subtotal?: number;
  bill?: { bill_no: number; grand_total: number; status: string } | null;
  requests?: Record<string, 'accepted' | 'rejected'>;
};
export type Sent = { id: number; kind: string; text: string; at: number };

/** Which picture to show the guest right now, from the most to the least important moment. */
export function stageOf(live: Live | null, waiting: boolean, sent: Sent[]): { kind: SceneKind; title: string; text: string } | null {
  if (waiting) return { kind: 'waiting', title: 'Waiting for the staff to confirm your table…', text: 'This keeps strangers from ordering on your table. You can choose items meanwhile.' };
  if (!live || (live.status !== 'active' && live.status !== 'closed')) return null;
  const bill = live.bill;
  if (bill?.status === 'paid' || live.order_status === 'paid') return { kind: 'thanks', title: 'Thank you for visiting!', text: 'It was a pleasure serving you. See you again soon.' };
  if (live.status === 'closed') return null;
  if (bill) return { kind: 'bill-ready', title: `Your bill is ready · ${rupees(bill.grand_total)}`, text: `Bill no. ${bill.bill_no}. You can pay at the table or the counter.` };
  const state = (s: Sent) => live.requests?.[`r${s.id}`];
  const askedBill = sent.filter((s) => s.kind === 'request_bill' && state(s) !== 'rejected');
  if (askedBill.length) return askedBill.some((s) => state(s) === 'accepted')
    ? { kind: 'bill', title: 'A server is bringing your bill', text: 'It will be with you in a moment.' }
    : { kind: 'bill', title: 'Asking a server for your bill…', text: 'We let the staff know.' };
  if (sent.some((s) => s.kind === 'order' && !state(s))) return { kind: 'waiting', title: 'Waiting for a server to approve your order…', text: 'Once approved, it goes straight to the kitchen.' };
  const qty = (st: string) => (live.items ?? []).filter((i) => i.status === st).reduce((n, i) => n + i.qty, 0);
  if (qty('cooking')) return { kind: 'cooking', title: 'Your food is cooking', text: `${qty('cooking')} item${qty('cooking') > 1 ? 's' : ''} on the stove${qty('queued') ? `, ${qty('queued')} more next` : ''}.` };
  if (qty('queued')) return { kind: 'preparing', title: 'The kitchen is preparing your order', text: `${qty('queued')} item${qty('queued') > 1 ? 's' : ''} getting ready to cook.` };
  if (qty('ready')) return { kind: 'serving', title: 'Your food is on its way!', text: 'A server is bringing it to your table.' };
  return null;
}
