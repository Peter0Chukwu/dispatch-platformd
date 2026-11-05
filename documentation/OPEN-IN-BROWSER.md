# Open it in a real browser

Two separate things, and it is worth knowing the difference before you click anything:

| | |
|---|---|
| **A. See it running right now** | The app is live in this workspace and visible from your own browser through the preview panel. Nothing to install. Start here. |
| **B. Run it on your own machine** | Your laptop runs the API, the database and the web app locally — the real thing, on your hardware, with your configuration. This is the option for later, once we push the code to your GitHub. |

---

## A. See it running right now

**Click the live preview named `Dispatch — customer, rider & admin portals`** in the preview panel of
this conversation. That is the real application: the same code, the same database, the same API that
the 20-step test drives. It is not a video and not a mock.

> Everything you need is behind that one link. The preview hostname is served by a proxy, so there is no
> `localhost` address to type — a `localhost` URL only ever works *inside* the sandbox, never from your
> computer. One link, all three portals.

### Sign-in details

The database is seeded with one account per portal. All three use the same password pattern — capital
first letter, `@12345`:

| Portal | Email | Password |
|---|---|---|
| **Admin** (command centre) | `admin@dispatch.test` | `Admin@12345` |
| **Rider** (phone app) | `demo.rider@dispatch.test` | `Rider@12345` |
| **Customer** | `demo.customer@dispatch.test` | `Customer@12345` |

The login screen has a portal selector at the top. It is not cosmetic: the audience is checked on the
server, so an admin account cannot obtain a customer token, and a customer cannot sign in through the
admin portal.

### A ten-minute tour, in the order that shows the most

Sign in as **admin** first — it is the widest view.

1. **Overview.** Every card is a PostgreSQL `COUNT`/`SUM` at request time. Note the numbers, then
   refresh: they change only when a real row changes.
2. **Live dispatch board.** Waiting bookings, offers in flight, and any job the engine gave up on.
   That third column is the honesty of the design — when automation fails, it says so and asks a human.
3. **Deliveries.** Search, filter by status, open one, and read its *timeline*: every status change with
   a timestamp, plus the assignment attempts that led there.
4. **Finance → Reconciliation.** This is the screen that argues for double-entry. Five checks run
   against the live journal: debits equal credits, every successful payment has exactly one entry,
   wallets match the ledger, rider payables match accruals, withdrawals in transit match their account.
   If a money bug existed, it could not hide here.
5. **Reports.** Pick *Financial summary*, set a date range, and press **Preview** first — it runs the
   same query the file will and writes nothing. Then generate it and watch the row move `QUEUED` →
   `READY`. The request returns in milliseconds; the file is rendered by a worker.
6. **Settings → Audit log.** Everything you have just done is in here, with actor, IP and before/after.

Now open the **same preview link in a second browser tab** and sign in as the **rider**. Put the two
windows side by side — this is the part a screenshot cannot show you.

7. As the rider: toggle **online**. On the admin side, the rider becomes eligible and the counts move.
8. As the rider: open **Offers**. A live card appears with a countdown ring; the expiry time comes from
   the server, so the browser never decides when an offer dies.
9. Accept it, then walk the workflow: *at pickup → collected → in transit → at destination → proof photo
   → delivered*. Each tap is a separate authenticated call validated by the shared state machine, so the
   UI can only ever offer the next legal step.

Then sign in as the **customer** in a third tab:

10. **Book a delivery.** Pick an address, choose a package size, and look at the quote. The price is
    computed server-side in integer kobo from a real Lagos route — the browser sends two coordinates and
    nothing else. Every line of the breakdown is shown so you can argue with it.
11. Pay. In this development environment payment is **simulated on purpose**, through the same code path
    a real Paystack webhook uses. The banner says so rather than pretending a card was charged.
12. Watch the delivery move, then open **Track** and start the share link — that link works in a browser
    with no account at all, shows the rider's first name and position, and stops working the moment you
    revoke it.

### What to look at if you only have two minutes

Open **admin → Finance → Reconciliation**, then **admin → Reports → Financial summary → Preview**.
Those two screens are the whole argument of the platform: the money is provable, and a report's totals
are checked against the rest of the system rather than trusted.

### Things you will notice, and why they are correct

| What you see | Why |
|---|---|
| An amber *DEVELOPMENT MODE* banner | Payments are simulated and messages print to the log. A deliberate switch, not a gap — `deploy/.env` changes it |
| The map is a plain grid, with exact coordinates | No Google key is configured, so the basemap is a stub. **Positions are real; the streets are not** — and the caption says so |
| The customer list has dozens of `e2e.customer.*` accounts | Every end-to-end test run registers a new customer, because a real signup is the point of the test. `npm run db:reset && npm run db:seed` clears them |
| Sign-in refused after about ten rapid attempts | Rate limiting, per account, 10 per 5 minutes. Working as designed |
| Logging in twice in two tabs sometimes makes one reload | You are seeing the refresh-token rotation. It was rewritten in Phase 10 so this does not log you out |

---

## B. Run it on your own machine

Do this when you want the platform on your laptop, your database, your keys.

### What you need first

| | |
|---|---|
| **Node.js 22 or newer** | `node -v` → `v22.x`. [nodejs.org](https://nodejs.org) |
| **PostgreSQL 17** | The scripts can install it for you on Debian/Ubuntu or macOS with Homebrew |
| **Redis 8** | Same — or `brew install redis` / `apt install redis-server` |
| **Git** | `git --version` |

### The commands

```bash
# 1. Get the code (once the GitHub push is done — see the note below)
git clone https://github.com/<your-account>/dispatch-platform.git
cd dispatch-platform

# 2. Start PostgreSQL and Redis, install everything, migrate, seed
npm run setup
```

`npm run setup` is deliberately one command: it brings up the database and cache, installs the
workspace, builds the shared package, applies migrations and seeds the demo data. If it fails, it fails
loudly and tells you which step.

```bash
# 3. Run it
npm run dev
```

Then open **http://localhost:5173** on your own machine — that works locally, because it is your own
localhost, not the sandbox's. Sign in with the same three accounts as above.

### The useful commands

| Command | What it does |
|---|---|
| `npm run dev` | API on :4000 and web on :5173, both watching for changes |
| `npm test` | the 254 backend tests (Vitest + Supertest) |
| `npx playwright test` | the 20-step browser journey, ~1.5 minutes |
| `npm run db:studio` | Prisma Studio — browse and edit the database in a browser |
| `npm run db:reset` | drop everything, re-migrate, re-seed (destroys local data) |
| `node scripts/audit-runtime.mjs` | the dependency gate |
| `bash scripts/db-restore-drill.sh` | prove a backup restores and the ledger still balances |

### Configuration

Copy `.env.example` (repository root) to `backend/.env` and fill in what you have. **Nothing is required to run
locally** — the defaults use stub maps, simulated payments and console messages, so the app is fully
usable with no accounts anywhere.

When you are ready for real integrations, `documentation/CREDENTIALS-SETUP.md` lists every credential:
which dashboard page to visit, which `.env` line it goes into, and what it costs.

> **Never paste a secret key into a chat message.** Put it in `backend/.env` yourself — that file is
> git-ignored, excluded from the Docker build context, and never sent anywhere.

### To deploy it on a server

`docker-compose.yml` and `deploy/` are ready, and `documentation/RUNBOOK.md` §2 walks through a first
deploy line by line, followed by `documentation/GO-LIVE-CHECKLIST.md`.

> **One honest warning.** There is no Docker in the environment this platform was built in, so the
> Docker images have been written and reviewed but never built. The first `docker compose up --build`
> on your server is a genuine test — expect something small and boring (a missing binary, a path) and
> it will be obvious in `docker compose logs`. This is labelled **UNTESTED** in the runbook rather than
> glossed over.

### The one thing still outstanding: the GitHub push

The code is committed locally — all ten phases, `6d8ec98` being the last — but **not pushed**, because
you asked to finish the work first. When you want it on GitHub (and to be able to clone it as shown
above), I need a fine-grained personal access token scoped to a single private repository named
`dispatch-platform`, with **Contents: Read and write** and a 1-day expiry. You paste it into the
sandbox environment, never into a file and never into this chat.

Until then, `documentation/BUILD-REPORT.html` is the self-contained visual record you can open anywhere,
with no server and no network.
