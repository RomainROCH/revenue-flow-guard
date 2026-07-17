# Codex Sites Artifact Compatibility Design

**Status:** Accepted under the user's delegated decision mandate and public-deployment approval

**Decision:** Prove Codex Sites' dynamic `dist` contract with a fallback-safe deployment before porting the complete Node HTTP adapter. Preserve the accepted Revenue Flow Guard behavior and evidence contracts.

## Goal

Produce a Codex Sites-compatible `dist` artifact without weakening the public commercial proof or rewriting the application around an unverified framework assumption.

Success has two gates:

1. a public compatibility deployment serves a truthful static case-study fallback and proves that a module worker handles a dedicated probe route;
2. the final deployment passes the repository's existing external smoke suite, including secure session-cookie behavior.

## Evidence and Uncertainty

Known facts:

- Sites ran `npm install`, ran `npm run build`, then attempted to copy `dist`.
- The current build passed type checking but produced no `dist`, causing the exact failure `cp: cannot stat 'dist': No such file or directory`.
- Official Sites guidance requires compatible deployment artifacts and warns that some frameworks and hosting patterns are unsupported.
- Official Cloudflare Pages documentation supports a module-format `dist/_worker.js`, runtime environment bindings, and static assets through `env.ASSETS.fetch`.
- Every Sites deployment URL is production.

Unproven assumption:

- Codex Sites may recognize Cloudflare Pages advanced-mode `_worker.js`. The Cloudflare capability does not prove the Sites integration supports it.

## Options

| Option | Benefit | Cost or risk | Decision |
|---|---|---|---|
| Worker-compatible `dist`, compatibility gate first | Preserves runtime configuration, evidence, cookies, and the interactive flow | Sites support is unproven; the Node adapter needs a bounded port | Selected |
| Static-only case study | Lowest hosting complexity | Drops the hosted interactive proof and secure-cookie smoke contract | Fallback only |
| OpenNext or vinext migration | Uses an explicitly mentioned archive shape | Large framework migration with no product benefit and substantial regression surface | Reject unless Sites explicitly requires it |

## Compatibility Deployment

The first new artifact is a platform probe, not the final application.

- `npm run build` must create a deterministic `dist` tree.
- The static root must remain a truthful, polished Revenue Flow Guard case study if the worker is ignored. It must not expose raw template tokens, claim live evidence, or present a broken interactive checkout.
- `dist/_worker.js` must implement `GET /__rfg/hosting-compatibility` and forward all other requests to static assets.
- The endpoint must return status `200`, `Content-Type: application/json; charset=utf-8`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and the exact body `{"schemaVersion":1,"kind":"rfg-sites-worker","status":"ok"}`. A static file at that path is forbidden, so this response proves worker execution rather than asset coincidence.
- No secrets, exact CI evidence, or temporary source credentials may be written into `dist` or Git.

Accept worker compatibility only when the saved version builds successfully and the public endpoint returns the exact worker response over HTTPS. A successful static root alone is insufficient.

## Final Runtime Adapter

Only after the compatibility gate passes:

- keep the existing Node server as the local and regression-test authority;
- add a fetch/Response adapter for Sites rather than replacing the domain services;
- preserve response bodies, status codes, headers, body limits, session semantics, idempotency, fake-payment boundaries, and evidence validation;
- obtain runtime offer, contact, source commit, and evidence values exclusively from Sites environment bindings;
- use ephemeral isolate-local state only because the accepted demo explicitly excludes persistent customer data and production identity;
- serve application assets through the platform asset binding and transform public HTML at response time;
- keep test-only control routes absent from the public worker.

The public worker may use a build-time compatibility shim for platform-neutral random bytes and SHA-256. It must not duplicate or weaken business validation.

## Validation

### Local compatibility gate

- a unit test fails before the build emits the exact `dist` contract;
- a local Cloudflare-compatible runtime test proves the probe route is executed by the worker, not served as a file;
- a fallback test confirms the static root contains no unresolved tokens or unsupported live-evidence claims;
- lint, type checking, repository validators, and the normal Node suite remain green.

### Production compatibility gate

- saved version source SHA equals the pushed Git SHA;
- deployment succeeds and returns an HTTPS URL;
- the dedicated probe returns the exact no-store worker response;
- root and case-study pages return `200` without horizontal overflow at desktop and Pixel 7 sizes.

### Final launch gate

- exact-commit GitHub CI evidence is green and validated;
- Sites environment bindings contain the matching source SHA and evidence JSON;
- the repository's external smoke tests pass against the final HTTPS URL, including `Secure`, `HttpOnly`, and `SameSite=Strict` on the session cookie;
- the full release check passes against that URL;
- a visual review finds no launch-blocking desktop or mobile defect;
- GitHub repository metadata points to the final live URL.

## Stop Conditions

Stop the worker path without speculative fixes when any of these occurs:

- Sites rejects the `dist/_worker.js` entrypoint or serves the compatibility path without executing the worker;
- the asset binding or runtime environment bindings are absent;
- the local runtime cannot preserve the accepted API and cookie contracts without broad domain rewrites;
- isolate-local state makes one ordinary interactive checkout unreliable;
- the public smoke suite requires weakening to pass.

If the compatibility gate fails, retain the truthful static case study, record the platform limitation, and choose between a static commercial launch or a separately planned supported-framework migration. Do not convert frameworks inside the failed deployment iteration.
