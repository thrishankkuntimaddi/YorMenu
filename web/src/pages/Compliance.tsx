import { useState } from 'react';
import { api } from '../api';
import { useSession } from '../session';
import { Loading, Modal, useAction, useLoad } from '../ui';
import { dateTimeOf } from '../format';
import { Icon } from '../icons';

type DocType = { key: string; label: string; required: boolean; hint: string };
type Doc = {
  id: number; doc_type: string; number: string; issued_on: string | null; expires_on: string | null; file_name: string; file_size: number;
  status: string; state: string; review_note: string; created_at: string; uploaded_by_name: string | null;
};
type Data = { types: DocType[]; docs: Doc[]; overview: Record<string, number> };

export const STATE_TEXT: Record<string, string> = {
  verified: '✅ Verified', pending: '⏳ Waiting for YorMenu check', rejected: '❌ Rejected', expired: '⛔ Expired', expiring: '⚠️ Expires soon', missing: 'Not uploaded',
};

export default function Compliance() {
  const { me } = useSession();
  const { data, error, reload } = useLoad(() => api.get<Data>('/compliance'));
  const [adding, setAdding] = useState<string | null>(null);
  const { run } = useAction();
  if (!data) return <Loading error={error} />;
  const o = data.overview;
  const latest = (key: string) => data.docs.find((d) => d.doc_type === key);
  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <div className="page-head">
        <h1>Licences & safety certificates</h1>
        <button className="btn primary" onClick={() => setAdding('fssai')}><Icon name="plus" size={16} />Add licence</button>
      </div>
      <p className="muted" style={{ marginTop: -6 }}>
        Keep your licences here so they're never lost and you get reminded before they expire. YorMenu checks each upload.
        Only owners and managers of {me?.restaurant.name} and the YorMenu verification team can see these files.
      </p>
      <div className="kpi-row" style={{ marginBottom: 14 }}>
        {(['verified', 'pending', 'expiring', 'expired', 'rejected', 'missing'] as const).map((k) => (
          <div key={k} className="card stat"><div className="k">{STATE_TEXT[k]}</div><div className="v">{o[k] ?? 0}</div></div>
        ))}
      </div>
      <div className="card table-wrap">
        <table className="list">
          <thead><tr><th>Document</th><th>Number</th><th>Valid till</th><th>Status</th><th /></tr></thead>
          <tbody>
            {data.types.map((t) => {
              const d = latest(t.key);
              if (!d && !t.required) return null;
              return (
                <tr key={t.key}>
                  <td><b>{t.label}</b>{t.required && <span className="small faint"> · required</span>}<div className="small faint">{t.hint}</div></td>
                  <td className="small">{d?.number || '—'}</td>
                  <td className="small">{d?.expires_on ?? '—'}</td>
                  <td>
                    <span className={`state-pill ${d?.state ?? 'missing'}`}>{STATE_TEXT[d?.state ?? 'missing']}</span>
                    {d?.review_note && <div className="small err">{d.review_note}</div>}
                  </td>
                  <td className="r">
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      <button className="btn sm" onClick={() => setAdding(t.key)}>{d ? 'Renew / replace' : 'Upload'}</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {data.docs.length > 0 && (
        <>
          <h2 style={{ margin: '18px 0 8px' }}>All uploads</h2>
          <div className="card table-wrap">
            <table className="list">
              <thead><tr><th>Document</th><th>Number</th><th>Valid till</th><th>Status</th><th>Uploaded</th><th /></tr></thead>
              <tbody>{data.docs.map((d) => (
                <tr key={d.id}>
                  <td>{data.types.find((t) => t.key === d.doc_type)?.label ?? d.doc_type}<div className="small faint">{d.file_name}</div></td>
                  <td className="small">{d.number || '—'}</td><td className="small">{d.expires_on ?? '—'}</td>
                  <td><span className={`state-pill ${d.state}`}>{STATE_TEXT[d.state]}</span></td>
                  <td className="small">{dateTimeOf(d.created_at)}<div className="faint">{d.uploaded_by_name}</div></td>
                  <td className="r">
                    <button className="btn sm ghost danger" onClick={() => confirm('Delete this document?') && run(async () => { await api.del(`/compliance/${d.id}`); reload(); }, 'Deleted')}>Delete</button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
      {adding && <UploadModal types={data.types} initial={adding} onClose={() => setAdding(null)} onDone={() => { setAdding(null); reload(); }} />}
    </div>
  );
}

function UploadModal({ types, initial, onClose, onDone }: { types: DocType[]; initial: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ docType: initial, number: '', issuedOn: '', expiresOn: '' });
  const { run, busy } = useAction();
  const type = types.find((t) => t.key === f.docType);
  const save = () => run(async () => {
    await api.post('/compliance', {
      docType: f.docType, number: f.number, issuedOn: f.issuedOn || null, expiresOn: f.expiresOn || null,
    });
    onDone();
  }, 'Saved. YorMenu will verify it soon.');
  return (
    <Modal title="Add licence / certificate" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || !f.number} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
    </>}>
      <label>Document<select value={f.docType} onChange={(e) => setF({ ...f, docType: e.target.value })}>{types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></label>
      {type?.hint && <div className="small muted">{type.hint}</div>}
      <label>Licence / certificate number<input value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} /></label>
      <div className="grid2">
        <label>Issued on<input type="date" value={f.issuedOn} onChange={(e) => setF({ ...f, issuedOn: e.target.value })} /></label>
        <label>Valid till (expiry)<input type="date" value={f.expiresOn} onChange={(e) => setF({ ...f, expiresOn: e.target.value })} /></label>
      </div>
      <div className="small muted">YorMenu checks the number with the licensing office records. Keep the original certificate displayed at the restaurant.</div>
    </Modal>
  );
}
