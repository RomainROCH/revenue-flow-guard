'use strict';

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

module.exports = {
  sendData,
  sendError,
};
