import { collection, doc, getDoc, runTransaction, setDoc, updateDoc, deleteDoc, type DocumentReference, type Query } from 'firebase/firestore';
import { DB, Row, Tx, Where, all, newId, nowStr, q } from './db';
import { notFound } from './errors';

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
  private users: Map<number, Row> | null = null;

  constructor(public readonly db: DB, public readonly rid: number) {}

  get root(): DocumentReference { return doc(this.db, `restaurants/${this.rid}`); }
  path(c: Coll) {
    if (!TENANT_COLLECTIONS.includes(c)) throw new Error(`Unknown tenant collection ${c}`);
    return `restaurants/${this.rid}/${c}`;
  }
  col(c: Coll) { return collection(this.db, this.path(c)); }
  ref(c: Coll, id: number | string): DocumentReference { return doc(this.db, `${this.path(c)}/${id}`); }

  async find<T = Row>(c: Coll, id: number, tx?: Tx): Promise<T | undefined> {
    if (!Number.isFinite(id)) return undefined;
    const snap = tx ? await tx.get(this.ref(c, id)) : await getDoc(this.ref(c, id));
    return snap.exists() ? (snap.data() as T) : undefined;
  }
  async must<T = Row>(c: Coll, id: number, what = 'Record', tx?: Tx): Promise<T> {
    const row = await this.find<T>(c, id, tx);
    if (!row) throw notFound(`${what} not found`);
    return row;
  }
  query(c: Coll, ...where: Where[]): Query { return q(this.db, this.path(c), ...where); }
  list<T = Row>(c: Coll, ...where: Where[]): Promise<T[]> { return all<T>(this.query(c, ...where)); }

  /** Create a document inside a transaction with a fresh numeric id. */
  newDoc(c: Coll, data: Row, tx: Tx): Row & { id: number } {
    const id = newId();
    const row = { ...data, id, restaurant_id: this.rid };
    tx.set(this.ref(c, id), row);
    return row;
  }
  async insert(c: Coll, data: Row): Promise<Row & { id: number }> {
    const id = newId();
    const row = { ...data, id, restaurant_id: this.rid };
    await setDoc(this.ref(c, id), row);
    return row;
  }
  async update(c: Coll, id: number, patch: Row, tx?: Tx) {
    if (tx) tx.update(this.ref(c, id), patch); else await updateDoc(this.ref(c, id), patch);
  }
  async remove(c: Coll, id: number) { await deleteDoc(this.ref(c, id)); }

  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> { return runTransaction(this.db, fn); }

  async restaurant(tx?: Tx): Promise<Row> {
    const snap = tx ? await tx.get(this.root) : await getDoc(this.root);
    if (!snap.exists()) throw notFound('Restaurant not found');
    return snap.data();
  }
  async updateRestaurant(patch: Row, tx?: Tx) {
    if (tx) tx.update(this.root, patch); else await updateDoc(this.root, patch);
  }

  /** All staff of this restaurant, cached for the request (names for "by Anil" labels). */
  async userMap(): Promise<Map<number, Row>> {
    if (!this.users) this.users = new Map((await this.list('users')).map((u) => [u.id, u]));
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
