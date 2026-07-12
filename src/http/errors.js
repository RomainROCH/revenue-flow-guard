'use strict';

const ERROR_DEFINITIONS = Object.freeze({
  BODY_TOO_LARGE: Object.freeze({
    status: 413,
    code: 'BODY_TOO_LARGE',
    message: 'The request body is too large.',
  }),
  INTERNAL_ERROR: Object.freeze({
    status: 500,
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred.',
  }),
  INVALID_JSON: Object.freeze({
    status: 400,
    code: 'INVALID_JSON',
    message: 'The request body must contain valid JSON.',
  }),
  NOT_FOUND: Object.freeze({
    status: 404,
    code: 'NOT_FOUND',
    message: 'The requested resource was not found.',
  }),
  UNSUPPORTED_MEDIA_TYPE: Object.freeze({
    status: 415,
    code: 'UNSUPPORTED_MEDIA_TYPE',
    message: 'Content-Type must be application/json.',
  }),
});

class HttpError extends Error {
  constructor(definition) {
    super(definition.message);
    this.name = 'HttpError';
    this.status = definition.status;
    this.code = definition.code;
  }
}

module.exports = {
  ERROR_DEFINITIONS,
  HttpError,
};
