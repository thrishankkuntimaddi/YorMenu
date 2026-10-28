import { useState } from 'react';
import { api } from '../api';
import { Loading, useLoad } from '../ui';
import { dateTimeOf, rupees, ROLE_LABEL } from '../format';
import { useSession } from '../session';

type Row = {
  id: number; action: string; entity: string; entity_id: number | null; details: string; created_at: string;
  user_name: string | null; where: string | null; person: string | null;
};
type D = Record<string, any>;

const LABEL: Record<string, string> = {
  'order.create': 'Opened order', 'kot.create': 'Sent KOT', 'item.cancel': 'Cancelled item', 'order.dining_done': 'Dining complete',
  'bill.generate': 'Generated bill', 'bill.regenerate': 'Updated bill', 'bill.pay': 'Payment received', 'bill.void': 'Voided bill',
  'bill.whatsapp': 'Sent bill on WhatsApp', 'order.reopen': 'Reopened table', 'order.cancel': 'Cancelled order', 'order.move': 'Moved table',
  'menu.add': 'Added menu item', 'menu.price': 'Changed price', 'menu.remove': 'Removed menu item', 'staff.add': 'Added staff',
  'staff.update': 'Updated staff', 'settings.update': 'Changed settings', 'tables.add': 'Added tables', 'tables.remove': 'Removed table',
  'permissions.update': 'Changed permissions', 'permissions.reset': 'Reset permissions', 'guest.approve': 'Approved guest phone',
  'guest.remove': 'Removed guest phones', 'reports.download': 'Downloaded report', 'reports.send': 'Emailed report',
  'compliance.upload': 'Added licence', 'compliance.delete': 'Removed licence', 'support.open': 'Asked YorMenu support',
  'subscription.payment': 'Paid subscription', 'password.change': 'Changed own password',
};

const SENSITIVE = ['item.cancel', 'bill.void', 'order.cancel', 'menu.price', 'order.reopen', 'permissions.update', 'permissions.reset'];
const METHOD: Record<string, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', other: 'Other' };
const STATUS: Record<string, string> = { queued: 'not started', cooking: 'being cooked', ready: 'ready', served: 'served' };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const reason = (r: unknown) => (typeof r === 'string' && r.trim() ? ` · Reason: “${r.trim()}”` : ' · No reason given');

/** One plain sentence about what happened, without ids or codes. */
function describe(r: Row, d: D, billPrefix: string): string {
  const at = r.where ? ` · ${r.where}` : '';
  const bill = (n: unknown) => `Bill ${billPrefix}${n ?? ''}`;
  switch (r.action) {
    case 'order.create': return `${d.type === 'takeaway' ? 'Parcel' : d.type === 'delivery' ? 'Delivery' : 'Dine-in'} order${at}`;
    case 'kot.create': return `KOT #${d.kotNo} · ${plural(d.items ?? 0, 'dish', 'dishes')}${d.source === 'qr' ? ' (ordered from guest phone)' : ''}${at}`;
    case 'item.cancel': return `${d.qty ?? ''} × ${d.name ?? 'item'}${d.was && STATUS[d.was] ? ` (was ${STATUS[d.was]})` : ''}${at}${reason(d.reason)}`;
    case 'order.dining_done': return r.where ?? '';
    case 'order.reopen': return `${r.where ?? 'Table'} opened again after the bill`;
    case 'order.cancel': return `${r.where ?? 'Order'} · ${d.items ? plural(d.items, 'dish', 'dishes') : 'nothing ordered yet'}${reason(d.reason)}`;
    case 'order.move': return `From table ${d.from ?? '?'} to table ${d.to ?? '?'}`;
    case 'bill.generate': return `${bill(d.billNo)} · ${rupees(d.grandTotal)}${at}`;
    case 'bill.regenerate': return `${bill(d.billNo)} · new total ${rupees(d.grandTotal)}${at}`;
    case 'bill.pay': {
      const pays = (Array.isArray(d.payments) ? d.payments : []).map((p: D) => `${rupees(p.amount)} ${METHOD[p.method] ?? p.method}`).join(' + ');
      return `${bill(d.billNo)} · ${pays || 'paid'}${at}`;
    }
    case 'bill.void': return `${bill(d.billNo)} · ${rupees(d.grandTotal)}${d.wasPaid ? ' (it was already paid)' : ''}${reason(d.reason)}`;
    case 'bill.whatsapp': return `Bill sent to ${d.phone ?? 'customer'}${at}`;
    case 'menu.add': return `${d.name} · ${rupees(d.price)}`;
    case 'menu.price': return `${d.name}: ${rupees(d.from)} → ${rupees(d.to)}`;
    case 'menu.remove': return d.name ?? '';
    case 'staff.add': return `${d.username} as ${ROLE_LABEL[d.role] ?? d.role}`;
    case 'staff.update': {
      const what: string[] = [];
      if (d.password) what.push('password reset');
      if (d.role) what.push(`role: ${ROLE_LABEL[d.role] ?? d.role}`);
      if (d.active === false) what.push('login switched off');
      if (d.active === true) what.push('login switched on');
      if (d.name) what.push(`name: ${d.name}`);
      if (d.phone !== undefined) what.push('phone');
      return `${r.person ?? d.username ?? 'Staff member'}${what.length ? ` · ${what.join(', ')}` : ''}`;
    }
    case 'settings.update': return 'Restaurant settings saved';
    case 'tables.add': return Array.isArray(d.labels) ? `${plural(d.labels.length, 'table')}: ${d.labels.join(', ')}` : '';
    case 'tables.remove': return `Table ${d.label ?? ''}`;
    case 'permissions.update': case 'permissions.reset': {
      const role = ROLE_LABEL[d.role] ?? d.role ?? '';
      const parts = [d.added?.length ? `${d.added.length} allowed` : '', d.removed?.length ? `${d.removed.length} taken away` : ''].filter(Boolean);
      return `${role}${parts.length ? ` · ${parts.join(', ')}` : ''}`;
    }
    case 'guest.approve': return `${d.name ?? 'Guest'} at table ${d.table ?? '?'}`;
    case 'guest.remove': return `${plural(d.phones ?? 0, 'phone')}${at}`;
    case 'reports.download': case 'reports.send': return [d.name, d.from && d.to ? `${d.from} to ${d.to}` : '', d.format?.toUpperCase()].filter(Boolean).join(' · ');
    case 'compliance.upload': return [d.docType?.toUpperCase(), d.number].filter(Boolean).join(' · ');
    case 'compliance.delete': return d.docType?.toUpperCase() ?? '';
    case 'support.open': return d.subject ?? '';
    case 'subscription.payment': return `Plan ${d.plan ?? ''} · UPI ref ${d.utr ?? ''}`;
    default: return '';
  }
}

export default function Audit() {
  const { me } = useSession();
  const [before, setBefore] = useState<number | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [onlySensitive, setOnlySensitive] = useState(false);
  const { error } = useLoad(async () => {
    const r = await api.get<Row[]>(`/audit${before ? `?before=${before}` : ''}`);
    setRows((prev) => (before ? [...prev, ...r] : r));
    return r;
  }, [before]);
  const billPrefix = me?.restaurant.settings.billPrefix ?? '';
  const parse = (s: string): D => { try { return JSON.parse(s) ?? {}; } catch { return {}; } };
  const shown = onlySensitive ? rows.filter((r) => SENSITIVE.includes(r.action)) : rows;
  return (
    <div className="page">
      <div className="page-head">
        <h1>Activity log</h1>
        <label className="row small" style={{ gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={onlySensitive} onChange={(e) => setOnlySensitive(e.target.checked)} />
          Only cancellations, voids and price changes
        </label>
      </div>
      {!rows.length ? <Loading error={error} /> : (
        <div className="card table-wrap">
          <table className="list">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
            <tbody>{shown.map((r) => {
              const text = describe(r, parse(r.details), billPrefix);
              return (
                <tr key={r.id}>
                  <td className="small" style={{ whiteSpace: 'nowrap' }}>{dateTimeOf(r.created_at)}</td>
                  <td>{r.user_name ?? 'YorMenu'}</td>
                  <td>{SENSITIVE.includes(r.action) ? <b style={{ color: 'var(--warn)' }}>{LABEL[r.action] ?? r.action}</b> : LABEL[r.action] ?? r.action}</td>
                  <td className="small">{text}</td>
                </tr>
              );
            })}</tbody>
          </table>
          {!shown.length && <div className="muted" style={{ padding: 16 }}>Nothing like that in these entries.</div>}
          {rows.length % 100 === 0 && <div style={{ padding: 12, textAlign: 'center' }}><button className="btn" onClick={() => setBefore(rows[rows.length - 1].id)}>Load older</button></div>}
        </div>
      )}
    </div>
  );
}
