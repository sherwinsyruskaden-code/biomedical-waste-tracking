# Back up the BWTS database to backups\bwts-<timestamp>.dump (PostgreSQL custom format).
# Usage (PowerShell, from the project folder):  .\scripts\backup-db.ps1
# Uses the Docker "db" container if it is running, otherwise a local pg_dump on PATH.
$ErrorActionPreference = "Stop"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
New-Item -ItemType Directory -Force -Path "backups" | Out-Null
$out = "backups\bwts-$stamp.dump"
$container = docker compose ps -q db 2>$null
if ($container) {
  docker compose exec -T db pg_dump -U bwts -d bwts -Fc > $out
} else {
  pg_dump --dbname="$env:DATABASE_URL" -Fc -f $out
}
Write-Host "Backup written to $out"
