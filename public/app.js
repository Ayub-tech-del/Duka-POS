// ---- Catalog is now loaded from the server (see /api/products) ----
let PRODUCTS = [];

const cart = {}; // { productId: qty }
let activeCategory = 'All';
let pollTimer = null;

const productGrid = document.getElementById('productGrid');
const categoriesEl = document.getElementById('categories');
const tillItemsEl = document.getElementById('tillItems');
const tillTotalEl = document.getElementById('tillTotal');
const tillDateEl = document.getElementById('tillDate');
const payBtn = document.getElementById('payBtn');
const phoneInput = document.getElementById('phoneInput');
const statusBanner = document.getElementById('statusBanner');
const clearBtn = document.getElementById('clearBtn');
const searchInput = document.getElementById('searchInput');

function money(n) {
  return 'KSh ' + n.toLocaleString('en-KE');
}

function renderCategories() {
  const cats = ['All', ...new Set(PRODUCTS.map(p => p.cat))];
  categoriesEl.innerHTML = cats.map(c =>
    `<button class="cat-pill ${c === activeCategory ? 'active' : ''}" data-cat="${c}">${c}</button>`
  ).join('');
  categoriesEl.querySelectorAll('.cat-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      activeCategory = btn.dataset.cat;
      renderCategories();
      renderGrid();
    });
  });
}

function renderGrid() {
  const query = searchInput.value.trim().toLowerCase();
  const items = PRODUCTS.filter(p => {
    const matchesCat = activeCategory === 'All' || p.cat === activeCategory;
    const matchesQuery = !query || p.name.toLowerCase().includes(query);
    return matchesCat && matchesQuery;
  });

  productGrid.innerHTML = items.map(p => {
    const qty = cart[p.id] || 0;
    const media = p.image
      ? `<img class="product-photo" src="${p.image}" alt="">`
      : `<div class="product-emoji">${p.emoji}</div>`;
    return `
      <div class="product-card" data-id="${p.id}">
        ${qty > 0 ? `<div class="qty-badge">${qty}</div>` : ''}
        ${media}
        <div class="product-name">${p.name}</div>
        <div class="product-price">${money(p.price)}</div>
      </div>`;
  }).join('') || `<div class="till-empty">No products match your search</div>`;

  productGrid.querySelectorAll('.product-card').forEach(card => {
    card.addEventListener('click', () => addToCart(Number(card.dataset.id)));
  });
}

function addToCart(id) {
  cart[id] = (cart[id] || 0) + 1;
  renderGrid();
  renderTill();
}

function changeQty(id, delta) {
  cart[id] = (cart[id] || 0) + delta;
  if (cart[id] <= 0) delete cart[id];
  renderGrid();
  renderTill();
}

function cartTotal() {
  return Object.entries(cart).reduce((sum, [id, qty]) => {
    const p = PRODUCTS.find(p => p.id === Number(id));
    return sum + (p ? p.price * qty : 0);
  }, 0);
}

function renderTill() {
  const entries = Object.entries(cart);
  if (entries.length === 0) {
    tillItemsEl.innerHTML = `<div class="till-empty">No items yet — tap a product to begin</div>`;
  } else {
    tillItemsEl.innerHTML = entries.map(([id, qty]) => {
      const p = PRODUCTS.find(p => p.id === Number(id));
      return `
        <div class="till-line">
          <span class="till-line-name">${p.name}</span>
          <span class="till-line-qty">
            <button class="qty-btn" data-id="${id}" data-delta="-1">−</button>
            ${qty}
            <button class="qty-btn" data-id="${id}" data-delta="1">+</button>
          </span>
          <span class="till-line-amt">${money(p.price * qty)}</span>
        </div>`;
    }).join('');

    tillItemsEl.querySelectorAll('.qty-btn').forEach(btn => {
      btn.addEventListener('click', () => changeQty(Number(btn.dataset.id), Number(btn.dataset.delta)));
    });
  }

  const total = cartTotal();
  tillTotalEl.textContent = money(total);
  payBtn.disabled = total <= 0;
}

function tickClock() {
  tillDateEl.textContent = new Date().toLocaleString('en-KE', {
    dateStyle: 'medium', timeStyle: 'short',
  });
}

function showStatus(kind, msg) {
  statusBanner.className = `status-banner ${kind}`;
  statusBanner.textContent = msg;
}

function hideStatus() {
  statusBanner.className = 'status-banner hidden';
}

async function sendStkPush() {
  const phone = phoneInput.value.trim();
  const amount = cartTotal();

  if (!phone) {
    showStatus('error', 'Enter the customer\'s M-Pesa number first.');
    return;
  }

  payBtn.disabled = true;
  payBtn.classList.add('loading');
  showStatus('pending', 'Sending prompt to customer\'s phone…');

  const cartPayload = Object.entries(cart).map(([productId, qty]) => ({ productId: Number(productId), qty }));

  try {
    const res = await fetch('/api/stkpush', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, cart: cartPayload, accountRef: 'Duka POS' }),
    });
    const data = await res.json();

    if (!res.ok) {
      showStatus('error', typeof data.error === 'string' ? data.error : (data.error?.errorMessage || 'STK push failed. Check your Daraja credentials in .env.'));
      resetPayBtn();
      return;
    }

    showStatus('pending', 'Prompt sent! Waiting for customer to enter M-Pesa PIN…');
    pollStatus(data.CheckoutRequestID);
  } catch (err) {
    showStatus('error', 'Could not reach the server. Is the backend running?');
    resetPayBtn();
  }
}

function pollStatus(checkoutRequestId) {
  clearInterval(pollTimer);
  let attempts = 0;
  pollTimer = setInterval(async () => {
    attempts++;
    try {
      const res = await fetch(`/api/status/${checkoutRequestId}`);
      const data = await res.json();

      if (data.status === 'success') {
        clearInterval(pollTimer);
        showStatus('success', '✅ Payment received! Receipt complete.');
        resetPayBtn();
        setTimeout(() => {
          Object.keys(cart).forEach(k => delete cart[k]);
          renderGrid(); renderTill(); hideStatus();
        }, 3500);
      } else if (data.status === 'failed') {
        clearInterval(pollTimer);
        showStatus('error', data.resultDesc || 'Payment was not completed.');
        resetPayBtn();
      } else if (attempts > 40) { // ~2 minutes
        clearInterval(pollTimer);
        showStatus('error', 'Timed out waiting for payment confirmation.');
        resetPayBtn();
      }
    } catch (e) {
      // keep polling silently on transient network errors
    }
  }, 3000);
}

function resetPayBtn() {
  payBtn.classList.remove('loading');
  payBtn.disabled = cartTotal() <= 0;
}

payBtn.addEventListener('click', sendStkPush);
searchInput.addEventListener('input', renderGrid);
clearBtn.addEventListener('click', () => {
  Object.keys(cart).forEach(k => delete cart[k]);
  clearInterval(pollTimer);
  renderGrid(); renderTill(); hideStatus();
});

const userNameEl = document.getElementById('userName');
const logoutBtn = document.getElementById('logoutBtn');

async function boot() {
  try {
    const meRes = await fetch('/api/auth/me');
    if (!meRes.ok) { window.location.href = '/login.html'; return; }
    const me = await meRes.json();
    userNameEl.textContent = `${me.name} (${me.role})`;

    fetch('/api/shop').then(r => r.json()).then(({ name }) => {
      if (name) document.getElementById('shopTagline').textContent = name;
    }).catch(() => {});

    const prodRes = await fetch('/api/products');
    PRODUCTS = await prodRes.json();

    renderCategories();
    renderGrid();
    renderTill();
    tickClock();
    setInterval(tickClock, 30000);
  } catch (e) {
    window.location.href = '/login.html';
  }
}

logoutBtn.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

boot();
