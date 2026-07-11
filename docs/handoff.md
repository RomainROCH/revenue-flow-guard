# Handoff Guide — Playwright E2E Demo Pack

## Status

Ready to branch into a real project. The demo pack runs self-contained on a local mini-app. To use it against a real project, follow the adaptation guide below.

## Prerequisites

- Node.js LTS (20.x or later)
- npm 10.x or later
- Playwright browsers: `npx playwright install chromium`

## Essential commands

```bash
npm install              # Install dependencies
npm run serve            # Start the demo app (port 8080)
npm test                 # Run all tests headlessly
npm run test:headed      # Run with visible browser
npm run test:ui          # Playwright UI mode
npm run lint             # ESLint (v9 flat config)
npx playwright show-report  # View HTML report
```

## Adapting to a real project

### 1. Replace the target URL

In `playwright.config.ts`, update `baseURL` and `webServer`:

```ts
use: {
  baseURL: 'https://your-staging-app.com',
},
// Remove webServer if you have a live staging environment
```

### 2. Update credentials

In `tests/auth.setup.ts`, replace the login flow with your own authentication steps (or use API-based auth).

### 3. Update locators

Replace locators in `tests/fixtures.ts` and spec files to match your application's DOM. Follow the locator priority:
`getByRole` > `getByLabel` > `getByText` > `getByTestId`

### 4. Replace API mocking

For the happy-path tests, remove `page.route()` and let tests hit your real API. Keep `page.route()` only for error-scenario tests.

### 5. Database isolation

If your app uses a database, add a reset endpoint (like `POST /api/reset` in `server.js`) or use the `beforeEach` hook to clean data. Use `test.use({ storageState: { cookies: [], origins: [] } })` for tests that need a clean state.

### 6. Multi-browser

Uncomment the Firefox and WebKit projects in `playwright.config.ts` to test across browsers.

## File adaptation map

| File | What to change |
|---|---|
| `playwright.config.ts` | baseURL, webServer, browsers |
| `tests/auth.setup.ts` | Login flow, credentials |
| `tests/auth.spec.ts` | Locators, expected state after login |
| `tests/dashboard.spec.ts` | Locators, expected product count |
| `tests/checkout.spec.ts` | Form fields, order confirmation selector |
| `tests/fixtures.ts` | Page object locators |
| `eslint.config.mjs` | Files scope |
| `.github/workflows/playwright.yml` | Node version, browser selection |

## Limitations

- Chromium-only starter — add Firefox/WebKit by uncommenting projects in the config
- No real database — uses server.js in-memory state
- 8 tests — per the 70/20/10 pyramid, this pack covers only E2E tests
- No visual regression tests — can be added with `toHaveScreenshot()`

## Next steps

1. ✅ Run `npm test` to verify the demo pack works
2. Branch into your real project
3. Replace the target app and adapt locators
4. Add Firefox and WebKit browser coverage
5. Set up CI secrets for staging credentials
6. Add visual regression tests for critical pages
7. Scale test count gradually — never exceed 10-15% of overall test suite

## References

- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [Playwright Authentication](https://playwright.dev/docs/auth)
- [Playwright Mock APIs](https://playwright.dev/docs/mock)
- [Playwright Web Server](https://playwright.dev/docs/test-webserver)
- Luo et al. (2014) — An Empirical Analysis of Flaky Tests
- Micco (2016) — Flaky Tests at Google and How We Mitigate Them
- Wacker (2015) — Just Say No to More End-to-End Tests (Google)
- Fowler (2012) — Test Pyramid
