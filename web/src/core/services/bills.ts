import { Tenant } from '../tenant.js';
import { notFound } from '../errors.js';
import { BillTicket } from '../printing.js';
import { fmtDateTime } from '../time.js';
import { orderWhere, settingsOf } from './orders.js';

export async function billTicket(t: Tenant, billId: number): Promise<BillTicket & { customerPhone: string; status: string }> {
  const b = await t.find('bills', billId);
  if (!b) throw notFound('Bill not found');
  const r = await t.restaurant();
  const s = await settingsOf(t);
  const bd = JSON.parse(b.breakdown);
  const where = b.order_type === 'dine_in' ? `Dine In: ${b.table_label}` : orderWhere({ order_type: b.order_type, id: b.order_id, order_no: b.order_no });
  return {
    restaurant: r.name, address: r.address, phone: r.phone, gstin: r.gstin,
    billNo: `${s.billPrefix}${b.bill_no}`, date: fmtDateTime(s.timezone, b.created_at), where,
    cashier: (await t.userName(b.cashier_id)) ?? '', customer: b.customer_name, customerPhone: b.customer_phone, status: b.status,
    lines: bd.lines, totalQty: b.total_qty, subtotal: b.subtotal, discount: b.discount, serviceCharge: b.service_charge,
    taxes: bd.taxes ?? [], roundOff: b.round_off, grandTotal: b.grand_total, footer: s.billFooter,
    ...gstDoc(s.gstType, !!r.gstin, (bd.taxes ?? []).length > 0),
  };
}

const rs = (p: number) => (p / 100).toFixed(2);

/** Heading and note the GST rules ask for on a restaurant bill. */
export function gstDoc(type: string, hasGstin: boolean, hasTax: boolean): { docTitle: string; taxNote: string } {
  if (type === 'composition') return { docTitle: 'BILL OF SUPPLY', taxNote: 'Composition taxable person, not eligible to collect tax on supplies' };
  if (type === 'unregistered' || !hasGstin) return { docTitle: '', taxNote: '' };
  if (hasTax) return { docTitle: 'TAX INVOICE', taxNote: 'SAC 996331 · Restaurant service' };
  return { docTitle: '', taxNote: '' };
}

export function billText(b: BillTicket): string {
  const out = [`*${b.restaurant}*`];
  if (b.address) out.push(b.address);
  if (b.phone) out.push(`Ph: ${b.phone}`);
  if (b.gstin) out.push(`GSTIN: ${b.gstin}`);
  if (b.docTitle) out.push(`*${b.docTitle}*`);
  out.push('', `Bill No: ${b.billNo}`, `Date: ${b.date}`, b.where, `Cashier: ${b.cashier}`, '------------------------------');
  for (const l of b.lines) out.push(`${l.name}\n  ${l.qty} x ${rs(l.price)} = ${rs(l.amount)}`);
  out.push('------------------------------', `Total Qty: ${b.totalQty}`, `Sub Total: ${rs(b.subtotal)}`);
  if (b.discount) out.push(`Discount: -${rs(b.discount)}`);
  if (b.serviceCharge) out.push(`Service charge: ${rs(b.serviceCharge)}`);
  for (const tx of b.taxes) out.push(`${tx.name} ${tx.rate}%: ${rs(tx.amount)}`);
  if (b.roundOff) out.push(`Round off: ${rs(b.roundOff)}`);
  out.push(`*Grand Total: ₹${rs(b.grandTotal)}*`);
  if (b.taxNote) out.push(b.taxNote);
  out.push('', b.footer);
  return out.join('\n');
}

export function normalisePhone(phone: string, countryCode: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return countryCode + digits;
  if (digits.length > 10 && digits.length <= 15) return digits;
  return null;
}
