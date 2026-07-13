'use strict';

const { timingSafeEqual } = require('node:crypto');
const { isFaultId } = require('./faults');

const MAX_BODY_BYTES = 16 * 1024;
const TEST_TOKEN_HEADER = 'x-rfg-test-token';
const CONTROL_ROUTE_KEYS = new Set([
  'POST /__test/reset',
  'PUT /__test/fault',
  'GET /__test/state',
]);
const INVALID_TEST_CONTROL = Object.freeze({
  status: 400,
  code: 'INVALID_TEST_CONTROL',
  message: 'The test control request is invalid.',
});
const DEFAULT_NOT_FOUND = Object.freeze({
  status: 404,
  code: 'NOT_FOUND',
  message: 'The requested resource was not found.',
});

function isLoopbackHost(host) {
  if (typeof host !== 'string') {
    return false;
  }

  const normalizedHost = host.trim().toLowerCase();
  return (
    normalizedHost === '127.0.0.1' ||
    normalizedHost === '::1' ||
    normalizedHost === '[::1]' ||
    normalizedHost === 'localhost'
  );
}

function validateConfiguration({ enabled, token, host }) {
  if (!enabled) {
    return;
  }

  if (!isLoopbackHost(host)) {
    throw new Error('Test controls require a loopback host.');
  }

  if (typeof token !== 'string' || Buffer.byteLength(token, 'utf8') < 32) {
    throw new Error('Test controls require a token of at least 32 bytes.');
  }
}

function tokenMatches(actualToken, expectedToken) {
  if (typeof actualToken !== 'string') {
    return false;
  }

  const actual = Buffer.from(actualToken, 'utf8');
  const expected = Buffer.from(expectedToken, 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Length': Buffer.byteLength(payload),
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(payload);
}

function sendData(response, status, data) {
  sendJson(response, status, { data, error: null });
}

function sendError(response, definition) {
  sendJson(response, definition.status, {
    data: null,
    error: {
      code: definition.code,
      message: definition.message,
    },
  });
}

function readBoundedBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let byteLength = 0;

    const cleanup = () => {
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('error', onError);
      request.off('aborted', onAborted);
    };
    const fail = (error) => {
      cleanup();
      request.resume();
      reject(error);
    };
    const onData = (chunk) => {
      byteLength += chunk.length;
      if (byteLength > MAX_BODY_BYTES) {
        fail(new Error('Test control body is too large.'));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks, byteLength).toString('utf8'));
    };
    const onError = (error) => fail(error);
    const onAborted = () => fail(new Error('Test control request aborted.'));

    request.on('data', onData);
    request.on('end', onEnd);
    request.on('error', onError);
    request.on('aborted', onAborted);
  });
}

function hasJsonContentType(request) {
  const contentType = request.headers['content-type'];
  return (
    typeof contentType === 'string' &&
    contentType.split(';', 1)[0].trim().toLowerCase() === 'application/json'
  );
}

function parseFaultBody(request, rawBody) {
  if (!hasJsonContentType(request) || rawBody.length === 0) {
    throw new Error('Invalid test control body.');
  }

  const body = JSON.parse(rawBody);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Invalid test control body.');
  }

  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== 'faultId' || !isFaultId(body.faultId)) {
    throw new Error('Invalid test control body.');
  }

  return body.faultId;
}

function createTestControls({
  enabled = false,
  token,
  host = '127.0.0.1',
  store,
  faultDecision,
  notFoundDefinition = DEFAULT_NOT_FOUND,
}) {
  validateConfiguration({ enabled, token, host });

  if (!enabled) {
    return Object.freeze({
      enabled: false,
      async handleRequest() {
        return false;
      },
      recordOrderRequest() {},
    });
  }

  if (!store || !faultDecision) {
    throw new TypeError('Test controls require a store and fault decision.');
  }

  const initialProducts = store.products.map((product) => ({ ...product }));
  const initialStock = new Map(store.stock);
  let orderRequestCount = 0;

  function resetState() {
    store.sessions.clear();
    store.paymentTokens.clear();
    store.idempotency.clear();
    store.orders.clear();
    store.products.splice(
      0,
      store.products.length,
      ...initialProducts.map((product) => ({ ...product })),
    );
    store.stock.clear();
    for (const [productId, quantity] of initialStock) {
      store.stock.set(productId, quantity);
    }
    orderRequestCount = 0;
    faultDecision.reset();
  }

  function currentState() {
    let pendingOrderCount = 0;
    for (const record of store.idempotency.values()) {
      if (record.state === 'pending') {
        pendingOrderCount += 1;
      }
    }

    return {
      faultId: faultDecision.id,
      orderCount: store.orders.size,
      pendingOrderCount,
      orderRequestCount,
    };
  }

  async function handleRequest(request, response, pathname) {
    const routeKey = `${request.method} ${pathname}`;
    if (!CONTROL_ROUTE_KEYS.has(routeKey)) {
      return false;
    }

    if (!tokenMatches(request.headers[TEST_TOKEN_HEADER], token)) {
      sendError(response, notFoundDefinition);
      return true;
    }

    try {
      const rawBody = await readBoundedBody(request);

      if (routeKey === 'POST /__test/reset') {
        if (rawBody.length !== 0) {
          throw new Error('Unexpected test control body.');
        }
        resetState();
        response.writeHead(204);
        response.end();
        return true;
      }

      if (routeKey === 'PUT /__test/fault') {
        const faultId = parseFaultBody(request, rawBody);
        resetState();
        faultDecision.activate(faultId);
        sendData(response, 200, { faultId });
        return true;
      }

      if (rawBody.length !== 0) {
        throw new Error('Unexpected test control body.');
      }
      sendData(response, 200, currentState());
      return true;
    } catch {
      sendError(response, INVALID_TEST_CONTROL);
      return true;
    }
  }

  return Object.freeze({
    enabled: true,
    handleRequest,
    recordOrderRequest() {
      orderRequestCount += 1;
    },
  });
}

module.exports = {
  CONTROL_ROUTE_KEYS,
  INVALID_TEST_CONTROL,
  MAX_BODY_BYTES,
  TEST_TOKEN_HEADER,
  createTestControls,
  isLoopbackHost,
};
