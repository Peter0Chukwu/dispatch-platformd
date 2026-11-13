# SECURITY REVIEW

> **Scope:** the whole platform as built — API, three portals, payments, file handling,
> deployment topology, and the dependency tree.
> **Method:** read the code paths that matter, attempt the attacks that matter, and record what
> was found. Where a control is deliberately relaxed, it is justified in the open below.
> **Date:** 5 November 2026 · **Reviewed at commit:** Phase 10 working tree.

---

## 0. Verdict in one screen

| | |
|---|---|
| **Blocking findings (P1)** | **none** |
| **High findings** | **3, all in Prisma CLI code that never executes at runtime**, and all allowlisted with a written reason by `scripts/audit-runtime.mjs`. They are *not* absent from the image — see §7, which corrects an earlier draft of this review |
| **Medium findings** | 2, both accepted with a reason and a trigger for fixing them (§8) |
| **Low / hygiene** | 4, listed in §8 |
| **What is genuinely strong** | money paths (append-only ledger, no in-place edits), authentication (argon2id, rotating refresh tokens with family revocation), tenant separation (every read is scoped by owner, not filtered in the client), file handling (MIME allowlist, size cap, path-escape guard), deployment (one published port) |
| **What must be true before real money moves** | `GO-LIVE-CHECKLIST.md` ticked, `PAYMENTS_MODE=LIVE` deliberately set, webhook secrets present |

**The honest summary:** nothing here will get a customer's money or data stolen by a stranger
on the internet. The residual risks are operational — backups off-box, the first Docker build,
and secrets handling on a VPS — and they are named rather than waved away.

---

## 1. Authentication

| Control | Implementation | Why it is the right choice |
|---|---|---|
| Password hashing | **argon2id**, tuned params, constant-time verify (`password.service.ts`) | memory-hard; a stolen hash table is expensive rather than free. bcrypt was rejected as weaker at equal cost |
| Access token | JWT, **15 minutes**, held **in memory only** — never `localStorage` | an XSS payload cannot read it, and it dies with the tab |
| Refresh token | opaque 32-byte random, **HttpOnly** cookie, `Path=/api/v1/auth`, `SameSite=Lax`, `Secure` in production | JS can never read it; it is not exfiltratable by injection |
| Refresh storage | only a **hash** is stored (`tokenHash`) | a database leak does not yield usable sessions |
| Rotation | every refresh issues a new token and revokes the old | a stolen token is single-use and detects itself |
| Reuse detection | replaying a rotated token **revokes the entire family** and forces re-login | the standard defence against a stolen refresh token |
| Replay grace window | **30 s**, and only while the successor token is still alive | see §3 — a deliberate, bounded relaxation |
| Sign-up / OTP / reset | rate limited per **IP** and per **phone/email** | a signup flood or an OTP brute force hits a wall |
| Verification | email token + phone OTP required before a customer can book | prevents dead-account spam and fake riders |
| Sessions | listed and individually revocable; "sign out everywhere" works | account takeover recovery does not require a password change |
| Staff | separate `audience` in the token, role + permission checks server-side | a customer token cannot act as staff even with a tampered role claim, because the audience and the server-side role are both checked |

**Verified by tests:** `backend/test/auth.e2e.spec.ts` — 40+ cases including reuse detection,
family revocation, post-grace replay, logout, logout-everywhere, lockout, and cross-audience
rejection.

**Not implemented, and should be stated plainly:** there is **no** multi-factor authentication
and **no** WebAuthn. For an admin portal that can move money, MFA is the single highest-value
addition. It is not in scope now; it should be the first security item after go-live. Until
then, admin accounts must use long unique passwords, and admin access should be restricted by
network policy where possible.

---

## 2. Authorization and object-level access

The classic API failure is *"you can read someone else's order by changing the id"*. It was
attacked directly.

| Test | Result |
|---|---|
| Customer A requests customer B's delivery by id | **404** (not 403 — existence is not confirmed to a stranger) |
| Customer A cancels customer B's delivery | rejected |
| Rider requests a job not offered to them | rejected |
| Rider completes a job assigned to another rider | rejected |
| Customer calls an admin route | **403** |
| Rider calls a customer route | **403** |
| Token with a tampered `role` claim | rejected — the role is re-read from the database on every request |
| Tracking share link with a modified token | rejected — HMAC-signed, and revocation is honoured |
| Report download link reused after expiry | rejected |

**How it is enforced:** not in the controllers one by one, but in the service layer, where every
query that returns customer data includes the owner in the `WHERE` clause
(`where: { id, customerId }`). The difference matters: a controller-level `if` is forgotten the
day someone adds a route, whereas a `WHERE` clause that is missing returns nothing.

**Audit trail:** every privileged action writes an `audit_log` row — who, what, when, before and
after. 216 rows in the development dataset. Financial actions additionally reference the ledger
entries they produced, so "why did this rider's balance change" is answerable months later.

---

## 3. The refresh-token replay window (a deliberate relaxation)

**What was found.** During end-to-end testing the platform logged a customer out for no reason.
The log said it plainly:

```
SECURITY: refresh token reuse detected for user ef736421…. Family 843f06c5… revoked.
```

The cause was ordinary: two refreshes left the browser at the same moment — a reload racing the
in-flight refresh, two tabs waking together, a socket reconnect while a request was 401-ing. The
first response rotated the cookie; the second request had already been built with the old one and
arrived milliseconds later. The server did exactly what it was designed to do and killed a
legitimate session.

**Why simply loosening detection would be wrong.** Reuse detection is the mechanism that makes a
stolen refresh token survivable. Turning it off to fix a test flake trades a rare annoyance for a
permanent security hole.

**What was done instead — two changes, both bounded:**

1. **Client: an origin-wide lock.** `frontend/src/lib/api.ts` serialises refreshes with the Web
   Locks API (`navigator.locks.request('dispatch:refresh-token', …)`), so a reload, a second tab
   and a socket reconnect queue behind one rotation instead of racing it. Falls back to the
   in-page single-flight promise where Web Locks is unavailable. This is the actual fix: the
   condition that produced the false positive no longer occurs.
2. **Server: a 30-second replay grace, conditional on the session still being healthy.**
   `backend/src/auth/token.service.ts` serves a *sibling* token in the same family when a
   just-rotated token is replayed **inside 30 s** and **the successor token is still alive**.
   The replay is logged as suspicious. All of the following still revoke the family exactly as
   before: a replay after 30 s; a replay when the successor has itself been revoked; a replay
   from a revoked or expired family; any replay where the token has no successor.

**Why this is still proof against theft.** A thief replaying a stolen token at any realistic
attacker cadence — hours later, after the victim has kept using the app — lands outside the
window or meets a rotated successor, and kills the family. The window only forgives the one
pattern an attacker cannot manufacture: a request already in flight at the exact moment of
rotation, on the same browser, with the successor still valid. The window is 30 s of *race*,
not 30 s of *access*: the replayer gets a fresh token in the same session, which is precisely
what the legitimate client was about to get anyway.

**Tested both ways** (`backend/test/auth.e2e.spec.ts`): a race inside the window is served a
sibling and the family survives; a replay after the window revokes the family and every token in
it dies. The E2E master scenario now passes **three consecutive runs** — the check that
originally caught the flake.

---

## 4. Money

This is where a bug is unrecoverable, so the design removes the possibility rather than
monitoring for it.

| Rule | Enforcement |
|---|---|
| Money is never a float | integer kobo everywhere; `nairaAmountSchema` parses input; formatted only at the edge |
| A balance is never a stored, edited number | balances are **derived** from `ledger_lines`; the ledger is append-only |
| Every movement has two sides | debits − credits = **0**, asserted by the test suite and by the restore drill |
| Wallets cannot go negative | PostgreSQL `CHECK (balance >= 0)` constraint — the database refuses, not the application |
| A payment is never trusted from the client | the amount comes from the order; the client only picks *how* to pay |
| Webhooks are authenticated | Paystack: HMAC-SHA512 over the **raw** body with `timingSafeEqual`; Flutterwave: `verif-hash` compared in constant time |
| Webhooks are idempotent | a replayed webhook does not double-credit; state transitions are conditional |
| Refunds are not deletions | a refund is a new, opposite ledger entry with a reason and an actor |
| Rider payouts are two-person in spirit | a withdrawal is requested by the rider and approved by staff; the approval writes its own audit row and ledger entry |
| Nothing is edited in place | there is no code path that `UPDATE`s a ledger line or a settled payment |

**Verified:** `backend/test/payments.e2e.spec.ts`, `ledger` tests, `withdrawals` tests, and the
reconciliation report — which recomputes platform revenue from raw rows and compares it to the
financial summary. It agrees to the kobo, and the demo seed fails loudly if it does not.

**Residual risk, stated plainly:** with `PAYMENTS_MODE=DEVELOPMENT` there is a `/simulate`
endpoint that fakes a gateway callback. It exists so the whole payment path can be exercised
without a real card. It requires an authenticated session and refuses to run in live mode — but
it **must** be confirmed off before real money is accepted, which is why `GO-LIVE-CHECKLIST.md`
tests for it explicitly.

---

## 5. Input, output and files

| Risk | Control |
|---|---|
| Injection | Prisma parameterises everything. There is **no** raw SQL string interpolation anywhere; the only `$queryRaw` uses tagged-template parameters |
| XSS | React escapes by default; no `dangerouslySetInnerHTML` in the codebase; strict CSP at Nginx (`script-src 'self'`, no `unsafe-eval`) |
| CSRF | the refresh cookie is `SameSite=Lax` and `Path`-scoped to `/api/v1/auth`; every state-changing call carries a bearer token, which a cross-site form post cannot set |
| Oversized bodies | API: JSON 8 MB, urlencoded 1 MB (`main.ts`). Nginx: `client_max_body_size 12m` — deliberately above the API's cap so the API, not the proxy, produces the error message |
| Malicious uploads | MIME allowlist (JPEG/PNG/WebP/PDF), 5 MB cap (`MAX_UPLOAD_BYTES`), decoded and size-checked server-side, stored under a server-generated key |
| Path traversal | `storage.service.ts` resolves the key against the storage root and rejects anything that escapes it |
| Mass assignment | every endpoint validates a Zod schema; unknown fields are stripped, never passed to Prisma |
| Error leakage | errors are shaped by a global filter: a code, a human message, an optional request id. Stack traces and SQL never reach a client |
| Enumeration | login does not reveal whether an account exists; wrong password and unknown account return the same response |
| Request forgery against third parties | all outbound calls (Paystack, Flutterwave, Google, Resend, Termii) are server-side with keys from the environment — never from the browser |

**Rate limiting** is a first-class guard (`RateLimitGuard`, Redis-backed, `APP_GUARD`), applied
per route with an explicit budget: sign-in 10/5 min **per account**, sign-up 5/10 min per IP,
OTP 10/5 min per phone, quotes 60/min, autocomplete 30/min. In the load smoke test, 10 of 40
concurrent autocomplete calls were correctly rejected with 429 — the limit working, not a defect.

---

## 6. Secrets and deployment

| Control | Detail |
|---|---|
| No secrets in the repo | every credential is env-gated; `.env` files are git-ignored and excluded from the Docker build context by `.dockerignore` |
| No secrets in the frontend | the SPA receives only the **public** Paystack/Flutterwave keys and, optionally, the Maps browser key — which is public by design and should be domain-restricted in Google Cloud |
| Secrets are validated at boot | `env.config.ts` refuses to start with a placeholder or missing production secret |
| One published port | only `web` (Nginx) is reachable; Postgres, Redis and the API are inside the compose network |
| Containers run unprivileged | the API runs as **uid 10001**, not root |
| Immutable assets | Vite fingerprints assets and Nginx caches them for a year; the SPA shell is never cached |
| Uptime vs liveness | `/health/live` (process) is separate from `/health` (dependencies), so a slow database does not cause a restart loop |
| Migrations do not race | a one-shot `migrate` service must exit 0 before `api` starts |

---

## 7. Dependency audit

Run for real, and gated in CI by `scripts/audit-runtime.mjs`:

```
$ npm audit --omit=dev
3 high severity vulnerabilities
```

| Package | Severity | Advisory | Where it comes from |
|---|---|---|---|
| `deepmerge-ts` | high | stack exhaustion when merging recursive object graphs | dependency of `@prisma/config` |
| `@prisma/config` | high | via `deepmerge-ts` | dependency of `prisma` |
| `prisma` | high | via `@prisma/config` | **a dependency of `@prisma/client`**, which the API uses |

### The correction that matters

An earlier draft of this review said these three were "build-time only, absent from the runtime
image". **That was wrong, and it was checked rather than assumed.** A clean
`npm ci --omit=dev` tree was built in isolation and inspected:

```
199 packages installed
node_modules/.bin/prisma           PRESENT   ← the CLI ships
node_modules/@prisma/client        PRESENT
node_modules/.prisma              PRESENT   ← but only the "did you generate?" stub, 0 engine binaries
```

npm installs `prisma` in a production tree because `@prisma/client` declares it as a dependency. So the
three advisories **are inside the runtime image**, and no `--omit=dev` flag removes them.

### Why the finding is still low risk

The vulnerable code path is `deepmerge-ts` invoked while the **CLI** parses a Prisma configuration —
that is, during `prisma generate`, `prisma migrate` or `prisma studio`. The running API never invokes
the CLI: it imports `@prisma/client`, which talks to the query engine binary, not to the config parser.
Reaching the vulnerable function therefore requires an attacker to already be able to execute commands
inside the container — at which point they hold the database credentials and this is the least of the
problems.

So the disposition is **allowlisted and monitored**, not "not present".

### The gate, which is the actual deliverable

`scripts/audit-runtime.mjs` maintains an explicit `BUILD_ONLY` allowlist with a reason per entry, and
fails the build on **any** high or critical advisory that is not on it:

```bash
node scripts/audit-runtime.mjs      # ✓ exit 0 — 3 high, all allowlisted as CLI-path-only
```

That means the day a vulnerable package enters the tree through a path anyone can reach — a parser, an
HTTP client, a template engine — CI goes red without anyone remembering to look. The allowlist is
reviewed whenever Prisma is upgraded, and shrinks to nothing if a future Prisma release stops depending
on the CLI from the client package.

**Toolchain is current:** zod **4.6.7** everywhere (the zod 3 → 4 migration was completed, not worked
around), `@hookform/resolvers` 7.x, vitest 4.1.12, multer 2.5.0, React 19, NestJS 11, Prisma 6.19.3.

## 8. Findings register

| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | **Medium** | No MFA on admin accounts, which can move money | Accepted for launch. Mitigation: long unique passwords, network restriction on `/admin`. **Fix trigger:** first real-money month, or first staff account beyond the founders |
| 2 | **Medium** | No automated off-box backup; the script exists, the cron/rclone wiring is a VPS decision | Accepted, documented in `RUNBOOK.md` §4.1 with the exact crontab. **Fix trigger:** before the platform carries real money — this is a go-live blocker |
| 3 | Low | Docker images authored but never built in this environment | Accepted, marked **UNTESTED** in `RUNBOOK.md` §8. **Fix trigger:** first VPS deploy, which is itself the test |
| 4 | Low | `/simulate` payment endpoint exists for the development path | By design; refuses to run when `PAYMENTS_MODE=LIVE`, and the go-live checklist verifies it |
| 5 | Low | Stub maps mean distances are modelled, not measured | By design and disclosed in the UI; set `MAPS_PROVIDER=GOOGLE` to switch |
| 6 | Low | Staff roles page renders "super admin" twice | Cosmetic; permissions are correct. Recorded, not fixed (UI change not authorised) |
| 7 | Low | A staff invitation link is a bearer credential: whoever opens it first becomes that admin | By design, and constrained: super-admin only, single use (conditional UPDATE), 72-hour default expiry, withdrawable, and the hash—not the link—is stored. A surprise acceptance is visible in the invitations list. See `documentation/STAFF-INVITATIONS.md` |

**Nothing in this register is a P1.** Two items (1 and 2) are genuine and time-boxed; the rest
are decisions with the reasoning attached.

---

## 9. What would be attacked first, and what happens

Written as a pre-mortem, because this is the part of a security review that ages best.

| Attack | Result today |
|---|---|
| Credential stuffing on `/auth/login` | 10 attempts per account per 5 min, then 429. Argon2id makes offline cracking of a stolen table impractical. MFA would stop this — the strongest argument for item 1 |
| Steal a refresh cookie via XSS | the cookie is HttpOnly and cannot be read by script; the CSP blocks inline and eval scripts. A stolen *access* token is useless after 15 min |
| Replay a stolen refresh token | outside a 30 s race window, the family is revoked and the attacker and the victim are both logged out — the victim is told |
| Change a URL id to read another customer's order | 404, because ownership is in the `WHERE` clause |
| Forge a payment webhook | HMAC-SHA512 over the raw body with constant-time comparison; a wrong signature is rejected before any money logic runs |
| Replay a genuine webhook | idempotent transitions — the second delivery credits nothing |
| Upload a script and fetch it back | MIME allowlist, and files are served from a different path than the app; CSP forbids executing them |
| Traverse the storage root with `../` | rejected by `absolutePath()` |
| Brute-force an OTP | 10 per 5 min per phone number |
| Enumerate users via login errors | identical responses for unknown account and wrong password |
| Reach the database from the internet | it has no published port |

---

## 10. Sign-off

| | |
|---|---|
| Reviewed by | engineering (build agent), with the tests listed below as evidence |
| Code evidence | 254 backend tests across 15 files, including dedicated auth/payments/withdrawal/report suites |
| Runtime evidence | Playwright master scenario (20 steps end to end), load smoke at concurrency 40, backup/restore drill (ledger sums to zero after restore) |
| Dependency evidence | `node scripts/audit-runtime.mjs` → exit 0 |
| Outstanding before real money | `GO-LIVE-CHECKLIST.md` items 1–12, in particular `PAYMENTS_MODE` and webhook secrets |

**Re-review required when:** MFA is added, a second payment provider is configured for live, the
storage driver changes from `LOCAL` to S3 (a new class of access-control bug lives there), or
any new role is introduced.
