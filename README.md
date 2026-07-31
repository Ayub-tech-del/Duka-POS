# Duka POS — Kenyan point-of-sale with M-Pesa STK Push

A lightweight POS: tap products, watch the till-roll receipt build up, then trigger
an M-Pesa STK Push straight to the customer's phone.

## Stack
- **Backend:** Node + Express, handles Daraja OAuth + STK Push (must be server-side —
  Safaricom needs your secret key, and browsers can't call Daraja directly due to CORS).
- **Database:** SQLite via Node's built-in `node:sqlite` (`kenya-pos.db`, created on first
  run) — accounts, products, and sales persist across restarts. Requires **Node 22.5+**.
- **Frontend:** plain HTML/CSS/JS, no build step, in `/public`.

## Setup / signup
The first person to visit `/login.html` sets up the shop: owner username, password, and a
shop/business name, all in one form before the dashboard is reachable. That shop name shows
up in the dashboard sidebar and the POS header for anyone using the till. Staff accounts are
added later from the dashboard's Staff tab and log in with just a username/password.

If you're upgrading from an older version of this app that used `data.json`, it's imported
into SQLite automatically the first time the new server starts, then renamed to
`data.json.migrated` so it's not reimported on the next boot.

## 1. Get Daraja credentials (free, ~5 min)
1. Go to https://developer.safaricom.co.ke and create an account.
2. Create a new app → this gives you a **Consumer Key** and **Consumer Secret**.
3. Under the app, grab the sandbox **Test Credentials** for "Lipa Na M-Pesa Online":
   - Shortcode: `174379` (sandbox default)
   - Passkey: shown on the same page

## 2. Configure
```bash
cp .env.example .env
```
Fill in `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`.

## 3. Callback URL (important)
Safaricom sends the payment result to `MPESA_CALLBACK_URL` — this **must be a public
HTTPS URL**, it can't be `localhost`. For local testing, use ngrok:
```bash
ngrok http 3000
```
Copy the `https://xxxx.ngrok-free.app` URL, set:
```
MPESA_CALLBACK_URL=https://xxxx.ngrok-free.app/api/mpesa/callback
```
When you deploy for real (Render, Railway, a VPS, etc.), swap in your real domain.

## 4. Run it
```bash
npm install
npm start
```
Visit http://localhost:3000

## 5. Test a payment
- Sandbox only works with Safaricom's test phone number: **254708374149**
- Tap some products, enter that number, hit **Send STK Push**
- In sandbox there's no real phone prompt — check your server logs / the Daraja
  simulator on their portal to complete the transaction
- In **production** (`MPESA_ENV=production` + your live Paybill/Till shortcode +
  approved Daraja production app), a real STK prompt hits the customer's phone

## Going live
- Switch `MPESA_ENV=production` and use your business's live shortcode + passkey
  (you apply for these once Safaricom approves your Daraja production app)
- If you deploy somewhere with an ephemeral/reset-on-deploy filesystem (Render, Vercel,
  Railway without a persistent volume, etc.), attach a persistent disk for `kenya-pos.db`
  and `public/uploads/` — otherwise both reset on every redeploy. A managed Postgres
  instance is the other common fix; that'd mean swapping out `db.js`.

## File map
```
server.js               → Express server: auth, products, sales, STK push, callback, P&L
db.js                    → SQLite data store (kenya-pos.db, created on first run)
public/landing.html      → marketing homepage (illustrated hero, features, Google/login CTAs)
public/login.html        → sign-in / first-run owner setup
public/pos.html          → the till (product grid + till-roll receipt)
public/dashboard.html    → owner dashboard shell (P&L, sales, products, staff)
public/dashboard.js      → dashboard tabs, P&L/sales polling, product & staff CRUD
public/dashboard.css     → dashboard layout (sidebar, stat cards, tables, modal)
public/app.js            → POS cart logic, STK push call, payment polling
public/style.css         → shared design system (till-roll receipt, product grid)
public/uploads/          → uploaded product photos (created on first upload, gitignored)
.env.example             → credential template
```

Note: `npm install` now also pulls in `express-session` and `bcryptjs` for authentication, and
`multer` for product photo uploads — run it again if you installed before this update.
