import { describe, it, expect } from 'vitest';
import { setup } from './helpers.js';

describe('dine-in lifecycle', () => {
  it('table -> KOT -> kitchen -> more items -> served -> dining done -> bill -> payment -> cleaning', async () => {
    const s = await setup();
    const server = await s.login('AAA', 'server1', 'server123');
    const chef = await s.login('AAA', 'chef', 'chef123');
    const cashier = await s.login('AAA', 'biller', 'biller123');
    const cleaner = await s.login('AAA', 'cleaner', 'cleaner123');
    const t5 = s.tableId(s.a.rid, 'Hut5');

    // Server opens table and sends the first round.
    let res = await server.post('/api/orders', { type: 'dine_in', tableId: t5, guests: 4 });
    expect(res.status).toBe(201);
    const orderId = res.body.id;
    expect(res.body.server_id).toBe(s.a.users.server1);

    res = await server.post(`/api/orders/${orderId}/kot`, { items: [
      { menuItemId: s.itemId(s.a.rid, 'Butter Naan'), qty: 5 },
      { menuItemId: s.itemId(s.a.rid, 'Paneer Butter Masala'), qty: 2, note: 'less spicy' },
      { menuItemId: s.itemId(s.a.rid, 'Water Bottle'), qty: 5 },
    ] });
    expect(res.status).toBe(201);
    expect(res.body.kots).toHaveLength(1);
    // Water goes straight to ready, food goes to the kitchen.
    expect(res.body.items.find((i: any) => i.name === 'Water Bottle').status).toBe('ready');
    expect(res.body.items.find((i: any) => i.name === 'Butter Naan').status).toBe('queued');
    expect(s.events.some((e) => e.event === 'kot:new' && e.rid === s.a.rid)).toBe(true);

    // Second table can't take the same table.
    res = await cashier.post('/api/orders', { type: 'dine_in', tableId: t5 });
    expect(res.status).toBe(409);

    // Cashier sees it on the floor.
    res = await cashier.get('/api/floor');
    const tile = res.body.tables.find((t: any) => t.id === t5);
    expect(tile.state).toBe('cooking');
    expect(tile.order.amount).toBe(5 * 5000 + 2 * 22000 + 5 * 2000);

    // Kitchen sees only kitchen items, ticket printable.
    res = await chef.get('/api/kitchen');
    expect(res.body).toHaveLength(1);
    expect(res.body[0].where).toBe('Table Hut5');
    expect(res.body[0].items.map((i: any) => i.name)).toEqual(['Butter Naan', 'Paneer Butter Masala']);
    const kot1 = res.body[0].id;
    res = await chef.get(`/api/kots/${kot1}/ticket`);
    expect(res.body.kotNo).toBe(1);

    // Family adds more: only the new items go in KOT #2.
    res = await server.post(`/api/orders/${orderId}/kot`, { items: [{ menuItemId: s.itemId(s.a.rid, 'Veg Fried Rice'), qty: 1 }] });
    expect(res.body.kots.map((k: any) => k.kot_no)).toEqual([1, 2]);
    res = await chef.get(`/api/kots/${res.body.kots[1].id}/ticket`);
    expect(res.body.items).toEqual([{ name: 'Veg Fried Rice', qty: 1, note: '' }]);

    // Dining can't complete while the kitchen is working.
    res = await server.post(`/api/orders/${orderId}/complete`);
    expect(res.status).toBe(409);

    // Kitchen marks everything ready -> server is notified.
    res = await chef.get('/api/kitchen');
    for (const k of res.body) expect((await chef.post(`/api/kots/${k.id}/status`, { status: 'ready' })).status).toBe(200);
    expect(s.events.some((e) => e.event === 'notify' && (e.payload as any).kind === 'ready')).toBe(true);
    res = await chef.get('/api/kitchen');
    expect(res.body.every((k: any) => k.items.every((i: any) => i.status === 'ready'))).toBe(true);

    res = await server.post(`/api/orders/${orderId}/serve-ready`);
    expect(res.body.items.every((i: any) => i.status === 'served')).toBe(true);
    res = await server.post(`/api/orders/${orderId}/complete`);
    expect(res.body.status).toBe('dining_done');

    // Servers can't bill.
    expect((await server.post(`/api/orders/${orderId}/bill`)).status).toBe(403);

    // Cashier closes the table: bill number 1.
    res = await cashier.post(`/api/orders/${orderId}/bill`, {});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('billed');
    expect(res.body.bill.bill_no).toBe(1);
    const bill = res.body.bill;
    expect(bill.subtotal).toBe(25000 + 44000 + 10000 + 15000);
    expect(bill.grand_total).toBe(Math.round((94000 * 1.05) / 100) * 100);

    // WhatsApp share link.
    res = await cashier.post(`/api/bills/${bill.id}/whatsapp`, { phone: '98765 43210' });
    expect(res.body.url).toMatch(/^https:\/\/wa\.me\/919876543210\?text=/);
    expect(res.body.text).toContain('Bill No: 1');

    // Wrong amount refused; right amount settles and sends table to cleaning.
    expect((await cashier.post(`/api/bills/${bill.id}/pay`, { payments: [{ method: 'cash', amount: 100 }] })).status).toBe(400);
    res = await cashier.post(`/api/bills/${bill.id}/pay`, { payments: [{ method: 'upi', amount: 50000 }, { method: 'cash', amount: bill.grand_total - 50000 }] });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('paid');

    res = await cashier.get('/api/floor');
    expect(res.body.tables.find((t: any) => t.id === t5).state).toBe('cleaning');
    res = await cleaner.get('/api/cleaning');
    const task = res.body.find((c: any) => c.table_id === t5 && c.status === 'pending');
    expect((await cleaner.post(`/api/cleaning/${task.id}/done`)).status).toBe(200);
    res = await cashier.get('/api/floor');
    expect(res.body.tables.find((t: any) => t.id === t5).state).toBe('free');

    // Reports reflect the sale and who did what.
    const owner = await s.login('AAA', 'owner', 'owner123');
    res = await owner.get('/api/reports/summary');
    expect(res.body.totals.bills).toBe(1);
    expect(res.body.totals.grand_total).toBe(bill.grand_total);
    expect(res.body.byMethod.map((m: any) => m.method).sort()).toEqual(['cash', 'upi']);
    res = await owner.get('/api/reports/staff');
    const anil = res.body.find((u: any) => u.id === s.a.users.server1);
    expect(anil.orders).toBe(1);
    expect(anil.kots).toBe(2);
    expect(res.body.find((u: any) => u.id === s.a.users.cleaner).tablesCleaned).toBe(1);
    res = await owner.get('/api/reports/items?format=csv');
    expect(res.text.split('\n')[0]).toBe('name,qty,amount,orders');
  });

  it('reopen after bill keeps the bill number; takeaway works without a table', async () => {
    const s = await setup();
    const cashier = await s.login('AAA', 'biller', 'biller123');
    let res = await cashier.post('/api/orders', { type: 'takeaway', customerName: 'Ramesh', customerPhone: '9000000000' });
    const id = res.body.id;
    expect(res.body.where).toBe(`Parcel #${res.body.order_no}`);
    expect(res.body.order_no).toBe(1);
    await cashier.post(`/api/orders/${id}/kot`, { items: [{ menuItemId: s.itemId(s.a.rid, 'Coke'), qty: 2 }] });
    res = await cashier.post(`/api/orders/${id}/bill`, {});
    expect(res.body.bill.bill_no).toBe(1);
    expect((await cashier.post(`/api/orders/${id}/kot`, { items: [{ menuItemId: s.itemId(s.a.rid, 'Coke'), qty: 1 }] })).status).toBe(409);
    res = await cashier.post(`/api/orders/${id}/reopen`);
    expect(res.body.status).toBe('open');
    // Paying a reopened order is refused until the bill is regenerated.
    expect((await cashier.post(`/api/bills/${res.body.bill.id}/pay`, { payments: [{ method: 'cash', amount: 8400 }] })).status).toBe(409);
    await cashier.post(`/api/orders/${id}/kot`, { items: [{ menuItemId: s.itemId(s.a.rid, 'Coke'), qty: 1 }] });
    res = await cashier.post(`/api/orders/${id}/bill`, { discount: { type: 'amount', value: 600 } });
    expect(res.body.bill.bill_no).toBe(1);
    expect(res.body.bill.subtotal).toBe(12000);
    expect(res.body.bill.discount).toBe(600);
    // Next order gets bill 2.
    const o2 = (await cashier.post('/api/orders', { type: 'delivery' })).body.id;
    await cashier.post(`/api/orders/${o2}/kot`, { items: [{ menuItemId: s.itemId(s.a.rid, 'Coke'), qty: 1 }] });
    expect((await cashier.post(`/api/orders/${o2}/bill`, {})).body.bill.bill_no).toBe(2);
  });

  it('cancelling items: servers only before cooking, managers anytime, with audit', async () => {
    const s = await setup();
    const server = await s.login('AAA', 'server2', 'server123');
    const chef = await s.login('AAA', 'chef', 'chef123');
    const manager = await s.login('AAA', 'manager', 'manager123');
    const id = (await server.post('/api/orders', { type: 'dine_in', tableId: s.tableId(s.a.rid, 'AC1') })).body.id;
    let res = await server.post(`/api/orders/${id}/kot`, { items: [
      { menuItemId: s.itemId(s.a.rid, 'Chicken 65'), qty: 1 }, { menuItemId: s.itemId(s.a.rid, 'Dal Tadka'), qty: 1 }] });
    const [c65, dal] = res.body.items;
    expect((await server.post(`/api/items/${c65.id}/cancel`, { reason: 'changed mind' })).status).toBe(200);
    await chef.post(`/api/items/${dal.id}/status`, { status: 'cooking' });
    expect((await server.post(`/api/items/${dal.id}/cancel`, { reason: 'late' })).status).toBe(403);
    expect((await manager.post(`/api/items/${dal.id}/cancel`, { reason: 'late' })).status).toBe(200);
    res = await manager.get('/api/audit');
    expect(res.body.filter((a: any) => a.action === 'item.cancel')).toHaveLength(2);
  });
});
