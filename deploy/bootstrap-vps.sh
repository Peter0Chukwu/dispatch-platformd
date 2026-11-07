#!/usr/bin/env bash
#
# VPS BOOTSTRAP — turn a fresh Ubuntu/Debian box into a host this platform can run on
#
#   sudo bash deploy/bootstrap-vps.sh              # dry run: prints what it would do
#   sudo bash deploy/bootstrap-vps.sh --apply      # actually do it
#
# Idempotent: running it twice changes nothing the second time.
#
# What it does, in this order, and why the order matters:
#
#   1. Timezone -> Africa/Lagos. Every timestamp in the platform (ledger, audit log,
#      delivery history) is meant to be read by a Nigerian operator.
#   2. Base packages + Docker from Docker's own repository (Ubuntu's `docker.io` is
#      too old for `docker compose`).
#   3. Swap, only if the box has less than 2 GB of RAM. A 1 GB VPS with Postgres,
#      Redis, the API and nginx will OOM during a `prisma migrate` without it.
#   4. Docker log rotation. The default json-file driver grows without limit and
#      fills the disk — usually discovered at 03:00.
#   5. Firewall: SSH FIRST, then 80/443, and only then is it enabled. Doing this in
#      the other order locks you out of your own server.
#
# What it deliberately does NOT do:
#   · install TLS (that is Caddy, in deploy/Caddyfile.example — see the roadmap)
#   · start the platform, create deploy/.env, or touch the database
#   · harden SSH beyond keeping it open — key-only auth is a decision for you
#
set -euo pipefail

APPLY=0
[[ "${1:-}" == "--apply" ]] && APPLY=1

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
step() { printf '  → %s\n' "$*"; }
run()  {
  if [[ $APPLY -eq 1 ]]; then
    "$@"
  else
    printf '  [dry-run] %s\n' "$*"
  fi
}

if [[ $EUID -ne 0 ]]; then
  echo "✗ Run this as root:  sudo bash $0 ${*:-}" >&2
  exit 1
fi

if ! command -v apt-get >/dev/null; then
  echo "✗ This script targets Ubuntu/Debian (apt-get not found)." >&2
  exit 1
fi

[[ $APPLY -eq 0 ]] && echo "DRY RUN — nothing will change. Re-run with --apply to execute."

# ── 1. timezone ──────────────────────────────────────────────────────────────
say "1. Timezone"
if [[ "$(timedatectl show -p Timezone --value 2>/dev/null || echo '')" == "Africa/Lagos" ]]; then
  step "already Africa/Lagos"
else
  run timedatectl set-timezone Africa/Lagos
fi
run apt-get install -y --no-install-recommends tzdata

# ── 2. packages + docker ─────────────────────────────────────────────────────
say "2. Base packages and Docker"
run apt-get update
run apt-get install -y --no-install-recommends ca-certificates curl gnupg ufw git openssl

if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
  step "docker + compose plugin already present ($(docker --version))"
else
  step "installing Docker from get.docker.com (idempotent)"
  run bash -c 'curl -fsSL https://get.docker.com | sh'
fi

# ── 3. swap, only when the box is small ──────────────────────────────────────
say "3. Swap"
MEM_MB=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
if [[ -f /swapfile ]]; then
  step "swapfile already exists ($(swapon --show=SIZE --noheadings 2>/dev/null | head -1))"
elif [[ $MEM_MB -lt 2048 ]]; then
  step "only ${MEM_MB} MB RAM — creating a 2 GB swapfile"
  run fallocate -l 2G /swapfile
  run chmod 600 /swapfile
  run mkswap /swapfile
  run swapon /swapfile
  run bash -c 'grep -q "^/swapfile" /etc/fstab || echo "/swapfile none swap sw 0 0" >> /etc/fstab'
else
  step "${MEM_MB} MB RAM — no swap needed"
fi

# ── 4. docker log rotation ───────────────────────────────────────────────────
say "4. Docker log rotation"
if [[ -f /etc/docker/daemon.json ]] && grep -q '"max-size"' /etc/docker/daemon.json; then
  step "daemon.json already configures rotation"
else
  step "writing /etc/docker/daemon.json (50 MB x 3 per container)"
  if [[ $APPLY -eq 1 ]]; then
    mkdir -p /etc/docker
    cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "50m", "max-file": "3" }
}
JSON
    systemctl restart docker
  else
    printf '  [dry-run] write /etc/docker/daemon.json and restart docker\n'
  fi
fi

# ── 5. firewall — SSH first, enable last ─────────────────────────────────────
say "5. Firewall"
step "allowing OpenSSH, 80, 443 — then enabling"
run ufw allow OpenSSH
run ufw allow 80/tcp
run ufw allow 443/tcp
if [[ $APPLY -eq 1 ]]; then
  ufw --force enable
  ufw status verbose
else
  printf '  [dry-run] ufw --force enable\n'
fi

# ── summary ──────────────────────────────────────────────────────────────────
say "Done"
cat <<'NEXT'
Next steps (see documentation/DEPLOYMENT-ROADMAP.md):

  sudo mkdir -p /opt/dispatch && cd /opt/dispatch
  git clone https://github.com/<you>/dispatch-platform.git .
  cp deploy/.env.example deploy/.env && nano deploy/.env     # replace every CHANGE_ME
  openssl rand -hex 48                                       # once per secret

  docker compose build          # the first build is the real test — watch it
  docker compose up -d migrate  # applies migrations, then exits 0
  docker compose up -d api web
  curl -fsS http://127.0.0.1:8080/api/v1/health | jq

TLS is not installed by this script: put Caddy in front (deploy/Caddyfile.example)
so the containers stay on loopback and only 80/443 are public.
NEXT

if [[ $APPLY -eq 0 ]]; then
  echo
  echo "This was a DRY RUN. Re-run with:  sudo bash $0 --apply"
fi
