# Test Plan

## Purpose

This plan protects one synthetic SaaS revenue journey: authenticate, load the
server-owned catalogue, build a temporary cart, tokenize a fake payment outcome,
and submit an idempotent order. It prioritizes business risk rather than a target
test count or coverage percentage.

The [research basis](references.md#scientific-evidence) supports isolation,
condition-based synchronization, and skepticism toward coverage-only claims. It
does not prove this repository is free of flaky behavior.

## Commercial regression contracts

`regressions/manifest.json` is the executable authority. Each fault maps to one
durable Playwright test ID and one exact `RFG:` assertion signature.

| Fault ID | Revenue risk | Canonical test ID |
|---|---|---|
| `AUTH_BYPASS` | Protected catalogue data is exposed without a server session. | `tests/api/catalog.spec.ts › GET /api/products requires a known session and leaks no catalogue data` |
| `CLIENT_PRICE_TRUST` | A browser-controlled amount changes the order total. | `tests/api/orders.spec.ts › POST /api/orders enforces exact top-level and item fields and forbids client prices or totals` |
| `DUPLICATE_ORDER` | Replaying an idempotency key creates another order. | `tests/api/orders.spec.ts › a successful order uses canonical item order, server totals, an opaque id, and replays exactly once` |
| `EMPTY_CART_ACCEPTED` | An empty purchase is accepted. | `tests/api/orders.spec.ts › POST /api/orders maps empty, duplicate, unknown, and invalid-quantity items to INVALID_ITEMS without stock changes` |
| `PAYMENT_DECLINE_HIDDEN` | A declined payment is presented as a successful order. | `tests/ui/checkout.spec.ts › safe demonstration checkout › shows a declined-payment message, preserves the cart, and uses a new key for a new attempt` |
| `SUBMIT_CONTROL_MISSING` | A pending order can be submitted repeatedly. | `tests/ui/checkout.spec.ts › safe demonstration checkout › disables every submission path while the first order is pending` |

`npm run verify:quality` first runs the normal baseline with retries disabled,
then activates each fault in isolation. A proof is rejected if the mapped test
does not fail, if the exact signature is absent, if another test fails, or if
infrastructure prevents a trustworthy result.

## Defense-in-depth suites

| Surface | What is checked |
|---|---|
| Session | Cookie attributes, invalid credentials, expiry, invalidation, and capacity behavior. |
| Catalogue | Authentication, stable server data, keyboard interaction, responsive controls, and fresh cart state. |
| Payment token | Authentication, strict input, opacity, expiry, capacity, and single use. |
| Order | Canonical hashing, server totals, stock, idempotency conflict, replay, decline, transient retry, and capacity. |
| HTTP boundary | Body size, media type, malformed JSON, error envelopes, hidden test controls, and not-found behavior. |
| Public runtime | Exact evidence schema, commit binding, no-store responses, escaped publication fields, and fail-closed fallback. |
| Case study | Static content, valid/unavailable evidence, keyboard focus, mobile layout, overflow, and browser zoom. |
| Repository policy | Regression mappings, route coverage, workflow pins, docs claims, script reachability, and unused fixtures. |

## Execution policy

- Normal test state is isolated per test.
- User-facing locators and web-first assertions are preferred.
- Fixed sleeps are forbidden.
- Deterministic barriers coordinate intentionally pending operations.
- The authoritative local proof uses retries disabled and one worker.
- Pull requests gate on Chromium; the scheduled/manual baseline adds Firefox and
  WebKit without publishing new evidence.
- Raw traces, reports, cookies, headers, credentials, and workspace paths are not
  public artifacts.

These choices follow the current [Playwright guidance](references.md#framework-authority)
and the limitations described in the [scientific evidence](references.md#scientific-evidence).

## Acceptance

The repository is release-ready only when the commands in the
[QA evidence guide](qa-report.md#reproduction) succeed on the commit being
published, the promoted manifest is complete and sanitized, and the case study
reads that same commit-bound evidence. A retry-pass is not accepted as proof.
