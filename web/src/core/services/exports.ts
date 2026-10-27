import { Tenant } from '../tenant.js';
import { salesSummary, itemSales, staffPerformance, cancelledItems, toCsv } from './reports.js';
import { settingsOf } from './orders.js';
import { Row, by } from '../db.js';

export type Period = 'day' | 'week' | 'month' | 'custom';

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The date range a period covers, ending on `anchor` (a business date). */
export function periodRange(period: Exclude<Period, 'custom'>, anchor: string): [string, string] {
  if (period === 'day') return [anchor, anchor];
  if (period === 'week') return [addDays(anchor, -6), anchor];
  return [anchor.slice(0, 8) + '01', anchor];
}

export function lastDayOfMonth(iso: string): string {
  const d = new Date(iso.slice(0, 8) + '01T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

/** Everything one report contains, gathered once and rendered to any format. */
export async function reportBundle(t: Tenant, from: string, to: string) {
  const [r, settings, summary, items, staff, cancelled, rawBills, users] = await Promise.all([
    t.restaurant(), settingsOf(t), salesSummary(t, from, to), itemSales(t, from, to), staffPerformance(t, from, to),
    cancelledItems(t, from, to), t.list('bills', ['business_date', '>=', from], ['business_date', '<=', to]), t.userMap(),
  ]);
  const bills = rawBills.sort(by('bill_no')).map((b) => ({
    bill_no: b.bill_no, business_date: b.business_date, order_type: b.order_type, table_label: b.table_label, subtotal: b.subtotal,
    discount: b.discount, service_charge: b.service_charge, tax_total: b.tax_total, round_off: b.round_off, grand_total: b.grand_total,
    status: b.status, void_reason: b.void_reason, cashier: users.get(b.cashier_id)?.name ?? null,
    payments: (b.payments as Row[]).map((p) => `${p.method} ${p.amount / 100}`).join(', ') || null,
  }));
  const taxes = new Map<string, number>();
  for (const b of rawBills.filter((x) => x.status === 'paid')) {
    try {
      for (const tx of JSON.parse(b.breakdown).taxes ?? []) {
        const k = `${tx.name} ${tx.rate}%`;
        taxes.set(k, (taxes.get(k) ?? 0) + tx.amount);
      }
    } catch { /* old rows without breakdown */ }
  }
  return {
    restaurant: { name: r.name, address: r.address, phone: r.phone, gstin: r.gstin, code: r.code as string },
    settings, from, to, summary, items, staff, cancelled, bills,
    taxes: [...taxes].map(([name, amount]) => ({ name, amount })),
  };
}
export type Bundle = Awaited<ReturnType<typeof reportBundle>>;

const rs = (p: number | null | undefined) => ((p ?? 0) / 100);
const money = (p: number | null | undefined) => `Rs ${rs(p).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ORDER_TYPE: Record<string, string> = { dine_in: 'Dine in', takeaway: 'Parcel', delivery: 'Delivery' };

export function rangeLabel(from: string, to: string) {
  const f = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return from === to ? f(from) : `${f(from)} – ${f(to)}`;
}

export function headline(b: Bundle) {
  const t = b.summary.totals;
  return {
    netSales: t.grand_total, bills: t.bills, avgBill: t.bills ? Math.round(t.grand_total / t.bills) : 0,
    items: t.items, tax: t.tax, discount: t.discount,
    voided: b.summary.voided.bills, unpaid: b.summary.unpaid.bills,
    byMethod: b.summary.byMethod.map((m: any) => ({ method: m.method, amount: m.amount })),
    topItems: b.items.slice(0, 5).map((i: any) => ({ name: i.name, qty: i.qty })),
  };
}

// ---------- Excel ----------
export async function toXlsx(b: Bundle): Promise<Blob> {
  // Loaded only when someone downloads Excel, so the app stays small.
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'YorMenu';
  wb.created = new Date();
  const bold = { bold: true } as const;
  const head = (ws: import('exceljs').Worksheet) => {
    ws.getRow(1).font = bold;
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1EDE6' } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  };
  const rsFmt = '#,##0.00';

  const s = wb.addWorksheet('Summary');
  s.columns = [{ header: b.restaurant.name, key: 'k', width: 32 }, { header: rangeLabel(b.from, b.to), key: 'v', width: 22 }];
  head(s);
  const t = b.summary.totals;
  const rows: [string, number | string][] = [
    ['Net sales (Rs)', rs(t.grand_total)], ['Bills', t.bills], ['Average bill (Rs)', rs(t.bills ? t.grand_total / t.bills : 0)],
    ['Items sold', t.items], ['Sub total (Rs)', rs(t.subtotal)], ['Discounts (Rs)', rs(t.discount)],
    ['Service charge (Rs)', rs(t.service_charge)], ['Tax collected (Rs)', rs(t.tax)], ['Round off (Rs)', rs(t.round_off)],
    ['Unpaid bills', `${b.summary.unpaid.bills} (Rs ${rs(b.summary.unpaid.amount)})`],
    ['Voided bills', `${b.summary.voided.bills} (Rs ${rs(b.summary.voided.amount)})`],
  ];
  rows.forEach((r) => s.addRow(r));
  s.addRow([]);
  s.addRow(['Payment method', 'Amount (Rs)']).font = bold;
  b.summary.byMethod.forEach((m: any) => s.addRow([m.method.toUpperCase(), rs(m.amount)]));
  s.addRow([]);
  s.addRow(['Order type', 'Amount (Rs)']).font = bold;
  b.summary.byType.forEach((m: any) => s.addRow([`${ORDER_TYPE[m.order_type] ?? m.order_type} (${m.bills} bills)`, rs(m.amount)]));
  if (b.taxes.length) {
    s.addRow([]);
    s.addRow(['Tax', 'Amount (Rs)']).font = bold;
    b.taxes.forEach((x) => s.addRow([x.name, rs(x.amount)]));
  }
  s.getColumn('v').numFmt = rsFmt;

  const d = wb.addWorksheet('Day by day');
  d.columns = [{ header: 'Date', key: 'day', width: 14 }, { header: 'Bills', key: 'bills', width: 8 }, { header: 'Sales (Rs)', key: 'amount', width: 16, style: { numFmt: rsFmt } }];
  head(d);
  b.summary.byDay.forEach((x: any) => d.addRow({ day: x.day, bills: x.bills, amount: rs(x.amount) }));

  const bl = wb.addWorksheet('Bills');
  bl.columns = [
    { header: 'Bill no', key: 'no', width: 10 }, { header: 'Date', key: 'date', width: 12 }, { header: 'Type', key: 'type', width: 10 },
    { header: 'Table', key: 'table', width: 10 }, { header: 'Sub total', key: 'sub', width: 12 }, { header: 'Discount', key: 'disc', width: 10 },
    { header: 'Service', key: 'svc', width: 10 }, { header: 'Tax', key: 'tax', width: 10 }, { header: 'Round off', key: 'ro', width: 10 },
    { header: 'Total', key: 'total', width: 12 }, { header: 'Status', key: 'status', width: 9 }, { header: 'Payments', key: 'pay', width: 26 },
    { header: 'Cashier', key: 'cashier', width: 14 }, { header: 'Void reason', key: 'vr', width: 24 },
  ];
  head(bl);
  for (const x of b.bills) {
    bl.addRow({
      no: `${b.settings.billPrefix}${x.bill_no}`, date: x.business_date, type: ORDER_TYPE[x.order_type] ?? x.order_type, table: x.table_label ?? '',
      sub: rs(x.subtotal), disc: rs(x.discount), svc: rs(x.service_charge), tax: rs(x.tax_total), ro: rs(x.round_off), total: rs(x.grand_total),
      status: x.status, pay: x.payments ?? '', cashier: x.cashier ?? '', vr: x.void_reason ?? '',
    });
  }
  ['sub', 'disc', 'svc', 'tax', 'ro', 'total'].forEach((k) => { bl.getColumn(k).numFmt = rsFmt; });

  const it = wb.addWorksheet('Items sold');
  it.columns = [{ header: '#', key: 'i', width: 5 }, { header: 'Item', key: 'name', width: 32 }, { header: 'Qty', key: 'qty', width: 8 },
    { header: 'Orders', key: 'orders', width: 8 }, { header: 'Amount (Rs)', key: 'amount', width: 14, style: { numFmt: rsFmt } }];
  head(it);
  b.items.forEach((x: any, i: number) => it.addRow({ i: i + 1, name: x.name, qty: x.qty, orders: x.orders, amount: rs(x.amount) }));

  const st = wb.addWorksheet('Staff');
  st.columns = [
    { header: 'Name', key: 'name', width: 20 }, { header: 'Role', key: 'role', width: 12 }, { header: 'Tables served', key: 'orders', width: 13 },
    { header: 'Sales (Rs)', key: 'sales', width: 13, style: { numFmt: rsFmt } }, { header: 'KOTs', key: 'kots', width: 7 },
    { header: 'Items served', key: 'served', width: 12 }, { header: 'Items cooked', key: 'cooked', width: 12 }, { header: 'Avg cook min', key: 'avg', width: 12 },
    { header: 'Bills settled', key: 'bills', width: 12 }, { header: 'Collected (Rs)', key: 'coll', width: 14, style: { numFmt: rsFmt } },
    { header: 'Tables cleaned', key: 'clean', width: 13 },
  ];
  head(st);
  b.staff.forEach((u: any) => st.addRow({
    name: u.name, role: u.role, orders: u.orders, sales: rs(u.sales), kots: u.kots, served: u.itemsServed, cooked: u.itemsCooked,
    avg: u.avgCookMinutes ?? '', bills: u.billsSettled, coll: rs(u.amountCollected), clean: u.tablesCleaned,
  }));

  const c = wb.addWorksheet('Cancellations');
  c.columns = [{ header: 'Item', key: 'name', width: 28 }, { header: 'Qty', key: 'qty', width: 6 }, { header: 'Value (Rs)', key: 'v', width: 12, style: { numFmt: rsFmt } },
    { header: 'Reason', key: 'reason', width: 30 }, { header: 'By', key: 'by', width: 16 }, { header: 'When (UTC)', key: 'at', width: 20 }];
  head(c);
  b.cancelled.forEach((x: any) => c.addRow({ name: x.name, qty: x.qty, v: rs(x.price * x.qty), reason: x.cancel_reason, by: x.cancelled_by ?? '', at: x.created_at }));

  return new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function toCsvBundle(b: Bundle): string {
  return toCsv(b.bills.map((x: any) => ({
    bill_no: `${b.settings.billPrefix}${x.bill_no}`, date: x.business_date, type: x.order_type, table: x.table_label ?? '',
    subtotal: rs(x.subtotal), discount: rs(x.discount), service_charge: rs(x.service_charge), tax: rs(x.tax_total),
    round_off: rs(x.round_off), total: rs(x.grand_total), status: x.status, payments: x.payments ?? '', cashier: x.cashier ?? '',
  })));
}

/** A short WhatsApp-friendly summary for the owner. */
export function summaryText(b: Bundle): string {
  const h = headline(b);
  const out = [
    `*${b.restaurant.name}*`, `Report: ${rangeLabel(b.from, b.to)}`, '',
    `💰 Net sales: *${money(h.netSales)}*`, `🧾 Bills: ${h.bills} (avg ${money(h.avgBill)})`, `🍽️ Items sold: ${h.items}`,
  ];
  if (h.byMethod.length) out.push('', ...h.byMethod.map((m) => `• ${m.method.toUpperCase()}: ${money(m.amount)}`));
  if (h.tax) out.push(`GST collected: ${money(h.tax)}`);
  if (h.discount) out.push(`Discounts: ${money(h.discount)}`);
  if (h.voided || h.unpaid) out.push('', `⚠️ Voided: ${h.voided} · Unpaid: ${h.unpaid}`);
  if (h.topItems.length) out.push('', 'Top items:', ...h.topItems.map((i, n) => `${n + 1}. ${i.name} × ${i.qty}`));
  return out.join('\n');
}
