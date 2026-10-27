import { describe, it, expect } from 'vitest';
import { calculateBill } from '../src/core/billing.js';

const gst = { taxMode: 'exclusive' as const, taxes: [{ name: 'CGST', rate: 2.5 }, { name: 'SGST', rate: 2.5 }], serviceChargePct: 0, roundOff: true };

describe('calculateBill', () => {
  it('matches the sample paper bill (no tax)', () => {
    const items = [
      { name: 'Water Bottle', price: 2000, qty: 2 }, { name: 'Paneer Fried Rice', price: 18000, qty: 1 },
      { name: 'Chicken Biryani', price: 25000, qty: 1 }, { name: 'Chicken Dum Biryani', price: 24000, qty: 1 },
      { name: 'Baby Corn Chilli', price: 15000, qty: 1 },
    ];
    const b = calculateBill(items, { ...gst, taxMode: 'none' });
    expect(b.totalQty).toBe(6);
    expect(b.subtotal).toBe(86000);
    expect(b.grandTotal).toBe(86000);
  });

  it('merges repeat items from different KOTs and skips cancelled ones', () => {
    const b = calculateBill([
      { name: 'Butter Naan', price: 5000, qty: 2 }, { name: 'Butter Naan', price: 5000, qty: 3 },
      { name: 'Coke', price: 4000, qty: 1, status: 'cancelled' },
    ], { ...gst, taxMode: 'none' });
    expect(b.lines).toEqual([{ name: 'Butter Naan', price: 5000, qty: 5, amount: 25000 }]);
  });

  it('adds GST on top and rounds to the rupee', () => {
    const b = calculateBill([{ name: 'X', price: 22000, qty: 1 }, { name: 'Y', price: 5000, qty: 3 }], gst, { type: 'percent', value: 10 });
    expect(b.subtotal).toBe(37000);
    expect(b.discount).toBe(3700);
    expect(b.taxes.map((t) => t.amount)).toEqual([833, 833]);
    expect(b.grandTotal).toBe(35000); // 33300 + 1666 = 34966 -> 35000
    expect(b.roundOff).toBe(34);
  });

  it('splits inclusive prices exactly', () => {
    const b = calculateBill([{ name: 'X', price: 10500, qty: 1 }], { ...gst, taxMode: 'inclusive', roundOff: false });
    expect(b.grandTotal).toBe(10500);
    expect(b.taxTotal).toBe(500);
  });
});
