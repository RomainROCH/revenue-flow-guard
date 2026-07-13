import { request as httpRequest } from 'node:http';

import type { APIRequestContext } from '@playwright/test';
import { expect, test } from '../fixtures/isolated-app';

const MAX_IDEMPOTENCY_RECORDS = 100;

type Scenario = 'approved' | 'declined' | 'transient_failure';
type Item = { productId: number; quantity: number };

const errors = {
  SERVICE_CAPACITY_REACHED: ['The demonstration service is temporarily at capacity.', 503],
  AUTH_REQUIRED: ['A valid session is required.', 401],
  INVALID_ORDER: ['The order request is invalid.', 400],
  CLIENT_AMOUNT_FORBIDDEN: ['Prices and totals are calculated by the server.', 400],
  INVALID_ITEMS: ['The order items are invalid.', 400],
  OUT_OF_STOCK: ['This item is no longer available.', 409],
  IDEMPOTENCY_CONFLICT: ['This idempotency key was already used for another request.', 409],
  ORDER_IN_PROGRESS: ['An order with this idempotency key is still processing.', 409],
  PAYMENT_TOKEN_INVALID: ['The payment token is invalid or expired.', 409],
  PAYMENT_DECLINED: ['The demonstration payment was declined.', 402],
  PAYMENT_UNAVAILABLE: ['The demonstration payment service is temporarily unavailable.', 503],
} as const;

type ErrorCode = keyof typeof errors;

function errorEnvelope(code: ErrorCode) {
  return { data: null, error: { code, message: errors[code][0] } };
}

async function expectError(response: Awaited<ReturnType<APIRequestContext['post']>>, code: ErrorCode) {
  expect(response.status()).toBe(errors[code][1]);
  expect(await response.json()).toEqual(errorEnvelope(code));
}

async function login(request: APIRequestContext, baseURL: string) {
  const response = await request.post(`${baseURL}/api/session`, {
    data: { username: 'demo', password: 'demo' },
  });
  expect(response.status()).toBe(201);
  const setCookie = response.headers()['set-cookie'];
  if (!setCookie) {
    throw new Error('The session response did not set a cookie.');
  }

  return setCookie.split(';', 1)[0];
}

async function token(request: APIRequestContext, baseURL: string, scenario: Scenario = 'approved') {
  const response = await request.post(`${baseURL}/api/payment-tokens`, {
    data: { scenario },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).data.paymentToken as string;
}

async function stock(request: APIRequestContext, baseURL: string) {
  const response = await request.get(`${baseURL}/api/products`);
  expect(response.status()).toBe(200);
  const products = (await response.json()).data.products as Array<{
    id: number;
    availableQuantity: number;
  }>;
  return new Map(products.map((product) => [product.id, product.availableQuantity]));
}

function order(items: Item[], paymentToken: string) {
  return { items, paymentToken };
}

async function submit(
  request: APIRequestContext,
  baseURL: string,
  key: string,
  data: unknown,
) {
  return request.post(`${baseURL}/api/orders`, {
    headers: { 'Idempotency-Key': key },
    data,
  });
}

function postRawJson(baseURL: string, key: string, cookie: string, rawBody: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const url = new URL('/api/orders', baseURL);
    const request = httpRequest(
      url,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(rawBody),
          'Idempotency-Key': key,
          Cookie: cookie,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let responseEnded = false;
        response.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on('end', () => {
          responseEnded = true;
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
        response.on('close', () => {
          if (!responseEnded) {
            reject(new Error('The raw JSON response closed before completion.'));
          }
        });
        response.on('error', reject);
      },
    );

    request.on('error', reject);
    request.end(rawBody);
  });
}

test('POST /api/orders requires authentication before exposing order state', async ({
  isolatedApp,
  request,
}) => {
  const authenticationCases: Array<Record<string, string>> = [
    { 'Idempotency-Key': 'unauthenticated-order' },
    { 'Idempotency-Key': 'unknown-session-order', Cookie: 'rfg_session=unknown-session' },
  ];

  for (const headers of authenticationCases) {
    const response = await request.post(`${isolatedApp.baseURL}/api/orders`, {
      headers,
      data: order([{ productId: 1, quantity: 1 }], 'pt_private-value'),
    });
    await expectError(response, 'AUTH_REQUIRED');
    expect(await response.text()).not.toContain('pt_private-value');
  }
});

test('POST /api/orders rejects missing keys, non-object bodies, and non-string tokens as uncached INVALID_ORDER', async ({
  isolatedApp,
  request,
}) => {
  const sessionCookie = await login(request, isolatedApp.baseURL);
  const paymentToken = await token(request, isolatedApp.baseURL);
  const baseline = await stock(request, isolatedApp.baseURL);

  const missingKey = await request.post(`${isolatedApp.baseURL}/api/orders`, {
    data: order([{ productId: 1, quantity: 1 }], paymentToken),
  });
  await expectError(missingKey, 'INVALID_ORDER');

  const invalidNull = await postRawJson(
    isolatedApp.baseURL,
    'invalid-null',
    sessionCookie,
    'null',
  );
  expect(invalidNull.status).toBe(400);
  expect(JSON.parse(invalidNull.body)).toEqual(errorEnvelope('INVALID_ORDER'));

  const invalidString = await postRawJson(
    isolatedApp.baseURL,
    'invalid-string',
    sessionCookie,
    JSON.stringify('not an object'),
  );
  expect(invalidString.status).toBe(400);
  expect(JSON.parse(invalidString.body)).toEqual(errorEnvelope('INVALID_ORDER'));

  for (const [key, data] of [
    [' ', order([{ productId: 1, quantity: 1 }], paymentToken)],
    ['invalid-array', []],
    ['invalid-token', { items: [{ productId: 1, quantity: 1 }], paymentToken: 123 }],
  ] as const) {
    await expectError(await submit(request, isolatedApp.baseURL, key, data), 'INVALID_ORDER');
  }

  expect(await stock(request, isolatedApp.baseURL)).toEqual(baseline);

  const validAfterStructuralFailure = await submit(
    request,
    isolatedApp.baseURL,
    'invalid-null',
    order([{ productId: 1, quantity: 1 }], paymentToken),
  );
  expect(validAfterStructuralFailure.status()).toBe(201);
});

test('POST /api/orders enforces exact top-level and item fields and forbids client prices or totals', async ({
  isolatedApp,
  request,
}) => {
  await login(request, isolatedApp.baseURL);
  const paymentToken = await token(request, isolatedApp.baseURL);

  const unknownShapes = [
    { ...order([{ productId: 1, quantity: 1 }], paymentToken), extra: true },
    order([{ productId: 1, quantity: 1, extra: true } as unknown as Item], paymentToken),
  ];
  for (const [index, data] of unknownShapes.entries()) {
    await expectError(
      await submit(request, isolatedApp.baseURL, `unknown-field-${index}`, data),
      'INVALID_ORDER',
    );
  }

  const clientAmounts = [
    { ...order([{ productId: 1, quantity: 1 }], paymentToken), totalCents: 1 },
    { ...order([{ productId: 1, quantity: 1 }], paymentToken), total: 1 },
    order([{ productId: 1, quantity: 1, priceCents: 1 } as unknown as Item], paymentToken),
    order([{ productId: 1, quantity: 1, unitPriceCents: 1 } as unknown as Item], paymentToken),
  ];
  for (const [index, data] of clientAmounts.entries()) {
    await expectError(
      await submit(request, isolatedApp.baseURL, `client-amount-${index}`, data),
      'CLIENT_AMOUNT_FORBIDDEN',
    );
  }
});

test('POST /api/orders maps empty, duplicate, unknown, and invalid-quantity items to INVALID_ITEMS without stock changes', async ({
  isolatedApp,
  request,
}) => {
  await login(request, isolatedApp.baseURL);
  const paymentToken = await token(request, isolatedApp.baseURL);
  const baseline = await stock(request, isolatedApp.baseURL);
  const invalidItems: unknown[] = [
    [],
    [{ productId: 1, quantity: 1 }, { productId: 1, quantity: 2 }],
    [{ productId: 999, quantity: 1 }],
    [{ productId: 1, quantity: 0 }],
    [{ productId: 1, quantity: -1 }],
    [{ productId: 1, quantity: 1.5 }],
    [{ productId: 1, quantity: 101 }],
    [{ productId: 1, quantity: '1' }],
    [null],
  ];

  for (const [index, items] of invalidItems.entries()) {
    const response = await submit(request, isolatedApp.baseURL, `invalid-items-${index}`, {
      items,
      paymentToken,
    });
    await expectError(response, 'INVALID_ITEMS');
    expect(await stock(request, isolatedApp.baseURL)).toEqual(baseline);
  }
});

test('a successful order uses canonical item order, server totals, an opaque id, and replays exactly once', async ({
  isolatedApp,
  request,
}) => {
  await login(request, isolatedApp.baseURL);
  const paymentToken = await token(request, isolatedApp.baseURL);
  const key = 'successful-replay';
  const response = await submit(
    request,
    isolatedApp.baseURL,
    key,
    order(
      [
        { productId: 3, quantity: 1 },
        { productId: 1, quantity: 2 },
      ],
      paymentToken,
    ),
  );
  const firstBody = await response.json();

  expect(response.status()).toBe(201);
  expect(firstBody).toEqual({
    data: {
      orderId: expect.stringMatching(/^ord_[A-Za-z0-9_-]{43}$/),
      totalCents: 10_997,
      items: [
        { productId: 1, quantity: 2 },
        { productId: 3, quantity: 1 },
      ],
      replayed: false,
    },
    error: null,
  });
  expect(firstBody.data.orderId).not.toContain(paymentToken);
  expect(await stock(request, isolatedApp.baseURL)).toEqual(new Map([[1, 8], [2, 10], [3, 9]]));

  isolatedApp.advanceTime(5 * 60 * 1000);
  const replay = await submit(
    request,
    isolatedApp.baseURL,
    key,
    { paymentToken, items: [{ quantity: 2, productId: 1 }, { quantity: 1, productId: 3 }] },
  );
  expect(replay.status()).toBe(200);
  expect(await replay.json()).toEqual({
    data: { ...firstBody.data, replayed: true },
    error: null,
  });
  expect(await stock(request, isolatedApp.baseURL)).toEqual(new Map([[1, 8], [2, 10], [3, 9]]));
});

test('canonical hashing treats property and input item order as equal while a matching order is pending', async ({
  isolatedApp,
  request,
}) => {
  await login(request, isolatedApp.baseURL);
  const paymentToken = await token(request, isolatedApp.baseURL);
  const barrier = isolatedApp.holdNextOrder();
  const key = 'concurrent-canonical-order';
  const firstPromise = submit(
    request,
    isolatedApp.baseURL,
    key,
    order([{ productId: 3, quantity: 1 }, { productId: 1, quantity: 1 }], paymentToken),
  );

  await barrier.reached;
  try {
    const concurrent = await submit(request, isolatedApp.baseURL, key, {
      paymentToken,
      items: [{ quantity: 1, productId: 1 }, { quantity: 1, productId: 3 }],
    });
    await expectError(concurrent, 'ORDER_IN_PROGRESS');
    expect(concurrent.headers()['retry-after']).toBe('1');
  } finally {
    barrier.release();
  }

  const first = await firstPromise;
  expect(first.status()).toBe(201);
  expect(await stock(request, isolatedApp.baseURL)).toEqual(new Map([[1, 9], [2, 10], [3, 9]]));
});

test('the same idempotency key with a different canonical request returns IDEMPOTENCY_CONFLICT', async ({
  isolatedApp,
  request,
}) => {
  await login(request, isolatedApp.baseURL);
  const paymentToken = await token(request, isolatedApp.baseURL);
  const first = await submit(
    request,
    isolatedApp.baseURL,
    'conflicting-order',
    order([{ productId: 1, quantity: 1 }], paymentToken),
  );
  expect(first.status()).toBe(201);

  const conflict = await submit(
    request,
    isolatedApp.baseURL,
    'conflicting-order',
    order([{ productId: 1, quantity: 2 }], paymentToken),
  );
  await expectError(conflict, 'IDEMPOTENCY_CONFLICT');
});

test('a decline is cached exactly, consumes its token, and never changes stock', async ({
  isolatedApp,
  request,
}) => {
  await login(request, isolatedApp.baseURL);
  const paymentToken = await token(request, isolatedApp.baseURL, 'declined');
  const data = order([{ productId: 1, quantity: 1 }], paymentToken);
  const baseline = await stock(request, isolatedApp.baseURL);

  const first = await submit(request, isolatedApp.baseURL, 'declined-order', data);
  await expectError(first, 'PAYMENT_DECLINED');
  const firstBody = await first.json();
  expect(await stock(request, isolatedApp.baseURL)).toEqual(baseline);

  const replay = await submit(request, isolatedApp.baseURL, 'declined-order', data);
  expect(replay.status()).toBe(402);
  expect(await replay.json()).toEqual(firstBody);

  const reused = await submit(request, isolatedApp.baseURL, 'declined-token-reused', data);
  await expectError(reused, 'PAYMENT_TOKEN_INVALID');
  expect(await stock(request, isolatedApp.baseURL)).toEqual(baseline);
});

test('a transient failure deletes pending state, keeps the token, and succeeds on same-key retry', async ({
  isolatedApp,
  request,
}) => {
  await login(request, isolatedApp.baseURL);
  const paymentToken = await token(request, isolatedApp.baseURL, 'transient_failure');
  const data = order([{ productId: 2, quantity: 1 }], paymentToken);
  const baseline = await stock(request, isolatedApp.baseURL);

  const unavailable = await submit(request, isolatedApp.baseURL, 'transient-order', data);
  await expectError(unavailable, 'PAYMENT_UNAVAILABLE');
  expect(unavailable.headers()['retry-after']).toBe('1');
  expect(await stock(request, isolatedApp.baseURL)).toEqual(baseline);

  const retry = await submit(request, isolatedApp.baseURL, 'transient-order', data);
  expect(retry.status()).toBe(201);
  expect((await retry.json()).data.replayed).toBe(false);
  expect(await stock(request, isolatedApp.baseURL)).toEqual(new Map([[1, 10], [2, 9], [3, 10]]));
});

test('invalid, exactly expired, and consumed payment tokens return PAYMENT_TOKEN_INVALID without stock changes', async ({
  isolatedApp,
  request,
}) => {
  await login(request, isolatedApp.baseURL);
  const baseline = await stock(request, isolatedApp.baseURL);
  await expectError(
    await submit(
      request,
      isolatedApp.baseURL,
      'unknown-payment-token',
      order([{ productId: 1, quantity: 1 }], `pt_${'A'.repeat(43)}`),
    ),
    'PAYMENT_TOKEN_INVALID',
  );
  expect(await stock(request, isolatedApp.baseURL)).toEqual(baseline);

  const expired = await token(request, isolatedApp.baseURL);
  isolatedApp.advanceTime(5 * 60 * 1000);
  await expectError(
    await submit(
      request,
      isolatedApp.baseURL,
      'expired-payment-token',
      order([{ productId: 1, quantity: 1 }], expired),
    ),
    'PAYMENT_TOKEN_INVALID',
  );
  expect(await stock(request, isolatedApp.baseURL)).toEqual(baseline);

  const consumed = await token(request, isolatedApp.baseURL);
  const success = await submit(
    request,
    isolatedApp.baseURL,
    'consume-approved-token',
    order([{ productId: 1, quantity: 1 }], consumed),
  );
  expect(success.status()).toBe(201);
  const afterSuccess = await stock(request, isolatedApp.baseURL);
  await expectError(
    await submit(
      request,
      isolatedApp.baseURL,
      'reuse-approved-token',
      order([{ productId: 1, quantity: 1 }], consumed),
    ),
    'PAYMENT_TOKEN_INVALID',
  );
  expect(await stock(request, isolatedApp.baseURL)).toEqual(afterSuccess);
});

test('insufficient stock returns cached OUT_OF_STOCK and never decrements below zero', async ({
  isolatedApp,
  request,
}) => {
  await login(request, isolatedApp.baseURL);
  const depletionToken = await token(request, isolatedApp.baseURL);
  const depleted = await submit(
    request,
    isolatedApp.baseURL,
    'deplete-product-one',
    order([{ productId: 1, quantity: 10 }], depletionToken),
  );
  expect(depleted.status()).toBe(201);

  const paymentToken = await token(request, isolatedApp.baseURL);
  const data = order([{ productId: 1, quantity: 1 }], paymentToken);
  const first = await submit(request, isolatedApp.baseURL, 'out-of-stock-order', data);
  await expectError(first, 'OUT_OF_STOCK');
  expect((await stock(request, isolatedApp.baseURL)).get(1)).toBe(0);

  const replay = await submit(request, isolatedApp.baseURL, 'out-of-stock-order', data);
  await expectError(replay, 'OUT_OF_STOCK');
  expect((await stock(request, isolatedApp.baseURL)).get(1)).toBe(0);
});

test('deterministic item failures are cached and conflicting retries are rejected', async ({
  isolatedApp,
  request,
}) => {
  await login(request, isolatedApp.baseURL);
  const paymentToken = await token(request, isolatedApp.baseURL);
  const data = order([{ productId: 999, quantity: 1 }], paymentToken);
  const baseline = await stock(request, isolatedApp.baseURL);

  const first = await submit(request, isolatedApp.baseURL, 'cached-domain-failure', data);
  await expectError(first, 'INVALID_ITEMS');
  const firstBody = await first.json();

  isolatedApp.advanceTime(5 * 60 * 1000);
  const replay = await submit(request, isolatedApp.baseURL, 'cached-domain-failure', data);
  expect(replay.status()).toBe(400);
  expect(await replay.json()).toEqual(firstBody);

  const conflict = await submit(
    request,
    isolatedApp.baseURL,
    'cached-domain-failure',
    order([{ productId: 998, quantity: 1 }], paymentToken),
  );
  await expectError(conflict, 'IDEMPOTENCY_CONFLICT');
  expect(await stock(request, isolatedApp.baseURL)).toEqual(baseline);
});

test('idempotency capacity preserves pending and completed records without evicting them', async ({
  isolatedApp,
  request,
}) => {
  await login(request, isolatedApp.baseURL);
  const paymentToken = await token(request, isolatedApp.baseURL);
  const overflowPaymentToken = await token(request, isolatedApp.baseURL);
  const baseline = await stock(request, isolatedApp.baseURL);

  for (let index = 0; index < MAX_IDEMPOTENCY_RECORDS - 1; index += 1) {
    const response = await submit(
      request,
      isolatedApp.baseURL,
      `capacity-completed-${index}`,
      order([{ productId: 10_000 + index, quantity: 1 }], paymentToken),
    );
    await expectError(response, 'INVALID_ITEMS');
  }
  expect(await stock(request, isolatedApp.baseURL)).toEqual(baseline);

  const key = 'capacity-pending-100';
  const data = order([{ productId: 1, quantity: 1 }], paymentToken);
  const barrier = isolatedApp.holdNextOrder();
  const firstPromise = submit(request, isolatedApp.baseURL, key, data);
  await barrier.reached;

  let assertionFailure: unknown;
  try {
    const atCapacity = await submit(
      request,
      isolatedApp.baseURL,
      'capacity-overflow-101',
      order([{ productId: 2, quantity: 1 }], overflowPaymentToken),
    );
    await expectError(atCapacity, 'SERVICE_CAPACITY_REACHED');

    const pendingReplay = await submit(request, isolatedApp.baseURL, key, data);
    await expectError(pendingReplay, 'ORDER_IN_PROGRESS');
    expect(pendingReplay.headers()['retry-after']).toBe('1');
    expect(await stock(request, isolatedApp.baseURL)).toEqual(baseline);
  } catch (error) {
    assertionFailure = error;
  } finally {
    barrier.release();
  }

  const first = await firstPromise;
  if (assertionFailure) {
    throw assertionFailure;
  }
  expect(first.status()).toBe(201);

  const expectedStock = new Map(baseline);
  expectedStock.set(1, (expectedStock.get(1) ?? 0) - 1);
  expect(await stock(request, isolatedApp.baseURL)).toEqual(expectedStock);

  const completedReplay = await submit(request, isolatedApp.baseURL, key, data);
  expect(completedReplay.status()).toBe(200);
  expect((await completedReplay.json()).data.replayed).toBe(true);
  expect(await stock(request, isolatedApp.baseURL)).toEqual(expectedStock);
});
