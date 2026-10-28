import type { BillTicket } from './types';

/*
 * The bill as a picture (like a printed thermal receipt), and ways to send it:
 *  - Android app: the phone's share sheet (WhatsApp, a Bluetooth printer app, …)
 *  - phone browsers: the browser's share sheet
 *  - computers: copy the picture and open the customer's WhatsApp chat, so it is one paste away
 */

const rs = (p: number) => (p / 100).toFixed(2);

type Cap = {
  isNativePlatform?: () => boolean;
  nativePromise?: (plugin: string, method: string, options?: object) => Promise<any>;
};
const cap = () => (window as unknown as { Capacitor?: Cap }).Capacitor;
/** Running inside the YorMenu Android app. */
export const inAndroidApp = () => !!cap()?.isNativePlatform?.();

/** Draws the bill on a receipt-shaped picture (576 px = 80 mm thermal paper). */
export async function billImage(b: BillTicket): Promise<Blob> {
  const W = 576, pad = 28, scale = 2;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  type Line = { l?: string; r?: string; c?: string; size?: number; bold?: boolean; rule?: boolean; gap?: number };
  const lines: Line[] = [];
  const push = (x: Line) => lines.push(x);
  push({ c: b.restaurant, size: 30, bold: true });
  if (b.address) push({ c: b.address, size: 18 });
  if (b.phone) push({ c: `Ph: ${b.phone}`, size: 18 });
  if (b.gstin) push({ c: `GSTIN: ${b.gstin}`, size: 18 });
  if (b.docTitle) push({ c: b.docTitle, size: 20, bold: true, gap: 6 });
  push({ rule: true });
  push({ l: `Bill No. ${b.billNo}`, r: b.where, bold: true });
  push({ l: b.date, r: b.cashier ? `Cashier: ${b.cashier}` : '' , size: 18 });
  if (b.customer) push({ l: `Name: ${b.customer}`, size: 18 });
  push({ rule: true });
  for (const x of b.lines) push({ l: `${x.qty} × ${x.name}`, r: rs(x.amount) });
  push({ rule: true });
  push({ l: `Sub total (${b.totalQty} items)`, r: rs(b.subtotal) });
  if (b.discount) push({ l: 'Discount', r: `-${rs(b.discount)}` });
  if (b.serviceCharge) push({ l: 'Service charge', r: rs(b.serviceCharge) });
  for (const t of b.taxes) push({ l: `${t.name} ${t.rate}%`, r: rs(t.amount) });
  if (b.roundOff) push({ l: 'Round off', r: rs(b.roundOff) });
  push({ rule: true });
  push({ l: 'Grand Total', r: `₹${rs(b.grandTotal)}`, size: 30, bold: true });
  push({ rule: true });
  if (b.taxNote) push({ c: b.taxNote, size: 16 });
  if (b.status === 'void') push({ c: '*** VOID ***', size: 28, bold: true });
  if (b.status === 'paid') push({ c: 'PAID · Thank you', size: 20, bold: true });
  if (b.footer) push({ c: b.footer, size: 18, gap: 6 });

  const font = (x: Line) => `${x.bold ? '700' : '400'} ${x.size ?? 22}px ui-monospace, "Courier New", monospace`;
  // Wrap long centred text (addresses) to the paper width.
  const wrapped: Line[] = [];
  for (const x of lines) {
    if (!x.c) { wrapped.push(x); continue; }
    ctx.font = font(x);
    let cur = '';
    for (const w of x.c.split(' ')) {
      const next = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(next).width > W - pad * 2 && cur) { wrapped.push({ ...x, c: cur }); cur = w; } else cur = next;
    }
    wrapped.push({ ...x, c: cur });
  }
  const height = wrapped.reduce((h, x) => h + (x.rule ? 18 : (x.size ?? 22) * 1.45 + (x.gap ?? 0)), pad * 2);
  canvas.width = W * scale;
  canvas.height = Math.ceil(height) * scale;
  ctx.scale(scale, scale);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, height);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';
  let y = pad;
  for (const x of wrapped) {
    if (x.rule) {
      ctx.setLineDash([6, 5]); ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(pad, y + 8); ctx.lineTo(W - pad, y + 8); ctx.stroke();
      y += 18; continue;
    }
    y += x.gap ?? 0;
    ctx.font = font(x);
    if (x.c) { ctx.textAlign = 'center'; ctx.fillText(x.c, W / 2, y); }
    if (x.l) {
      ctx.textAlign = 'left';
      const maxL = W - pad * 2 - (x.r ? ctx.measureText(x.r).width + 16 : 0);
      let text = x.l;
      while (ctx.measureText(text).width > maxL && text.length > 4) text = `${text.slice(0, -2)}…`;
      ctx.fillText(text, pad, y);
    }
    if (x.r) { ctx.textAlign = 'right'; ctx.fillText(x.r, W - pad, y); }
    y += (x.size ?? 22) * 1.45;
  }
  return new Promise((resolve, reject) => canvas.toBlob((bl) => (bl ? resolve(bl) : reject(new Error('Could not make the bill picture'))), 'image/png'));
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('Could not read the picture'));
    r.readAsDataURL(blob);
  });
}

/** Opens the share sheet with the picture (Android app or phone browser). False if this device can't. */
export async function sharePicture(blob: Blob, name: string, text: string): Promise<boolean> {
  const c = cap();
  if (c?.isNativePlatform?.() && c.nativePromise) {
    const data = await toBase64(blob);
    const file = await c.nativePromise('Filesystem', 'writeFile', { path: name, data, directory: 'CACHE' });
    await c.nativePromise('Share', 'share', { title: name, text, files: [file.uri], dialogTitle: 'Send bill' });
    return true;
  }
  const f = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare?.({ files: [f] })) {
    try { await navigator.share({ files: [f], text }); } catch (e) { if ((e as Error).name !== 'AbortError') throw e; }
    return true;
  }
  return false;
}

/** Copies the picture so it can be pasted into WhatsApp; downloads it if copying isn't allowed. */
export async function copyOrDownload(blob: Blob, name: string): Promise<'copied' | 'downloaded'> {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return 'copied';
  } catch {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return 'downloaded';
  }
}
