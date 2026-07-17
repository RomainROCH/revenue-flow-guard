# Milestone 3 — Case Study and Publication Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers-subagent-driven-development (if subagents available) or superpowers-executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn verified evidence into a truthful commercial case study, then publish only after repository identity, contact path, offer wording, hosting, and access are explicitly approved.

**Architecture:** Serve the case study from the same Node application. Runtime configuration supplies approved contact data and a CI-generated evidence manifest; rendering fails closed on missing/mismatched values. Local implementation and validation finish before any external repository or deployment mutation.

**Tech Stack:** Semantic HTML/CSS/vanilla JavaScript, existing Node app, Playwright smoke tests, GitHub CLI/connector after approval, approved hosting provider after approval.

**Spec:** `docs/superpowers/specs/2026-07-11-revenue-flow-guard-design.md`

**Prerequisite:** Milestones 1–2 are green and committed.

---

## Chunk 1: Truthful commercial surface

### Task 1: Add validated public runtime configuration

**Skill:** `@superpowers-test-driven-development`, `@security`

**Files:**
- Create: `src/public/public-config.js`
- Create: `src/public/public-evidence.js`
- Create: `tests/api/public-runtime.spec.ts`
- Modify: `src/create-application.js`
- Modify: `src/http/static-assets.js`

- [ ] **Step 1: Write failing runtime tests**

Cover missing/malformed evidence, unsupported schema, incomplete/unsanitized evidence, wrong source commit, exact valid manifest, missing/invalid contact URL/label, and no-store evidence responses. Invalid evidence returns `503 EVIDENCE_UNAVAILABLE` without echoing environment content.

- [ ] **Step 2: Verify red**

Run: `npm run test:api -- public-runtime.spec.ts`

Expected: FAIL because `/evidence/latest.json` and validated public config do not exist.

- [ ] **Step 3: Implement strict evidence parser**

At application creation, parse `PUBLIC_EVIDENCE_JSON` and require `SOURCE_COMMIT_SHA`, schema 1, complete/sanitized true, six exact faults, and matching commit. Serve only validated data at `/evidence/latest.json` with `Cache-Control: no-store`.

- [ ] **Step 4: Implement approved-contact injection boundary**

`public-config.js` accepts `PUBLIC_CONTACT_URL` only for `https:`, a 1–80-character `PUBLIC_CONTACT_LABEL`, a 1–80-character `PUBLIC_OFFER_NAME`, and a 1–240-character `PUBLIC_OFFER_SUMMARY`. `static-assets.js` replaces exact escaped tokens in `case-study.html` at response time; it never infers connector email/profile data. Missing values keep the local page in explicit “publication inputs missing” mode and make publication validation fail.

- [ ] **Step 5: Verify green and commit**

Run: `npm run test:api -- public-runtime.spec.ts`

Expected: PASS.

```bash
git add src/public src/create-application.js src/http/static-assets.js tests/api/public-runtime.spec.ts
git commit -m "feat: validate public evidence and contact config"
```

### Task 2: Build the progressively enhanced case study

**Skill:** `@superpowers-test-driven-development`, `@frontend`, `@ui-system`

**Files:**
- Create: `app/case-study.html`
- Create: `app/case-study.js`
- Modify: `app/style.css`
- Create: `tests/ui/case-study.spec.ts`

- [ ] **Step 1: Write failing content/accessibility tests**

With fake approved offer/contact config, assert outcome-led headline, six risks, a concise architecture, delivery method, sprint deliverables without a duration promise, limitations, evidence commit/run metadata, configured offer/CTA, landmarks/headings, keyboard order, 200% zoom, and no overflow at 1280×720 and Pixel 7.

- [ ] **Step 2: Write failing evidence/fallback tests**

With JavaScript disabled, exact fallback text is `Live evidence requires JavaScript; no result is shown in this static view.` With JavaScript enabled, valid evidence renders six detections; missing/invalid/stale/incomplete evidence renders `Evidence unavailable or incomplete` and no pass totals.

- [ ] **Step 3: Verify red**

Run: `npm run test:ui -- case-study.spec.ts`

Expected: FAIL because `/case-study.html` does not exist.

- [ ] **Step 4: Implement semantic static content**

Use sections `Protect the flow that pays you`, `Risks demonstrated`, `How protection works`, `Delivery method`, `What the sprint delivers`, `Live evidence`, `What this demo does not prove`, and `Start a conversation`. `How protection works` summarizes browser/API tests, isolated state, idempotent checkout, regression profiles, and commit-bound CI evidence. `Delivery method` states discovery → risk map → implementation/repair → CI evidence → handoff. Do not state delivery days, savings, client revenue, production defect reduction, or guarantees.

- [ ] **Step 5: Implement fail-closed evidence enhancement**

Keep the no-JS fallback in HTML. JavaScript fetches `/evidence/latest.json`, independently validates supported schema/flags/six IDs/source commit, then replaces the fallback. Any error replaces it only with the unavailable state.

- [ ] **Step 6: Verify green and commit**

Run: `npm run test:ui -- case-study.spec.ts`

Expected: PASS.

```bash
git add app tests/ui/case-study.spec.ts
git commit -m "feat: add evidence-driven case study"
```

### Task 3: Replace inaccurate docs and implement repository validators

**Skill:** `@superpowers-test-driven-development`, `@documentation-structure-governance`

**Files:**
- Rewrite: `README.md`
- Rewrite: `docs/test-plan.md`
- Rewrite: `docs/qa-report.md`
- Rewrite: `docs/handoff.md`
- Create: `docs/references.md`
- Delete: `planning-overview.md`
- Create: `scripts/validate-docs.mjs`
- Create: `scripts/validate-repo.mjs`
- Create: `tests/scripts/validate-docs.spec.ts`
- Create: `tests/scripts/validate-repo.spec.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing doc-validator tests**

Reject `REPO_OWNER`, TODO/TBD, false WEFix 73% claim, unsupported numeric marketing claims, unlinked citations, stale hand-written pass totals, broken local links, and documented commands absent from `package.json`.

- [ ] **Step 2: Write failing repo-validator tests**

Using fixture directories, reject an exported test helper/fixture with no importing consumer, an unreferenced file under `scripts/`, a package script whose file target is missing, and a registered API route absent from the route-contract coverage manifest. Accept the real repo only after cleanup.

- [ ] **Step 3: Verify red**

Run: `npx playwright test tests/scripts/validate-docs.spec.ts tests/scripts/validate-repo.spec.ts --retries=0`

Expected: FAIL against current inaccurate docs and missing validators.

- [ ] **Step 4: Rewrite documentation as present state**

README routes to quick start, case study, evidence, architecture, limitations, and adaptation. Test plan maps risks to exact canonical test IDs. QA report explains reproduction and schema without mutable totals. Handoff covers app replacement, auth, data isolation, CI, security boundaries. References attach each narrow claim to official docs or DOI.

- [ ] **Step 5: Remove obsolete draft and implement validators**

Delete only `planning-overview.md`. Implement `validate:docs` and `validate:repo` with the tested contracts; store the explicit registered-route/test mapping in `tests/meta/route-contracts.json`.

- [ ] **Step 6: Verify green and commit**

Run: `npm run validate:docs && npm run validate:repo && npm run lint && npm run typecheck`

Expected: every command PASS with zero warnings.

```bash
git add -A README.md docs planning-overview.md scripts tests/scripts tests/meta/route-contracts.json package.json package-lock.json
git commit -m "docs: publish evidence-based case study"
```

### Task 4: Define local and live publication gates

**Skill:** `@superpowers-test-driven-development`, `@browser:control-in-app-browser`

**Files:**
- Create: `publication-inputs.schema.json`
- Create: `.env.example`
- Create: `scripts/validate-publication-inputs.mjs`
- Create: `scripts/validate-publication.mjs`
- Create: `scripts/release-check.mjs`
- Create: `scripts/export-publication-env.ps1`
- Create: `scripts/publish-repository.ps1`
- Create: `tests/smoke/public.spec.ts`
- Create: `tests/scripts/publication.spec.ts`
- Modify: `.gitignore`
- Modify: `package.json`

- [ ] **Step 1: Write failing publication tests**

Require these approved runtime inputs: repository full name, repository description, offer name/summary, contact URL/label, hosting provider, site slug, and access mode. For this public-money objective, schema version 1 accepts only `visibility: "public"` and `accessMode: "public"`; another choice requires a revised publication plan. Smoke `/`, `/case-study.html`, `/api/health`, and `/evidence/latest.json` at both required viewports; require HTTPS and secure cookie flags for live mode.

- [ ] **Step 2: Verify red**

Run: `npx playwright test tests/scripts/publication.spec.ts tests/smoke/public.spec.ts --retries=0`

Expected: publication-input test FAIL with `PUBLICATION_INPUTS:approval record is required`; local smoke behavior tests otherwise use explicit fake input fixtures.

- [ ] **Step 3: Implement approval-record contract**

The untracked file `.publication-inputs.json` must conform to the schema and include `{ approvedBy: "user", approvedAt, repository, visibility: "public", description, offerName, offerSummary, contactUrl, contactLabel, hostingProvider, siteSlug, accessMode: "public" }`. `approvedAt` must parse as a date. The tracked `.env.example` documents corresponding runtime variables without real values. `export-publication-env.ps1` first runs validation, then maps the approved fields to `RFG_PUBLIC_*` variables in its current PowerShell process and emits no secret or connector credential. `publish-repository.ps1` requires those variables, accepts only the validated public visibility, and wraps the exact `gh repo create/view` flow used in Task 6.

- [ ] **Step 4: Implement exact release orchestrator**

`npm run release:check` runs, in order: lint, typecheck, three-pass baseline, quality proof, evidence build/public validation, secret scan, docs/repo/workflow validators, Git status porcelain, Git fsck no-dangling, publication-input validation, then live smoke when `PUBLIC_URL` is set. It stops non-zero on the first failure and prints the failing command.

- [ ] **Step 5: Commit the publication-gate implementation**

```bash
git add publication-inputs.schema.json .env.example .gitignore scripts tests package.json package-lock.json
git commit -m "test: define publication approval gate"
```

- [ ] **Step 6: Verify expected post-commit pre-approval stop**

Run: `npm run release:check`

Expected before user approval: all repository gates PASS, then exit non-zero only at `PUBLICATION_INPUTS:approval record is required`. This is a successful local implementation stop, not publication completion.

## Chunk 2: Approved external publication

### Task 5: Obtain and validate explicit publication decisions

**Skill:** `@superpowers-verification-before-completion`

**Files:**
- Create locally, never commit: `.publication-inputs.json`

- [ ] **Step 1: Present one recommended publication record to the user**

Recommend but do not assume: public repository `RomainROCH/revenue-flow-guard`; description `Risk-driven Playwright demo proving six revenue regressions are detected before release.`; offer name `Revenue Flow Guard — SaaS Release Confidence Sprint`; offer summary `Protect one revenue-critical SaaS journey with risk-driven Playwright tests, CI evidence, and a maintainable handoff.`; contact `https://github.com/RomainROCH` labeled `Contact Romain on GitHub`; hosting `codex-sites`; slug `revenue-flow-guard`; access `public`.

- [ ] **Step 2: Stop until the user explicitly approves or edits every field**

Do not create a remote repository, update public profile data, create a site, or deploy while approval is missing. Record exactly the approved values and timestamp in `.publication-inputs.json`.

- [ ] **Step 3: Validate the record**

Run: `npm run validate:publication-inputs`

Expected: PASS and print the approved repository, contact host, hosting provider, slug, and access mode without secrets.

### Task 6: Create/push the approved GitHub repository and obtain CI evidence

**Skill:** `@github-troubleshooting`, `@superpowers-verification-before-completion`

**Files:**
- Modify: `README.md` only after the remote URL and real workflow exist

- [ ] **Step 1: Load approved inputs into environment and verify identity**

Dot-source the exporter so variables reach the caller: `. .\scripts\export-publication-env.ps1`. Then run `gh auth status` and `gh repo view $env:RFG_PUBLIC_REPOSITORY`.

Expected: authenticated as the approved owner; repo view either returns not found or shows the same intended project. Any unrelated existing repo stops execution.

- [ ] **Step 2: Create/push without force when absent**

Run the validated wrapper:

```powershell
.\scripts\publish-repository.ps1
```

The wrapper rejects any visibility other than the schema-approved `public`, runs `gh repo create ... --public` only when absent, or verifies/adds `origin` and runs `git push -u origin main` when the confirmed project already exists. It never force pushes.

Expected: remote `main` exists and `git rev-parse HEAD` equals `git ls-remote origin refs/heads/main` SHA.

- [ ] **Step 3: Inspect CI through the GitHub connector/CLI**

Run `gh run list --workflow playwright.yml --branch main --limit 1 --json databaseId,headSha,status,conclusion,url`. Require head SHA equal local HEAD and conclusion `success`. If not terminal, poll at intervals under 60 seconds. Fix failures in new commits and repeat.

- [ ] **Step 4: Download and validate exact-run evidence**

Run `gh run download $env:RFG_CI_RUN_ID --name revenue-flow-guard-evidence --dir artifacts/downloaded-public-evidence`, then `node scripts/validate-public-artifacts.mjs artifacts/downloaded-public-evidence`.

Expected: PASS and evidence source commit equals local/remote HEAD.

- [ ] **Step 5: Add only real links**

Update README badge/repository links from the approved remote, commit, push, obtain a new green exact-commit run, and repeat Step 4 for that final commit.

### Task 7: Deploy only through the approved hosting provider

**Skill:** `@security`, `@superpowers-verification-before-completion`

**Files:**
- Create only when provider is approved `codex-sites`: `.openai/hosting.json`
- Follow exactly: `docs/superpowers/plans/2026-07-11-codex-sites-publication-appendix.md`

- [ ] **Step 1: Enforce provider stop condition**

If `hostingProvider` is not exactly `codex-sites`, stop and write a provider-specific replacement plan before any deployment. Do not improvise commands.

- [ ] **Step 2: Create or reuse Sites project exactly once**

Execute Appendix steps A1–A2. Read `.openai/hosting.json`; reuse its opaque `project_id` when present, otherwise call the exact create operation once and persist the returned ID unchanged. Validate `accessMode` is the schema-approved `public`; another value stops for plan revision.

- [ ] **Step 3: Configure exact runtime state**

Execute Appendix step A3. Set `SOURCE_COMMIT_SHA` to final remote HEAD, `SECURE_COOKIES=1`, approved offer/contact values, and `PUBLIC_EVIDENCE_JSON` to the validated final CI manifest. Set `PUBLIC_BASE_URL` to the Sites project URL when already returned; otherwise set it after the first successful deployment and redeploy the same saved version as Appendix A7 requires. No source file contains these values.

- [ ] **Step 4: Push/save/deploy exact commit**

Execute Appendix steps A4–A7 using the exact connector operations, arguments, response fields, and polling rules. Because schema-approved access is public, confirm the connector's required open-world deployment approval, deploy only the saved version, and inspect status until `succeeded`.

Expected: deployment returns an HTTPS URL, saved/deployed version IDs, and source commit matching final HEAD.

- [ ] **Step 5: Verify public runtime boundaries**

Set `PUBLIC_URL` to the returned HTTPS URL and run `npm run test:public && npm run release:check`.

Expected: PASS; secure cookie flags present; all test-control paths generic 404; evidence commit equals final HEAD.

### Task 8: Perform final visual and completion audit

**Skill:** `@browser:control-in-app-browser`, `@ui-visual-review`, `@implementation-review`, `@superpowers-verification-before-completion`

**Files:**
- Modify source only if a verified defect requires it

- [ ] **Step 1: Inspect six live views**

Review login, catalog, checkout, confirmation, desktop case study, and Pixel 7 case study. Check hierarchy, focus, contrast, overflow, truthful content, CTA, and evidence metadata.

- [ ] **Step 2: Run one exact completion command**

With validated publication environment loaded, run: `npm run release:check`.

Expected: every local/public gate PASS; worktree clean; Git fsck clean; local/remote/CI/evidence/deployment SHAs identical.

- [ ] **Step 3: Handle final changes without stale evidence**

If any source edit is required, commit/push, obtain a new exact-commit green CI artifact, update deployment evidence/runtime, save/deploy the new version, and rerun Steps 1–2. Otherwise leave the verified deployment unchanged.
