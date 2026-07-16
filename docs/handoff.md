# Client Handoff

## Outcome

Reuse the risk model, proof pipeline, and evidence boundary. Replace the
synthetic product assumptions with client-owned contracts before any real user,
credential, order, or payment data enters the system.

## Adaptation sequence

### 1. Establish ownership and acceptance

Name the revenue journey, business owner, environments, supported browsers,
release gate, incident path, and proof retention policy. Convert each material
risk into an observable contract before changing test code.

### 2. Replace the application boundary

Point Playwright at a controlled staging environment or start the client's app
through `webServer`. Remove the synthetic server only after equivalent health,
session, catalogue, payment, and order contracts exist. Do not expose test-control
routes on a public interface.

### 3. Integrate authentication safely

Use a dedicated least-privilege test identity. Prefer API-assisted setup when it
exercises the same trust boundary. Keep storage state and credentials out of Git,
public reports, screenshots, traces, and logs. Validate logout, expiry, and access
revocation against the real identity system.

### 4. Control data and tenancy

Provision unique test data per worker or test. Make cleanup idempotent. Verify
tenant isolation before parallel execution. A reset endpoint must be authenticated,
environment-gated, auditable, and unreachable from production traffic.

### 5. Replace synthetic payment behavior

Use the processor's sandbox tokens and documented test modes. Never collect or
store real card data in this suite. Keep totals server-owned and preserve
idempotency across browser, API, processor, and persistence boundaries.

### 6. Re-map regression proof

Keep fault injection deterministic and scoped. Update `regressions/manifest.json`
so every client risk has one durable test ID and exact signature. A synthetic
fault is demonstration evidence; validate production relevance with incidents,
domain experts, and staging behavior.

### 7. Harden CI and observability

Use immutable action pins, read-only repository permissions, controlled secrets,
one-worker proof, and no browser-binary cache. Keep private debugging artifacts
behind restricted retention. Add client-approved logs, traces, and release alerts
without copying sensitive payloads.

### 8. Publish only sanitized evidence

Bind evidence to the deployed commit and immutable CI run. Keep publication
configuration all-or-nothing and HTTPS-only. Run the secret scanner against both
tracked files and the exact public artifact allowlist.

## Required validation

Before handoff, run:

```bash
npm run validate:docs
npm run validate:repo
npm run validate:workflows
npm run lint
npm run typecheck
npm run verify:quality
npm run build:evidence
npm run validate:public-artifacts
npm run scan:secrets
```

Then execute client-specific smoke checks against the deployed URL and confirm
that rollback does not leave mismatched code and evidence.

## Stop conditions

Do not publish or connect real systems when ownership is unclear, staging data
cannot be isolated, fault injection can escape its environment, a secret appears
in public output, evidence is not commit-bound, or a retry is required to obtain
a passing release gate.

The [test plan](test-plan.md) owns the current risk contracts. The
[QA evidence guide](qa-report.md) owns reproduction and artifact interpretation.
The [references](references.md) define what the external guidance and research do
and do not support.
