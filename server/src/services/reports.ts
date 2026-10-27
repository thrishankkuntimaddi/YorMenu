import { Tenant } from '../tenant.js';

/** All reports work on paid bills, by business date (inclusive range). */
export function salesSummary(t: Tenant, from: string, to: string) {
  const totals = t.one(
    `SELECT COUNT(*) AS bills, COALESCE(SUM(subtotal),0) AS subtotal, COALESCE(SUM(discount),0) AS discount,
            COALESCE(SUM(service_charge),0) AS service_charge, COALESCE(SUM(tax_total),0) AS tax,
            COALESCE(SUM(round_off),0) AS round_off, COALESCE(SUM(grand_total),0) AS grand_total, COALESCE(SUM(total_qty),0) AS items
     FROM bills WHERE restaurant_id = ? AND status = 'paid' AND business_date BETWEEN ? AND ?`, t.rid, from, to)!;
  const byMethod = t.all(
    `SELECT p.method, COUNT(DISTINCT p.bill_id) AS bills, SUM(p.amount) AS amount FROM payments p JOIN bills b ON b.id = p.bill_id
     WHERE p.restaurant_id = ? AND b.status = 'paid' AND b.business_date BETWEEN ? AND ? GROUP BY p.method ORDER BY amount DESC`, t.rid, from, to);
  const byType = t.all(
    `SELECT o.order_type, COUNT(*) AS bills, SUM(b.grand_total) AS amount FROM bills b JOIN orders o ON o.id = b.order_id
     WHERE b.restaurant_id = ? AND b.status = 'paid' AND b.business_date BETWEEN ? AND ? GROUP BY o.order_type`, t.rid, from, to);
  const byDay = t.all(
    `SELECT business_date AS day, COUNT(*) AS bills, SUM(grand_total) AS amount FROM bills
     WHERE restaurant_id = ? AND status = 'paid' AND business_date BETWEEN ? AND ? GROUP BY business_date ORDER BY business_date`, t.rid, from, to);
  const voided = t.one(
    `SELECT COUNT(*) AS bills, COALESCE(SUM(grand_total),0) AS amount FROM bills
     WHERE restaurant_id = ? AND status = 'void' AND business_date BETWEEN ? AND ?`, t.rid, from, to)!;
  const unpaid = t.one(
    `SELECT COUNT(*) AS bills, COALESCE(SUM(grand_total),0) AS amount FROM bills
     WHERE restaurant_id = ? AND status = 'unpaid' AND business_date BETWEEN ? AND ?`, t.rid, from, to)!;
  return { from, to, totals, byMethod, byType, byDay, voided, unpaid };
}

export function itemSales(t: Tenant, from: string, to: string) {
  return t.all(
    `SELECT oi.name, SUM(oi.qty) AS qty, SUM(oi.qty * oi.price) AS amount, COUNT(DISTINCT oi.order_id) AS orders
     FROM order_items oi JOIN bills b ON b.order_id = oi.order_id AND b.status = 'paid'
     WHERE oi.restaurant_id = ? AND oi.status != 'cancelled' AND b.business_date BETWEEN ? AND ?
     GROUP BY oi.name ORDER BY qty DESC, amount DESC`, t.rid, from, to);
}

export function cancelledItems(t: Tenant, from: string, to: string) {
  return t.all(
    `SELECT oi.name, oi.qty, oi.price, oi.cancel_reason, oi.created_at, u.name AS cancelled_by FROM order_items oi
     LEFT JOIN users u ON u.id = oi.cancelled_by
     WHERE oi.restaurant_id = ? AND oi.status = 'cancelled' AND date(oi.created_at) BETWEEN ? AND ? ORDER BY oi.id DESC LIMIT 500`, t.rid, from, to);
}

/** Who did how much: tables served, KOTs sent, items cooked, bills settled, tables cleaned. */
export function staffPerformance(t: Tenant, from: string, to: string) {
  const users = t.all('SELECT id, name, role, active FROM users WHERE restaurant_id = ? ORDER BY role, name', t.rid);
  const map = (rows: any[]) => new Map(rows.map((r) => [r.uid, r]));
  const served = map(t.all(
    `SELECT o.server_id AS uid, COUNT(*) AS orders, SUM(b.grand_total) AS sales FROM orders o JOIN bills b ON b.order_id = o.id AND b.status = 'paid'
     WHERE o.restaurant_id = ? AND b.business_date BETWEEN ? AND ? AND o.server_id IS NOT NULL GROUP BY o.server_id`, t.rid, from, to));
  const kots = map(t.all(
    `SELECT created_by AS uid, COUNT(*) AS kots FROM kots WHERE restaurant_id = ? AND business_date BETWEEN ? AND ? GROUP BY created_by`, t.rid, from, to));
  const cooked = map(t.all(
    `SELECT ready_by AS uid, SUM(qty) AS items,
            CAST(AVG((julianday(ready_at) - julianday(created_at)) * 1440) AS INTEGER) AS avg_minutes
     FROM order_items WHERE restaurant_id = ? AND kitchen = 1 AND ready_by IS NOT NULL AND date(ready_at) BETWEEN ? AND ? GROUP BY ready_by`, t.rid, from, to));
  const itemsServed = map(t.all(
    `SELECT served_by AS uid, SUM(qty) AS items FROM order_items WHERE restaurant_id = ? AND served_by IS NOT NULL AND date(served_at) BETWEEN ? AND ? GROUP BY served_by`, t.rid, from, to));
  const settled = map(t.all(
    `SELECT p.received_by AS uid, COUNT(DISTINCT p.bill_id) AS bills, SUM(p.amount) AS amount FROM payments p JOIN bills b ON b.id = p.bill_id
     WHERE p.restaurant_id = ? AND b.status = 'paid' AND b.business_date BETWEEN ? AND ? GROUP BY p.received_by`, t.rid, from, to));
  const cleaned = map(t.all(
    `SELECT done_by AS uid, COUNT(*) AS tables FROM cleaning_tasks WHERE restaurant_id = ? AND status = 'done' AND date(done_at) BETWEEN ? AND ? GROUP BY done_by`, t.rid, from, to));
  return users.map((u) => ({
    ...u,
    orders: served.get(u.id)?.orders ?? 0,
    sales: served.get(u.id)?.sales ?? 0,
    kots: kots.get(u.id)?.kots ?? 0,
    itemsServed: itemsServed.get(u.id)?.items ?? 0,
    itemsCooked: cooked.get(u.id)?.items ?? 0,
    avgCookMinutes: cooked.get(u.id)?.avg_minutes ?? null,
    billsSettled: settled.get(u.id)?.bills ?? 0,
    amountCollected: settled.get(u.id)?.amount ?? 0,
    tablesCleaned: cleaned.get(u.id)?.tables ?? 0,
  }));
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
