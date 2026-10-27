import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../api';
import { useCatalog } from '../catalog';
import { useSession } from '../session';
import { Loading, Modal, useAction, useLoad } from '../ui';
import { printHtml } from '../print';
import type { Section, TableRow } from '../types';

export default function TablesAdmin() {
  const { catalog, reload } = useCatalog();
  const [sec, setSec] = useState<Partial<Section> | null>(null);
  const [add, setAdd] = useState<Section | null>(null);
  const [tbl, setTbl] = useState<TableRow | null>(null);
  const [qr, setQr] = useState(false);
  if (!catalog) return <Loading />;
  return (
    <div className="page">
      <div className="page-head">
        <h1>Floor plan</h1>
        <button className="btn" onClick={() => setQr(true)}>QR codes</button>
        <button className="btn primary" onClick={() => setSec({})}>+ Section</button>
      </div>
      <p className="muted" style={{ marginTop: -6 }}>Group tables into sections like Hut, AC hall, Garden or Corridor. Each table gets its own QR code for the guest menu.</p>
      {catalog.sections.map((s) => {
        const tables = catalog.tables.filter((t) => t.section_id === s.id);
        return (
          <div key={s.id} className="card pad" style={{ marginBottom: 12 }}>
            <div className="row between" style={{ marginBottom: 10 }}>
              <h2>{s.name} <span className="faint small">({tables.filter((t) => t.active).length} tables)</span></h2>
              <div className="row"><button className="btn sm" onClick={() => setSec(s)}>Rename</button><button className="btn sm primary" onClick={() => setAdd(s)}>+ Tables</button></div>
            </div>
            <div className="tiles">
              {tables.map((t) => (
                <button key={t.id} className="tile" style={t.active ? undefined : { opacity: .4 }} onClick={() => setTbl(t)}>
                  <span className="lbl">{t.label}</span><span className="meta">{t.active ? `${t.seats} seats` : 'Hidden'}</span>
                </button>
              ))}
            </div>
            {!tables.length && <div className="faint small">No tables yet.</div>}
          </div>
        );
      })}
      {sec && <SectionModal s={sec} onClose={() => setSec(null)} onSaved={async () => { await reload(); setSec(null); }} />}
      {add && <AddTablesModal s={add} onClose={() => setAdd(null)} onSaved={async () => { await reload(); setAdd(null); }} />}
      {tbl && <TableModal t={tbl} sections={catalog.sections} onClose={() => setTbl(null)} onSaved={async () => { await reload(); setTbl(null); }} />}
      {qr && <QrSheet onClose={() => setQr(false)} />}
    </div>
  );
}

function SectionModal({ s, onClose, onSaved }: { s: Partial<Section>; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(s.name ?? '');
  const [sort, setSort] = useState(String(s.sort ?? 0));
  const { run, busy } = useAction();
  const save = () => run(async () => {
    if (s.id) await api.patch(`/sections/${s.id}`, { name, sort: Number(sort) }); else await api.post('/sections', { name, sort: Number(sort) });
    onSaved();
  }, 'Saved');
  return (
    <Modal title={s.id ? 'Edit section' : 'New section'} onClose={onClose} footer={<>
      {s.id && <button className="btn danger" onClick={() => run(async () => { await api.del(`/sections/${s.id}`); onSaved(); }, 'Removed')}>Delete</button>}
      <span className="grow" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !name} onClick={save}>Save</button>
    </>}>
      <label>Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Hut, AC Hall, Garden…" autoFocus /></label>
      <label>Order (lower shows first)<input inputMode="numeric" value={sort} onChange={(e) => setSort(e.target.value)} /></label>
    </Modal>
  );
}

function AddTablesModal({ s, onClose, onSaved }: { s: Section; onClose: () => void; onSaved: () => void }) {
  const [prefix, setPrefix] = useState(s.name.replace(/\s+/g, ''));
  const [count, setCount] = useState('4');
  const [start, setStart] = useState('1');
  const [seats, setSeats] = useState('4');
  const { run, busy } = useAction();
  const n = Math.max(0, Math.min(200, Number(count) || 0));
  const preview = Array.from({ length: Math.min(n, 6) }, (_, i) => `${prefix}${Number(start) + i}`).join(', ') + (n > 6 ? '…' : '');
  return (
    <Modal title={`Add tables to ${s.name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || !n} onClick={() => run(async () => { await api.post('/tables', { sectionId: s.id, prefix, count: n, start: Number(start), seats: Number(seats) }); onSaved(); }, `${n} tables added`)}>Add {n} tables</button></>}>
      <div className="row">
        <label className="grow">Name prefix<input value={prefix} onChange={(e) => setPrefix(e.target.value)} /></label>
        <label style={{ width: 90 }}>Start at<input inputMode="numeric" value={start} onChange={(e) => setStart(e.target.value)} /></label>
      </div>
      <div className="row">
        <label className="grow">How many<input inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} /></label>
        <label className="grow">Seats each<input inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value)} /></label>
      </div>
      <div className="small muted">Will create: {preview || '—'}</div>
    </Modal>
  );
}

function TableModal({ t, sections, onClose, onSaved }: { t: TableRow; sections: Section[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ label: t.label, seats: String(t.seats), sectionId: t.section_id, active: !!t.active });
  const { run, busy } = useAction();
  return (
    <Modal title={`Table ${t.label}`} onClose={onClose} footer={<>
      <button className="btn danger" onClick={() => confirm(`Remove table ${t.label}?`) && run(async () => { await api.del(`/tables/${t.id}`); onSaved(); }, 'Removed')}>Remove</button>
      <button className="btn" onClick={() => run(async () => { await api.patch(`/tables/${t.id}`, { regenerateQr: true }); onSaved(); }, 'New QR code made. Reprint it.')}>New QR</button>
      <span className="grow" /><button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy} onClick={() => run(async () => { await api.patch(`/tables/${t.id}`, { label: f.label, seats: Number(f.seats), sectionId: Number(f.sectionId), active: f.active }); onSaved(); }, 'Saved')}>Save</button>
    </>}>
      <label>Name<input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></label>
      <label>Seats<input inputMode="numeric" value={f.seats} onChange={(e) => setF({ ...f, seats: e.target.value })} /></label>
      <label>Section<select value={f.sectionId} onChange={(e) => setF({ ...f, sectionId: Number(e.target.value) })}>{sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Show on floor</label>
    </Modal>
  );
}

function QrSheet({ onClose }: { onClose: () => void }) {
  const { me } = useSession();
  const { data } = useLoad(() => api.get<{ id: number; label: string; qr_token: string; section: string }[]>('/tables/qr'));
  const [imgs, setImgs] = useState<Record<number, string>>({});
  useEffect(() => {
    if (!data) return;
    Promise.all(data.map(async (t) => [t.id, await QRCode.toDataURL(`${location.origin}/t/${t.qr_token}`, { margin: 1, width: 300 })] as const))
      .then((pairs) => setImgs(Object.fromEntries(pairs)));
  }, [data]);
  const print = () => printHtml(
    `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8mm">${(data ?? []).map((t) => `
      <div style="border:1px solid #000;border-radius:4mm;padding:4mm;text-align:center;font-family:sans-serif;break-inside:avoid">
        <div style="font-weight:700">${me?.restaurant.name ?? ''}</div><img src="${imgs[t.id]}" style="width:45mm;height:45mm">
        <div style="font-size:18px;font-weight:800">Table ${t.label}</div><div style="font-size:11px">Scan for menu & to order</div></div>`).join('')}</div>`,
    '@page{size:A4;margin:10mm} body{margin:0}');
  return (
    <Modal title="Table QR codes" onClose={onClose} wide footer={<><button className="btn" onClick={onClose}>Close</button><button className="btn primary" disabled={!data || Object.keys(imgs).length < (data?.length ?? 0)} onClick={print}>Print all (A4)</button></>}>
      <div className="small muted">Stick one on each table. Guests scan to see the menu{me?.restaurant.settings.qrOrdering ? ', order, call a server or ask for the bill' : ''}.</div>
      {!data ? 'Loading…' : (
        <div className="qr-sheet">
          {data.map((t) => (
            <div key={t.id} className="card qr-card">
              {imgs[t.id] ? <img src={imgs[t.id]} alt={`QR for ${t.label}`} /> : <div style={{ height: 150 }} />}
              <div style={{ fontWeight: 800 }}>{t.label}</div>
              <a className="small" href={`/t/${t.qr_token}`} target="_blank" rel="noreferrer">Open guest page</a>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
