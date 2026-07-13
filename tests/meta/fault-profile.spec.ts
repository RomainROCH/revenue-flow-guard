import type { APIRequestContext, APIResponse, Page } from '@playwright/test';

import { expect, test } from '../fixtures/isolated-app';

const TEST_TOKEN = 'rfg-meta-fault-profile-test-token-2026';

type FaultId =
  | 'AUTH_BYPASS'
  | 'CLIENT_PRICE_TRUST'
  | 'DUPLICATE_ORDER'
  | 'EMPTY_CART_ACCEPTED'
  | 'PAYMENT_DECLINE_HIDDEN'
  | 'SUBMIT_CONTROL_MISSING';

interface PaymentToken {
  paymentToken: string;
}

interface OrderResult {
  orderId: string;
  items: Array<{ productId: number; quantity: number }>;
  totalCents: number;
  replayed: boolean;
}

interface TestState {
  orderCount: number;
  orderRequestCount: number;
  pendingOrderCount: number;
}

test.use({
  applicationOptions: {
    host: '127.0.0.1',
    testMode: true,
    testToken: TEST_TOKEN,
  },
});

async function expectStatus(response: APIResponse, status: number): Promise<void> {
  expect(response.status(), await response.text()).toBe(status);
}

async function data<T>(response: APIResponse): Promise<T> {
  const payload = (await response.json()) as T | { data: T };
  return typeof payload === 'object' && payload !== null && 'data' in payload
    ? payload.data
    : payload;
}

async function activateFault(
  request: APIRequestContext,
  baseURL: string,
  faultId: FaultId,
): Promise<void> {
  const response = await request.put(`${baseURL}/__test/fault`, {
    data: { faultId },
    headers: { 'X-RFG-Test-Token': TEST_TOKEN },
  });
  await expectStatus(response, 200);
}

async function getState(
  request: APIRequestContext,
  baseURL: string,
): Promise<TestState> {
  const response = await request.get(`${baseURL}/__test/state`, {
    headers: { 'X-RFG-Test-Token': TEST_TOKEN },
  });
  await expectStatus(response, 200);
  return data<TestState>(response);
}

async function login(request: APIRequestContext, baseURL: string): Promise<void> {
  const response = await request.post(`${baseURL}/api/session`, {
    data: { username: 'demo', password: 'demo' },
  });
  await expectStatus(response, 201);
}

async function createPaymentToken(
  request: APIRequestContext,
  baseURL: string,
  scenario: 'approved' | 'declined',
): Promise<string> {
  const response = await request.post(`${baseURL}/api/payment-tokens`, {
    data: { scenario },
  });
  await expectStatus(response, 201);
  return (await data<PaymentToken>(response)).paymentToken;
}

async function submitOrder(
  request: APIRequestContext,
  baseURL: string,
  paymentToken: string,
  idempotencyKey: string,
  options: {
    items?: Array<{ productId: number; quantity: number }>;
    totalCents?: number;
  } = {},
): Promise<APIResponse> {
  return request.post(`${baseURL}/api/orders`, {
    data: {
      items: options.items ?? [{ productId: 1, quantity: 1 }],
      paymentToken,
      ...(options.totalCents === undefined
        ? {}
        : { totalCents: options.totalCents }),
    },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

async function expectFaultMarker(page: Page, faultId: FaultId): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-rfg-fault', faultId);
}

async function loginThroughPageRequest(page: Page, baseURL: string): Promise<void> {
  await login(page.request, baseURL);
}

async function addMouseAndOpenCart(page: Page, baseURL: string): Promise<void> {
  await page.goto(`${baseURL}/#dashboard`);
  await page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: 'Wireless Mouse' }) })
    .getByRole('button', { name: /add to cart/i })
    .click();
  await page.getByRole('link', { name: /cart/i }).click();
}

test('AUTH_BYPASS exposes products without authenticating the session', async ({
  isolatedApp,
  page,
  request,
}) => {
  await activateFault(request, isolatedApp.baseURL, 'AUTH_BYPASS');

  const productsResponse = await request.get(`${isolatedApp.baseURL}/api/products`);
  await expectStatus(productsResponse, 200);
  expect((await data<{ products: unknown[] }>(productsResponse)).products.length).toBeGreaterThan(0);

  const sessionResponse = await request.get(`${isolatedApp.baseURL}/api/session`);
  await expectStatus(sessionResponse, 401);

  await page.goto(isolatedApp.baseURL);
  await expectFaultMarker(page, 'AUTH_BYPASS');
});

test('CLIENT_PRICE_TRUST accepts a client-controlled order total', async ({
  isolatedApp,
  page,
  request,
}) => {
  await activateFault(request, isolatedApp.baseURL, 'CLIENT_PRICE_TRUST');
  await login(request, isolatedApp.baseURL);
  const paymentToken = await createPaymentToken(request, isolatedApp.baseURL, 'approved');

  const response = await submitOrder(
    request,
    isolatedApp.baseURL,
    paymentToken,
    crypto.randomUUID(),
    { totalCents: 1 },
  );
  await expectStatus(response, 201);
  expect((await data<OrderResult>(response)).totalCents).toBe(1);
  expect((await getState(request, isolatedApp.baseURL)).orderCount).toBe(1);

  const unrelatedResponse = await request.get(`${isolatedApp.baseURL}/api/unrelated-route`);
  await expectStatus(unrelatedResponse, 404);

  await page.goto(isolatedApp.baseURL);
  await expectFaultMarker(page, 'CLIENT_PRICE_TRUST');
});

test('DUPLICATE_ORDER creates a second order for the same idempotency key', async ({
  isolatedApp,
  page,
  request,
}) => {
  await activateFault(request, isolatedApp.baseURL, 'DUPLICATE_ORDER');
  await login(request, isolatedApp.baseURL);
  const paymentToken = await createPaymentToken(request, isolatedApp.baseURL, 'approved');
  const idempotencyKey = crypto.randomUUID();

  const firstResponse = await submitOrder(
    request,
    isolatedApp.baseURL,
    paymentToken,
    idempotencyKey,
  );
  await expectStatus(firstResponse, 201);
  const first = await data<OrderResult>(firstResponse);

  const secondResponse = await submitOrder(
    request,
    isolatedApp.baseURL,
    paymentToken,
    idempotencyKey,
  );
  await expectStatus(secondResponse, 201);
  const second = await data<OrderResult>(secondResponse);

  expect(second.orderId).not.toBe(first.orderId);
  expect(second.replayed).toBe(false);
  expect(await getState(request, isolatedApp.baseURL)).toMatchObject({
    orderCount: 2,
    orderRequestCount: 2,
  });

  await page.goto(isolatedApp.baseURL);
  await expectFaultMarker(page, 'DUPLICATE_ORDER');
});

test('EMPTY_CART_ACCEPTED creates a zero-total order without items', async ({
  isolatedApp,
  page,
  request,
}) => {
  await activateFault(request, isolatedApp.baseURL, 'EMPTY_CART_ACCEPTED');
  await login(request, isolatedApp.baseURL);
  const paymentToken = await createPaymentToken(request, isolatedApp.baseURL, 'approved');

  const response = await submitOrder(
    request,
    isolatedApp.baseURL,
    paymentToken,
    crypto.randomUUID(),
    { items: [] },
  );
  await expectStatus(response, 201);
  const result = await data<OrderResult>(response);
  expect(result).toMatchObject({ items: [], totalCents: 0 });
  expect((await getState(request, isolatedApp.baseURL)).orderCount).toBe(1);

  await page.goto(isolatedApp.baseURL);
  await expectFaultMarker(page, 'EMPTY_CART_ACCEPTED');
});

test('PAYMENT_DECLINE_HIDDEN presents a synthetic confirmation after a declined payment', async ({
  isolatedApp,
  page,
  request,
}) => {
  await activateFault(request, isolatedApp.baseURL, 'PAYMENT_DECLINE_HIDDEN');
  await loginThroughPageRequest(page, isolatedApp.baseURL);
  await addMouseAndOpenCart(page, isolatedApp.baseURL);
  await page.getByRole('radio', { name: 'Declined' }).check();

  const orderResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/orders',
  );
  await page.getByRole('button', { name: /place order/i }).click();
  const orderResponse = await orderResponsePromise;

  expect(orderResponse.status()).toBe(402);
  await expect(page.getByRole('heading', { name: 'Order confirmed' })).toBeVisible();
  expect(await getState(request, isolatedApp.baseURL)).toMatchObject({
    orderCount: 0,
    pendingOrderCount: 0,
  });

  const productsResponse = await page.request.get(`${isolatedApp.baseURL}/api/products`);
  await expectStatus(productsResponse, 200);
  const products = (await data<{
    products: Array<{ id: number; availableQuantity: number }>;
  }>(productsResponse)).products;
  expect(
    products.find((product) => product.id === 1)?.availableQuantity,
  ).toBe(10);
  await expectFaultMarker(page, 'PAYMENT_DECLINE_HIDDEN');
});

test('SUBMIT_CONTROL_MISSING leaves the submit control enabled while an order is pending', async ({
  isolatedApp,
  page,
  request,
}) => {
  await activateFault(request, isolatedApp.baseURL, 'SUBMIT_CONTROL_MISSING');
  await loginThroughPageRequest(page, isolatedApp.baseURL);
  await addMouseAndOpenCart(page, isolatedApp.baseURL);
  await page.getByRole('radio', { name: 'Approved' }).check();
  const barrier = isolatedApp.holdNextOrder();
  const submit = page.getByRole('button', { name: /place order/i });

  const clickPromise = submit.click();
  try {
    await barrier.reached;
    await expect(submit).toBeEnabled();
    expect(await getState(request, isolatedApp.baseURL)).toMatchObject({
      orderRequestCount: 1,
      pendingOrderCount: 1,
    });
  } finally {
    barrier.release();
  }

  await clickPromise;
  await expect(page.getByRole('heading', { name: 'Order confirmed' })).toBeVisible();
  expect((await getState(request, isolatedApp.baseURL)).orderCount).toBe(1);
  await expectFaultMarker(page, 'SUBMIT_CONTROL_MISSING');
});
