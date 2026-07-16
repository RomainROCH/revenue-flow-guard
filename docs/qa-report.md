# QA Evidence Guide

## Status authority

This document intentionally contains no hand-written pass total, duration, or
browser version. Those values become stale as the suite changes. The promoted
`artifacts/public-evidence/evidence.json` is the machine-readable authority for
the commit that produced it.

The public manifest is promoted only after the baseline, isolated regression
proof, configured evidence gates, and public-artifact validation succeed. The
separate repository/public secret scan must also pass before a release is
accepted. Missing or inconsistent evidence input remains incomplete.

## Reproduction

Run from a clean checkout with the required Playwright browsers installed:

```bash
npm ci
npx playwright install chromium firefox webkit
npm run validate:docs
npm run validate:repo
npm run validate:workflows
npm run lint
npm run typecheck
npm run test:repeat
npm run verify:quality
npm run build:evidence
npm run validate:public-artifacts
npm run scan:secrets
```

The repeated baseline detects outcome changes without retries. The regression
proof then executes each manifest-mapped test under one fault profile. The
cross-browser command in the [README](../README.md#release-confidence-gate)
checks the browser matrix independently from public evidence publication.

## Evidence interpretation

Accept the public manifest only when all of these statements are true:

- `schemaVersion` is supported.
- `status` is `complete` and every required gate is true.
- `source.commitSha` is the full commit being published.
- The baseline reports no failed, flaky, skipped, or unexpected tests.
- Every canonical fault is detected with matching expected and observed
  signatures.
- Sanitization is complete and the secret scan reports no matches.
- The CI run URL uses HTTPS.

The case-study runtime repeats these checks before it displays live evidence. It
returns `EVIDENCE_UNAVAILABLE` with `Cache-Control: no-store` when the environment
does not contain a valid current manifest.

## Public and private artifacts

The public allowlist contains only:

- `artifacts/public-evidence/evidence.json`
- `artifacts/public-evidence/summary.html`
- the separately uploaded secret-scan validation report

Raw Playwright JSON, HTML reports, traces, screenshots, server logs, cookies,
headers, tokens, and absolute local paths remain private. The validator rejects
unexpected public files and unreadable content.

## Failure triage

1. Treat an infrastructure error as an invalid proof, not a product regression.
2. Reproduce the exact zero-retry command and preserve private diagnostics.
3. Determine whether the behavior, test contract, fixture isolation, or
   environment is wrong.
4. Add a failing regression test before changing behavior.
5. Rebuild evidence from the resulting commit; never edit the manifest by hand.

See the [test plan](test-plan.md) for risk ownership and the
[references](references.md) for the evidence limits behind this policy.
