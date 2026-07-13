'use strict';

const crypto = require('node:crypto');

const MAX_IDEMPOTENCY_KEY_LENGTH = 200;
const MAX_QUANTITY = 100;
const CLIENT_AMOUNT_FIELDS = new Set([
  'price',
  'priceCents',
  'total',
  'totalCents',
  'unitPrice',
  'unitPriceCents',
]);

function validateIdempotencyKey(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const key = value.trim();
  if (key.length < 1 || key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    return null;
  }

  return key;
}

function hasClientAmountField(value) {
  return Object.keys(value).some((key) => CLIENT_AMOUNT_FIELDS.has(key));
}

function canonicalizeOrder(idempotencyKey, body) {
  const key = validateIdempotencyKey(idempotencyKey);
  if (!key || body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { kind: 'invalid', code: 'INVALID_ORDER' };
  }

  if (hasClientAmountField(body)) {
    return { kind: 'invalid', code: 'CLIENT_AMOUNT_FORBIDDEN' };
  }

  const bodyKeys = Object.keys(body);
  if (
    bodyKeys.length !== 2 ||
    !Object.hasOwn(body, 'items') ||
    !Object.hasOwn(body, 'paymentToken') ||
    !Array.isArray(body.items) ||
    typeof body.paymentToken !== 'string'
  ) {
    return { kind: 'invalid', code: 'INVALID_ORDER' };
  }

  const items = [];
  for (const item of body.items) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      return { kind: 'invalid', code: 'INVALID_ITEMS' };
    }

    if (hasClientAmountField(item)) {
      return { kind: 'invalid', code: 'CLIENT_AMOUNT_FORBIDDEN' };
    }

    const itemKeys = Object.keys(item);
    if (
      itemKeys.length !== 2 ||
      !Object.hasOwn(item, 'productId') ||
      !Object.hasOwn(item, 'quantity')
    ) {
      return { kind: 'invalid', code: 'INVALID_ORDER' };
    }

    if (
      !Number.isSafeInteger(item.productId) ||
      item.productId < 1 ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > MAX_QUANTITY
    ) {
      return { kind: 'invalid', code: 'INVALID_ITEMS' };
    }

    items.push({ productId: item.productId, quantity: item.quantity });
  }

  items.sort((left, right) =>
    left.productId === right.productId
      ? left.quantity - right.quantity
      : left.productId - right.productId,
  );

  const canonicalRequest = {
    items,
    paymentToken: body.paymentToken,
  };
  const requestHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalRequest), 'utf8')
    .digest('hex');

  return {
    kind: 'valid',
    key,
    requestHash,
    items,
    paymentToken: body.paymentToken,
  };
}

module.exports = {
  canonicalizeOrder,
};
