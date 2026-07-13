# Milestone 1 — Secure Revenue Flow Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers-subagent-driven-development (if subagents available) or superpowers-executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the toy storefront with a server-enforced, fake-payment revenue flow and an isolated Playwright UI/API baseline.

**Architecture:** Split HTTP, domain state, and revenue rules into focused CommonJS modules. Every Playwright test starts its own in-process application server with a fresh store on an ephemeral loopback port, so milestone 1 needs no reset backdoor and remains parallel-safe. UI tests own observable behavior; API tests own server contracts.

**Tech Stack:** Node.js LTS, CommonJS runtime modules, TypeScript 5.9 tests/config, Playwright 1.61, ESLint 9.

**Spec:** `docs/superpowers/specs/2026-07-11-revenue-flow-guard-design.md`

---

## Chunk 1: Isolated runtime contracts

### Task 1: Establish executable project contracts

**Skill:** `@superpowers-test-driven-development`

**Files:**
- Create: `tests/meta/project-contract.spec.ts`
- Create: `tsconfig.json`
- Modify: `package.json`
- Modify: `eslint.config.mjs`
- Modify: `.gitignore`
- Modify: `playwright.config.ts`

- [ ] **Step 1: Write the failing project-contract test**

Read `package.json` first and assert exact scripts `lint`, `typecheck`, `test`, `test:api`, `test:ui`, and `test:repeat`; assert `lint` contains `--max-warnings=0`. Only after all package assertions pass, check whether `tsconfig.json` exists and then assert its strict flags. Use the exact assertion message `PROJECT_CONTRACT:typecheck script is required` for the first expected failure, so a missing tsconfig cannot mask the intended red state.

- [ ] **Step 2: Verify the intended red state**

Run: `npx playwright test tests/meta/project-contract.spec.ts --retries=0`

Expected: FAIL only at `PROJECT_CONTRACT:typecheck script is required` because the current `package.json` lacks that script.

- [ ] **Step 3: Implement scripts and TypeScript boundary**

Use these scripts exactly:

```json
{
  "serve": "node server.js",
  "lint": "eslint . --max-warnings=0",
  "typecheck": "tsc --noEmit",
  "test": "playwright test",
  "test:api": "playwright test tests/api",
  "test:ui": "playwright test tests/ui",
  "test:repeat": "playwright test --repeat-each=3 --retries=0"
}
```

Set TypeScript to `ES2022`, `CommonJS`, `Node` resolution, `strict`, `noUnusedLocals`, `noUnusedParameters`, `noEmit`, and `esModuleInterop`. Include `playwright.config.ts` and `tests/**/*.ts`.

- [ ] **Step 4: Make test configuration authoritative**

Set `retries: 0` for every project and environment. Keep one Chromium project. Remove setup/storage-state projects and the automatic `webServer`; per-test fixtures own servers. Use `trace: 'retain-on-failure'` locally, but milestone 2 will define what CI may publish.

- [ ] **Step 5: Apply lint rules to the correct files**

Add `@typescript-eslint/no-floating-promises: error` for tests/config. Apply Playwright rules only under `tests/**/*.ts`. Apply `no-undef` and `no-unused-vars: error` to runtime/application JavaScript.

- [ ] **Step 6: Verify green and commit**

Run: `npx playwright test tests/meta/project-contract.spec.ts --retries=0 && npm run lint && npm run typecheck`

Expected: PASS with zero warnings.

```bash
git add tests/meta/project-contract.spec.ts tsconfig.json package.json package-lock.json eslint.config.mjs .gitignore playwright.config.ts
git commit -m "chore: establish strict test contracts"
```

### Task 2: Build HTTP primitives and the isolated-app fixture

**Skill:** `@superpowers-test-driven-development`, `@security`

**Files:**
- Create: `src/http/errors.js`
- Create: `src/http/json.js`
- Create: `src/http/responses.js`
- Create: `src/http/router.js`
- Create: `src/create-application.js`
- Create: `tests/fixtures/isolated-app.ts`
- Create: `tests/api/http-contracts.spec.ts`
- Modify: `server.js`

- [ ] **Step 1: Write failing exact-contract tests**

Through the future `isolatedApp` fixture, test health JSON, unknown route, wrong media type, malformed JSON, a body over 16 KiB, and all three `/__test/*` paths returning:

```json
{
  "data": null,
  "error": { "code": "NOT_FOUND", "message": "The requested resource was not found." }
}
```

- [ ] **Step 2: Create the minimum fixture shell and verify red**

The shell starts the current server factory when available and otherwise throws `ISOLATED_APP:createApplication is required`. Run `npm run test:api -- http-contracts.spec.ts`.

Expected: FAIL only with `ISOLATED_APP:createApplication is required`.

- [ ] **Step 3: Implement focused HTTP modules**

`json.js` accepts only `application/json`, limits streaming bodies before concatenation, and emits the spec's 413/415/400 codes. `responses.js` owns envelopes. `router.js` matches exact method/path pairs. `errors.js` exports `HttpError` plus frozen status/code/message definitions.

- [ ] **Step 4: Implement the application factory and fixture**

`createApplication({ store, clock, randomBytes, runtime })` returns an `http.Server` without listening. The fixture creates a fresh store, listens on `127.0.0.1:0`, exposes `baseURL`, and always closes the server in `finally`. `server.js` is only the production/local entrypoint using configured host/port.

- [ ] **Step 5: Verify green and commit**

Run: `npm run test:api -- http-contracts.spec.ts`

Expected: all HTTP contract tests PASS, including the exact generic 404 for test controls.

```bash
git add server.js src tests/fixtures/isolated-app.ts tests/api/http-contracts.spec.ts
git commit -m "feat: add isolated HTTP application"
```

### Task 3: Implement sessions and protected catalog

**Skill:** `@superpowers-test-driven-development`, `@security`

**Files:**
- Create: `src/domain/store.js`
- Create: `src/domain/session-service.js`
- Create: `src/domain/catalog-service.js`
- Create: `src/http/cookies.js`
- Create: `tests/api/session.spec.ts`
- Create: `tests/api/catalog.spec.ts`
- Modify: `src/create-application.js`

- [ ] **Step 1: Write failing API tests**

Cover valid/invalid login, current session, idempotent logout, missing/unknown session, protected products, exact public user shape, local cookie flags, and no product data in 401 responses.

- [ ] **Step 2: Verify red**

Run: `npm run test:api -- session.spec.ts catalog.spec.ts`

Expected: FAIL at the first missing `POST /api/session` contract with status 404 instead of 201.

- [ ] **Step 3: Implement store and services**

The store owns fresh Maps per fixture for sessions, tokens, idempotency records, and orders plus mutable product stock. Session IDs use injected cryptographic randomness. Cookie `rfg_session` always has `HttpOnly; SameSite=Strict; Path=/` and adds `Secure` for an HTTPS public base URL.

- [ ] **Step 4: Register thin handlers**

Add `POST/GET/DELETE /api/session` and `GET /api/products`. Handlers parse, call one service method, and serialize one envelope.

- [ ] **Step 5: Verify green and commit**

Run: `npm run test:api -- session.spec.ts catalog.spec.ts`

Expected: PASS in parallel because every test owns a fresh store.

```bash
git add src tests/api/session.spec.ts tests/api/catalog.spec.ts
git commit -m "feat: enforce sessions and catalog access"
```

### Task 4: Implement fake payments and idempotent orders

**Skill:** `@superpowers-test-driven-development`, `@security`

**Files:**
- Create: `src/domain/canonical-order.js`
- Create: `src/domain/payment-service.js`
- Create: `src/domain/order-service.js`
- Create: `tests/api/payment-tokens.spec.ts`
- Create: `tests/api/orders.spec.ts`
- Modify: `src/create-application.js`

- [ ] **Step 1: Write failing token tests**

Cover all three scenarios, five-minute expiry with injected clock, one-time use, invalid input/session, random opaque shape, and rejection of PAN-like fields.

- [ ] **Step 2: Write failing order state-machine tests**

Cover every status/code table row, order-independent canonical hashing, pending concurrent replay through an injected request barrier, successful replay, hash conflict, deterministic decline replay, transient reservation release/token retention, stock unchanged on failure, stock decremented once on success, and server-calculated cents.

- [ ] **Step 3: Verify red**

Run: `npm run test:api -- payment-tokens.spec.ts orders.spec.ts`

Expected: FAIL at missing `POST /api/payment-tokens` with status 404 instead of 201.

- [ ] **Step 4: Implement exact state transitions**

Canonicalize after structural validation by product ID then quantity and SHA-256 the stable JSON. Existing-key lookup precedes stock/token reads. Store pending/completed records exactly as specified; consume approved tokens only in the synchronous success commit, cache declines, and delete pending state on transient failure.

- [ ] **Step 5: Register routes and verify all API tests**

Run: `npm run test:api`

Expected: all API tests PASS with zero retries and no order dependence.

- [ ] **Step 6: Commit**

```bash
git add src tests/api
git commit -m "feat: protect idempotent checkout contracts"
```

## Chunk 2: Browser behavior and baseline proof

### Task 5: Replace localStorage auth with session-aware UI

**Skill:** `@superpowers-test-driven-development`, `@frontend`, `@ui-system`

**Files:**
- Modify: `app/index.html`
- Modify: `app/app.js`
- Modify: `app/style.css`
- Create: `tests/fixtures/ui.ts`
- Create: `tests/ui/auth.spec.ts`
- Create: `tests/ui/catalog.spec.ts`
- Delete: `tests/auth.setup.ts`
- Delete: `tests/auth.spec.ts`
- Delete: `tests/dashboard.spec.ts`
- Replace: `tests/fixtures.ts`
- Modify: `tests/fixtures/isolated-app.ts`
- Create: `tests/fixtures/barrier.ts`
- Modify: `src/create-application.js`
- Modify: `src/domain/session-service.js`

- [ ] **Step 1: Write failing auth/navigation tests**

Test login, invalid alert, logout, direct `#dashboard`, and direct `#checkout`. `barrier.ts` exposes a deferred promise with `reached`, `release()`, and a 5-second fail-fast deadline. For both protected hashes, hold `GET /api/session` after the handler reaches the barrier, assert neither `Products` nor `Checkout` is visible while held, then release and assert login replaces the hash.

- [ ] **Step 2: Write failing catalog/cart tests**

Test authenticated catalog, integer-cent formatting, add/remove cart, keyboard operation, and isolated cart state. `uiTest` composes `isolatedApp`; `authenticatedPage` signs in with `page.request` so the HttpOnly cookie belongs to that browser context.

- [ ] **Step 3: Verify red**

Run: `npm run test:ui -- auth.spec.ts catalog.spec.ts`

Expected: direct protected navigation test FAIL because the old UI trusts localStorage.

- [ ] **Step 4: Implement semantic session boot and responsive UI**

Pass optional no-op-by-default `sessionBarrier` through `isolatedApp` → `createApplication` → `session-service`. Call it immediately before the protected-session response. The browser calls `GET /api/session` before protected rendering on initial load and every hash change. On 401, clear cart, replace with `#login`, and keep protected containers hidden. Use landmarks, heading hierarchy, labels, live notice region, lists/listitems, native controls, visible focus, and a single-column layout below 720px.

- [ ] **Step 5: Verify green and commit**

Run: `npm run test:ui -- auth.spec.ts catalog.spec.ts`

Expected: PASS.

```bash
git add -A app tests
git commit -m "feat: add session-aware storefront UI"
```

### Task 6: Implement approved, declined, transient, and in-flight checkout behavior

**Skill:** `@superpowers-test-driven-development`, `@frontend`, `@ui-system`

**Files:**
- Create: `tests/ui/checkout.spec.ts`
- Modify: `app/index.html`
- Modify: `app/app.js`
- Modify: `app/style.css`
- Delete: `tests/checkout.spec.ts`
- Modify: `tests/fixtures/ui.ts`
- Modify: `tests/fixtures/isolated-app.ts`
- Modify: `tests/fixtures/barrier.ts`
- Modify: `src/create-application.js`
- Modify: `src/domain/order-service.js`

- [ ] **Step 1: Write failing checkout tests**

Cover approved confirmation/total/order ID/cart clear; declined and transient messages with cart preservation; retry reusing the same key only for transient failure; empty-cart checkout blocked; and submit disabled while an `orderBarrier` wired through `uiTest` → `isolatedApp` → `createApplication` → `order-service` holds the first request after its idempotency record becomes pending.

- [ ] **Step 2: Verify red**

Run: `npm run test:ui -- checkout.spec.ts`

Expected: FAIL because the current UI exposes a card field and never creates fake payment tokens.

- [ ] **Step 3: Implement checkout controller**

Generate one UUID idempotency key per logical attempt. Select a documented fake outcome, obtain an opaque token, submit the order, preserve input/cart on failure, and disable every submission path while pending. Release the test barrier without sleeps.

- [ ] **Step 4: Verify green and commit**

Run: `npm run test:ui -- checkout.spec.ts`

Expected: PASS.

```bash
git add -A app tests
git commit -m "feat: add safe fake-payment checkout"
```

### Task 7: Close milestone 1 with exact evidence

**Skill:** `@implementation-review`, `@superpowers-verification-before-completion`

**Files:**
- Modify: `README.md`
- Delete if present: `playwright/.auth/user.json`

- [ ] **Step 1: Apply the exact cleanup boundary**

Confirm the five old test files named in Tasks 5–6 are deleted/replaced, `.auth` output is absent/ignored, no `localStorage.isLoggedIn`, card/PAN field, CSS/XPath product-test locator, fixed sleep, unused page-object export, or setup project remains. Do not delete `docs/*.md`, `planning-overview.md`, workflows, or the approved spec/plans in this milestone.

- [ ] **Step 2: Mark documentation state honestly**

Replace README feature claims with a concise milestone-1 implementation note, commands, current limitations, and links to the approved spec/plans. Do not add pass totals, CI badges, pricing, or public URL.

- [ ] **Step 3: Run exact static and runtime gates**

Run: `npm run lint && npm run typecheck && npm test`

Expected: all commands PASS, zero warnings, zero retries.

- [ ] **Step 4: Verify production control absence through the contract test**

Run: `npx playwright test tests/api/http-contracts.spec.ts --project=chromium --retries=0 -g "hides .+ /__test/"`

Expected: PASS for `/__test/reset`, `/__test/fault`, and `/__test/state`, each asserting the exact generic 404 envelope defined in Task 2.

- [ ] **Step 5: Run the three-pass baseline**

Run: `npm run test:repeat`

Expected: three executions of every API/UI test PASS with zero retries and zero flaky classifications.

- [ ] **Step 6: Commit milestone closure**

```bash
git add -A
git commit -m "test: prove secure revenue flow baseline"
```
