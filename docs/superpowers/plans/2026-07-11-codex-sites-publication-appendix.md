# Codex Sites Publication Appendix

Use this appendix only after `.publication-inputs.json` is user-approved, validates with `hostingProvider: "codex-sites"` and `accessMode: "public"`, and the exact GitHub commit has a successful CI evidence artifact.

All project, version, deployment, and credential identifiers are opaque. Copy them unchanged from tool responses. Never derive, reformat, log, or commit them except `project_id` in `.openai/hosting.json` as required.

## A1 — Resolve or create the project once

1. Read `.openai/hosting.json`.
2. If it contains `project_id`, call `mcp__codex_apps__sites_get_site({ project_id })` and require `status: "active"` plus slug equal the approved slug. A mismatch stops publication.
3. If no project ID exists, call:

```json
{
  "tool": "mcp__codex_apps__sites_create_site",
  "arguments": {
    "slug": "<approved siteSlug from validated runtime record>",
    "title": "<approved offerName>",
    "description": "<approved offerSummary>"
  }
}
```

The angle-bracket values above are runtime fields loaded from the validated record, not editable placeholders. Require response `status: "active"`, copy response `id` unchanged to `.openai/hosting.json` as `project_id`, and retain any `source_repository_credential` only in memory. Never call create again for this local site.

## A2 — Apply the approved access policy

Call:

```json
{
  "tool": "mcp__codex_apps__sites_update_site_access",
  "arguments": {
    "project_id": "<opaque project_id>",
    "access_mode": "public",
    "allowed_user_emails": [],
    "allowed_workspace_group_ids": [],
    "allowed_tenant_group_ids": []
  }
}
```

Require response `access_mode: "public"`. Then call `sites_get_site` again and require the effective access mode to remain public. Any unavailable public mode or policy mismatch stops deployment.

## A3 — Set runtime configuration

Call `mcp__codex_apps__sites_update_environment_variables` with the opaque project ID and these exact keys:

| Key | Value source | Secret |
|---|---|---|
| `SOURCE_COMMIT_SHA` | final remote/CI commit | no |
| `SECURE_COOKIES` | literal `1` | no |
| `PUBLIC_CONTACT_URL` | approved record | no |
| `PUBLIC_CONTACT_LABEL` | approved record | no |
| `PUBLIC_OFFER_NAME` | approved record | no |
| `PUBLIC_OFFER_SUMMARY` | approved record | no |
| `PUBLIC_EVIDENCE_JSON` | validated exact-commit CI artifact | no |
| `PUBLIC_BASE_URL` | current Sites HTTPS URL when available | no |

Omit `PUBLIC_BASE_URL` on the first update only when `get_site` returns neither current live nor preview HTTPS URL. Require an incremented environment `revision` and returned keys. No runtime value is written to `.openai/hosting.json`.

## A4 — Obtain a short-lived source credential and push exact HEAD

Use the credential returned by create when still unexpired; otherwise call:

```json
{
  "tool": "mcp__codex_apps__sites_create_source_repository_w_7e7b8ba6ef73",
  "arguments": { "project_id": "<opaque project_id>" }
}
```

Require `remote_url`, `branch`, `token`, and `token_expires_at`. In one shell process, put them in temporary environment variables and run:

```powershell
git -c "http.extraHeader=Authorization: Bearer $env:SITES_REPO_TOKEN" push $env:SITES_REMOTE_URL "HEAD:$env:SITES_BRANCH"
```

Do not add a token-bearing remote, print the token, persist Git config, or reuse an expired credential. Require push success and keep the exact local `git rev-parse HEAD` SHA as `commit_sha`.

## A5 — Save and inspect a source version

Call:

```json
{
  "tool": "mcp__codex_apps__sites_save_site_version",
  "arguments": {
    "project_id": "<opaque project_id>",
    "commit_sha": "<exact pushed HEAD>"
  }
}
```

Do not supply an archive unless a later provider-approved packaging plan produces a supported archive from that exact commit. Require response `source.commit_sha` equal pushed HEAD and retain response `id` as `version_id`. Call `mcp__codex_apps__sites_get_site_version({ project_id, version_id })` and recheck the SHA. A build or save error indicating an unsupported application entrypoint stops publication and requires a revised hosting plan; do not convert frameworks opportunistically.

## A6 — Obtain open-world approval and deploy the saved version

Because access is public, the executor must surface the connector's explicit open-world production approval immediately before calling:

```json
{
  "tool": "mcp__codex_apps__sites_deploy_site_version",
  "arguments": {
    "project_id": "<opaque project_id>",
    "version_id": "<opaque saved version_id>"
  }
}
```

Never call the private deployment operation for a public site. Retain returned deployment `id`, require the same project/version IDs, and accept only `pending`, `building`, `publishing`, `succeeded`, or `failed`.

## A7 — Poll, bind the canonical URL, and redeploy if needed

While non-terminal, call `mcp__codex_apps__sites_get_deployment_status({ project_id, version_id, deployment_id })` with waits under 60 seconds. On failure, report `failure_message` and stop. On success, require an HTTPS `url`.

If A3 omitted `PUBLIC_BASE_URL` or used a different URL:

1. call `sites_update_environment_variables` setting only `PUBLIC_BASE_URL` to the successful HTTPS URL;
2. deploy the same saved `version_id` again with a new explicit open-world approval;
3. poll the new deployment to `succeeded`;
4. require its URL equal the configured URL.

Finally call `sites_get_site` and require `current_live_url`, public access, active status, and the expected slug. Then run the repository's live smoke and release checks against that exact URL.

