import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useLive } from '../live';
import { useSession } from '../session';
import { useCatalog } from '../catalog';
import { Loading, Modal, PromptModal, useAction, useLoad, useTick, useToast, VegMark } from '../ui';
import { elapsed, rupees, ORDER_TYPE_LABEL, toPaise } from '../format';
import { printHtml, kotHtml, billHtml } from '../print';
import { Icon } from '../icons';
import type { Order, OrderItem, MenuItem, KotTicket, BillTicket } from '../types';

type CartLine = { qty: number; note: string };
type Cart = Record<number, CartLine>;

const cartKey = (id: number) => `cuddly.cart.${id}`;
function loadCart(id: number): Cart { try { return JSON.parse(localStorage.getItem(cartKey(id)) || '{}'); } catch { return {}; } }
function saveCart(id: number, c: Cart) { try { Object.keys(c).length ? localStorage.setItem(cartKey(id), JSON.stringify(c)) : localStorage.removeItem(cartKey(id)); } catch { /* ignore */ } }

const STATUS_TEXT: Record<string, string> = { queued: 'In queue', cooking: 'Cooking', ready: 'Ready', served: 'Served', cancelled: 'Cancelled' };
const ORDER_STATUS_TEXT: Record<string, string> = { open: 'Running', dining_done: 'Dining done', billed: 'Bill printed', paid: 'Paid', cancelled: 'Cancelled' };

export async function printKot(kotId: number) {
  const t = await api.get<KotTicket>(`/kots/${kotId}/ticket`);
  if (!t.items.length) return;
  await printHtml(kotHtml(t));
  api.post(`/kots/${kotId}/printed`).catch(() => {});
}
export async function printBill(billId: number) {
  const t = await api.get<BillTicket>(`/bills/${billId}/ticket`);
  await printHtml(billHtml(t));
}

export default function OrderScreen() {
  const id = Number(useParams().id);
  const nav = useNavigate();
  const toast = useToast();
  const { can, me } = useSession();
  const { catalog } = useCatalog();
  const { data: order, error, reload, setData } = useLoad(() => api.get<Order>(`/orders/${id}`), [id]);
  const { run, busy } = useAction();
  const [cart, setCartState] = useState<Cart>(() => loadCart(id));
  const [cat, setCat] = useState<number | 'all' | 'special'>('all');
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'menu' | 'order'>('menu');
  const [modal, setModal] = useState<null | 'bill' | 'pay' | 'whatsapp' | 'customer' | 'move' | 'cancel' | { cancelItem: OrderItem } | { note: number }>(null);
  useTick();

  useLive(['order:changed', 'reconnect'], (p) => { if (!p?.orderId || p.orderId === id) reload(); });
  useEffect(() => { setCartState(loadCart(id)); }, [id]);
  const setCart = (c: Cart) => { setCartState(c); saveCart(id, c); };

  const items = useMemo(() => {
    if (!catalog) return [];
    const term = q.trim().toLowerCase();
    return catalog.items.filter((m) => {
      if (term) return m.name.toLowerCase().includes(term) || m.code.toLowerCase() === term;
      if (cat === 'special') return m.is_special;
      return cat === 'all' || m.category_id === cat;
    });
  }, [catalog, cat, q]);

  if (!order || !catalog) return <Loading error={error} />;

  const live = ['open', 'dining_done'].includes(order.status);
  const cartLines = Object.entries(cart).map(([mid, l]) => ({ item: catalog.items.find((m) => m.id === Number(mid)), ...l })).filter((l) => l.item) as { item: MenuItem; qty: number; note: string }[];
  const cartTotal = cartLines.reduce((s, l) => s + l.item.price * l.qty, 0);
  const cartCount = cartLines.reduce((s, l) => s + l.qty, 0);
  const sent = order.items;
  const readyCount = sent.filter((i) => i.status === 'ready').length;
  const inKitchen = sent.filter((i) => i.status === 'queued' || i.status === 'cooking').length;
  const activeItems = sent.filter((i) => i.status !== 'cancelled');

  const add = (m: MenuItem, delta = 1) => {
    if (!live) return toast(order.status === 'billed' ? 'Bill is printed. Reopen the table to add items.' : 'This order is closed', 'err');
    const cur = cart[m.id]?.qty ?? 0;
    const next = { ...cart };
    if (cur + delta <= 0) delete next[m.id]; else next[m.id] = { qty: cur + delta, note: cart[m.id]?.note ?? '' };
    setCart(next);
  };

  const sendKot = (print: boolean) => run(async () => {
    const o = await api.post<Order>(`/orders/${id}/kot`, { items: cartLines.map((l) => ({ menuItemId: l.item.id, qty: l.qty, note: l.note || undefined })) });
    setCart({});
    setData(o);
    setTab('order');
    toast(`KOT #${o.kots[o.kots.length - 1].kot_no} sent to kitchen`, 'ok');
    if (print) await printKot(o.kots[o.kots.length - 1].id);
  });

  const act = (path: string, body: object = {}, ok?: string) => run(async () => setData(await api.post<Order>(`/orders/${id}/${path}`, body)), ok);
  const itemAct = (itemId: number, path: string, body: object) => run(async () => setData(await api.post<Order>(`/items/${itemId}/${path}`, body)));

  const completeDining = async () => {
    if (inKitchen && !confirm(`${inKitchen} item(s) are still in the kitchen. Mark dining complete anyway?`)) return;
    act('complete', { force: inKitchen > 0 }, 'Dining complete. Table is waiting for the bill.');
  };

  const grouped = order.kots.map((k) => ({ kot: k, items: sent.filter((i) => i.kot_id === k.id) }));
  const canBill = can('bill.generate');

  return (
    <div className="pos" data-tab={tab}>
      <aside className="pos-cats">
        <button className={cat === 'all' && !q ? 'active' : ''} onClick={() => { setCat('all'); setQ(''); }}>All items</button>
        {catalog.items.some((m) => m.is_special) && <button className={cat === 'special' ? 'active' : ''} onClick={() => { setCat('special'); setQ(''); }}>★ Today's specials</button>}
        {catalog.categories.filter((c) => c.active).map((c) => (
          <button key={c.id} className={cat === c.id && !q ? 'active' : ''} onClick={() => { setCat(c.id); setQ(''); }}>{c.name}</button>
        ))}
      </aside>

      <section className="pos-menu">
        <div className="row" style={{ marginBottom: 10 }}>
          <input placeholder="Search item or code…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="pos-items">
          {items.map((m) => (
            <button key={m.id} className={`item-btn ${m.is_veg ? '' : 'non'}`} disabled={!m.available || !live} onClick={() => add(m)}
              title={m.available ? m.description || m.name : 'Not available'}>
              {cart[m.id] && <span className="q">{cart[m.id].qty}</span>}
              <span className="nm">{m.name}</span>
              <span className="row between"><span className="pr">{rupees(m.price)}</span>{m.is_special ? <span className="star">★</span> : null}{!m.available && <span className="small err">Sold out</span>}</span>
            </button>
          ))}
        </div>
        {!items.length && <div className="empty">No items match.</div>}
      </section>

      <aside className="pos-cart">
        <div className="cart-head">
          <div className="row">
            <button className="btn ghost sm" onClick={() => nav(-1)} aria-label="Back"><Icon name="back" /></button>
            <div className="grow">
              <div className="row"><h2>{order.where}</h2><span className="pill">{ORDER_STATUS_TEXT[order.status]}</span></div>
              <div className="small muted">{ORDER_TYPE_LABEL[order.order_type]} · {elapsed(order.opened_at)} · {order.server_name ?? 'No server'}{order.guests ? ` · ${order.guests} guests` : ''}</div>
            </div>
            <button className="btn sm" onClick={() => setModal('customer')} title="Customer details">{order.customer_phone || order.customer_name ? '👤' : '+ Customer'}</button>
          </div>
          {(order.customer_name || order.customer_phone) && <div className="small muted">{order.customer_name} {order.customer_phone}</div>}
          {live && (
            <div className="row wrap">
              {order.order_type === 'dine_in' && <button className="btn sm" onClick={() => setModal('move')}>Move table</button>}
              {order.table_id && <button className="btn sm" onClick={() => run(() => api.post('/cleaning', { tableId: order.table_id }), 'Cleaning crew notified')}>Request cleaning</button>}
              {(activeItems.length === 0 || can('order.cancel')) && <button className="btn sm danger" onClick={() => activeItems.length ? setModal('cancel') : act('cancel', {}).then(() => nav('/floor'))}>Cancel order</button>}
            </div>
          )}
        </div>

        <div className="cart-body">
          {!sent.length && !cartLines.length && <div className="empty">Tap menu items to add them.<br />Then press <b>Send to kitchen</b>.</div>}
          {grouped.map(({ kot, items: its }) => (
            <div key={kot.id}>
              <div className="kot-group row between">
                <span>KOT #{kot.kot_no} · {elapsed(kot.created_at)} ago{kot.source === 'qr' ? ' · QR' : ''}</span>
                <button className="btn ghost sm" title="Print KOT" onClick={() => run(() => printKot(kot.id))}><Icon name="printer" size={16} /></button>
              </div>
              {its.map((i) => (
                <div key={i.id} className="cart-line">
                  <div>
                    <div className="nm" style={i.status === 'cancelled' ? { textDecoration: 'line-through', color: 'var(--ink-3)' } : undefined}>{i.qty} × {i.name}</div>
                    {i.note && <div className="small muted">› {i.note}</div>}
                    {i.status === 'cancelled' && i.cancel_reason && <div className="small faint">Cancelled: {i.cancel_reason}</div>}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="small">{rupees(i.price * i.qty)}</div>
                    <span className={`pill ${i.status}`}>{STATUS_TEXT[i.status]}</span>
                  </div>
                  {live && i.status !== 'cancelled' && (
                    <div className="row" style={{ gridColumn: '1 / -1', justifyContent: 'flex-end' }}>
                      {i.status === 'ready' && <button className="btn sm ok" disabled={busy} onClick={() => itemAct(i.id, 'status', { status: 'served' })}>Mark served</button>}
                      {(i.status === 'queued' || can('order.cancelAnyItem')) && i.status !== 'served' && (
                        <button className="btn sm ghost danger" onClick={() => setModal({ cancelItem: i })}>Cancel</button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
          {cartLines.length > 0 && (
            <>
              <div className="new-label">New items — not sent yet</div>
              {cartLines.map((l) => (
                <div key={l.item.id} className="cart-line">
                  <div>
                    <div className="nm row"><VegMark veg={l.item.is_veg} />{l.item.name}</div>
                    <button className="btn ghost sm" style={{ padding: 0, minHeight: 0 }} onClick={() => setModal({ note: l.item.id })}>{l.note ? `› ${l.note}` : '+ note'}</button>
                  </div>
                  <div className="stack" style={{ justifyItems: 'end', gap: 4 }}>
                    <div className="qty"><button onClick={() => add(l.item, -1)}>−</button><span>{l.qty}</span><button onClick={() => add(l.item, 1)}>+</button></div>
                    <div className="small">{rupees(l.item.price * l.qty)}</div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="cart-foot">
          <Totals order={order} cartTotal={cartTotal} />
          {live && cartLines.length > 0 && (
            <div className="row">
              <button className="btn" onClick={() => setCart({})}>Clear</button>
              <button className="btn dark grow" disabled={busy} onClick={() => sendKot(true)}>KOT & Print</button>
              <button className="btn primary lg grow" disabled={busy} onClick={() => sendKot(false)}>Send to kitchen ({cartCount})</button>
            </div>
          )}
          {live && !cartLines.length && (
            <div className="row wrap">
              {readyCount > 0 && <button className="btn ok grow" disabled={busy} onClick={() => act('serve-ready', {}, 'Marked as served')}>Serve all ready ({readyCount})</button>}
              {order.status === 'open' && activeItems.length > 0 && <button className="btn dark grow" disabled={busy} onClick={completeDining}>Dining complete</button>}
              {canBill && activeItems.length > 0 && <button className="btn primary grow lg" disabled={busy} onClick={() => setModal('bill')}>Close table & bill</button>}
            </div>
          )}
          {order.bill && order.status === 'billed' && (
            <div className="row wrap">
              <button className="btn" onClick={() => run(() => printBill(order.bill!.id))}><Icon name="printer" size={16} />Print</button>
              <button className="btn" onClick={() => setModal('whatsapp')}><Icon name="whatsapp" size={16} />WhatsApp</button>
              {canBill && <button className="btn" onClick={() => act('reopen', {}, 'Table reopened')}>Reopen</button>}
              {canBill && <button className="btn" onClick={() => setModal('bill')}>Discount</button>}
              {can('bill.pay') && <button className="btn ok lg grow" onClick={() => setModal('pay')}>Settle {rupees(order.bill.grand_total)}</button>}
            </div>
          )}
          {order.bill && order.status === 'paid' && (
            <div className="row wrap">
              <span className="pill paid">Paid · Bill {order.bill.bill_label}</span>
              <button className="btn" onClick={() => run(() => printBill(order.bill!.id))}><Icon name="printer" size={16} />Print</button>
              <button className="btn" onClick={() => setModal('whatsapp')}><Icon name="whatsapp" size={16} />WhatsApp</button>
              <button className="btn primary grow" onClick={() => nav('/floor')}>Back to tables</button>
            </div>
          )}
          {order.status === 'billed' && !canBill && <div className="small muted">Bill printed. The billing counter will take the payment.</div>}
        </div>
      </aside>

      <div className="mobile-tabs no-print">
        <button className={`btn ${tab === 'menu' ? 'primary' : ''}`} onClick={() => setTab('menu')}>Menu</button>
        <button className={`btn ${tab === 'order' ? 'primary' : ''}`} onClick={() => setTab('order')}>
          Order {cartCount ? `(+${cartCount} new)` : `(${activeItems.length})`}{readyCount ? ` · ${readyCount} ready` : ''}
        </button>
      </div>

      {modal === 'bill' && <BillModal order={order} onClose={() => setModal(null)} onDone={(o) => { setData(o); setModal(null); }} />}
      {modal === 'pay' && order.bill && <PayModal order={order} onClose={() => setModal(null)} onDone={(o) => { setData(o); setModal(null); toast('Payment received. Thank you!', 'ok'); }} />}
      {modal === 'whatsapp' && order.bill && <WhatsAppModal billId={order.bill.id} phone={order.customer_phone} onClose={() => setModal(null)} />}
      {modal === 'customer' && <CustomerModal order={order} servers={catalog.servers} canAssign={me?.user.role !== 'server'} onClose={() => setModal(null)} onDone={(o) => { setData(o); setModal(null); }} />}
      {modal === 'move' && <MoveModal order={order} onClose={() => setModal(null)} onDone={(o) => { setData(o); setModal(null); }} />}
      {modal === 'cancel' && <PromptModal title="Cancel this order?" label="Reason" danger confirmText="Cancel order" onClose={() => setModal(null)}
        onSubmit={(reason) => { setModal(null); act('cancel', { reason }).then(() => nav('/floor')); }} />}
      {modal && typeof modal === 'object' && 'cancelItem' in modal && (
        <PromptModal title={`Cancel ${modal.cancelItem.qty} × ${modal.cancelItem.name}?`} label="Reason" danger confirmText="Cancel item"
          placeholder="Guest changed mind, wrong item…" onClose={() => setModal(null)}
          onSubmit={(reason) => { const it = modal.cancelItem; setModal(null); itemAct(it.id, 'cancel', { reason }); }} />
      )}
      {modal && typeof modal === 'object' && 'note' in modal && (
        <PromptModal title="Note for the kitchen" label="e.g. less spicy, no onion" required={false} confirmText="Save" onClose={() => setModal(null)}
          onSubmit={(note) => { const mid = modal.note; setModal(null); setCart({ ...cart, [mid]: { ...cart[mid], note } }); }} />
      )}
    </div>
  );
}

function Totals({ order, cartTotal }: { order: Order; cartTotal: number }) {
  const b = order.bill && order.status !== 'open' ? order.bill : null;
  if (b) {
    return (
      <div className="totals">
        <div className="row"><span>Bill no.</span><b>{b.bill_label}</b></div>
        <div className="row"><span>Sub total ({b.total_qty} items)</span><span>{rupees(b.subtotal)}</span></div>
        {b.discount > 0 && <div className="row"><span>Discount</span><span>−{rupees(b.discount)}</span></div>}
        {b.service_charge > 0 && <div className="row"><span>Service charge</span><span>{rupees(b.service_charge)}</span></div>}
        {b.breakdown.taxes.map((t) => <div key={t.name} className="row"><span>{t.name} {t.rate}%</span><span>{rupees(t.amount)}</span></div>)}
        {b.round_off !== 0 && <div className="row faint"><span>Round off</span><span>{rupees(b.round_off)}</span></div>}
        <div className="row grand"><span>Grand total</span><span>{rupees(b.grand_total)}</span></div>
      </div>
    );
  }
  return (
    <div className="totals">
      <div className="row"><span>Ordered ({order.totals.totalQty} items)</span><span>{rupees(order.totals.subtotal)}</span></div>
      {cartTotal > 0 && <div className="row" style={{ color: 'var(--brand)' }}><span>New (not sent)</span><span>{rupees(cartTotal)}</span></div>}
      {order.totals.taxes.length > 0 && <div className="row faint small"><span>Taxes</span><span>{order.totals.taxes.map((t) => `${t.name} ${t.rate}%`).join(' + ')}</span></div>}
      <div className="row grand"><span>Total</span><span>{rupees(order.totals.grandTotal + cartTotal)}</span></div>
    </div>
  );
}

function BillModal({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: (o: Order) => void }) {
  const prev = order.bill?.breakdown.discountInput;
  const [type, setType] = useState<'amount' | 'percent'>(prev?.type ?? 'percent');
  const [value, setValue] = useState(prev ? String(prev.type === 'amount' ? prev.value / 100 : prev.value) : '');
  const [print, setPrint] = useState(true);
  const { run, busy } = useAction();
  const inKitchen = order.items.some((i) => i.status === 'queued' || i.status === 'cooking');
  const submit = () => run(async () => {
    const v = parseFloat(value || '0');
    const discount = v > 0 ? { type, value: type === 'amount' ? toPaise(value) : v } : null;
    const o = await api.post<Order>(`/orders/${order.id}/bill`, { discount, force: inKitchen });
    onDone(o);
    if (print && o.bill) printBill(o.bill.id).catch(() => {});
  });
  return (
    <Modal title={`Close ${order.where} & generate bill`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Back</button><button className="btn primary" disabled={busy} onClick={submit}>{order.bill ? 'Update bill' : 'Generate bill'}</button></>}>
      {inKitchen && <div className="err">Some items are still in the kitchen. They will be billed as served.</div>}
      <div className="totals">
        <div className="row"><span>Items</span><span>{order.totals.totalQty}</span></div>
        <div className="row"><span>Sub total</span><b>{rupees(order.totals.subtotal)}</b></div>
      </div>
      <label>Discount (optional)
        <div className="row">
          <div className="segmented">
            <button className={type === 'percent' ? 'on' : ''} onClick={() => setType('percent')}>%</button>
            <button className={type === 'amount' ? 'on' : ''} onClick={() => setType('amount')}>₹</button>
          </div>
          <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0" />
        </div>
      </label>
      <label className="check"><input type="checkbox" checked={print} onChange={(e) => setPrint(e.target.checked)} />Print bill now</label>
    </Modal>
  );
}

function PayModal({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: (o: Order) => void }) {
  const total = order.bill!.grand_total;
  const [mode, setMode] = useState<'cash' | 'card' | 'upi' | 'split'>('cash');
  const [tendered, setTendered] = useState('');
  const [split, setSplit] = useState({ cash: '', card: '', upi: '' });
  const [ref, setRef] = useState('');
  const { run, busy } = useAction();
  const splitSum = toPaise(split.cash) + toPaise(split.card) + toPaise(split.upi);
  const change = mode === 'cash' && tendered ? toPaise(tendered) - total : 0;
  const ok = mode === 'split' ? splitSum === total : mode !== 'cash' || !tendered || toPaise(tendered) >= total;
  const submit = () => run(async () => {
    const payments = mode === 'split'
      ? (['cash', 'card', 'upi'] as const).map((m) => ({ method: m, amount: toPaise(split[m]) })).filter((p) => p.amount > 0)
      : [{ method: mode, amount: total, reference: ref || undefined }];
    onDone(await api.post<Order>(`/bills/${order.bill!.id}/pay`, { payments }));
  });
  return (
    <Modal title={`Settle bill ${order.bill!.bill_label}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Back</button><button className="btn ok lg" disabled={busy || !ok} onClick={submit}>Payment received</button></>}>
      <div className="row between"><span className="muted">Amount due</span><span style={{ fontSize: 26, fontWeight: 800 }}>{rupees(total)}</span></div>
      <div className="segmented" style={{ width: '100%' }}>
        {(['cash', 'upi', 'card', 'split'] as const).map((m) => (
          <button key={m} style={{ flex: 1 }} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{m === 'upi' ? 'UPI' : m[0].toUpperCase() + m.slice(1)}</button>
        ))}
      </div>
      {mode === 'cash' && (
        <>
          <label>Cash received (optional)<input inputMode="decimal" value={tendered} onChange={(e) => setTendered(e.target.value)} placeholder={(total / 100).toFixed(2)} autoFocus /></label>
          {change > 0 && <div className="row between"><span>Return change</span><b style={{ fontSize: 18 }}>{rupees(change)}</b></div>}
          {change < 0 && <div className="err">Short by {rupees(-change)}</div>}
        </>
      )}
      {(mode === 'card' || mode === 'upi') && <label>Reference / last 4 digits (optional)<input value={ref} onChange={(e) => setRef(e.target.value)} /></label>}
      {mode === 'split' && (
        <>
          {(['cash', 'upi', 'card'] as const).map((m) => (
            <label key={m}>{m.toUpperCase()}<input inputMode="decimal" value={split[m]} onChange={(e) => setSplit({ ...split, [m]: e.target.value })} /></label>
          ))}
          <div className={splitSum === total ? 'small muted' : 'err'}>Entered {rupees(splitSum)} of {rupees(total)}</div>
        </>
      )}
    </Modal>
  );
}

export function WhatsAppModal({ billId, phone: initial, onClose }: { billId: number; phone: string; onClose: () => void }) {
  const [phone, setPhone] = useState(initial);
  const { run, busy } = useAction();
  const send = () => run(async () => {
    const r = await api.post<{ url: string }>(`/bills/${billId}/whatsapp`, { phone });
    window.open(r.url, '_blank', 'noopener');
    onClose();
  });
  return (
    <Modal title="Send bill on WhatsApp" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn ok" disabled={busy || phone.replace(/\D/g, '').length < 10} onClick={send}>Open WhatsApp</button></>}>
      <label>Customer mobile number<input inputMode="tel" autoFocus value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile" /></label>
      <div className="small muted">Opens WhatsApp with the full bill typed in. Just press send.</div>
    </Modal>
  );
}

function CustomerModal({ order, servers, canAssign, onClose, onDone }: { order: Order; servers: { id: number; name: string }[]; canAssign: boolean; onClose: () => void; onDone: (o: Order) => void }) {
  const [f, setF] = useState({ customerName: order.customer_name, customerPhone: order.customer_phone, customerAddress: order.customer_address, guests: String(order.guests || ''), serverId: order.server_id ?? '' });
  const { run, busy } = useAction();
  const save = () => run(async () => onDone(await api.patch<Order>(`/orders/${order.id}`, {
    customerName: f.customerName, customerPhone: f.customerPhone, customerAddress: f.customerAddress, guests: Number(f.guests) || 0,
    ...(canAssign ? { serverId: f.serverId ? Number(f.serverId) : null } : {}),
  })));
  return (
    <Modal title="Order details" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save</button></>}>
      <label>Customer name<input value={f.customerName} onChange={(e) => setF({ ...f, customerName: e.target.value })} /></label>
      <label>Mobile number<input inputMode="tel" value={f.customerPhone} onChange={(e) => setF({ ...f, customerPhone: e.target.value })} /></label>
      {order.order_type === 'delivery' && <label>Address<textarea rows={2} value={f.customerAddress} onChange={(e) => setF({ ...f, customerAddress: e.target.value })} /></label>}
      {order.order_type === 'dine_in' && <label>Guests<input inputMode="numeric" value={f.guests} onChange={(e) => setF({ ...f, guests: e.target.value })} /></label>}
      {canAssign && (
        <label>Server
          <select value={f.serverId} onChange={(e) => setF({ ...f, serverId: e.target.value })}>
            <option value="">— none —</option>
            {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      )}
    </Modal>
  );
}

function MoveModal({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: (o: Order) => void }) {
  const { data } = useLoad(() => api.get<import('../types').Floor>('/floor'));
  const { run, busy } = useAction();
  const free = data?.tables.filter((t) => !t.order) ?? [];
  return (
    <Modal title={`Move ${order.where} to…`} onClose={onClose}>
      {!data ? 'Loading…' : !free.length ? <div className="empty">No free tables.</div> : (
        <div className="tiles">
          {free.map((t) => (
            <button key={t.id} className="tile" disabled={busy} onClick={() => run(async () => onDone(await api.post<Order>(`/orders/${order.id}/move`, { tableId: t.id })), `Moved to ${t.label}`)}>
              <span className="lbl">{t.label}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
