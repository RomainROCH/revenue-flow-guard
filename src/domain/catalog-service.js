'use strict';

function createCatalogService({ store, faultDecision = { is: () => false } }) {
  function requiresSession() {
    return !faultDecision.is('AUTH_BYPASS');
  }

  function listProducts() {
    return store.products.map((product) => ({
      ...product,
      availableQuantity: store.stock.get(product.id) ?? 0,
    }));
  }

  return { listProducts, requiresSession };
}

module.exports = {
  createCatalogService,
};
