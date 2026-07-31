require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const db = require('./db');

const app = express();

const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `product-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files are allowed'));
    cb(null, true);
  },
});

function deleteUpload(imagePath) {
  if (!imagePath || !imagePath.startsWith('/uploads/')) return;
  fs.unlink(path.join(__dirname, 'public', imagePath), () => {});
}
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'duka-pos-dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 12 },
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
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_CALLBACK_URL,
  PORT = 3000,
} = process.env;

const BASE_URL =
  MPESA_ENV === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';

const pendingCheckouts = {};

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
  const auth = Buffer.from(`${MPESA_CONSUMER_KEY}:${MPESA_CONSUMER_SECRET}`).toString('base64');
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

app.post('/api/auth/setup', async (req, res) => {
  const data = db.load();
  if (data.users.length > 0) {
    return res.status(400).json({ error: 'Setup already completed. Log in instead.' });
  }
  const { username, password, name, email, shopName } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  if (!shopName || !shopName.trim()) return res.status(400).json({ error: 'shop name required' });

  const passwordHash = await bcrypt.hash(password, 10);
  const owner = { id: 1, username, passwordHash, role: 'owner', name: name || username, email: email || null };
  data.users.push(owner);
  data.shop = { name: shopName.trim() };
  db.save(data);
  req.session.user = publicUser(owner);
  res.json(publicUser(owner));
});

app.get('/api/auth/needs-setup', (req, res) => {
  const data = db.load();
  res.json({ needsSetup: data.users.length === 0 });
});

app.get('/api/shop', requireAuth, (req, res) => {
  const data = db.load();
  res.json({ name: data.shop?.name || null });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const data = db.load();
  const user = data.users.find(u => u.username.toLowerCase() === (username || '').toLowerCase());
  if (!user) return res.status(401).json({ error: 'Invalid username or password' });
  if (!user.passwordHash) return res.status(401).json({ error: 'This account signs in with Google only.' });

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

// ---- Google OAuth ----------------------------------------------------------

app.get('/api/auth/google', (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CALLBACK_URL) {
    return res.redirect('/login.html?google=1');
  }
  const state = Math.random().toString(36).slice(2);
  req.session.oauthState = state;

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_CALLBACK_URL,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

app.get('/api/auth/google/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state || state !== req.session.oauthState) {
      return res.redirect('/login.html?google=error');
    }
    delete req.session.oauthState;

    const { data: tokenData } = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_CALLBACK_URL,
      grant_type: 'authorization_code',
    });

    const { data: profile } = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const data = db.load();
    let user = data.users.find(u => u.googleId === profile.sub);
    if (!user) user = data.users.find(u => u.email && u.email.toLowerCase() === profile.email.toLowerCase());

    if (!user) {
      if (data.users.length === 0) {
        // First account ever created — make them the owner
        const newId = 1;
        user = { id: newId, username: profile.email, googleId: profile.sub, email: profile.email, role: 'owner', name: profile.name || profile.email };
        data.users.push(user);
        db.save(data);
      } else {
        return res.redirect('/login.html?google=notfound');
      }
    } else if (!user.googleId) {
      user.googleId = profile.sub;
      db.save(data);
    }

    req.session.user = publicUser(user);
    res.redirect(user.role === 'owner' ? '/dashboard.html' : '/pos.html');
  } catch (err) {
    console.error('--- GOOGLE OAUTH ERROR ---');
    console.error(err.response?.data || err.message);
    console.error('--------------------------');
    res.redirect('/login.html?google=error');
  }
});

// Owner creates a staff account
app.post('/api/staff', requireOwner, async (req, res) => {
  const { username, password, name, email } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });

  const data = db.load();
  if (data.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(400).json({ error: 'That username is already taken' });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const newId = Math.max(...data.users.map(u => u.id), 0) + 1;
  const staff = { id: newId, username, passwordHash, role: 'staff', name: name || username, email: email || null };
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

function handleUpload(req, res, next) {
  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}

app.put('/api/products/:id', requireOwner, handleUpload, (req, res) => {
  const data = db.load();
  const id = Number(req.params.id);
  const product = data.products.find(p => p.id === id);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const { price, cost, name, emoji, cat, removeImage } = req.body;
  if (price !== undefined) product.price = Number(price);
  if (cost !== undefined) product.cost = Number(cost);
  if (name !== undefined) product.name = name;
  if (emoji !== undefined) product.emoji = emoji;
  if (cat !== undefined) product.cat = cat;

  if (req.file) {
    deleteUpload(product.image);
    product.image = `/uploads/${req.file.filename}`;
  } else if (removeImage === 'true') {
    deleteUpload(product.image);
    delete product.image;
  }

  db.save(data);
  res.json(product);
});

app.post('/api/products', requireOwner, handleUpload, (req, res) => {
  const data = db.load();
  const { name, price, cost = 0, emoji = '📦', cat = 'General' } = req.body;
  if (!name || price === undefined) return res.status(400).json({ error: 'name and price required' });

  const product = { id: data.nextProductId++, name, price: Number(price), cost: Number(cost), emoji, cat };
  if (req.file) product.image = `/uploads/${req.file.filename}`;
  data.products.push(product);
  db.save(data);
  res.json(product);
});

app.delete('/api/products/:id', requireOwner, (req, res) => {
  const data = db.load();
  const product = data.products.find(p => p.id === Number(req.params.id));
  if (product) deleteUpload(product.image);
  data.products = data.products.filter(p => p.id !== Number(req.params.id));
  db.save(data);
  res.json({ ok: true });
});

// ---- STK push + sales recording ----------------------------------------

app.post('/api/stkpush', requireAuth, async (req, res) => {
  try {
    const { phone, cart, accountRef = 'Duka POS', description = 'Sale' } = req.body;

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

app.post('/api/mpesa/callback', (req, res) => {
  const body = req.body?.Body?.stkCallback;
  if (body) {
    const { CheckoutRequestID, ResultCode, ResultDesc } = body;
    const pending = pendingCheckouts[CheckoutRequestID];

    if (pending) {
      pending.status = ResultCode === 0 ? 'success' : 'failed';
      pending.resultDesc = ResultDesc;

      if (ResultCode === 0) {
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

app.get('/api/sales', requireAuth, (req, res) => {
  const data = db.load();
  const isOwner = req.session.user.role === 'owner';
  const sales = isOwner ? data.sales : data.sales.filter(s => s.userId === req.session.user.id);
  res.json(sales.slice().reverse());
});

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