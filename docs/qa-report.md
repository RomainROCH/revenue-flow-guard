# QA Report — Playwright E2E Demo Pack

## Run summary

| Metric | Value |
|---|---|
| Date | 2026-07-09 |
| Environment | local (Windows) |
| Browser | Chromium 128 |
| Playwright version | ^1.49.0 |
| Total tests | 8 |
| Passed | 8 |
| Failed | 0 |
| Flaky | 0 |
| Duration | ~14s |

## Result matrix

| Spec | Test | Status | Duration | Trace |
|---|---|---|---|---|
| auth.spec.ts | Login valid | ✅ PASS | ~1.2s | — |
| auth.spec.ts | Login invalid | ✅ PASS | ~0.8s | — |
| auth.spec.ts | Logout | ✅ PASS | ~1.0s | — |
| dashboard.spec.ts | Product catalog | ✅ PASS | ~1.5s | — |
| dashboard.spec.ts | Add to cart | ✅ PASS | ~1.8s | — |
| checkout.spec.ts | Full checkout | ✅ PASS | ~2.5s | — |
| checkout.spec.ts | Form validation | ✅ PASS | ~2.0s | — |
| checkout.spec.ts | Network failure | ✅ PASS | ~2.5s | — |

## Failure analysis

No failures recorded. All 8 tests pass on first attempt.

## Flaky triage strategy

Following Micco (2016) and Ziftci & Cavalcanti (2020):

1. **Detection**: Tests are re-run on failure (retries=2 in CI). If a test passes on retry, it's flagged as flaky.
2. **Quarantine**: Flaky tests are isolated in a separate CI job and not counted toward the merge gate.
3. **Root cause**: Traces (on-first-retry) and logs are inspected. Common causes: timing, state leakage, environment drift.
4. **Mitigation**: Fixed waits are banned (enforced by ESLint). State isolation is verified. Server state reset via `POST /api/reset`.

## Notes

- All tests use real API calls (server.js) except the network failure test which uses `page.route()` to simulate a 500 error.
- No `page.waitForTimeout()` calls — all waits are implicit via Playwright auto-waiting and web-first assertions (Liu et al. 2024).
- Test suite is designed to run in CI with a `--shard` configuration for parallel execution on larger suites.

## References

- Micco (2016) — Flaky Tests at Google and How We Mitigate Them
- Ziftci & Cavalcanti (2020) — De-Flake Your Tests (ICST)
- Luo et al. (2014) — An Empirical Analysis of Flaky Tests (FSE)
- Liu et al. (2024) — WEFix (WWW)
