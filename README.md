# YorMenu

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

## Apps and hosting (free Firebase Spark plan)

| Where | What |
|---|---|
| Website | https://yormenu-91d7a.web.app (Firebase Hosting; custom domain yormenu.poelys.com). |
| Data & login | Firestore + Firebase Authentication, protected by `firebase/firestore.rules`. No server. |
| Phones | Android APK (`mobile/`), or the website added to the home screen. |
| Counter PC | Desktop app (`desktop/`): the same live app plus the print station for KOT and bill printers. |
| Downloads | GitHub Releases, built by `.github/workflows/release.yml` on every `v*` tag. |

Full setup, logins and demo: **[docs/SETUP.md](docs/SETUP.md)**.

## New in 0.2 / 0.3

- **Permission matrix** (Permissions screen): owner → trustee → manager → staff, with safety ceilings, live updates and audit.
- **Reports**: Today / Week / Month / Custom → Excel, PDF, CSV; email to owner; WhatsApp summary; report inbox; automatic daily/weekly/monthly emails.
- **Licences**: FSSAI, fire NOC, trade licence, etc. with expiry tracking; platform admin verifies.
- **Support**: platform support phone/WhatsApp/email shown everywhere; restaurants raise issues; platform replies.
- **Platform admin console**: dashboard, restaurant profiles and contacts, suspend with reason, password reset, support inbox, licence review, activity log.
- **Traffic-light table colours** with emoji, **English / Telugu / Hindi** labels, owner-chosen **brand colour**, phone bottom navigation.
- **Privacy**: login lockout after 5 wrong passwords, idle auto-logout, hidden customer phone numbers by permission, uploads checked by content.
- **0.3 cloud (free plan)**: Firestore + Firebase Auth with security rules, live sync across website, desktop and phones; desktop print station; GitHub release builds; no passwords in code (first admin via one-time setup).

## Roles

| Role | Sees |
|---|---|
| Owner, Trustee / co-founder | Everything, including settings |
| Manager | Everything except settings and owner/trustee accounts; can void bills and cancel cooked items |
| Billing counter | Floor, orders, bills, payments, guest requests, kitchen (view) |
| Server | Floor, orders, guest requests, cleaning requests. No bills list, reports, staff or settings |
| Kitchen | KOT screen; can mark dishes sold out |
| Cleaning crew | Cleaning list |
| Platform admin | Creates/suspends restaurants, verifies licences, answers support. Never sees orders, bills or customers |

These are the defaults. The owner can change them in **Permissions**.

Everyone logs in with **restaurant code + username + password**. Disabling a person or changing their password logs them out everywhere at once.
Every sensitive action (cancelled item, voided bill, reopened table, price change) is in the **Activity** log with who and why.

## How data is kept separate between restaurants

- All restaurant data lives under `restaurants/{id}/...` in Firestore. `members/{login}` says which restaurant and role each login has.
- Security rules (`firebase/firestore.rules`) check every read and write: only staff of that restaurant, only with the right permission; platform admins never see orders or bills.
- App code goes through a `Tenant` object (`web/src/core/tenant.ts`) that can only reach its own restaurant's documents.
- Tests (`web/test/`) run against the Firebase emulators with the real rules and try to read and change restaurant A's data as restaurant B.

## Run it

Needs Node.js 22+ and Java 21 (Firebase emulators).

```bash
npm install
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='choose-one' npm run dev   # emulators + demo seed + http://localhost:5173
npm test
npm run deploy                                                          # rules + website (docs/SETUP.md)
```

Demo logins (restaurant code `DEMO`, also on the live site):

| Role | Username | Password |
|---|---|---|
| Owner | owner | owner123 |
| Trustee | trustee | trustee123 |
| Manager | manager | manager123 |
| Billing counter | biller | biller123 |
| Server | server1 / server2 / server3 | server123 |
| Kitchen | chef | chef123 |
| Cleaning | cleaner | cleaner123 |

Platform admin: `/platform` with an email login. There is no default admin; it is created with `npm run seed` from
`ADMIN_EMAIL` / `ADMIN_PASSWORD`.

## Printing

- **Network (LAN/Wi-Fi) ESC/POS printer**: put its IP in Settings. The desktop app on the counter PC (same Wi-Fi) is the print station and prints every KOT and bill.
- **USB / Bluetooth printer**: open the Kitchen screen on the device connected to it and tick *Auto-print KOTs*. Print uses an 80 mm or 58 mm layout.

## Tests

```bash
npm test
```

Covers the full dinner lifecycle, add-more-items KOTs, reopen/regenerate bill, split payment, cancellations by role,
QR ordering, reports, role limits and cross-restaurant isolation.

## Layout

```
web/      React + Vite app. web/src/core has the business rules (talks to Firestore). /t/:token is the public QR menu.
firebase/ Firestore security rules and indexes.
desktop/  Electron app for the counter PC (live POS + print station).
mobile/   Capacitor Android app (opens the live POS).
docs/     Setup guide.
```

## Not built yet (next steps)

- WhatsApp sends via a `wa.me` link the cashier taps. Fully automatic sending needs a WhatsApp Business API account.
- Telugu/Hindi cover navigation, table states and main buttons; other screens are still English.
- Installers and APK are unsigned (debug APK; Windows SmartScreen warning). Sign them before wide rollout.
- Without internet the apps can't take orders. Firestore keeps the last screens visible; actions need a connection.
- Free-plan MVP: no report emails, PDF reports or licence file uploads yet (see docs/SETUP.md).
- Online payment links, inventory/stock, customer loyalty.
