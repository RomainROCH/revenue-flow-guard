<#
.SYNOPSIS
    Dot-source from repository root to load approved publication inputs as
    RFG_PUBLIC_* environment variables.  Fails closed when the approval
    record is missing or invalid; prints no record values or secrets.
#>
Get-ChildItem Env:RFG_PUBLIC_* -ErrorAction SilentlyContinue | Remove-Item

$validator = Join-Path $PSScriptRoot "validate-publication-inputs.mjs"
& node $validator "--root" (Get-Location).Path
if ($LASTEXITCODE -ne 0) { throw 'PUBLICATION_INPUTS:validation failed' }

$inputsPath = Join-Path (Get-Location).Path ".publication-inputs.json"
$record = Get-Content $inputsPath -Raw | ConvertFrom-Json

$env:RFG_PUBLIC_REPOSITORY = $record.repository
$env:RFG_PUBLIC_DESCRIPTION = $record.description
$env:RFG_PUBLIC_OFFER_NAME = $record.offerName
$env:RFG_PUBLIC_OFFER_SUMMARY = $record.offerSummary
$env:RFG_PUBLIC_CONTACT_URL = $record.contactUrl
$env:RFG_PUBLIC_CONTACT_LABEL = $record.contactLabel
$env:RFG_PUBLIC_HOSTING_PROVIDER = $record.hostingProvider
$env:RFG_PUBLIC_SITE_SLUG = $record.siteSlug
$env:RFG_PUBLIC_VISIBILITY = $record.visibility
$env:RFG_PUBLIC_ACCESS_MODE = $record.accessMode
