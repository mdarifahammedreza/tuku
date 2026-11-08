#!/usr/bin/env bash
# Usage: scripts/backup.sh            -> backups/finance-YYYYmmdd-HHMMSS.archive.gz (keeps last 30)
# Cron (daily 03:00): 0 3 * * * cd /path/to/finace-bot && scripts/backup.sh >> backups/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
mkdir -p backups
out="backups/finance-$(date +%Y%m%d-%H%M%S).archive.gz"
docker compose exec -T mongo mongodump --quiet --archive --gzip \
  -u "$MONGO_USER" -p "$MONGO_PASSWORD" --authenticationDatabase admin --db finance > "$out.tmp"
mv "$out.tmp" "$out"
ls -1t backups/finance-*.archive.gz | tail -n +31 | xargs -r rm --
echo "Backup written: $out ($(du -h "$out" | cut -f1))"
