'use strict';

const PUBLIC_USER = Object.freeze({
  id: 'user-demo',
  username: 'demo',
  displayName: 'Demo User',
});

const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 100;

function normalizeCredentials(body) {
  if (
    body === null ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).length !== 2 ||
    !Object.hasOwn(body, 'username') ||
    !Object.hasOwn(body, 'password') ||
    typeof body.username !== 'string' ||
    typeof body.password !== 'string'
  ) {
    return null;
  }

  const username = body.username.trim();
  const password = body.password.trim();

  if (
    username.length < 1 ||
    username.length > 100 ||
    password.length < 1 ||
    password.length > 100
  ) {
    return null;
  }

  return { username, password };
}

function createSessionService({ store, randomBytes, clock, sessionBarrier }) {
  function getCurrentTime() {
    const now = clock();

    if (!Number.isFinite(now)) {
      throw new TypeError('Session clock must return finite milliseconds.');
    }

    return now;
  }

  function purgeExpired(now) {
    for (const [sessionId, session] of store.sessions) {
      if (session.expiresAt <= now) {
        store.sessions.delete(sessionId);
      }
    }
  }

  function create(body) {
    const now = getCurrentTime();
    purgeExpired(now);
    const credentials = normalizeCredentials(body);

    if (!credentials) {
      return { kind: 'invalid-input' };
    }

    if (credentials.username !== 'demo' || credentials.password !== 'demo') {
      return { kind: 'invalid-credentials' };
    }

    while (store.sessions.size >= MAX_SESSIONS) {
      const oldestSessionId = store.sessions.keys().next().value;
      store.sessions.delete(oldestSessionId);
    }

    const sessionId = randomBytes(32).toString('base64url');
    store.sessions.set(sessionId, {
      profile: { ...PUBLIC_USER },
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
    });

    return {
      kind: 'created',
      sessionId,
      user: { ...PUBLIC_USER },
    };
  }

  function get(sessionId) {
    const now = getCurrentTime();
    purgeExpired(now);

    if (!sessionId) {
      return null;
    }

    const session = store.sessions.get(sessionId);

    if (!session) {
      return null;
    }

    return { ...session.profile };
  }

  async function getForResponse(sessionId) {
    const user = get(sessionId);

    if (sessionBarrier) {
      await sessionBarrier.beforeResponse();
    }

    return user;
  }

  function remove(sessionId) {
    if (sessionId) {
      store.sessions.delete(sessionId);
    }
  }

  return { create, get, getForResponse, remove };
}

module.exports = {
  MAX_SESSIONS,
  PUBLIC_USER,
  SESSION_TTL_MS,
  createSessionService,
};
