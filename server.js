require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const db = require('./db');

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'duka-pos-dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 12 }, // 12 hours
  })
);
app.use(express.static('public'));

const {
  MPESA_ENV = 'sandbox',
  MPESA_CONSUMER_KEY,
  MPESA_CONSUMER_SECRET,
  MPESA_SHORTCODE,
  MPESA_PASSKEY,
  MPESA_CALLBACK_URL,
  PORT = 3000,
} = process.env;

const BASE_URL =
  MPESA_ENV === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';

// Pending STK pushes, keyed by CheckoutRequestID, so the callback knows what sale to finalize
const pendingCheckouts = {};

// ---- M-Pesa helpers ------------------------------------------------------

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

async function getAccessToken() {
  const auth = Buffer.from(
    `${MPESA_CONSUMER_KEY}:${MPESA_CONSUMER_SECRET}`
  ).toString('base64');

  const { data } = await axios.get(
    `${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${auth}` } }
  );
  return data.access_token;
}

function normalizePhone(raw) {
  let phone = raw.replace(/\s+/g, '').replace(/^\+/, '');
  if (phone.startsWith('0')) phone = '254' + phone.slice(1);
  if (phone.startsWith('7') || phone.startsWith('1')) phone = '254' + phone;
  return phone;
}

// ---- Auth helpers ---------------------------------------------------------

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  next();
}

function requireOwner(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  if (req.session.user.role !== 'owner') return res.status(403).json({ error: 'Owner access only' });
  next();
}

function publicUser(u) {
  return { id: u.id, username: u.username, name: u.name, role: u.role };
}

// ---- Auth routes ----------------------------------------------------------

// First-run setup: only works when there are zero users yet
app.post('/api/auth/setup', async (req, res) => {
  const data = db.load();
  if (data.users.length > 0) {
    return res.status(400).json({ error: 'Setup already completed. Log in instead.' });
  }
  const { username, password, name } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });

  const passwordHash = await bcrypt.hash(password, 10);
  const owner = { id: 1, username, passwordHash, role: 'owner', name: name || username };
  data.users.push(owner);
  db.save(data);
  req.session.user = publicUser(owner);
  res.json(publicUser(owner));
});

app.get('/api/auth/needs-setup', (req, res) => {
  const data = db.load();
  res.json({ needsSetup: data.users.length === 0 });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const data = db.load();
  const user = data.users.find(u => u.username.toLowerCase() === (username || '').toLowerCase());
  if (!user) return res.status(401).json({ error: 'Invalid username or password' });

  const ok = await bcrypt.compare(password || '', user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid username or password' });

  req.session.user = publicUser(user);
  res.json(publicUser(user));
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  res.json(req.session.user);
});

// Owner creates a staff account
app.post('/api/staff', requireOwner, async (req, res) => {
  const { username, password, name } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });

  const data = db.load();
  if (data.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(400).json({ error: 'That username is already taken' });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const newId = Math.max(...data.users.map(u => u.id), 0) + 1;
  const staff = { id: newId, username, passwordHash, role: 'staff', name: name || username };
  data.users.push(staff);
  db.save(data);
  res.json(publicUser(staff));
});

app.get('/api/staff', requireOwner, (req, res) => {
  const data = db.load();
  res.json(data.users.map(publicUser));
});

app.delete('/api/staff/:id', requireOwner, (req, res) => {
  const data = db.load();
  const id = Number(req.params.id);
  const target = data.users.find(u => u.id === id);
  if (target && target.role === 'owner') {
    return res.status(400).json({ error: "Can't remove the owner account" });
  }
  data.users = data.users.filter(u => u.id !== id);
  db.save(data);
  res.json({ ok: true });
});

// ---- Product routes ---------------------------------------------------

app.get('/api/products', requireAuth, (req, res) => {
  const data = db.load();
  res.json(data.products);
});

// Owner sets price / cost price per product
app.put('/api/products/:id', requireOwner, (req, res) => {
  const data = db.load();
  const id = Number(req.params.id);
  const product = data.products.find(p => p.id === id);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const { price, cost, name, emoji, cat } = req.body;
  if (price !== undefined) product.price = Number(price);
  if (cost !== undefined) product.cost = Number(cost);
  if (name !== undefined) product.name = name;
  if (emoji !== undefined) product.emoji = emoji;
  if (cat !== undefined) product.cat = cat;

  db.save(data);
  res.json(product);
});

app.post('/api/products', requireOwner, (req, res) => {
  const data = db.load();
  const { name, price, cost = 0, emoji = '📦', cat = 'General' } = req.body;
  if (!name || price === undefined) return res.status(400).json({ error: 'name and price required' });

  const product = { id: data.nextProductId++, name, price: Number(price), cost: Number(cost), emoji, cat };
  data.products.push(product);
  db.save(data);
  res.json(product);
});

app.delete('/api/products/:id', requireOwner, (req, res) => {
  const data = db.load();
  data.products = data.products.filter(p => p.id !== Number(req.params.id));
  db.save(data);
  res.json({ ok: true });
});

// ---- STK push + sales recording ----------------------------------------

app.post('/api/stkpush', requireAuth, async (req, res) => {
  try {
    const { phone, cart, accountRef = 'Duka POS', description = 'Sale' } = req.body;
    // cart: [{ productId, qty }]

    if (!phone || !Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ error: 'phone and a non-empty cart are required' });
    }
    if (!MPESA_CONSUMER_KEY || !MPESA_CONSUMER_SECRET || !MPESA_SHORTCODE || !MPESA_PASSKEY) {
      return res.status(500).json({
        error: 'Daraja credentials missing. Fill in .env with your Consumer Key/Secret, Shortcode, and Passkey.',
      });
    }

    const data = db.load();
    const items = cart.map(({ productId, qty }) => {
      const p = data.products.find(p => p.id === Number(productId));
      return p ? { productId: p.id, name: p.name, qty, price: p.price, cost: p.cost || 0 } : null;
    }).filter(Boolean);

    const amount = items.reduce((sum, i) => sum + i.price * i.qty, 0);
    if (amount <= 0) return res.status(400).json({ error: 'Cart total must be greater than 0' });

    const token = await getAccessToken();
    const ts = timestamp();
    const password = Buffer.from(`${MPESA_SHORTCODE}${MPESA_PASSKEY}${ts}`).toString('base64');

    const payload = {
      BusinessShortCode: MPESA_SHORTCODE,
      Password: password,
      Timestamp: ts,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(amount),
      PartyA: normalizePhone(phone),
      PartyB: MPESA_SHORTCODE,
      PhoneNumber: normalizePhone(phone),
      CallBackURL: MPESA_CALLBACK_URL,
      AccountReference: accountRef.slice(0, 12),
      TransactionDesc: description.slice(0, 13),
    };

    const { data: stkData } = await axios.post(
      `${BASE_URL}/mpesa/stkpush/v1/processrequest`,
      payload,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    pendingCheckouts[stkData.CheckoutRequestID] = {
      status: 'pending',
      items,
      amount,
      phone,
      userId: req.session.user.id,
      username: req.session.user.username,
    };

    res.json(stkData);
  } catch (err) {
    console.error('--- STK PUSH ERROR ---');
    console.error('Status:', err.response?.status);
    console.error('Data:', JSON.stringify(err.response?.data, null, 2));
    console.error('Message:', err.message);
    console.error('----------------------');
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// Safaricom calls this directly. Must be a public HTTPS URL (ngrok in dev).
app.post('/api/mpesa/callback', (req, res) => {
  const body = req.body?.Body?.stkCallback;
  if (body) {
    const { CheckoutRequestID, ResultCode, ResultDesc } = body;
    const pending = pendingCheckouts[CheckoutRequestID];

    if (pending) {
      pending.status = ResultCode === 0 ? 'success' : 'failed';
      pending.resultDesc = ResultDesc;

      if (ResultCode === 0) {
        // Record the completed sale for bookkeeping / P&L
        const data = db.load();
        const sale = {
          id: data.nextSaleId++,
          userId: pending.userId,
          username: pending.username,
          items: pending.items,
          total: pending.amount,
          phone: pending.phone,
          checkoutRequestId: CheckoutRequestID,
          createdAt: new Date().toISOString(),
        };
        data.sales.push(sale);
        db.save(data);
      }
    }
    console.log('M-Pesa callback:', CheckoutRequestID, ResultDesc);
  }
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

app.get('/api/status/:checkoutRequestId', requireAuth, (req, res) => {
  const tx = pendingCheckouts[req.params.checkoutRequestId];
  if (!tx) return res.json({ status: 'pending' });
  res.json(tx);
});

// ---- Bookkeeping / sales history ----------------------------------------

app.get('/api/sales', requireAuth, (req, res) => {
  const data = db.load();
  const isOwner = req.session.user.role === 'owner';
  const sales = isOwner ? data.sales : data.sales.filter(s => s.userId === req.session.user.id);
  res.json(sales.slice().reverse());
});

// ---- P&L report (owner only) --------------------------------------------

app.get('/api/reports/pl', requireOwner, (req, res) => {
  const data = db.load();
  const { from, to } = req.query;

  const fromDate = from ? new Date(from) : new Date(0);
  const toDate = to ? new Date(to) : new Date(8640000000000000);

  const salesInRange = data.sales.filter(s => {
    const d = new Date(s.createdAt);
    return d >= fromDate && d <= toDate;
  });

  let revenue = 0;
  let cogs = 0;
  const byProduct = {};

  salesInRange.forEach(sale => {
    sale.items.forEach(item => {
      const lineRevenue = item.price * item.qty;
      const lineCost = (item.cost || 0) * item.qty;
      revenue += lineRevenue;
      cogs += lineCost;

      if (!byProduct[item.name]) byProduct[item.name] = { name: item.name, qty: 0, revenue: 0, cost: 0 };
      byProduct[item.name].qty += item.qty;
      byProduct[item.name].revenue += lineRevenue;
      byProduct[item.name].cost += lineCost;
    });
  });

  const profit = revenue - cogs;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

  res.json({
    revenue,
    cogs,
    profit,
    margin,
    saleCount: salesInRange.length,
    byProduct: Object.values(byProduct).sort((a, b) => b.revenue - a.revenue),
  });
});

app.listen(PORT, () => console.log(`Duka POS running on http://localhost:${PORT}`));
