'use strict';

const { canonicalizeOrder } = require('./canonical-order');
const { SERVICE_CAPACITY_REACHED } = require('./payment-service');

const MAX_IDEMPOTENCY_RECORDS = 100;

const ORDER_ERRORS = Object.freeze({
  SERVICE_CAPACITY_REACHED,
  INVALID_ORDER: Object.freeze({
    status: 400,
    code: 'INVALID_ORDER',
    message: 'The order request is invalid.',
  }),
  CLIENT_AMOUNT_FORBIDDEN: Object.freeze({
    status: 400,
    code: 'CLIENT_AMOUNT_FORBIDDEN',
    message: 'Prices and totals are calculated by the server.',
  }),
  INVALID_ITEMS: Object.freeze({
    status: 400,
    code: 'INVALID_ITEMS',
    message: 'The order items are invalid.',
  }),
  OUT_OF_STOCK: Object.freeze({
    status: 409,
    code: 'OUT_OF_STOCK',
    message: 'This item is no longer available.',
  }),
  IDEMPOTENCY_CONFLICT: Object.freeze({
    status: 409,
    code: 'IDEMPOTENCY_CONFLICT',
    message: 'This idempotency key was already used for another request.',
  }),
  ORDER_IN_PROGRESS: Object.freeze({
    status: 409,
    code: 'ORDER_IN_PROGRESS',
    message: 'An order with this idempotency key is still processing.',
  }),
  PAYMENT_TOKEN_INVALID: Object.freeze({
    status: 409,
    code: 'PAYMENT_TOKEN_INVALID',
    message: 'The payment token is invalid or expired.',
  }),
  PAYMENT_DECLINED: Object.freeze({
    status: 402,
    code: 'PAYMENT_DECLINED',
    message: 'The demonstration payment was declined.',
  }),
  PAYMENT_UNAVAILABLE: Object.freeze({
    status: 503,
    code: 'PAYMENT_UNAVAILABLE',
    message: 'The demonstration payment service is temporarily unavailable.',
  }),
});

function cloneItems(items) {
  return items.map(({ productId, quantity }) => ({ productId, quantity }));
}

function cloneData(data, replayed = data.replayed) {
  return {
    orderId: data.orderId,
    totalCents: data.totalCents,
    items: cloneItems(data.items),
    replayed,
  };
}

function failure(error, headers) {
  return { kind: 'error', status: error.status, error, headers };
}

function createOrderService({
  store,
  paymentService,
  randomBytes,
  orderBarrier = { async afterPending() {} },
  faultDecision = { is: () => false },
}) {
  function cacheFailure(key, pending, error) {
    const completed = {
      requestHash: pending.requestHash,
      state: 'completed',
      result: { kind: 'error', status: error.status, error },
    };
    store.idempotency.set(key, completed);
    return failure(error);
  }

  function replay(record) {
    if (record.result.kind === 'error') {
      return failure(record.result.error);
    }

    return {
      kind: 'success',
      status: 200,
      data: cloneData(record.result.data, true),
    };
  }

  function duplicateCompletedOrder(record) {
    const original = record.result.data;
    const orderId = `ord_${randomBytes(32).toString('base64url')}`;
    const data = {
      orderId,
      totalCents: original.totalCents,
      items: cloneItems(original.items),
      replayed: false,
    };

    for (const item of original.items) {
      store.stock.set(item.productId, store.stock.get(item.productId) - item.quantity);
    }
    store.orders.set(orderId, {
      id: orderId,
      totalCents: data.totalCents,
      items: cloneItems(data.items),
    });

    return { kind: 'success', status: 201, data };
  }

  async function submit({ idempotencyKey, body }) {
    const trustsClientTotal =
      faultDecision.is('CLIENT_PRICE_TRUST') &&
      body &&
      typeof body === 'object' &&
      !Array.isArray(body) &&
      Number.isInteger(body.totalCents);
    const canonicalBody = trustsClientTotal ? { ...body } : body;
    if (trustsClientTotal) {
      delete canonicalBody.totalCents;
    }
    const canonical = canonicalizeOrder(idempotencyKey, canonicalBody);
    if (canonical.kind === 'invalid') {
      return failure(ORDER_ERRORS[canonical.code]);
    }

    const existing = store.idempotency.get(canonical.key);
    if (existing) {
      if (existing.requestHash !== canonical.requestHash) {
        return failure(ORDER_ERRORS.IDEMPOTENCY_CONFLICT);
      }

      if (existing.state === 'pending') {
        return failure(ORDER_ERRORS.ORDER_IN_PROGRESS, { 'Retry-After': '1' });
      }

      if (
        faultDecision.is('DUPLICATE_ORDER') &&
        existing.result.kind === 'success'
      ) {
        return duplicateCompletedOrder(existing);
      }

      return replay(existing);
    }

    if (store.idempotency.size >= MAX_IDEMPOTENCY_RECORDS) {
      return failure(ORDER_ERRORS.SERVICE_CAPACITY_REACHED);
    }

    const pending = {
      requestHash: canonical.requestHash,
      state: 'pending',
    };
    store.idempotency.set(canonical.key, pending);

    try {
      await orderBarrier.afterPending();
    } catch (error) {
      if (store.idempotency.get(canonical.key) === pending) {
        store.idempotency.delete(canonical.key);
      }
      throw error;
    }

    if (
      canonical.items.length === 0 &&
      !faultDecision.is('EMPTY_CART_ACCEPTED')
    ) {
      return cacheFailure(canonical.key, pending, ORDER_ERRORS.INVALID_ITEMS);
    }

    const products = new Map(store.products.map((product) => [product.id, product]));
    const seenProductIds = new Set();
    let totalCents = 0;
    for (const item of canonical.items) {
      if (seenProductIds.has(item.productId)) {
        return cacheFailure(canonical.key, pending, ORDER_ERRORS.INVALID_ITEMS);
      }
      seenProductIds.add(item.productId);

      const product = products.get(item.productId);
      if (!product) {
        return cacheFailure(canonical.key, pending, ORDER_ERRORS.INVALID_ITEMS);
      }

      if ((store.stock.get(item.productId) ?? 0) < item.quantity) {
        return cacheFailure(canonical.key, pending, ORDER_ERRORS.OUT_OF_STOCK);
      }

      totalCents += product.priceCents * item.quantity;
    }

    if (trustsClientTotal) {
      totalCents = body.totalCents;
    }

    const payment = paymentService.inspect(canonical.paymentToken);
    if (payment.kind === 'invalid') {
      return cacheFailure(canonical.key, pending, ORDER_ERRORS.PAYMENT_TOKEN_INVALID);
    }

    if (payment.kind === 'transient') {
      if (store.idempotency.get(canonical.key) === pending) {
        store.idempotency.delete(canonical.key);
      }
      return failure(ORDER_ERRORS.PAYMENT_UNAVAILABLE, { 'Retry-After': '1' });
    }

    if (payment.kind === 'declined') {
      paymentService.consume(canonical.paymentToken);
      return cacheFailure(canonical.key, pending, ORDER_ERRORS.PAYMENT_DECLINED);
    }

    const orderId = `ord_${randomBytes(32).toString('base64url')}`;
    const data = {
      orderId,
      totalCents,
      items: cloneItems(canonical.items),
      replayed: false,
    };
    const order = {
      id: orderId,
      totalCents,
      items: cloneItems(canonical.items),
    };
    const completed = {
      requestHash: pending.requestHash,
      state: 'completed',
      result: {
        kind: 'success',
        status: 201,
        data: cloneData(data),
      },
    };

    for (const item of canonical.items) {
      store.stock.set(item.productId, store.stock.get(item.productId) - item.quantity);
    }
    paymentService.consume(canonical.paymentToken);
    store.orders.set(orderId, order);
    store.idempotency.set(canonical.key, completed);

    return {
      kind: 'success',
      status: 201,
      data: cloneData(data),
    };
  }

  return { submit };
}

module.exports = {
  MAX_IDEMPOTENCY_RECORDS,
  ORDER_ERRORS,
  createOrderService,
};
