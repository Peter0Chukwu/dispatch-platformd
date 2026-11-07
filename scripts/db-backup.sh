#!/usr/bin/env bash
#
# BACKUP — one command, one file, checksummed (Phase 10)
#
#   bash scripts/db-backup.sh                    # write a backup
#   bash scripts/db-backup.sh --dir /mnt/backups # somewhere else
#
# What it does, and why each part matters:
#   · `pg_dump -Fc` (custom format) — compressed, and restorable table-by-table.
#   · writes a `.sha256` next to it — a backup you cannot checksum is a rumour.
#   · refuses to write an empty or failed dump — a 0-byte file that "succeeded" is
#     how people discover on a bad day that they had no backups at all.
#   · keeps the last BACKUP_KEEP runs (default 14) and deletes older ones.
#
# Restore procedure (rehearsed — see documentation/RUNBOOK.md §4):
#   bash scripts/db-restore.sh backups/dispatch-YYYYmmdd-HHMMSS.dump
#
set -euo pipefail

cd "$(dirname "$0")/.."

DIR="backups"
if [[ "${1:-}" == "--dir" && -n "${2:-}" ]]; then
  DIR="$2"
fi

DATABASE_URL="${DATABASE_URL:-$(grep -E '^DATABASE_URL=' backend/.env 2>/dev/null | cut -d= -f2- | tr -d '"' || true)}"
if [[ -z "$DATABASE_URL" ]]; then
  echo "✗ No DATABASE_URL. Set it in backend/.env or in the environment." >&2
  exit 1
fi


# Prisma accepts `?schema=public` in DATABASE_URL; libpq (pg_dump/pg_restore/psql) does
# not. Strip the Prisma-only parameter and leave everything else (sslmode, etc.) alone.
sanitise_db_url() {
  local url="$1"
  url="${url//schema=public&/}"
  url="${url//&schema=public/}"
  url="${url//?schema=public/}"
  url="${url//schema=public/}"
  url="${url%\?}"
  printf '%s' "$url"
}

DATABASE_URL="$(sanitise_db_url "$DATABASE_URL")"
KEEP="${BACKUP_KEEP:-14}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
FILE="$DIR/dispatch-$STAMP.dump"

mkdir -p "$DIR"

echo "Backing up to $FILE"
pg_dump --format=custom --no-owner --no-privileges --file="$FILE" "$DATABASE_URL"

BYTES="$(stat -c%s "$FILE" 2>/dev/null || stat -f%z "$FILE")"
if [[ "$BYTES" -lt 10000 ]]; then
  echo "✗ Dump is only $BYTES bytes — that is not a real backup. Aborting." >&2
  exit 1
fi

sha256sum "$FILE" > "$FILE.sha256"

# Prove the archive is readable before declaring success.
pg_restore --list "$FILE" > /dev/null

echo "✓ $FILE (${BYTES} bytes)"
echo "✓ checksum written to $FILE.sha256"
echo "✓ archive listing verified with pg_restore --list"

# Retention.
mapfile -t OLD < <(ls -1t "$DIR"/dispatch-*.dump 2>/dev/null | tail -n +$((KEEP + 1)) || true)
if [[ "${#OLD[@]}" -gt 0 ]]; then
  for file in "${OLD[@]}"; do
    rm -f "$file" "$file.sha256"
    echo "· pruned $(basename "$file") (keeping the newest $KEEP)"
  done
fi
