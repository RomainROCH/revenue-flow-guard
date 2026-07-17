# Revenue Flow Guard

[![Revenue Flow Guard CI](https://github.com/RomainROCH/revenue-flow-guard/actions/workflows/playwright.yml/badge.svg?branch=main)](https://github.com/RomainROCH/revenue-flow-guard/actions/workflows/playwright.yml?query=branch%3Amain)

Revenue Flow Guard is a productized Playwright case study for a revenue-critical
SaaS journey. It combines a secure synthetic checkout, deterministic regression
injection, fail-closed public evidence, and reproducible CI policy.

Open the [commercial case study](app/case-study.html) to see the buyer-facing
story. Use this README as the canonical repository entrypoint.

## What it proves

- The browser never owns authentication, price, stock, payment outcome, or order
  idempotency decisions.
- Six named revenue regressions are injected one at a time and must trigger one
  exact test signature.
- Public evidence is accepted only when its commit, gates, regression set, and
  sanitization state satisfy the versioned schema.
- Pull requests use a deterministic Chromium gate. A separate scheduled/manual
  workflow checks Chromium, Firefox, and WebKit.
- The public case study remains useful without JavaScript and fails closed when
  live evidence is missing, malformed, or stale.

This is a competitive demonstration boundary, not a claim that a synthetic app
is equivalent to a client's production system.

## Quick start

```bash
npm ci
npx playwright install chromium
npm test
```

Start the application separately when you want to explore it:

```bash
npm run serve
```

Use the synthetic credentials `demo` / `demo`. The payment scenarios are fake;
the application does not accept card data.

## Release-confidence gate

Run the repository and documentation policies before the quality proof:

```bash
npm run validate:docs
npm run validate:repo
npm run validate:workflows
npm run lint
npm run typecheck
npm run test:repeat
npm run verify:quality
npm run build:evidence
npm run validate:public-artifacts
npm run scan:secrets
```

Generated evidence is ignored by Git and must be rebuilt from the commit being
published. A successful build produces only the allowlisted public files; the
validation and secret-scan reports remain separate.

For the scheduled browser baseline, install the additional engines and run:

```bash
npx playwright install firefox webkit
npx playwright test tests/api tests/ui --config=playwright.cross-browser.config.ts --retries=0 --workers=1
```

## Repository map

```text
app/                    Product UI and commercial case study
src/                    HTTP application and server-owned domain rules
tests/api/              HTTP and domain-boundary contracts
tests/ui/               User-observable browser journeys
tests/meta/             Regression and route contract manifests
tests/scripts/          Evidence, policy, and repository validator tests
regressions/            Canonical commercial regression manifest
scripts/                Quality, evidence, sanitization, and policy executables
.github/workflows/      Pull-request and scheduled quality gates
docs/                   Maintained operating documentation and references
docs/superpowers/       Accepted design and historical execution plans
```

The browser sends product identifiers, quantities, and an opaque synthetic
payment token. The server recomputes totals and owns token consumption, stock
changes, and idempotency. Each normal test starts isolated application state.

## Maintained documentation

- [Test plan](docs/test-plan.md) — risk-to-test contracts and execution policy.
- [QA evidence guide](docs/qa-report.md) — how to reproduce and interpret
  commit-bound evidence.
- [Client handoff](docs/handoff.md) — how to replace synthetic boundaries safely.
- [References](docs/references.md) — the primary framework and research basis.

The [accepted design](docs/superpowers/specs/2026-07-11-revenue-flow-guard-design.md)
owns the product and evidence contracts. The maintained documents above describe
the current implementation; execution plans are not present-state authority.

## Current limitations

- Runtime state is in memory and disappears when the server restarts.
- Authentication uses fixed demonstration credentials rather than a production
  identity provider.
- Payment processing is synthetic and has no processor integration.
- There is no production telemetry, persistent database, or multi-tenant model.
- Publication metadata and hosting remain external deployment inputs.

Use the [handoff guide](docs/handoff.md) before adapting this repository to real
customer data, credentials, or payment infrastructure.
