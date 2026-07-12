'use strict';

function routeKey(method, pathname) {
  return `${method} ${pathname}`;
}

function createRouter(routes) {
  const routesByKey = new Map(
    routes.map(({ method, path, handler }) => [
      routeKey(method, path),
      handler,
    ]),
  );

  return async function route(request, response, pathname) {
    const handler = routesByKey.get(routeKey(request.method, pathname));

    if (!handler) {
      return false;
    }

    await handler(request, response);
    return true;
  };
}

module.exports = {
  createRouter,
};
