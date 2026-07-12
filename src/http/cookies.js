'use strict';

const SESSION_COOKIE_NAME = 'rfg_session';

function parseCookies(header) {
  if (typeof header !== 'string' || header.length === 0) {
    return {};
  }

  const cookies = Object.create(null);

  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');

    if (separator < 1) {
      continue;
    }

    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();

    if (name && !Object.hasOwn(cookies, name)) {
      cookies[name] = value;
    }
  }

  return cookies;
}

function isSecureRuntime(runtime) {
  try {
    return new URL(runtime.publicBaseUrl).protocol === 'https:';
  } catch {
    return false;
  }
}

function serializeSessionCookie(value, runtime) {
  const attributes = [
    `${SESSION_COOKIE_NAME}=${value}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
  ];

  if (isSecureRuntime(runtime)) {
    attributes.push('Secure');
  }

  return attributes.join('; ');
}

function serializeClearedSessionCookie(runtime) {
  const attributes = [
    `${SESSION_COOKIE_NAME}=`,
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
  ];

  if (isSecureRuntime(runtime)) {
    attributes.push('Secure');
  }

  return attributes.join('; ');
}

function readSessionCookie(request) {
  return parseCookies(request.headers.cookie)[SESSION_COOKIE_NAME];
}

module.exports = {
  readSessionCookie,
  serializeClearedSessionCookie,
  serializeSessionCookie,
};
