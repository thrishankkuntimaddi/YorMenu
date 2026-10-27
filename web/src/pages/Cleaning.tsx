import { T } from '../i18n';
import { useState } from 'react';
import { api } from '../api';
import { useLive } from '../live';
import { useSession } from '../session';
import { useCatalog } from '../catalog';
import { Loading, Modal, useAction, useLoad, useTick } from '../ui';
import { elapsed, timeOf } from '../format';

type Task = { id: number; table_id: number; table_label: string; section: string; status: 'pending' | 'done'; created_at: string; done_at: string | null; requested_by_name: string | null };

export default function Cleaning() {
  const { can } = useSession();
  const { data, error, reload } = useLoad(() => api.get<Task[]>('/cleaning'));
  const { run, busy } = useAction();
  const [pick, setPick] = useState(false);
  useLive(['cleaning:changed', 'reconnect'], reload);
  useTick();
  if (!data) return <Loading error={error} />;
  const pending = data.filter((t) => t.status === 'pending');
  const done = data.filter((t) => t.status === 'done');
  return (
    <div className="page">
      <div className="page-head">
        <h1><T>Cleaning</T></h1>
        {can('cleaning.request') && <button className="btn" onClick={() => setPick(true)}><T>Request cleaning</T></button>}
      </div>
      {!pending.length && <div className="empty">No tables waiting. 🎉</div>}
      <div className="tiles" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        {pending.map((t) => (
          <div key={t.id} className="card pad stack" style={{ textAlign: 'center' }}>
            <div className="small muted">{t.section}</div>
            <div style={{ fontSize: 24, fontWeight: 800 }}>{t.table_label}</div>
            <div className="small muted">waiting {elapsed(t.created_at)}</div>
            <button className="btn ok lg" disabled={busy} onClick={() => run(async () => { await api.post(`/cleaning/${t.id}/done`); reload(); }, `${t.table_label} is clean`)}><T>Done</T></button>
          </div>
        ))}
      </div>
      {done.length > 0 && (
        <>
          <div className="section-title"><T>Recently cleaned</T></div>
          <div className="row wrap">{done.map((t) => <span key={t.id} className="pill served">{t.table_label} · {t.done_at && timeOf(t.done_at)}</span>)}</div>
        </>
      )}
      {pick && <PickTable onClose={() => setPick(false)} onPick={(id) => run(async () => { await api.post('/cleaning', { tableId: id }); setPick(false); reload(); }, 'Cleaning requested')} />}
    </div>
  );
}

function PickTable({ onClose, onPick }: { onClose: () => void; onPick: (id: number) => void }) {
  const { catalog } = useCatalog();
  return (
    <Modal title="Which table needs cleaning?" onClose={onClose} wide>
      {!catalog ? 'Loading…' : catalog.sections.map((s) => (
        <div key={s.id}>
          <div className="section-title">{s.name}</div>
          <div className="tiles">{catalog.tables.filter((t) => t.section_id === s.id && t.active).map((t) => (
            <button key={t.id} className="tile" onClick={() => onPick(t.id)}><span className="lbl">{t.label}</span></button>
          ))}</div>
        </div>
      ))}
    </Modal>
  );
}
