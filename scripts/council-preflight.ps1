# Read-only preflight: reports missing configuration names; never prints secret values.
param([string]$Repository = "oosaka0123-sudo/ai-development-orchestrator")
$ErrorActionPreference = "Stop"
$failed = $false

function Check-NamedSettings([string]$kind, [string[]]$required) {
  $json = if ($kind -eq "secret") {
    gh secret list --repo $Repository --json name
  } else {
    gh variable list --repo $Repository --json name
  }
  if ($LASTEXITCODE -ne 0) { throw "Cannot read GitHub $kind names" }
  $present = @($json | ConvertFrom-Json | ForEach-Object { $_.name })
  foreach ($name in $required) {
    $ok = $present -contains $name
    $status = if ($ok) { "OK" } else { "MISSING" }
    Write-Output "$kind $name : $status"
    if (-not $ok) { $script:failed = $true }
  }
}
Check-NamedSettings "secret" @("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "COUNCIL_GCP_WIF_PROVIDER", "COUNCIL_GCP_SERVICE_ACCOUNT")
Check-NamedSettings "variable" @("COUNCIL_GCP_PROJECT", "OPENAI_COUNCIL_MODEL", "ANTHROPIC_COUNCIL_MODEL", "GEMINI_COUNCIL_MODEL", "COUNCIL_MODEL_PRICING_JSON", "COUNCIL_USD_JPY_BUDGET_RATE")

$gcloud = Get-Command gcloud -ErrorAction SilentlyContinue
if (-not $gcloud) {
  $known = Join-Path $env:LOCALAPPDATA "Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
  if (Test-Path $known) { $gcloud = $known }
}
if (-not $gcloud) {
  Write-Output "gcloud : NOT INSTALLED"
  $failed = $true
} else {
  $accounts = @(& $gcloud auth list --format="value(account)" 2>$null)
  if ($LASTEXITCODE -ne 0 -or $accounts.Count -eq 0 -or -not ($accounts -join "").Trim()) {
    Write-Output "gcloud auth : MISSING"
    $failed = $true
  } else {
    Write-Output "gcloud auth : OK"
  }
}
if ($failed) { Write-Output "PREFLIGHT FAILED: production is not ready"; exit 1 }
Write-Output "PREFLIGHT PASSED: credentials exist; IAM, pricing, billing and real API calls still require verification"
