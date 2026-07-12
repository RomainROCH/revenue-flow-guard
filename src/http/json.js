'use strict';

const { ERROR_DEFINITIONS, HttpError } = require('./errors');

const MAX_JSON_BODY_BYTES = 16 * 1024;

function hasJsonContentType(request) {
  const contentType = request.headers['content-type'];

  return (
    typeof contentType === 'string' &&
    contentType.split(';', 1)[0].trim().toLowerCase() === 'application/json'
  );
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let byteLength = 0;

    const cleanup = () => {
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('error', onError);
    };

    const onData = (chunk) => {
      byteLength += chunk.length;

      if (byteLength > MAX_JSON_BODY_BYTES) {
        cleanup();
        request.resume();
        reject(new HttpError(ERROR_DEFINITIONS.BODY_TOO_LARGE));
        return;
      }

      chunks.push(chunk);
    };

    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks, byteLength).toString('utf8'));
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    request.on('data', onData);
    request.on('end', onEnd);
    request.on('error', onError);
  });
}

async function parseJsonBody(request) {
  if (!hasJsonContentType(request)) {
    throw new HttpError(ERROR_DEFINITIONS.UNSUPPORTED_MEDIA_TYPE);
  }

  const body = await readBody(request);

  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(ERROR_DEFINITIONS.INVALID_JSON);
  }
}

module.exports = {
  MAX_JSON_BODY_BYTES,
  parseJsonBody,
};
