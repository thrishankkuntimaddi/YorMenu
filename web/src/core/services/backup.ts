import { Timestamp, writeBatch, doc, getDocs, query, where, documentId } from 'firebase/firestore';
import type { Worksheet } from 'exceljs';
import { Tenant, type Coll } from '../tenant.js';
import { Row, by, nowStr } from '../db.js';
import { badRequest } from '../errors.js';
import { settingsOf } from './orders.js';

/*
 * Full backup of one restaurant as an Excel file, and restoring from it.
 *
 * Every data sheet holds one Firestore collection: one row per document, one column per
 * field, with the exact stored values (money in paise, ids, JSON for lists). A hidden
 * "_backup" sheet records how each column was written, so a restore puts back the same
 * numbers, text, lists and empty values. Sheets ending in "(view)" are only for reading.
 *
 * Staff, tables and menu are always included. Orders, bills, cleaning and the activity
 * log are included for the chosen dates, because Firestore's free plan allows 50,000
 * document reads a day: a day of a busy restaurant is a few thousand.
 */

export const BACKUP_FORMAT = 'yormenu-backup';
const VERSION = 1;
const META_SHEET = '_backup';
/** Excel holds at most 32,767 characters in a cell; longer text continues in "field~2", "field~3"… */
const CELL_MAX = 30_000;

type Part = { coll: Coll; sheet: string; dated?: 'business_date' | 'created_at' };
const PARTS: Part[] = [
  { coll: 'users', sheet: 'Staff' },
  { coll: 'sections', sheet: 'Sections' },
  { coll: 'tables', sheet: 'Tables' },
  { coll: 'menu_categories', sheet: 'Menu categories' },
  { coll: 'menu_items', sheet: 'Menu items' },
  { coll: 'orders', sheet: 'Orders', dated: 'business_date' },
  { coll: 'bills', sheet: 'Bills', dated: 'business_date' },
  { coll: 'cleaning_tasks', sheet: 'Cleaning', dated: 'created_at' },
  { coll: 'audit_log', sheet: 'Activity log', dated: 'created_at' },
];

type Kind = 'string' | 'number' | 'bignum' | 'boolean' | 'json';
type Column = { field: string; kind: Kind; parts: number; empty: 'omit' | 'null' | 'blank' };
type SheetMeta = { coll: Coll; sheet: string; rows: number; columns: Column[] };
export type BackupMeta = {
  format: string; version: number; rid: number; code: string; restaurant: string;
  from: string; to: string; includesActivity: boolean; created_at: string; sheets: SheetMeta[];
};

// ---------- values <-> cells ----------

/** Firestore values as plain JSON (dates become { "__time": milliseconds }). */
function toPlain(v: unknown): unknown {
  if (v instanceof Timestamp) return { __time: v.toMillis() };
  if (v instanceof Date) return { __time: v.getTime() };
  if (Array.isArray(v)) return v.map(toPlain);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toPlain(x)]));
  return v;
}
function fromPlain(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(fromPlain);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (Object.keys(o).length === 1 && typeof o.__time === 'number') return Timestamp.fromMillis(o.__time);
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, fromPlain(x)]));
  }
  return v;
}

/** Excel shows 15 significant digits; YorMenu ids are 16, so those are written as text. */
const tooBigForExcel = (n: number) => Math.abs(n) >= 1e15;

function columnFor(field: string, values: unknown[]): Omit<Column, 'parts'> {
  const present = values.filter((v) => v !== undefined);
  const set = present.filter((v) => v !== null && v !== '');
  const hasNull = present.some((v) => v === null);
  const hasBlank = present.some((v) => v === '');
  let kind: Kind;
  if (set.every((v) => typeof v === 'number')) kind = set.some((v) => tooBigForExcel(v as number) || !Number.isFinite(v as number)) ? 'bignum' : 'number';
  else if (set.every((v) => typeof v === 'string')) kind = 'string';
  else if (set.every((v) => typeof v === 'boolean')) kind = 'boolean';
  else kind = 'json';
  // An empty cell has to mean one thing; when a column has both null and "", spell values out as JSON.
  if (hasNull && hasBlank) kind = 'json';
  const empty = kind === 'json' ? 'omit' : hasNull ? 'null' : hasBlank ? 'blank' : 'omit';
  return { field, kind, empty };
}

function encode(col: Omit<Column, 'parts'>, v: unknown): string | number | boolean | null {
  if (v === undefined) return null;
  if (col.kind === 'json') return JSON.stringify(toPlain(v));
  if (v === null || v === '') return null;
  if (col.kind === 'bignum') return String(v);
  return v as string | number | boolean;
}

/** What ExcelJS hands back for a cell, as plain text or number. */
function cellValue(v: unknown): unknown {
  if (v === null || v === undefined) return undefined;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    const o = v as Record<string, any>;
    if (Array.isArray(o.richText)) return o.richText.map((r: { text: string }) => r.text).join('');
    if ('result' in o) return cellValue(o.result);
    if ('text' in o) return String(o.text);
    if ('error' in o) return undefined;
  }
  return v;
}

function decode(col: Column, raw: unknown): { set: boolean; value?: unknown } {
  if (raw === undefined || raw === '') {
    if (col.empty === 'null') return { set: true, value: null };
    if (col.empty === 'blank') return { set: true, value: '' };
    return { set: false };
  }
  switch (col.kind) {
    case 'json': return { set: true, value: fromPlain(JSON.parse(String(raw))) };
    case 'number':
    case 'bignum': {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw badRequest(`"${col.field}" should be a number but is "${raw}"`);
      return { set: true, value: n };
    }
    case 'boolean': return { set: true, value: raw === true || String(raw).toUpperCase() === 'TRUE' };
    default: return { set: true, value: String(raw) };
  }
}

// ---------- making a backup ----------

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Midnight of a local date in the restaurant's time zone, as a stored UTC time ("YYYY-MM-DD HH:MM:SS"). */
export function localMidnightUtc(date: string, tz: string): string {
  const guess = new Date(date + 'T00:00:00Z');
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(guess).map((x) => [x.type, x.value]));
  const asLocal = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return nowStr(new Date(guess.getTime() - (asLocal - guess.getTime())));
}

async function collect(t: Tenant, part: Part, from: string, to: string, tz: string): Promise<Row[]> {
  if (!part.dated) return t.list(part.coll);
  if (part.dated === 'business_date') return t.list(part.coll, ['business_date', '>=', from], ['business_date', '<=', to]);
  return t.list(part.coll, ['created_at', '>=', localMidnightUtc(from, tz)], ['created_at', '<', localMidnightUtc(addDays(to, 1), tz)]);
}

export async function makeBackup(t: Tenant, from: string, to: string, includeActivity: boolean) {
  const [r, settings] = await Promise.all([t.restaurant(), settingsOf(t)]);
  const parts = PARTS.filter((p) => includeActivity || p.coll !== 'audit_log');
  const data = await Promise.all(parts.map((p) => collect(t, p, from, to, settings.timezone).then((rows) => rows.sort(by('id')))));

  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'YorMenu';
  wb.created = new Date();
  const head = (ws: Worksheet) => {
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1EDE6' } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  };
  const rs = (p: unknown) => (typeof p === 'number' ? p / 100 : null);

  // A front page a person can read.
  const info = wb.addWorksheet('Read me');
  info.columns = [{ header: 'YorMenu backup', key: 'k', width: 30 }, { header: '', key: 'v', width: 60 }];
  head(info);
  const counts = parts.map((p, i) => [p.sheet, data[i].length] as [string, number]);
  [
    ['Restaurant', `${r.name} (${r.code})`],
    ['Dates', from === to ? from : `${from} to ${to}`],
    ['Made on', new Date().toLocaleString('en-IN', { timeZone: settings.timezone })],
    [],
    ...counts.map(([s, n]) => [`${s}`, `${n} rows`]),
    [],
    ['Restore', 'In YorMenu: Settings → Backup & restore → Restore from file. Pick this file.'],
    ['Money', 'In the data sheets, amounts are in paise (₹1 = 100). The "(view)" sheets show rupees.'],
    ['Please', 'Keep this file safe. Do not change the data sheets or the hidden _backup sheet, or the restore may refuse the file.'],
  ].forEach((row) => info.addRow(row));

  const meta: BackupMeta = {
    format: BACKUP_FORMAT, version: VERSION, rid: t.rid, code: r.code, restaurant: r.name, from, to,
    includesActivity: includeActivity, created_at: nowStr(), sheets: [],
  };

  parts.forEach((part, i) => {
    const rows = data[i];
    const fields = [...new Set(rows.flatMap((x) => Object.keys(x)))].sort((a, b) => (a === 'id' ? -1 : b === 'id' ? 1 : a.localeCompare(b)));
    const cols: Column[] = fields.map((f) => {
      const c = columnFor(f, rows.map((x) => x[f]));
      const longest = Math.max(0, ...rows.map((x) => { const e = encode(c, x[f]); return typeof e === 'string' ? e.length : 0; }));
      return { ...c, parts: Math.max(1, Math.ceil(longest / CELL_MAX)) };
    });
    const ws = wb.addWorksheet(part.sheet);
    ws.columns = cols.flatMap((c) => Array.from({ length: c.parts }, (_, n) => ({
      header: n ? `${c.field}~${n + 1}` : c.field, key: n ? `${c.field}~${n + 1}` : c.field,
      width: c.kind === 'json' ? 40 : Math.min(30, Math.max(10, c.field.length + 2)),
    })));
    head(ws);
    for (const x of rows) {
      const out: Record<string, unknown> = {};
      for (const c of cols) {
        const e = encode(c, x[c.field]);
        if (typeof e === 'string' && c.parts > 1) {
          for (let n = 0; n < c.parts; n++) out[n ? `${c.field}~${n + 1}` : c.field] = e.slice(n * CELL_MAX, (n + 1) * CELL_MAX) || null;
        } else out[c.field] = e;
      }
      ws.addRow(out);
    }
    meta.sheets.push({ coll: part.coll, sheet: part.sheet, rows: rows.length, columns: cols });
  });

  // Easy-to-read copies (ignored by restore).
  const bills = data[parts.findIndex((p) => p.coll === 'bills')] ?? [];
  const bv = wb.addWorksheet('Bills (view)');
  bv.columns = [
    { header: 'Bill no', key: 'no', width: 10 }, { header: 'Date', key: 'date', width: 12 }, { header: 'Table', key: 'table', width: 10 },
    { header: 'Customer', key: 'cust', width: 18 }, { header: 'Total (₹)', key: 'total', width: 12, style: { numFmt: '#,##0.00' } },
    { header: 'Status', key: 'status', width: 9 }, { header: 'Paid by', key: 'pay', width: 24 },
  ];
  head(bv);
  for (const b of bills) {
    bv.addRow({
      no: `${settings.billPrefix}${b.bill_no}`, date: b.business_date, table: b.table_label ?? '', cust: b.customer_name ?? '',
      total: rs(b.grand_total), status: b.status, pay: ((b.payments ?? []) as Row[]).map((p) => `${p.method} ${p.amount / 100}`).join(', '),
    });
  }
  const orders = data[parts.findIndex((p) => p.coll === 'orders')] ?? [];
  const tableLabel = new Map((data[parts.findIndex((p) => p.coll === 'tables')] ?? []).map((x) => [x.id, x.label]));
  const iv = wb.addWorksheet('Order items (view)');
  iv.columns = [
    { header: 'Date', key: 'date', width: 12 }, { header: 'Where', key: 'where', width: 14 }, { header: 'Item', key: 'item', width: 28 },
    { header: 'Qty', key: 'qty', width: 6 }, { header: 'Price (₹)', key: 'price', width: 10, style: { numFmt: '#,##0.00' } },
    { header: 'Amount (₹)', key: 'amount', width: 12, style: { numFmt: '#,##0.00' } }, { header: 'Status', key: 'status', width: 10 },
  ];
  head(iv);
  for (const o of orders) {
    const where = o.order_type === 'dine_in' ? `Table ${tableLabel.get(o.table_id) ?? '?'}` : `${o.order_type === 'takeaway' ? 'Parcel' : 'Delivery'} #${o.order_no ?? ''}`;
    for (const i of (o.items ?? []) as Row[]) {
      iv.addRow({ date: o.business_date, where, item: i.name, qty: i.qty, price: rs(i.price), amount: rs(i.price * i.qty), status: i.status });
    }
  }

  const ms = wb.addWorksheet(META_SHEET);
  ms.state = 'hidden';
  ms.getCell('A1').value = JSON.stringify(meta);

  const blob = new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const name = `yormenu-backup-${String(r.code).toLowerCase()}-${from === to ? from : `${from}-to-${to}`}.xlsx`;
  return { blob, name, meta };
}

// ---------- reading a backup ----------

export type ParsedBackup = { meta: BackupMeta; data: Map<Coll, Row[]> };

export async function readBackup(t: Tenant, bytes: Uint8Array): Promise<ParsedBackup> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  } catch {
    throw badRequest('This is not an Excel (.xlsx) file');
  }
  const ms = wb.getWorksheet(META_SHEET);
  let meta: BackupMeta | null = null;
  try { meta = JSON.parse(String(cellValue(ms?.getCell('A1').value) ?? '')); } catch { /* not ours */ }
  if (!meta || meta.format !== BACKUP_FORMAT) throw badRequest('This file is not a YorMenu backup');
  if (meta.version > VERSION) throw badRequest('This backup was made by a newer YorMenu. Update the app first.');
  if (meta.rid !== t.rid) throw badRequest(`This backup belongs to another restaurant (${meta.restaurant}, code ${meta.code})`);

  const allowed = new Set(PARTS.map((p) => p.coll));
  const data = new Map<Coll, Row[]>();
  for (const sm of meta.sheets) {
    if (!allowed.has(sm.coll)) continue;
    const ws = wb.getWorksheet(sm.sheet);
    if (!ws) throw badRequest(`The sheet "${sm.sheet}" is missing from the file`);
    // Find each column by its header, so a sheet whose columns were moved still works.
    const header = new Map<string, number>();
    ws.getRow(1).eachCell((c, n) => { header.set(String(cellValue(c.value) ?? ''), n); });
    const rows: Row[] = [];
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const out: Row = {};
      for (const col of sm.columns) {
        const at = header.get(col.field);
        if (!at) throw badRequest(`The column "${col.field}" is missing from "${sm.sheet}"`);
        let raw = cellValue(row.getCell(at).value);
        if (col.parts > 1) {
          const pieces = [raw, ...Array.from({ length: col.parts - 1 }, (_, k) => cellValue(row.getCell(header.get(`${col.field}~${k + 2}`) ?? 0).value))];
          raw = pieces.filter((p) => p !== undefined).map(String).join('') || undefined;
        }
        try {
          const d = decode(col, raw);
          if (d.set) out[col.field] = d.value;
        } catch (e) {
          if ((e as { status?: number }).status) throw e;
          throw badRequest(`"${sm.sheet}" row ${n}: the "${col.field}" cell was changed and can't be read`);
        }
      }
      if (typeof out.id !== 'number' || !Number.isSafeInteger(out.id)) throw badRequest(`"${sm.sheet}" row ${n} has no valid id`);
      out.restaurant_id = t.rid;
      rows.push(out);
    });
    data.set(sm.coll, rows);
  }
  return { meta, data };
}

export function backupSummary(p: ParsedBackup) {
  return {
    restaurant: p.meta.restaurant, code: p.meta.code, from: p.meta.from, to: p.meta.to, created_at: p.meta.created_at,
    sheets: p.meta.sheets.map((s) => ({ name: s.sheet, coll: s.coll, rows: p.data.get(s.coll)?.length ?? 0 })),
  };
}

// ---------- restoring ----------

/** Ids (of these) that already exist. Costs one read per document found. */
async function existingIds(t: Tenant, coll: Coll, ids: number[]): Promise<Set<number>> {
  const found = new Set<number>();
  for (let i = 0; i < ids.length; i += 30) {
    const chunk = ids.slice(i, i + 30).map(String);
    const snap = await getDocs(query(t.col(coll), where(documentId(), 'in', chunk)));
    snap.forEach((d) => found.add(Number(d.id)));
  }
  return found;
}

export type RestoreMode = 'missing' | 'replace';

/**
 * Put the backup's documents back.
 *  - "missing": only documents that are not in YorMenu any more are added (nothing is overwritten).
 *  - "replace": documents are also set back to the backup's copy.
 * Staff are only ever added (switched off, since their login is not in the file), and the
 * activity log is only added to: nobody can change it.
 */
export async function restoreBackup(t: Tenant, p: ParsedBackup, mode: RestoreMode) {
  const result: { name: string; added: number; replaced: number; skipped: number }[] = [];
  const writes: { coll: Coll; row: Row }[] = [];
  for (const sm of p.meta.sheets) {
    const rows = p.data.get(sm.coll) ?? [];
    if (!rows.length) { result.push({ name: sm.sheet, added: 0, replaced: 0, skipped: 0 }); continue; }
    const onlyAdd = mode === 'missing' || sm.coll === 'users' || sm.coll === 'audit_log';
    const exists = await existingIds(t, sm.coll, rows.map((r) => r.id));
    let added = 0;
    let replaced = 0;
    for (const row of rows) {
      const there = exists.has(row.id);
      if (there && onlyAdd) continue;
      writes.push({ coll: sm.coll, row: sm.coll === 'users' ? { ...row, active: 0 } : row });
      if (there) replaced++; else added++;
    }
    result.push({ name: sm.sheet, added, replaced, skipped: rows.length - added - replaced });
  }
  for (let i = 0; i < writes.length; i += 400) {
    const batch = writeBatch(t.db);
    for (const w of writes.slice(i, i + 400)) batch.set(doc(t.db, `${t.path(w.coll)}/${w.row.id}`), w.row);
    await batch.commit();
  }
  // New bills must not reuse a restored bill number.
  const maxBill = Math.max(0, ...(p.data.get('bills') ?? []).map((b) => Number(b.bill_no) || 0));
  const r = await t.restaurant();
  if (maxBill > (r.bill_seq ?? 0)) await t.updateRestaurant({ bill_seq: maxBill });
  return { mode, written: writes.length, sheets: result };
}
