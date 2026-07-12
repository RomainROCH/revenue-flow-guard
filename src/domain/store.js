'use strict';

const PRODUCT_DEFINITIONS = Object.freeze([
  Object.freeze({ id: 1, name: 'Wireless Mouse', priceCents: 2999 }),
  Object.freeze({ id: 2, name: 'Mechanical Keyboard', priceCents: 8999 }),
  Object.freeze({ id: 3, name: 'USB-C Hub', priceCents: 4999 }),
]);

function createStore() {
  return {
    sessions: new Map(),
    paymentTokens: new Map(),
    idempotency: new Map(),
    orders: new Map(),
    products: PRODUCT_DEFINITIONS.map((product) => ({ ...product })),
    stock: new Map(PRODUCT_DEFINITIONS.map(({ id }) => [id, 10])),
  };
}

module.exports = {
  createStore,
};
