$workspaceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $workspaceRoot

$envFilePath = Join-Path $PWD ".env"
if (Test-Path $envFilePath) {
  foreach ($line in Get-Content -Path $envFilePath) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) {
      continue
    }

    $separatorIndex = $trimmed.IndexOf("=")
    if ($separatorIndex -lt 1) {
      continue
    }

    $name = $trimmed.Substring(0, $separatorIndex).Trim()
    $value = $trimmed.Substring($separatorIndex + 1).Trim()
    if (-not $name) {
      continue
    }

    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

$env:NODE_ENV = "production"
if (-not $env:PORT) {
  $env:PORT = "8080"
}
if (-not $env:UPUSE_TRUST_PROXY) {
  $env:UPUSE_TRUST_PROXY = "1"
}
if (-not $env:UPUSE_CORS_ORIGINS) {
  $env:UPUSE_CORS_ORIGINS = "https://upuse.org"
}

if (-not $env:UPUSE_SECRET) {
  throw "UPUSE_SECRET is required in production."
}

if ($env:UPUSE_SECRET.Trim() -eq "dev-secret") {
  throw "UPUSE_SECRET must not use the legacy development secret in production."
}

npm run build
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

npm run start
