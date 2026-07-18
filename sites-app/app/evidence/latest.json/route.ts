import { parseSitesPublicEvidence } from '../../../lib/public-runtime';

const UNAVAILABLE_EVIDENCE_BYTES =
  '{"data":null,"error":{"code":"EVIDENCE_UNAVAILABLE","message":"Public evidence is unavailable."}}';

export async function GET() {
  const evidence = parseSitesPublicEvidence(process.env as Record<string, string | undefined>);

  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  };

  if (!evidence.available) {
    return new Response(UNAVAILABLE_EVIDENCE_BYTES, { status: 503, headers });
  }

  return new Response(JSON.stringify(evidence.evidence), { status: 200, headers });
}
