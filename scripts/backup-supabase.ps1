# ============================================================
# Weekly Supabase backup
# ============================================================
# Reads SUPABASE_DB_URL from .env.local, runs pg_dump against the
# public schema, writes a timestamped .sql file to the backup dir.
#
# Usage:
#   Right-click backup-supabase.bat -> Run, OR double-click the .bat.
#
# To restore (manual): psql "<SUPABASE_DB_URL>" -f dz-YYYY-MM-DD-HHmm.sql
# ============================================================

$ErrorActionPreference = 'Stop'

$pgDump  = 'C:\Program Files\PostgreSQL\18\bin\pg_dump.exe'
$envFile = Join-Path $PSScriptRoot '..\.env.local'
$outDir  = 'C:\Users\bstefely.NPCSEALANTS\Documents\DynastyZeus Backups'

if (-not (Test-Path $pgDump)) {
  throw "pg_dump not found at $pgDump. Update `$pgDump in this script if PostgreSQL is installed elsewhere."
}
if (-not (Test-Path $envFile)) {
  throw ".env.local not found at $envFile"
}

# Parse SUPABASE_DB_URL out of .env.local
$dbUrl = $null
foreach ($raw in Get-Content $envFile) {
  $line = $raw.Trim()
  if (-not $line -or $line.StartsWith('#')) { continue }
  if ($line -match '^SUPABASE_DB_URL\s*=\s*(.+)$') {
    $val = $matches[1].Trim()
    if ($val.StartsWith('"') -and $val.EndsWith('"')) {
      $val = $val.Substring(1, $val.Length - 2)
    } elseif ($val.StartsWith("'") -and $val.EndsWith("'")) {
      $val = $val.Substring(1, $val.Length - 2)
    }
    $dbUrl = $val
    break
  }
}
if (-not $dbUrl) {
  throw "SUPABASE_DB_URL not found in $envFile. Add a line like:`n  SUPABASE_DB_URL=postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres"
}

if (-not (Test-Path $outDir)) {
  New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

$stamp   = Get-Date -Format 'yyyy-MM-dd-HHmm'
$outFile = Join-Path $outDir "dz-$stamp.sql"

Write-Host ""
Write-Host "Dumping public schema..." -ForegroundColor Cyan
Write-Host "  -> $outFile"
Write-Host ""

& $pgDump $dbUrl --schema=public --no-owner --no-privileges --file=$outFile
if ($LASTEXITCODE -ne 0) {
  throw "pg_dump failed with exit code $LASTEXITCODE"
}

$sizeMb = [math]::Round((Get-Item $outFile).Length / 1MB, 2)
Write-Host ""
Write-Host "Backup complete: $outFile ($sizeMb MB)" -ForegroundColor Green
Write-Host ""
