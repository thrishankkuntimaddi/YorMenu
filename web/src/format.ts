export const rupees = (paise: number | null | undefined) =>
  `₹${((paise ?? 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const rupeesShort = (paise: number | null | undefined) =>
  `₹${((paise ?? 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
export const toPaise = (rupeeText: string) => Math.round(parseFloat(rupeeText || '0') * 100);

/** SQLite UTC timestamps -> Date. */
export const dbDate = (s: string) => new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
export const minutesSince = (s: string) => Math.max(0, Math.floor((Date.now() - dbDate(s).getTime()) / 60000));
export const elapsed = (s: string) => {
  const m = minutesSince(s);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
};
export const timeOf = (s: string) => dbDate(s).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
export const dateTimeOf = (s: string) => dbDate(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
export const isoDaysAgo = (n: number) => {
  const d = new Date(Date.now() - n * 86400000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner', trustee: 'Trustee / Co-founder', manager: 'Manager', cashier: 'Billing counter', server: 'Server', chef: 'Kitchen', cleaner: 'Cleaning crew',
};
export const ORDER_TYPE_LABEL: Record<string, string> = { dine_in: 'Dine in', takeaway: 'Parcel', delivery: 'Delivery' };
