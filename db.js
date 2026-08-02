const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.join(__dirname, 'kenya-pos.db');
const LEGACY_JSON_PATH = path.join(__dirname, 'data.json');
const dbFileExisted = fs.existsSync(DB_PATH);

const sqlite = new DatabaseSync(DB_PATH);
sqlite.exec('PRAGMA journal_mode = WAL');

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL,
    passwordHash TEXT,
    googleId TEXT,
    email TEXT,
    role TEXT NOT NULL,
    name TEXT,
    plan TEXT NOT NULL DEFAULT 'free'
  );
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    cost REAL NOT NULL DEFAULT 0,
    emoji TEXT,
    cat TEXT,
    image TEXT
  );
  CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY,
    userId INTEGER,
    username TEXT,
    items TEXT NOT NULL,
    total REAL NOT NULL,
    phone TEXT,
    checkoutRequestId TEXT,
    createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS shop (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT
  );
`);

// Migration: older DB files predate the `plan` column.
const userColumns = sqlite.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!userColumns.includes('plan')) {
  sqlite.exec("ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free'");
}

const DEFAULT_PRODUCTS = [
  { id: 1, name: 'Unga 2kg', price: 220, cost: 180, emoji: '🌾', cat: 'Groceries' },
  { id: 2, name: 'Sukuma Wiki', price: 20, cost: 10, emoji: '🥬', cat: 'Groceries' },
  { id: 3, name: 'Milk 500ml', price: 65, cost: 50, emoji: '🥛', cat: 'Groceries' },
  { id: 4, name: 'Bread', price: 65, cost: 50, emoji: '🍞', cat: 'Groceries' },
  { id: 5, name: 'Cooking Oil 1L', price: 320, cost: 270, emoji: '🫙', cat: 'Groceries' },
  { id: 6, name: 'Rice 2kg', price: 280, cost: 230, emoji: '🍚', cat: 'Groceries' },
  { id: 7, name: 'Soda 500ml', price: 70, cost: 50, emoji: '🥤', cat: 'Drinks' },
  { id: 8, name: 'Bottled Water', price: 50, cost: 30, emoji: '💧', cat: 'Drinks' },
  { id: 9, name: 'Tea Leaves', price: 90, cost: 65, emoji: '🍵', cat: 'Drinks' },
  { id: 10, name: 'Airtime 50', price: 50, cost: 47, emoji: '📱', cat: 'Airtime' },
  { id: 11, name: 'Airtime 100', price: 100, cost: 94, emoji: '📱', cat: 'Airtime' },
  { id: 12, name: 'Soap Bar', price: 60, cost: 40, emoji: '🧼', cat: 'Household' },
  { id: 13, name: 'Detergent 500g', price: 150, cost: 110, emoji: '🧺', cat: 'Household' },
  { id: 14, name: 'Sugar 1kg', price: 160, cost: 130, emoji: '🍬', cat: 'Groceries' },
  { id: 15, name: 'Eggs (tray)', price: 420, cost: 360, emoji: '🥚', cat: 'Groceries' },
  { id: 16, name: 'Charcoal 2kg', price: 100, cost: 70, emoji: '🔥', cat: 'Household' },
];

function rowToUser(r) {
  return { id: r.id, username: r.username, passwordHash: r.passwordHash, googleId: r.googleId, email: r.email, role: r.role, name: r.name, plan: r.plan };
}
function rowToProduct(r) {
  return { id: r.id, name: r.name, price: r.price, cost: r.cost, emoji: r.emoji, cat: r.cat, image: r.image ?? undefined };
}
function rowToSale(r) {
  return { id: r.id, userId: r.userId, username: r.username, items: JSON.parse(r.items), total: r.total, phone: r.phone, checkoutRequestId: r.checkoutRequestId, createdAt: r.createdAt };
}

function seedDefaultProducts() {
  const insert = sqlite.prepare('INSERT INTO products (id, name, price, cost, emoji, cat) VALUES (?, ?, ?, ?, ?, ?)');
  for (const p of DEFAULT_PRODUCTS) insert.run(p.id, p.name, p.price, p.cost, p.emoji, p.cat);
}

// One-time migration: a brand-new SQLite file but an existing legacy data.json
// means this is an upgrade from the old JSON store — import it so no accounts,
// products, or sales get silently dropped.
function migrateLegacyJson() {
  if (dbFileExisted || !fs.existsSync(LEGACY_JSON_PATH)) return false;
  let legacy;
  try {
    legacy = JSON.parse(fs.readFileSync(LEGACY_JSON_PATH, 'utf-8'));
  } catch {
    return false;
  }
  save({
    users: legacy.users || [],
    products: legacy.products && legacy.products.length ? legacy.products : DEFAULT_PRODUCTS,
    sales: legacy.sales || [],
    shop: legacy.shop || null,
  });
  fs.renameSync(LEGACY_JSON_PATH, LEGACY_JSON_PATH + '.migrated');
  return true;
}

if (!migrateLegacyJson()) {
  const productCount = sqlite.prepare('SELECT COUNT(*) AS n FROM products').get().n;
  if (productCount === 0) seedDefaultProducts();
}

function load() {
  const users = sqlite.prepare('SELECT * FROM users ORDER BY id').all().map(rowToUser);
  const products = sqlite.prepare('SELECT * FROM products ORDER BY id').all().map(rowToProduct);
  const sales = sqlite.prepare('SELECT * FROM sales ORDER BY id').all().map(rowToSale);
  const shopRow = sqlite.prepare('SELECT name FROM shop WHERE id = 1').get();

  return {
    users,
    products,
    sales,
    shop: shopRow ? { name: shopRow.name } : null,
    nextProductId: products.reduce((max, p) => Math.max(max, p.id), 0) + 1,
    nextSaleId: sales.reduce((max, s) => Math.max(max, s.id), 0) + 1,
  };
}

function save(data) {
  sqlite.exec('BEGIN');
  try {
    sqlite.exec('DELETE FROM users');
    const insUser = sqlite.prepare('INSERT INTO users (id, username, passwordHash, googleId, email, role, name, plan) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const u of data.users || []) {
      insUser.run(u.id, u.username, u.passwordHash ?? null, u.googleId ?? null, u.email ?? null, u.role, u.name ?? null, u.plan ?? 'free');
    }

    sqlite.exec('DELETE FROM products');
    const insProduct = sqlite.prepare('INSERT INTO products (id, name, price, cost, emoji, cat, image) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const p of data.products || []) {
      insProduct.run(p.id, p.name, p.price, p.cost ?? 0, p.emoji ?? null, p.cat ?? null, p.image ?? null);
    }

    sqlite.exec('DELETE FROM sales');
    const insSale = sqlite.prepare('INSERT INTO sales (id, userId, username, items, total, phone, checkoutRequestId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const s of data.sales || []) {
      insSale.run(s.id, s.userId, s.username, JSON.stringify(s.items), s.total, s.phone ?? null, s.checkoutRequestId ?? null, s.createdAt);
    }

    if (data.shop && data.shop.name) {
      sqlite.prepare('INSERT INTO shop (id, name) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name').run(data.shop.name);
    }

    sqlite.exec('COMMIT');
  } catch (err) {
    sqlite.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { load, save };
