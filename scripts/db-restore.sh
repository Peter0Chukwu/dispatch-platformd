#!/usr/bin/env bash
#
# RESTORE (Phase 10)
#
#   bash scripts/db-restore.sh backups/dispatch-20261105-133000.dump          # into DATABASE_URL
#   bash scripts/db-restore.sh backups/dispatch-....dump dispatch_restore_drill  # into another db
#
# This is deliberately blunt: it DROPS AND RECREATES the target database. That is the
# honest behaviour of a restore — a "merge" of a backup into live data is how bad
# restores quietly corrupt a business.
#
# Safety: if the target database is not empty and looks like a live one, it asks.
# `FORCE=1` skips the prompt for automated drills.
#
set -euo pipefail

cd "$(dirname "$0")/.."

FILE="${1:-}"
TARGET_DB="${2:-}"

if [[ -z "$FILE" || ! -f "$FILE" ]]; then
  echo "Usage: bash scripts/db-restore.sh <backup.dump> [target-database]" >&2
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

DATABASE_URL="${DATABASE_URL:-$(grep -E '^DATABASE_URL=' backend/.env 2>/dev/null | cut -d= -f2- | tr -d '"' || true)}"
if [[ -z "$DATABASE_URL" ]]; then
  echo "✗ No DATABASE_URL. Set it in backend/.env or in the environment." >&2
  exit 1
fi

DATABASE_URL="$(sanitise_db_url "$DATABASE_URL")"

# Split the connection URL so the same credentials can point at another database.
BASE_URL="${DATABASE_URL%%\?*}"
QUERY=""
[[ "$DATABASE_URL" == *\?* ]] && QUERY="?${DATABASE_URL#*\?}"
WITHOUT_DB="${BASE_URL%/*}"
CURRENT_DB="${BASE_URL##*/}"
TARGET_DB="${TARGET_DB:-$CURRENT_DB}"
TARGET_URL="$WITHOUT_DB/$TARGET_DB$QUERY"
ADMIN_URL="$WITHOUT_DB/postgres$QUERY"

psql_admin() { psql --dbname "$ADMIN_URL" --no-psqlrc --quiet --tuples-only --no-align -c "$1"; }

# Checksum, if one was written with the backup.
if [[ -f "$FILE.sha256" ]]; then
  if sha256sum --check --status "$FILE.sha256"; then
    echo "✓ checksum matches $FILE.sha256"
  else
    echo "✗ CHECKSUM MISMATCH — this backup is damaged. Stop and find another one." >&2
    exit 1
  fi
fi

if [[ "$TARGET_DB" == "$CURRENT_DB" && "${FORCE:-0}" != "1" ]]; then
  echo "⚠  This will DROP the database '$TARGET_DB' and rebuild it from $FILE."
  read -r -p "   Type the database name to continue: " answer
  if [[ "$answer" != "$TARGET_DB" ]]; then
    echo "Aborted — nothing was changed."
    exit 1
  fi
fi

echo "Dropping and recreating $TARGET_DB"
psql_admin "DROP DATABASE IF EXISTS $TARGET_DB WITH (FORCE);" > /dev/null
psql_admin "CREATE DATABASE $TARGET_DB;" > /dev/null

echo "Restoring $FILE"
pg_restore --dbname "$TARGET_URL" --no-owner --no-privileges --clean --if-exists "$FILE" || {
  status=$?
  # 1 means "finished with warnings" (e.g. dropping objects that were not there).
  if [[ $status -ne 1 ]]; then
    echo "✗ pg_restore failed with status $status" >&2
    exit $status
  fi
  echo "· restore finished with warnings (dropped objects that did not exist)"
}

COUNTS="$(psql --dbname "$TARGET_URL" --no-psqlrc --quiet --tuples-only --no-align -c "
  SELECT 'users=' || (SELECT count(*) FROM users)
      || ' deliveries=' || (SELECT count(*) FROM deliveries)
      || ' payments=' || (SELECT count(*) FROM payments)
      || ' journal_lines=' || (SELECT count(*) FROM ledger_lines);")"

echo "✓ restored: $COUNTS"
echo "✓ database '$TARGET_DB' is ready"

# A restore that leaves the books unbalanced is not a restore.
BALANCE="$(psql --dbname "$TARGET_URL" --no-psqlrc --quiet --tuples-only --no-align -c "
  SELECT COALESCE(SUM(\"debitKobo\") - SUM(\"creditKobo\"), 0) FROM ledger_lines;")"
echo "✓ ledger debits − credits = $BALANCE"
if [[ "$BALANCE" != "0" ]]; then
  echo "✗ The restored ledger does not balance. Investigate before trusting this restore." >&2
  exit 1
fi
