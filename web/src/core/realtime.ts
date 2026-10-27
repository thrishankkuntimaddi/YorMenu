import { doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { DB, all, newId, nowStr, q } from './db';

/**
 * Live updates through Firestore:
 *  - restaurants/{rid}/live/signals holds "this changed at T" per event; every signed-in
 *    device of that restaurant listens and reloads what it shows;
 *  - restaurants/{rid}/inbox/{userId}/items holds alerts for one person ("Table 5 food ready").
 * Queued during an action and written together at the end of it.
 */
export class Realtime {
  private signals = new Map<number, Record<string, unknown>>();
  private inbox: { rid: number; userIds?: number[]; roles?: string[]; payload: unknown }[] = [];

  constructor(private db: DB | null) {}

  emit(rid: number, event: string, payload: unknown = {}) {
    const m = this.signals.get(rid) ?? {};
    m[event.replace(/:/g, '_')] = { at: Date.now(), payload: payload ?? {} };
    this.signals.set(rid, m);
  }
  emitToUser(rid: number, userId: number, _event: string, payload: unknown = {}) {
    this.inbox.push({ rid, userIds: [userId], payload });
  }
  emitToRoles(rid: number, roles: string[], _event: string, payload: unknown = {}) {
    if (roles.length) this.inbox.push({ rid, roles, payload });
  }

  async flush() {
    const signals = [...this.signals];
    const inbox = this.inbox;
    this.signals = new Map();
    this.inbox = [];
    if (!this.db) return;
    const db = this.db;
    const batch = writeBatch(db);
    let n = 0;
    for (const [rid, fields] of signals) {
      batch.set(doc(db, `restaurants/${rid}/live/signals`), { ...fields, updated: serverTimestamp() }, { merge: true });
      n++;
    }
    const roleCache = new Map<string, number[]>();
    for (const job of inbox) {
      let ids = job.userIds ?? [];
      if (job.roles) {
        const key = `${job.rid}:${job.roles.join(',')}`;
        if (!roleCache.has(key)) {
          const users = await all(q(db, `restaurants/${job.rid}/users`, ['active', '==', 1]));
          roleCache.set(key, users.filter((u) => job.roles!.includes(u.role)).map((u) => u.id));
        }
        ids = [...ids, ...roleCache.get(key)!];
      }
      for (const uid of new Set(ids)) {
        const id = newId();
        batch.set(doc(db, `restaurants/${job.rid}/inbox/${uid}/items/${id}`), {
          id, payload: job.payload, created_at: nowStr(), expire_at: new Date(Date.now() + 24 * 3600_000), at: Date.now(),
        });
        n++;
      }
    }
    if (n) await batch.commit();
  }
}
