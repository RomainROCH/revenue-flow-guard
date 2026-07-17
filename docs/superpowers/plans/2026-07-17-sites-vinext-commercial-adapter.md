# Sites vinext commercial adapter implementation plan

> **Execution:** use TDD, bounded delegation, independent review, and fresh verification before publication.

**Goal:** Publish a truthful, competitive Revenue Flow Guard commercial case study on Codex Sites with exact commit-bound CI evidence.

**Authority:** `docs/superpowers/specs/2026-07-17-sites-vinext-commercial-adapter-design.md`.

## Chunk 1: Lock the supported artifact contract

### Task 1: Add RED build and workspace contracts

**Files:**
- Modify `tests/meta/project-contract.spec.ts`
- Replace `tests/scripts/build-site.spec.ts`
- Create `tests/sites/runtime-parity.spec.ts`
- Modify `playwright.config.ts`
- Modify `package.json`

- [ ] Require root npm workspace `sites-app` and these exact scripts: `build = npm run typecheck && npm run build:site`, `build:site = npm run build --workspace revenue-flow-guard-site && node scripts/finalize-site-build.mjs`, `start:site = npm run start --workspace revenue-flow-guard-site --`, `test:sites = npm run build && playwright test --config playwright.sites.config.ts`, `test:sites:public = node scripts/validate-sites-public-url.mjs && playwright test --config playwright.sites-public.config.ts`, and `typecheck = tsc --noEmit && npm run typecheck --workspace revenue-flow-guard-site`.
- [ ] Require exact vinext/React/Vite package pins in `sites-app/package.json`.
- [ ] Require the default Playwright config to ignore both `**/sites/**` and `**/sites-public/**` so pre-deployment tests never discover the external-only smoke profile.
- [ ] Add a failing artifact test requiring `dist/server/index.js`, `dist/client`, and an exact copy of `.openai/hosting.json` at `dist/.openai/hosting.json`; forbid root `_worker.js` and static compatibility-probe output.
- [ ] Add failing parity tests for public config and evidence parsers across valid, missing, malformed, incomplete, forged, duplicate, and commit-mismatched inputs. Require the Sites parser to reject Node-valid local evidence and foreign-repository CI evidence as a deliberate stricter publication boundary.
- [ ] Run only the new contract tests and require failures caused by the missing workspace/adapter.

Target `sites-app/package.json` contract:

| Field | Exact value |
|---|---|
| `name` | `revenue-flow-guard-site` |
| `private` | `true` |
| `type` | `module` |
| `scripts.build` | `node ../scripts/prepare-site-assets.mjs && vinext build` |
| `scripts.start` | `vinext start` |
| `scripts.check` | `vinext check` |
| `scripts.typecheck` | `tsc --noEmit` |
| `react`, `react-dom`, `react-server-dom-webpack` | `19.2.7` |
| `vinext` | `1.0.0-beta.2` |
| `vite` | `8.1.5` |
| `@vitejs/plugin-react` | `6.0.3` |
| `@vitejs/plugin-rsc` | `0.5.28` |
| `@types/react` | `19.2.17` |
| `@types/react-dom` | `19.2.3` |

### Task 2: Scaffold the isolated vinext workspace

**Files:**
- Create `sites-app/package.json`
- Create `sites-app/tsconfig.json`
- Create `sites-app/next-env.d.ts`
- Create `sites-app/app/layout.tsx`
- Create `sites-app/app/page.tsx`
- Create `sites-app/app/case-study.html/page.tsx`
- Create `sites-app/app/not-found.tsx`
- Create `sites-app/components/case-study.tsx`
- Create `sites-app/lib/public-runtime.ts`
- Create `sites-app/public/.gitkeep`
- Modify `.gitignore`
- Modify `package.json`, `package-lock.json`, and `tsconfig.json`

- [ ] Install the exact clean-room-proven dependency set with npm workspaces and add exact React type pins.
- [ ] Configure independent strict site typechecking without changing the CommonJS Node runtime.
- [ ] Implement public config and evidence parsing before the UI; import `regressions/manifest.json` as the canonical fault list, enforce the exact Revenue Flow Guard GitHub Actions provenance for Sites, and read `process.env` only inside request/render functions.
- [ ] Add the evidence route early, build once, import `dist/server/index.js`, call the same handler twice after changing the request-time evidence environment, and require different controlled responses without rebuilding. Do not use the handler context as an environment object and do not add `cloudflare:workers`.
- [ ] Translate the existing semantic case-study markup to TSX, reuse the existing CSS asset, render evidence server-side, replace the interactive-demo link with GitHub source/CI proof, and add the exact hosted-scope limitation.
- [ ] Render `/` and `/case-study.html` from the same component and add a controlled `404`.
- [ ] Run parser parity, site typecheck, lint, and `vinext check`.

### Task 3: Build and finalize the exact Sites artifact

**Files:**
- Create `scripts/prepare-site-assets.mjs`
- Create `scripts/finalize-site-build.mjs`
- Modify `package.json`
- Delete `scripts/build-site.mjs` and `scripts/build-site.d.mts`
- Delete `sites/compatibility-worker.mjs`
- Delete `wrangler.jsonc`
- Remove obsolete Wrangler dependency and compatibility tests

- [ ] Prepare only generated `sites-app/public/style.css` from canonical `app/style.css`; ignore the generated copy.
- [ ] Build inside `sites-app`, validate every required path without following symlink output, replace only verified root `dist`, preserve relative vinext structure, and copy `.openai/hosting.json` into the artifact.
- [ ] Fail closed on missing/malformed hosting metadata, missing server/client output, symlinks, stale output, or an unexpected compatibility worker.
- [ ] Run the RED artifact test again and require green.
- [ ] Enumerate the artifact and import `dist/server/index.js`; require a default two-argument handler and HTTP `200` for `/`.

## Chunk 2: Prove the hosted product boundary locally

### Task 4: Add exact vinext routes and runtime tests

**Files:**
- Create `sites-app/app/api/health/route.ts`
- Create `sites-app/app/evidence/latest.json/route.ts`
- Replace `tests/sites/compatibility.spec.ts` with `tests/sites/commercial-runtime.spec.ts`
- Modify `playwright.sites.config.ts`

- [ ] Add exact health and evidence handlers with the design headers and non-reflective `503` fallback.
- [ ] Start `vinext start` on `127.0.0.1:8788` through Playwright with an exact valid runtime environment and no reused server.
- [ ] Import the built handler and call it twice without rebuild using two runtime values; require different controlled responses through the accessor proven in Task 2.
- [ ] Assert root and case-study status/content, exact approved copy, source/CI/contact links, no unresolved tokens, and no hosted interactive-demo claim.
- [ ] Assert exact valid evidence bytes/headers and exact health bytes/headers.
- [ ] Assert `/api/session`, payment/order APIs, test controls, and unknown routes are controlled `404` responses with no cookie.
- [ ] Prove invalid environments directly against parsers and the built handler: missing/malformed evidence, foreign repository, local evidence, SHA mismatch, and secret sentinels must fail closed without reflection. Do not orchestrate a second concurrent vinext server.
- [ ] Require desktop, Pixel 7, JavaScript-disabled, keyboard-focus, and 200%-zoom evidence.

### Task 5: Add a separate public Sites smoke profile

**Files:**
- Create `tests/sites-public/public.spec.ts`
- Create `playwright.sites-public.config.ts`
- Create or modify the narrow URL validator needed by `test:sites:public`
- Modify `playwright.config.ts` and `tsconfig.json`
- Modify `package.json`

- [ ] Require one clean HTTPS URL from `SITES_PUBLIC_URL`; never silently fall back to the Node public profile.
- [ ] Test `/`, `/case-study.html`, `/api/health`, `/evidence/latest.json`, controlled `404`, no overflow, exact approved copy, exact deployed SHA/CI run, and absent session/payment APIs.
- [ ] Keep `tests/smoke/public.spec.ts` and its Secure/HttpOnly/SameSite session assertion unchanged.
- [ ] Prove the new command fails closed without a URL and rejects non-HTTPS or credential-bearing URLs.

## Chunk 3: Integrate, review, and publish

### Task 6: Run full repository gates

- [ ] Run focused RED/GREEN history, site typecheck, lint, `vinext check`, artifact tests, parser parity, and local runtime tests.
- [ ] Add `test:sites` to `release-check.mjs` after typecheck and to the authoritative GitHub Actions workflow after Chromium installation. Update orchestration/workflow contract tests so the exact pushed CI proves the adapter before evidence is built.
- [ ] Run `validate:repo`, `validate:docs`, `scan:secrets`, and `release:check` on a clean commit.
- [ ] Confirm generated `.next`, nested/root `dist`, generated public CSS, credentials, and local runtime state are ignored.
- [ ] Perform independent implementation, security, and visual reviews; fix every correctness, truthfulness, accessibility, or scope finding.
- [ ] Commit and push the exact reviewed source; require its exact GitHub Actions run and validate its exact evidence artifact.

### Task 7: Execute the production gate once

- [ ] Update Sites `SOURCE_COMMIT_SHA` and `PUBLIC_EVIDENCE_JSON` from the exact validated CI artifact.
- [ ] Push the same Git HEAD to the Sites source repository with a short-lived per-command credential.
- [ ] Save a version and require returned source SHA equality before deployment.
- [ ] Deploy the user-approved public version once; poll the exact deployment ID.
- [ ] If Sites rejects the artifact, stop and preserve the exact failure; do not retry unchanged source.
- [ ] On success, run `test:sites:public`, browser screenshots/review at desktop and Pixel 7, JavaScript-disabled and 200% zoom checks, plus header/evidence verification.
- [ ] Update the GitHub repository homepage and README only after the final URL passes all gates.
- [ ] Record Sites compatibility, mark the publication plan complete, and report the production URL plus CI evidence.

## Biggest context and uncertainty

- **Biggest missing external fact:** the internal Sites validation after its documented vinext entrypoint gate.
- **Least-confident implementation point:** runtime environment propagation through the Sites vinext handler. Local tests must use runtime, not build-time, values, and the production evidence endpoint is the final proof.
