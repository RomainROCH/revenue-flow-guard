<#
.SYNOPSIS
    Publish the approved repository.  Requires all RFG_PUBLIC_* variables
    exported by export-publication-env.ps1, then creates or pushes the
    GitHub repository using gh and git.  Never force-pushes.
#>

# ------------------------------------------------------------------ required vars
$requiredVars = @(
    'RFG_PUBLIC_REPOSITORY'
    'RFG_PUBLIC_DESCRIPTION'
    'RFG_PUBLIC_OFFER_NAME'
    'RFG_PUBLIC_OFFER_SUMMARY'
    'RFG_PUBLIC_CONTACT_URL'
    'RFG_PUBLIC_CONTACT_LABEL'
    'RFG_PUBLIC_HOSTING_PROVIDER'
    'RFG_PUBLIC_SITE_SLUG'
    'RFG_PUBLIC_VISIBILITY'
    'RFG_PUBLIC_ACCESS_MODE'
)

foreach ($var in $requiredVars) {
    $value = [Environment]::GetEnvironmentVariable($var)
    if ([string]::IsNullOrWhiteSpace($value)) {
        Write-Output "PUBLICATION_REPOSITORY: missing required variable $var"
        exit 1
    }
}

# --------------------------------------------------------------- value validation
if ($env:RFG_PUBLIC_VISIBILITY -ne 'public') {
    Write-Output 'PUBLICATION_REPOSITORY: visibility must be public'
    exit 1
}

if ($env:RFG_PUBLIC_ACCESS_MODE -ne 'public') {
    Write-Output 'PUBLICATION_REPOSITORY: accessMode must be public'
    exit 1
}

if ($env:RFG_PUBLIC_REPOSITORY -notmatch '^[a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+$') {
    Write-Output 'PUBLICATION_REPOSITORY: malformed repository (expected owner/name)'
    exit 1
}

if ($env:RFG_PUBLIC_DESCRIPTION -match '[\x00-\x1f\x7f]') {
    Write-Output 'PUBLICATION_REPOSITORY: description contains control characters'
    exit 1
}

$descTrimmed = $env:RFG_PUBLIC_DESCRIPTION.Trim()
if ($descTrimmed.Length -lt 1 -or $descTrimmed.Length -gt 240) {
    Write-Output 'PUBLICATION_REPOSITORY: description must be 1-240 characters'
    exit 1
}

# --------------------------------------------------------------- tool availability
Get-Command gh -ErrorAction Stop | Out-Null
Get-Command git -ErrorAction Stop | Out-Null

# --------------------------------------------------------------- git prerequisites
$status = & git status --porcelain
if ($LASTEXITCODE -ne 0 -or $status) {
    Write-Output 'PUBLICATION_REPOSITORY: worktree is not clean'
    exit 1
}

$branchResult = & git branch --show-current
if ($LASTEXITCODE -ne 0) {
    Write-Output 'PUBLICATION_REPOSITORY: failed to get current branch'
    exit 1
}
$branch = "$branchResult".Trim()
if ($branch -ne 'main') {
    Write-Output 'PUBLICATION_REPOSITORY: current branch must be main'
    exit 1
}

# ------------------------------------------------------------------- gh auth
& gh auth status
if ($LASTEXITCODE -ne 0) {
    Write-Output 'PUBLICATION_REPOSITORY: not authenticated with GitHub CLI'
    exit 1
}

# ------------------------------------------------------- repo existence check
$savedErrorAction = $ErrorActionPreference
try {
    $ErrorActionPreference = 'Continue'
    $repoView = & gh repo view $env:RFG_PUBLIC_REPOSITORY --json nameWithOwner 2>&1
    $viewExitCode = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $savedErrorAction
}
if ($viewExitCode -eq 0) {
    # ---- repo already exists ----
    try {
        $viewResult = $repoView | ConvertFrom-Json
    } catch {
        Write-Output 'PUBLICATION_REPOSITORY: failed to parse repository view result'
        exit 1
    }
    if ($null -eq $viewResult -or $viewResult.nameWithOwner -ne $env:RFG_PUBLIC_REPOSITORY) {
        Write-Output 'PUBLICATION_REPOSITORY: remote repository name does not match'
        exit 1
    }

    $originUrl = & git remote get-url origin 2>&1
    if ($LASTEXITCODE -eq 0) {
        $originTrimmed = $originUrl.Trim()
        $canonicalHttps = "https://github.com/$($env:RFG_PUBLIC_REPOSITORY).git"
        $canonicalSsh = "git@github.com:$($env:RFG_PUBLIC_REPOSITORY).git"
        if ($originTrimmed -ne $canonicalHttps -and $originTrimmed -ne $canonicalSsh) {
            Write-Output 'PUBLICATION_REPOSITORY: origin URL does not match approved repository'
            exit 1
        }
    } else {
        & git remote add origin "https://github.com/$($env:RFG_PUBLIC_REPOSITORY).git"
        if ($LASTEXITCODE -ne 0) {
            Write-Output 'PUBLICATION_REPOSITORY: failed to add origin remote'
            exit 1
        }
    }

    & git push -u origin main
    if ($LASTEXITCODE -ne 0) {
        Write-Output 'PUBLICATION_REPOSITORY: git push failed'
        exit 1
    }
} else {
    # ---- repo lookup failed ----
    $viewOutput = @($repoView | ForEach-Object { "$_" }) -join "`n"
    $isNotFound = [string]::IsNullOrWhiteSpace($viewOutput) -or
        ($viewOutput -imatch 'Could not resolve to a Repository') -or
        ($viewOutput -imatch 'HTTP 404')

    if (-not $isNotFound) {
        Write-Output 'PUBLICATION_REPOSITORY: repository lookup failed; refusing to create'
        exit 1
    }

    # ---- repo does not exist, create it ----
    $ghCreateArgs = @(
        'repo', 'create', $env:RFG_PUBLIC_REPOSITORY
        '--public'
        '--description', $env:RFG_PUBLIC_DESCRIPTION
        '--source', '.'
        '--remote', 'origin'
        '--push'
    )
    & gh @ghCreateArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Output 'PUBLICATION_REPOSITORY: gh repo create failed'
        exit 1
    }
}
