import { expect, test } from '../fixtures/isolated-app';

const PRODUCTS = [
  {
    id: 1,
    name: 'Wireless Mouse',
    priceCents: 2999,
    availableQuantity: 10,
  },
  {
    id: 2,
    name: 'Mechanical Keyboard',
    priceCents: 8999,
    availableQuantity: 10,
  },
  {
    id: 3,
    name: 'USB-C Hub',
    priceCents: 4999,
    availableQuantity: 10,
  },
] as const;

const AUTH_REQUIRED = {
  data: null,
  error: {
    code: 'AUTH_REQUIRED',
    message: 'A valid session is required.',
  },
} as const;

test('GET /api/products returns the exact stable catalogue for an authenticated session', async ({
  isolatedApp,
  request,
}) => {
  const login = await request.post(`${isolatedApp.baseURL}/api/session`, {
    data: { username: 'demo', password: 'demo' },
  });
  expect(login.status()).toBe(201);

  const response = await request.get(`${isolatedApp.baseURL}/api/products`);

  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({
    data: { products: PRODUCTS },
    error: null,
  });
});

test('GET /api/products requires a known session and leaks no catalogue data', async ({
  isolatedApp,
  request,
}) => {
  for (const headers of [undefined, { Cookie: 'rfg_session=unknown-session' }]) {
    const response = await request.get(
      `${isolatedApp.baseURL}/api/products`,
      headers ? { headers } : {},
    );

    expect(response.status(), 'RFG:AUTH_BYPASS:AUTH_REQUIRED').toBe(401);
    expect(await response.json()).toEqual(AUTH_REQUIRED);

    const body = await response.text();
    for (const product of PRODUCTS) {
      expect(body).not.toContain(product.name);
      expect(body).not.toContain(String(product.priceCents));
      expect(body).not.toContain(String(product.availableQuantity));
    }
  }
});
