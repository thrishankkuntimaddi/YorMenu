import { useState } from 'react';
import { api } from '../api';
import { Loading, useLoad } from '../ui';
import { dateTimeOf } from '../format';

type Row = { id: number; action: string; entity: string; entity_id: number | null; details: string; created_at: string; user_name: string | null };

const LABEL: Record<string, string> = {
  'order.create': 'Opened order', 'kot.create': 'Sent KOT', 'item.cancel': 'Cancelled item', 'order.dining_done': 'Dining complete',
  'bill.generate': 'Generated bill', 'bill.regenerate': 'Updated bill', 'bill.pay': 'Payment received', 'bill.void': 'Voided bill',
  'bill.whatsapp': 'Sent bill on WhatsApp', 'order.reopen': 'Reopened table', 'order.cancel': 'Cancelled order', 'order.move': 'Moved table',
  'menu.add': 'Added menu item', 'menu.price': 'Changed price', 'menu.remove': 'Removed menu item', 'staff.add': 'Added staff',
  'staff.update': 'Updated staff', 'settings.update': 'Changed settings', 'tables.add': 'Added tables', 'tables.remove': 'Removed table',
};

export default function Audit() {
  const [before, setBefore] = useState<number | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const { error } = useLoad(async () => {
    const r = await api.get<Row[]>(`/audit${before ? `?before=${before}` : ''}`);
    setRows((prev) => (before ? [...prev, ...r] : r));
    return r;
  }, [before]);
  const sensitive = (a: string) => ['item.cancel', 'bill.void', 'order.cancel', 'menu.price', 'order.reopen'].includes(a);
  return (
    <div className="page">
      <div className="page-head"><h1>Activity log</h1><span className="muted">Who did what, and when</span></div>
      {!rows.length ? <Loading error={error} /> : (
        <div className="card table-wrap">
          <table className="list">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td className="small" style={{ whiteSpace: 'nowrap' }}>{dateTimeOf(r.created_at)}</td>
                <td>{r.user_name ?? 'System'}</td>
                <td>{sensitive(r.action) ? <b style={{ color: 'var(--warn)' }}>{LABEL[r.action] ?? r.action}</b> : LABEL[r.action] ?? r.action}</td>
                <td className="small muted" style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.details !== '{}' ? r.details : ''}</td>
              </tr>
            ))}</tbody>
          </table>
          {rows.length % 100 === 0 && <div style={{ padding: 12, textAlign: 'center' }}><button className="btn" onClick={() => setBefore(rows[rows.length - 1].id)}>Load older</button></div>}
        </div>
      )}
    </div>
  );
}
