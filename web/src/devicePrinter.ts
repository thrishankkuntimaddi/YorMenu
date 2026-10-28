import { billEscPos, kotEscPos, toBase64 } from './core/printing';
import type { BillTicket, KotTicket } from './types';

/*
 * The thermal printer connected to THIS phone, tablet or PC (saved on the device):
 *  - bluetooth: a paired portable printer (Android app)
 *  - usb:       a printer on a USB / OTG cable (Android app)
 *  - network:   a Wi-Fi / LAN printer, usually port 9100 (Android app and desktop app)
 * Small shops need nothing else: no laptop, no counter PC.
 */
export type DevicePrinter = {
  kind: 'bluetooth' | 'usb' | 'network';
  name: string;
  address?: string;            // bluetooth
  vendorId?: number; productId?: number; // usb
  host?: string; port?: number; // network
  width: '58' | '80';
  bills: boolean;
  kots: boolean;
};

type Cap = { isNativePlatform?: () => boolean; nativePromise?: (p: string, m: string, o?: object) => Promise<any> };
const cap = () => (window as unknown as { Capacitor?: Cap }).Capacitor;
const desktop = () => window.yormenuDesktop;

/** Which kinds of printer this device can talk to directly. */
export function supportedKinds(): DevicePrinter['kind'][] {
  if (cap()?.isNativePlatform?.() && cap()?.nativePromise) return ['bluetooth', 'usb', 'network'];
  if (desktop()?.printRaw) return ['network'];
  return [];
}

const KEY = 'yormenu.devicePrinter';
export function getDevicePrinter(): DevicePrinter | null {
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && supportedKinds().includes(v.kind) ? v : null; } catch { return null; }
}
export function setDevicePrinter(p: DevicePrinter | null) {
  try { if (p) localStorage.setItem(KEY, JSON.stringify(p)); else localStorage.removeItem(KEY); } catch { /* private mode */ }
}

const native = (method: string, options: object = {}) => cap()!.nativePromise!('YorPrinter', method, options);

export async function listBluetooth(): Promise<{ name: string; address: string }[]> {
  return (await native('listBluetooth')).devices ?? [];
}
export async function listUsb(): Promise<{ name: string; vendorId: number; productId: number }[]> {
  return (await native('listUsb')).devices ?? [];
}

/** Send raw ESC/POS bytes to the printer. */
export async function sendBytes(p: DevicePrinter, bytes: Uint8Array) {
  const data = toBase64(bytes);
  if (p.kind === 'network') {
    if (desktop()?.printRaw) return desktop()!.printRaw!(p.host!, p.port ?? 9100, data);
    return native('printNetwork', { host: p.host, port: p.port ?? 9100, data });
  }
  if (p.kind === 'bluetooth') return native('printBluetooth', { address: p.address, data });
  return native('printUsb', { vendorId: p.vendorId, productId: p.productId, data });
}

const cols = (p: DevicePrinter) => (p.width === '58' ? 32 : 48);
export const printBillOn = (p: DevicePrinter, t: BillTicket) => sendBytes(p, billEscPos(t, cols(p)));
export const printKotOn = (p: DevicePrinter, t: KotTicket) => sendBytes(p, kotEscPos(t, cols(p)));

export function testTicket(p: DevicePrinter): BillTicket {
  return {
    restaurant: 'YorMenu test print', address: 'If you can read this,', phone: '', gstin: '', billNo: 'TEST', date: new Date().toLocaleString(),
    where: p.name, cashier: '', customer: '', customerPhone: '', status: 'paid',
    lines: [{ name: 'the printer works!', qty: 1, price: 100, amount: 100 }], totalQty: 1, subtotal: 100, discount: 0, serviceCharge: 0,
    taxes: [], roundOff: 0, grandTotal: 100, footer: 'YorMenu',
  };
}
