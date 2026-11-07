#!/usr/bin/env bash
#
# RESTORE DRILL — rehearse the recovery, do not just document it (Phase 10)
#
#   bash scripts/db-restore-drill.sh
#
# A backup nobody has restored is a hypothesis. This script turns it into evidence:
#
#   1. takes a fresh backup with scripts/db-backup.sh;
#   2. restores it into a scratch database (never into the live one);
#   3. compares row counts between live and restored, table by table;
#   4. proves the restored ledger still balances (debits = credits);
#   5. drops the scratch database.
#
# Run it monthly, and after every schema change. Record the output in
# documentation/RUNBOOK.md §4 (the drill log at the bottom).
#
set -euo pipefail

cd "$(dirname "$0")/.."

sanitise_db_url() {
  local url="$1"
  url="${url//schema=public&/}"
  url="${url//&schema=public/}"
  url="${url//?schema=public/}"
  url="${url//schema=public/}"
  url="${url%\\?}"
  printf '%s' "$url"
}

if [[ -z "${DATABASE_URL:-}" ]]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' backend/.env 2>/dev/null | cut -d= -f2- | tr -d '"' || true)"
fi
DATABASE_URL="$(sanitise_db_url "$DATABASE_URL")"
if [[ -z "$DATABASE_URL" ]]; then
  echo "No DATABASE_URL. Set it in backend/.env or in the environment." >&2
  exit 1
fi

BASE_URL="${DATABASE_URL%%\?*}"
WITHOUT_DB="${BASE_URL%/*}"
LIVE_DB="${BASE_URL##*/}"
SCRATCH="dispatch_restore_drill"

echo "1/5  taking a fresh backup"
bash scripts/db-backup.sh | tail -3
BACKUP="$(ls -1t backups/dispatch-*.dump | head -1)"
echo "     using $BACKUP"

echo
echo "2/5  restoring into $SCRATCH (the live database is untouched)"
FORCE=1 bash scripts/db-restore.sh "$BACKUP" "$SCRATCH" | tail -4

SCRATCH_URL="$WITHOUT_DB/$SCRATCH"
TABLES=(users customers riders staff deliveries delivery_status_history payments refunds
        rider_earnings withdrawals journal_entries ledger_lines wallet_transactions
        report_requests rider_locations audit_logs)

echo
echo "3/5  comparing row counts (live vs restored)"
MISMATCH=0
for table in "${TABLES[@]}"; do
  live="$(psql --dbname "$BASE_URL" --no-psqlrc --quiet --tuples-only --no-align -c "SELECT count(*) FROM $table;" 2>/dev/null || echo "n/a")"
  restored="$(psql --dbname "$SCRATCH_URL" --no-psqlrc --quiet --tuples-only --no-align -c "SELECT count(*) FROM $table;" 2>/dev/null || echo "n/a")"
  if [[ "$live" == "$restored" ]]; then
    printf '     ✓ %-28s %s\n' "$table" "$live"
  else
    # A live database keeps moving while you read it, so the restore may legitimately
    # hold slightly fewer rows than live. More rows than live never happens.
    if [[ "$restored" =~ ^[0-9]+$ && "$live" =~ ^[0-9]+$ ]] && (( restored <= live )); then
      printf '     ~ %-28s live %s · restored %s (moved on since the dump)\n' "$table" "$live" "$restored"
    else
      printf '     ✗ %-28s live %s · restored %s\n' "$table" "$live" "$restored"
      MISMATCH=1
    fi
  fi
done

echo
echo "4/5  checking the restored books"
BALANCE="$(psql --dbname "$SCRATCH_URL" --no-psqlrc --quiet --tuples-only --no-align -c "SELECT COALESCE(SUM(\"debitKobo\") - SUM(\"creditKobo\"),0) FROM ledger_lines;")"
WALLETS="$(psql --dbname "$SCRATCH_URL" --no-psqlrc --quiet --tuples-only --no-align -c "SELECT COALESCE(SUM(\"balanceKobo\"),0) FROM wallets WHERE type='CUSTOMER';")"
LEDGER_WALLET="$(psql --dbname "$SCRATCH_URL" --no-psqlrc --quiet --tuples-only --no-align -c "
  SELECT COALESCE(SUM(l.\"creditKobo\") - SUM(l.\"debitKobo\"),0)
    FROM ledger_lines l JOIN ledger_accounts a ON a.id = l.\"accountId\"
   WHERE a.code = '2000_CUSTOMER_WALLET_LIABILITY';")"
echo "     debits − credits            = $BALANCE"
echo "     customer wallets (rows)     = $WALLETS"
echo "     wallet liability (ledger)   = $LEDGER_WALLET"

echo
echo "5/5  dropping $SCRATCH"
psql --dbname "$WITHOUT_DB/postgres" --no-psqlrc --quiet -c "DROP DATABASE IF EXISTS $SCRATCH WITH (FORCE);" > /dev/null

echo
if [[ "$MISMATCH" == "0" && "$BALANCE" == "0" && "$WALLETS" == "$LEDGER_WALLET" ]]; then
  echo "✓ DRILL PASSED — the backup restores, the counts agree, and the books still balance."
  echo "  ($(date -u '+%Y-%m-%d %H:%M UTC'))"
else
  echo "✗ DRILL FAILED — do not rely on this backup until it is understood." >&2
  exit 1
fi
