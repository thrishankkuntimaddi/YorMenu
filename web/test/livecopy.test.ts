import { describe, it, expect, beforeEach } from 'vitest';
import { doc, getDoc, deleteDoc } from 'firebase/firestore';
import { setup, type Device } from './helpers.js';

let env: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { env = await setup(); });

/** Wait until another device's change has reached this device's live copy. */
async function eventually<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  let v = await fn();
  while (!ok(v) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 100));
    v = await fn();
  }
  return v;
}

const floorOf = async (d: Device) => {
  const f = (await d.get('/api/floor')).body;
  return { ...f, tables: f.tables.map((t: any) => ({ ...t, order: t.order && { ...t.order } })) };
};

describe('live floor kept in memory', () => {
  it('an action on this device shows its own result straight away', async () => {
    const owner = await env.login('AAA', 'owner', 'owner123', { mirror: true });
    expect((await owner.get('/api/floor')).status).toBe(200); // warms the live copy
    const o = await owner.post('/api/orders', { type: 'dine_in', tableId: env.tableId(env.a.rid, 'Hut1') });
    expect(o.status).toBe(201);
    const k = await owner.post(`/api/orders/${o.body.id}/kot`, { items: [{ menuItemId: env.itemId(env.a.rid, 'Water Bottle'), qty: 2 }] });
    expect(k.body.items).toHaveLength(1);
    const floor = await owner.get('/api/floor');
    const hut = floor.body.tables.find((t: any) => t.label === 'Hut1');
    expect(hut.order?.id).toBe(o.body.id);

    const billed = await owner.post(`/api/orders/${o.body.id}/bill`, {});
    expect(billed.body.status).toBe('billed');
    const paid = await owner.post(`/api/bills/${billed.body.bill.id}/pay`, { payments: [{ method: 'cash', amount: billed.body.bill.grand_total }] });
    expect(paid.body.status).toBe('paid');
    const after = await owner.get('/api/floor');
    expect(after.body.tables.find((t: any) => t.label === 'Hut1').order).toBeNull();
  });

  it('gives the same floor, kitchen and order screens as reading Firestore directly', async () => {
    const live = await env.login('AAA', 'server1', 'server123', { mirror: true });
    const direct = await env.login('AAA', 'owner', 'owner123');
    const chef = await env.login('AAA', 'chef', 'chef123', { mirror: true });
    await live.get('/api/floor');
    await chef.get('/api/kitchen');

    // Changes made on other devices.
    const o = await direct.post('/api/orders', { type: 'dine_in', tableId: env.tableId(env.a.rid, 'Hut1'), guests: 3 });
    await direct.post(`/api/orders/${o.body.id}/kot`, { items: [{ menuItemId: env.itemId(env.a.rid, 'Paneer 65'), qty: 1 }] });
    const parcel = await direct.post('/api/orders', { type: 'takeaway', customerName: 'Ravi' });

    const want = await floorOf(direct);
    const got = await eventually(() => floorOf(live), (f) => JSON.stringify(f) === JSON.stringify(want));
    expect(got).toEqual(want);
    expect(got.others.map((x: any) => x.id)).toContain(parcel.body.id);

    const kitchen = await eventually(() => chef.get('/api/kitchen'), (r) => r.body.length === 1);
    expect(kitchen.body).toEqual((await direct.get('/api/kitchen')).body);

    // The chef marks it ready from the live copy; everyone sees it.
    const itemId = kitchen.body[0].items[0].id;
    const ready = await chef.post(`/api/items/${itemId}/status`, { status: 'ready' });
    expect(ready.status).toBe(200);
    expect(ready.body.items[0].status).toBe('ready');
    const detail = await eventually(() => live.get(`/api/orders/${o.body.id}`), (r) => r.body.items?.[0]?.status === 'ready');
    const { ...want2 } = (await direct.get(`/api/orders/${o.body.id}`)).body;
    expect(detail.body).toEqual(want2);
  });

  it('cleaning list only shows waiting and recent tasks, and matches direct reads', async () => {
    const live = await env.login('AAA', 'owner', 'owner123', { mirror: true });
    const direct = await env.login('AAA', 'manager', 'manager123');
    await live.get('/api/cleaning');
    const task = await direct.post('/api/cleaning', { tableId: env.tableId(env.a.rid, 'Hut1') });
    expect(task.status).toBe(201);
    // Asking twice for the same table gives the same waiting task.
    expect((await live.post('/api/cleaning', { tableId: env.tableId(env.a.rid, 'Hut1') })).body.id).toBe(task.body.id);
    await live.post(`/api/cleaning/${task.body.id}/done`);
    const list = await eventually(() => direct.get('/api/cleaning'), (r) => r.body.some((c: any) => c.status === 'done'));
    expect(list.body.map((c: any) => [c.id, c.status])).toEqual([[task.body.id, 'done']]);
  });
});

describe('Excel backup and restore', () => {
  const saved = async (d: Device, path: string) => {
    const s = await getDoc(doc(d.db, path));
    return s.exists() ? s.data() : undefined;
  };
  const b64 = async (blob: Blob) => Buffer.from(await blob.arrayBuffer()).toString('base64');

  it('restores menu, orders and bills exactly as they were', async () => {
    const owner = await env.login('AAA', 'owner', 'owner123');
    const rid = env.a.rid;
    const o = await owner.post('/api/orders', { type: 'dine_in', tableId: env.tableId(rid, 'Hut1'), customerPhone: '9876543210', notes: 'no "onion", ok?' });
    await owner.post(`/api/orders/${o.body.id}/kot`, { items: [{ menuItemId: env.itemId(rid, 'Water Bottle'), qty: 2, note: 'cold' }] });
    const billed = await owner.post(`/api/orders/${o.body.id}/bill`, {});
    await owner.post(`/api/bills/${billed.body.bill.id}/pay`, { payments: [{ method: 'upi', amount: billed.body.bill.grand_total, reference: '00123' }] });

    const itemId = env.itemId(rid, 'Water Bottle');
    const paths = [`restaurants/${rid}/orders/${o.body.id}`, `restaurants/${rid}/bills/${billed.body.bill.id}`, `restaurants/${rid}/menu_items/${itemId}`];
    const before = await Promise.all(paths.map((p) => saved(owner, p)));

    const file = await owner.get('/api/backup?activity=1');
    expect(file.status).toBe(200);
    expect(file.file!.filename).toMatch(/^yormenu-backup-aaa-\d{4}-\d{2}-\d{2}\.xlsx$/);
    const data = await b64(file.file!.blob);

    const preview = await owner.post('/api/backup/preview', { data });
    expect(preview.status).toBe(200);
    expect(preview.body.sheets.find((s: any) => s.coll === 'bills').rows).toBe(1);

    // Lose some data: a menu item is deleted, a price is changed.
    const coke = `restaurants/${rid}/menu_items/${env.itemId(rid, 'Coke')}`;
    const cokeBefore = await saved(owner, coke);
    await deleteDoc(doc(owner.db, paths[2]));
    expect((await owner.patch(`/api/menu/items/${env.itemId(rid, 'Coke')}`, { price: 99900 })).status).toBe(200);

    // Safe restore: the deleted item comes back, nothing else changes.
    const r1 = await owner.post('/api/backup/restore', { data, mode: 'missing' });
    expect(r1.status).toBe(200);
    expect(r1.body.sheets.find((s: any) => s.name === 'Menu items').added).toBe(1);
    expect(r1.body.sheets.find((s: any) => s.name === 'Bills').skipped).toBe(1);
    expect(await Promise.all(paths.map((p) => saved(owner, p)))).toEqual(before);
    expect((await saved(owner, coke))!.price).toBe(99900);

    // Full restore puts the changed price back too.
    const r2 = await owner.post('/api/backup/restore', { data, mode: 'replace' });
    expect(r2.status).toBe(200);
    expect(await saved(owner, coke)).toEqual(cokeBefore);
    expect(await Promise.all(paths.map((p) => saved(owner, p)))).toEqual(before);
  });

  it('only the owner of that restaurant can back up or restore', async () => {
    const ownerA = await env.login('AAA', 'owner', 'owner123');
    const ownerB = await env.login('BBB', 'owner', 'owner123');
    const manager = await env.login('AAA', 'manager', 'manager123');
    expect((await manager.get('/api/backup')).status).toBe(403);
    const file = await ownerA.get('/api/backup');
    const data = await b64(file.file!.blob);
    const wrong = await ownerB.post('/api/backup/preview', { data });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toMatch(/another restaurant/);
    expect((await ownerA.post('/api/backup/preview', { data: Buffer.from('hello').toString('base64') })).status).toBe(400);
    expect((await ownerA.get('/api/backup?from=2026-01-01&to=2026-03-01')).status).toBe(400);
  });
});
