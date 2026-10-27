# YorMenu setup guide (free Firebase Spark plan)

```
 Website  ─┐
 Android  ─┼──►  Firebase (free Spark plan)
 Desktop  ─┘       • Authentication: Email/Password  (who you are)
     │             • Firestore + security rules      (data, live sync, who may do what)
     │             • Hosting                         (the website)
     └── LAN / USB thermal printers  ◄── the desktop app on the counter PC prints KOTs and bills
```

No server and no Storage. Each app talks to Firestore directly; `firebase/firestore.rules` is the
guard. They check every read and write against the person's restaurant, role and the owner's
permission matrix.

Live site: **https://yormenu-91d7a.web.app** (custom domain `yormenu.poelys.com`, see below).

## Who logs in how

| Who | Where | Login |
|---|---|---|
| Platform admin | `/platform` | email + password (e.g. admin@poelys.com) |
| Owner | `/login` | restaurant code + username + password, made by the platform admin |
| Trustee, managers, billing, servers, kitchen, cleaning | `/login` | restaurant code + username + password, made by the owner (or a manager for floor staff) in **Staff** |

1. Platform admin → **Restaurants → + Restaurant**: restaurant code (e.g. `ANNAPURNA`), name, and the owner's username/password.
2. Owner logs in → **Staff → + Add staff** for each person, choosing their role. **Permissions** fine-tunes what each role can do.
3. Each person logs in on their phone/PC with the restaurant code, their username and password.

Forgotten password: the owner (or manager, for floor staff) opens **Staff → Edit → New password**.
The platform admin can do the same for owners/managers under **Restaurants → Owner & managers**.

## Demo restaurant (live)

Restaurant code **DEMO**: owner/owner123, trustee/trustee123, manager/manager123, biller/biller123,
server1·server2·server3/server123, chef/chef123, cleaner/cleaner123.

Log in as different people on different phones and watch tables, KOTs and bills update live.

## Deploy

```bash
firebase login                 # once
npm run deploy                 # security rules + website
```

First admin and demo data on the live project (passwords from the environment only, never in code):

```bash
cd web
YORMENU_LIVE=1 ADMIN_EMAIL=admin@poelys.com ADMIN_PASSWORD='…' \
  SUPPORT_NAME='Muzamil Kamalapuram' SUPPORT_PHONE=7893178596 npm run seed
```

The first admin is created by a one-time setup that the security rules allow only once, ever.
More admins: `/platform` → *My account → Platform admins*.

## Custom domain: yormenu.poelys.com

Firebase console → *Hosting → Add custom domain* → `yormenu.poelys.com` → add the DNS records it shows
at your `poelys.com` DNS provider. HTTPS is automatic. Also add the domain under
*Authentication → Settings → Authorized domains*.

## Apps

- **Android:** `npm run apk` → `mobile/YorMenu.apk` (opens the live site, works on mobile data or Wi-Fi).
- **Desktop (counter PC):** `npm run desktop:win` / `desktop:mac`. Same live app, plus the print station.
- **GitHub Releases:** push a tag (`git tag v0.3.0 && git push origin v0.3.0`); `.github/workflows/release.yml`
  builds and publishes `YorMenu-Android.apk`, `YorMenu-Windows-Setup.exe`, `YorMenu-Mac-AppleSilicon.dmg`,
  `YorMenu-Mac-Intel.dmg`, `YorMenu-Linux.AppImage`, `YorMenu-Linux.deb`, `latest.json`.

## KOT / bill printers

| Printer | Setup |
|---|---|
| LAN / Wi-Fi ESC/POS | Print its IP (hold FEED while switching on), reserve the IP in the router, enter it in Settings → *Network thermal printers* (port 9100). Keep the desktop app open and logged in on the counter PC on the same Wi-Fi; the 🖨 chip shows it is printing. |
| USB on the counter PC | Set as default printer (80 mm). In the desktop app bills/KOTs print with no dialog. Kitchen screen → *Auto-print KOTs*. |
| Bluetooth + Android | Pair, install RawBT, Kitchen screen → *Auto-print KOTs*. |

## What the MVP leaves out (needs a paid plan or later work)

- Automatic report emails and PDF reports (Excel, CSV and WhatsApp summary are there).
- Licence file uploads (licence numbers and expiry dates are there; YorMenu verifies them).
- Server-side checking of bill totals: the rules check *who* may bill, not the maths. Every bill,
  void, discount and cancellation is in the Activity log for the owner to review.

## Local development

Needs Node 22+ and Java 21 (Firebase emulators).

```bash
npm install
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='local-pass' npm run dev   # emulators + seed + http://localhost:5173
npm test                                                                  # 33 tests with the real security rules
```
