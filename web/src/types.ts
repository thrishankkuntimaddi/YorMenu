export type Role = 'owner' | 'trustee' | 'manager' | 'cashier' | 'server' | 'chef' | 'cleaner';

export type Settings = {
  currency: string; timezone: string; countryCode: string;
  taxMode: 'exclusive' | 'inclusive' | 'none'; taxes: { name: string; rate: number }[];
  serviceChargePct: number; roundOff: boolean; billPrefix: string; billFooter: string;
  autoCleaning: boolean; qrOrdering: boolean; serversSeeAllTables: boolean;
  brandColor: string; language: 'en' | 'te' | 'hi'; idleLogoutMinutes: number; paperWidth: '80' | '58';
  kotPrinter: { host: string; port: number } | null; billPrinter: { host: string; port: number } | null;
};

export type Support = {
  supportName: string; supportPhone: string; supportWhatsapp: string; supportEmail: string; supportHours: string; companyName: string; announcement?: string;
};

export type Me = {
  user: { id: number; name: string; role: Role; lang: string };
  permissions: string[];
  manages: Role[];
  support: Support;
  restaurant: { id: number; code: string; name: string; address: string; phone: string; gstin: string; settings: Settings };
};

export type Section = { id: number; name: string; sort: number };
export type TableRow = { id: number; section_id: number; label: string; seats: number; active: number; sort: number };
export type Category = { id: number; name: string; sort: number; active: number };
export type MenuItem = {
  id: number; category_id: number; name: string; code: string; description: string; price: number;
  is_veg: number; available: number; is_special: number; send_to_kitchen: number; sort: number;
};
export type Catalog = { sections: Section[]; tables: TableRow[]; categories: Category[]; items: MenuItem[]; servers: { id: number; name: string }[] };

export type ItemStatus = 'queued' | 'cooking' | 'ready' | 'served' | 'cancelled';
export type OrderItem = {
  id: number; kot_id: number; kot_no: number; menu_item_id: number; name: string; price: number; qty: number; note: string;
  kitchen: number; status: ItemStatus; cancel_reason: string; created_at: string;
};
export type BillLine = { name: string; price: number; qty: number; amount: number };
export type Bill = {
  id: number; bill_no: number; bill_label: string; status: 'unpaid' | 'paid' | 'void'; subtotal: number; discount: number;
  service_charge: number; tax_total: number; round_off: number; grand_total: number; total_qty: number; created_at: string;
  paid_at: string | null; cashier_name: string;
  breakdown: { lines: BillLine[]; taxes: { name: string; rate: number; amount: number }[]; discountInput: { type: 'amount' | 'percent'; value: number } | null };
  payments: { method: string; amount: number; reference: string }[];
};
export type OrderStatus = 'open' | 'dining_done' | 'billed' | 'paid' | 'cancelled';
export type Order = {
  id: number; order_type: 'dine_in' | 'takeaway' | 'delivery'; table_id: number | null; table_label: string | null; status: OrderStatus;
  server_id: number | null; server_name: string | null; guests: number; customer_name: string; customer_phone: string; customer_address: string;
  notes: string; opened_at: string; where: string; items: OrderItem[];
  kots: { id: number; kot_no: number; source: string; created_at: string; printed_at: string | null; created_by_name: string }[];
  bill: Bill | null;
  totals: { subtotal: number; totalQty: number; grandTotal: number; taxes: { name: string; rate: number; amount: number }[] };
};

export type TableState = 'free' | 'seated' | 'running' | 'cooking' | 'ready' | 'dining_done' | 'billed' | 'cleaning';
export type FloorOrder = {
  id: number; order_type: string; table_id: number | null; status: OrderStatus; opened_at: string; server_name: string | null;
  amount: number; in_kitchen: number; ready: number; item_count: number; bill_total: number | null; bill_no: number | null;
  customer_name: string; customer_phone: string; where?: string; state?: TableState;
};
export type Floor = {
  sections: Section[];
  tables: { id: number; section_id: number; label: string; seats: number; needs_cleaning: number; state: TableState; order: FloorOrder | null }[];
  others: (FloorOrder & { where: string; state: TableState })[];
};

export type KitchenKot = {
  id: number; kot_no: number; order_id: number; source: string; created_at: string; printed_at: string | null; where: string;
  created_by_name: string; server_name: string | null;
  items: { id: number; name: string; qty: number; note: string; status: ItemStatus; created_at: string }[];
};

export type BillTicket = {
  restaurant: string; address: string; phone: string; gstin: string; billNo: string; date: string; where: string; cashier: string;
  customer: string; customerPhone: string; status: string; lines: BillLine[]; totalQty: number; subtotal: number; discount: number;
  serviceCharge: number; taxes: { name: string; rate: number; amount: number }[]; roundOff: number; grandTotal: number; footer: string;
};
export type KotTicket = { orderId: number; restaurant: string; kotNo: number; where: string; createdAt: string; by: string; items: { name: string; qty: number; note: string }[] };
