'use strict';

const fs = require('fs/promises');
const http = require('http');
const path = require('path');
const { ERROR_DEFINITIONS, HttpError } = require('./http/errors');
const { parseJsonBody } = require('./http/json');
const { sendData, sendError } = require('./http/responses');
const { createRouter } = require('./http/router');

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

const JSON_BODY_BOUNDARIES = new Set(['POST /api/session']);

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

function createApplication({ store, clock, randomBytes, runtime } = {}) {
  void store;
  void clock;
  void randomBytes;
  void runtime;

  const router = createRouter([
    {
      method: 'GET',
      path: '/api/health',
      handler: async (_request, response) => {
        sendData(response, 200, {
          status: 'ok',
          version: 1,
          testMode: false,
        });
      },
    },
  ]);

  const handleRequest = async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');

      if (requiresJsonBody(request, url.pathname)) {
        await parseJsonBody(request);
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
