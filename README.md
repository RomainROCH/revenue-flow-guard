# Revenue Flow Guard

Revenue Flow Guard is a local Playwright demonstration for a revenue-critical SaaS journey. The current repository contains the Milestone 1 application and baseline test surfaces: sign-in, protected catalog access, cart management, fake checkout outcomes, and order confirmation.

## Implemented scope

- Server-side sessions delivered through an `HttpOnly`, `SameSite=Strict` cookie.
- Session checks before protected dashboard or checkout content is rendered.
- An authenticated catalog with integer-cent prices and server-owned stock.
- A browser-local temporary cart; authentication state is never stored in `localStorage`.
- Approved, declined, and temporary-failure payment demonstrations using opaque fake tokens. No card number or real payment data is accepted.
- Server-calculated order totals, stock validation, and idempotent order submission.
- API and browser tests backed by an isolated in-memory HTTP application for each test.
- Deterministic barriers for session and in-flight order behavior without fixed sleeps.

This README does not report test results. Run the relevant command below to establish evidence for the current checkout.

## Quick start

```bash
npm install
npx playwright install chromium
npm test
```

To run the application without the test runner:

```bash
npm run serve
```

Use the demonstration credentials `demo` / `demo`. The application and all payment outcomes are synthetic and local.

## Commands

These are the scripts currently defined in `package.json`.

| Command | Purpose |
|---|---|
| `npm run serve` | Start the local Node HTTP application. |
| `npm run lint` | Run ESLint with warnings treated as failures. |
| `npm run typecheck` | Type-check the Playwright and TypeScript surfaces without emitting files. |
| `npm test` | Run the complete Playwright suite. |
| `npm run test:api` | Run the API contract suite. |
| `npm run test:ui` | Run the browser behavior suite. |
| `npm run test:repeat` | Run the complete suite three times with retries disabled. |

## Architecture

```text
app/                    Browser UI and styling
src/
  create-application.js HTTP routing and static serving
  domain/               Sessions, catalog, fake payments, and orders
tests/
  api/                  HTTP and domain-boundary contracts
  ui/                   User-observable browser journeys
  fixtures/             Per-test application, session, and barrier behavior
server.js               Standalone local entry point
playwright.config.ts    Playwright project configuration
docs/superpowers/       Accepted design and implementation plans
```

The browser sends only product identifiers, quantities, and an opaque fake payment token when it creates an order. The server recomputes the total and owns idempotency, token consumption, and stock changes. Test fixtures start a fresh server and browser context so mutable state is not shared between tests.

## Security and test posture

- Protected APIs validate the server-side session cookie.
- Invalid input and controlled failures use stable JSON error envelopes.
- Request bodies are bounded, and unexpected failures do not return stack traces.
- Checkout never renders a PAN or card-data field.
- A synchronous browser guard and disabled controls prevent repeated submission while an order is pending.
- UI tests use roles, labels, text, or explicit test IDs; they do not use fixed sleeps.
- Authentication artifacts are not required by the suite and are not kept in the repository.

This is a demonstration boundary, not a production security or identity implementation.

## Current limitations

- Runtime state is local and in memory; restarting the server clears sessions, stock changes, tokens, and orders.
- Authentication uses fixed demonstration credentials and does not include password hashing, account recovery, MFA, or durable sessions.
- Payment processing is entirely fake and has no third-party integration.
- The configured browser project is Chromium only.
- There is no hosted public URL or production telemetry.
- Regression-fault evidence, authoritative CI workflows, the commercial case study, and publication gates belong to later milestones and are not claimed here.

## Authority and next plans

- [Accepted design](docs/superpowers/specs/2026-07-11-revenue-flow-guard-design.md)
- [Milestone 1 — Secure revenue flow](docs/superpowers/plans/2026-07-11-milestone-1-secure-revenue-flow.md)
- [Milestone 2 — Regression proof and CI evidence](docs/superpowers/plans/2026-07-11-milestone-2-regression-proof-ci.md)
- [Milestone 3 — Case study and publication](docs/superpowers/plans/2026-07-11-milestone-3-case-study-publication.md)
- [Codex Sites publication appendix](docs/superpowers/plans/2026-07-11-codex-sites-publication-appendix.md)
