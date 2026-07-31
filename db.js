const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data.json');

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

function defaultData() {
  return {
    users: [], // { id, username, passwordHash, role: 'owner'|'staff', name }
    products: DEFAULT_PRODUCTS,
    sales: [], // { id, userId, username, items:[{productId,name,qty,price,cost}], total, phone, checkoutRequestId, status, createdAt }
    nextProductId: DEFAULT_PRODUCTS.length + 1,
    nextSaleId: 1,
  };
}

function load() {
  if (!fs.existsSync(DB_PATH)) {
    save(defaultData());
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

module.exports = { load, save };
