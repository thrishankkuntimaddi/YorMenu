import { useRef, useState } from 'react';
import { api, fileToBase64 } from '../api';
import { Modal, useAction } from '../ui';
import { todayISO, isoDaysAgo } from '../format';
import { Icon } from '../icons';

type Range = 'today' | 'yesterday' | 'week' | 'month' | 'custom';
const RANGES: { key: Range; label: string; get: () => [string, string] }[] = [
  { key: 'today', label: 'Today', get: () => [todayISO(), todayISO()] },
  { key: 'yesterday', label: 'Yesterday', get: () => [isoDaysAgo(1), isoDaysAgo(1)] },
  { key: 'week', label: 'Last 7 days', get: () => [isoDaysAgo(6), todayISO()] },
  { key: 'month', label: 'Last 30 days', get: () => [isoDaysAgo(29), todayISO()] },
];

type Preview = {
  restaurant: string; code: string; from: string; to: string; created_at: string;
  sheets: { name: string; coll: string; rows: number }[];
};
type Restored = { mode: string; written: number; sheets: { name: string; added: number; replaced: number; skipped: number }[] };

/** Owner only: download everything as Excel, and put it back from that file. */
export default function BackupCard() {
  const { run, busy } = useAction();
  const [range, setRange] = useState<Range>('today');
  const [[from, to], setDates] = useState<[string, string]>(RANGES[0].get());
  const [activity, setActivity] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; data: string; preview: Preview } | null>(null);
  const [mode, setMode] = useState<'missing' | 'replace'>('missing');
  const [done, setDone] = useState<Restored | null>(null);

  const pick = (r: Range) => {
    setRange(r);
    const found = RANGES.find((x) => x.key === r);
    if (found) setDates(found.get());
  };
  const download = () => run(() => api.download(`/backup?from=${from}&to=${to}&activity=${activity ? 1 : 0}`), 'Backup saved');
  const choose = (f: File | undefined) => {
    if (!fileRef.current) return;
    fileRef.current.value = '';
    if (!f) return;
    run(async () => {
      const data = await fileToBase64(f);
      const preview = await api.post<Preview>('/backup/preview', { data });
      setMode('missing');
      setFile({ name: f.name, data, preview });
    });
  };
  const restore = () => run(async () => {
    if (!file) return;
    const out = await api.post<Restored>('/backup/restore', { data: file.data, mode });
    setFile(null);
    setDone(out);
  }, 'Restore finished');

  return (
    <div className="card pad stack">
      <h2>Backup & restore</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Save your restaurant's data as an Excel file on this computer: staff, tables and menu, plus the orders and bills of the dates you pick.
        Back up at the end of each day (or each week) and keep the files safe. If something is lost, restore it from the file.
      </p>

      <div className="row wrap" style={{ gap: 8 }}>
        <div className="segmented">
          {RANGES.map((r) => <button key={r.key} className={range === r.key ? 'on' : ''} onClick={() => pick(r.key)}>{r.label}</button>)}
          <button className={range === 'custom' ? 'on' : ''} onClick={() => setRange('custom')}>Custom</button>
        </div>
        {range === 'custom' && (
          <div className="row" style={{ gap: 6 }}>
            <input type="date" aria-label="From" style={{ width: 150 }} value={from} max={to} onChange={(e) => setDates([e.target.value, to])} />
            <span className="muted">to</span>
            <input type="date" aria-label="To" style={{ width: 150 }} value={to} min={from} max={todayISO()} onChange={(e) => setDates([from, e.target.value])} />
          </div>
        )}
      </div>
      <label className="check"><input type="checkbox" checked={activity} onChange={(e) => setActivity(e.target.checked)} />Include the activity log (who did what; makes the file bigger)</label>
      <p className="small faint" style={{ margin: 0 }}>Up to 31 days in one file. The free Firebase plan allows 50,000 reads a day; one day of a busy restaurant is a few thousand.</p>

      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn primary" disabled={busy} onClick={download}><Icon name="download" size={16} />Download backup</button>
        <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}><Icon name="upload" size={16} />Restore from file…</button>
        <input ref={fileRef} type="file" hidden accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => choose(e.target.files?.[0])} />
      </div>

      {file && (
        <Modal title="Restore from backup" onClose={() => setFile(null)} footer={<>
          <button className="btn" onClick={() => setFile(null)}>Cancel</button>
          <button className={`btn ${mode === 'replace' ? 'danger' : 'primary'}`} disabled={busy} onClick={restore}>Restore</button>
        </>}>
          <div className="stack">
            <div><b>{file.preview.restaurant}</b> <span className="muted">({file.preview.code})</span></div>
            <div className="small muted">
              {file.name} · dates {file.preview.from === file.preview.to ? file.preview.from : `${file.preview.from} to ${file.preview.to}`}
            </div>
            <table className="list small">
              <tbody>{file.preview.sheets.map((s) => <tr key={s.coll}><td>{s.name}</td><td style={{ textAlign: 'right' }}>{s.rows}</td></tr>)}</tbody>
            </table>
            <label className="check"><input type="radio" name="mode" checked={mode === 'missing'} onChange={() => setMode('missing')} />
              Only add what is missing (safe: nothing in YorMenu is changed)</label>
            <label className="check"><input type="radio" name="mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
              Also put changed records back to the file's version</label>
            {mode === 'replace' && <p className="small" style={{ margin: 0, color: 'var(--danger, #b91c1c)' }}>
              Orders, bills, tables and menu that changed after this backup go back to how they were in the file. Staff and the activity log are only ever added to.
            </p>}
            <p className="small faint" style={{ margin: 0 }}>Staff added from a backup start switched off, because their logins are not in the file. Turn them on in Staff and set a password.</p>
          </div>
        </Modal>
      )}

      {done && (
        <Modal title="Restore finished" onClose={() => setDone(null)} footer={<button className="btn primary" onClick={() => setDone(null)}>OK</button>}>
          <table className="list small">
            <thead><tr><th>Sheet</th><th style={{ textAlign: 'right' }}>Added</th><th style={{ textAlign: 'right' }}>Put back</th><th style={{ textAlign: 'right' }}>Already there</th></tr></thead>
            <tbody>{done.sheets.map((s) => <tr key={s.name}><td>{s.name}</td><td style={{ textAlign: 'right' }}>{s.added}</td><td style={{ textAlign: 'right' }}>{s.replaced}</td><td style={{ textAlign: 'right' }}>{s.skipped}</td></tr>)}</tbody>
          </table>
        </Modal>
      )}
    </div>
  );
}
