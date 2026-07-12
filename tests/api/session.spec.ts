import { expect, test } from '../fixtures/isolated-app';

const PUBLIC_USER = {
  id: 'user-demo',
  username: 'demo',
  displayName: 'Demo User',
} as const;

const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 100;

const INVALID_INPUT = {
  data: null,
  error: {
    code: 'INVALID_INPUT',
    message: 'The request contains invalid input.',
  },
} as const;

const INVALID_CREDENTIALS = {
  data: null,
  error: {
    code: 'INVALID_CREDENTIALS',
    message: 'The username or password is incorrect.',
  },
} as const;

const AUTH_REQUIRED = {
  data: null,
  error: {
    code: 'AUTH_REQUIRED',
    message: 'A valid session is required.',
  },
} as const;

test('POST /api/session creates a public session and strict local cookie', async ({
  isolatedApp,
  request,
}) => {
  const response = await request.post(`${isolatedApp.baseURL}/api/session`, {
    data: { username: 'demo', password: 'demo' },
  });

  expect(response.status()).toBe(201);
  expect(await response.json()).toEqual({
    data: { user: PUBLIC_USER },
    error: null,
  });

  const setCookie = response.headers()['set-cookie'];
  expect(setCookie).toBeDefined();
  expect(setCookie).toMatch(/^rfg_session=[^;]+; HttpOnly; SameSite=Strict; Path=\/$/);
  expect(setCookie).not.toContain('Secure');

  const sessionId = setCookie?.match(/^rfg_session=([^;]+)/)?.[1];
  expect(sessionId).toBeTruthy();
  expect(sessionId).not.toBe('demo');
  expect(JSON.stringify(await response.json())).not.toContain(sessionId!);
});

test('POST /api/session rejects invalid request shapes', async ({
  isolatedApp,
  request,
}) => {
  const invalidBodies = [
    {},
    { username: 'demo' },
    { password: 'demo' },
    { username: '', password: 'demo' },
    { username: '   ', password: 'demo' },
    { username: 'demo', password: '' },
    { username: 'demo', password: '   ' },
    { username: 123, password: 'demo' },
    { username: 'demo', password: 123 },
    { username: 'a'.repeat(101), password: 'demo' },
    { username: 'demo', password: 'a'.repeat(101) },
    { username: 'demo', password: 'demo', extra: true },
  ];

  for (const body of invalidBodies) {
    const response = await request.post(`${isolatedApp.baseURL}/api/session`, {
      data: body,
    });

    expect(response.status(), JSON.stringify(body)).toBe(400);
    expect(await response.json()).toEqual(INVALID_INPUT);
  }
});

test('POST /api/session rejects incorrect credentials without setting a cookie', async ({
  isolatedApp,
  request,
}) => {
  const response = await request.post(`${isolatedApp.baseURL}/api/session`, {
    data: { username: 'demo', password: 'incorrect' },
  });

  expect(response.status()).toBe(401);
  expect(await response.json()).toEqual(INVALID_CREDENTIALS);
  expect(response.headers()['set-cookie']).toBeUndefined();
});

test('POST /api/session trims valid credentials before authentication', async ({
  isolatedApp,
  request,
}) => {
  const response = await request.post(`${isolatedApp.baseURL}/api/session`, {
    data: { username: '  demo  ', password: '  demo  ' },
  });

  expect(response.status()).toBe(201);
  expect(await response.json()).toEqual({
    data: { user: PUBLIC_USER },
    error: null,
  });
});

test('GET /api/session returns the authenticated public user', async ({
  isolatedApp,
  request,
}) => {
  const login = await request.post(`${isolatedApp.baseURL}/api/session`, {
    data: { username: 'demo', password: 'demo' },
  });
  expect(login.status()).toBe(201);

  const response = await request.get(`${isolatedApp.baseURL}/api/session`);

  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({
    data: { user: PUBLIC_USER },
    error: null,
  });
  expect(JSON.stringify(await response.json())).not.toContain('password');
});

test('GET /api/session requires a known session without leaking credentials', async ({
  isolatedApp,
  request,
}) => {
  for (const headers of [undefined, { Cookie: 'rfg_session=unknown-session' }]) {
    const response = await request.get(
      `${isolatedApp.baseURL}/api/session`,
      headers ? { headers } : {},
    );

    expect(response.status()).toBe(401);
    expect(await response.json()).toEqual(AUTH_REQUIRED);
    const body = await response.text();
    expect(body).not.toContain('demo');
    expect(body).not.toContain('password');
    expect(body).not.toContain('unknown-session');
  }
});

test('DELETE /api/session is idempotent without a session', async ({
  isolatedApp,
  request,
}) => {
  const first = await request.delete(`${isolatedApp.baseURL}/api/session`);
  const second = await request.delete(`${isolatedApp.baseURL}/api/session`);

  expect(first.status()).toBe(204);
  expect(await first.body()).toHaveLength(0);
  expect(second.status()).toBe(204);
  expect(await second.body()).toHaveLength(0);
});

test('DELETE /api/session invalidates an authenticated session and remains idempotent', async ({
  isolatedApp,
  request,
}) => {
  const login = await request.post(`${isolatedApp.baseURL}/api/session`, {
    data: { username: 'demo', password: 'demo' },
  });
  expect(login.status()).toBe(201);

  const deleted = await request.delete(`${isolatedApp.baseURL}/api/session`);
  expect(deleted.status()).toBe(204);
  expect(await deleted.body()).toHaveLength(0);

  const session = await request.get(`${isolatedApp.baseURL}/api/session`);
  expect(session.status()).toBe(401);
  expect(await session.json()).toEqual(AUTH_REQUIRED);

  const deletedAgain = await request.delete(`${isolatedApp.baseURL}/api/session`);
  expect(deletedAgain.status()).toBe(204);
  expect(await deletedAgain.body()).toHaveLength(0);
});

test('a session expires at exactly 30 minutes without sliding on access', async ({
  isolatedApp,
  request,
}) => {
  const login = await request.post(`${isolatedApp.baseURL}/api/session`, {
    data: { username: 'demo', password: 'demo' },
  });
  expect(login.status()).toBe(201);

  isolatedApp.advanceTime(SESSION_TTL_MS - 1);

  const beforeExpiry = await request.get(`${isolatedApp.baseURL}/api/session`);
  expect(beforeExpiry.status()).toBe(200);
  expect(await beforeExpiry.json()).toEqual({
    data: { user: PUBLIC_USER },
    error: null,
  });

  isolatedApp.advanceTime(1);

  const atExpiry = await request.get(`${isolatedApp.baseURL}/api/session`);
  expect(atExpiry.status()).toBe(401);
  expect(await atExpiry.json()).toEqual(AUTH_REQUIRED);
});

test('creating a 101st active session evicts the oldest and preserves the newest', async ({
  isolatedApp,
  request,
}) => {
  const cookies = [];

  for (let index = 0; index < MAX_SESSIONS + 1; index += 1) {
    const login = await request.post(`${isolatedApp.baseURL}/api/session`, {
      data: { username: 'demo', password: 'demo' },
    });
    expect(login.status()).toBe(201);

    const setCookie = login.headers()['set-cookie'];
    const cookie = setCookie?.split(';', 1)[0];
    expect(cookie).toMatch(/^rfg_session=[^;]+$/);
    cookies.push(cookie!);
  }

  expect(new Set(cookies).size).toBe(MAX_SESSIONS + 1);

  const oldest = await request.get(`${isolatedApp.baseURL}/api/session`, {
    headers: { Cookie: cookies[0] },
  });
  expect(oldest.status()).toBe(401);
  expect(await oldest.json()).toEqual(AUTH_REQUIRED);

  const newest = await request.get(`${isolatedApp.baseURL}/api/session`, {
    headers: { Cookie: cookies.at(-1)! },
  });
  expect(newest.status()).toBe(200);
  expect(await newest.json()).toEqual({
    data: { user: PUBLIC_USER },
    error: null,
  });
});
