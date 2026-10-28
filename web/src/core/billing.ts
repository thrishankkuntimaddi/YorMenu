import type { Settings } from './settings.js';

export type BillLine = { name: string; price: number; qty: number; amount: number };
export type TaxLine = { name: string; rate: number; amount: number };
export type BillTotals = {
  lines: BillLine[];
  totalQty: number;
  subtotal: number;
  discount: number;
  serviceCharge: number;
  taxes: TaxLine[];
  taxTotal: number;
  roundOff: number;
  grandTotal: number;
};

export type Discount = { type: 'amount' | 'percent'; value: number } | null | undefined;

/** All amounts are integer paise. Lines with same name and price are merged. */
export function calculateBill(
  items: { name: string; price: number; qty: number; status?: string }[],
  settings: Pick<Settings, 'taxMode' | 'taxes' | 'serviceChargePct' | 'roundOff'>,
  discount?: Discount,
): BillTotals {
  const merged = new Map<string, BillLine>();
  for (const it of items) {
    if (it.status === 'cancelled') continue;
    const key = `${it.name}\u0000${it.price}`;
    const line = merged.get(key) ?? { name: it.name, price: it.price, qty: 0, amount: 0 };
    line.qty += it.qty;
    line.amount = line.qty * line.price;
    merged.set(key, line);
  }
  const lines = [...merged.values()];
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const totalQty = lines.reduce((s, l) => s + l.qty, 0);

  let disc = 0;
  if (discount && discount.value > 0) {
    disc = discount.type === 'percent' ? Math.round((subtotal * Math.min(discount.value, 100)) / 100) : Math.round(discount.value);
  }
  disc = Math.min(disc, subtotal);
  const afterDiscount = subtotal - disc;

  const rates = settings.taxMode === 'none' ? [] : settings.taxes;
  const rateSum = rates.reduce((s, t) => s + t.rate, 0);
  let taxable = afterDiscount;
  if (settings.taxMode === 'inclusive' && rateSum > 0) taxable = Math.round((afterDiscount * 100) / (100 + rateSum));

  const taxes = rates.map((t) => ({ name: t.name, rate: t.rate, amount: Math.round((taxable * t.rate) / 100) }));
  let taxTotal = taxes.reduce((s, t) => s + t.amount, 0);
  if (settings.taxMode === 'inclusive') {
    // Make the parts add up exactly to the inclusive amount.
    const drift = afterDiscount - taxable - taxTotal;
    if (taxes.length && drift !== 0) { taxes[taxes.length - 1].amount += drift; taxTotal += drift; }
  }
  const serviceCharge = Math.round((taxable * settings.serviceChargePct) / 100);
  // Under GST a service charge is part of the value of the supply, so it is taxed at the same rates.
  if (serviceCharge > 0) {
    for (const t of taxes) {
      const extra = Math.round((serviceCharge * t.rate) / 100);
      t.amount += extra;
      taxTotal += extra;
    }
  }
  const serviceTax = serviceCharge > 0 ? taxes.reduce((s, t) => s + Math.round((serviceCharge * t.rate) / 100), 0) : 0;

  const exact = settings.taxMode === 'inclusive' ? afterDiscount + serviceCharge + serviceTax : taxable + taxTotal + serviceCharge;
  const grandTotal = settings.roundOff ? Math.round(exact / 100) * 100 : exact;
  return { lines, totalQty, subtotal, discount: disc, serviceCharge, taxes, taxTotal, roundOff: grandTotal - exact, grandTotal };
}
