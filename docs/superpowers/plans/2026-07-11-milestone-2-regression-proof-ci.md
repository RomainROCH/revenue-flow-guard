# Milestone 2 — Regression Proof and CI Evidence Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers-subagent-driven-development (if subagents available) or superpowers-executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that the baseline detects six named business regressions without mistaking infrastructure failures for success, then generate sanitized commit-bound CI evidence.

**Architecture:** Inject one immutable fault decision object into the application. Test mode adds loopback/token-protected controls and renders one fault ID into an otherwise static index template; normal mode exposes neither. One orchestrator runs a zero-retry baseline first, then each mapped fault in a fresh external server, validates Playwright JSON and exact assertion signatures, and writes allowlisted evidence.

**Tech Stack:** Node.js child processes/crypto, Playwright JSON reporter, GitHub Actions, existing project stack.

**Spec:** `docs/superpowers/specs/2026-07-11-revenue-flow-guard-design.md`

**Prerequisite:** Milestone 1 passes every acceptance command on the current commit.

---

## Chunk 1: Fault profiles and canonical mappings

### Task 1: Add test-mode controls without public routes

**Skill:** `@superpowers-test-driven-development`, `@security`

**Files:**
- Create: `src/testing/faults.js`
- Create: `src/testing/test-controls.js`
- Create: `tests/api/test-controls.spec.ts`
- Modify: `src/create-application.js`
- Modify: `server.js`

- [ ] **Step 1: Write failing control tests**

Using `isolatedApp({ testMode, testToken })`, cover exact reset/fault/state shapes, allowed IDs, invalid ID, reset counts/state, health `testMode`, wrong token generic 404, non-loopback startup rejection, and total route absence in normal mode. Add table-driven authorized malformed cases: body on reset/state, absent/non-object/extra-field fault body, malformed JSON, and unsupported fault ID. Every authorized malformed control request must return `400 INVALID_TEST_CONTROL` with the spec's stable envelope.

- [ ] **Step 2: Verify red**

Run: `npx playwright test tests/api/test-controls.spec.ts --project=chromium --retries=0`

Expected: FAIL at `PUT /__test/fault` with 404 instead of the expected 200 in authorized test mode.

- [ ] **Step 3: Implement exact test-mode boundary**

Export only `NONE` plus the six spec IDs. Require `DEMO_TEST_MODE=1`, loopback host, and a non-empty 32-byte-or-longer `DEMO_TEST_TOKEN` in the entrypoint. Register controls only when enabled. Wrong tokens call the same not-found response function as unknown routes.

- [ ] **Step 4: Implement reset and state semantics**

Reset sessions, tokens, orders, idempotency, request counters, stock, and fault. Activating a fault resets first. State exposes only `faultId`, `orderCount`, `pendingOrderCount`, and `orderRequestCount`. Parse authorized controls with strict route-specific schemas and route every malformed authorized shape—including unexpected bodies on reset/state—through exact `400 INVALID_TEST_CONTROL`; do not reuse normal application `INVALID_JSON` for these controls.

- [ ] **Step 5: Verify green and commit**

Run: `npx playwright test tests/api/test-controls.spec.ts --project=chromium --retries=0`

Expected: PASS.

```bash
git add src/testing src/create-application.js server.js tests/api/test-controls.spec.ts
git commit -m "feat: add isolated regression controls"
```

### Task 2: Wire six one-behavior profiles and signature assertions

**Skill:** `@superpowers-test-driven-development`

**Files:**
- Create: `src/http/static-assets.js`
- Modify: `src/domain/catalog-service.js`
- Modify: `src/domain/order-service.js`
- Modify: `src/create-application.js`
- Modify: `app/index.html`
- Modify: `app/app.js`
- Modify: `tests/api/catalog.spec.ts`
- Modify: `tests/api/orders.spec.ts`
- Modify: `tests/ui/checkout.spec.ts`
- Create: `tests/meta/fault-profile.spec.ts`

- [ ] **Step 1: Add six exact assertion signatures**

Each appears exactly once at the designated assertion:

```text
RFG:AUTH_BYPASS:AUTH_REQUIRED
RFG:CLIENT_PRICE_TRUST:CLIENT_AMOUNT_FORBIDDEN
RFG:DUPLICATE_ORDER:IDEMPOTENT_REPLAY
RFG:EMPTY_CART_ACCEPTED:EMPTY_CART_REJECTED
RFG:PAYMENT_DECLINE_HIDDEN:DECLINE_VISIBLE
RFG:SUBMIT_CONTROL_MISSING:SUBMIT_DISABLED
```

- [ ] **Step 2: Write failing fault-profile meta-tests**

Construct the application with each fault and assert only its intended seam changes. Domain profiles are: catalog auth skip; client-total acceptance; completed replay creates another order; empty-list acceptance. UI profiles must leave the server decline/order state unchanged and affect only rendering/disabled control.

- [ ] **Step 3: Verify red**

Run: `npx playwright test tests/meta/fault-profile.spec.ts --retries=0`

Expected: FAIL because fault seams and index fault marker are absent.

- [ ] **Step 4: Implement the domain profiles narrowly**

Branch at one named guard/state transition per domain fault. Do not share a generic “fault mode” branch and do not change unrelated response fields.

- [ ] **Step 5: Implement the UI fault marker without a new public API**

`app/index.html` contains exactly `data-rfg-fault="NONE"` on `<html>`. `static-assets.js` serves files byte-for-byte except in test mode for `/` and `/index.html`, where it replaces that one literal with the active fault ID after verifying it is from the frozen enum. Normal mode always serves `NONE`.

For `PAYMENT_DECLINE_HIDDEN`, the browser still receives 402 and the server creates no order/stock change; only the faulty UI hides the decline and renders a synthetic confirmation state. For `SUBMIT_CONTROL_MISSING`, only the UI skips disabling the submit control while the request barrier remains pending.

- [ ] **Step 6: Verify green baseline and fault seams**

Run: `npx playwright test tests/meta/fault-profile.spec.ts --retries=0 && npm test`

Expected: meta-tests PASS and all baseline tests PASS under `NONE`.

- [ ] **Step 7: Commit**

```bash
git add src app tests
git commit -m "test: seed six isolated revenue regressions"
```

### Task 3: Define one canonical regression manifest

**Skill:** `@superpowers-test-driven-development`

**Files:**
- Create: `regressions/manifest.json`
- Create: `scripts/validate-regression-manifest.mjs`
- Create: `tests/meta/regression-manifest.spec.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing manifest tests**

Require schema 1, exactly six enum IDs, unique signatures and test IDs, existing files, exact signature occurrence, and this canonical ID grammar:

```text
<POSIX repo-relative test file> › [<describe title> › ...] <test title>
```

The file and test title are required; zero or more describe titles may appear
between them, matching Playwright's actual suite nesting. Titles are trimmed
exactly as Playwright reports them; the separator is space/U+203A/space.

- [ ] **Step 2: Verify red**

Run: `npx playwright test tests/meta/regression-manifest.spec.ts --retries=0`

Expected: FAIL because `regressions/manifest.json` does not exist.

- [ ] **Step 3: Create the manifest and validator**

Each entry stores `id`, `testId`, and `expectedSignature`. The validator derives file/title components from `testId`, checks source/signature, and later shares its parser with the runner.

- [ ] **Step 4: Verify green and commit**

Run: `npm run validate:regressions`

Expected stdout: `6 regression mappings valid`; exit 0.

```bash
git add regressions scripts/validate-regression-manifest.mjs tests/meta package.json package-lock.json
git commit -m "test: define canonical regression mappings"
```

## Chunk 2: Baseline-first proof, evidence, and CI

### Task 4: Produce a machine-readable zero-retry baseline

**Skill:** `@superpowers-test-driven-development`

**Files:**
- Create: `scripts/run-baseline.mjs`
- Create: `scripts/lib/playwright-json.mjs`
- Create: `scripts/lib/playwright-json.d.mts`
- Create: `tests/scripts/playwright-json.spec.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing parser tests**

Use checked-in tiny JSON fixtures for all-pass, failed, flaky/retried, malformed, and missing-result runs. Normalize to `{ status, tests, passed, failed, retries, durationMs }`. Invalid or incomplete reports keep unknown metrics as `null` rather than inventing zero totals. Any skipped test or retry makes authoritative baseline status `failed`.

- [ ] **Step 2: Verify red**

Run: `npx playwright test tests/scripts/playwright-json.spec.ts --retries=0`

Expected: FAIL because the parser is absent.

- [ ] **Step 3: Implement baseline runner**

Spawn the repository-local Playwright CLI with `process.execPath`, no shell, and arguments `test tests/api tests/ui --reporter=json --retries=0`. This avoids Windows `.cmd` process-launch ambiguity while preserving the same Playwright invocation. Parse stdout, write `artifacts/internal-proof/baseline.json`, and exit non-zero unless every test passed with retries 0. Preserve malformed/command failures as explicit failed summaries rather than invented totals.

- [ ] **Step 4: Verify green and commit**

Run: `npm run baseline:json`

Expected: PASS and `artifacts/internal-proof/baseline.json` has `status: "passed"`, `failed: 0`, `retries: 0`.

```bash
git add scripts tests/scripts package.json package-lock.json .gitignore
git commit -m "test: capture authoritative baseline summary"
```

### Task 5: Build the false-positive-resistant fault runner

**Skill:** `@superpowers-test-driven-development`, `@security`

**Files:**
- Create: `scripts/lib/process.mjs`
- Create: `scripts/prove-regressions.mjs`
- Create: `scripts/verify-quality.mjs`
- Create: `tests/scripts/prove-regressions.spec.ts`
- Modify: `package.json`
- Modify: `tests/fixtures/isolated-app.ts`
- Modify: `tests/fixtures/ui.ts`

- [ ] **Step 1: Write failing runner tests**

Cover exact signature detection, wrong/no/multiple failures, timeout, browser launch, fixture error, server exit, health/state mismatch, malformed JSON, and child cleanup. None may become `detected` except one mapped test failing with its mapped signature.

- [ ] **Step 2: Verify red**

Run: `npx playwright test tests/scripts/prove-regressions.spec.ts --retries=0`

Expected: FAIL because runner modules are absent.

- [ ] **Step 3: Implement one-fault orchestration**

Add explicit external mode to the shared fixtures: when `RFG_EXTERNAL_BASE_URL` is present, `isolatedApp` validates that loopback URL, returns it without starting a server, and forbids local barrier options; otherwise it retains per-test in-process behavior. `uiTest` consumes the same base URL. The runner allocates a loopback port, generates 32 random bytes, starts `node server.js` with test variables plus `RFG_EXTERNAL_BASE_URL`, polls health for at most 10 seconds, activates/verifies the fault, derives file/title grep from canonical ID, runs JSON reporter with retries/workers 0/1 and that environment, validates the only mapped failure/signature, and terminates the child in `finally`.

- [ ] **Step 4: Enforce baseline-first quality command**

`verify-quality.mjs` first runs `baseline:json`. Only a passing zero-retry summary permits six-fault execution. On baseline failure it writes no detected faults and returns non-zero. Add `verify:quality` for this exact orchestrator.

- [ ] **Step 5: Verify integration and negative control**

Run: `npm run verify:quality`

Expected: baseline passed, six `detected`, exit 0. Then run `node scripts/prove-regressions.mjs --expected-signature-override INVALID_FOR_TEST`.

Expected negative control: exit non-zero with `signature_mismatch`; no detected result for that fault.

- [ ] **Step 6: Commit**

```bash
git add scripts tests/scripts package.json package-lock.json
git commit -m "test: prove six regression signatures"
```

### Task 6: Generate fail-closed sanitized evidence

**Skill:** `@superpowers-test-driven-development`, `@security`

**Files:**
- Create: `scripts/build-evidence.mjs`
- Create: `scripts/validate-public-artifacts.mjs`
- Create: `scripts/scan-secrets.mjs`
- Create: `scripts/secret-scan-allowlist.json`
- Create: `tests/scripts/public-evidence.spec.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing schema/security tests**

Cover complete and interrupted manifests, six unique faults, commit/run metadata, unsupported schema, forbidden cookie/header/path/private-key/token/PAN patterns, binary artifact, tracked `.env`, unreadable file, and expired allowlist entry.

- [ ] **Step 2: Define the exact allowlist contract**

Each entry is `{ sha256, reason, owner, expiresAt }`. `sha256` hashes one exact documented fake value; no regex/path exclusions. Owner is a non-empty repository role such as `maintainer`; expiry is ISO-8601 and must be future at scan time. Expired/malformed entries fail the scan.

- [ ] **Step 3: Verify red**

Run: `npx playwright test tests/scripts/public-evidence.spec.ts --retries=0`

Expected: FAIL because evidence/security scripts are absent.

- [ ] **Step 4: Implement complete and incomplete evidence**

Consume baseline/proof internal files. Missing/failed inputs produce schema-valid `complete: false`, `sanitized: false` without success totals. Passing inputs produce the full six-fault candidate. Validator scans the two public text files only, then marks sanitized true. Secret scan writes the specified current-commit zero-match report.

- [ ] **Step 5: Verify green and commit**

Run: `npm run verify:quality && npm run build:evidence && npm run validate:public-artifacts && npm run scan:secrets`

Expected: PASS; public directory contains only `evidence.json` and `summary.html`; evidence is complete/sanitized/current-commit.

```bash
git add scripts tests/scripts package.json package-lock.json
git commit -m "feat: generate sanitized quality evidence"
```

### Task 7: Make CI authoritative even after gate failures

**Skill:** `@superpowers-test-driven-development`, `@github-troubleshooting`

**Files:**
- Modify: `.github/workflows/playwright.yml`
- Create: `.github/workflows/cross-browser.yml`
- Create: `scripts/validate-workflows.mjs`
- Create: `tests/scripts/workflows.spec.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing workflow tests**

Require current major actions, npm cache only, no browser cache, Chromium install, every static/baseline/proof gate, `if: always()` on all post-install quality/evidence/validation/upload steps, and an upload allowlist. Scheduled workflow must use all three browsers and `--retries=0`.

- [ ] **Step 2: Verify red**

Run: `npx playwright test tests/scripts/workflows.spec.ts --retries=0`

Expected: FAIL because the current workflow caches Playwright browsers and lacks quality/evidence gates.

- [ ] **Step 3: Implement PR workflow**

After successful `npm ci`, run lint and typecheck as separate `if: always()` steps, then run the single self-gating `npm run verify:quality` step with `if: always()`. Do not schedule a separate baseline or fault-proof step. Evidence build, public validation, secret scan, and artifact upload also use `if: always()`. A static or quality failure therefore yields an incomplete manifest; validators stay red; upload still publishes only the incomplete public manifest/summary plus secret report. The job cannot turn green unless every gate passed.

- [ ] **Step 4: Implement scheduled cross-browser workflow**

Weekly/manual only. Install Chromium/Firefox/WebKit and run baseline projects with `--retries=0 --workers=1`. Any first failure remains a failed job; HTML/debug artifacts are not in the public evidence artifact.

- [ ] **Step 5: Verify green and commit**

Run: `npm run validate:workflows && npm run lint && npm run typecheck && npm run verify:quality && npm run build:evidence && npm run validate:public-artifacts && npm run scan:secrets`

Expected: every command PASS.

```bash
git add .github scripts/validate-workflows.mjs tests/scripts/workflows.spec.ts package.json package-lock.json
git commit -m "ci: publish authoritative regression evidence"
```

### Task 8: Close milestone 2 reproducibly

**Skill:** `@implementation-review`, `@superpowers-verification-before-completion`

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run exact repeat sequence twice**

In PowerShell, resolve and clear only the three generated paths with this exact repository-bound check:

```powershell
$root = (Resolve-Path '.').Path
$targets = @('artifacts/internal-proof','artifacts/public-evidence','artifacts/validation')
foreach ($target in $targets) {
  $resolved = [IO.Path]::GetFullPath((Join-Path $root $target))
  $prefix = $root + [IO.Path]::DirectorySeparatorChar
  if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe artifact path: $resolved" }
  if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
```

Then run:

```text
npm run test:repeat
npm run verify:quality
npm run build:evidence
npm run validate:public-artifacts
npm run scan:secrets
```

Repeat the same five commands once more.

Expected: both runs PASS; each public directory contains only `evidence.json` and `summary.html`; fault IDs/test IDs/signatures and commit match; only time/duration/run-local metadata may differ.

- [ ] **Step 2: Update README to achieved state only**

Add reproducible evidence commands and schema link. Do not add final badge, public URL, pricing, CTA, or mutable totals.

- [ ] **Step 3: Commit closure**

```bash
git add README.md
git commit -m "docs: record verified regression evidence"
```
