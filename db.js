const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Duka POS requires a Postgres database — ' +
    'set DATABASE_URL in your environment (see .env.example) and restart the server.'
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
});

const DEFAULT_PRODUCTS = [
  { name: 'Unga 2kg', price: 220, cost: 180, emoji: '🌾', cat: 'Groceries' },
  { name: 'Sukuma Wiki', price: 20, cost: 10, emoji: '🥬', cat: 'Groceries' },
  { name: 'Milk 500ml', price: 65, cost: 50, emoji: '🥛', cat: 'Groceries' },
  { name: 'Bread', price: 65, cost: 50, emoji: '🍞', cat: 'Groceries' },
  { name: 'Cooking Oil 1L', price: 320, cost: 270, emoji: '🫙', cat: 'Groceries' },
  { name: 'Rice 2kg', price: 280, cost: 230, emoji: '🍚', cat: 'Groceries' },
  { name: 'Soda 500ml', price: 70, cost: 50, emoji: '🥤', cat: 'Drinks' },
  { name: 'Bottled Water', price: 50, cost: 30, emoji: '💧', cat: 'Drinks' },
  { name: 'Tea Leaves', price: 90, cost: 65, emoji: '🍵', cat: 'Drinks' },
  { name: 'Airtime 50', price: 50, cost: 47, emoji: '📱', cat: 'Airtime' },
  { name: 'Airtime 100', price: 100, cost: 94, emoji: '📱', cat: 'Airtime' },
  { name: 'Soap Bar', price: 60, cost: 40, emoji: '🧼', cat: 'Household' },
  { name: 'Detergent 500g', price: 150, cost: 110, emoji: '🧺', cat: 'Household' },
  { name: 'Sugar 1kg', price: 160, cost: 130, emoji: '🍬', cat: 'Groceries' },
  { name: 'Eggs (tray)', price: 420, cost: 360, emoji: '🥚', cat: 'Groceries' },
  { name: 'Charcoal 2kg', price: 100, cost: 70, emoji: '🔥', cat: 'Household' },
];

function rowToUser(r) {
  return {
    id: r.id, username: r.username, passwordHash: r.passwordHash, googleId: r.googleId,
    email: r.email, role: r.role, name: r.name, plan: r.plan, planExpiresAt: r.planExpiresAt,
  };
}
function rowToProduct(r) {
  return { id: r.id, name: r.name, price: r.price, cost: r.cost, emoji: r.emoji, cat: r.cat, image: r.image ?? undefined };
}
function rowToSale(r) {
  return {
    id: r.id, userId: r.userId, username: r.username, items: r.items, total: r.total,
    phone: r.phone, checkoutRequestId: r.checkoutRequestId, createdAt: r.createdAt,
  };
}

// ---- schema + seeding ------------------------------------------------------

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      "passwordHash" TEXT,
      "googleId" TEXT,
      email TEXT,
      role TEXT NOT NULL,
      name TEXT,
      plan TEXT NOT NULL DEFAULT 'free',
      "planExpiresAt" TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      price DOUBLE PRECISION NOT NULL,
      cost DOUBLE PRECISION NOT NULL DEFAULT 0,
      emoji TEXT,
      cat TEXT,
      image TEXT
    );
    CREATE TABLE IF NOT EXISTS sales (
      id SERIAL PRIMARY KEY,
      "userId" INTEGER,
      username TEXT,
      items JSONB NOT NULL,
      total DOUBLE PRECISION NOT NULL,
      phone TEXT,
      "checkoutRequestId" TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shop (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT
    );
  `);

  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM products');
  if (rows[0].n === 0) await seedDefaultProducts();
}

async function seedDefaultProducts() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const p of DEFAULT_PRODUCTS) {
      await client.query(
        'INSERT INTO products (name, price, cost, emoji, cat) VALUES ($1, $2, $3, $4, $5)',
        [p.name, p.price, p.cost, p.emoji, p.cat]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---- load -------------------------------------------------------------

async function load() {
  const [usersRes, productsRes, salesRes, shopRes] = await Promise.all([
    pool.query('SELECT * FROM users ORDER BY id'),
    pool.query('SELECT * FROM products ORDER BY id'),
    pool.query('SELECT * FROM sales ORDER BY id'),
    pool.query('SELECT name FROM shop WHERE id = 1'),
  ]);

  return {
    users: usersRes.rows.map(rowToUser),
    products: productsRes.rows.map(rowToProduct),
    sales: salesRes.rows.map(rowToSale),
    shop: shopRes.rows[0] ? { name: shopRes.rows[0].name } : null,
  };
}

// ---- save ---------------------------------------------------------------
//
// server.js loads the full snapshot, mutates the in-memory arrays (push to
// add, edit fields to update, filter out to delete), then calls save() with
// the result. Each sync function below diffs that snapshot against what's
// currently in the table: rows without an `id` are new inserts (Postgres
// assigns the id and we write it back onto the caller's object so the
// response returned to the client already has it); rows with an id that's
// still present are updated in place; ids that disappeared are deleted.

async function syncUsers(client, users) {
  const { rows: existing } = await client.query('SELECT id FROM users');
  const existingIds = new Set(existing.map(r => r.id));
  const incomingIds = new Set(users.filter(u => u.id != null).map(u => u.id));

  for (const id of existingIds) {
    if (!incomingIds.has(id)) await client.query('DELETE FROM users WHERE id = $1', [id]);
  }

  for (const u of users) {
    const params = [
      u.username, u.passwordHash ?? null, u.googleId ?? null, u.email ?? null,
      u.role, u.name ?? null, u.plan ?? 'free', u.planExpiresAt ?? null,
    ];
    if (u.id != null && existingIds.has(u.id)) {
      await client.query(
        `UPDATE users SET username=$1, "passwordHash"=$2, "googleId"=$3, email=$4, role=$5, name=$6, plan=$7, "planExpiresAt"=$8 WHERE id=$9`,
        [...params, u.id]
      );
    } else {
      const { rows } = await client.query(
        `INSERT INTO users (username, "passwordHash", "googleId", email, role, name, plan, "planExpiresAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        params
      );
      u.id = rows[0].id;
    }
  }
}

async function syncProducts(client, products) {
  const { rows: existing } = await client.query('SELECT id FROM products');
  const existingIds = new Set(existing.map(r => r.id));
  const incomingIds = new Set(products.filter(p => p.id != null).map(p => p.id));

  for (const id of existingIds) {
    if (!incomingIds.has(id)) await client.query('DELETE FROM products WHERE id = $1', [id]);
  }

  for (const p of products) {
    const params = [p.name, p.price, p.cost ?? 0, p.emoji ?? null, p.cat ?? null, p.image ?? null];
    if (p.id != null && existingIds.has(p.id)) {
      await client.query(
        'UPDATE products SET name=$1, price=$2, cost=$3, emoji=$4, cat=$5, image=$6 WHERE id=$7',
        [...params, p.id]
      );
    } else {
      const { rows } = await client.query(
        'INSERT INTO products (name, price, cost, emoji, cat, image) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        params
      );
      p.id = rows[0].id;
    }
  }
}

async function syncSales(client, sales) {
  const { rows: existing } = await client.query('SELECT id FROM sales');
  const existingIds = new Set(existing.map(r => r.id));
  const incomingIds = new Set(sales.filter(s => s.id != null).map(s => s.id));

  for (const id of existingIds) {
    if (!incomingIds.has(id)) await client.query('DELETE FROM sales WHERE id = $1', [id]);
  }

  for (const s of sales) {
    const params = [
      s.userId ?? null, s.username ?? null, JSON.stringify(s.items), s.total,
      s.phone ?? null, s.checkoutRequestId ?? null, s.createdAt,
    ];
    if (s.id != null && existingIds.has(s.id)) {
      await client.query(
        `UPDATE sales SET "userId"=$1, username=$2, items=$3, total=$4, phone=$5, "checkoutRequestId"=$6, "createdAt"=$7 WHERE id=$8`,
        [...params, s.id]
      );
    } else {
      const { rows } = await client.query(
        `INSERT INTO sales ("userId", username, items, total, phone, "checkoutRequestId", "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        params
      );
      s.id = rows[0].id;
    }
  }
}

async function syncShop(client, shop) {
  if (shop && shop.name) {
    await client.query(
      'INSERT INTO shop (id, name) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET name = excluded.name',
      [shop.name]
    );
  }
}

async function save(data) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await syncUsers(client, data.users || []);
    await syncProducts(client, data.products || []);
    await syncSales(client, data.sales || []);
    await syncShop(client, data.shop);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { init, load, save };
