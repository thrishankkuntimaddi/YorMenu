import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useLive } from '../live';
import { useSession } from '../session';
import { Loading, Modal, PromptModal, useAction, useLoad } from '../ui';
import { rupees, todayISO, dateTimeOf, ORDER_TYPE_LABEL } from '../format';
import { billHtml } from '../print';
import { printBill, WhatsAppModal } from './OrderScreen';
import { Icon } from '../icons';
import type { BillTicket } from '../types';

type BillRow = {
  id: number; bill_no: number; business_date: string; grand_total: number; status: 'unpaid' | 'paid' | 'void'; created_at: string;
  order_id: number; order_type: string; customer_name: string; customer_phone: string; table_label: string | null; cashier_name: string; methods: string | null;
};

export default function Bills() {
  const [params, setParams] = useSearchParams();
  const [from, setFrom] = useState(params.get('from') ?? todayISO());
  const [to, setTo] = useState(params.get('to') ?? todayISO());
  const [q, setQ] = useState(params.get('q') ?? '');
  const [open, setOpen] = useState<BillRow | null>(null);
  const query = params.get('q') ? `q=${encodeURIComponent(params.get('q')!)}` : `from=${params.get('from') ?? todayISO()}&to=${params.get('to') ?? todayISO()}`;
  const { data, error, reload } = useLoad(() => api.get<BillRow[]>(`/bills?${query}`), [query]);
  useLive(['bills:changed', 'reconnect'], reload);

  const totals = (data ?? []).reduce((m, b) => { m[b.status] = (m[b.status] ?? 0) + b.grand_total; return m; }, {} as Record<string, number>);
  return (
    <div className="page">
      <div className="page-head">
        <h1>Bills</h1>
        <form className="row wrap" onSubmit={(e) => { e.preventDefault(); setParams(q.trim() ? { q: q.trim() } : { from, to }); }}>
          <input style={{ width: 150 }} placeholder="Bill no. / phone" value={q} onChange={(e) => setQ(e.target.value)} />
          <input type="date" style={{ width: 150 }} value={from} onChange={(e) => { setFrom(e.target.value); setQ(''); }} />
          <input type="date" style={{ width: 150 }} value={to} onChange={(e) => { setTo(e.target.value); setQ(''); }} />
          <button className="btn"><Icon name="search" size={16} />Find</button>
        </form>
      </div>
      {data && (
        <div className="stats" style={{ marginBottom: 12 }}>
          <div className="card stat"><div className="k">Paid</div><div className="v">{rupees(totals.paid)}</div></div>
          <div className="card stat"><div className="k">Unpaid (bill printed)</div><div className="v">{rupees(totals.unpaid)}</div></div>
          <div className="card stat"><div className="k">Bills</div><div className="v">{data.length}</div></div>
        </div>
      )}
      {!data ? <Loading error={error} /> : (
        <div className="card table-wrap">
          <table className="list">
            <thead><tr><th>Bill no.</th><th>Time</th><th>Where</th><th>Customer</th><th>Payment</th><th>Status</th><th className="r">Amount</th></tr></thead>
            <tbody>
              {data.map((b) => (
                <tr key={b.id} className="click" onClick={() => setOpen(b)}>
                  <td><b>{b.bill_no}</b></td>
                  <td className="small">{dateTimeOf(b.created_at)}</td>
                  <td>{b.order_type === 'dine_in' ? b.table_label : ORDER_TYPE_LABEL[b.order_type]}</td>
                  <td className="small">{b.customer_name} {b.customer_phone}</td>
                  <td className="small">{b.methods?.toUpperCase() ?? '—'}</td>
                  <td><span className={`pill ${b.status}`}>{b.status}</span></td>
                  <td className="r"><b>{rupees(b.grand_total)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.length && <div className="empty">No bills for this search.</div>}
        </div>
      )}
      {open && <BillDetail bill={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  );
}

function BillDetail({ bill, onClose, onChanged }: { bill: BillRow; onClose: () => void; onChanged: () => void }) {
  const nav = useNavigate();
  const { can } = useSession();
  const { data } = useLoad(() => api.get<BillTicket>(`/bills/${bill.id}/ticket`), [bill.id]);
  const { run } = useAction();
  const [sub, setSub] = useState<null | 'wa' | 'void'>(null);
  return (
    <Modal title={`Bill ${data?.billNo ?? bill.bill_no}`} onClose={onClose} footer={<>
      {can('bill.void') && bill.status !== 'void' && <button className="btn danger" onClick={() => setSub('void')}>Void bill</button>}
      <button className="btn" onClick={() => nav(`/order/${bill.order_id}`)}>Open order</button>
      <button className="btn" onClick={() => setSub('wa')}><Icon name="whatsapp" size={16} />WhatsApp</button>
      <button className="btn primary" onClick={() => run(() => printBill(bill.id))}><Icon name="printer" size={16} />Print</button>
    </>}>
      {!data ? 'Loading…' : (
        <div style={{ background: '#fff', color: '#000', border: '1px solid var(--line)', borderRadius: 8, padding: 12, fontFamily: "'Courier New', monospace", fontSize: 12, maxWidth: 340, margin: '0 auto', width: '100%' }}
          dangerouslySetInnerHTML={{ __html: `<style>.c{text-align:center}.r{text-align:right}.b{font-weight:700}.big{font-size:16px;font-weight:700}hr{border:0;border-top:1px dashed #000;margin:4px 0}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:1px 0}th.r,td.r{text-align:right}.row{display:flex;justify-content:space-between;gap:8px}h1{font-size:15px;text-align:center;margin:0}</style>${billHtml(data)}` }} />
      )}
      {sub === 'wa' && <WhatsAppModal billId={bill.id} phone={bill.customer_phone} onClose={() => setSub(null)} />}
      {sub === 'void' && <PromptModal title="Void this bill?" label="Reason (kept in the activity log)" danger confirmText="Void bill" onClose={() => setSub(null)}
        onSubmit={(reason) => run(async () => { await api.post(`/bills/${bill.id}/void`, { reason }); setSub(null); onChanged(); onClose(); }, 'Bill voided')} />}
    </Modal>
  );
}
