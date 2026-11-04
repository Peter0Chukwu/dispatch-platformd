#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Starts the local development services: PostgreSQL 17 + Redis 8.
# Safe to run repeatedly. Installs the packages if they are missing.
#
#   ./scripts/dev-env-up.sh
#
# Postgres data lives OUTSIDE the project (in /var/lib/postgresql) on purpose:
# database clusters do not belong in a git repo or a file-sync folder.
# ---------------------------------------------------------------------------
set -euo pipefail

PG_VERSION=17
DB_NAME="${DB_NAME:-dispatch_dev}"
DB_USER="${DB_USER:-dispatch}"
DB_PASSWORD="${DB_PASSWORD:-dispatch_dev_password}"

echo "▶ Checking PostgreSQL ${PG_VERSION} and Redis…"
if ! command -v pg_ctlcluster >/dev/null 2>&1 || ! command -v redis-server >/dev/null 2>&1; then
  echo "  Installing postgresql-${PG_VERSION} and redis-server (needs sudo)…"
  export DEBIAN_FRONTEND=noninteractive
  sudo apt-get update -qq
  sudo apt-get install -y -qq "postgresql-${PG_VERSION}" redis-server
fi

echo "▶ Starting PostgreSQL cluster…"
if ! sudo pg_isready -q -p 5432 2>/dev/null; then
  sudo pg_ctlcluster "${PG_VERSION}" main start || true
fi
for i in $(seq 1 30); do sudo pg_isready -q -p 5432 && break; sleep 1; done
sudo pg_isready -p 5432

echo "▶ Starting Redis…"
if ! redis-cli ping >/dev/null 2>&1; then
  sudo redis-server --daemonize yes --port 6379 --bind 127.0.0.1 --save '' --appendonly no
fi
for i in $(seq 1 30); do redis-cli ping >/dev/null 2>&1 && break; sleep 1; done
echo "  redis: $(redis-cli ping)"

echo "▶ Ensuring database role + database exist…"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASSWORD}' CREATEDB;"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 \
  || sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"
# Test database (used by the automated test suite)
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}_test'" | grep -q 1 \
  || sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}_test"

echo
echo "✅ Development services ready"
echo "   PostgreSQL : postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}"
echo "   Redis      : redis://localhost:6379"
