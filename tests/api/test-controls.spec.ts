import { expect, type APIRequestContext } from '@playwright/test';
import { resolve } from 'node:path';
import { test } from '../fixtures/isolated-app';

const { createApplication } = require(
  resolve(process.cwd(), 'src', 'create-application.js'),
) as {
  createApplication: (options?: {
    testMode?: boolean;
    testToken?: string;
    host?: string;
  }) => unknown;
};

const TEST_TOKEN =
  'rfg_test_control_token_0123456789abcdef0123456789abcdef';
const TEST_HEADERS = { 'X-RFG-Test-Token': TEST_TOKEN };
const INVALID_CONTROL = {
  data: null,
  error: {
    code: 'INVALID_TEST_CONTROL',
    message: 'The test control request is invalid.',
  },
};
const NOT_FOUND = {
  data: null,
  error: { code: 'NOT_FOUND', message: 'The requested resource was not found.' },
};
const FAULT_IDS = [
  'NONE',
  'AUTH_BYPASS',
  'CLIENT_PRICE_TRUST',
  'DUPLICATE_ORDER',
  'EMPTY_CART_ACCEPTED',
  'PAYMENT_DECLINE_HIDDEN',
  'SUBMIT_CONTROL_MISSING',
] as const;

const seedRevenueState = async (
  baseURL: string,
  request: APIRequestContext,
): Promise<void> => {
  const session = await request.post(`${baseURL}/api/session`, {
    data: { username: 'demo', password: 'demo' },
  });
  expect(session.status()).toBe(201);

  const products = await request.get(`${baseURL}/api/products`);
  expect(products.status()).toBe(200);
  expect((await products.json()).data.products).toContainEqual(
    expect.objectContaining({ id: 1, availableQuantity: 10 }),
  );

  const token = await request.post(`${baseURL}/api/payment-tokens`, {
    data: { scenario: 'approved' },
  });
  expect(token.status()).toBe(201);
  const paymentToken = (await token.json()).data.paymentToken as string;

  const order = await request.post(`${baseURL}/api/orders`, {
    headers: { 'Idempotency-Key': '11111111-1111-4111-8111-111111111111' },
    data: {
      items: [{ productId: 1, quantity: 1 }],
      paymentToken,
    },
  });
  expect(order.status()).toBe(201);

  const depletedProducts = await request.get(`${baseURL}/api/products`);
  expect(depletedProducts.status()).toBe(200);
  expect((await depletedProducts.json()).data.products).toContainEqual(
    expect.objectContaining({ id: 1, availableQuantity: 9 }),
  );
};

test.describe('test controls are absent from normal mode', () => {
  test.describe.configure({ mode: 'parallel' });

  for (const control of [
    { method: 'post', path: '/__test/reset' },
    { method: 'put', path: '/__test/fault' },
    { method: 'get', path: '/__test/state' },
  ] as const) {
    test(`${control.method.toUpperCase()} ${control.path} returns the generic 404`, async ({
      isolatedApp,
      request,
    }) => {
      const response = await request.fetch(`${isolatedApp.baseURL}${control.path}`, {
        method: control.method,
        headers: TEST_HEADERS,
        data: control.method === 'put' ? { faultId: 'NONE' } : undefined,
      });

      expect(response.status()).toBe(404);
      expect(await response.json()).toEqual(NOT_FOUND);
    });
  }
});

test.describe('authorized test controls', () => {
  test.describe.configure({ mode: 'parallel' });
  test.use({
    applicationOptions: {
      testMode: true,
      testToken: TEST_TOKEN,
      host: '127.0.0.1',
    },
  });

  test('advertises test mode only through the normal health route', async ({
    isolatedApp,
    request,
  }) => {
    const response = await request.get(`${isolatedApp.baseURL}/api/health`);

    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({
      data: { status: 'ok', version: 1, testMode: true },
      error: null,
    });
  });

  test('starts from an exact empty state', async ({ isolatedApp, request }) => {
    const response = await request.get(`${isolatedApp.baseURL}/__test/state`, {
      headers: TEST_HEADERS,
    });

    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        faultId: 'NONE',
        orderCount: 0,
        pendingOrderCount: 0,
        orderRequestCount: 0,
      },
      error: null,
    });
  });

  for (const faultId of FAULT_IDS) {
    test(`activates the exact ${faultId} fault`, async ({ isolatedApp, request }) => {
      const response = await request.put(`${isolatedApp.baseURL}/__test/fault`, {
        headers: TEST_HEADERS,
        data: { faultId },
      });

      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual({ data: { faultId }, error: null });
    });
  }

  test('resets before activating a replacement fault', async ({ isolatedApp, request }) => {
    const faultUrl = `${isolatedApp.baseURL}/__test/fault`;
    await request.put(faultUrl, {
      headers: TEST_HEADERS,
      data: { faultId: 'AUTH_BYPASS' },
    });

    const response = await request.put(faultUrl, {
      headers: TEST_HEADERS,
      data: { faultId: 'CLIENT_PRICE_TRUST' },
    });
    const state = await request.get(`${isolatedApp.baseURL}/__test/state`, {
      headers: TEST_HEADERS,
    });

    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({
      data: { faultId: 'CLIENT_PRICE_TRUST' },
      error: null,
    });
    expect(await state.json()).toEqual({
      data: {
        faultId: 'CLIENT_PRICE_TRUST',
        orderCount: 0,
        pendingOrderCount: 0,
        orderRequestCount: 0,
      },
      error: null,
    });
  });

  test('fault activation and reset clear every mutable store', async ({
    isolatedApp,
    request,
  }) => {
    const stateUrl = `${isolatedApp.baseURL}/__test/state`;
    await seedRevenueState(isolatedApp.baseURL, request);

    const populatedState = await request.get(stateUrl, { headers: TEST_HEADERS });
    expect(await populatedState.json()).toEqual({
      data: {
        faultId: 'NONE',
        orderCount: 1,
        pendingOrderCount: 0,
        orderRequestCount: 1,
      },
      error: null,
    });

    const activateFault = await request.put(`${isolatedApp.baseURL}/__test/fault`, {
      headers: TEST_HEADERS,
      data: { faultId: 'CLIENT_PRICE_TRUST' },
    });
    expect(activateFault.status()).toBe(200);

    const faultState = await request.get(stateUrl, { headers: TEST_HEADERS });
    expect(await faultState.json()).toEqual({
      data: {
        faultId: 'CLIENT_PRICE_TRUST',
        orderCount: 0,
        pendingOrderCount: 0,
        orderRequestCount: 0,
      },
      error: null,
    });
    expect((await request.get(`${isolatedApp.baseURL}/api/products`)).status()).toBe(401);

    await seedRevenueState(isolatedApp.baseURL, request);
    const unusedTokenResponse = await request.post(
      `${isolatedApp.baseURL}/api/payment-tokens`,
      { data: { scenario: 'approved' } },
    );
    expect(unusedTokenResponse.status()).toBe(201);
    const invalidatedPaymentToken = (await unusedTokenResponse.json()).data
      .paymentToken as string;
    const reset = await request.post(`${isolatedApp.baseURL}/__test/reset`, {
      headers: TEST_HEADERS,
    });
    expect(reset.status()).toBe(204);
    expect(await reset.body()).toHaveLength(0);

    expect((await request.get(`${isolatedApp.baseURL}/api/products`)).status()).toBe(401);
    const resetState = await request.get(stateUrl, { headers: TEST_HEADERS });
    expect(await resetState.json()).toEqual({
      data: {
        faultId: 'NONE',
        orderCount: 0,
        pendingOrderCount: 0,
        orderRequestCount: 0,
      },
      error: null,
    });

    const replacementSession = await request.post(`${isolatedApp.baseURL}/api/session`, {
      data: { username: 'demo', password: 'demo' },
    });
    expect(replacementSession.status()).toBe(201);
    const restoredProducts = await request.get(`${isolatedApp.baseURL}/api/products`);
    expect(restoredProducts.status()).toBe(200);
    expect((await restoredProducts.json()).data.products).toContainEqual(
      expect.objectContaining({ id: 1, availableQuantity: 10 }),
    );

    const invalidatedTokenOrder = await request.post(
      `${isolatedApp.baseURL}/api/orders`,
      {
        headers: {
          'Idempotency-Key': '22222222-2222-4222-8222-222222222222',
        },
        data: {
          items: [{ productId: 1, quantity: 1 }],
          paymentToken: invalidatedPaymentToken,
        },
      },
    );
    expect(invalidatedTokenOrder.status()).toBe(409);
    expect(await invalidatedTokenOrder.json()).toMatchObject({
      data: null,
      error: { code: 'PAYMENT_TOKEN_INVALID' },
    });
  });

  for (const invalid of [
    { title: 'missing body', data: undefined },
    { title: 'empty body', data: {} },
    { title: 'unknown fault', data: { faultId: 'UNKNOWN' } },
    { title: 'non-string fault', data: { faultId: 1 } },
    { title: 'extra property', data: { faultId: 'NONE', extra: true } },
  ] as const) {
    test(`rejects ${invalid.title}`, async ({ isolatedApp, request }) => {
      const response = await request.put(`${isolatedApp.baseURL}/__test/fault`, {
        headers: TEST_HEADERS,
        data: invalid.data,
      });

      expect(response.status()).toBe(400);
      expect(await response.json()).toEqual(INVALID_CONTROL);
    });
  }

  for (const invalid of [
    { title: 'array body', rawBody: '[]' },
    { title: 'string body', rawBody: '"NONE"' },
    { title: 'null body', rawBody: 'null' },
  ]) {
    test(`rejects a ${invalid.title}`, async ({ isolatedApp, request }) => {
      const response = await request.fetch(`${isolatedApp.baseURL}/__test/fault`, {
        method: 'PUT',
        headers: { ...TEST_HEADERS, 'Content-Type': 'application/json' },
        data: Buffer.from(invalid.rawBody),
      });

      expect(response.status()).toBe(400);
      expect(await response.json()).toEqual(INVALID_CONTROL);
    });
  }

  test('rejects a reset body', async ({ isolatedApp, request }) => {
    const response = await request.fetch(`${isolatedApp.baseURL}/__test/reset`, {
      method: 'POST',
      headers: { ...TEST_HEADERS, 'Content-Type': 'application/json' },
      data: Buffer.from('{"unexpected":true}'),
    });

    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual(INVALID_CONTROL);
  });

  test('rejects a state body', async ({ isolatedApp, request }) => {
    const response = await request.fetch(`${isolatedApp.baseURL}/__test/state`, {
      method: 'GET',
      headers: { ...TEST_HEADERS, 'Content-Type': 'application/json' },
      data: Buffer.from('{}'),
    });

    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual(INVALID_CONTROL);
  });

  test('rejects malformed JSON', async ({ isolatedApp, request }) => {
    const response = await request.put(`${isolatedApp.baseURL}/__test/fault`, {
      headers: { ...TEST_HEADERS, 'Content-Type': 'application/json' },
      data: '{',
    });

    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual(INVALID_CONTROL);
  });
});

test.describe('test-control authorization is indistinguishable from absence', () => {
  test.describe.configure({ mode: 'parallel' });
  test.use({
    applicationOptions: {
      testMode: true,
      testToken: TEST_TOKEN,
      host: '127.0.0.1',
    },
  });

  for (const credential of [
    { title: 'missing token', headers: {} as Record<string, string> },
    {
      title: 'wrong token',
      headers: {
        'X-RFG-Test-Token': `${TEST_TOKEN}x`,
      } as Record<string, string>,
    },
  ]) {
    test(`${credential.title} receives the generic 404`, async ({ isolatedApp, request }) => {
      const response = await request.get(`${isolatedApp.baseURL}/__test/state`, {
        headers: credential.headers,
      });

      expect(response.status()).toBe(404);
      expect(await response.json()).toEqual(NOT_FOUND);
    });
  }
});

test('test mode rejects a non-loopback host before listening', () => {
  expect(() =>
    (
      createApplication as (options: {
        testMode: boolean;
        testToken: string;
        host: string;
      }) => unknown
    )({ testMode: true, testToken: TEST_TOKEN, host: '0.0.0.0' }),
  ).toThrow();
});
