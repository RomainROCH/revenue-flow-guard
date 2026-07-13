'use strict';

const PAYMENT_TOKEN_TTL_MS = 5 * 60 * 1000;
const MAX_PAYMENT_TOKENS = 100;
const PAYMENT_SCENARIOS = new Set(['approved', 'declined', 'transient_failure']);
const SERVICE_CAPACITY_REACHED = Object.freeze({
  status: 503,
  code: 'SERVICE_CAPACITY_REACHED',
  message: 'The demonstration service is temporarily at capacity.',
});

function cloneTokenResponse(paymentToken, expiresAt) {
  return {
    paymentToken,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

function createPaymentService({ store, randomBytes, clock }) {
  function getCurrentTime() {
    const now = clock();
    if (!Number.isFinite(now)) {
      throw new TypeError('Payment clock must return finite milliseconds.');
    }

    return now;
  }

  function purgeExpired(now) {
    for (const [paymentToken, record] of store.paymentTokens) {
      if (record.expiresAt <= now) {
        store.paymentTokens.delete(paymentToken);
      }
    }
  }

  function create(body) {
    if (
      body === null ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !Object.hasOwn(body, 'scenario') ||
      typeof body.scenario !== 'string' ||
      !PAYMENT_SCENARIOS.has(body.scenario)
    ) {
      return { kind: 'invalid-input' };
    }

    const now = getCurrentTime();
    purgeExpired(now);
    if (store.paymentTokens.size >= MAX_PAYMENT_TOKENS) {
      return { kind: 'capacity' };
    }

    const expiresAt = now + PAYMENT_TOKEN_TTL_MS;
    let paymentToken;
    do {
      paymentToken = `pt_${randomBytes(32).toString('base64url')}`;
    } while (store.paymentTokens.has(paymentToken));

    store.paymentTokens.set(paymentToken, {
      scenario: body.scenario,
      expiresAt,
    });

    return {
      kind: 'created',
      data: cloneTokenResponse(paymentToken, expiresAt),
    };
  }

  function inspect(paymentToken) {
    const record = store.paymentTokens.get(paymentToken);
    if (!record) {
      return { kind: 'invalid' };
    }

    if (record.expiresAt <= getCurrentTime()) {
      store.paymentTokens.delete(paymentToken);
      return { kind: 'invalid' };
    }

    if (record.scenario === 'transient_failure') {
      record.scenario = 'approved';
      return { kind: 'transient' };
    }

    return { kind: record.scenario };
  }

  function consume(paymentToken) {
    store.paymentTokens.delete(paymentToken);
  }

  return {
    consume,
    create,
    inspect,
  };
}

module.exports = {
  MAX_PAYMENT_TOKENS,
  SERVICE_CAPACITY_REACHED,
  createPaymentService,
};
