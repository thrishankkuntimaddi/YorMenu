import { z } from 'zod';
import { Router, type Req as Request } from '../http.js';
import type { AppDeps } from '../index.js';
import { requirePerm } from '../session.js';
import { badRequest, forbidden } from '../errors.js';
import { parse, dateStr } from '../validate.js';
import { businessDate } from '../settings.js';
import { settingsOf } from '../services/orders.js';
import { makeBackup, readBackup, backupSummary, restoreBackup } from '../services/backup.js';

/** Longest date range in one backup file, so one download stays well inside Firestore's free daily reads. */
const MAX_DAYS = 31;
/** About 20 MB of Excel. */
const MAX_FILE_CHARS = 28_000_000;

const days = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function backupRoutes(deps: AppDeps) {
  const r = new Router();
  // The owner only (not YorMenu support, and not managers): a backup holds every bill and customer.
  const ownerOnly = (req: Request) => {
    if (req.staff!.role !== 'owner' || !req.staff!.userId) throw forbidden('Only the owner can make or restore backups');
  };

  r.get('/backup', requirePerm('settings.edit'), async (req, res) => {
    ownerOnly(req);
    const t = req.staff!.tenant;
    const today = businessDate((await settingsOf(t)).timezone);
    const q = parse(z.object({ from: dateStr.default(today), to: dateStr.default(today), activity: z.enum(['0', '1']).default('0') }), req.query);
    if (q.from > q.to) throw badRequest('Start date is after end date');
    if (days(q.from, q.to) > MAX_DAYS) throw badRequest(`Back up at most ${MAX_DAYS} days in one file`);
    const out = await makeBackup(t, q.from, q.to, q.activity === '1');
    await t.audit(req.staff!.userId, 'backup.download', 'backup', null, { from: q.from, to: q.to, rows: out.meta.sheets.reduce((s, x) => s + x.rows, 0) });
    res.setHeader('Content-Type', out.blob.type);
    res.setHeader('Content-Disposition', `attachment; filename="${out.name}"`);
    res.send(out.blob);
  });

  const fileBody = z.object({ data: z.string().min(1).max(MAX_FILE_CHARS) });

  r.post('/backup/preview', requirePerm('settings.edit'), async (req, res) => {
    ownerOnly(req);
    const b = parse(fileBody, req.body);
    res.json(backupSummary(await readBackup(req.staff!.tenant, fromBase64(b.data))));
  });

  r.post('/backup/restore', requirePerm('settings.edit'), async (req, res) => {
    ownerOnly(req);
    const b = parse(fileBody.extend({ mode: z.enum(['missing', 'replace']).default('missing') }), req.body);
    const t = req.staff!.tenant;
    const parsed = await readBackup(t, fromBase64(b.data));
    const out = await restoreBackup(t, parsed, b.mode);
    await t.audit(req.staff!.userId, 'backup.restore', 'backup', null, { from: parsed.meta.from, to: parsed.meta.to, mode: b.mode, written: out.written });
    // Every screen reloads what it shows.
    for (const e of ['floor:changed', 'bills:changed', 'kitchen:changed', 'catalog:changed', 'cleaning:changed']) deps.rt.emit(t.rid, e);
    res.json(out);
  });

  return r;
}
