import { Tenant } from '../tenant.js';
import { Row, by } from '../db.js';

const inRange = (t: Tenant, c: 'bills' | 'orders', from: string, to: string) =>
  t.list(c, ['business_date', '>=', from], ['business_date', '<=', to]);

const sum = (rows: Row[], f: (r: Row) => number) => rows.reduce((s, r) => s + (f(r) || 0), 0);

function groupBy<T>(rows: T[], key: (r: T) => string | number) {
  const m = new Map<string | number, T[]>();
  for (const r of rows) (m.get(key(r)) ?? m.set(key(r), []).get(key(r))!).push(r);
  return m;
}

/** All money reports work on paid bills, by business date (inclusive range). */
export async function salesSummary(t: Tenant, from: string, to: string) {
  const bills = await inRange(t, 'bills', from, to);
  const paid = bills.filter((b) => b.status === 'paid');
  const totals = {
    bills: paid.length, subtotal: sum(paid, (b) => b.subtotal), discount: sum(paid, (b) => b.discount),
    service_charge: sum(paid, (b) => b.service_charge), tax: sum(paid, (b) => b.tax_total), round_off: sum(paid, (b) => b.round_off),
    grand_total: sum(paid, (b) => b.grand_total), items: sum(paid, (b) => b.total_qty),
  };
  const payments = paid.flatMap((b) => (b.payments as Row[]).map((p) => ({ ...p, bill_id: b.id })));
  const byMethod = [...groupBy(payments, (p) => p.method)].map(([method, ps]) => ({
    method, bills: new Set(ps.map((p) => p.bill_id)).size, amount: sum(ps, (p) => p.amount),
  })).sort(by((r) => -r.amount));
  const byType = [...groupBy(paid, (b) => b.order_type)].map(([order_type, bs]) => ({ order_type, bills: bs.length, amount: sum(bs, (b) => b.grand_total) }));
  const byDay = [...groupBy(paid, (b) => b.business_date)].map(([day, bs]) => ({ day, bills: bs.length, amount: sum(bs, (b) => b.grand_total) }))
    .sort(by('day'));
  const of = (status: string) => {
    const bs = bills.filter((b) => b.status === status);
    return { bills: bs.length, amount: sum(bs, (b) => b.grand_total) };
  };
  return { from, to, totals, byMethod, byType, byDay, voided: of('void'), unpaid: of('unpaid') };
}

export async function itemSales(t: Tenant, from: string, to: string) {
  const paid = (await inRange(t, 'bills', from, to)).filter((b) => b.status === 'paid');
  const m = new Map<string, { name: string; qty: number; amount: number; orders: number }>();
  for (const b of paid) {
    const seen = new Set<string>();
    for (const l of JSON.parse(b.breakdown).lines ?? []) {
      const r = m.get(l.name) ?? { name: l.name, qty: 0, amount: 0, orders: 0 };
      r.qty += l.qty;
      r.amount += l.amount;
      if (!seen.has(l.name)) { r.orders++; seen.add(l.name); }
      m.set(l.name, r);
    }
  }
  return [...m.values()].sort(by((r) => -r.qty, (r) => -r.amount));
}

export async function cancelledItems(t: Tenant, from: string, to: string) {
  const orders = await inRange(t, 'orders', from, to);
  const users = await t.userMap();
  return orders.flatMap((o) => (o.items as Row[]).filter((i) => i.status === 'cancelled').map((i) => ({
    name: i.name, qty: i.qty, price: i.price, cancel_reason: i.cancel_reason, created_at: i.created_at,
    cancelled_by: users.get(i.cancelled_by)?.name ?? null, id: i.id,
  }))).sort(by((r) => -r.id)).slice(0, 500).map(({ id: _id, ...r }) => r);
}

const minutesBetween = (a: string, b: string) => (new Date(b.replace(' ', 'T') + 'Z').getTime() - new Date(a.replace(' ', 'T') + 'Z').getTime()) / 60000;

/** Who did how much: tables served, KOTs sent, items cooked, bills settled, tables cleaned. */
export async function staffPerformance(t: Tenant, from: string, to: string) {
  const [users, bills, orders, cleaning] = await Promise.all([
    t.list('users'), inRange(t, 'bills', from, to), inRange(t, 'orders', from, to), t.list('cleaning_tasks', ['status', '==', 'done']),
  ]);
  const paid = bills.filter((b) => b.status === 'paid');
  const stat = new Map<number, Row>();
  const s = (uid: number | null | undefined) => {
    if (!uid) return null;
    if (!stat.has(uid)) stat.set(uid, { orders: 0, sales: 0, kots: 0, itemsServed: 0, itemsCooked: 0, cookMinutes: [] as number[], billsSettled: 0, amountCollected: 0, tablesCleaned: 0 });
    return stat.get(uid)!;
  };
  for (const b of paid) {
    const x = s(b.server_id);
    if (x) { x.orders++; x.sales += b.grand_total; }
    for (const [uid, ps] of groupBy(b.payments as Row[], (p) => p.received_by)) {
      const y = s(uid as number);
      if (y) { y.billsSettled++; y.amountCollected += sum(ps, (p) => p.amount); }
    }
  }
  for (const o of orders) {
    for (const k of o.kots as Row[]) { const x = s(k.created_by); if (x) x.kots++; }
    for (const i of o.items as Row[]) {
      if (i.kitchen && i.ready_by) {
        const x = s(i.ready_by)!;
        x.itemsCooked += i.qty;
        if (i.ready_at) x.cookMinutes.push(minutesBetween(i.created_at, i.ready_at));
      }
      if (i.served_by) s(i.served_by)!.itemsServed += i.qty;
    }
  }
  for (const c of cleaning) {
    const day = (c.done_at ?? '').slice(0, 10);
    if (day >= from && day <= to) { const x = s(c.done_by); if (x) x.tablesCleaned++; }
  }
  const order = ['owner', 'trustee', 'manager', 'cashier', 'server', 'chef', 'cleaner'];
  return users.sort(by((u) => order.indexOf(u.role), 'name')).map((u) => {
    const x = stat.get(u.id);
    return {
      id: u.id, name: u.name, role: u.role, active: u.active,
      orders: x?.orders ?? 0, sales: x?.sales ?? 0, kots: x?.kots ?? 0, itemsServed: x?.itemsServed ?? 0, itemsCooked: x?.itemsCooked ?? 0,
      avgCookMinutes: x?.cookMinutes.length ? Math.round(x.cookMinutes.reduce((a: number, b: number) => a + b, 0) / x.cookMinutes.length) : null,
      billsSettled: x?.billsSettled ?? 0, amountCollected: x?.amountCollected ?? 0, tablesCleaned: x?.tablesCleaned ?? 0,
    };
  });
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}
