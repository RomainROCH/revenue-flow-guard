import type { APIRequestContext } from '@playwright/test';
import { expect, test } from '../fixtures/isolated-app';

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const MAX_PAYMENT_TOKENS = 100;
const SERVICE_CAPACITY_REACHED = {
  data: null,
  error: {
    code: 'SERVICE_CAPACITY_REACHED',
    message: 'The demonstration service is temporarily at capacity.',
  },
};

const AUTH_REQUIRED = {
  data: null,
  error: {
    code: 'AUTH_REQUIRED',
    message: 'A valid session is required.',
  },
} as const;

const INVALID_INPUT = {
  data: null,
  error: {
    code: 'INVALID_INPUT',
    message: 'The request contains invalid input.',
  },
} as const;

const PAYMENT_TOKEN_INVALID = {
  data: null,
  error: {
    code: 'PAYMENT_TOKEN_INVALID',
    message: 'The payment token is invalid or expired.',
  },
} as const;

async function login(request: APIRequestContext, baseURL: string) {
  const response = await request.post(`${baseURL}/api/session`, {
    data: { username: 'demo', password: 'demo' },
  });
  expect(response.status()).toBe(201);
}

async function issueToken(
  request: APIRequestContext,
  baseURL: string,
  scenario: 'approved' | 'declined' | 'transient_failure' = 'approved',
) {
  const response = await request.post(`${baseURL}/api/payment-tokens`, {
    data: { scenario },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).data.paymentToken as string;
}

test('POST /api/payment-tokens returns distinct opaque five-minute tokens for approved scenarios only', async ({
  isolatedApp,
  request,
}) => {
  await login(request, isolatedApp.baseURL);
  const scenarios = ['approved', 'declined', 'transient_failure'] as const;
  const tokens: string[] = [];

  for (const scenario of scenarios) {
    const response = await request.post(`${isolatedApp.baseURL}/api/payment-tokens`, {
      data: { scenario },
    });
    const body = await response.json();

    expect(response.status()).toBe(201);
    expect(body).toEqual({
      data: {
        paymentToken: expect.stringMatching(/^pt_[A-Za-z0-9_-]{43}$/),
        expiresAt: new Date(FIVE_MINUTES_MS).toISOString(),
      },
      error: null,
    });
    expect(body.data.paymentToken.toLowerCase()).not.toContain(scenario);
    expect(JSON.stringify(body)).not.toContain('4111111111111111');
    tokens.push(body.data.paymentToken);
  }

  expect(new Set(tokens).size).toBe(tokens.length);
});

test('POST /api/payment-tokens requires an authenticated session', async ({
  isolatedApp,
  request,
}) => {
  for (const headers of [undefined, { Cookie: 'rfg_session=unknown-session' }]) {
    const response = await request.post(
      `${isolatedApp.baseURL}/api/payment-tokens`,
      headers ? { headers, data: { scenario: 'approved' } } : { data: { scenario: 'approved' } },
    );

    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual(AUTH_REQUIRED);
  }
});

test('POST /api/payment-tokens rejects missing, unknown, PAN-like, card, and invalid fields without echoing secrets', async ({
  isolatedApp,
  request,
}) => {
  await login(request, isolatedApp.baseURL);
  const invalidBodies = [
    {},
    { scenario: 'unknown' },
    { scenario: '' },
    { scenario: 1 },
    { scenario: null },
    { scenario: 'approved', extra: true },
    { scenario: 'approved', pan: '4111111111111111' },
    { scenario: 'approved', cardNumber: '4111111111111111' },
    { scenario: 'approved', card: { number: '4111111111111111' } },
    { scenario: 'approved', cvv: '123' },
    { scenario: 'approved', expiry: '12/30' },
  ];

  for (const data of invalidBodies) {
    const response = await request.post(`${isolatedApp.baseURL}/api/payment-tokens`, {
      data,
    });
    const text = await response.text();

    expect(response.status(), JSON.stringify(data)).toBe(400);
    expect(JSON.parse(text)).toEqual(INVALID_INPUT);
    expect(text).not.toContain('4111111111111111');
    expect(text).not.toContain('123');
    expect(text).not.toContain('12/30');
  }
});

test('a payment token is invalid at its exact five-minute expiry', async ({
  isolatedApp,
  request,
}) => {
  await login(request, isolatedApp.baseURL);
  const paymentToken = await issueToken(request, isolatedApp.baseURL);
  isolatedApp.advanceTime(FIVE_MINUTES_MS);

  const response = await request.post(`${isolatedApp.baseURL}/api/orders`, {
    headers: { 'Idempotency-Key': 'expired-token-boundary' },
    data: { items: [{ productId: 1, quantity: 1 }], paymentToken },
  });

  expect(response.status()).toBe(409);
  expect(await response.json()).toEqual(PAYMENT_TOKEN_INVALID);
});

test('an approved payment token is single-use across order attempts', async ({
  isolatedApp,
  request,
}) => {
  await login(request, isolatedApp.baseURL);
  const paymentToken = await issueToken(request, isolatedApp.baseURL);
  const data = { items: [{ productId: 1, quantity: 1 }], paymentToken };

  const first = await request.post(`${isolatedApp.baseURL}/api/orders`, {
    headers: { 'Idempotency-Key': 'consume-token-first' },
    data,
  });
  expect(first.status()).toBe(201);

  const reused = await request.post(`${isolatedApp.baseURL}/api/orders`, {
    headers: { 'Idempotency-Key': 'consume-token-second' },
    data,
  });
  expect(reused.status()).toBe(409);
  expect(await reused.json()).toEqual(PAYMENT_TOKEN_INVALID);
});

test('POST /api/payment-tokens bounds active tokens and purges exactly expired records', async ({
  isolatedApp,
  request,
}) => {
  await login(request, isolatedApp.baseURL);
  const issuedTokens = new Set<string>();

  for (let index = 0; index < MAX_PAYMENT_TOKENS; index += 1) {
    const response = await request.post(`${isolatedApp.baseURL}/api/payment-tokens`, {
      data: { scenario: 'approved' },
    });
    expect(response.status()).toBe(201);
    const paymentToken = (await response.json()).data.paymentToken as string;
    expect(issuedTokens.has(paymentToken)).toBe(false);
    issuedTokens.add(paymentToken);
  }
  expect(issuedTokens.size).toBe(MAX_PAYMENT_TOKENS);

  const atCapacity = await request.post(`${isolatedApp.baseURL}/api/payment-tokens`, {
    data: { scenario: 'approved' },
  });
  expect(atCapacity.status()).toBe(503);
  expect(await atCapacity.json()).toEqual(SERVICE_CAPACITY_REACHED);

  isolatedApp.advanceTime(FIVE_MINUTES_MS);
  const afterExpiry = await request.post(`${isolatedApp.baseURL}/api/payment-tokens`, {
    data: { scenario: 'approved' },
  });
  expect(afterExpiry.status()).toBe(201);
});
