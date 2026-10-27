import { useState } from 'react';
import { api } from '../api';
import { Loading, useAction, useLoad } from '../ui';
import { rupees, todayISO, isoDaysAgo, ROLE_LABEL, ORDER_TYPE_LABEL } from '../format';

const PRESETS: { label: string; range: () => [string, string] }[] = [
  { label: 'Today', range: () => [todayISO(), todayISO()] },
  { label: 'Yesterday', range: () => [isoDaysAgo(1), isoDaysAgo(1)] },
  { label: 'Last 7 days', range: () => [isoDaysAgo(6), todayISO()] },
  { label: 'This month', range: () => [todayISO().slice(0, 8) + '01', todayISO()] },
  { label: 'Last 30 days', range: () => [isoDaysAgo(29), todayISO()] },
];

export default function Reports() {
  const [[from, to], setRange] = useState<[string, string]>(PRESETS[0].range());
  const [tab, setTab] = useState<'sales' | 'items' | 'staff' | 'cancelled'>('sales');
  const qs = `from=${from}&to=${to}`;
  const { run } = useAction();
  const csv = (path: string, name: string) => run(() => api.download(`/reports/${path}?${qs}&format=csv`, `${name}-${from}-${to}.csv`));
  return (
    <div className="page">
      <div className="page-head">
        <h1>Reports</h1>
        <div className="row wrap">
          {PRESETS.map((p) => {
            const [f, t] = p.range();
            return <button key={p.label} className={`btn sm ${f === from && t === to ? 'primary' : ''}`} onClick={() => setRange([f, t])}>{p.label}</button>;
          })}
          <input type="date" style={{ width: 150 }} value={from} onChange={(e) => setRange([e.target.value, to])} />
          <input type="date" style={{ width: 150 }} value={to} onChange={(e) => setRange([from, e.target.value])} />
        </div>
      </div>
      <div className="tabs">
        {(['sales', 'items', 'staff', 'cancelled'] as const).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{{ sales: 'Sales', items: 'Items sold', staff: 'Staff performance', cancelled: 'Cancellations' }[t]}</button>
        ))}
        <span className="grow" />
        <button className="btn sm" onClick={() => csv(tab === 'sales' ? 'bills' : tab, tab)}>Download CSV</button>
      </div>
      {tab === 'sales' && <Sales qs={qs} />}
      {tab === 'items' && <Items qs={qs} />}
      {tab === 'staff' && <Staff qs={qs} />}
      {tab === 'cancelled' && <Cancelled qs={qs} />}
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
