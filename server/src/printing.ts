import net from 'node:net';

/** Minimal ESC/POS encoder for 80mm (48 col) / 58mm (32 col) thermal printers. */
const ESC = 0x1b, GS = 0x1d;
export class EscPos {
  private parts: Buffer[] = [Buffer.from([ESC, 0x40])];
  constructor(public cols = 48) {}
  text(s: string) { this.parts.push(Buffer.from(s.normalize('NFKD').replace(/[^\x20-\x7e\n]/g, ''), 'ascii')); return this; }
  line(s = '') { return this.text(s + '\n'); }
  align(a: 'left' | 'center' | 'right') { this.parts.push(Buffer.from([ESC, 0x61, { left: 0, center: 1, right: 2 }[a]])); return this; }
  bold(on: boolean) { this.parts.push(Buffer.from([ESC, 0x45, on ? 1 : 0])); return this; }
  size(w: 1 | 2, h: 1 | 2) { this.parts.push(Buffer.from([GS, 0x21, ((w - 1) << 4) | (h - 1)])); return this; }
  rule(ch = '-') { return this.line(ch.repeat(this.cols)); }
  cols2(left: string, right: string) {
    const space = Math.max(1, this.cols - left.length - right.length);
    return this.line(left + ' '.repeat(space) + right);
  }
  cut() { this.parts.push(Buffer.from('\n\n\n'), Buffer.from([GS, 0x56, 0x42, 0x00])); return this; }
  build() { return Buffer.concat(this.parts); }
}

export function sendToPrinter(host: string, port: number, data: Buffer, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port });
    sock.setTimeout(timeoutMs);
    sock.on('connect', () => sock.end(data));
    sock.on('close', (hadError) => (hadError ? null : resolve()));
    sock.on('timeout', () => { sock.destroy(); reject(new Error('Printer timeout')); });
    sock.on('error', reject);
  });
}

export type KotTicket = {
  restaurant: string; kotNo: number; where: string; createdAt: string; by: string;
  items: { name: string; qty: number; note: string }[];
};

export function kotEscPos(k: KotTicket, cols = 48): Buffer {
  const p = new EscPos(cols).align('center').bold(true).line(k.restaurant).size(2, 2).line(`KOT #${k.kotNo}`).size(1, 1)
    .size(2, 1).line(k.where).size(1, 1).bold(false).line(`${k.createdAt}  by ${k.by}`).align('left').rule();
  for (const it of k.items) {
    p.bold(true).size(1, 2).cols2(it.name.slice(0, cols - 6), `x${it.qty}`).size(1, 1).bold(false);
    if (it.note) p.line(`  > ${it.note}`);
  }
  return p.rule().cut().build();
}

export type BillTicket = {
  restaurant: string; address: string; phone: string; gstin: string;
  billNo: string; date: string; where: string; cashier: string; customer: string;
  lines: { name: string; qty: number; price: number; amount: number }[];
  totalQty: number; subtotal: number; discount: number; serviceCharge: number;
  taxes: { name: string; rate: number; amount: number }[]; roundOff: number; grandTotal: number; footer: string;
};

const rs = (paise: number) => (paise / 100).toFixed(2);

export function billEscPos(b: BillTicket, cols = 48): Buffer {
  const p = new EscPos(cols).align('center').bold(true).size(1, 2).line(b.restaurant).size(1, 1).bold(false);
  if (b.address) p.line(b.address);
  if (b.phone) p.line(`Ph: ${b.phone}`);
  if (b.gstin) p.line(`GSTIN: ${b.gstin}`);
  p.align('left').rule();
  if (b.customer) p.line(`Name: ${b.customer}`);
  p.cols2(`Date: ${b.date}`, b.where).cols2(`Cashier: ${b.cashier}`, `Bill No: ${b.billNo}`).rule();
  const nameW = cols - 24;
  p.line('Item'.padEnd(nameW) + 'Qty'.padStart(4) + 'Price'.padStart(10) + 'Amt'.padStart(10)).rule();
  for (const l of b.lines) {
    p.line(l.name.slice(0, nameW).padEnd(nameW) + String(l.qty).padStart(4) + rs(l.price).padStart(10) + rs(l.amount).padStart(10));
  }
  p.rule().cols2(`Total Qty: ${b.totalQty}`, `Sub Total ${rs(b.subtotal)}`);
  if (b.discount) p.cols2('Discount', `-${rs(b.discount)}`);
  if (b.serviceCharge) p.cols2('Service charge', rs(b.serviceCharge));
  for (const t of b.taxes) p.cols2(`${t.name} ${t.rate}%`, rs(t.amount));
  if (b.roundOff) p.cols2('Round off', rs(b.roundOff));
  p.rule().bold(true).size(1, 2).cols2('Grand Total', `Rs ${rs(b.grandTotal)}`).size(1, 1).bold(false).rule()
    .align('center').line(b.footer);
  return p.cut().build();
}
