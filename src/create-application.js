'use strict';

const fs = require('fs/promises');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { createCatalogService } = require('./domain/catalog-service');
const { createOrderService } = require('./domain/order-service');
const {
  SERVICE_CAPACITY_REACHED,
  createPaymentService,
} = require('./domain/payment-service');
const { createSessionService } = require('./domain/session-service');
const { createStore } = require('./domain/store');
const {
  readSessionCookie,
  serializeClearedSessionCookie,
  serializeSessionCookie,
} = require('./http/cookies');
const { ERROR_DEFINITIONS, HttpError } = require('./http/errors');
const { parseJsonBody } = require('./http/json');
const { sendData, sendError } = require('./http/responses');
const { createRouter } = require('./http/router');
const { createFaultDecision } = require('./testing/faults');
const { createTestControls } = require('./testing/test-controls');

const STATIC_FILES = Object.freeze({
  '/': Object.freeze({ file: 'index.html', type: 'text/html; charset=utf-8' }),
  '/app.js': Object.freeze({
    file: 'app.js',
    type: 'application/javascript; charset=utf-8',
  }),
  '/style.css': Object.freeze({
    file: 'style.css',
    type: 'text/css; charset=utf-8',
  }),
});

const JSON_BODY_BOUNDARIES = new Set([
  'POST /api/session',
  'POST /api/payment-tokens',
  'POST /api/orders',
]);

const API_ERRORS = Object.freeze({
  AUTH_REQUIRED: Object.freeze({
    status: 401,
    code: 'AUTH_REQUIRED',
    message: 'A valid session is required.',
  }),
  INVALID_CREDENTIALS: Object.freeze({
    status: 401,
    code: 'INVALID_CREDENTIALS',
    message: 'The username or password is incorrect.',
  }),
  INVALID_INPUT: Object.freeze({
    status: 400,
    code: 'INVALID_INPUT',
    message: 'The request contains invalid input.',
  }),
});

function requiresJsonBody(request, pathname) {
  return JSON_BODY_BOUNDARIES.has(`${request.method} ${pathname}`);
}

async function serveStatic(response, pathname) {
  const staticFile = STATIC_FILES[pathname];

  if (!staticFile) {
    return false;
  }

  const content = await fs.readFile(
    path.resolve(__dirname, '..', 'app', staticFile.file),
  );
  response.writeHead(200, {
    'Content-Length': content.length,
    'Content-Type': staticFile.type,
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(content);
  return true;
}

function createApplication({
  store,
  clock,
  randomBytes,
  runtime,
  orderBarrier,
  sessionBarrier,
  testMode = false,
  testToken,
  host = '127.0.0.1',
  faultDecision,
} = {}) {
  const applicationStore = store ?? createStore();
  const generateRandomBytes = randomBytes ?? crypto.randomBytes;
  const applicationClock = clock ?? Date.now;
  const applicationRuntime = runtime ?? {
    publicBaseUrl: 'http://localhost',
  };
  const activeFaultDecision = faultDecision ?? createFaultDecision();
  const testControls = createTestControls({
    enabled: testMode,
    token: testToken,
    host,
    store: applicationStore,
    faultDecision: activeFaultDecision,
    notFoundDefinition: ERROR_DEFINITIONS.NOT_FOUND,
  });
  const sessions = createSessionService({
    store: applicationStore,
    randomBytes: generateRandomBytes,
    clock: applicationClock,
    sessionBarrier,
  });
  const catalog = createCatalogService({ store: applicationStore });
  const payments = createPaymentService({
    store: applicationStore,
    randomBytes: generateRandomBytes,
    clock: applicationClock,
  });
  const orders = createOrderService({
    store: applicationStore,
    paymentService: payments,
    randomBytes: generateRandomBytes,
    orderBarrier,
  });

  const router = createRouter([
    {
      method: 'GET',
      path: '/api/health',
      handler: async (_request, response) => {
        sendData(response, 200, {
          status: 'ok',
          version: 1,
          testMode: testControls.enabled,
        });
      },
    },
    {
      method: 'POST',
      path: '/api/session',
      handler: async (request, response) => {
        const result = sessions.create(request.body);

        if (result.kind === 'invalid-input') {
          sendError(response, API_ERRORS.INVALID_INPUT);
          return;
        }

        if (result.kind === 'invalid-credentials') {
          sendError(response, API_ERRORS.INVALID_CREDENTIALS);
          return;
        }

        response.setHeader(
          'Set-Cookie',
          serializeSessionCookie(result.sessionId, applicationRuntime),
        );
        sendData(response, 201, { user: result.user });
      },
    },
    {
      method: 'GET',
      path: '/api/session',
      handler: async (request, response) => {
        const user = await sessions.getForResponse(readSessionCookie(request));

        if (!user) {
          sendError(response, API_ERRORS.AUTH_REQUIRED);
          return;
        }

        sendData(response, 200, { user });
      },
    },
    {
      method: 'DELETE',
      path: '/api/session',
      handler: async (request, response) => {
        sessions.remove(readSessionCookie(request));
        response.writeHead(204, {
          'Set-Cookie': serializeClearedSessionCookie(applicationRuntime),
        });
        response.end();
      },
    },
    {
      method: 'POST',
      path: '/api/payment-tokens',
      handler: async (request, response) => {
        const session = sessions.get(readSessionCookie(request));
        if (!session) {
          sendError(response, API_ERRORS.AUTH_REQUIRED);
          return;
        }

        const result = payments.create(request.body);
        if (result.kind === 'invalid-input') {
          sendError(response, API_ERRORS.INVALID_INPUT);
          return;
        }

        if (result.kind === 'capacity') {
          sendError(response, SERVICE_CAPACITY_REACHED);
          return;
        }

        sendData(response, 201, result.data);
      },
    },
    {
      method: 'POST',
      path: '/api/orders',
      handler: async (request, response) => {
        testControls.recordOrderRequest();
        const session = sessions.get(readSessionCookie(request));
        if (!session) {
          sendError(response, API_ERRORS.AUTH_REQUIRED);
          return;
        }

        const result = await orders.submit({
          idempotencyKey: request.headers['idempotency-key'],
          body: request.body,
        });
        if (result.headers) {
          for (const [name, value] of Object.entries(result.headers)) {
            response.setHeader(name, value);
          }
        }

        if (result.kind === 'error') {
          sendError(response, result.error);
          return;
        }

        sendData(response, result.status, result.data);
      },
    },
    {
      method: 'GET',
      path: '/api/products',
      handler: async (request, response) => {
        if (!sessions.get(readSessionCookie(request))) {
          sendError(response, API_ERRORS.AUTH_REQUIRED);
          return;
        }

        sendData(response, 200, { products: catalog.listProducts() });
      },
    },
  ]);

  const handleRequest = async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');

      if (await testControls.handleRequest(request, response, url.pathname)) {
        return;
      }

      if (requiresJsonBody(request, url.pathname)) {
        request.body = await parseJsonBody(request);
      }

      if (await router(request, response, url.pathname)) {
        return;
      }

      if (request.method === 'GET' && (await serveStatic(response, url.pathname))) {
        return;
      }

      sendError(response, ERROR_DEFINITIONS.NOT_FOUND);
    } catch (error) {
      if (error instanceof HttpError) {
        const definition = {
          status: error.status,
          code: error.code,
          message: error.message,
        };
        sendError(response, definition);
        return;
      }

      sendError(response, ERROR_DEFINITIONS.INTERNAL_ERROR);
    }
  };

  return http.createServer((request, response) => {
    void handleRequest(request, response);
  });
}

module.exports = {
  createApplication,
};
