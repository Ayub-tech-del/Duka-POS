// ---- Dashboard: P&L, sales history, products, staff ----

let me = null;
let activeTab = 'overview';
let pollTimer = null;

const userNameEl = document.getElementById('userName');
const logoutBtn = document.getElementById('logoutBtn');
const navItems = document.querySelectorAll('.nav-item');
const tabPanels = document.querySelectorAll('.tab-panel');

const rangeSelect = document.getElementById('rangeSelect');
const statRevenue = document.getElementById('statRevenue');
const statCogs = document.getElementById('statCogs');
const statProfit = document.getElementById('statProfit');
const statMargin = document.getElementById('statMargin');
const byProductBody = document.querySelector('#byProductTable tbody');
const salesBody = document.querySelector('#salesTable tbody');
const productsBody = document.querySelector('#productsTable tbody');
const staffBody = document.querySelector('#staffTable tbody');
const addProductBtn = document.getElementById('addProductBtn');
const addStaffBtn = document.getElementById('addStaffBtn');

const modalOverlay = document.getElementById('modalOverlay');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');
const modalCancel = document.getElementById('modalCancel');
const modalConfirm = document.getElementById('modalConfirm');

function money(n) {
  return 'KSh ' + Math.round(n || 0).toLocaleString('en-KE');
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- Tabs ----------------------------------------------------------

function switchTab(tab) {
  activeTab = tab;
  navItems.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  tabPanels.forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
  loadTab(tab);
}

function loadTab(tab) {
  if (tab === 'overview') loadOverview();
  else if (tab === 'sales') loadSales();
  else if (tab === 'products') loadProducts();
  else if (tab === 'staff') loadStaff();
}

navItems.forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

// ---- Overview / P&L --------------------------------------------------

function rangeFrom(value) {
  const now = new Date();
  if (value === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  if (value === 'week') { const d = new Date(now); d.setDate(d.getDate() - 7); return d.toISOString(); }
  if (value === 'month') { const d = new Date(now); d.setDate(d.getDate() - 30); return d.toISOString(); }
  return null;
}

async function loadOverview() {
  const from = rangeFrom(rangeSelect.value);
  const url = '/api/reports/pl' + (from ? `?from=${encodeURIComponent(from)}` : '');
  const res = await fetch(url);
  if (!res.ok) return;
  const data = await res.json();

  statRevenue.textContent = money(data.revenue);
  statCogs.textContent = money(data.cogs);
  statProfit.textContent = money(data.profit);
  statMargin.textContent = `${data.margin.toFixed(1)}%`;

  byProductBody.innerHTML = data.byProduct.length
    ? data.byProduct.map(p => `
        <tr>
          <td>${esc(p.name)}</td>
          <td>${p.qty}</td>
          <td>${money(p.revenue)}</td>
          <td>${money(p.cost)}</td>
          <td>${money(p.revenue - p.cost)}</td>
        </tr>`).join('')
    : `<tr class="empty-row"><td colspan="5">No sales in this range yet</td></tr>`;
}

rangeSelect.addEventListener('change', loadOverview);

// ---- Sales history ---------------------------------------------------

async function loadSales() {
  const res = await fetch('/api/sales');
  if (!res.ok) return;
  const sales = await res.json();

  salesBody.innerHTML = sales.length
    ? sales.map(s => `
        <tr>
          <td>#${s.id}</td>
          <td>${new Date(s.createdAt).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}</td>
          <td>${esc(s.username)}</td>
          <td>${s.items.map(i => `${i.qty}× ${esc(i.name)}`).join(', ')}</td>
          <td>${money(s.total)}</td>
          <td>${esc(s.phone)}</td>
        </tr>`).join('')
    : `<tr class="empty-row"><td colspan="6">No sales yet</td></tr>`;
}

// ---- Products ----------------------------------------------------------

let productCache = [];

async function loadProducts() {
  const res = await fetch('/api/products');
  if (!res.ok) return;
  productCache = await res.json();

  productsBody.innerHTML = productCache.length
    ? productCache.map(p => {
        const margin = p.price > 0 ? (((p.price - p.cost) / p.price) * 100).toFixed(1) : '0.0';
        return `
          <tr data-id="${p.id}">
            <td>${p.emoji} ${esc(p.name)}</td>
            <td>${esc(p.cat)}</td>
            <td>${money(p.price)}</td>
            <td>${money(p.cost)}</td>
            <td>${margin}%</td>
            <td>
              <button class="row-action edit-product">Edit</button>
              <button class="row-action delete-product">Delete</button>
            </td>
          </tr>`;
      }).join('')
    : `<tr class="empty-row"><td colspan="6">No products yet</td></tr>`;

  productsBody.querySelectorAll('.edit-product').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.closest('tr').dataset.id;
      const p = productCache.find(x => x.id === Number(id));
      openProductModal(p);
    });
  });

  productsBody.querySelectorAll('.delete-product').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('tr').dataset.id;
      if (!confirm('Delete this product?')) return;
      await fetch(`/api/products/${id}`, { method: 'DELETE' });
      loadProducts();
    });
  });
}

function openProductModal(product) {
  const isEdit = !!product;
  openModal(isEdit ? 'Edit product' : 'Add product', `
    <div class="modal-error" id="mError"></div>
    <div class="modal-field"><label>Name</label><input id="mName" type="text" placeholder="e.g. Maize Flour 2kg" value="${isEdit ? esc(product.name) : ''}"></div>
    <div class="modal-field"><label>Category</label><input id="mCat" type="text" placeholder="e.g. Groceries" value="${isEdit ? esc(product.cat) : ''}"></div>
    <div class="modal-field"><label>Emoji</label><input id="mEmoji" type="text" placeholder="📦" maxlength="4" value="${isEdit ? esc(product.emoji) : ''}"></div>
    <div class="modal-field"><label>Sell price</label><input id="mPrice" type="number" min="0" step="1" value="${isEdit ? product.price : ''}"></div>
    <div class="modal-field"><label>Cost price</label><input id="mCost" type="number" min="0" step="1" value="${isEdit ? product.cost : 0}"></div>
  `, async () => {
    const name = document.getElementById('mName').value.trim();
    const price = document.getElementById('mPrice').value;
    const errorEl = document.getElementById('mError');
    if (!name || price === '') {
      errorEl.textContent = 'Name and sell price are required.';
      errorEl.classList.add('show');
      return;
    }
    const payload = {
      name,
      price,
      cost: document.getElementById('mCost').value || 0,
      emoji: document.getElementById('mEmoji').value.trim() || '📦',
      cat: document.getElementById('mCat').value.trim() || 'General',
    };
    const url = isEdit ? `/api/products/${product.id}` : '/api/products';
    await fetch(url, {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    closeModal();
    loadProducts();
  });
}

addProductBtn.addEventListener('click', () => openProductModal(null));

// ---- Staff ---------------------------------------------------------

async function loadStaff() {
  const res = await fetch('/api/staff');
  if (!res.ok) return;
  const staff = await res.json();

  staffBody.innerHTML = staff.length
    ? staff.map(u => `
        <tr data-id="${u.id}">
          <td>${esc(u.name)}</td>
          <td>${esc(u.username)}</td>
          <td>${u.role}</td>
          <td>${u.role !== 'owner' ? `<button class="row-action delete-staff">Remove</button>` : ''}</td>
        </tr>`).join('')
    : `<tr class="empty-row"><td colspan="4">No staff accounts yet</td></tr>`;

  staffBody.querySelectorAll('.delete-staff').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('tr').dataset.id;
      if (!confirm('Remove this staff account?')) return;
      await fetch(`/api/staff/${id}`, { method: 'DELETE' });
      loadStaff();
    });
  });
}

addStaffBtn.addEventListener('click', () => {
  openModal('Add staff', `
    <div class="modal-error" id="mError"></div>
    <div class="modal-field"><label>Name</label><input id="mName" type="text" placeholder="Staff name"></div>
    <div class="modal-field"><label>Username</label><input id="mUsername" type="text" placeholder="Login username"></div>
    <div class="modal-field"><label>Password</label><input id="mPassword" type="password" placeholder="Login password"></div>
  `, async () => {
    const username = document.getElementById('mUsername').value.trim();
    const password = document.getElementById('mPassword').value;
    const errorEl = document.getElementById('mError');
    if (!username || !password) {
      errorEl.textContent = 'Username and password are required.';
      errorEl.classList.add('show');
      return;
    }
    const res = await fetch('/api/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, name: document.getElementById('mName').value.trim() }),
    });
    if (!res.ok) {
      const err = await res.json();
      errorEl.textContent = err.error || 'Could not add staff';
      errorEl.classList.add('show');
      return;
    }
    closeModal();
    loadStaff();
  });
});

// ---- Modal ---------------------------------------------------------

function openModal(title, bodyHtml, onConfirm) {
  modalTitle.textContent = title;
  modalBody.innerHTML = bodyHtml;
  modalOverlay.classList.remove('hidden');
  modalConfirm.onclick = onConfirm;
}

function closeModal() {
  modalOverlay.classList.add('hidden');
  modalBody.innerHTML = '';
}

modalCancel.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });

// ---- Auth / boot ---------------------------------------------------

logoutBtn.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

async function boot() {
  try {
    const meRes = await fetch('/api/auth/me');
    if (!meRes.ok) { window.location.href = '/login.html'; return; }
    me = await meRes.json();
    if (me.role !== 'owner') { window.location.href = '/pos.html'; return; }

    userNameEl.textContent = `${me.name} (${me.role})`;
    switchTab('overview');

    // Real-time refresh: keep P&L and sales history current as new sales land.
    pollTimer = setInterval(() => {
      loadOverview();
      loadSales();
    }, 3000);
  } catch (e) {
    window.location.href = '/login.html';
  }
}

boot();
