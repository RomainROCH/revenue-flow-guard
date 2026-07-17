export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/__rfg/hosting-compatibility') {
      if (request.method !== 'GET') {
        return new Response(null, { status: 405 });
      }
      return new Response(
        '{"schemaVersion":1,"kind":"rfg-sites-worker","status":"ok"}',
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          },
        },
      );
    }
    return env.ASSETS.fetch(request);
  },
};
