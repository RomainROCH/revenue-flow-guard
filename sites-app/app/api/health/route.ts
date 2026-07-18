const HEALTH_BYTES =
  '{"data":{"status":"ok","version":1,"testMode":false},"error":null}';

export async function GET() {
  return new Response(HEALTH_BYTES, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
