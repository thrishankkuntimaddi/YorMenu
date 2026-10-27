// Every tenant-owned table carries restaurant_id. Child rows reference their
// parent with a composite (id, restaurant_id) foreign key, so the database
// itself refuses to link a row from one restaurant to a row of another.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS platform_admins (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS restaurants (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  gstin TEXT NOT NULL DEFAULT '',
  settings TEXT NOT NULL DEFAULT '{}',
  bill_seq INTEGER NOT NULL DEFAULT 0,
  kot_seq INTEGER NOT NULL DEFAULT 0,
  kot_seq_date TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
  username TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','trustee','manager','cashier','server','chef','cleaner')),
  phone TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (restaurant_id, username),
  UNIQUE (id, restaurant_id)
);

CREATE TABLE IF NOT EXISTS sections (
  id INTEGER PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE (restaurant_id, name),
  UNIQUE (id, restaurant_id)
);

CREATE TABLE IF NOT EXISTS tables (
  id INTEGER PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
  section_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  seats INTEGER NOT NULL DEFAULT 4,
  qr_token TEXT NOT NULL UNIQUE,
  needs_cleaning INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE (restaurant_id, label),
  UNIQUE (id, restaurant_id),
  FOREIGN KEY (section_id, restaurant_id) REFERENCES sections(id, restaurant_id)
);

CREATE TABLE IF NOT EXISTS menu_categories (
  id INTEGER PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (restaurant_id, name),
  UNIQUE (id, restaurant_id)
);

CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
  category_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  code TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL CHECK (price >= 0),           -- paise
  is_veg INTEGER NOT NULL DEFAULT 1,
  available INTEGER NOT NULL DEFAULT 1,
  is_special INTEGER NOT NULL DEFAULT 0,
  send_to_kitchen INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE (id, restaurant_id),
  FOREIGN KEY (category_id, restaurant_id) REFERENCES menu_categories(id, restaurant_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
  order_type TEXT NOT NULL CHECK (order_type IN ('dine_in','takeaway','delivery')),
  table_id INTEGER,
  status TEXT NOT NULL CHECK (status IN ('open','dining_done','billed','paid','cancelled')),
  server_id INTEGER,
  guests INTEGER NOT NULL DEFAULT 0,
  customer_name TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  customer_address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL,
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  dining_done_at TEXT,
  closed_at TEXT,
  UNIQUE (id, restaurant_id),
  FOREIGN KEY (table_id, restaurant_id) REFERENCES tables(id, restaurant_id),
  FOREIGN KEY (server_id, restaurant_id) REFERENCES users(id, restaurant_id),
  FOREIGN KEY (created_by, restaurant_id) REFERENCES users(id, restaurant_id)
);
-- A table can only carry one live order at a time.
CREATE UNIQUE INDEX IF NOT EXISTS orders_one_live_per_table
  ON orders(table_id) WHERE table_id IS NOT NULL AND status IN ('open','dining_done','billed');
CREATE INDEX IF NOT EXISTS orders_by_status ON orders(restaurant_id, status);

CREATE TABLE IF NOT EXISTS kots (
  id INTEGER PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
  order_id INTEGER NOT NULL,
  kot_no INTEGER NOT NULL,
  business_date TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'staff',
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  printed_at TEXT,
  UNIQUE (id, restaurant_id),
  FOREIGN KEY (order_id, restaurant_id) REFERENCES orders(id, restaurant_id),
  FOREIGN KEY (created_by, restaurant_id) REFERENCES users(id, restaurant_id)
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
  order_id INTEGER NOT NULL,
  kot_id INTEGER NOT NULL,
  menu_item_id INTEGER NOT NULL,
  name TEXT NOT NULL,                 -- snapshot, so menu edits never change old bills
  price INTEGER NOT NULL,             -- paise, snapshot
  qty INTEGER NOT NULL CHECK (qty > 0),
  note TEXT NOT NULL DEFAULT '',
  kitchen INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('queued','cooking','ready','served','cancelled')),
  cancel_reason TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  ready_at TEXT, ready_by INTEGER,
  served_at TEXT, served_by INTEGER,
  cancelled_by INTEGER,
  FOREIGN KEY (order_id, restaurant_id) REFERENCES orders(id, restaurant_id),
  FOREIGN KEY (kot_id, restaurant_id) REFERENCES kots(id, restaurant_id),
  FOREIGN KEY (menu_item_id, restaurant_id) REFERENCES menu_items(id, restaurant_id)
);
CREATE INDEX IF NOT EXISTS order_items_by_order ON order_items(restaurant_id, order_id);

CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
  order_id INTEGER NOT NULL,
  bill_no INTEGER NOT NULL,
  business_date TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0,
  service_charge INTEGER NOT NULL DEFAULT 0,
  tax_total INTEGER NOT NULL DEFAULT 0,
  round_off INTEGER NOT NULL DEFAULT 0,
  grand_total INTEGER NOT NULL,
  total_qty INTEGER NOT NULL DEFAULT 0,
  breakdown TEXT NOT NULL DEFAULT '{}',   -- taxes + aggregated lines snapshot
  status TEXT NOT NULL CHECK (status IN ('unpaid','paid','void')),
  cashier_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT,
  void_reason TEXT NOT NULL DEFAULT '',
  UNIQUE (restaurant_id, bill_no),
  UNIQUE (id, restaurant_id),
  FOREIGN KEY (order_id, restaurant_id) REFERENCES orders(id, restaurant_id),
  FOREIGN KEY (cashier_id, restaurant_id) REFERENCES users(id, restaurant_id)
);
CREATE INDEX IF NOT EXISTS bills_by_date ON bills(restaurant_id, business_date);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
  bill_id INTEGER NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('cash','card','upi','other')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  reference TEXT NOT NULL DEFAULT '',
  received_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (bill_id, restaurant_id) REFERENCES bills(id, restaurant_id),
  FOREIGN KEY (received_by, restaurant_id) REFERENCES users(id, restaurant_id)
);

CREATE TABLE IF NOT EXISTS cleaning_tasks (
  id INTEGER PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
  table_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','done')),
  requested_by INTEGER,
  done_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  done_at TEXT,
  FOREIGN KEY (table_id, restaurant_id) REFERENCES tables(id, restaurant_id)
);

CREATE TABLE IF NOT EXISTS guest_requests (
  id INTEGER PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
  table_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('order','call_waiter','request_bill')),
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('pending','accepted','rejected')),
  handled_by INTEGER,
  order_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  handled_at TEXT,
  FOREIGN KEY (table_id, restaurant_id) REFERENCES tables(id, restaurant_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
  user_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT NOT NULL DEFAULT '',
  entity_id INTEGER,
  details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS audit_by_restaurant ON audit_log(restaurant_id, id);
`;
