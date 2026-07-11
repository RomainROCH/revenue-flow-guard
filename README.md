# Playwright E2E Test Pack — Demo

A self-contained, evidence-based End-to-End testing demo for Playwright. Covers 3 business-critical flows (auth, dashboard, checkout) on a local mini-app — no third-party dependencies, no flaky waits, one command to run.

## Before (typical state)

- No automated E2E coverage
- Manual testing required before each change
- Regressions easy to miss

## After (this pack)

- 3 critical user flows covered + 1 failure-path scenario (8 tests total)
- One command to run tests locally: `npm test`
- CI workflow ready — runs on every push and pull request
- Clear handoff docs — test plan, QA report, and handoff guide

## Quick start

```bash
npm install
npx playwright install chromium
npm test
```

## Why these choices

Every design decision is anchored to peer-reviewed literature and Playwright official best practices.

| Rule | Source |
|---|---|
| Zero `waitForTimeout` — auto-wait + web-first assertions | Luo et al. FSE 2014; Liu et al. WWW 2024 (73% flakiness reduction) |
| Locators: `getByRole` > `getByLabel` > `getByText` > `getByTestId`; never CSS/XPath | Leotta et al. ICST 2016; Baresi et al. 2020 (85–95% survival vs 45–65%) |
| Fresh browser context per test; no `test.describe.serial` | Micco 2016 (Google); Lam et al. ICSE 2020 |
| Auth via setup project + `storageState`; `.auth/` in `.gitignore` | Playwright auth doc |
| E2E = top 10% of pyramid (70/20/10); only 3 critical flows | Wacker 2015; Fowler 2012 |
| POM-lean via Playwright fixtures, not monolithic page objects | Playwright 2024; Leotta et al. 2013 |
| `webServer` config (`command`/`url`/`reuseExistingServer`) | Playwright test-webserver doc |
| `page.route()` only for error scenarios, not happy paths | Playwright Mock APIs doc |
| CI: `retries: 2` in CI, `trace: on-first-retry`, chromium-only + cache | Playwright + Ziftci/Cavalcanti 2020 |
| Lint: ESLint v9 flat config enforcing Playwright rules | Soares et al. MSR 2020 (test smells) |

## Project layout

```
playwright-e2e-pack-demo/
  package.json
  playwright.config.ts
  server.js              # node:http — static serving + 3 API routes
  eslint.config.mjs      # ESLint v9 flat config
  .gitignore
  README.md
  app/
    index.html           # Mini SPA: login, dashboard, checkout
    app.js               # Vanilla JS with fetch to /api/*
    style.css
  tests/
    auth.setup.ts        # Setup project: login → storageState
    auth.spec.ts         # 3 tests (2 describe blocks, logged-out/in)
    dashboard.spec.ts    # 2 tests (product list, add to cart)
    checkout.spec.ts     # 3 tests (full flow, validation, network failure)
    fixtures.ts          # POM-lean page object fixtures
  .github/workflows/
    playwright.yml        # Optimized GitHub Actions workflow
  docs/
    test-plan.md         # Scope, Gherkin scenarios, acceptance criteria
    qa-report.md         # Metrics, matrix, flaky triage strategy
    handoff.md           # Adapt-to-project guide, references
```

## Commands

| Command | Purpose |
|---|---|
| `npm test` | Run all tests headlessly (CI mode) |
| `npm run test:headed` | Run tests with browser visible |
| `npm run test:ui` | Run tests with Playwright UI mode |
| `npm run test:debug` | Run tests with Playwright Inspector |
| `npm run lint` | Run ESLint (v9 flat config) |
| `npm run serve` | Start the local demo app standalone |
| `npx playwright show-report` | View the HTML test report |

## CI

The included `.github/workflows/playwright.yml` workflow runs tests on push and pull requests to `main`. It:
- Caches npm dependencies and Playwright browsers
- Installs Chromium only (fastest CI setup)
- Records traces on first retry for debugging
- Uploads the HTML report as a build artifact (30-day retention)

[![Playwright Tests](https://github.com/REPO_OWNER/playwright-e2e-pack-demo/actions/workflows/playwright.yml/badge.svg)](https://github.com/REPO_OWNER/playwright-e2e-pack-demo/actions/workflows/playwright.yml)

## Business risks covered

- **Auth**: Unauthorized users must not access the app; valid users must reach the dashboard.
- **Dashboard**: Users cannot browse products or start the buying flow — no revenue initiated.
- **Checkout**: Users cannot complete a revenue-generating purchase, including during backend failure.

## Avoided anti-patterns

- No `page.waitForTimeout()` or fixed sleeps
- No CSS/XPath selectors
- No `test.describe.serial` or shared mutable state
- No third-party service dependencies
- No happy-path-only testing (network failure covered)
- No `.eslintrc` (legacy format — using ESLint v9 flat config)

## Limitations

- Chromium-only starter (Firefox/WebKit ready with config change)
- No real database — in-memory state on server.js
- 8 tests — intentional for the 70/20/10 pyramid
- Not a replacement for unit/integration tests

## References

- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [Playwright Authentication](https://playwright.dev/docs/auth)
- [Playwright Mock APIs](https://playwright.dev/docs/mock)
- [Playwright Web Server](https://playwright.dev/docs/test-webserver)
- Luo et al. (2014) — An Empirical Analysis of Flaky Tests (FSE)
- Liu et al. (2024) — WEFix: Intelligent Automatic Generation of Explicit Waits (WWW)
- Leotta et al. (2016) — Visual vs. DOM-Based Web Locators (ICST)
- Baresi et al. (2020) — On the Resilience of Web Test Locators (ICSOC)
- Soares et al. (2020) — Test Smells in Selenium Scripts (MSR)
- ReproBreak (2026) — A Dataset of Reproducible Web Locator Breaks (arXiv)
- Micco (2016) — Flaky Tests at Google and How We Mitigate Them
- Wacker (2015) — Just Say No to More End-to-End Tests (Google)
- Fowler (2012) — Test Pyramid (martinfowler.com)
- Ziftci & Cavalcanti (2020) — De-Flake Your Tests at Google (ICST)
