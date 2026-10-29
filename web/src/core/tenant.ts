import { collection, doc, getDoc, runTransaction, setDoc, updateDoc, deleteDoc, type DocumentReference, type Query } from 'firebase/firestore';
import { DB, Row, Tx, Where, all, newId, nowStr, q } from './db';
import { notFound } from './errors';
import type { LiveMirror } from './mirror';

export const TENANT_COLLECTIONS = [
  'users', 'sections', 'tables', 'menu_categories', 'menu_items', 'orders', 'bills', 'cleaning_tasks',
  'guest_requests', 'audit_log', 'print_jobs',
] as const;
export type Coll = (typeof TENANT_COLLECTIONS)[number];

/**
 * The only way app code touches restaurant data. A Tenant is bound to the restaurant
 * of the signed-in person and can only reach documents under restaurants/{rid}/...;
 * Firestore security rules enforce the same thing on the server side.
 */
export class Tenant {
  private users: Promise<Map<number, Row>> | null = null;
  /** Documents written by each running transaction, so the live copy re-reads them once it commits. */
  private txWrites = new WeakMap<Tx, string[]>();

  constructor(public readonly db: DB, public readonly rid: number, private readonly mirror: LiveMirror | null = null) {}

  private wrote(tx: Tx, key: string) { this.txWrites.get(tx)?.push(key); }

  get root(): DocumentReference { return doc(this.db, `restaurants/${this.rid}`); }
  path(c: Coll) {
    if (!TENANT_COLLECTIONS.includes(c)) throw new Error(`Unknown tenant collection ${c}`);
    return `restaurants/${this.rid}/${c}`;
  }
  col(c: Coll) { return collection(this.db, this.path(c)); }
  ref(c: Coll, id: number | string): DocumentReference { return doc(this.db, `${this.path(c)}/${id}`); }

  async find<T = Row>(c: Coll, id: number, tx?: Tx): Promise<T | undefined> {
    if (!Number.isFinite(id)) return undefined;
    if (!tx && this.mirror) {
      const hit = await this.mirror.find(this.rid, c, id);
      if (hit) return hit.row as T | undefined;
    }
    const snap = tx ? await tx.get(this.ref(c, id)) : await getDoc(this.ref(c, id));
    return snap.exists() ? (snap.data() as T) : undefined;
  }
  async must<T = Row>(c: Coll, id: number, what = 'Record', tx?: Tx): Promise<T> {
    const row = await this.find<T>(c, id, tx);
    if (!row) throw notFound(`${what} not found`);
    return row;
  }
  query(c: Coll, ...where: Where[]): Query { return q(this.db, this.path(c), ...where); }
  async list<T = Row>(c: Coll, ...where: Where[]): Promise<T[]> {
    const hit = this.mirror ? await this.mirror.list(this.rid, c, where) : undefined;
    return (hit as T[] | undefined) ?? all<T>(this.query(c, ...where));
  }

  /** Create a document inside a transaction with a fresh numeric id. */
  newDoc(c: Coll, data: Row, tx: Tx): Row & { id: number } {
    const id = newId();
    const row = { ...data, id, restaurant_id: this.rid };
    tx.set(this.ref(c, id), row);
    this.wrote(tx, `${c}/${id}`);
    return row;
  }
  async insert(c: Coll, data: Row): Promise<Row & { id: number }> {
    const id = newId();
    const row = { ...data, id, restaurant_id: this.rid };
    await setDoc(this.ref(c, id), row);
    return row;
  }
  async update(c: Coll, id: number, patch: Row, tx?: Tx) {
    if (tx) { tx.update(this.ref(c, id), patch); this.wrote(tx, `${c}/${id}`); } else await updateDoc(this.ref(c, id), patch);
  }
  async remove(c: Coll, id: number) { await deleteDoc(this.ref(c, id)); }

  async tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    let keys: string[] = [];
    const out = await runTransaction(this.db, (tx) => {
      // Firestore may run the function again on a conflict; only the last attempt counts.
      keys = [];
      this.txWrites.set(tx, keys);
      return fn(tx);
    });
    // Transactions don't update the live copy until the server sends the change back.
    if (keys.length) this.mirror?.markWritten(this.rid, keys);
    return out;
  }

  async restaurant(tx?: Tx): Promise<Row> {
    if (!tx && this.mirror) {
      const live = await this.mirror.restaurant(this.rid);
      if (live) return live;
    }
    const snap = tx ? await tx.get(this.root) : await getDoc(this.root);
    if (!snap.exists()) throw notFound('Restaurant not found');
    return snap.data();
  }
  async updateRestaurant(patch: Row, tx?: Tx) {
    if (tx) { tx.update(this.root, patch); this.wrote(tx, 'restaurant'); } else await updateDoc(this.root, patch);
  }

  /** All staff of this restaurant, cached for the request (names for "by Anil" labels). */
  userMap(): Promise<Map<number, Row>> {
    // Keep the promise, so screens that ask for many names at once share one read.
    if (!this.users) {
      this.users = this.list('users').then((list) => new Map(list.map((u) => [u.id, u])));
      this.users.catch(() => { this.users = null; });
    }
    return this.users;
  }
  async userName(id: number | null | undefined): Promise<string | null> {
    if (!id) return null;
    return (await this.userMap()).get(id)?.name ?? null;
  }

  audit(userId: number | null, action: string, entity = '', entityId: number | null = null, details: unknown = {}, tx?: Tx) {
    const id = newId();
    const row = { id, restaurant_id: this.rid, user_id: userId, action, entity, entity_id: entityId, details: JSON.stringify(details), created_at: nowStr() };
    if (tx) tx.set(this.ref('audit_log', id), row);
    else return setDoc(this.ref('audit_log', id), row);
  }
}
