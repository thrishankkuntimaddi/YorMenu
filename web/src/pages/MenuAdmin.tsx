import { useState } from 'react';
import { api } from '../api';
import { useCatalog } from '../catalog';
import { useSession } from '../session';
import { Loading, Modal, useAction, VegMark } from '../ui';
import { rupees, toPaise } from '../format';
import type { MenuItem, Category } from '../types';

export default function MenuAdmin() {
  const { catalog, reload } = useCatalog();
  const { can } = useSession();
  const full = can('menu.edit');
  const { run } = useAction();
  const [edit, setEdit] = useState<Partial<MenuItem> | null>(null);
  const [catEdit, setCatEdit] = useState<Partial<Category> | null>(null);
  const [q, setQ] = useState('');
  const [onlySpecials, setOnlySpecials] = useState(false);
  if (!catalog) return <Loading />;
  const specialCount = catalog.items.filter((m) => m.is_special).length;
  const patch = (id: number, body: object) => run(async () => { await api.patch(`/menu/items/${id}`, body); await reload(); });
  const term = q.trim().toLowerCase();
  return (
    <div className="page">
      <div className="page-head">
        <h1>Menu</h1>
        <input style={{ width: 200 }} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className={`btn ${onlySpecials ? 'special-on' : ''}`} onClick={() => setOnlySpecials(!onlySpecials)} title="Show only today's specials">
          ★ Specials ({specialCount})
        </button>
        {full && <button className="btn" onClick={() => setCatEdit({})}>+ Category</button>}
        {full && <button className="btn primary" onClick={() => setEdit({ category_id: catalog.categories[0]?.id, is_veg: 1, available: 1, send_to_kitchen: 1 })}>+ Item</button>}
      </div>
      {!full && <div className="card pad small muted" style={{ marginBottom: 12 }}>Tap “Available” to mark a dish sold out for today.</div>}
      {full && <div className="card pad small muted" style={{ marginBottom: 12 }}>
        Tap <b>☆ Special</b> on a dish to make it today's special (it turns orange). Servers find all specials under
        <b> ★ Today's specials</b> on the order screen, and guests see them at the top of the QR menu. Tap again to remove.
      </div>}
      {onlySpecials && !specialCount && <div className="card pad muted" style={{ marginBottom: 12 }}>No specials yet. Tap ☆ Special next to a dish to add one.</div>}
      {catalog.categories.filter((c) => c.active).map((c) => {
        const items = catalog.items.filter((m) => m.category_id === c.id && (!term || m.name.toLowerCase().includes(term)) && (!onlySpecials || m.is_special));
        if ((term || onlySpecials) && !items.length) return null;
        return (
          <div key={c.id} className="card" style={{ marginBottom: 12 }}>
            <div className="row between" style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>
              <h2>{c.name} <span className="faint small">({items.length})</span></h2>
              {full && <button className="btn sm ghost" onClick={() => setCatEdit(c)}>Edit</button>}
            </div>
            <div className="table-wrap"><table className="list">
              <tbody>{items.map((m) => (
                <tr key={m.id}>
                  <td style={{ width: 24 }}><VegMark veg={m.is_veg} /></td>
                  <td><b>{m.name}</b>{m.code && <span className="faint small"> · {m.code}</span>}{m.is_special && !full ? <span className="pill" style={{ marginLeft: 6, color: '#b45309' }}>★ Special</span> : null}{!m.send_to_kitchen && <span className="pill" style={{ marginLeft: 6 }}>No KOT</span>}</td>
                  <td className="r">{rupees(m.price)}</td>
                  <td className="r"><label className="check" style={{ justifyContent: 'flex-end' }}><input type="checkbox" checked={!!m.available} onChange={(e) => patch(m.id, { available: e.target.checked })} />Available</label></td>
                  {full && <td className="r" style={{ width: 200, whiteSpace: 'nowrap' }}>
                    <button className={`btn sm ${m.is_special ? 'special-on' : 'ghost'}`} aria-pressed={!!m.is_special}
                      title={m.is_special ? "Today's special: tap to remove" : "Make this today's special"}
                      onClick={() => patch(m.id, { isSpecial: !m.is_special })}>{m.is_special ? '★ Special' : '☆ Special'}</button>{' '}
                    <button className="btn sm" onClick={() => setEdit(m)}>Edit</button>
                  </td>}
                </tr>
              ))}</tbody>
            </table></div>
            {!items.length && <div className="empty small">No items</div>}
          </div>
        );
      })}
      {edit && <ItemModal item={edit} categories={catalog.categories.filter((c) => c.active)} onClose={() => setEdit(null)} onSaved={async () => { await reload(); setEdit(null); }} />}
      {catEdit && <CategoryModal cat={catEdit} onClose={() => setCatEdit(null)} onSaved={async () => { await reload(); setCatEdit(null); }} />}
    </div>
  );
}

function ItemModal({ item, categories, onClose, onSaved }: { item: Partial<MenuItem>; categories: Category[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: item.name ?? '', code: item.code ?? '', description: item.description ?? '', price: item.price != null ? String(item.price / 100) : '',
    categoryId: item.category_id ?? categories[0]?.id, isVeg: !!item.is_veg, available: item.available !== 0, isSpecial: !!item.is_special,
    sendToKitchen: item.send_to_kitchen !== 0,
  });
  const { run, busy } = useAction();
  const save = () => run(async () => {
    const body = { ...f, price: toPaise(f.price), categoryId: Number(f.categoryId) };
    if (item.id) await api.patch(`/menu/items/${item.id}`, body); else await api.post('/menu/items', body);
    onSaved();
  }, 'Saved');
  const remove = () => confirm(`Remove ${item.name} from the menu?`) && run(async () => { await api.del(`/menu/items/${item.id}`); onSaved(); }, 'Removed');
  return (
    <Modal title={item.id ? 'Edit item' : 'New item'} onClose={onClose} footer={<>
      {item.id && <button className="btn danger" onClick={remove}>Remove</button>}
      <span className="grow" /><button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || !f.name || f.price === ''} onClick={save}>Save</button>
    </>}>
      <label>Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></label>
      <div className="row">
        <label className="grow">Price (₹)<input inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></label>
        <label style={{ width: 120 }}>Short code<input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="e.g. PBM" /></label>
      </div>
      <label>Category<select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: Number(e.target.value) })}>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>Description (shown on QR menu)<textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
      <label className="check"><input type="checkbox" checked={f.isVeg} onChange={(e) => setF({ ...f, isVeg: e.target.checked })} />Vegetarian</label>
      <label className="check"><input type="checkbox" checked={f.sendToKitchen} onChange={(e) => setF({ ...f, sendToKitchen: e.target.checked })} />Send to kitchen (untick for water bottles, soft drinks)</label>
      <label className="check"><input type="checkbox" checked={f.isSpecial} onChange={(e) => setF({ ...f, isSpecial: e.target.checked })} />Today's special</label>
      <label className="check"><input type="checkbox" checked={f.available} onChange={(e) => setF({ ...f, available: e.target.checked })} />Available</label>
    </Modal>
  );
}

function CategoryModal({ cat, onClose, onSaved }: { cat: Partial<Category>; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(cat.name ?? '');
  const [sort, setSort] = useState(String(cat.sort ?? 0));
  const { run, busy } = useAction();
  const save = () => run(async () => {
    if (cat.id) await api.patch(`/menu/categories/${cat.id}`, { name, sort: Number(sort) }); else await api.post('/menu/categories', { name, sort: Number(sort) });
    onSaved();
  }, 'Saved');
  return (
    <Modal title={cat.id ? 'Edit category' : 'New category'} onClose={onClose} footer={<>
      {cat.id && <button className="btn danger" onClick={() => run(async () => { await api.del(`/menu/categories/${cat.id}`); onSaved(); }, 'Removed')}>Remove</button>}
      <span className="grow" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !name} onClick={save}>Save</button>
    </>}>
      <label>Name<input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
      <label>Order (lower shows first)<input inputMode="numeric" value={sort} onChange={(e) => setSort(e.target.value)} /></label>
    </Modal>
  );
}
