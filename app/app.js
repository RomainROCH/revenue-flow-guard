const API_BASE = '';

function getCart() {
  return JSON.parse(localStorage.getItem('cart') || '[]');
}

function setCart(items) {
  localStorage.setItem('cart', JSON.stringify(items));
  updateCartBadge();
}

function updateCartBadge() {
  const items = getCart();
  const badge = document.getElementById('cart-badge');
  if (items.length > 0) {
    badge.textContent = items.length;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function showPage(pageId) {
  document.querySelectorAll('main > section').forEach(function (s) {
    return s.classList.add('hidden');
  });
  document.getElementById('page-' + pageId).classList.remove('hidden');
}

function navigate(hash) {
  var page = hash.replace('#', '') || 'login';
  if (page === 'login') {
    document.getElementById('nav').classList.add('hidden');
    showPage('login');
  } else if (page === 'dashboard') {
    document.getElementById('nav').classList.remove('hidden');
    showPage('dashboard');
    loadProducts();
  } else if (page === 'checkout') {
    document.getElementById('nav').classList.remove('hidden');
    document.getElementById('order-confirmation').classList.add('hidden');
    document.getElementById('checkout-form').classList.remove('hidden');
    document.getElementById('checkout-error').classList.add('hidden');
    showPage('checkout');
  }
}

document.getElementById('login-form').addEventListener('submit', function (e) {
  e.preventDefault();
  var username = document.getElementById('username').value;
  var password = document.getElementById('password').value;
  var errorEl = document.getElementById('login-error');

  if (username === 'demo' && password === 'demo') {
    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('username', username);
    errorEl.classList.add('hidden');
    window.location.hash = 'dashboard';
  } else {
    errorEl.classList.remove('hidden');
  }
});

document.getElementById('logout-btn').addEventListener('click', function () {
  localStorage.removeItem('isLoggedIn');
  localStorage.removeItem('username');
  localStorage.removeItem('cart');
  window.location.hash = 'login';
});

async function loadProducts() {
  var container = document.getElementById('product-list');
  container.innerHTML = '<p>Loading...</p>';

  try {
    var res = await fetch(API_BASE + '/api/products');
    if (!res.ok) throw new Error('Failed to load');
    var products = await res.json();
    container.innerHTML = products
      .map(function (p) {
        return (
          '<article class="product-card" data-product-id="' +
          p.id +
          '">' +
          '<h3>' +
          p.name +
          '</h3>' +
          '<p class="price">$' +
          p.price.toFixed(2) +
          '</p>' +
          '<button class="btn-primary add-to-cart" data-id="' +
          p.id +
          '">Add to Cart</button>' +
          '</article>'
        );
      })
      .join('');

    container.querySelectorAll('.add-to-cart').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = parseInt(btn.dataset.id);
        var cart = getCart();
        cart.push(id);
        setCart(cart);
        btn.textContent = 'Added!';
        setTimeout(function () {
          btn.textContent = 'Add to Cart';
        }, 1000);
      });
    });
  } catch {
    container.innerHTML = '<p class="error">Could not load products.</p>';
  }
}

document.getElementById('checkout-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  var name = document.getElementById('order-name').value.trim();
  var address = document.getElementById('order-address').value.trim();
  var card = document.getElementById('order-card').value.trim();
  var errorEl = document.getElementById('checkout-error');

  if (!name || !address || !card) {
    errorEl.textContent = 'Please fill in all fields.';
    errorEl.classList.remove('hidden');
    return;
  }
  if (!/^[0-9]{16}$/.test(card)) {
    errorEl.textContent = 'Card number must be 16 digits.';
    errorEl.classList.remove('hidden');
    return;
  }

  errorEl.classList.add('hidden');

  try {
    var res = await fetch(API_BASE + '/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, address: address, card: card, items: getCart() }),
    });

    if (!res.ok) {
      var data = await res.json().catch(function () {
        return {};
      });
      throw new Error(data.error || 'Could not place your order. Please try again.');
    }

    var data = await res.json();
    setCart([]);
    document.getElementById('checkout-form').classList.add('hidden');
    document.getElementById('order-id').textContent = data.orderId;
    document.getElementById('order-confirmation').classList.remove('hidden');
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
});

window.addEventListener('hashchange', function () {
  return navigate(window.location.hash);
});

var isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
if (!isLoggedIn) {
  window.location.hash = 'login';
} else {
  window.location.hash = 'dashboard';
  updateCartBadge();
}

navigate(window.location.hash);
