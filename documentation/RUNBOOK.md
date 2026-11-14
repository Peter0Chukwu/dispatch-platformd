# RUNBOOK

> **Audience:** whoever is holding the pager — engineer, DevOps, or the person who built it.
> **Rule for this document:** every command is copy-pasteable, and every procedure here has
> been run at least once on this codebase. Anything that has *not* been rehearsed is labelled
> **UNTESTED** in plain words rather than dressed up.

| | |
|---|---|
| **Platform** | Dispatch — customer, rider and admin portals |
| **Shape** | NestJS API + PostgreSQL + Redis, one React SPA served by Nginx |
| **Currency / timezone** | NGN · `Africa/Lagos` (WAT, UTC+1, no DST) |
| **Repository root** | assume everything below runs from the repo root |

**Contents**

1. [What is running, and where](#1-what-is-running-and-where)
2. [Deploy](#2-deploy)
3. [Day-2 operations](#3-day-2-operations)
4. [Backup and restore](#4-backup-and-restore)
5. [Rollback](#5-rollback)
6. [Incident playbook](#6-incident-playbook)
7. [On-call](#7-on-call)
8. [Known limitations](#8-known-limitations)

---

## 1. What is running, and where

The production stack is five containers plus a named volume each for Postgres, Redis and
file storage (`docker-compose.yml`):

| Service | Image | Reachable from | Purpose |
|---|---|---|---|
| `postgres` | `postgres:17-alpine` | compose network only | the database of record |
| `redis` | `redis:8-alpine` | compose network only | rate limits, dispatch locks, Socket.IO adapter |
| `migrate` | `dispatch-api:local` | — | runs `prisma migrate deploy` once, exits |
| `api` | `dispatch-api:local` | compose network only (port 4000) | the NestJS server, runs as uid 10001 |
| `web` | `dispatch-web:local` | **the internet**, `${WEB_PORT}` (default 8080) | Nginx: the SPA, plus proxies for `/api` and `/socket.io` |

**Only `web` publishes a port.** The database, Redis and the API are not addressable from
outside the compose network. That single decision removes most of the attack surface you would
otherwise have to defend with firewall rules.

```
internet ──▶ web:80 (Nginx)
               ├── /            → static SPA files
               ├── /api/…       → api:4000/api/v1/…
               └── /socket.io/  → api:4000 (websocket upgrade)
```

Health endpoints:

| Endpoint | Means |
|---|---|
| `GET /api/v1/health/live` | process is up (used by the container healthcheck and by Nginx upstreams) |
| `GET /api/v1/health` | process **and** its dependencies — database, Redis, queue |

A deploy is healthy when, from the host:

```bash
curl -fsS http://127.0.0.1:${WEB_PORT:-8080}/api/v1/health | jq
```

…prints `"status": "ok"` and every dependency is `up`.

---

## 2. Deploy

> **Starting from nothing?** Follow `DEPLOYMENT-ROADMAP.md` instead — it is the guided, staged version of
> this section, with the gates and the long-lead items (payment KYC, SMS sender ID) that decide the date.
> What follows is the reference version, for someone who already has a server.

### 2.1 First deploy, from a clean VPS

Assumes Ubuntu 22.04/24.04, a DNS record already pointing at the box, and Docker installed.

```bash
# 0. Prepare the box (timezone, Docker, swap if small, log rotation, firewall — in
#    that order, and SSH is allowed before the firewall is enabled). Dry-run first.
sudo bash deploy/bootstrap-vps.sh
sudo bash deploy/bootstrap-vps.sh --apply

# 1. Docker is installed by the script above; to do it by hand:
#    curl -fsSL https://get.docker.com | sh

# 2. Code
git clone <your-repo-url> dispatch-platform && cd dispatch-platform

# 3. Configuration — every CHANGE_ME must be replaced
cp deploy/.env.example deploy/.env
openssl rand -hex 48   # run this four times: JWT_ACCESS_SECRET, JWT_REFRESH_SECRET,
                       # TRACKING_LINK_SECRET, POSTGRES_PASSWORD

# 4. Build and start
docker compose up -d --build
docker compose logs -f migrate   # expect a clean "migrations applied" and exit 0
docker compose logs -f api       # expect "Dispatch Platform API listening on …"

# 5. Reference data + your own super admin (never the demo fixtures in production)
docker compose run --rm seed

# 6. Prove it
curl -fsS http://127.0.0.1:8080/api/v1/health | jq
```

> **Two settings that bite silently.** `TRUST_PROXY` must match the number of proxies in front of the API
> (2 with Caddy → nginx → API); get it wrong and every user shares one rate-limit bucket.
> `WEB_BIND` defaults to `127.0.0.1`, which is right when Caddy terminates TLS on the host — but if you
> skip Caddy and expect the site to be reachable, you need `WEB_BIND=0.0.0.0` *and* your own TLS.

> **`migrate` is a one-shot service.** It must exit `0` before `api` starts
> (`service_completed_successfully`). This is why an API restart never runs migrations, and
> why scaling the API to three replicas can never produce two migrations racing each other.

> **First admin.** There is no public "make me an admin" route, by design. Either seed a
> development dataset (`npm run db:seed`, which creates `admin@dispatch.test`) or insert the
> first `User` row with `type='ADMIN'` and a bcrypt hash directly. Do this **before** putting
> the URL in front of real staff, and change the password on first sign-in.

### 2.2 Routine deploy (new version)

```bash
cd dispatch-platform
git fetch --all && git checkout <tag-or-commit>

# Take a backup BEFORE the schema changes. Always. It is one command.
bash scripts/db-backup.sh --dir /var/backups/dispatch

docker compose build api web          # build first, while the old version is still serving
docker compose up -d migrate          # apply migrations
docker compose up -d api web          # swap in the new containers
docker compose ps                     # every service Up, migrate Exited (0)
curl -fsS http://127.0.0.1:8080/api/v1/health | jq
```

**Zero-downtime?** No, and this runbook will not pretend otherwise: `api` and `web` are each a
single container, so the swap is a few seconds of 502. For a platform at this traffic level
that is the right trade. When it stops being right, run two `api` containers behind Nginx and
`up -d --scale api=2 --no-recreate`.

### 2.3 Configuration changes

`deploy/.env` is read at container start.

```bash
sudo nano deploy/.env
docker compose up -d api        # recreates only what changed
```

**Values that change behaviour and deserve care:**

| Variable | Effect if wrong |
|---|---|
| `PAYMENTS_MODE=LIVE` | real money moves. Do not flip it before `GO-LIVE-CHECKLIST.md` is ticked. |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | rotating signs **everyone** out. That is the correct response to a leak. |
| `TRACKING_LINK_SECRET` | rotating invalidates every outstanding tracking and report-download link. |
| `CORS_ORIGINS` | extra browser origins allowed to call the API. The deployment's **own** origin is always allowed (see §7 below), so this only matters when the web app and the API are on different hosts. |
| `SMS_MODE=CONSOLE` / `EMAIL_MODE=CONSOLE` | messages are **logged, not sent**. Never leave this on for real riders. |
| `MAPS_PROVIDER=STUB` | fares use the stub distance model; the UI says so. Set `GOOGLE` plus the web build arg for real maps. |

> The web build takes `VITE_GOOGLE_MAPS_API_KEY` as a **build arg**, not a runtime variable —
> it is compiled into the JavaScript. Changing it requires `docker compose build web`.

---

## 3. Day-2 operations

### 3.1 Reading the logs

```bash
docker compose logs -f api                  # follow the API
docker compose logs --since 30m api | grep -i "error\|warn"
docker compose logs api | grep SECURITY     # auth anomalies: reuse detected, lockouts
docker compose logs api | grep "\[API\]"    # one line per request: method, path, status, ms
```

The API logs one line per request with a `requestId`. The same id is returned to the client in
`error.requestId` and shown to the user as *"Reference: …"*, which is the fastest way to go
from "the customer says it broke" to the exact log line and the exact database write.

### 3.2 The queue

Reports render in a BullMQ queue. If reports sit in `QUEUED`:

```bash
docker compose exec redis redis-cli llen bull:reports:wait
docker compose exec redis redis-cli llen bull:reports:failed
docker compose exec api npx prisma db execute --stdin <<< \
  "SELECT id, status, \"createdAt\" FROM reports ORDER BY \"createdAt\" DESC LIMIT 10;"
```

A non-zero `wait` with a healthy API means the worker is not consuming — restart `api`.
A growing `failed` list almost always means a storage permission problem on the volume.

### 3.3 Dispatch looks stuck

Dispatch is a heartbeat every 5 s (`DispatchScheduler`). A delivery that nobody accepts walks
through its offers and then **raises an alert for the desk** — it does not silently vanish.
Check the board: `GET /api/v1/admin/dispatch/board`, or the admin UI's Live Dispatch page.

```bash
docker compose logs --since 10m api | grep "DispatchService"
# "Dispatch tick: 7 waiting · 0 offer(s) · 7 exhausted" = riders are offline or all busy.
```

The fix is operational, not technical: riders need to be online, or the delivery needs to be
assigned manually (`POST /api/v1/admin/deliveries/:id/assign`).

### 3.4 Disk and growth

```bash
df -h /var/lib/docker                                     # volumes live here
docker compose exec postgres psql -U dispatch -d dispatch \
  -c "SELECT pg_size_pretty(pg_database_size('dispatch'));"
```

Two things grow without bound by design, and both are pruned:

* **rider location pings** — retention `LOCATION_RETENTION_DAYS` (default 30), swept nightly.
* **backups** — the last `BACKUP_KEEP` (default 14) are kept.

Report files and uploaded documents live on the `storage-data` volume. Deleting files there
breaks rows that point at them; delete the rows first, or not at all.

---

## 4. Backup and restore

> **This section is not theoretical. It was executed on 2026-11-05 and the evidence is at the
> bottom.** A backup procedure you have never restored from is a rumour with a filename.

### 4.1 Taking a backup

```bash
bash scripts/db-backup.sh                          # → backups/dispatch-<date>.dump (+ .sha256)
bash scripts/db-backup.sh --dir /mnt/backups       # or somewhere off the box
```

What the script guarantees:

* `pg_dump -Fc` — compressed, and restorable table by table.
* a `.sha256` beside the file — a backup you cannot checksum is a rumour.
* it **refuses** to keep a 0-byte or failed dump. A file that says "succeeded" but is empty is
  how people find out on the worst day that they had no backups at all.
* retention: the newest `BACKUP_KEEP` (default 14) dumps survive; older ones are deleted.

**Copy it off the machine.** A backup on the same VPS is not a backup — it is a backup of the
VPS's ability to fail. Use whatever your provider offers (snapshot, S3, `rclone`), nightly:

```bash
# crontab -e
15 2 * * * cd /home/deploy/dispatch-platform && bash scripts/db-backup.sh --dir /var/backups/dispatch >> /var/log/dispatch-backup.log 2>&1
45 2 * * * rclone copy /var/backups/dispatch remote:dispatch-backups --include "*.dump" --include "*.sha256"
```

### 4.2 Restoring — decided in advance

Three different situations, three different commands. **Choose before you start**, because
during an incident you will not think clearly.

**A. Restore into a scratch database to *look* at old data (safe).**

```bash
createdb dispatch_scratch
DATABASE_URL="postgresql://dispatch:pass@localhost:5432/dispatch_scratch" \
  bash scripts/db-restore.sh backups/dispatch-20261105-120000.dump
```

**B. Restore over the live database (destructive — you are choosing to lose everything since
the dump).**

```bash
docker compose stop api web                 # stop writers first, or the restore races them
bash scripts/db-restore.sh backups/dispatch-20261105-120000.dump
docker compose start api web
curl -fsS http://127.0.0.1:8080/api/v1/health | jq
```

The script drops and recreates the `public` schema, then restores. It refuses a dump whose
`.sha256` does not match.

**C. Rehearse (do this quarterly, and after every schema migration).**

```bash
bash scripts/db-restore-drill.sh     # dumps, restores into dispatch_drill, compares, cleans up
```

The drill proves four things and prints a verdict for each: the table count matches, every
table's row count matches, the ledger still sums to zero (debits − credits), and wallet
liability equals the sum of wallet balances. If any of those fails, the backup is not a
backup — fix it now, not later.

> **libpq does not understand Prisma's `?schema=public`.** Every script strips it via
> `sanitise_db_url()` before calling `pg_dump`/`pg_restore`/`psql`. If you write your own
> command against the Prisma URL, do the same or you will get
> `invalid URI query parameter: "schema"`.

### 4.3 2026-11-05 drill — what actually happened

Run in the development environment, same scripts, same code path as production.

| Check | Result |
|---|---|
| Dump written | **243,946 bytes**, custom format |
| Checksum | `.sha256` written and verified before restore |
| Archive readable | `pg_restore --list` enumerated the archive |
| Tables restored | **16 of 16** |
| Row counts | identical per table — users 21, deliveries 42, payments 37, ledger_lines 217, audit_logs 216, … |
| Ledger integrity | debits − credits = **0** |
| Wallet liability | liability **0** = sum of wallet balances **0** |
| Verdict | **PASS** |

Reproduce it any time with `bash scripts/db-restore-drill.sh`. The drill leaves nothing behind:
it drops `dispatch_drill` and deletes its temporary dump.

---

## 5. Rollback

### 5.1 Rolling back the application (common case)

Migrations are additive and are *not* undone by rolling back code, so this is safe:

```bash
git checkout <previous-tag-or-commit>
docker compose build api web
docker compose up -d api web
curl -fsS http://127.0.0.1:8080/api/v1/health | jq
```

Down migrations are deliberately not shipped. If a release made a destructive schema change,
roll **forward** with a fix, or restore from §4.2-B and accept the data loss. Decide this
before you deploy, not after.

### 5.2 Rolling back a bad data change

Every money movement is a `ledger_line`, and nothing is ever edited in place — a wrong charge
is corrected by a compensating entry (a refund, an adjustment), never by an `UPDATE`. Same for
delivery status: it moves through the state machine and leaves an `audit_log` row each time.

So "undo this payment" is a **business operation** (`POST /admin/finance/payments/:id/refunds`),
performed through the admin UI with a reason attached, and visible afterwards to whoever asks.
That is the rollback strategy for money: not restoration, *explanation*.

### 5.3 Emergency stop

| Want to stop… | Do this |
|---|---|
| all payments | `PAYMENTS_MODE=DEVELOPMENT` in `deploy/.env`, then `docker compose up -d api` — charges are simulated, no money moves |
| new bookings | take `web` down: `docker compose stop web` (the API stays up, riders keep finishing jobs) |
| a single rider | admin UI → Riders → suspend; or `POST /api/v1/admin/riders/:id/approval` |
| a single customer | admin UI → Customers → suspend |
| all sessions | rotate `JWT_REFRESH_SECRET` and `JWT_ACCESS_SECRET`, restart `api` |

---

## 6. Incident playbook

### "Nobody can sign in"

1. Rate limiting is per account **and** per IP: 10 attempts / 5 minutes. A shared office IP can
   lock out a whole team at 08:59. Check:
   `docker compose exec redis redis-cli --scan --pattern 'ratelimit:*' | head`
2. To clear deliberately (support-approved, logged): `redis-cli del <keys>`.
3. If Redis is down, auth still works but rate limits are skipped — treat that as a security
   incident and restore Redis.

### "The map is empty / fares look wrong"

* `MAPS_PROVIDER=STUB` means distances come from the stub model, not Google. The UI says so.
* With `GOOGLE`, a missing or unbilled key degrades to the stub **and logs a warning**. Check
  `docker compose logs api | grep -i maps`.
* Fares themselves come from pricing rules in the database, not code. Fix them in admin →
  Pricing; no deploy required.

### "A rider says the money is wrong"

Read, in this order: the delivery, its `payments`, its `rider_earnings`, and the `ledger_lines`
that reference it. If the ledger does not balance, that is a **P1** — stop and escalate,
because something bypassed the service layer. If it balances and the rider disagrees, it is a
policy question (commission, hold period), answerable from `rider_earnings`.

### "Reports are queued forever"

See §3.2. Restarting `api` is the fix 9 times out of 10; a lost job can be re-requested from
the UI, because a report is a pure read — nothing is lost by regenerating it.

### "The web app loads but every call 401s"

The reverse proxy is dropping the `Set-Cookie` on `/api/v1/auth`. Verify with
`curl -i -X POST https://<host>/api/v1/auth/login -H 'Content-Type: application/json' -d '{…}'`
and look for `set-cookie: dispatch_refresh=…; Path=/api/v1/auth; HttpOnly`.

### "Sign in says *Something went wrong on our side. Reference: unknown*"

That combination — a 500 whose reference is `unknown` rather than a UUID — means the request
failed **before** the request-id middleware ran, which in practice means the CORS layer. It was
caused by an allowlist that did not mention the deployment's own URL: a browser sends `Origin` on
every non-GET request, even a same-origin one, so the login POST was refused by our own server.

Fixed in `backend/src/common/cors.ts`: the app's own origin is always allowed, and a refused
origin now gets no CORS headers (the browser blocks it) while the server logs one warning instead
of returning a 500. If you see the 500 today, the running build predates that fix. Check with:

```bash
# must NOT be 500. The Origin here is the same host you are calling.
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<host>/api/v1/auth/login \
  -H 'Content-Type: application/json' -H "Origin: https://<host>" \
  -d '{"identifier":"x@y.z","password":"nottherightpassword","audience":"ADMIN"}'
```

`401` is the correct answer (wrong password). `500` means the old build. As an immediate
workaround on a deployment you cannot rebuild, add the exact public origin to `CORS_ORIGINS` and
restart the API:

```dotenv
CORS_ORIGINS=https://p01--twl-frontend--glzb7542cqkx.code.run
```

---

## 7. On-call

**What actually wakes you up.** Only two things are configured to alert, and both are real:

| Alert | Where it comes from | First action |
|---|---|---|
| Dispatch exhausted — a delivery found no rider | `DispatchService`, raised as an alert row for the desk | assign manually; check rider availability |
| Health check failing | container healthcheck → restart policy | `docker compose ps`, then logs |

Everything else is discovered by a person, so watch the desk: the admin dashboard's waiting and
exhausted counts are the earliest honest signal that the marketplace is not clearing.

**Response times** (proposal — agree these with the business, they are a commitment, not a
description):

| Severity | Meaning | Response | Update cadence |
|---|---|---|---|
| **P1** | money wrong, data lost, or nobody can sign in | 15 min | every 30 min |
| **P2** | dispatch not clearing, reports stuck, one portal down | 1 h | every 2 h |
| **P3** | cosmetic, single-user, workaround exists | next business day | as needed |

**The first five minutes of any incident:**

1. `docker compose ps` and `curl -fsS .../api/v1/health` — is it down, or is it wrong?
2. `docker compose logs --since 15m api | grep -iE "error|SECURITY"` — what changed?
3. Note the time. Every log line and every audit row is timestamped; you will need it.
4. If money or data is at risk: **stop the bleeding first** (§5.3), explain afterwards.

**Escalation.** There is one engineer on this platform today. Until there is a second, the
escalation path is: the engineer, then the business owner. Write the name and number into a
copy of this file kept outside the repo — a runbook that only exists in git is unavailable
exactly when you need it.

---

## 8. Known limitations

Honest, current, and deliberately not hidden. Each is either a decision or a piece of work
with a name on it.

| # | Limitation | Impact | Status |
|---|---|---|---|
| 1 | **Scheduled email is not built.** Emails send immediately when an event fires; there is no digest or "email me tomorrow" scheduling. | No scheduled marketing/digest mail. Transactional mail is unaffected. | deliberate scope decision, recorded in the Phase 9 log |
| 2 | **Docker images are authored but unbuilt in the build environment.** `deploy/Dockerfile.*`, `docker-compose.yml` and `deploy/nginx-templates/default.conf.template` have never been built here (no Docker in the sandbox). | First `docker compose up --build` must be treated as a real test, not a formality. | **UNTESTED — verify on the VPS before trusting** |
| 3 | **Staff roles list shows "super admin" twice.** A cosmetic duplicate in admin → Team → Roles. | Cosmetic only; permissions are correct. | known cosmetic bug, not yet fixed (not authorised to change UI) |
| 4 | **`npm audit` reports 3 high findings** in `prisma`, `@prisma/config`, `deepmerge-ts`. | The CLI ships inside the image (it is a dependency of @prisma/client) but is never executed by the server; the advisory is in CLI-only config parsing, so it needs prior RCE to reach. | allowlisted with that reason in `scripts/audit-runtime.mjs`; re-check on every Prisma upgrade — `SECURITY-REVIEW.md` §7 |
| 5 | **Sign-in is rate limited to 10 attempts / 5 min per account.** | Automated tests must log in once and reuse the token. | by design; the E2E suite works this way |
| 6 | **A just-rotated refresh token can be replayed for 30 s** by the same browser and is answered with a sibling token instead of a logout. | Removes a real-world "two tabs refreshed at once" logout. Replays after 30 s still revoke the whole family. | by design — justified in `SECURITY-REVIEW.md` §3 |
| 7 | **Maps and messaging are env-gated**, and default to stub/console. | Correct and safe by default; must be switched on deliberately. | by design |
| 8 | **No automated off-box backup.** The scripts are here; the cron/rclone wiring is a VPS decision. | A dead VPS takes its backups with it. | operational TODO — see §4.1 |
