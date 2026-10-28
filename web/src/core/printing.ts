/** Minimal ESC/POS encoder for 80mm (48 col) / 58mm (32 col) thermal printers. Runs in the browser. */
const ESC = 0x1b, GS = 0x1d;
const ascii = (s: string) => Array.from(s.normalize('NFKD').replace(/[^\x20-\x7e\n]/g, ''), (c) => c.charCodeAt(0));

export class EscPos {
  private bytes: number[] = [ESC, 0x40];
  constructor(public cols = 48) {}
  text(s: string) { this.bytes.push(...ascii(s)); return this; }
  line(s = '') { return this.text(s + '\n'); }
  align(a: 'left' | 'center' | 'right') { this.bytes.push(ESC, 0x61, { left: 0, center: 1, right: 2 }[a]); return this; }
  bold(on: boolean) { this.bytes.push(ESC, 0x45, on ? 1 : 0); return this; }
  size(w: 1 | 2, h: 1 | 2) { this.bytes.push(GS, 0x21, ((w - 1) << 4) | (h - 1)); return this; }
  rule(ch = '-') { return this.line(ch.repeat(this.cols)); }
  /** Left and right text on one line; if they don't fit the paper, the right part goes on its own line. */
  cols2(left: string, right: string, width = this.cols) {
    if (left.length + right.length + 1 > width) {
      for (const part of wrap(left, width)) this.line(part);
      return this.line(' '.repeat(Math.max(0, width - right.length)) + right);
    }
    return this.line(left + ' '.repeat(width - left.length - right.length) + right);
  }
  cut() { this.bytes.push(10, 10, 10, GS, 0x56, 0x42, 0x00); return this; }
  build() { return Uint8Array.from(this.bytes); }
}

/** Break text into lines of at most `width` characters, at spaces where possible. */
export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  let cur = '';
  // Measure what the printer will really get (it only prints plain English letters).
  const plain = text.normalize('NFKD').replace(/[^\x20-\x7e]/g, '');
  for (const word of plain.split(/\s+/).filter(Boolean)) {
    let w = word;
    while (w.length > width) { if (cur) { out.push(cur); cur = ''; } out.push(w.slice(0, width)); w = w.slice(width); }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= width) cur += ' ' + w;
    else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export type KotTicket = {
  restaurant: string; kotNo: number; where: string; createdAt: string; by: string;
  items: { name: string; qty: number; note: string }[];
};

export function kotEscPos(k: KotTicket, cols = 48): Uint8Array {
  const p = new EscPos(cols).align('center').bold(true).line(k.restaurant).size(2, 2).line(`KOT #${k.kotNo}`).size(1, 1)
    .size(2, 1);
  for (const w of wrap(k.where, Math.floor(cols / 2))) p.line(w);
  p.size(1, 1).bold(false);
  for (const w of wrap(`${k.createdAt}  by ${k.by}`, cols)) p.line(w);
  p.align('left').rule();
  for (const it of k.items) {
    // The kitchen must see the whole dish name: long names wrap, the quantity stays on the first line.
    const qty = `x${it.qty}`;
    const [first, ...more] = wrap(it.name, cols - qty.length - 1);
    p.bold(true).size(1, 2).cols2(first, qty);
    for (const m of more) p.line(m);
    p.size(1, 1).bold(false);
    for (const n of it.note ? wrap(`> ${it.note}`, cols - 2) : []) p.line(`  ${n}`);
  }
  return p.rule().cut().build();
}

export type BillTicket = {
  restaurant: string; address: string; phone: string; gstin: string;
  billNo: string; date: string; where: string; cashier: string; customer: string;
  lines: { name: string; qty: number; price: number; amount: number }[];
  totalQty: number; subtotal: number; discount: number; serviceCharge: number;
  taxes: { name: string; rate: number; amount: number }[]; roundOff: number; grandTotal: number; footer: string;
  /** GST heading ("TAX INVOICE" / "BILL OF SUPPLY") and the note under the total. */
  docTitle?: string; taxNote?: string;
};

const rs = (paise: number) => (paise / 100).toFixed(2);

export function billEscPos(b: BillTicket, cols = 48): Uint8Array {
  const p = new EscPos(cols).align('center').bold(true).size(1, 2);
  for (const n of wrap(b.restaurant, cols)) p.line(n);
  p.size(1, 1).bold(false);
  for (const a of b.address ? wrap(b.address, cols) : []) p.line(a);
  if (b.phone) p.line(`Ph: ${b.phone}`);
  if (b.gstin) p.line(`GSTIN: ${b.gstin}`);
  if (b.docTitle) p.bold(true).line(b.docTitle).bold(false);
  p.align('left').rule();
  if (b.customer) p.line(`Name: ${b.customer}`);
  p.cols2(`Date: ${b.date}`, b.where).cols2(`Cashier: ${b.cashier}`, `Bill No: ${b.billNo}`).rule();
  if (cols >= 40) {
    const nameW = cols - 24;
    p.line('Item'.padEnd(nameW) + 'Qty'.padStart(4) + 'Price'.padStart(10) + 'Amt'.padStart(10)).rule();
    for (const l of b.lines) {
      const [first, ...more] = wrap(l.name, nameW);
      p.line(first.padEnd(nameW) + String(l.qty).padStart(4) + rs(l.price).padStart(10) + rs(l.amount).padStart(10));
      for (const m of more) p.line(m);
    }
  } else {
    // 58 mm paper: the dish on one line, "qty x price ... amount" under it.
    for (const l of b.lines) {
      for (const n of wrap(l.name, cols)) p.line(n);
      p.cols2(`  ${l.qty} x ${rs(l.price)}`, rs(l.amount));
    }
  }
  p.rule().cols2(`Total Qty: ${b.totalQty}`, `Sub Total ${rs(b.subtotal)}`);
  if (b.discount) p.cols2('Discount', `-${rs(b.discount)}`);
  if (b.serviceCharge) p.cols2('Service charge', rs(b.serviceCharge));
  for (const t of b.taxes) p.cols2(`${t.name} ${t.rate}%`, rs(t.amount));
  if (b.roundOff) p.cols2('Round off', rs(b.roundOff));
  p.rule().bold(true).size(1, 2).cols2('Grand Total', `Rs ${rs(b.grandTotal)}`).size(1, 1).bold(false).rule()
    .align('center');
  for (const n of b.taxNote ? wrap(b.taxNote, cols) : []) p.line(n);
  for (const n of b.footer ? wrap(b.footer, cols) : []) p.line(n);
  return p.cut().build();
}
