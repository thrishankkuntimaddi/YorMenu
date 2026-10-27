# YourMenu

A multi-tenant restaurant platform: table floor, waiter app, kitchen KOT screen and printing,
billing counter, QR menu for guests, cleaning crew, reports and staff tracking.
Many restaurants can run on one server and none of them can see another's data.

## The dinner lifecycle

1. **Server** (phone) taps a table → adds items with quantities and notes → **Send to kitchen**.
   That creates a **KOT** (kitchen order ticket) with only those items.
2. **Kitchen** screen beeps, shows the KOT (table, items, counts) and can auto-print it on a thermal printer.
   Chef taps items *Cooking → Ready*, or **All ready**.
3. The **server gets a notification** ("Table Hut5: 2 x Paneer Butter Masala ready") and marks them served.
4. Family wants more → server adds items → a **new KOT with only the new items**.
5. Server taps **Dining complete**.
6. **Billing counter** sees every table live (colour = state, minutes, running amount).
   **Close table & bill** issues the bill number (sequential per restaurant), applies GST / discount / service charge, prints.
7. **Settle**: Cash, UPI, Card or split. Only now is the bill *paid*. The bill can also go to the customer's **WhatsApp**.
8. Table goes to the **cleaning crew**; they tap **Done** and the table is free again.

Water bottles, soft drinks and other "no KOT" items skip the kitchen and are ready straight away.

Parcel (takeaway) and delivery orders work the same way without a table.

### Guest QR code
Each table has a QR code (Floor plan → QR codes → Print all). Guests scan it to see the menu, specials and
veg filter, and can **place an order, call a server or ask for the bill**. Guest orders wait for a staff member to accept
them before they reach the kitchen. Ordering can be switched off in Settings (menu-only mode).

## Roles

| Role | Sees |
|---|---|
| Owner, Trustee / co-founder | Everything, including settings |
| Manager | Everything except settings and owner/trustee accounts; can void bills and cancel cooked items |
| Billing counter | Floor, orders, bills, payments, guest requests, kitchen (view) |
| Server | Floor, orders, guest requests, cleaning requests. No bills list, reports, staff or settings |
| Kitchen | KOT screen; can mark dishes sold out |
| Cleaning crew | Cleaning list |
| Platform admin | Creates and suspends restaurants. Never sees orders or bills |

Everyone logs in with **restaurant code + username + password**. Disabling a person or changing their password logs them out everywhere at once.
Every sensitive action (cancelled item, voided bill, reopened table, price change) is in the **Activity** log with who and why.

## How data is kept separate between restaurants

- Every row carries `restaurant_id`, and the restaurant comes **only from the signed login token**, never from the request.
- All route code goes through a `Tenant` object (`server/src/tenant.ts`) that **refuses to run any SQL without a `restaurant_id = ?` filter**.
- The database itself uses composite foreign keys `(id, restaurant_id)`, so even buggy code cannot link one restaurant's order to another's table or menu item.
- Live updates use one socket room per restaurant, joined only after the token is checked.
- Tests in `server/test/isolation.test.ts` try to read and change restaurant A's data as restaurant B and expect a 404 every time.

## Run it

Needs Node.js 22+.

```bash
npm install
npm run seed      # demo restaurant, code DEMO
npm run build     # build the web app
npm start         # http://localhost:4000
```

During development run `npm run dev` (API on :4000, web on :5173 with hot reload).
Open the web app on phones on the same Wi-Fi via `http://<computer-ip>:5173` (dev) or `:4000` (built).

Demo logins (restaurant code `DEMO`):

| Role | Username | Password |
|---|---|---|
| Owner | owner | owner123 |
| Trustee | trustee | trustee123 |
| Manager | manager | manager123 |
| Billing counter | biller | biller123 |
| Server | server1 / server2 / server3 | server123 |
| Kitchen | chef | chef123 |
| Cleaning | cleaner | cleaner123 |

Platform admin: `/platform`, user `admin`, password `admin123` (set `PLATFORM_ADMIN_USER` / `PLATFORM_ADMIN_PASSWORD` before first start).

Environment variables: `PORT` (4000), `DATA_DIR` (`./data`), `JWT_SECRET` (generated and saved in `DATA_DIR` if unset).

## Printing

- **Network (LAN/Wi-Fi) ESC/POS thermal printer**: put its IP in Settings. Every KOT then prints in the kitchen straight from the server, no tablet needed. Bills can print the same way.
- **USB / Bluetooth printer**: open the Kitchen screen on the device connected to it and tick *Auto-print KOTs*. Print uses an 80 mm layout. In Chrome, start with `--kiosk-printing` to skip the print dialog.

## Tests

```bash
npm test
```

Covers the full dinner lifecycle, add-more-items KOTs, reopen/regenerate bill, split payment, cancellations by role,
QR ordering, reports, role limits and cross-restaurant isolation.

## Layout

```
server/  Express + Socket.IO + SQLite (node:sqlite). src/services has the business rules.
web/     React + Vite. One app, screens shown by role. /t/:token is the public QR menu.
```

## Not built yet (next steps)

- WhatsApp sends via a `wa.me` link the cashier taps. Fully automatic sending needs a WhatsApp Business API account.
- Email KOT/bill, online payment links, inventory/stock, customer loyalty.
- SQLite is fine for one restaurant or a small group. For many restaurants on one server, move to Postgres (the SQL is plain and the tenant guard carries over).
