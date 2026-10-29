import { collection, doc, getDoc, onSnapshot, query, where, type Unsubscribe } from 'firebase/firestore';
import { onAuthStateChanged, type Auth } from 'firebase/auth';
import type { DB, Row, Where } from './db';

/*
 * The live floor, kept in memory on each device.
 *
 * Screens reload whenever something changes. Without this, every reload asked Firestore
 * for all tables, running orders, staff and so on again, and Firestore bills every
 * document it returns. Here each device listens once to the documents those screens need;
 * after the first load Firestore only sends (and bills) the documents that change, and the
 * reloads are answered from memory.
 *
 * A feed starts the first time a screen needs it, so a kitchen tablet never pays for bills.
 * Anything a feed does not hold (old bills, closed orders, reports) is read from Firestore
 * as before.
 */

type Spec = { coll: string; field?: string; values?: unknown[] };

const SPECS: Record<string, Spec> = {
  sections: { coll: 'sections' },
  tables: { coll: 'tables' },
  users: { coll: 'users' },
  menu_categories: { coll: 'menu_categories' },
  menu_items: { coll: 'menu_items' },
  // Running orders only (same list as LIVE_STATUSES in services/orders).
  orders: { coll: 'orders', field: 'status', values: ['open', 'dining_done', 'billed'] },
  bills: { coll: 'bills', field: 'status', values: ['unpaid'] },
  print_jobs: { coll: 'print_jobs', field: 'status', values: ['queued', 'printing'] },
  cleaning_tasks: { coll: 'cleaning_tasks', field: 'status', values: ['pending'] },
  guest_requests: { coll: 'guest_requests', field: 'status', values: ['pending'] },
};

/** How long to wait for a feed's first load before reading Firestore directly instead. */
const FIRST_LOAD_MS = 8000;
/** A document this device changed in a transaction is read from the server until its update arrives (at most this long). */
const STALE_MS = 5000;

type Feed = {
  docs: Map<string, Row>;
  live: boolean;
  failed: boolean;
  first: Promise<boolean>;
  stop: Unsubscribe;
};

const eq = (a: unknown, b: unknown) => a === b;

/** The same filters Firestore applies, run on documents in memory. */
export function matches(row: Row, [field, op, value]: Where): boolean {
  const x = row[field];
  if (x === undefined) return false;
  const v = value as any;
  switch (op) {
    case '==': return eq(x, v);
    case '!=': return x !== null && !eq(x, v);
    case 'in': return (v as unknown[]).some((y) => eq(x, y));
    case 'not-in': return x !== null && !(v as unknown[]).some((y) => eq(x, y));
    case 'array-contains': return Array.isArray(x) && x.some((y) => eq(y, v));
    case 'array-contains-any': return Array.isArray(x) && x.some((y) => (v as unknown[]).some((z) => eq(y, z)));
    case '<': return x !== null && typeof x === typeof v && x < v;
    case '<=': return x !== null && typeof x === typeof v && x <= v;
    case '>': return x !== null && typeof x === typeof v && x > v;
    case '>=': return x !== null && typeof x === typeof v && x >= v;
    default: return false;
  }
}

/** Does a feed hold every document this query could return? */
function covers(spec: Spec, filters: Where[]): boolean {
  if (!spec.field) return true;
  return filters.some(([f, op, v]) => f === spec.field && (
    (op === '==' && spec.values!.includes(v)) ||
    (op === 'in' && Array.isArray(v) && v.length > 0 && v.every((x) => spec.values!.includes(x)))
  ));
}

const copy = <T>(v: T): T => structuredClone(v);

export class LiveMirror {
  private feeds = new Map<string, Feed>();
  private stale = new Map<string, number>();
  private uid: string | null | undefined = undefined;

  constructor(private db: DB, auth?: Auth) {
    // A different person signed in (or out): drop everything the last one could see.
    if (auth) {
      onAuthStateChanged(auth, (u) => {
        const uid = u?.uid ?? null;
        if (this.uid !== undefined && uid !== this.uid) this.stopAll();
        this.uid = uid;
      });
    }
  }

  stopAll() {
    for (const f of this.feeds.values()) f.stop();
    this.feeds.clear();
    this.stale.clear();
  }

  /** This device just changed these documents in a transaction ("orders/123", "restaurant"). */
  markWritten(rid: number, keys: string[]) {
    const until = Date.now() + STALE_MS;
    for (const k of keys) this.stale.set(`${rid}/${k}`, until);
  }

  private isStale(key: string) {
    const until = this.stale.get(key);
    if (until === undefined) return false;
    if (until < Date.now()) { this.stale.delete(key); return false; }
    return true;
  }

  private feed(rid: number, name: string): Feed | null {
    const spec = name === 'restaurant' ? null : SPECS[name];
    if (name !== 'restaurant' && !spec) return null;
    const key = `${rid}:${name}`;
    const existing = this.feeds.get(key);
    if (existing && !existing.failed) return existing;

    const docs = new Map<string, Row>();
    let resolveFirst!: (ok: boolean) => void;
    const f: Feed = { docs, live: false, failed: false, first: new Promise((r) => { resolveFirst = r; }), stop: () => {} };
    const onError = () => {
      // Usually "not allowed" (this role can't read it) or signed out: read Firestore directly instead.
      f.failed = true;
      f.live = false;
      resolveFirst(false);
      if (this.feeds.get(key) === f) this.feeds.delete(key);
    };
    const prefix = `${rid}/${name}/`;
    if (!spec) {
      f.stop = onSnapshot(doc(this.db, `restaurants/${rid}`), { includeMetadataChanges: true }, (snap) => {
        docs.clear();
        if (snap.exists()) docs.set('', snap.data());
        if (!snap.metadata.fromCache) { this.stale.delete(`${rid}/restaurant`); this.goLive(f, resolveFirst); }
      }, onError);
    } else {
      const ref = collection(this.db, `restaurants/${rid}/${spec.coll}`);
      const qq = spec.field ? query(ref, where(spec.field, spec.values!.length === 1 ? '==' : 'in', spec.values!.length === 1 ? spec.values![0] : spec.values)) : ref;
      f.stop = onSnapshot(qq, { includeMetadataChanges: true }, (snap) => {
        for (const ch of snap.docChanges()) {
          if (ch.type === 'removed') docs.delete(ch.doc.id);
          else docs.set(ch.doc.id, ch.doc.data());
          if (!snap.metadata.fromCache) this.stale.delete(prefix + ch.doc.id);
        }
        if (!snap.metadata.fromCache) this.goLive(f, resolveFirst);
      }, onError);
    }
    this.feeds.set(key, f);
    return f;
  }

  private goLive(f: Feed, resolveFirst: (ok: boolean) => void) {
    if (!f.live) { f.live = true; resolveFirst(true); }
  }

  /** Wait (briefly) for a feed's first load. False means: ask Firestore directly this time. */
  private async ready(f: Feed): Promise<boolean> {
    if (f.live) return true;
    if (f.failed) return false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<boolean>((r) => { timer = setTimeout(() => r(false), FIRST_LOAD_MS); });
    const ok = await Promise.race([f.first, timeout]);
    clearTimeout(timer);
    return ok;
  }

  /**
   * Answer a list query from memory, or undefined when Firestore must be asked.
   * Documents this device just changed are re-read one by one, so an action always sees its own result.
   */
  async list(rid: number, coll: string, filters: Where[]): Promise<Row[] | undefined> {
    const spec = SPECS[coll];
    if (!spec || !covers(spec, filters)) return undefined;
    const f = this.feed(rid, coll);
    if (!f || !(await this.ready(f))) return undefined;
    const prefix = `${rid}/${coll}/`;
    const out = new Map<string, Row>();
    for (const [id, row] of f.docs) if (!this.isStale(prefix + id)) out.set(id, row);
    const staleIds = [...this.stale.keys()].filter((k) => k.startsWith(prefix) && this.isStale(k)).map((k) => k.slice(prefix.length));
    if (staleIds.length) {
      const fresh = await Promise.all(staleIds.map((id) => getDoc(doc(this.db, `restaurants/${rid}/${coll}/${id}`))));
      for (const s of fresh) if (s.exists()) out.set(s.id, s.data());
    }
    // Firestore returns documents in id order; keep that.
    return [...out].filter(([, row]) => filters.every((w) => matches(row, w)))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, row]) => copy(row));
  }

  /**
   * One document from memory. Returns { row } when the answer is known (row undefined = it doesn't
   * exist), or undefined when Firestore must be asked.
   */
  async find(rid: number, coll: string, id: number | string): Promise<{ row: Row | undefined } | undefined> {
    const spec = SPECS[coll];
    if (!spec) return undefined;
    const f = this.feed(rid, coll);
    if (!f || !(await this.ready(f))) return undefined;
    if (this.isStale(`${rid}/${coll}/${id}`)) return undefined;
    const row = f.docs.get(String(id));
    if (row) return { row: copy(row) };
    // A feed of running orders doesn't know about closed ones; a full feed knows it's missing.
    return spec.field ? undefined : { row: undefined };
  }

  async restaurant(rid: number): Promise<Row | undefined> {
    const f = this.feed(rid, 'restaurant');
    if (!f || !(await this.ready(f))) return undefined;
    if (this.isStale(`${rid}/restaurant`)) return undefined;
    const row = f.docs.get('');
    return row ? copy(row) : undefined;
  }
}
