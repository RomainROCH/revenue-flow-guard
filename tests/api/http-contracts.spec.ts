import type { APIResponse } from '@playwright/test';
import { expect, test } from '../fixtures/isolated-app';

const notFoundBody = {
  data: null,
  error: {
    code: 'NOT_FOUND',
    message: 'The requested resource was not found.',
  },
};

const expectErrorCode = async (
  response: APIResponse,
  status: number,
  code: string,
): Promise<void> => {
  expect(response.status()).toBe(status);
  expect(await response.json()).toMatchObject({
    data: null,
    error: { code },
  });
};

test('returns the exact health contract in normal mode', async ({
  isolatedApp,
  request,
}) => {
  const response = await request.get(`${isolatedApp.baseURL}/api/health`);

  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({
    data: {
      status: 'ok',
      version: 1,
      testMode: false,
    },
    error: null,
  });
});

test('returns the exact not-found contract for an unknown route', async ({
  isolatedApp,
  request,
}) => {
  const response = await request.get(`${isolatedApp.baseURL}/api/unknown`);

  expect(response.status()).toBe(404);
  expect(await response.json()).toEqual(notFoundBody);
});

test('rejects an unsupported JSON media type', async ({
  isolatedApp,
  request,
}) => {
  const response = await request.post(`${isolatedApp.baseURL}/api/session`, {
    data: '{}',
    headers: { 'content-type': 'text/plain' },
  });

  await expectErrorCode(response, 415, 'UNSUPPORTED_MEDIA_TYPE');
});

test('rejects malformed JSON', async ({ isolatedApp, request }) => {
  const response = await request.post(`${isolatedApp.baseURL}/api/session`, {
    data: Buffer.from('{'),
    headers: { 'content-type': 'application/json' },
  });

  await expectErrorCode(response, 400, 'INVALID_JSON');
});

test('rejects a request body larger than 16 KiB', async ({
  isolatedApp,
  request,
}) => {
  const oversizedBody = JSON.stringify({ payload: 'x'.repeat(16 * 1024) });
  const response = await request.post(`${isolatedApp.baseURL}/api/session`, {
    data: oversizedBody,
    headers: { 'content-type': 'application/json' },
  });

  await expectErrorCode(response, 413, 'BODY_TOO_LARGE');
});

test('hides POST /__test/reset in normal mode', async ({
  isolatedApp,
  request,
}) => {
  const response = await request.post(`${isolatedApp.baseURL}/__test/reset`);

  expect(response.status()).toBe(404);
  expect(await response.json()).toEqual(notFoundBody);
});

test('hides PUT /__test/fault in normal mode', async ({
  isolatedApp,
  request,
}) => {
  const response = await request.put(`${isolatedApp.baseURL}/__test/fault`, {
    data: { faultId: 'payment-declined' },
  });

  expect(response.status()).toBe(404);
  expect(await response.json()).toEqual(notFoundBody);
});

test('hides GET /__test/state in normal mode', async ({
  isolatedApp,
  request,
}) => {
  const response = await request.get(`${isolatedApp.baseURL}/__test/state`);

  expect(response.status()).toBe(404);
  expect(await response.json()).toEqual(notFoundBody);
});
