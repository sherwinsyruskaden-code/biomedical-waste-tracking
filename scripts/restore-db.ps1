# Restore a backup made by backup-db.ps1. THIS REPLACES the current data.
# Usage:  .\scripts\restore-db.ps1 backups\bwts-20261018-120000.dump
param([Parameter(Mandatory = $true)][string]$File)
$ErrorActionPreference = "Stop"
$container = docker compose ps -q db 2>$null
if ($container) {
  Get-Content -AsByteStream $File | docker compose exec -T db pg_restore -U bwts -d bwts --clean --if-exists
} else {
  pg_restore --dbname="$env:DATABASE_URL" --clean --if-exists $File
}
Write-Host "Restored $File"
