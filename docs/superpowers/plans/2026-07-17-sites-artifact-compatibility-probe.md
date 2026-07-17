# Codex Sites Artifact Compatibility Probe Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers-subagent-driven-development (if subagents available) or superpowers-executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and validate a fallback-safe `dist` artifact that proves whether Codex Sites executes a Cloudflare Pages advanced-mode worker.

**Architecture:** A deterministic Node build copies the accepted case-study surface into `dist`, resolves every public template token to a safe public fallback, and copies one module worker to `dist/_worker.js`. The worker owns one exact probe route and forwards every other request to `env.ASSETS`; Wrangler Pages local development provides the runtime-level proof before public deployment.

**Tech Stack:** Node.js 22+, Playwright, Cloudflare Wrangler 4.112.0, vanilla HTML/CSS/JavaScript, Codex Sites.

---

## Scope and authority

Authority: `docs/superpowers/specs/2026-07-17-sites-artifact-compatibility-design.md`.

This plan ends after the production compatibility result is known. It does not port the checkout API, weaken `tests/smoke/public.spec.ts`, migrate frameworks, or declare the public site launch-ready.

## File structure

- Create `scripts/build-site.mjs`: deterministic artifact builder with an importable `buildSite` function.
- Create `scripts/build-site.d.mts`: TypeScript declaration for the test import.
- Create `sites/compatibility-worker.mjs`: module worker with the exact probe and asset forwarding.
- Create `tests/scripts/build-site.spec.ts`: build-output and fallback-content contracts.
- Create `playwright.sites.config.ts`: isolated Wrangler-backed Playwright configuration.
- Create `tests/sites/compatibility.spec.ts`: real workerd/Pages compatibility tests.
- Create `wrangler.jsonc`: local Pages output/runtime configuration only.
- Modify `package.json` and `package-lock.json`: build lifecycle, `test:sites`, Wrangler dependency.
- Modify `tests/meta/project-contract.spec.ts`: executable project contract.
- Modify `tsconfig.json`: include the additional Playwright config.
- Modify `.gitignore`: ignore generated `dist/` and local `.wrangler/` state.

## Chunk 1: Deterministic fallback-safe artifact

### Task 1: Lock the build contract with RED tests

**Files:**
- Modify: `tests/meta/project-contract.spec.ts`
- Create: `tests/scripts/build-site.spec.ts`
- Create: `scripts/build-site.d.mts`

- [x] Add a project-contract expectation that `scripts.build` equals `npm run typecheck && node scripts/build-site.mjs`, `scripts['test:sites']` equals `npm run build && playwright test --config playwright.sites.config.ts`, and `wrangler` is pinned to `4.112.0` in `devDependencies`.
- [x] Add a build test that imports `buildSite`, copies only the required `app` and `sites` inputs into a test-owned temporary source root, builds its `<temporary-source>/dist`, and expects exactly `_worker.js`, `index.html`, `case-study.html`, `case-study.js`, and `style.css` at the artifact root.
- [x] Add assertions that both HTML files contain no `{{...}}` token, use `data-source-commit="unavailable"`, preserve the explicit unavailable-evidence copy, expose the approved GitHub contact URL, and do not advertise a broken interactive-demo link.
- [x] Add a test that pre-populates the output with `stale.txt`, runs the build, and proves stale output is removed.
- [x] Run `npx playwright test tests/meta/project-contract.spec.ts tests/scripts/build-site.spec.ts --retries=0 --workers=1` and require failures caused by the missing builder/contract, not syntax or fixture errors.

### Task 2: Implement the minimal builder

**Files:**
- Create: `scripts/build-site.mjs`
- Create: `sites/compatibility-worker.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`

- [x] Implement `buildSite({ sourceRoot, outputRoot })` using `node:fs/promises`; resolve both roots, use `path.relative` to require the output to be exactly the `dist` child of the supplied source root (including on case-insensitive Windows paths), remove only that verified output directory, then recreate it.
- [x] Read `app/case-study.html`; replace every existing public token exactly once or more with the already approved public fallback values, replace the source SHA with `unavailable`, and replace the interactive-demo navigation link with a truthful GitHub source link. Fail closed when an expected token or navigation marker is missing.
- [x] Write the transformed case study to both `index.html` and `case-study.html`; copy `app/case-study.js` and `app/style.css`; copy `sites/compatibility-worker.mjs` to `_worker.js`.
- [x] Implement only `GET /__rfg/hosting-compatibility` in the worker. Return status `200`, the exact JSON body from the design, and exact `Content-Type`, `Cache-Control`, and `X-Content-Type-Options` headers. Return `405` for another method on that path. Forward every other request through `env.ASSETS.fetch(request)`.
- [x] Change `build` to `npm run typecheck && node scripts/build-site.mjs`; add `test:sites`; add `dist/` to `.gitignore`; install exactly `wrangler@4.112.0` as a development dependency.
- [x] Run the focused RED command again and require all tests green.
- [x] Run `npm run build`, then enumerate `dist` and confirm no file exists at `dist/__rfg/hosting-compatibility`.

## Chunk 2: Prove the artifact in the real local Pages runtime

### Task 3: Add the Wrangler-backed runtime gate

**Files:**
- Create: `wrangler.jsonc`
- Create: `playwright.sites.config.ts`
- Create: `tests/sites/compatibility.spec.ts`
- Modify: `tsconfig.json`

- [x] Add `wrangler.jsonc` with `pages_build_output_dir: "./dist"`, compatibility date `2026-07-17`, and no production IDs, secrets, bindings, or deployment commands.
- [x] Add `playwright.sites.config.ts` with test directory `tests/sites`, one Chromium project, zero retries, one worker, and a `webServer` command `wrangler pages dev --ip 127.0.0.1 --port 8788`. `wrangler.jsonc` owns `pages_build_output_dir`; the readiness URL is the exact probe route and reuse is disabled.
- [x] Add the config file to `tsconfig.json`'s include list.
- [x] Write `tests/sites/compatibility.spec.ts` before starting Wrangler. Assert exact probe status/body/headers, root and case-study `200`, no unresolved template tokens, fallback source/contact copy, and static CSS success. Because Pages treats projects without a top-level `404.html` as SPAs, require an unknown navigation to render the same truthful fallback with `200`; this compatibility probe does not replace the final application's controlled `404` contract. Assert desktop and Pixel 7 root pages have no horizontal overflow.
- [x] Run `npm run test:sites` and require every test to pass through Wrangler/workerd, not by importing the worker directly.
- [x] Stop if Wrangler does not expose `env.ASSETS`, treats `_worker.js` as a static file, or needs a production Cloudflare account.

## Chunk 3: Integrate, publish, and decide

### Task 4: Run repository gates and review the implementation

**Files:**
- Review all files changed by Chunks 1–2.

- [x] Run focused tests, `npm run lint`, `npm run typecheck`, `npm run validate:repo`, `npm run validate:docs`, `npm run scan:secrets`, and `npm run test:sites`.
- [x] Run `npm run release:check`; inspect full output and require zero failures.
- [x] Run `git diff --check`, inspect the complete diff against the design, and confirm `dist`, credentials, evidence artifacts, and local Wrangler state are untracked/ignored.
- [x] Perform an independent implementation review. Fix all correctness, security, truthfulness, or scope findings and rerun the affected gates.
- [x] Commit the compatibility implementation only after fresh proof is green.

### Task 5: Publish the exact source and execute the production gate

**Files:**
- No new product files unless a failed local gate requires a reviewed fix.

- [ ] Push the exact commit to GitHub; wait for its exact CI run to succeed; download and validate its public evidence artifact.
- [ ] Update Sites runtime environment values so `SOURCE_COMMIT_SHA` and `PUBLIC_EVIDENCE_JSON` match that exact commit/run, without logging secrets or persisting temporary credentials.
- [ ] Push the exact Git HEAD to the existing Sites source repository, save a new version, then call `mcp__codex_apps__sites_get_site_version` with the returned opaque IDs and require `source.commit_sha` to equal `git rev-parse HEAD` exactly.
- [ ] With the existing explicit public-deployment approval, deploy the saved version and poll with waits below 60 seconds.
- [ ] On success, fetch `https://<deployment>/__rfg/hosting-compatibility` and require the exact status, headers, and JSON. Use Playwright at 1280x720 and Pixel 7 dimensions for both root and case-study; require status `200`, no unresolved tokens, truthful fallback copy, and `scrollWidth - clientWidth <= 0`.
- [ ] If the probe is exact, record worker compatibility and create a separate accepted plan for the complete runtime adapter. Do not present this compatibility version as the final interactive launch.
- [ ] If the probe fails, stop the worker path, preserve the failure message/evidence, and choose between the static commercial fallback and a separately planned supported-framework migration. Do not retry unchanged source.
