#!/usr/bin/env bash
# Usage: scripts/restore.sh backups/finance-YYYYmmdd-HHMMSS.archive.gz
# Replaces the current 'finance' database with the backup (a safety backup is taken first).
set -euo pipefail
cd "$(dirname "$0")/.."
file="${1:?usage: scripts/restore.sh <backup.archive.gz>}"
[ -f "$file" ] || { echo "No such file: $file"; exit 1; }
set -a; source .env; set +a
read -rp "This will REPLACE the finance database with $file. Type 'restore' to continue: " ok
[ "$ok" = "restore" ] || { echo "Aborted."; exit 1; }
scripts/backup.sh
docker compose exec -T mongo mongorestore --quiet --archive --gzip --drop \
  -u "$MONGO_USER" -p "$MONGO_PASSWORD" --authenticationDatabase admin --nsInclude 'finance.*' < "$file"
echo "Restored from $file. Restart services: docker compose restart web bot mcp"
