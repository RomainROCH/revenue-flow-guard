# Test Plan — Playwright E2E Demo Pack

## Scope

This pack covers the top 10% of the test pyramid (Wacker 2015; Fowler 2012). It validates 3 critical business flows through E2E browser tests. Unit and integration tests are outside scope — this pack is designed to complement an existing lower-level test suite.

## Test matrix

| Spec | Flow | Tests | Browser | Environment |
|---|---|---|---|---|
| auth.spec.ts | Authentication | 3 | Chromium | Local (webServer) + CI (ubuntu-latest) |
| dashboard.spec.ts | Product browsing | 2 | Chromium | Local (webServer) + CI (ubuntu-latest) |
| checkout.spec.ts | Purchase checkout | 3 | Chromium | Local (webServer) + CI (ubuntu-latest) |
| **Total** | **3 flows** | **8 tests** | **1 browser** | **2 environments** |

## Test scenarios

### Auth — `auth.spec.ts`

| Test | Given | When | Then | Risk covered |
|---|---|---|---|---|
| Login valid | User is on login page | Fills correct credentials and submits | Dashboard visible, URL has #dashboard | Auth bypass |
| Login invalid | User is on login page | Fills wrong credentials and submits | Error message "Invalid credentials" visible | Unauthorized access |
| Logout | User is authenticated on dashboard | Clicks Logout | Login page visible, session cleared | Session fixation |

### Dashboard — `dashboard.spec.ts`

| Test | Given | When | Then | Risk covered |
|---|---|---|---|---|
| Product catalog | User is authenticated | Dashboard loads | 3 product cards (role=article) visible | Empty state / missing products |
| Add to cart | Product card is visible | Clicks "Add to Cart" | Cart badge shows count 1 | Cart not updating |

### Checkout — `checkout.spec.ts`

| Test | Given | When | Then | Risk covered |
|---|---|---|---|---|
| Full checkout | Product in cart, on checkout page | Fills valid form, clicks Place Order | Order confirmation visible with order number | Checkout broken |
| Form validation | Product in cart, on checkout page | Clicks Place Order with empty fields | Validation error "Please fill in all fields" visible | No feedback on bad input |
| Network failure | Product in cart, on checkout page | Fills valid form, API returns 500 | Error message "could not place your order" visible | No error handling |

## Prerequisites

- Node.js LTS (20.x or later)
- npm 10.x or later

## Environment configuration

Tests run against a local web server (`server.js`, port 8080) started automatically by Playwright's `webServer` config. In CI, `reuseExistingServer` is disabled (fresh server each run).

## Acceptance criteria per test

All assertions use web-first matchers (`toBeVisible`, `toHaveText`, `toHaveURL`) with Playwright's auto-retry. Zero `waitForTimeout` calls. Each test must pass 3 consecutive runs without flaky failures.

## Flakiness mitigation strategy

- Fresh `BrowserContext` per test (isolated cookies, storage, session)
- `retries: 2` in CI, `0` locally
- `trace: 'on-first-retry'` for debugging
- `page.route()` for deterministic API data
- No external service dependencies
- Server state reset via `POST /api/reset` available if needed
- ESLint rules enforce no-wait-for-timeout and prefer-web-first-assertions

## References

- Luo et al. (2014) — Flaky test root cause analysis (FSE)
- Lam et al. (2020) — Flaky test lifecycle (ICSE)
- Liu et al. (2024) — WEFix: auto-wait reduces flakiness 73% (WWW)
- Soares et al. (2020) — Test smells prevalence (MSR)
- Micco (2016) — Google flaky test mitigation
- Ziftci & Cavalcanti (2020) — Automated flaky test root cause clustering (ICST)
