import type { BillTicket, KotTicket } from './types';

const rs = (p: number) => (p / 100).toFixed(2);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

const BASE_CSS = `
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 4mm 3mm; width: 80mm; font: 12px/1.35 'Courier New', ui-monospace, monospace; color: #000; }
  h1 { font-size: 16px; margin: 0; text-align: center; }
  .c { text-align: center; } .r { text-align: right; } .b { font-weight: 700; }
  .big { font-size: 20px; font-weight: 700; }
  hr { border: 0; border-top: 1px dashed #000; margin: 4px 0; }
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: 1px 0; vertical-align: top; text-align: left; }
  th.r, td.r { text-align: right; }
  .row { display: flex; justify-content: space-between; gap: 8px; }
`;

/** Print HTML through a hidden iframe (works with any USB/Bluetooth thermal printer set as default). */
declare global {
  interface Window { yormenuDesktop?: { isDesktop: true; print: (html: string) => Promise<void>; printRaw?: (host: string, port: number, base64: string) => Promise<void> } }
}

export function printHtml(body: string, css = BASE_CSS): Promise<void> {
  // In the desktop app: print straight to the default printer, no dialog.
  if (window.yormenuDesktop?.print) {
    return window.yormenuDesktop.print(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`);
  }
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument!;
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`);
    doc.close();
    const done = () => { setTimeout(() => iframe.remove(), 500); resolve(); };
    setTimeout(() => {
      iframe.contentWindow!.focus();
      iframe.contentWindow!.addEventListener('afterprint', done, { once: true });
      iframe.contentWindow!.print();
      setTimeout(done, 3000);
    }, 50);
  });
}

export function kotHtml(k: KotTicket): string {
  return `
    <div class="c b">${esc(k.restaurant)}</div>
    <div class="c big">KOT #${k.kotNo}</div>
    <div class="c big">${esc(k.where)}</div>
    <div class="c">${esc(k.createdAt)} · ${esc(k.by)}</div><hr>
    <table>${k.items.map((i) => `
      <tr><td class="b" style="font-size:15px">${esc(i.name)}</td><td class="r b" style="font-size:15px">x${i.qty}</td></tr>
      ${i.note ? `<tr><td colspan="2">&gt; ${esc(i.note)}</td></tr>` : ''}`).join('')}
    </table><hr>`;
}

export function billHtml(b: BillTicket): string {
  return `
    <h1>${esc(b.restaurant)}</h1>
    ${b.address ? `<div class="c">${esc(b.address)}</div>` : ''}
    ${b.phone ? `<div class="c">Ph: ${esc(b.phone)}</div>` : ''}
    ${b.gstin ? `<div class="c">GSTIN: ${esc(b.gstin)}</div>` : ''}
    <hr>
    <div>Name: ${esc(b.customer || '')}</div><hr>
    <div class="row"><span>Date: ${esc(b.date)}</span><span class="b">${esc(b.where)}</span></div>
    <div class="row"><span>Cashier: ${esc(b.cashier)}</span><span>Bill No.: <b>${esc(b.billNo)}</b></span></div>
    <hr>
    <table>
      <tr><th>Item</th><th class="r">Qty.</th><th class="r">Price</th><th class="r">Amount</th></tr>
      <tr><td colspan="4"><hr></td></tr>
      ${b.lines.map((l) => `<tr><td>${esc(l.name)}</td><td class="r">${l.qty}</td><td class="r">${rs(l.price)}</td><td class="r">${rs(l.amount)}</td></tr>`).join('')}
    </table><hr>
    <div class="row"><span>Total Qty: ${b.totalQty}</span><span>Sub Total ${rs(b.subtotal)}</span></div>
    ${b.discount ? `<div class="row"><span>Discount</span><span>-${rs(b.discount)}</span></div>` : ''}
    ${b.serviceCharge ? `<div class="row"><span>Service charge</span><span>${rs(b.serviceCharge)}</span></div>` : ''}
    ${b.taxes.map((t) => `<div class="row"><span>${esc(t.name)} ${t.rate}%</span><span>${rs(t.amount)}</span></div>`).join('')}
    ${b.roundOff ? `<div class="row"><span>Round off</span><span>${rs(b.roundOff)}</span></div>` : ''}
    <hr><div class="row big"><span>Grand Total</span><span>₹${rs(b.grandTotal)}</span></div><hr>
    ${b.status === 'void' ? '<div class="c big">*** VOID ***</div>' : ''}
    <div class="c">${esc(b.footer)}</div>`;
}
