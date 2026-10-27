import { Tenant } from '../tenant.js';
import { notFound } from '../errors.js';
import { BillTicket } from '../printing.js';
import { fmtDateTime } from '../time.js';
import { orderWhere, settingsOf } from './orders.js';

export function billTicket(t: Tenant, billId: number): BillTicket & { customerPhone: string; status: string } {
  const b = t.one(
    `SELECT b.*, u.name AS cashier_name, o.order_type, o.customer_name, o.customer_phone, o.id AS oid, tb.label AS table_label
     FROM bills b JOIN orders o ON o.id = b.order_id LEFT JOIN users u ON u.id = b.cashier_id LEFT JOIN tables tb ON tb.id = o.table_id
     WHERE b.id = ? AND b.restaurant_id = ?`, billId, t.rid);
  if (!b) throw notFound('Bill not found');
  const r = t.restaurant();
  const s = settingsOf(t);
  const bd = JSON.parse(b.breakdown);
  const where = b.order_type === 'dine_in' ? `Dine In: ${b.table_label}` : orderWhere({ order_type: b.order_type, id: b.oid });
  return {
    restaurant: r.name, address: r.address, phone: r.phone, gstin: r.gstin,
    billNo: `${s.billPrefix}${b.bill_no}`, date: fmtDateTime(s.timezone, b.created_at), where,
    cashier: b.cashier_name ?? '', customer: b.customer_name, customerPhone: b.customer_phone, status: b.status,
    lines: bd.lines, totalQty: b.total_qty, subtotal: b.subtotal, discount: b.discount, serviceCharge: b.service_charge,
    taxes: bd.taxes ?? [], roundOff: b.round_off, grandTotal: b.grand_total, footer: s.billFooter,
  };
}

const rs = (p: number) => (p / 100).toFixed(2);

export function billText(b: BillTicket): string {
  const out = [`*${b.restaurant}*`];
  if (b.address) out.push(b.address);
  if (b.phone) out.push(`Ph: ${b.phone}`);
  if (b.gstin) out.push(`GSTIN: ${b.gstin}`);
  out.push('', `Bill No: ${b.billNo}`, `Date: ${b.date}`, b.where, `Cashier: ${b.cashier}`, '------------------------------');
  for (const l of b.lines) out.push(`${l.name}\n  ${l.qty} x ${rs(l.price)} = ${rs(l.amount)}`);
  out.push('------------------------------', `Total Qty: ${b.totalQty}`, `Sub Total: ${rs(b.subtotal)}`);
  if (b.discount) out.push(`Discount: -${rs(b.discount)}`);
  if (b.serviceCharge) out.push(`Service charge: ${rs(b.serviceCharge)}`);
  for (const tx of b.taxes) out.push(`${tx.name} ${tx.rate}%: ${rs(tx.amount)}`);
  if (b.roundOff) out.push(`Round off: ${rs(b.roundOff)}`);
  out.push(`*Grand Total: ₹${rs(b.grandTotal)}*`, '', b.footer);
  return out.join('\n');
}

export function normalisePhone(phone: string, countryCode: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return countryCode + digits;
  if (digits.length > 10 && digits.length <= 15) return digits;
  return null;
}
