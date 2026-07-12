'use strict';

function createCatalogService({ store }) {
  function listProducts() {
    return store.products.map((product) => ({
      ...product,
      availableQuantity: store.stock.get(product.id) ?? 0,
    }));
  }

  return { listProducts };
}

module.exports = {
  createCatalogService,
};
