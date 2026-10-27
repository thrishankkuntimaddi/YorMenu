import { DB, Row, one, all, run, tx } from './db.js';
import { notFound } from './errors.js';

type Param = string | number | null;

const TENANT_TABLES = new Set([
  'users', 'sections', 'tables', 'menu_categories', 'menu_items', 'orders', 'kots',
  'order_items', 'bills', 'payments', 'cleaning_tasks', 'guest_requests', 'audit_log',
]);

/**
 * The only way route code touches restaurant data. A Tenant is bound to one
 * restaurant id taken from the verified login token, never from the request.
 * Every query must filter on restaurant_id; the guard below rejects any SQL
 * that forgets, so a missing filter fails loudly in tests instead of leaking.
 */
export class Tenant {
  constructor(public readonly db: DB, public readonly rid: number) {}

  private guard(sql: string) {
    if (!/restaurant_id\s*=\s*\?/.test(sql) && !/^\s*INSERT/i.test(sql)) {
      throw new Error(`Tenant query without restaurant_id filter: ${sql}`);
    }
    if (/^\s*INSERT/i.test(sql) && !/restaurant_id/.test(sql)) {
      throw new Error(`Tenant insert without restaurant_id: ${sql}`);
    }
  }

  one<T = Row>(sql: string, ...params: Param[]): T | undefined {
    this.guard(sql);
    return one<T>(this.db, sql, ...params);
  }
  all<T = Row>(sql: string, ...params: Param[]): T[] {
    this.guard(sql);
    return all<T>(this.db, sql, ...params);
  }
  run(sql: string, ...params: Param[]) {
    this.guard(sql);
    return run(this.db, sql, ...params);
  }
  tx<T>(fn: () => T): T {
    return tx(this.db, fn);
  }

  find<T = Row>(table: string, id: number): T | undefined {
    if (!TENANT_TABLES.has(table)) throw new Error(`Unknown tenant table ${table}`);
    return one<T>(this.db, `SELECT * FROM ${table} WHERE id = ? AND restaurant_id = ?`, id, this.rid);
  }
  must<T = Row>(table: string, id: number, what = 'Record'): T {
    const row = this.find<T>(table, id);
    if (!row) throw notFound(`${what} not found`);
    return row;
  }

  restaurant(): Row {
    return one(this.db, 'SELECT * FROM restaurants WHERE id = ?', this.rid)!;
  }

  audit(userId: number | null, action: string, entity = '', entityId: number | null = null, details: unknown = {}) {
    run(
      this.db,
      'INSERT INTO audit_log (restaurant_id, user_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      this.rid, userId, action, entity, entityId, JSON.stringify(details),
    );
  }
}
