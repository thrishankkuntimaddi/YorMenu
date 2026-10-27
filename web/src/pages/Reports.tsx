import { useEffect, useState } from 'react';
import { api } from '../api';
import { useSession } from '../session';
import { Loading, Modal, useAction, useLoad } from '../ui';
import { rupees, todayISO, isoDaysAgo, ROLE_LABEL, ORDER_TYPE_LABEL, dateTimeOf } from '../format';
import { Icon } from '../icons';
import { useT } from '../i18n';

type Period = 'day' | 'week' | 'month' | 'custom';
const PERIODS: { key: Period; label: string; range: () => [string, string] }[] = [
  { key: 'day', label: 'Today', range: () => [todayISO(), todayISO()] },
  { key: 'week', label: 'Week', range: () => [isoDaysAgo(6), todayISO()] },
  { key: 'month', label: 'Month', range: () => [todayISO().slice(0, 8) + '01', todayISO()] },
];

type Tab = 'sales' | 'items' | 'staff' | 'cancelled';

export default function Reports() {
  const { can } = useSession();
  const t = useT();
  const [period, setPeriod] = useState<Period>('day');
  const [[from, to], setRange] = useState<[string, string]>(PERIODS[0].range());
  const [tab, setTab] = useState<Tab>('sales');
  const [sent, setSent] = useState<any>(null);
  const qs = `from=${from}&to=${to}`;
  const fileQs = period === 'custom' ? `period=custom&${qs}` : `period=${period}&anchor=${to}`;
  const { run, busy } = useAction();
  const download = (format: 'xlsx' | 'csv') => run(() => api.download(`/reports/export?${fileQs}&format=${format}`));
  const send = (email: boolean) => run(async () => {
    const out = await api.post('/reports/send', period === 'custom' ? { period, from, to, email } : { period, anchor: to, email });
    setSent(out);
  });
  const pick = (p: Period) => {
    setPeriod(p);
    const preset = PERIODS.find((x) => x.key === p);
    if (preset) setRange(preset.range());
  };
  const tabs: [Tab, string][] = [
    ['sales', 'Sales'], ['items', 'Items sold'], ['staff', 'Staff performance'], ['cancelled', 'Cancellations'],
  ];
  return (
    <div className="page">
      <div className="page-head">
        <h1>{t('Reports')}</h1>
        <div className="segmented">
          {PERIODS.map((p) => <button key={p.key} className={period === p.key ? 'on' : ''} onClick={() => pick(p.key)}>{t(p.label)}</button>)}
          <button className={period === 'custom' ? 'on' : ''} onClick={() => setPeriod('custom')}>{t('Custom')}</button>
        </div>
        {period === 'custom' ? (
          <div className="row">
            <input type="date" style={{ width: 150 }} value={from} max={to} onChange={(e) => setRange([e.target.value, to])} />
            <span className="faint">to</span>
            <input type="date" style={{ width: 150 }} value={to} min={from} max={todayISO()} onChange={(e) => setRange([from, e.target.value])} />
          </div>
        ) : (
          <input type="date" title="Period ends on" style={{ width: 150 }} value={to} max={todayISO()} onChange={(e) => {
            const end = e.target.value;
            const d = new Date(end + 'T00:00:00');
            const start = period === 'day' ? end : period === 'week'
              ? new Date(d.getTime() - 6 * 86400000 - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
              : end.slice(0, 8) + '01';
            setRange([start, end]);
          }} />
        )}
      </div>

      {can('reports.export') && (
        <div className="card pad row wrap" style={{ marginBottom: 12, gap: 8 }}>
          <b className="grow" style={{ minWidth: 160 }}>{from === to ? from : `${from} → ${to}`}</b>
          <button className="btn" disabled={busy} onClick={() => download('xlsx')}><Icon name="download" size={16} />Excel</button>
          <button className="btn" disabled={busy} onClick={() => download('csv')}><Icon name="download" size={16} />CSV</button>
          <button className="btn ok" disabled={busy} onClick={() => send(false)}><Icon name="whatsapp" size={16} />WhatsApp summary</button>
        </div>
      )}

      <div className="tabs">
        {tabs.map(([k, label]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      {tab === 'sales' && <Sales qs={qs} />}
      {tab === 'items' && <Items qs={qs} />}
      {tab === 'staff' && <Staff qs={qs} />}
      {tab === 'cancelled' && <Cancelled qs={qs} />}
      {sent && (
        <Modal title="Report ready" onClose={() => setSent(null)} footer={<>
          <button className="btn" onClick={() => setSent(null)}>Close</button>
          <a className="btn ok" href={sent.whatsappUrl} target="_blank" rel="noreferrer"><Icon name="whatsapp" />Open WhatsApp</a>
        </>}>
          <div className="stat"><div className="k">Net sales</div><div className="v">{rupees(sent.summary.netSales)}</div><div className="muted">{sent.summary.bills} bills</div></div>
          {sent.emailStatus === 'sent' && <div className="callout">Emailed to {sent.emailedTo} with Excel and PDF attached.</div>}
          {sent.emailStatus.startsWith('failed') && <div className="err">Email not sent: {sent.emailStatus.slice(8)}</div>}
          {!sent.emailStatus && <div className="small muted">Tap “Open WhatsApp” to send the summary to the owner (uses the owner's phone number from Staff).</div>}
        </Modal>
      )}
    </div>
  );
}

function Sales({ qs }: { qs: string }) {
  const { data, error } = useLoad(() => api.get(`/reports/summary?${qs}`), [qs]);
  if (!data) return <Loading error={error} />;
  const t = data.totals;
  const maxDay = Math.max(1, ...data.byDay.map((d: any) => d.amount));
  const maxM = Math.max(1, ...data.byMethod.map((d: any) => d.amount));
  return (
    <div className="stack lg">
      <div className="stats">
        <div className="card stat"><div className="k">Net sales</div><div className="v">{rupees(t.grand_total)}</div></div>
        <div className="card stat"><div className="k">Bills</div><div className="v">{t.bills}</div></div>
        <div className="card stat"><div className="k">Average bill</div><div className="v">{rupees(t.bills ? Math.round(t.grand_total / t.bills) : 0)}</div></div>
        <div className="card stat"><div className="k">Items sold</div><div className="v">{t.items}</div></div>
        <div className="card stat"><div className="k">Tax collected</div><div className="v">{rupees(t.tax)}</div></div>
        <div className="card stat"><div className="k">Discounts given</div><div className="v">{rupees(t.discount)}</div></div>
      </div>
      <div className="grid2">
        <div className="card pad stack">
          <h2>By payment method</h2>
          <div className="bars">{data.byMethod.map((m: any) => (
            <div key={m.method} className="bar"><span>{m.method.toUpperCase()}</span><div className="track"><div className="fill" style={{ width: `${(m.amount / maxM) * 100}%` }} /></div><span className="r">{rupees(m.amount)}</span></div>
          ))}{!data.byMethod.length && <span className="faint">No sales</span>}</div>
        </div>
        <div className="card pad stack">
          <h2>By order type</h2>
          <table className="list"><tbody>{data.byType.map((m: any) => (
            <tr key={m.order_type}><td>{ORDER_TYPE_LABEL[m.order_type]}</td><td className="r">{m.bills} bills</td><td className="r"><b>{rupees(m.amount)}</b></td></tr>
          ))}</tbody></table>
          {!data.byType.length && <span className="faint">No sales</span>}
        </div>
        <div className="card pad stack">
          <h2>Open & void</h2>
          <div className="row between"><span>Unpaid bills</span><span>{data.unpaid.bills} · {rupees(data.unpaid.amount)}</span></div>
          <div className="row between"><span>Voided bills</span><span>{data.voided.bills} · {rupees(data.voided.amount)}</span></div>
        </div>
      </div>
      {data.byDay.length > 1 && (
        <div className="card pad stack">
          <h2>Day by day</h2>
          <div className="bars">{data.byDay.map((d: any) => (
            <div key={d.day} className="bar"><span>{d.day.slice(5)}</span><div className="track"><div className="fill" style={{ width: `${(d.amount / maxDay) * 100}%` }} /></div><span className="r">{rupees(d.amount)}</span></div>
          ))}</div>
        </div>
      )}
    </div>
  );
}

function Items({ qs }: { qs: string }) {
  const { data, error } = useLoad(() => api.get<any[]>(`/reports/items?${qs}`), [qs]);
  if (!data) return <Loading error={error} />;
  return (
    <div className="card table-wrap">
      <table className="list"><thead><tr><th>#</th><th>Item</th><th className="r">Qty</th><th className="r">Orders</th><th className="r">Amount</th></tr></thead>
        <tbody>{data.map((r, i) => <tr key={r.name}><td className="faint">{i + 1}</td><td>{r.name}</td><td className="r"><b>{r.qty}</b></td><td className="r">{r.orders}</td><td className="r">{rupees(r.amount)}</td></tr>)}</tbody>
      </table>
      {!data.length && <div className="empty">No items sold in this period.</div>}
    </div>
  );
}

function Staff({ qs }: { qs: string }) {
  const { data, error } = useLoad(() => api.get<any[]>(`/reports/staff?${qs}`), [qs]);
  if (!data) return <Loading error={error} />;
  return (
    <div className="card table-wrap">
      <table className="list">
        <thead><tr><th>Name</th><th>Role</th><th className="r">Tables served</th><th className="r">Sales</th><th className="r">KOTs sent</th><th className="r">Items served</th><th className="r">Items cooked</th><th className="r">Avg cook time</th><th className="r">Bills settled</th><th className="r">Collected</th><th className="r">Tables cleaned</th></tr></thead>
        <tbody>{data.map((u) => (
          <tr key={u.id} style={u.active ? undefined : { opacity: .5 }}>
            <td><b>{u.name}</b></td><td className="small">{ROLE_LABEL[u.role]}</td>
            <td className="r">{u.orders || '—'}</td><td className="r">{u.sales ? rupees(u.sales) : '—'}</td><td className="r">{u.kots || '—'}</td>
            <td className="r">{u.itemsServed || '—'}</td><td className="r">{u.itemsCooked || '—'}</td><td className="r">{u.avgCookMinutes != null ? `${u.avgCookMinutes} min` : '—'}</td>
            <td className="r">{u.billsSettled || '—'}</td><td className="r">{u.amountCollected ? rupees(u.amountCollected) : '—'}</td><td className="r">{u.tablesCleaned || '—'}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function Cancelled({ qs }: { qs: string }) {
  const { data, error } = useLoad(() => api.get<any[]>(`/reports/cancellations?${qs}`), [qs]);
  if (!data) return <Loading error={error} />;
  return (
    <div className="card table-wrap">
      <table className="list"><thead><tr><th>Item</th><th className="r">Qty</th><th className="r">Value</th><th>Reason</th><th>By</th></tr></thead>
        <tbody>{data.map((r, i) => <tr key={i}><td>{r.name}</td><td className="r">{r.qty}</td><td className="r">{rupees(r.price * r.qty)}</td><td>{r.cancel_reason}</td><td>{r.cancelled_by}</td></tr>)}</tbody>
      </table>
      {!data.length && <div className="empty">No cancellations. 👍</div>}
    </div>
  );
}
