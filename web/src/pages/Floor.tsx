import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useLive } from '../live';
import { Loading, Modal, useAction, useLoad, useTick } from '../ui';
import { elapsed, rupeesShort } from '../format';
import { Icon } from '../icons';
import type { Floor as FloorT, Order, TableState } from '../types';
import { STATE_STYLE, useT } from '../i18n';

export default function Floor() {
  const nav = useNavigate();
  const { data, error, reload } = useLoad(() => api.get<FloorT>('/floor'));
  const { run, busy } = useAction();
  const [newOrder, setNewOrder] = useState<null | 'takeaway' | 'delivery'>(null);
  const [billQ, setBillQ] = useState('');
  useLive(['floor:changed', 'reconnect'], reload);
  useTick();
  const t = useT();

  if (!data) return <Loading error={error} />;

  const openTable = async (tableId: number, orderId?: number) => {
    if (orderId) return nav(`/order/${orderId}`);
    try {
      const o = await api.post<Order>('/orders', { type: 'dine_in', tableId });
      nav(`/order/${o.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.details?.orderId) nav(`/order/${e.details.orderId}`);
      else run(() => Promise.reject(e));
    }
  };

  const counts = data.tables.reduce<Record<string, number>>((m, x) => ({ ...m, [x.state]: (m[x.state] ?? 0) + 1 }), {});
  return (
    <div className="page">
      <div className="page-head">
        <h1>{t('Tables')}</h1>
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (billQ.trim()) nav(`/bills?q=${encodeURIComponent(billQ.trim())}`); }}>
 <input style={{ width: 150 }} placeholder={t('Bill no. / phone')} value={billQ} onChange={(e) => setBillQ(e.target.value)} />
        </form>
        <button className="btn" onClick={() => setNewOrder('takeaway')}><Icon name="plus" size={16} />{t('Parcel')}</button>
        <button className="btn primary" onClick={() => setNewOrder('delivery')}><Icon name="plus" size={16} />{t('Delivery')}</button>
      </div>

      <div className="legend">
        {(['free', 'seated', 'cooking', 'ready', 'running', 'dining_done', 'billed', 'cleaning'] as TableState[]).map((st) => (
          <span key={st} className={`legend-chip st-${st}`}>
            <span aria-hidden="true">{STATE_STYLE[st].emoji}</span>{t(STATE_STYLE[st].label)}{counts[st] ? <b>{counts[st]}</b> : null}
          </span>
        ))}
      </div>

      {data.others.length > 0 && (
        <>
          <div className="section-title">{t('Parcel & delivery')}</div>
          <div className="tiles">
            {data.others.map((o) => (
              <button key={o.id} className={`tile st-${o.state}`} onClick={() => nav(`/order/${o.id}`)}>
                <span className="st-emoji" aria-hidden="true">{STATE_STYLE[o.state].emoji}</span>
                {o.ready > 0 && <span className="badge">{o.ready} 🔔</span>}
                <span className="meta">{elapsed(o.opened_at)}</span>
                <span className="lbl" style={{ fontSize: 13 }}>{o.where}</span>
                {o.customer_name && <span className="meta">{o.customer_name}</span>}
                <span className="amt">{rupeesShort(o.bill_total ?? o.amount)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {data.sections.map((s) => {
        const tables = data.tables.filter((x) => x.section_id === s.id);
        if (!tables.length) return null;
        return (
          <div key={s.id}>
            <div className="section-title">{s.name}</div>
            <div className="tiles">
              {tables.map((tb) => (
                <button key={tb.id} className={`tile st-${tb.state}`} disabled={busy} onClick={() => openTable(tb.id, tb.order?.id)}
                  title={t(STATE_STYLE[tb.state].label)}>
                  <span className="st-emoji" aria-hidden="true">{STATE_STYLE[tb.state].emoji}</span>
                  {tb.order && tb.order.ready > 0 && <span className="badge">{tb.order.ready} 🔔</span>}
                  {tb.order && <span className="meta">{elapsed(tb.order.opened_at)}</span>}
                  <span className="lbl">{tb.label}</span>
                  {tb.order ? (
                    <>
                      <span className="amt">{rupeesShort(tb.order.bill_total ?? tb.order.amount)}</span>
                      {tb.order.server_name && <span className="meta">{tb.order.server_name}</span>}
                    </>
                  ) : <span className="meta">{tb.state === 'free' ? `${tb.seats} ${t('seats')}` : t(STATE_STYLE[tb.state].label)}</span>}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {!data.tables.length && <div className="empty">No tables yet. An owner or manager can add them under Floor plan.</div>}
      {newOrder && <NewOrderModal type={newOrder} onClose={() => setNewOrder(null)} onCreated={(id) => nav(`/order/${id}`)} />}
    </div>
  );
}

function NewOrderModal({ type, onClose, onCreated }: { type: 'takeaway' | 'delivery'; onClose: () => void; onCreated: (id: number) => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const { run, busy } = useAction();
  const submit = () => run(async () => {
    const o = await api.post<Order>('/orders', { type, customerName: name, customerPhone: phone, customerAddress: address });
    onCreated(o.id);
  });
  return (
    <Modal title={type === 'delivery' ? 'New delivery order' : 'New parcel order'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || (type === 'delivery' && !phone)} onClick={submit}>Start order</button></>}>
      <label>Customer name<input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
      <label>Mobile number {type === 'delivery' ? '' : '(optional, for WhatsApp bill)'}<input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
      {type === 'delivery' && <label>Address<textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} /></label>}
    </Modal>
  );
}
