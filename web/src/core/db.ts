import {
  collection, doc, getDoc, getDocs, query, where, runTransaction, setDoc, updateDoc, deleteDoc,
  type Firestore, type Transaction, type DocumentReference, type Query, type WhereFilterOp,
} from 'firebase/firestore';

export type DB = Firestore;
export type Tx = Transaction;
// Rows are plain Firestore documents; fields are checked by the code that reads them.
export type Row = any; // eslint-disable-line @typescript-eslint/no-explicit-any
export type Where = [field: string, op: WhereFilterOp, value: unknown];

/** "YYYY-MM-DD HH:MM:SS" in UTC, the format every timestamp in YorMenu uses. */
export function nowStr(d = new Date()): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

let seq = Math.floor(Math.random() * 1000);
/** Numeric ids that sort by creation time (ms × 1000 + counter). Safe integers. */
export function newId(): number {
  seq = (seq + 1) % 1000;
  return Date.now() * 1000 + seq;
}

export const ref = (db: DB, path: string) => doc(db, path);
export async function one<T = Row>(r: DocumentReference): Promise<T | undefined> {
  const s = await getDoc(r);
  return s.exists() ? (s.data() as T) : undefined;
}
export function q(db: DB, path: string, ...w: Where[]): Query {
  return query(collection(db, path), ...w.map(([f, op, v]) => where(f, op, v)));
}
export async function all<T = Row>(qq: Query): Promise<T[]> {
  return (await getDocs(qq)).docs.map((d) => d.data() as T);
}
export { setDoc, updateDoc, deleteDoc, runTransaction, getDoc, doc, collection };

/** Sort helper for in-memory ordering (queries stay index-free). */
export function by<T>(...keys: (keyof T | ((r: T) => number | string))[]) {
  return (a: T, b: T) => {
    for (const k of keys) {
      const av = typeof k === 'function' ? k(a) : (a[k] as unknown as number | string);
      const bv = typeof k === 'function' ? k(b) : (b[k] as unknown as number | string);
      if (av < bv) return -1;
      if (av > bv) return 1;
    }
    return 0;
  };
}
