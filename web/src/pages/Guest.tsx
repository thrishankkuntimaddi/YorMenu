import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { api } from '../api';
import { fbDb } from '../firebase';
import { Loading, Modal, useAction, useToast, VegMark } from '../ui';
import { rupees } from '../format';

type Menu = {
  rid: number;
  restaurant: { name: string; address: string; phone: string };
  table: { label: string };
  qrOrdering: boolean;
  taxNote: string;
  categories: { id: number; name: string }[];
  items: { id: number; category_id: number; name: string; description: string; price: number; is_veg: number; is_special: number; available: number }[];
};

/** Written by staff devices: this phone's table, once a staff member approved it. */
type Live = {
  status?: 'active' | 'denied' | 'ended' | 'closed';
  order_status?: string;
  table_label?: string | null;
  items?: { name: string; qty: number; price: number; status: string }[];
  subtotal?: number;
  bill?: { bill_no: number; grand_total: number; status: string } | null;
  requests?: Record<string, 'accepted' | 'rejected'>;
};
type Sent = { id: number; kind: string; text: string; at: number };

const ITEM_STATUS: Record<string, string> = { queued: 'Sent to kitchen', cooking: 'Cooking', ready: 'Ready', served: 'Served' };
const KIND_TEXT: Record<string, string> = { join: 'Asked to order from this phone', order: 'Order', call_waiter: 'Called a server', request_bill: 'Asked for the bill' };

/** A long random secret that identifies this phone to the staff (never shown). */
function newKey() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
}
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } },
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
  const [joining, setJoining] = useState(false);
  const [showOrder, setShowOrder] = useState(false);
  const [note, setNote] = useState('');
  const [key, setKeyState] = useState<string | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [sent, setSent] = useState<Sent[]>([]);
  const [lastCall, setLastCall] = useState(0);
  const { run, busy } = useAction();

  useEffect(() => { api.get<Menu>(`/public/t/${token}`).then(setMenu).catch((e) => setError(e.message)); }, [token]);

  // This phone's key is kept per restaurant, so it still works after staff move the order to another table.
  const keyName = menu ? `yormenu.guest.${menu.rid}` : null;
  useEffect(() => {
    if (!keyName) return;
    const k = store.get(keyName);
    setKeyState(k);
    try { setSent(k ? JSON.parse(store.get(`yormenu.guest.sent.${k}`) || '[]') : []); } catch { setSent([]); }
  }, [keyName]);
  const setKey = (k: string | null) => { if (keyName) store.set(keyName, k); setKeyState(k); setLive(null); setSent([]); };
  const remember = (s: Sent) => setSent((list) => { const next = [...list, s].slice(-30); if (key) store.set(`yormenu.guest.sent.${key}`, JSON.stringify(next)); return next; });

  useEffect(() => {
    if (!key) return;
    return onSnapshot(doc(fbDb(), `guest_live/${key}`), (snap) => setLive(snap.exists() ? (snap.data() as Live) : {}), () => setLive({}));
  }, [key]);

  // Staff said no, removed this phone, or the bill is paid: start fresh next time.
  useEffect(() => {
    if (live?.status === 'denied') { toast('The staff did not confirm this phone. Please ask a server.', 'err'); setKey(null); }
    if (live?.status === 'ended') { toast('Ordering from this phone was stopped by the staff.', 'err'); setKey(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live?.status]);

  // Tell the guest when something happens to their order (ordered → cooking → ready → served → bill).
  const prev = useRef<Live | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = live;
    if (!live || !before || live.status !== 'active' && live.status !== 'closed') return;
    const msgs: string[] = [];
    const count = (l: Live | null, st: string) => (l?.items ?? []).filter((i) => i.status === st).reduce((s, i) => s + i.qty, 0);
    for (const [id, st] of Object.entries(live.requests ?? {})) {
      if (before.requests?.[id] === st) continue;
      const req = sent.find((x) => `r${x.id}` === id);
      if (req?.kind === 'join' && st === 'accepted') msgs.push('You are confirmed. Order away!');
      if (req?.kind === 'order') msgs.push(st === 'accepted' ? 'Your order was accepted and sent to the kitchen.' : 'Your order was not accepted. Please ask a server.');
    }
    if (count(live, 'cooking') > count(before, 'cooking')) msgs.push('The kitchen is preparing your food. 👨‍🍳');
    if (count(live, 'ready') > count(before, 'ready')) msgs.push('Your food is ready and on its way!');
    if (count(live, 'served') > count(before, 'served')) msgs.push('Served. Enjoy your food! 😋');
    if (live.bill && !before.bill) msgs.push(`Your bill is ready: ${rupees(live.bill.grand_total)}.`);
    if (live.bill?.status === 'paid' && before.bill?.status !== 'paid') msgs.push('Payment received. Thank you for visiting! 🙏');
    if (!msgs.length) return;
    msgs.forEach((m) => toast(m, 'ok'));
    try { navigator.vibrate?.([120, 60, 120]); } catch { /* not supported */ }
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification(menu?.restaurant.name ?? 'YorMenu', { body: msgs.join(' ') }); } catch { /* ignore */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  const items = useMemo(() => (menu?.items ?? []).filter((i) => !vegOnly || i.is_veg), [menu, vegOnly]);
  if (!menu) return <Loading error={error} />;

  const active = live?.status === 'active';
  const closed = live?.status === 'closed';
  const waiting = !!key && !active && !closed;
  const count = Object.values(cart).reduce((s, q) => s + q, 0);
  const total = Object.entries(cart).reduce((s, [id, q]) => s + (menu.items.find((i) => i.id === Number(id))?.price ?? 0) * q, 0);
  const add = (id: number, d: number) => setCart((c) => { const n = { ...c }; const q = (n[id] ?? 0) + d; if (q <= 0) delete n[id]; else n[id] = q; return n; });
  const specials = items.filter((i) => i.is_special);
  const pending = sent.filter((s) => !live?.requests?.[`r${s.id}`] && s.kind !== 'call_waiter');

  const send = (kind: 'order' | 'call_waiter' | 'request_bill') => run(async () => {
    if (kind === 'call_waiter' && Date.now() - lastCall < 60_000) { toast('A server has been called. Please wait a moment.', 'info'); return; }
    const lines = Object.entries(cart).map(([id, qty]) => ({ menuItemId: Number(id), qty }));
    const r = await api.post<{ id: number }>(`/public/t/${token}/requests`, {
      kind, key: key ?? undefined, note: kind === 'order' ? note || undefined : undefined, items: kind === 'order' ? lines : undefined,
    });
    const text = kind === 'order' ? lines.map((l) => `${l.qty} × ${menu.items.find((i) => i.id === l.menuItemId)?.name}`).join(', ') : KIND_TEXT[kind];
    remember({ id: r.id, kind, text, at: Date.now() });
    if (kind === 'order') { setCart({}); setReview(false); setNote(''); setShowOrder(true); }
    if (kind === 'call_waiter') setLastCall(Date.now());
    toast(kind === 'order' ? 'Order sent. A server will confirm it before it goes to the kitchen.' : kind === 'call_waiter' ? 'A server is on the way.' : 'Your bill is on the way.', 'ok');
  });

  return (
    <div className="guest">
      <div className="guest-head">
        <div style={{ fontSize: 20, fontWeight: 800 }}>{menu.restaurant.name}</div>
        <div style={{ opacity: .9 }}>
          Table {active && live?.table_label ? live.table_label : menu.table.label}
          {active && live?.table_label && live.table_label !== menu.table.label ? ' (your table was changed)' : ''}
          {menu.restaurant.phone ? ` · ${menu.restaurant.phone}` : ''}
        </div>
      </div>

      {waiting && (
        <div className="guest-status">
          <span className="spinner" aria-hidden="true" />
          <div><b>Waiting for the staff to confirm your table…</b><div className="small">This keeps strangers from ordering on your table. You can choose items meanwhile.</div></div>
        </div>
      )}
      {active && (
        <button className="guest-status ok" onClick={() => setShowOrder(true)}>
          <span aria-hidden="true">✓</span>
          <div className="grow" style={{ textAlign: 'left' }}>
            <b>You can order from this phone</b>
            <div className="small">{live?.items?.length ? `${live.items.reduce((s, i) => s + i.qty, 0)} items · ${rupees(live.bill?.grand_total ?? live.subtotal ?? 0)}` : 'Nothing ordered yet'}{pending.length ? ` · ${pending.length} waiting for staff` : ''}</div>
          </div>
          <span className="small"><u>My order</u></span>
        </button>
      )}
      {closed && (
        <div className="guest-status ok">
          <span aria-hidden="true">🙏</span>
          <div className="grow"><b>{live?.order_status === 'paid' ? 'Bill paid. Thank you for visiting!' : 'This order is closed.'}</b></div>
          <button className="btn sm" onClick={() => setKey(null)}>Start again</button>
        </div>
      )}

      <div className="guest-cats">
        <label className="check" style={{ whiteSpace: 'nowrap' }}><input type="checkbox" checked={vegOnly} onChange={(e) => setVegOnly(e.target.checked)} />Veg only</label>
        {specials.length > 0 && <a href="#specials">★ Specials</a>}
        {menu.categories.map((c) => <a key={c.id} href={`#c${c.id}`}>{c.name}</a>)}
      </div>
      {specials.length > 0 && <Section id="specials" title="★ Today's specials" items={specials} cart={cart} add={add} ordering={menu.qrOrdering && !closed} />}
      {menu.categories.map((c) => {
        const its = items.filter((i) => i.category_id === c.id);
        return its.length ? <Section key={c.id} id={`c${c.id}`} title={c.name} items={its} cart={cart} add={add} ordering={menu.qrOrdering && !closed} /> : null;
      })}
      {menu.taxNote && <div className="small faint" style={{ padding: 16 }}>Prices exclude taxes ({menu.taxNote}).</div>}

      <div className="guest-bar">
        {count > 0 ? (
          <button className="btn primary lg grow" onClick={() => (active ? setReview(true) : waiting ? toast('Waiting for the staff to confirm your table…', 'info') : setJoining(true))}>
            {active ? `Review order · ${count} items · ${rupees(total)}` : waiting ? `Waiting for staff · ${count} items` : `Order ${count} items · ${rupees(total)}`}
          </button>
        ) : (
          <>
            <button className="btn lg grow" disabled={busy} onClick={() => send('call_waiter')}>Call server</button>
            {active
              ? <button className="btn dark lg grow" disabled={busy} onClick={() => send('request_bill')}>Ask for bill</button>
              : menu.qrOrdering && !waiting && <button className="btn primary lg grow" onClick={() => setJoining(true)}>Order from phone</button>}
          </>
        )}
      </div>

      {joining && <JoinModal menu={menu} token={token} onClose={() => setJoining(false)} onSent={(k, s) => {
        setKey(k);
        store.set(`yormenu.guest.sent.${k}`, JSON.stringify([s]));
        setSent([s]);
        setJoining(false);
      }} />}

      {review && (
        <Modal title="Your order" onClose={() => setReview(false)} footer={<><button className="btn" onClick={() => setReview(false)}>Add more</button><button className="btn primary" disabled={busy} onClick={() => send('order')}>Send order</button></>}>
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
          <div className="small muted">A server confirms your order before it goes to the kitchen. You can follow it here.</div>
        </Modal>
      )}

      {showOrder && (
        <Modal title={`My order · Table ${live?.table_label ?? menu.table.label}`} onClose={() => setShowOrder(false)}>
          {pending.length > 0 && (
            <div className="stack">
              <div className="section-title" style={{ margin: 0 }}>Waiting for staff</div>
              {pending.map((s) => <div key={s.id} className="row between"><span>{s.text}</span><span className="pill unpaid">Waiting</span></div>)}
            </div>
          )}
          {sent.filter((s) => live?.requests?.[`r${s.id}`] === 'rejected').slice(-3).map((s) => (
            <div key={s.id} className="row between small"><span>{s.text}</span><span className="pill void">Not accepted</span></div>
          ))}
          <div className="section-title" style={{ margin: 0 }}>In the kitchen &amp; on your table</div>
          {!live?.items?.length && <div className="muted">Nothing yet.</div>}
          {live?.items?.map((i, n) => (
            <div key={n} className="row between">
              <span>{i.qty} × {i.name}</span>
              <span className={`pill ${i.status}`}>{ITEM_STATUS[i.status] ?? i.status}</span>
            </div>
          ))}
          {live?.bill ? (
            <div className="row between"><b>Bill no. {live.bill.bill_no}{live.bill.status === 'paid' ? ' · paid' : ''}</b><b>{rupees(live.bill.grand_total)}</b></div>
          ) : live?.items?.length ? (
            <div className="row between"><b>So far</b><b>{rupees(live.subtotal ?? 0)}</b></div>
          ) : null}
          <div className="small muted">This updates by itself.</div>
        </Modal>
      )}
    </div>
  );
}

function JoinModal({ menu, token, onClose, onSent }: { menu: Menu; token: string; onClose: () => void; onSent: (key: string, s: Sent) => void }) {
  const [name, setName] = useState(() => store.get('yormenu.guest.name') ?? '');
  const [phone, setPhone] = useState(() => store.get('yormenu.guest.phone') ?? '');
  const { run, busy } = useAction();
  const ok = name.trim().length > 0 && /^\d{10}$/.test(phone);
  const submit = () => run(async () => {
    const key = newKey();
    const r = await api.post<{ id: number }>(`/public/t/${token}/requests`, { kind: 'join', key, name: name.trim(), phone });
    try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {}); } catch { /* ignore */ }
    store.set('yormenu.guest.name', name.trim());
    store.set('yormenu.guest.phone', phone);
    onSent(key, { id: r.id, kind: 'join', text: KIND_TEXT.join, at: Date.now() });
  });
  return (
    <Modal title={`Order from Table ${menu.table.label}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!ok || busy} onClick={submit}>Ask to order</button></>}>
      <div className="small muted">A staff member confirms your phone once, so nobody else can order on your table. It takes a few seconds.</div>
      <label>Your name<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" autoFocus /></label>
      <label>Mobile number<input value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(-10))} inputMode="numeric" autoComplete="tel-national" placeholder="10 digits" /></label>
    </Modal>
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
