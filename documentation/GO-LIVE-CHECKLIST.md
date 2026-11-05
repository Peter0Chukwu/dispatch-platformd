# GO-LIVE CHECKLIST

> **How to use this.** Work top to bottom, on the real server, once. Every line has a command
> or an observable result — nothing here says "verify it works" without saying how. Tick a box
> only when you have seen the result with your own eyes.
>
> Items marked **⛔ BLOCKER** must be ticked before real money moves. Items marked
> **⚠️ VPS-ONLY** cannot be verified in the build environment (no Docker there) and are
> therefore the most likely place for a first-deploy surprise.

Copy this file to a ticket or a text note and fill in the date and initials as you go.

---

## A. Prerequisites — the boring things that stop a launch

- [ ] **Domain resolves to the box.** `dig +short dispatch.example.com` → the VPS IP
- [ ] **DNS for `www` / apex handled** (either one, redirected — not both serving the app)
- [ ] **TLS certificate issued and auto-renewing.** `curl -I https://dispatch.example.com` → `200`, padlock present
- [ ] **Firewall: only 22, 80, 443 open.** `sudo ufw status` → `22, 80, 443 ALLOW`, default deny incoming
- [ ] **Docker installed and the deploy user in the `docker` group.** `docker compose version` → v2.x
- [ ] **Time zone and clock correct.** `timedatectl` → `Africa/Lagos`; `date` matches your watch (JWT expiry and ledger timestamps depend on this)
- [ ] **Disk has room for the database plus 14 backups.** `df -h /` → ≥ 20 GB free
- [ ] **A way to get backups off the box** decided and configured (rclone/S3/snapshot) — see `RUNBOOK.md` §4.1

## B. Configuration — one file, no guesses

- [ ] **`deploy/.env` exists and is not committed.** `git check-ignore deploy/.env` prints the path
- [ ] **No `CHANGE_ME` remains.** ⛔ BLOCKER
      ```bash
      grep -n "CHANGE_ME" deploy/.env && echo "STILL PLACEHOLDERS — stop" || echo "clean"
      ```
- [ ] **Four secrets generated with `openssl rand -hex 48`**: `POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `TRACKING_LINK_SECRET` — and the two JWT secrets are **different**
- [ ] **Secrets stored in a password manager**, not only on the server (you will need them to rotate, and to restore on a new box)
- [ ] **`CORS_ORIGINS` and `FRONTEND_URL` are the exact public origin**, e.g. `https://dispatch.example.com` — no trailing slash, correct scheme ⛔ BLOCKER (a mismatch breaks sign-in in the browser only, which is maddening to debug later)
- [ ] **`APP_TIMEZONE=Africa/Lagos`**
- [ ] **`PAYMENTS_MODE`** is `DEVELOPMENT` for the dress rehearsal and only becomes `LIVE` at item D-6 ⛔ BLOCKER
- [ ] **`DEFAULT_COMMISSION_PCT`, dispatch timeouts and `LOCATION_RETENTION_DAYS`** reviewed against the business's actual policy — these are policy, not code

## C. Build and start (⚠️ VPS-ONLY — first real Docker run)

- [ ] **`docker compose build api web`** completes with no errors
- [ ] **`docker compose up -d`** — then `docker compose ps` shows `postgres` and `redis` **healthy**, `migrate` **Exited (0)**, `api` and `web` **Up**
- [ ] **Migrations applied cleanly.** `docker compose logs migrate | tail -20` → no failed migration
- [ ] **API booted without a config error.** `docker compose logs api | grep -i "listening"` → `Listening on http://0.0.0.0:4000/api/v1`
- [ ] **Health is green through the public URL, not just locally** ⛔ BLOCKER
      ```bash
      curl -fsS https://dispatch.example.com/api/v1/health | jq
      ```
      → `"status": "ok"`, database and redis both `up`
- [ ] **Only one port is published.** `docker compose ps --format '{{.Service}} {{.Ports}}'` → only `web` shows a host port
- [ ] **The API is not reachable from the internet directly.** `curl -m 5 http://<vps-ip>:4000/api/v1/health` → connection refused / timeout (this is the *desired* result)
- [ ] **Containers are not running as root.** `docker compose exec api id -u` → `10001`
- [ ] **A page reload on a deep link does not 404** (SPA fallback): open `https://…/admin/reports` directly and hard-refresh
- [ ] **Security headers present.** ⛔ BLOCKER
      ```bash
      curl -sI https://dispatch.example.com | grep -iE "content-security-policy|strict-transport|x-frame|x-content"
      ```
      → CSP, HSTS, `X-Frame-Options`/`frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`
- [ ] **TLS is not silently broken for the API.** `curl -i -X POST https://…/api/v1/auth/login …` → the `set-cookie` for `dispatch_refresh` has `HttpOnly`, `Secure`, `Path=/api/v1/auth`

## D. Payments — stop here until every line is ticked ⛔ BLOCKER

- [ ] **Sandbox round trip proven first.** With `PAYMENTS_MODE=DEVELOPMENT`: book a delivery, pay, watch the ledger balance to zero, then refund and watch it balance again
- [ ] **Live keys are in `deploy/.env` only** — never in the frontend, never in a repository file, never in a chat message
- [ ] **Paystack webhook URL configured in their dashboard**: `https://dispatch.example.com/api/v1/webhooks/payments/paystack`
- [ ] **Flutterwave webhook URL configured**, with the secret hash matching `FLUTTERWAVE_WEBHOOK_HASH`
- [ ] **Webhook signature actually verified in production.** Send a test event from the provider dashboard; `docker compose logs api | grep -i webhook` → accepted. Then send a *deliberately wrong* signature with `curl` and confirm it is **rejected** — a webhook endpoint that accepts anything is how balances get invented
- [ ] **`/simulate` is refused in live mode.** ⛔ BLOCKER
      ```bash
      curl -s -o /dev/null -w '%{http_code}\n' -X POST https://…/api/v1/payments/<reference>/simulate
      ```
      → not a success. (With `PAYMENTS_MODE=LIVE` the route must refuse; verify after switching)
- [ ] **Switch to `PAYMENTS_MODE=LIVE` and restart the API** — `docker compose up -d api` — and re-check health
- [ ] **One real ₦100 transaction end to end**, then a refund, then confirm the ledger still sums to zero. Record the reference number here: ______________

## E. Messaging and maps — otherwise riders are told nothing

- [ ] **SMS is not in `CONSOLE` mode.** ⛔ BLOCKER `SMS_MODE=TERMII` with a live `TERMII_API_KEY` and an approved sender ID
- [ ] **A real signup OTP arrives on a real Nigerian number.** Record the number used: ______________
- [ ] **Email is not in `CONSOLE` mode.** `EMAIL_MODE=RESEND`, `RESEND_API_KEY` set, `EMAIL_FROM` on a domain you have verified with the provider
- [ ] **A verification email lands in an inbox** (and not in spam — check SPF/DKIM if it does)
- [ ] **Maps:** either `MAPS_PROVIDER=STUB` **knowingly** accepted for launch, or `GOOGLE` with a billed key, and the web rebuilt with `VITE_GOOGLE_MAPS_API_KEY` (`docker compose build web`)
- [ ] **The Maps browser key is restricted** in Google Cloud to your domain and to the APIs you use — a browser key is public by nature, so restriction is the only control

## F. Data and pricing — the numbers customers will see

- [ ] **Real service zones entered** (admin → Pricing): names, boundaries, base fares, per-km and per-minute rates
- [ ] **A quote checked by hand** against the published tariff: distance × rate + base = the number the customer sees
- [ ] **Commission percentage** matches the commercial agreement
- [ ] **Test accounts removed or disabled**: no `demo.customer@`, no `demo.rider@`, no `@dispatch.test` accounts left enabled ⛔ BLOCKER
- [ ] **Seeded demo deliveries** cleared out, or the database started fresh — check the dashboard shows the real (near-zero) counts
- [ ] **First real admin created**, with a long unique password, and the default password not reused anywhere

## G. Proof that it works, on the real deployment

- [ ] **Backup taken and restored once on this box** ⛔ BLOCKER
      ```bash
      bash scripts/db-backup.sh --dir /var/backups/dispatch
      bash scripts/db-restore-drill.sh
      ```
      → verdict `PASS` with the ledger summing to zero after restore
- [ ] **The 20-step master scenario walked by a human on production**: register → verify → quote → book → pay → dispatch → rider accepts → pickup → in transit → proof photo → delivered → customer confirms → admin sees the numbers agree
- [ ] **The numbers agree** between the customer's receipt, the rider's earnings and admin → Finance
- [ ] **A rider can go online and receive an offer** on a real phone with real GPS
- [ ] **A tracking link opens in a browser with no account** and shows live position
- [ ] **Reports generate** and download as CSV and PDF; the totals match the dashboard for the same dates
- [ ] **Sign-in lockout behaves**: 11 wrong passwords → 429 with a helpful message, not a hang
- [ ] **Sessions can be revoked**: sign out everywhere from one device, and the other device is logged out
- [ ] **No browser console errors** on the customer, rider and admin portals (a clean load of each)

## H. Operations — the day after launch

- [ ] **`RUNBOOK.md` read by whoever is on call**, and their name and number written into a copy kept off the repo
- [ ] **Off-box backup scheduled** (cron + rclone) and **proven once** by copying a dump down and restoring it elsewhere
- [ ] **Logs are retained** long enough to investigate (Docker default rotation is 10 MB × 3 per container — set `max-size`/`max-file` if you need a week)
- [ ] **Uptime monitoring** pointed at `https://…/api/v1/health` from *outside*, with email/SMS alerting to a phone that is actually carried
- [ ] **Alerting on dispatch exhaustion** someone actually watches — this is the platform's own "we are failing a customer right now" signal
- [ ] **A written rollback decision** made in advance: which commit is "known good", and who is allowed to say "roll back"
- [ ] **Who to call** for Paystack/Flutterwave/Termii/Resend support is recorded somewhere other than a personal inbox

---

## Sign-off

| | |
|---|---|
| Deploy performed by | ______________________ |
| Date / time (WAT) | ______________________ |
| Commit deployed | ______________________ |
| Payments switched to LIVE by | ______________________ |
| Checklist re-run after any change to `deploy/.env`? | ☐ yes ☐ not yet |

---

## Honest notes about this checklist

* **Items marked ⚠️ VPS-ONLY have never been executed.** There is no Docker in the environment
  this platform was built in, so `docker-compose.yml`, `deploy/Dockerfile.api`,
  `deploy/Dockerfile.web` and `deploy/nginx.conf` are authored and reviewed but unbuilt. Section
  C is therefore a genuine test, not a formality. If something is wrong there, it will be
  something small and boring — a missing `prisma` binary, a wrong build context — and it will be
  obvious in the logs.
* **Everything in sections D–G was proven in development** with the same code paths, which is
  why the checklist can be as specific as it is. The tests behind each line: 254 backend tests,
  a 20-step Playwright journey, a load smoke at concurrency 40, and a restore drill that
  re-verifies the ledger.
* **The two items most likely to be skipped, and most expensive to skip**, are the off-box
  backup (H) and the deliberate check that a bad webhook signature is *rejected* (D). Both are
  silent failures: everything looks fine until the day it does not.
