# Sites vinext commercial adapter design

**Status:** Accepted for implementation

**Authority:** User-approved publication goal, verified Sites deployment failure, and current Sites/vinext contracts

**Supersedes for deployment:** `2026-07-17-sites-artifact-compatibility-design.md`

## Decision

Publish Revenue Flow Guard on Codex Sites as a server-rendered commercial case study backed by the exact GitHub CI evidence for its source commit. Build the hosted surface with an isolated vinext App Router workspace that emits `dist/server/index.js`.

Keep the existing Node checkout application and its security/regression suite canonical and unchanged. Do not expose a partial hosted checkout, account, payment, or session API until the complete revenue flow has authoritative cross-request storage and preserves the existing contracts.

## Verified facts

- Sites version 3 rejected the Cloudflare Pages advanced-mode artifact before execution with `missing dist/server/index.js`.
- The current Sites save contract accepts OpenNext or vinext entrypoints and requires a compatible artifact plus `.openai/hosting.json` or App Garden metadata inside `dist`.
- A clean-room probe using vinext `1.0.0-beta.2`, React `19.2.7`, and Vite `8.1.5` built in about 5.7 seconds, passed `vinext check`, served HTTP `200`, and exported the expected two-argument Fetch handler from `dist/server/index.js`.
- A follow-up probe called the same imported handler twice without rebuilding. A request-time `process.env.PROBE_VALUE` read returned `process-first` and then `process-second`; vinext did not inline the value. Plain `{ PROBE_VALUE }` and `{ env: { PROBE_VALUE } }` second arguments were ignored because that argument is a Worker execution context and is accepted only when it exposes `waitUntil()`.
- `cloudflare:workers` does not resolve in the minimal vinext build without adding the Cloudflare Vite plugin and changing the artifact shape. It is unnecessary for Sites text environment values and is excluded from this adapter.
- The probe installed 152 packages with zero reported vulnerabilities. Its output did not copy `.openai/hosting.json`; the repository build must do so explicitly.
- The existing case study already provides the approved offer, responsive layout, focus styling, limitations, and commit-bound evidence presentation.
- The existing external smoke contract includes `/api/session`. Removing that assertion from the Node deployment profile would weaken the canonical interactive-demo contract.

Sources: [Codex Sites](https://learn.chatgpt.com/docs/sites), [vinext](https://github.com/cloudflare/vinext).

## Product boundary

### Hosted now

- `/` and `/case-study.html`: the same buyer-facing case study.
- `/api/health`: an exact public health contract.
- `/evidence/latest.json`: the raw exact evidence only when it is complete, sanitized, and bound to `SOURCE_COMMIT_SHA`.
- GitHub source, exact CI-run link, and approved contact CTA.
- A controlled `404` for unknown routes, including unimplemented account and payment APIs.

### Explicitly not hosted

- Authentication or durable sessions.
- Product catalogue, payment-token, or order mutation APIs.
- The synthetic interactive checkout UI.
- Test-control or fault-injection endpoints.

The page must say: “This hosted case study publishes commit-bound CI evidence. The synthetic checkout remains a local/source demonstration and is not exposed as a public account or payment service.”

## Why this shape

| Option | Commercial signal | Technical truthfulness | Cost/risk | Decision |
|---|---:|---:|---:|---|
| Static fallback only | Medium | High | Low | Reject: Sites still requires a supported server artifact and the evidence would not be runtime-bound. |
| Partial session or checkout port | Superficially high | Low | High | Reject: isolate-local state or a stateless cookie changes the demonstrated guarantees. |
| Full Node rewrite now | High | Potentially high | Very high | Defer: large unrelated regression surface before the first sale. |
| vinext commercial case study | High | High | Moderate | Accept: live proof and CTA without pretending the full app is hosted. |

## Architecture

```text
existing Node demo + full test suite (canonical, unchanged)
                         |
                         | shared regression manifest + approved copy/CSS
                         v
sites-app/ vinext App Router
  -> server-rendered case study
  -> /api/health
  -> /evidence/latest.json
                         |
                         v
sites-app/dist --verified copy--> root dist
                                + dist/.openai/hosting.json
                                -> Codex Sites
```

`sites-app` is an npm workspace with exact dependency pins. The root build typechecks both projects, prepares the existing `app/style.css` as a generated public asset, runs `vinext build`, verifies required output, replaces only the root `dist`, and copies `.openai/hosting.json` into the artifact.

The hosted adapter owns its TypeScript runtime parsers. It imports the canonical `regressions/manifest.json` instead of duplicating fault identifiers. Parity tests require every value rejected by the existing CommonJS parsers to remain rejected and every exact-repository CI value accepted by them to remain accepted. The Sites publication gate is intentionally stricter than the Node parser: local evidence and evidence from another GitHub repository remain valid for local Node workflows but are rejected for the hosted commercial proof.

The adapter reads `process.env` inside request handlers and server rendering, never at module initialization. Before UI implementation, a built-handler gate must call the same imported `dist/server/index.js` twice without a rebuild, change the evidence environment between calls, and require two different controlled responses. Do not use the handler context as an environment object or add `cloudflare:workers`.

## Exact runtime contracts

### Public configuration

Publication is ready only when:

- contact URL is HTTPS with no credentials;
- contact label and offer name are trimmed, non-empty, at most 80 characters;
- offer summary is trimmed, non-empty, at most 240 characters.

Invalid configuration renders only the existing publication-missing fallback and never reflects the rejected value.

### Public evidence

`/evidence/latest.json` returns status `200`, the raw exact manifest, `Cache-Control: no-store`, `Content-Type: application/json; charset=utf-8`, and `X-Content-Type-Options: nosniff` only when the current canonical evidence contract passes and:

- `ciRunId` is a non-null positive decimal string;
- `ciRunUrl` is exactly `https://github.com/RomainROCH/revenue-flow-guard/actions/runs/<ciRunId>`;
- the evidence SHA equals `SOURCE_COMMIT_SHA`.

Otherwise it returns status `503`, the existing non-reflective `EVIDENCE_UNAVAILABLE` envelope, and the same no-store/content-type/nosniff headers.

The HTML uses the evidence commit only when evidence is valid. Otherwise `data-source-commit="unavailable"` and the evidence panel reads `Evidence unavailable or incomplete`.

### Health

`GET /api/health` returns status `200` and exactly:

```json
{"data":{"status":"ok","version":1,"testMode":false},"error":null}
```

with JSON UTF-8 and `nosniff` headers.

## UI target contract

- **Routes:** `/`, `/case-study.html`.
- **Viewports:** 1280×720 and Pixel 7; 200% zoom remains usable.
- **Primary task:** inspect commit-bound proof, then contact Romain or inspect the source.
- **Ready state:** approved offer/contact plus exact CI evidence and CI link.
- **Unavailable state:** non-reflective evidence/config fallback.
- **Loading:** not applicable; evidence is server-rendered.
- **Empty/error:** collapsed into the explicit unavailable state.
- **Disabled:** not applicable; there is no form or mutation.
- **Focus:** preserve the existing visible focus tokens.
- **Responsive:** preserve the existing case-study breakpoints and no-overflow contract.

UI reuse authority is `app/case-study.html` and the case-study token section of `app/style.css`. The adapter may translate semantic markup into TSX but must not invent a second visual system or icon package.

## Validation lanes

- **Component/contract:** parser parity and build-artifact tests.
- **Runtime:** two calls to the built Fetch handler without rebuild prove environment propagation; Playwright against `vinext start` proves the valid browser profile. Invalid values are covered at parser, handler, and response level without requiring a second concurrent server.
- **Browser:** desktop, Pixel 7, JavaScript-disabled, keyboard focus, 200% zoom, and screenshots.
- **Public:** exact saved-version SHA, environment revision, routes, headers, evidence, and absence of hosted session/payment APIs.

The existing `tests/smoke/public.spec.ts` remains the Node interactive profile. A separate `tests/sites-public` tree, ignored by the default Playwright config and owned by `playwright.sites-public.config.ts`, protects the hosted commercial profile only after deployment.

## Failure and stop conditions

- Stop if `vinext check` is not fully compatible.
- Stop if the artifact lacks `dist/server/index.js`, `dist/client`, or `dist/.openai/hosting.json`.
- Stop if runtime environment changes require rebuilding or are exposed to the client.
- Stop if two calls to the same built handler cannot observe different runtime values without rebuilding.
- Stop if parser parity cannot be proven without weakening the existing contract.
- Stop if Sites rejects the verified vinext artifact; preserve the exact failure and evaluate OpenNext or external hosting as a separate decision.
- Do not retry an unchanged failed version.

## Assumptions and uncertainty

The least-certain point is Sites’ undocumented internal validation after the known file gate. The clean-room handler and current save contract make vinext the strongest supported candidate, but only a saved/deployed version can prove end-to-end acceptance.
