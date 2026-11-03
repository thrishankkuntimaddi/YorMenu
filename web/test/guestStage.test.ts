import { describe, expect, it } from 'vitest';
import { stageOf, type Live, type Sent } from '../src/guestStage';

const item = (status: string, qty = 1) => ({ name: 'Dosa', qty, price: 80, status });
const active = (more: Partial<Live> = {}): Live => ({ status: 'active', order_status: 'open', items: [], ...more });
const sent = (id: number, kind: string): Sent => ({ id, kind, text: '', at: 0 });
const kind = (live: Live | null, waiting = false, s: Sent[] = []) => stageOf(live, waiting, s)?.kind ?? null;

describe('guest stage picture', () => {
  it('waits for the staff to confirm the phone', () => {
    expect(kind(null, true)).toBe('waiting');
  });
  it('shows nothing before anything is ordered', () => {
    expect(kind(active())).toBeNull();
    expect(kind(null)).toBeNull();
  });
  it('waits for a server to approve a sent order', () => {
    expect(kind(active(), false, [sent(1, 'order')])).toBe('waiting');
    expect(kind(active({ requests: { r1: 'accepted' } }), false, [sent(1, 'order')])).toBeNull();
  });
  it('follows the kitchen: preparing, cooking, on its way', () => {
    expect(kind(active({ items: [item('queued')] }))).toBe('preparing');
    expect(kind(active({ items: [item('queued'), item('cooking')] }))).toBe('cooking');
    expect(kind(active({ items: [item('ready'), item('served')] }))).toBe('serving');
    expect(kind(active({ items: [item('served')] }))).toBeNull();
  });
  it('a server brings the bill once asked, until the bill exists', () => {
    const s = [sent(2, 'request_bill')];
    expect(stageOf(active({ items: [item('served')] }), false, s)?.title).toMatch(/Asking/);
    expect(stageOf(active({ items: [item('served')], requests: { r2: 'accepted' } }), false, s)?.title).toMatch(/bringing/);
    expect(kind(active({ requests: { r2: 'rejected' } }), false, s)).toBeNull();
  });
  it('bill ready, then thank you once paid', () => {
    const bill = { bill_no: 12, grand_total: 250, status: 'unpaid' };
    expect(stageOf(active({ bill }), false, [sent(2, 'request_bill')])).toMatchObject({ kind: 'bill-ready', text: expect.stringContaining('12') });
    expect(kind(active({ bill: { ...bill, status: 'paid' } }))).toBe('thanks');
    expect(kind({ status: 'closed', order_status: 'paid' })).toBe('thanks');
    expect(kind({ status: 'closed', order_status: 'cancelled' })).toBeNull();
  });
});
