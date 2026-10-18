#!/usr/bin/env sh
# Back up the database (macOS/Linux). Usage: ./scripts/backup-db.sh
set -e
mkdir -p backups
out="backups/bwts-$(date +%Y%m%d-%H%M%S).dump"
if [ -n "$(docker compose ps -q db 2>/dev/null)" ]; then docker compose exec -T db pg_dump -U bwts -d bwts -Fc > "$out"; else pg_dump --dbname="$DATABASE_URL" -Fc -f "$out"; fi
echo "Backup written to $out"
