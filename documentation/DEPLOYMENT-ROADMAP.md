# Deployment roadmap

> **What this is.** A staged plan from "code on GitHub" to "customers paying for deliveries", with the
> commands, the acceptance gate for each stage, and the things that can go wrong. It is written to be
> followed in order, once, on a real server.
>
> **Division of labour.** I cannot reach your server, so **you run the commands and paste the output**;
> I diagnose, and fix anything that turns out to be a code problem. Every stage ends with a check that
> produces a clear pass or fail, so we always know where we stand.
>
> **Companion documents:** `RUNBOOK.md` (day-2 operations, backup/restore, incidents),
> `GO-LIVE-CHECKLIST.md` (the launch itself, line by line), `SECURITY-REVIEW.md` (what was audited),
> `CREDENTIALS-SETUP.md` (every third-party account).

---

## 0. The one honest caveat, before anything else

**The Docker images have never been built.** There is no Docker in the environment this platform was
developed in, so `docker-compose.yml`, the two Dockerfiles and the nginx config were written and
reviewed but never executed. Stage 3 is therefore a genuine test, not a formality.

I did not leave it at "hope it works", and I did not stop at reading either. Two defects that would each
have broken the first deploy were found and proven with a real test, two fragilities were removed, and
one claim in my own security documentation turned out to be wrong and is now corrected — all in §7. The
remaining risk is the ordinary kind: a missing system package or a lockfile drift, which the build output
names precisely.

**Budget for Stage 3 taking an hour longer than the plan says.** It rarely does, and if it does, it is
almost always something small and obvious in `docker compose build` output.

---

## 1. What is being deployed

```
                   ┌──────────────────── internet ────────────────────┐
                   │                                                  │
            :80 :443│                                                  │
                   ▼                                                  │
        ┌─────────────────────┐                                        │
        │  Caddy (on host)    │  TLS: automatic Let's Encrypt          │
        │  dispatch.domain    │  HSTS, compression                     │
        └──────────┬──────────┘                                        │
                   │ 127.0.0.1:8080                                   │
                   ▼                                                  │
        ┌─────────────────────┐        ┌──────────────────────────┐   │
        │  web (nginx)        │───────▶│  api (NestJS, uid 10001) │   │
        │  SPA + /api proxy   │        │  :4000, not published    │   │
        └─────────────────────┘        └───────┬──────────┬───────┘   │
                                               │          │           │
                                     ┌─────────▼──┐  ┌────▼─────┐     │
                                     │ postgres 17│  │ redis 8  │     │
                                     │ not public │  │ not public│    │
                                     └────────────┘  └──────────┘     │
                                                                      │
        one-shot services:  migrate (schema)  ·  seed (reference data) │
                   └──────────────────────────────────────────────────┘
```

**Sizing.** 2 vCPU / 4 GB RAM / 40 GB SSD is comfortable for the first few hundred deliveries a day.
1 vCPU / 2 GB will run it, but a `prisma migrate` alongside a report render will swap; the bootstrap
script adds a swapfile when RAM is under 2 GB.

**Region.** The database, Redis and the API want to be near each other (they are, one network). What
matters for users is the round trip from Lagos: EU (Frankfurt/Amsterdam) is typically 90–130 ms, which
is fine because the SPA is cached and calls are batched. A Nigerian host (Layer3, Qservers, Whogohost)
gets you under 30 ms and keeps data in-country — worth considering if data residency matters to your
customers, though self-managed VPS quality varies. **Recommendation for launch: Hetzner CX22 in
Falkenstein or Helsinki** — cheapest credible option, mature networking, one-command snapshots.

---

## 2. Decisions — and where they landed

**Decided:** Hetzner **CX22** (2 vCPU / 4 GB), EU region · **Caddy only** in front (no Cloudflare at
launch) · **sandbox round trip first**, live the same week · real tariffs exist and are being collected in
`PRICING-WORKSHEET.md`.

**Still open:** the domain name (see §2a).

| # | Decision | Recommendation | Why it matters |
|---|---|---|---|
| 1 | **Domain name** — what will customers type? | e.g. `dispatch.ng` or `track.yourcompany.com` | It goes into `CORS_ORIGINS`, `FRONTEND_URL`, the Caddyfile and every link the platform emails. Changing it later means invalidating live sessions and re-issuing certificates. |
| 2 | **VPS provider + region** | Hetzner CX22 (2 vCPU/4 GB, ~€4/mo), EU | Determines latency, cost, and how much of §1 applies |
| 3 | **Who is the first admin?** Real name, email, phone | not `admin@dispatch.test` | The seed creates one super admin from `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD`. Needs a real inbox and a real phone. |
| 4 | **Cloudflare in front, or Caddy only?** | **Caddy only** to launch; add Cloudflare later if you want DDoS shielding | Changes `TRUST_PROXY` (2 vs 2) and who terminates TLS. Two moving parts on day one is one too many. |
| 5 | **Pay at launch, or book-only first?** | **Sandbox round trip proven, then live within the same week** | Determines whether stage 5 blocks stage 8 |
| 6 | **Real zones and tariffs** — base fee, per-km, minimum, free km, surcharges, commission % | you have these; fill in `PRICING-WORKSHEET.md` | These are *data*, entered through the admin UI — no code change, no deploy. Note there is **no per-minute component** in the model: the clock only appears as a waiting fee. |

### 2a. The domain — how to choose and buy

This is the only open decision, and everything in Stage 2 depends on it.

**What to buy.** One domain, used for everything: the customer portal, the rider portal (same origin,
different route), the admin, and the API — all under one hostname. Do **not** buy separate
`api.` / `app.` / `admin.` subdomains: the whole point of the design is that the browser talks to one
origin, which is what keeps the refresh cookie first-party and CORS a closed list.

**Where to buy, in the order I would actually do it:**

| Registrar | Why | Rough cost |
|---|---|---|
| **Cloudflare Registrar** | sells at wholesale, includes free DNS, no upsells, no surprise renewal | `.com` ~$10/yr |
| **Namecheap** | solid, cheap, good UI, free DNS | `.com` ~$11–14/yr |
| **Whogohost / Qservers / GO54** | Nigerian registrars; simplest if you want to pay in naira and get a local invoice | `.com.ng` ~₦15,000–25,000/yr |

**`.com` or `.ng`?** `.ng` signals a Nigerian business, which customers trust for local delivery, but it
costs several times more and renewals move. `.com` is cheaper, universal, and nobody in Lagos hesitates at
it. **Either is fine — pick one and move on.** What is not fine is a name that spells something
unfortunate, or one you have to explain over the phone.

**Then put DNS on Cloudflare (free plan), even if you buy elsewhere.** Fast propagation, DDoS protection
you can switch on later without moving the site, and one dashboard for the A record that Stage 2 needs. It
also means that if you later decide you *do* want Cloudflare in front, nothing changes except a toggle.

**Two things to get right at purchase:** register with an email you will still control in five years, and
turn on **registrar lock** and **two-factor**. A domain lost to an expired card takes the business offline
in a way no amount of engineering fixes quickly.

---

## 3. Long-lead items — start these today, they gate the launch

These are the only things on the critical path that are **not** engineering. Each takes days to weeks of
somebody else's time, so starting them during Stage 1 costs nothing and saves a week later.

| Item | Who | Typical lead time | Blocks |
|---|---|---|---|
| **Paystack business/KYC activation** (live keys need approved business docs) | you | 1–10 business days | real money (Stage 8) |
| **Termii sender ID approval** for `Dispatch` | you | 1–5 business days | OTP delivery to real riders (Stage 6) — registration itself depends on it |
| **Domain purchase + DNS access** | you | same day | everything (Stage 2) |
| **Resend domain verification** (DNS records for SPF/DKIM) | you | 1–24 h after DNS exists | verification emails (Stage 6) |
| **Google Maps billing account** (card required; $200/mo free credit) | you | same day | real maps/fares (optional — the stub works) |
| **Business bank account details** for settlements | you | — | payouts to riders |

> Ordering note: **Termii before Paystack**, in terms of what unblocks the most. Without an approved
> sender ID, a real customer cannot complete sign-up, because the phone OTP never arrives.

---

## 4. The stages

Estimated hands-on time assumes you paste output at each gate so I can diagnose in one pass.

| Stage | What | Hands-on | Gate |
|---|---|---|---|
| 1 | Server prepared | 45 min | `docker compose version` works; firewall on; swap if small |
| 2 | DNS + TLS | 30 min + propagation | `https://domain/api/v1/health` returns `ok` over HTTPS |
| 3 | **First build and boot** | 1–3 h | containers healthy, health green, migrations applied |
| 4 | Verification sweep | 1 h | headers, deep links, sockets, rate limiting, isolation all pass |
| 5 | Payments — sandbox round trip | 2–3 h | a real ₦ figure moves through init → webhook → ledger, then refunds |
| 6 | Messaging + maps | 1–2 h | a real OTP arrives on a real phone; a real email lands in an inbox |
| 7 | Real data, real admin, demo data out | 2 h | the platform shows *your* zones, tariffs and staff, and no `@dispatch.test` accounts |
| 8 | Go live | 3 h | `GO-LIVE-CHECKLIST.md` fully ticked, one real ₦100 delivery paid and refunded |
| 9 | Week one | 1 h/day | see §6 |

---

### Stage 1 — Prepare the server (45 min)

Create the VPS at your chosen provider with an **Ubuntu 24.04 LTS** image and your **SSH public key**
(not a password). Then:

```bash
ssh root@YOUR_SERVER_IP

# See exactly what it would do, change nothing:
curl -fsSL https://raw.githubusercontent.com/YOURNAME/dispatch-platform/main/deploy/bootstrap-vps.sh \
  -o bootstrap.sh || true    # if the repo is private, clone it first instead (below)

# Or, with the repo cloned:
mkdir -p /opt/dispatch && cd /opt/dispatch
git clone https://github.com/YOURNAME/dispatch-platform.git .
sudo bash deploy/bootstrap-vps.sh            # dry run
sudo bash deploy/bootstrap-vps.sh --apply    # do it
```

The script sets the timezone to Africa/Lagos, installs Docker from Docker's own repository, adds swap
if RAM is under 2 GB, caps Docker's log growth at 50 MB × 3 per container, and enables the firewall
**after** allowing SSH (the order matters — the reverse locks you out).

**Gate 1**

```bash
docker compose version        # v2.x
sudo ufw status               # 22, 80, 443 allowed; otherwise deny incoming
free -h                       # swap present if RAM < 2 GB
timedatectl                   # Africa/Lagos
```

**If it fails:** the usual cause is a provider image that ships `docker.io` instead of Docker CE. The
script detects an old Docker and installs the current one; if `docker compose` still isn't found, say so
and we'll correct it — do not proceed with a half-installed daemon.

---

### Stage 2 — DNS and TLS (30 min + propagation)

1. At your DNS provider, create an **A record**: `dispatch` (or `@`) → your server IP. Delete any
   parking/AAAA records.
2. Wait for propagation: `dig +short dispatch.yourdomain.com` → your server's IP.
3. Install Caddy on the host and give it the config that is already in the repo:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

sudo cp /opt/dispatch/deploy/Caddyfile.example /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile      # replace dispatch.example.com with your domain
sudo systemctl reload caddy
sudo journalctl -u caddy -n 30      # certificate obtained?
```

**Gate 2** — TLS exists *before* the app does. `curl -I https://dispatch.yourdomain.com` will return
**502** at this point (nothing is running yet) — what matters is that it is **HTTPS**, not a certificate
error. Then `curl -I http://dispatch.yourdomain.com` must **redirect** to https.

**If it fails:** a certificate failure is almost always DNS (the domain does not resolve to this box yet)
or port 80 being blocked (Let's Encrypt validates over HTTP). Check `sudo ufw status` and
`dig +short`.

---

### Stage 3 — First build and boot (1–3 h) ⚠️ the untested one

```bash
cd /opt/dispatch
cp deploy/.env.example deploy/.env

# Generate each secret separately — never reuse one value for two purposes:
openssl rand -hex 48      # JWT_ACCESS_SECRET
openssl rand -hex 48      # JWT_REFRESH_SECRET
openssl rand -hex 48      # TRACKING_LINK_SECRET
openssl rand -hex 32      # POSTGRES_PASSWORD
nano deploy/.env          # fill them in, set CORS_ORIGINS, FRONTEND_URL, TRUST_PROXY, SUPER_ADMIN_*

# Sanity check before building — cheap now, expensive later:
grep -n "CHANGE_ME" deploy/.env && echo "STILL PLACEHOLDERS — fix them" || echo "clean"

docker compose build            # ← the real test. Expect 5–12 minutes.
docker compose up -d migrate    # applies migrations, then exits 0
docker compose logs migrate | tail -20
```

`docker compose build` is where an unbuilt image shows its hand. If it fails, **stop and paste the last
40 lines to me** — the failure is almost certainly one of the four defects listed in §7 (already fixed)
or a lockfile drift. Do not start inventing fixes on the server; the fix belongs in the repo, so the next
person doesn't hit it too.

When it builds:

```bash
docker compose up -d api web
docker compose ps                       # postgres/redis healthy, migrate Exited (0), api/web Up
docker compose logs api | tail -30      # "Listening on http://0.0.0.0:4000/api/v1"
curl -fsS http://127.0.0.1:8080/api/v1/health | jq
curl -fsS https://dispatch.yourdomain.com/api/v1/health | jq
```

**Gate 3**

- `docker compose ps` → `postgres` and `redis` **healthy**, `migrate` **Exited (0)**, `api` and `web` **Up**
- `curl …/api/v1/health` → `"status": "ok"`, database and redis both `up`
- `curl …/health/live` → `ok` (this is what the container healthcheck uses)
- `docker compose exec api id -u` → `10001` (not root)

**Then create the reference data and your admin account** — this is the one time it runs:

```bash
# Put these in deploy/.env BEFORE running (never leave the demo password in production):
#   SUPER_ADMIN_EMAIL=you@yourcompany.com
#   SUPER_ADMIN_PHONE=+234...
#   SUPER_ADMIN_PASSWORD=<long unique password>
docker compose run --rm seed
```

**Never** run `scripts/seed-demo-phase*.mjs` on production: they invent riders, customers and
deliveries that never happened. The base seed creates only roles, permissions, one branch, zones,
ledger accounts, settings and your one super admin — and it is idempotent.

---

### Stage 4 — Verification sweep (1 h)

Nine checks, each one line. These are the failures that are invisible until a customer finds them.

```bash
D=https://dispatch.yourdomain.com

# 1. Security headers present on the HTML itself (the classic nginx inheritance trap)
curl -sI $D/ | grep -iE "content-security-policy|strict-transport|x-frame|nosniff"

# 2. SPA deep link survives a reload (no 404 on /admin/reports)
curl -s -o /dev/null -w '%{http_code}\n' $D/admin/reports

# 3. API is NOT reachable directly from the internet
curl -m 5 http://YOUR_SERVER_IP:4000/api/v1/health || echo "refused — correct"

# 4. Only 80/443 are open
sudo ss -tlnp | grep -E ':(80|443|4000|5432|6379|8080)'

# 5. The refresh cookie is HttpOnly + Secure + correctly scoped
curl -si -X POST $D/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"identifier":"YOUR_ADMIN_EMAIL","password":"YOUR_PASSWORD","audience":"ADMIN"}' \
  | grep -i set-cookie

# 6. WebSocket upgrade reaches the API (dispatch live channel)
curl -si -N -H "Connection: Upgrade" -H "Upgrade: websocket" \
  "$D/socket.io/?EIO=4&transport=websocket" --max-time 3 | head -3

# 7. Rate limiting keys on the CLIENT IP, not the proxy
#    (11 rapid bad logins should start returning 429 for this IP)
for i in $(seq 1 12); do curl -s -o /dev/null -w '%{http_code} ' -X POST $D/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"nobody@example.com","password":"wrong","audience":"CUSTOMER"}'; done; echo

# 8. Disk and memory headroom
df -h / && free -h

# 9. Logs are rotating, not growing forever
docker compose exec api ls -la /proc/1/fd 2>/dev/null | head -3
```

**Gate 4** — checks 1, 2, 3, 4, 5 pass; check 6 returns a Socket.IO handshake (a line starting `0{`);
check 7 ends in `429`s after the first few; check 8 leaves at least 30% disk free.

Check 7 is the one that catches a mis-set `TRUST_PROXY`: if every attempt returns `401` and never `429`,
or if the *first* attempt already returns `429`, the hop count is wrong (see `RUNBOOK.md` §6).

---

### Stage 5 — Payments, sandbox round trip (2–3 h)

Leave `PAYMENTS_MODE=DEVELOPMENT` (the default). The simulator drives the **same** code path a real
webhook does, so this proves the ledger logic before a naira is at risk.

1. In the admin UI: **Finance → Payments**, note the totals.
2. As the customer (create one through the UI with your own phone/email — the OTP prints to
   `docker compose logs api` while `SMS_MODE=CONSOLE`): book a delivery, pay, and complete the whole
   rider workflow if you like.
3. **Finance → Reconciliation** — all five checks must be green, debits = credits.
4. Issue a refund from the payment row; re-run reconciliation.
5. Generate a **Financial summary** report for today; its net must equal the finance screen's net.

**Gate 5** — reconciliation green before *and* after the refund, and the report total matches the
dashboard to the kobo.

Then configure the real webhook URLs in the provider dashboards (they can point at production while the
platform is still in DEVELOPMENT mode — nothing charges until you switch):

- Paystack → `https://dispatch.yourdomain.com/api/v1/webhooks/payments/paystack`
- Flutterwave → `https://dispatch.yourdomain.com/api/v1/webhooks/payments/flutterwave`

---

### Stage 6 — Messaging and maps (1–2 h)

Blocked on Termii's sender-ID approval (§3), which is why it is started on day one.

```bash
nano deploy/.env
#   SMS_MODE=TERMII      TERMII_API_KEY=…   TERMII_SENDER_ID=…
#   EMAIL_MODE=RESEND    RESEND_API_KEY=…   EMAIL_FROM="Dispatch <no-reply@yourdomain.com>"
#   MAPS_PROVIDER=GOOGLE GOOGLE_MAPS_API_KEY=…   VITE_GOOGLE_MAPS_API_KEY=…
docker compose up -d api
docker compose build web && docker compose up -d web   # VITE_ vars are baked in at BUILD time
```

**Gate 6** — register a new account with your own phone: the OTP **arrives on the phone** and the
verification email **lands in the inbox** (check spam once — if it is there, the DNS records for SPF/DKIM
are incomplete). Open the booking page: real map tiles, and a quote whose distance you can sanity-check.

> The Maps key is compiled into the browser bundle, which is fine — it is a *public* key by design. It
> **must** be restricted in Google Cloud to your domain and to the three APIs you use, or someone else
> will spend your credit.

---

### Stage 7 — Real data, real people, demo data out (2 h)

1. **Admin → Pricing:** create your real zones, then the fare rules — base, per-km, per-minute,
   minimum, express surcharge. Confirm one quote by hand against your tariff.
2. **Admin → Team:** invite the real dispatchers, each with the narrowest role that does the job
   (Support Agent vs Finance Officer vs Rider Manager). Do not hand out Super Admin because it is easier.
3. **Delete or disable every `@dispatch.test` account** and any test deliveries. Check
   **Admin → Customers** and **Admin → Riders** and the dashboard counts: they must reflect reality.
4. Set `DEFAULT_COMMISSION_PCT`, `DISPATCH_OFFER_TIMEOUT_SECONDS` and the rest to your actual policy in
   `deploy/.env`, then `docker compose up -d api`.
5. Take a backup **before** any of this and one after, and run the restore drill once on this box:

```bash
bash scripts/db-backup.sh --dir /var/backups/dispatch
bash scripts/db-restore-drill.sh        # expect: DRILL PASSED, ledger 0
```

**Gate 7** — a quote matches the published tariff; two staff can sign in with their own accounts;
the customer list contains only real customers.

---

### Stage 8 — Go live (3 h)

Work through `GO-LIVE-CHECKLIST.md` top to bottom. The parts that are deployment-specific:

```bash
nano deploy/.env
#   PAYMENTS_MODE=LIVE
#   PAYSTACK_SECRET_KEY=sk_live_…        (only after KYC approval)
#   PAYSTACK_WEBHOOK_SECRET=…
#   FLUTTERWAVE_SECRET_KEY=FLWSECK-…     FLUTTERWAVE_WEBHOOK_HASH=…
docker compose up -d api
```

Then, deliberately, in this order:

1. **Send a webhook with a wrong signature** and confirm it is **rejected** (`docker compose logs api |
   grep -i webhook`). An endpoint that accepts anything is how balances get invented.
2. Confirm `/simulate` **refuses** to run in live mode.
3. Take **one real ₦100 delivery** end to end, refund it, and confirm reconciliation is still green.
4. Schedule the off-box backup (the crontab is in `RUNBOOK.md` §4.1) and **prove it** by copying a dump
   off the box and restoring it elsewhere.
5. Point uptime monitoring at `https://dispatch.yourdomain.com/api/v1/health` with an alert to a phone
   somebody actually carries.

**Gate 8** — the checklist is ticked, a real payment cleared and refunded, a backup exists off the box,
and the alert reaches a human.

---

## 5. What it costs

Exchange rate used: **~₦1,400/$** (mid-market was ₦1,341, parallel ₦1,410–1,425 on 5 Nov 2026 — your bank
or card will use its own rate, usually a little worse).

| Item | Monthly (USD) | Monthly (₦, approx) | Notes |
|---|---|---|---|
| VPS, 2 vCPU / 4 GB / 40 GB | $4–12 | ₦5,600–16,800 | Hetzner cheapest; DigitalOcean/AWS Lightsail 2–3× |
| Domain | — | ₦12,000–20,000 / **year** | `.ng` is dearer than `.com` |
| TLS certificates | $0 | ₦0 | Let's Encrypt via Caddy, auto-renewed |
| SMS OTP + alerts (Termii) | $10–40 | ₦14,000–56,000 | ~₦3.5–5 per SMS; scales with sign-ups |
| Email (Resend) | $0 | ₦0 | 3,000/month free |
| Google Maps | $0–15 | ₦0–21,000 | $200/month free credit; card required |
| Backups (off-box) | $0–5 | ₦0–7,000 | Object storage, or your provider's snapshots |
| **Total at launch** | **$15–70** | **≈₦21,000–98,000** | before payment provider fees |

Payment fees are per transaction, not monthly: Paystack ~1.5% + ₦100 (capped ₦2,000) on local cards;
transfers to riders ~₦10–50 each. Those come out of revenue, not the budget above.

---

## 6. Week one — what to watch

The platform alerts you about exactly one thing by itself (dispatch exhaustion). Everything else you have
to look at, so put it in a daily ten-minute routine:

| Every day | Look at | What is bad |
|---|---|---|
| Morning | Admin dashboard — waiting, exhausted, failed counts | exhausted > 0 means customers are being failed *now* |
| Morning | `docker compose ps` + `/health` | anything not Up/healthy |
| Midday | Reconciliation | any check red is a P1 |
| Evening | `docker compose logs --since 24h api \| grep -iE "error\|SECURITY"` | a `SECURITY: refresh token reuse` line means someone's session was killed |
| Weekly | `df -h`, backup log, restore drill | disk < 30% free, or a backup that did not run |
| Weekly | Failed reports, failed withdrawals | money stuck in a queue |

---

## 7. What I changed in preparation for this

Reading the deployment files against the real repository, then **testing the claims instead of trusting
them**, produced one category of work and one uncomfortable correction. Everything below is in the tree
that is now on GitHub.

### Two defects that would have broken the first deploy

| # | Defect | What it would have done — and how it was proven |
|---|---|---|
| 1 | The runtime image copied production dependencies but never the **generated** Prisma client | The container would start, pass its healthcheck, then die on the first database query with `@prisma/client did not initialize yet`. **Proven** by building an isolated `npm ci --omit=dev` tree: `node_modules/.prisma` contained the "did you generate?" stub with **0 query-engine binaries**, and requiring the client threw exactly that message. The dev tree has 3. Fixed by copying the generated client from the build stage. |
| 2 | `nginx.conf` set `Cache-Control` inside locations | nginx **drops every inherited `add_header`** as soon as a location defines one of its own — so the CSP and HSTS would have been missing from the HTML itself, and your own go-live check for CSP would have failed. The same rule applies to `proxy_set_header`: `Connection ""` inside `/api/` silently dropped the `X-Forwarded-*` headers, which would have made every user look like the proxy — collapsing per-IP rate limiting into one shared bucket, so the 11th sign-in attempt *anywhere* locks out the 11th person in the queue. Fixed by moving both sets of headers into included snippets. |

### Two fragilities removed, though they would not have failed today

| # | Change | Why it was not a bug |
|---|---|---|
| 3 | `Dockerfile.api` now `mkdir`s the workspace `node_modules` directories before copying them | I expected `COPY backend/node_modules` to fail, because npm hoists everything to the root. **It does not fail**: with this lockfile npm does create per-workspace `node_modules` (they hold `zod` and the `@dispatch` links). The `mkdir` makes the build independent of npm's hoisting strategy, which has changed between majors. A one-line insurance policy, not a fix. |
| 4 | The `migrate` service now builds from a dedicated `migrate` target instead of the runtime image | I claimed the runtime image has no Prisma CLI, so `npx prisma migrate deploy` would break. **That was wrong**: `@prisma/client` depends on `prisma`, so the CLI *is* in a production install. The separate target still earns its place — it makes the CLI a version-locked, first-class part of the image rather than an accident of someone else's dependency list, which a future Prisma release could remove. |

### One documentation claim that was simply wrong, now corrected

The security review said the three high `npm audit` findings were "build-time only, **absent from the
runtime image**". They are not absent — they ship, because the CLI ships. What is true is that the
vulnerable code (`deepmerge-ts`, reached only while the CLI parses a Prisma config) **never executes in
the running server**, so reaching it requires prior code execution inside the container.

That correction now appears in `SECURITY-REVIEW.md` §7 (with the isolation test written down),
`RUNBOOK.md` §8, the Phase 10 log, the audit script's header and the build report. It is a worse story
than the one I told you first, and it is the true one — which is the only kind worth putting in front of
someone who is deciding whether to trust this platform with money.

### Added, because the plan above needs it and it did not exist

- `deploy/bootstrap-vps.sh` — idempotent server prep with a dry-run mode (`bash -n` clean, refuses to run
  as non-root; **not executed on a real server**, because there is not one yet)
- `deploy/Caddyfile.example` — TLS with automatic certificates, plus the proxy-hop discussion
- `deploy/nginx-snippets/` — the header and proxy snippets behind defect 2
- a `seed` compose service (`docker compose run --rm seed`) so reference data and your super admin can be
  created in production without ever running the demo fixtures
- `TRUST_PROXY` (API) and `WEB_BIND` (compose) settings, documented in both `.env.example` files

## 8. Definition of launched

The platform is launched when all of these are true, and not before:

1. `https://` your domain, valid certificate, HSTS, CSP on the HTML
2. Sign-up → OTP on a real phone → book → pay → dispatch → rider delivers → customer confirms, on
   production, with real accounts and real money
3. Reconciliation green, and every naira traceable to a ledger entry
4. A backup exists **off the box** and has been restored once
5. Alerts reach a human, and a named person is on call
6. `GO-LIVE-CHECKLIST.md` ticked, dated, signed

Everything after that is operations: `RUNBOOK.md`.
