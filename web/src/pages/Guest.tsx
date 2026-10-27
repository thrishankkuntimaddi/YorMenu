import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { Loading, Modal, useAction, useToast, VegMark } from '../ui';
import { rupees } from '../format';

type Menu = {
  restaurant: { name: string; address: string; phone: string };
  table: { label: string };
  qrOrdering: boolean;
  taxNote: string;
  categories: { id: number; name: string }[];
  items: { id: number; category_id: number; name: string; description: string; price: number; is_veg: number; is_special: number; available: number }[];
};

/** Public page a guest sees after scanning the table QR code. */
export default function Guest() {
  const token = useParams().token!;
  const toast = useToast();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cart, setCart] = useState<Record<number, number>>({});
  const [vegOnly, setVegOnly] = useState(false);
  const [review, setReview] = useState(false);
  const [note, setNote] = useState('');
  const { run, busy } = useAction();

  useEffect(() => { api.get<Menu>(`/public/t/${token}`).then(setMenu).catch((e) => setError(e.message)); }, [token]);
  const items = useMemo(() => (menu?.items ?? []).filter((i) => !vegOnly || i.is_veg), [menu, vegOnly]);
  if (!menu) return <Loading error={error} />;

  const count = Object.values(cart).reduce((s, q) => s + q, 0);
  const total = Object.entries(cart).reduce((s, [id, q]) => s + (menu.items.find((i) => i.id === Number(id))?.price ?? 0) * q, 0);
  const add = (id: number, d: number) => setCart((c) => { const n = { ...c }; const q = (n[id] ?? 0) + d; if (q <= 0) delete n[id]; else n[id] = q; return n; });
  const send = (kind: 'order' | 'call_waiter' | 'request_bill') => run(async () => {
    await api.post(`/public/t/${token}/requests`, { kind, note: note || undefined, items: kind === 'order' ? Object.entries(cart).map(([id, qty]) => ({ menuItemId: Number(id), qty })) : undefined });
    if (kind === 'order') { setCart({}); setReview(false); setNote(''); }
    toast(kind === 'order' ? 'Order sent! A server will confirm it shortly.' : kind === 'call_waiter' ? 'A server is on the way.' : 'Your bill is on the way.', 'ok');
  });
  const specials = items.filter((i) => i.is_special);

  return (
    <div className="guest">
      <div className="guest-head">
        <div style={{ fontSize: 20, fontWeight: 800 }}>{menu.restaurant.name}</div>
        <div style={{ opacity: .9 }}>Table {menu.table.label}{menu.restaurant.phone ? ` · ${menu.restaurant.phone}` : ''}</div>
      </div>
      <div className="guest-cats">
        <label className="check" style={{ whiteSpace: 'nowrap' }}><input type="checkbox" checked={vegOnly} onChange={(e) => setVegOnly(e.target.checked)} />Veg only</label>
        {specials.length > 0 && <a href="#specials">★ Specials</a>}
        {menu.categories.map((c) => <a key={c.id} href={`#c${c.id}`}>{c.name}</a>)}
      </div>
      {specials.length > 0 && <Section id="specials" title="★ Today's specials" items={specials} cart={cart} add={add} ordering={menu.qrOrdering} />}
      {menu.categories.map((c) => {
        const its = items.filter((i) => i.category_id === c.id);
        return its.length ? <Section key={c.id} id={`c${c.id}`} title={c.name} items={its} cart={cart} add={add} ordering={menu.qrOrdering} /> : null;
      })}
      {menu.taxNote && <div className="small faint" style={{ padding: 16 }}>Prices exclude taxes ({menu.taxNote}).</div>}
      <div className="guest-bar">
        {count > 0 ? (
          <button className="btn primary lg grow" onClick={() => setReview(true)}>View order · {count} items · {rupees(total)}</button>
        ) : (
          <>
            <button className="btn lg grow" disabled={busy} onClick={() => send('call_waiter')}>Call server</button>
            <button className="btn dark lg grow" disabled={busy} onClick={() => send('request_bill')}>Ask for bill</button>
          </>
        )}
      </div>
      {review && (
        <Modal title="Your order" onClose={() => setReview(false)} footer={<><button className="btn" onClick={() => setReview(false)}>Add more</button><button className="btn primary" disabled={busy} onClick={() => send('order')}>Place order</button></>}>
          {Object.entries(cart).map(([id, q]) => {
            const it = menu.items.find((i) => i.id === Number(id))!;
            return (
              <div key={id} className="row between">
                <span className="row"><VegMark veg={it.is_veg} />{it.name}</span>
                <span className="row"><div className="qty"><button onClick={() => add(it.id, -1)}>−</button><span>{q}</span><button onClick={() => add(it.id, 1)}>+</button></div><span style={{ width: 70, textAlign: 'right' }}>{rupees(it.price * q)}</span></span>
              </div>
            );
          })}
          <label>Anything the kitchen should know?<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Less spicy, no onion…" /></label>
          <div className="row between"><b>Total</b><b>{rupees(total)}</b></div>
          <div className="small muted">A server will confirm your order before it goes to the kitchen.</div>
        </Modal>
      )}
    </div>
  );
}

function Section({ id, title, items, cart, add, ordering }: { id: string; title: string; items: Menu['items']; cart: Record<number, number>; add: (id: number, d: number) => void; ordering: boolean }) {
  return (
    <div id={id} style={{ scrollMarginTop: 56 }}>
      <div className="section-title" style={{ padding: '0 16px' }}>{title}</div>
      {items.map((i) => (
        <div key={i.id} className="guest-item" style={i.available ? undefined : { opacity: .5 }}>
          <VegMark veg={i.is_veg} />
          <div className="grow">
            <div style={{ fontWeight: 600 }}>{i.name}</div>
            {i.description && <div className="small muted">{i.description}</div>}
            <div className="small">{rupees(i.price)}</div>
          </div>
          {!i.available ? <span className="small faint">Sold out</span> : ordering && (
            cart[i.id] ? <div className="qty"><button onClick={() => add(i.id, -1)}>−</button><span>{cart[i.id]}</span><button onClick={() => add(i.id, 1)}>+</button></div>
              : <button className="btn sm" onClick={() => add(i.id, 1)}>Add</button>
          )}
        </div>
      ))}
    </div>
  );
}
