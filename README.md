# Duka POS — Kenyan point-of-sale with M-Pesa STK Push

A lightweight POS: tap products, watch the till-roll receipt build up, then trigger
an M-Pesa STK Push straight to the customer's phone.

## Stack
- **Backend:** Node + Express, handles Daraja OAuth + STK Push (must be server-side —
  Safaricom needs your secret key, and browsers can't call Daraja directly due to CORS).
- **Frontend:** plain HTML/CSS/JS, no build step, in `/public`.

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
- Swap the in-memory `transactions` object in `server.js` for a real database
  (Postgres/SQLite) so receipts survive a server restart
- Swap the hardcoded `PRODUCTS` array in `public/app.js` for your real inventory,
  ideally served from an API/database so you can edit stock without redeploying

## File map
```
server.js               → Express server: auth, products, sales, STK push, callback, P&L
db.js                    → simple JSON-file data store (data.json is created on first run)
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
