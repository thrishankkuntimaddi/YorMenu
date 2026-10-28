import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useCatalog } from '../catalog';
import { useSession } from '../session';
import { Loading, Modal, useAction, useToast, VegMark } from '../ui';
import { rupees } from '../format';
import { Icon } from '../icons';
import { getDevicePrinter } from '../devicePrinter';
import { printBill, WhatsAppModal } from './OrderScreen';
import type { MenuItem, Order } from '../types';

type Method = 'cash' | 'upi' | 'card' | null;
const METHODS: [Method, string][] = [['cash', 'Cash'], ['upi', 'UPI'], ['card', 'Card'], [null, 'Pay later']];

/**
 * Small shops, food stalls and part-time sellers: tap what the customer had, press Bill,
 * and the receipt prints on the printer connected to this phone or tablet.
 */
export default function QuickBill() {
  const { catalog } = useCatalog();
  const { can } = useSession();
  const toast = useToast();
  const [cart, setCart] = useState<Record<number, number>>({});
  const [cat, setCat] = useState<number | 'all' | 'special'>('all');
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'menu' | 'order'>('menu');
  const [method, setMethod] = useState<Method>('cash');
  const [phone, setPhone] = useState('');
  const [done, setDone] = useState<Order | null>(null);
  const [wa, setWa] = useState(false);
  const { run, busy } = useAction();

  const items = useMemo(() => {
    if (!catalog) return [];
    const term = q.trim().toLowerCase();
    return catalog.items.filter((m) => (term ? m.name.toLowerCase().includes(term) || m.code.toLowerCase() === term : cat === 'all' || (cat === 'special' ? !!m.is_special : m.category_id === cat)));
  }, [catalog, cat, q]);
  if (!catalog) return <Loading />;

  const lines = Object.entries(cart).map(([id, qty]) => ({ item: catalog.items.find((m) => m.id === Number(id))!, qty })).filter((l) => l.item);
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const total = lines.reduce((s, l) => s + l.item.price * l.qty, 0);
  const add = (m: MenuItem, d = 1) => setCart((c) => { const n = { ...c }; const v = (n[m.id] ?? 0) + d; if (v <= 0) delete n[m.id]; else n[m.id] = v; return n; });
  const printer = getDevicePrinter();

  const bill = () => run(async () => {
    const o = await api.post<Order>('/quick-bill', {
      items: lines.map((l) => ({ menuItemId: l.item.id, qty: l.qty })), method: can('bill.pay') ? method : null,
      customerPhone: phone || undefined,
    });
    setCart({}); setPhone(''); setTab('menu'); setDone(o);
    if (o.bill) printBill(o.bill.id).catch((e) => toast(`Bill saved, but printing failed: ${e?.message ?? e}`, 'err'));
  });

  if (!catalog.items.length) {
    return (
      <div className="page"><div className="empty">
        <p>Add your items first, with their prices.</p>
        {can('menu.edit') && <Link className="btn primary" to="/admin/menu"><Icon name="menu" size={16} />Add menu items</Link>}
      </div></div>
    );
  }

  return (
    <div className="pos" data-tab={tab}>
      <aside className="pos-cats">
        <button className={cat === 'all' && !q ? 'active' : ''} onClick={() => { setCat('all'); setQ(''); }}>All items</button>
        {catalog.items.some((m) => m.is_special) && <button className={cat === 'special' && !q ? 'active' : ''} onClick={() => { setCat('special'); setQ(''); }}>★ Today's specials</button>}
        {catalog.categories.map((c) => <button key={c.id} className={cat === c.id && !q ? 'active' : ''} onClick={() => { setCat(c.id); setQ(''); }}>{c.name}</button>)}
      </aside>

      <section className="pos-menu">
        <div className="row" style={{ marginBottom: 10 }}>
          <input placeholder="Search item or code…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="pos-items">
          {items.map((m) => (
            <button key={m.id} className={`item-btn ${m.is_veg ? '' : 'non'}`} disabled={!m.available} onClick={() => add(m)}>
              {cart[m.id] && <span className="q">{cart[m.id]}</span>}
              <span className="nm">{m.name}</span>
              <span className="row between"><span className="pr">{rupees(m.price)}</span>{!m.available && <span className="small err">Sold out</span>}</span>
            </button>
          ))}
        </div>
      </section>

      <aside className="pos-cart">
        <div className="cart-head">
          <div className="row between">
            <h2>New bill</h2>
            <Link to="/printer" className="small">{printer ? `🖨 ${printer.name}` : 'Connect printer'}</Link>
          </div>
        </div>
        <div className="cart-body">
          {!lines.length && <div className="empty">Tap items to add them to the bill.</div>}
          {lines.map((l) => (
            <div key={l.item.id} className="cart-line">
              <div className="nm row"><VegMark veg={l.item.is_veg} />{l.item.name}</div>
              <div className="stack" style={{ justifyItems: 'end', gap: 4 }}>
                <div className="qty"><button onClick={() => add(l.item, -1)}>−</button><span>{l.qty}</span><button onClick={() => add(l.item, 1)}>+</button></div>
                <div className="small">{rupees(l.item.price * l.qty)}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="cart-foot">
          <label>Customer mobile (optional, for WhatsApp bill)
            <input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, ''))} placeholder="10-digit mobile" />
          </label>
          {can('bill.pay') && (
            <div className="segmented" style={{ width: '100%' }}>
              {METHODS.map(([k, l]) => <button key={l} style={{ flex: 1 }} className={method === k ? 'on' : ''} onClick={() => setMethod(k)}>{l}</button>)}
            </div>
          )}
          <div className="totals"><div className="row grand"><span>Items {count}</span><span>{rupees(total)}</span></div><div className="small muted">Taxes are added on the bill as set in Settings.</div></div>
          <div className="row">
            <button className="btn" disabled={!lines.length} onClick={() => setCart({})}>Clear</button>
            <button className="btn primary lg grow" disabled={busy || !lines.length} onClick={bill}><Icon name="printer" size={18} />Bill &amp; print</button>
          </div>
        </div>
      </aside>

      <div className="mobile-tabs no-print">
        <button className={`btn ${tab === 'menu' ? 'primary' : ''}`} onClick={() => setTab('menu')}>Items</button>
        <button className={`btn ${tab === 'order' ? 'primary' : ''}`} onClick={() => setTab('order')}>Bill · {count} · {rupees(total)}</button>
      </div>

      {done?.bill && !wa && (
        <Modal title={`Bill ${done.bill.bill_label}`} onClose={() => setDone(null)} footer={<button className="btn primary" onClick={() => setDone(null)}>Next customer</button>}>
          <div className="code-big" style={{ letterSpacing: 0 }}>{rupees(done.bill.grand_total)}</div>
          <div className="center muted">{done.bill.status === 'paid' ? `Paid by ${done.bill.payments?.[0]?.method?.toUpperCase() ?? ''}` : 'Not paid yet: settle it later under Bills.'}</div>
          <div className="row">
            <button className="btn grow" onClick={() => run(() => printBill(done.bill!.id))}><Icon name="printer" size={16} />Print again</button>
            {can('bill.whatsapp') && <button className="btn ok grow" onClick={() => setWa(true)}><Icon name="whatsapp" size={16} />WhatsApp</button>}
          </div>
        </Modal>
      )}
      {done?.bill && wa && <WhatsAppModal billId={done.bill.id} phone={done.customer_phone} onClose={() => { setWa(false); setDone(null); }} />}
    </div>
  );
}
