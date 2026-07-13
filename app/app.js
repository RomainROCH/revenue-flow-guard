'use strict';

const CART_STORAGE_KEY = 'rfg-cart';
const PROTECTED_ROUTES = new Set(['dashboard', 'checkout']);

const elements = {
  nav: document.getElementById('nav'),
  pages: Array.from(document.querySelectorAll('main > section')),
  status: document.getElementById('app-status'),
  loginForm: document.getElementById('login-form'),
  loginSubmit: document.getElementById('login-submit'),
  loginError: document.getElementById('login-error'),
  username: document.getElementById('username'),
  password: document.getElementById('password'),
  logout: document.getElementById('logout-btn'),
  productList: document.getElementById('product-list'),
  catalogError: document.getElementById('catalog-error'),
  cartCount: document.getElementById('cart-count'),
  checkoutContent: document.getElementById('checkout-content'),
  checkoutItems: document.getElementById('checkout-items'),
  checkoutTotal: document.getElementById('checkout-total'),
  checkoutForm: document.getElementById('checkout-form'),
  checkoutEmpty: document.getElementById('checkout-empty'),
  checkoutError: document.getElementById('checkout-error'),
  checkoutSubmit: document.getElementById('checkout-submit'),
  paymentOutcomes: Array.from(
    document.querySelectorAll('input[name="payment-outcome"]'),
  ),
  orderConfirmation: document.getElementById('order-confirmation'),
  confirmationTotal: document.getElementById('confirmation-total'),
  orderId: document.getElementById('order-id'),
};

let products = [];
let navigationRevision = 0;
let validatingAfterLogin = false;
let checkoutPending = false;
let checkoutReady = false;
let retryableAttempt = null;

function readCart() {
  try {
    const storedCart = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) || '[]');
    if (!Array.isArray(storedCart)) {
      return [];
    }

    return storedCart.filter((productId) => Number.isInteger(productId));
  } catch {
    return [];
  }
}

function writeCart(cart) {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  renderCartCount();
}

function clearCart() {
  localStorage.removeItem(CART_STORAGE_KEY);
  renderCartCount();
}

function resetCheckoutAttempt() {
  retryableAttempt = null;
  elements.checkoutSubmit.textContent = 'Place order';
}

function renderCartCount() {
  const count = readCart().length;
  elements.cartCount.textContent = String(count);
  elements.cartCount.classList.toggle('hidden', count === 0);
}

function showStatus(message) {
  elements.status.textContent = message;
  elements.status.classList.toggle('hidden', !message);
}

function showOnlyPage(pageName) {
  for (const page of elements.pages) {
    page.classList.toggle('hidden', page.id !== `page-${pageName}`);
  }
}

function hideProtectedUi() {
  elements.nav.classList.add('hidden');
  for (const page of elements.pages) {
    page.classList.add('hidden');
  }
}

function replaceHash(hash) {
  const nextUrl = new URL(window.location.href);
  nextUrl.hash = hash;
  window.history.replaceState(null, '', nextUrl);
}

function readRoute() {
  const route = window.location.hash.slice(1);
  return route || 'login';
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return { data: null, error: null };
  }
}

function errorMessage(payload, fallback) {
  return payload && payload.error && typeof payload.error.message === 'string'
    ? payload.error.message
    : fallback;
}

function renderLogin() {
  validatingAfterLogin = false;
  elements.nav.classList.add('hidden');
  showOnlyPage('login');
  showStatus('');
  elements.loginSubmit.disabled = false;
  elements.loginSubmit.textContent = 'Sign in';
}

function formatPrice(priceCents) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(priceCents / 100);
}

function announceCartChange(product, wasRemoved) {
  showStatus(
    wasRemoved
      ? `${product.name} removed from cart.`
      : `${product.name} added to cart.`,
  );
}

function toggleCartProduct(product) {
  resetCheckoutAttempt();
  const cart = readCart();
  const productIndex = cart.indexOf(product.id);
  const wasRemoved = productIndex !== -1;

  if (wasRemoved) {
    cart.splice(productIndex, 1);
  } else {
    cart.push(product.id);
  }

  writeCart(cart);
  renderProducts();
  announceCartChange(product, wasRemoved);
}

function createProductItem(product, cart) {
  const item = document.createElement('li');
  item.className = 'product-card';

  const name = document.createElement('h2');
  name.textContent = product.name;

  const price = document.createElement('p');
  price.className = 'price';
  price.textContent = formatPrice(product.priceCents);

  const availability = document.createElement('p');
  availability.className = 'availability';
  availability.textContent = `${product.availableQuantity} available`;

  const button = document.createElement('button');
  const isInCart = cart.includes(product.id);
  button.type = 'button';
  button.className = isInCart ? 'btn-secondary' : 'btn-primary';
  button.textContent = isInCart ? 'Remove from cart' : 'Add to cart';
  button.addEventListener('click', () => toggleCartProduct(product));

  item.append(name, price, availability, button);
  return item;
}

function renderProducts() {
  const cart = readCart();
  const items = products.map((product) => createProductItem(product, cart));
  elements.productList.replaceChildren(...items);
}

function cartItems() {
  const quantities = new Map();

  for (const productId of readCart()) {
    quantities.set(productId, Math.min((quantities.get(productId) ?? 0) + 1, 10));
  }

  return Array.from(quantities, ([productId, quantity]) => ({
    productId,
    quantity,
  }));
}

function renderCheckoutSummary(items) {
  const productsById = new Map(products.map((product) => [product.id, product]));
  let estimatedTotalCents = 0;
  const summaryItems = items.map((item) => {
    const product = productsById.get(item.productId);
    const listItem = document.createElement('li');
    const name = document.createElement('span');
    const amount = document.createElement('strong');

    name.textContent = product
      ? `${product.name} × ${item.quantity}`
      : `Product ${item.productId} × ${item.quantity}`;
    amount.textContent = product
      ? formatPrice(product.priceCents * item.quantity)
      : 'Server price pending';
    if (product) {
      estimatedTotalCents += product.priceCents * item.quantity;
    }

    listItem.append(name, amount);
    return listItem;
  });

  elements.checkoutItems.replaceChildren(...summaryItems);
  elements.checkoutTotal.textContent = formatPrice(estimatedTotalCents);
}

function setCheckoutPending(pending) {
  checkoutPending = pending;
  const controlsDisabled = pending || !checkoutReady;

  elements.checkoutSubmit.disabled = controlsDisabled;
  for (const outcome of elements.paymentOutcomes) {
    outcome.disabled = controlsDisabled;
  }

  showStatus(pending ? 'Processing the demonstration order…' : '');
}

function hideCheckoutErrors() {
  elements.checkoutEmpty.classList.add('hidden');
  elements.checkoutError.classList.add('hidden');
}

function showCheckoutError(message) {
  elements.checkoutError.textContent = message;
  elements.checkoutError.classList.remove('hidden');
}

async function renderCheckout(revision) {
  checkoutReady = false;
  resetCheckoutAttempt();
  hideCheckoutErrors();
  elements.orderConfirmation.classList.add('hidden');
  elements.checkoutContent.classList.remove('hidden');

  const items = cartItems();
  if (items.length === 0) {
    renderCheckoutSummary(items);
    elements.checkoutEmpty.classList.remove('hidden');
    setCheckoutPending(false);
    return;
  }

  setCheckoutPending(false);
  showStatus('Loading the server catalog…');

  try {
    const response = await fetch('/api/products');
    const payload = await readJson(response);

    if (revision !== navigationRevision) {
      return;
    }

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (!response.ok || !payload.data || !Array.isArray(payload.data.products)) {
      throw new Error(errorMessage(payload, 'Could not prepare checkout.'));
    }

    products = payload.data.products;
    renderCheckoutSummary(items);
    checkoutReady = true;
    setCheckoutPending(false);
  } catch (error) {
    if (revision !== navigationRevision) {
      return;
    }

    setCheckoutPending(false);
    showCheckoutError(
      error instanceof Error ? error.message : 'Could not prepare checkout.',
    );
  }
}

function selectedPaymentScenario() {
  const selected = elements.paymentOutcomes.find((outcome) => outcome.checked);
  return selected ? selected.value : null;
}

async function createCheckoutAttempt(items) {
  const scenario = selectedPaymentScenario();
  if (!scenario) {
    throw new Error('Choose a demonstration payment outcome.');
  }

  const response = await fetch('/api/payment-tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario }),
  });
  const payload = await readJson(response);

  if (response.status === 401) {
    await handleUnauthorized();
    return null;
  }

  if (
    !response.ok ||
    !payload.data ||
    typeof payload.data.paymentToken !== 'string'
  ) {
    throw new Error(
      errorMessage(payload, 'Could not prepare the demonstration payment.'),
    );
  }

  return {
    idempotencyKey: crypto.randomUUID(),
    items,
    paymentToken: payload.data.paymentToken,
    scenario,
  };
}

function renderOrderConfirmation(order) {
  elements.confirmationTotal.textContent = formatPrice(order.totalCents);
  elements.orderId.textContent = order.orderId;
  elements.checkoutContent.classList.add('hidden');
  elements.orderConfirmation.classList.remove('hidden');
  clearCart();
  checkoutReady = false;
  resetCheckoutAttempt();
}

function keepAttemptForRetry(attempt) {
  retryableAttempt = attempt;
  elements.checkoutSubmit.textContent = 'Retry order';
}

async function submitCheckout() {
  if (checkoutPending || !checkoutReady) {
    return;
  }

  const items = cartItems();
  if (items.length === 0) {
    checkoutReady = false;
    elements.checkoutEmpty.classList.remove('hidden');
    setCheckoutPending(false);
    return;
  }

  hideCheckoutErrors();
  setCheckoutPending(true);
  let attempt = retryableAttempt;

  try {
    if (!attempt) {
      attempt = await createCheckoutAttempt(items);
      if (!attempt) {
        return;
      }
    }

    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': attempt.idempotencyKey,
      },
      body: JSON.stringify({
        items: attempt.items,
        paymentToken: attempt.paymentToken,
      }),
    });
    const payload = await readJson(response);

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (!response.ok) {
      const code = payload && payload.error ? payload.error.code : null;
      if (code === 'PAYMENT_UNAVAILABLE' || code === 'ORDER_IN_PROGRESS') {
        keepAttemptForRetry(attempt);
      } else {
        resetCheckoutAttempt();
      }
      showCheckoutError(
        errorMessage(payload, 'Could not place the demonstration order.'),
      );
      return;
    }

    if (
      !payload.data ||
      typeof payload.data.orderId !== 'string' ||
      !Number.isInteger(payload.data.totalCents)
    ) {
      keepAttemptForRetry(attempt);
      throw new Error('The order response was incomplete. Retry this order safely.');
    }

    renderOrderConfirmation(payload.data);
  } catch (error) {
    if (attempt && attempt.paymentToken) {
      keepAttemptForRetry(attempt);
    } else {
      resetCheckoutAttempt();
    }
    showCheckoutError(
      error instanceof Error
        ? error.message
        : 'The order request was interrupted. Retry this order safely.',
    );
  } finally {
    setCheckoutPending(false);
  }
}

async function loadProducts(revision) {
  showStatus('Loading products…');
  elements.catalogError.classList.add('hidden');

  try {
    const response = await fetch('/api/products');
    const payload = await readJson(response);

    if (revision !== navigationRevision) {
      return;
    }

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (!response.ok || !payload.data || !Array.isArray(payload.data.products)) {
      throw new Error(errorMessage(payload, 'Could not load products.'));
    }

    products = payload.data.products;
    renderProducts();
    showStatus('');
  } catch (error) {
    if (revision !== navigationRevision) {
      return;
    }

    elements.catalogError.textContent =
      error instanceof Error ? error.message : 'Could not load products.';
    elements.catalogError.classList.remove('hidden');
    showStatus('');
  }
}

async function handleUnauthorized() {
  checkoutPending = false;
  checkoutReady = false;
  resetCheckoutAttempt();
  clearCart();
  replaceHash('login');
  renderLogin();
}

async function renderProtectedRoute(route, revision) {
  const keepLoginVisible = validatingAfterLogin;

  if (keepLoginVisible) {
    elements.nav.classList.add('hidden');
    showOnlyPage('login');
  } else {
    hideProtectedUi();
  }
  showStatus('Checking your session…');

  try {
    const response = await fetch('/api/session');
    await readJson(response);

    if (revision !== navigationRevision) {
      return;
    }

    if (response.status === 401) {
      await handleUnauthorized();
      return;
    }

    if (!response.ok) {
      throw new Error('We could not verify your session. Please sign in again.');
    }

    validatingAfterLogin = false;
    elements.nav.classList.remove('hidden');
    showOnlyPage(route);
    renderCartCount();

    if (route === 'dashboard') {
      await loadProducts(revision);
    } else {
      await renderCheckout(revision);
    }
  } catch (error) {
    if (revision !== navigationRevision) {
      return;
    }

    await handleUnauthorized();
    elements.loginError.textContent =
      error instanceof Error
        ? error.message
        : 'We could not verify your session. Please sign in again.';
    elements.loginError.classList.remove('hidden');
  }
}

async function renderRoute() {
  const revision = ++navigationRevision;
  const route = readRoute();

  if (route === 'login') {
    renderLogin();
    return;
  }

  if (!PROTECTED_ROUTES.has(route)) {
    replaceHash('login');
    renderLogin();
    return;
  }

  await renderProtectedRoute(route, revision);
}

elements.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  elements.loginError.classList.add('hidden');
  elements.loginSubmit.disabled = true;
  elements.loginSubmit.textContent = 'Signing in…';
  showStatus('Signing in…');

  try {
    const response = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: elements.username.value,
        password: elements.password.value,
      }),
    });
    const payload = await readJson(response);

    if (!response.ok) {
      elements.loginError.textContent = errorMessage(
        payload,
        'Sign in failed. Please try again.',
      );
      elements.loginError.classList.remove('hidden');
      elements.loginSubmit.disabled = false;
      elements.loginSubmit.textContent = 'Sign in';
      showStatus('');
      return;
    }

    validatingAfterLogin = true;
    window.location.hash = 'dashboard';
  } catch {
    elements.loginError.textContent = 'Sign in failed. Please try again.';
    elements.loginError.classList.remove('hidden');
    elements.loginSubmit.disabled = false;
    elements.loginSubmit.textContent = 'Sign in';
    showStatus('');
  }
});

elements.logout.addEventListener('click', async () => {
  elements.logout.disabled = true;
  showStatus('Signing out…');

  try {
    await fetch('/api/session', { method: 'DELETE' });
  } finally {
    clearCart();
    replaceHash('login');
    elements.password.value = '';
    elements.logout.disabled = false;
    renderLogin();
  }
});

elements.checkoutForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void submitCheckout();
});

for (const outcome of elements.paymentOutcomes) {
  outcome.addEventListener('change', () => {
    if (!checkoutPending) {
      resetCheckoutAttempt();
      elements.checkoutError.classList.add('hidden');
    }
  });
}

window.addEventListener('hashchange', () => {
  void renderRoute();
});

void renderRoute();
