# Running the platform on your own machine

> **Goal:** the platform running on your laptop, on your own database, open at
> `http://localhost:5173`, in about 15 minutes.
>
> **You need no accounts and no API keys.** Payments run in simulated mode, SMS and email
> print to the terminal, and the map is a grid. Everything below works offline.
>
> This guide covers **Windows** and **macOS / Linux**. Windows commands are shown first;
> where the other systems differ, a line underneath says so.

---

## What you are installing

| Piece | What it does | How you get it |
|---|---|---|
| **Node.js 20+** | runs the API and builds the web app | installer from nodejs.org |
| **Docker Desktop** | runs PostgreSQL and Redis in two containers | installer from docker.com |
| the code | this repository | `git clone` (or the zip) |

**Two things people get wrong here, so they are said once and loudly:**

- **Do not run `npm run setup` or `npm run env:up`.** Those scripts call
  `scripts/dev-env-up.sh`, which is written for an Ubuntu server (it uses `apt-get` and
  `pg_ctlcluster`). On Windows they fail, and on a Mac they install nothing useful.
  Docker covers the same ground below.
- **Never type `npx prisma ...`.** `npx` downloads the newest Prisma, which is a major
  version ahead of this project, and it fails confusingly. Always use the `npm run`
  commands below — they are pinned to the version in `package-lock.json`.

---

## Step 1 — Install Node.js

Download the **LTS** installer from <https://nodejs.org> and accept the defaults.

Check it in a **new** terminal window:

```powershell
node -v
npm -v
```

You want `v20.x` or higher (v22 is ideal). If you see "not recognised", close the terminal,
open a new one, and try again — the installer only updates the PATH for new windows.

> **macOS/Linux:** `brew install node` or your package manager; `node -v` to confirm.
> With nvm, `nvm install 22`.

---

## Step 2 — Install Docker Desktop

Download from <https://www.docker.com/products/docker-desktop/> and install it. On Windows it
offers to install WSL 2 — accept that; it is what Docker actually runs on.

**Start Docker Desktop and wait until the whale icon stops animating.** Then check:

```powershell
docker --version
docker compose version
docker ps
```

`docker ps` should print a table with columns and no rows. If it says
*"error during connect"* or *"cannot connect to the Docker daemon"*, Docker Desktop is not
running yet — open it and wait.

> **macOS:** same installer, drag to Applications, open it once.
> **Linux:** install Docker Engine and the compose plugin; no Desktop needed.

---

## Step 3 — Get the code

```powershell
git clone https://github.com/YOUR-NAME/YOUR-REPO.git
cd YOUR-REPO
```

No Git? Install it from <https://git-scm.com/downloads>, or download the repository as a ZIP
from GitHub and unzip it — everything after this step is identical.

Confirm you are in the right folder:

```powershell
dir
```

You should see `backend`, `frontend`, `packages`, `package.json` and `docker-compose.local.yml`.

---

## Step 4 — Start PostgreSQL and Redis

One command, from the project folder:

```powershell
docker compose -f docker-compose.local.yml up -d
```

The first run downloads two small images (about a minute). Then check both are healthy:

```powershell
docker compose -f docker-compose.local.yml ps
```

You want **two services, both `running`**, with postgres reporting `(healthy)` once it has
finished starting (give it ~10 seconds).

These containers restart themselves when you reboot. Their data lives in a Docker volume, so
it survives stopping them — and is only destroyed if you deliberately run `down -v`
(see *Everyday commands*).

> This file is local-only on purpose: it publishes the database on `127.0.0.1` only and uses
> throwaway credentials. It is not the deployment stack and must never be copied to a server.

---

## Step 5 — Create the config file

The API refuses to start without three long random secrets. Generate them:

```powershell
[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
```

Run that **three times** and keep the three 64-character strings.

> **macOS/Linux:** `openssl rand -hex 32` (run it three times).

Now create the file. Copy the template and open it:

```powershell
copy .env.example backend\.env
notepad backend\.env
```

> **macOS/Linux:** `cp .env.example backend/.env` then edit with `nano backend/.env`.

**The path matters: it must be `backend/.env`, not `.env` in the project root.** The API looks
there when it starts.

In that file, change exactly these lines:

```ini
DATABASE_URL="postgresql://dispatch:dispatch_dev_password@localhost:5432/dispatch_dev?schema=public"
REDIS_URL="redis://localhost:6379"

JWT_ACCESS_SECRET=paste-first-secret-here
JWT_REFRESH_SECRET=paste-second-secret-here
TRACKING_LINK_SECRET=paste-third-secret-here
```

Leave everything else as it is. In particular `PAYMENTS_MODE=DEVELOPMENT`,
`SMS_MODE=CONSOLE`, `EMAIL_MODE=CONSOLE` and `MAPS_PROVIDER=STUB` are what make the app run
with no external accounts. The database credentials match Step 4 exactly — if you change one,
change both.

Save and close.

---

## Step 6 — Install dependencies

From the project folder:

```powershell
npm ci
```

Expect a few hundred packages and 1–3 minutes. `npm ci` installs exactly what the lockfile
says, so your machine matches every machine that has built this project. (`npm install` also
works, but it may quietly upgrade patch versions.)

If it fails with `EPERM` or `ENOENT` on Windows, close any editor or antivirus scan touching
the folder and run the terminal **as Administrator** once.

---

## Step 7 — Build, migrate, seed

Three commands, in this order. Each one is short.

```powershell
npm run build:shared
```

Compiles the shared package that both the API and the web app import. **Skipping this is the
cause of the most common error** (`Cannot find module '@dispatch/shared'`).

```powershell
npm run db:migrate
```

Creates every table, index and constraint in the `dispatch_dev` database. Expect a list of
migrations ending in `Your database is now in sync with your schema.`

```powershell
npm run db:seed
```

Loads configuration: the roles and permissions, 16 ledger accounts, the service zones and
pricing rules, the system settings, the FAQs, and **one super admin**. It prints that admin's
email and password at the end:

```
   admin@dispatch.test
   ⚠ This password is shown once. Change it immediately after first login.
```

> The seed is idempotent — running it twice changes nothing. It deliberately creates **no**
> fake customers, riders, deliveries or revenue. An empty dashboard after this step is
> correct, not a bug.

---

## Step 8 — Start it

```powershell
npm run dev
```

This builds the shared package, then starts **two** processes side by side in one terminal:

- `api` — the NestJS server on port **4000**
- `web` — the Vite dev server on port **5173**

Leave this terminal open. It is the running application. When you see

```
➜  Local:   http://localhost:5173/
```

you are up.

---

## Step 9 — Open it

Go to **<http://localhost:5173>** and sign in with the super admin from Step 7:

| | |
|---|---|
| Email | `admin@dispatch.test` |
| Password | `Admin@12345` |

Same page, different audience: the sign-in screen switches between **Customer**, **Rider** and
**Admin**. There are no customer or rider accounts until you create them (Admin → Riders to
invite a rider, or the optional demo data in the next section).

**You are done.** To stop everything, press `Ctrl+C` in the terminal, and when you come back
later run Step 4 then Step 8 (`docker compose -f docker-compose.local.yml up -d`, then
`npm run dev`).

---

## Optional — fill it with demo data

An empty platform is a poor demo. Five scripts create realistic data **through the real HTTP
API** — no direct database writes — so everything they make has been through the same
validation a real user hits.

`npm run dev` must still be running in its own terminal. In a **second** terminal, from the
project folder, in **this order**:

```powershell
node scripts/seed-demo-phase4.mjs
node scripts/seed-demo-phase6.mjs
node scripts/seed-demo-phase7.mjs
node scripts/seed-demo-phase9.mjs
node scripts/seed-demo-phase8.mjs
```

That order matters: phase 9 needs a free rider to build a week of history, and phase 8
deliberately leaves a rider **mid-delivery** with a live position trail — so it goes last, and
only if nothing else needs the rider.

Each prints what it created and the demo logins:

```
Sign in at /login as a rider:
  demo.rider@dispatch.test / Rider@12345
Customer:
  demo.customer@dispatch.test / Customer@12345
```

If a script stops with **`429 Too many attempts`**, that is a rate limit doing its job. Wait
60 seconds and run the same script again — they are safe to re-run.

> ⚠ **Demo data is for local machines and demos only. Never run these scripts against a real
> deployment** — the data would be indistinguishable from real customers and real money.

---

## Optional — open it from your phone or another PC on the same Wi-Fi

1. Find this machine's address:

   ```powershell
   ipconfig
   ```

   Read the **IPv4 Address** under your active adapter — something like `192.168.1.50`.

   > **macOS/Linux:** `ipconfig getifaddr en0` / `hostname -I`.

2. On the other device, open `http://192.168.1.50:5173`.

3. The page will load but sign-in will fail with a **CORS** error until you allow that address.
   In `backend/.env`, edit:

   ```ini
   CORS_ORIGINS="http://localhost:5173,http://192.168.1.50:5173"
   FRONTEND_URL=http://192.168.1.50:5173
   ```

   `FRONTEND_URL` is not in the template — add the line. It is only there so that tracking
   links and payment return URLs the app generates point at the right host.

4. Restart: `Ctrl+C` in the `npm run dev` terminal, run `npm run dev` again.

On Windows, the first time another device connects, a **Firewall** prompt appears — allow it
on **private** networks. Choose public and it will stay blocked.

---

## Optional — share it over the internet for a demo

Use a tunnel. It needs no router changes, no port forwarding and no static IP, and it closes
when you stop it.

```powershell
winget install Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:5173
```

It prints a public `https://something-random.trycloudflare.com` address. Send that to whoever
you are showing.

Two things to know before you do this:

- **That URL is open to the internet.** Add the tunnel address to `CORS_ORIGINS` in
  `backend/.env` and restart the API, or sign-in fails — and it is the *same* address, so the
  quick-tunnel URL changes every time you start it.
- **It is a demo, not hosting.** No HTTPS certificate of your own, no backup, and it stops the
  moment your laptop sleeps. For anything that needs to stay up, that is the deployment work
  already written in `documentation/DEPLOYMENT-ROADMAP.md`.

> **macOS:** `brew install cloudflared`. **Anything with Node:** `npx localtunnel --port 5173`.

---

## Everyday commands

Run all of these from the project folder.

| I want to… | Command |
|---|---|
| Start the database and Redis | `docker compose -f docker-compose.local.yml up -d` |
| Start the app | `npm run dev` |
| Stop the app | `Ctrl+C` in that terminal |
| Stop the containers (data kept) | `docker compose -f docker-compose.local.yml down` |
| Look at the database in a browser | `npm run db:studio` → <http://localhost:5555> |
| Run the test suite | `npm test` |
| Throw the data away and start clean | `docker compose -f docker-compose.local.yml down -v`, then `npm run db:migrate` and `npm run db:seed` |

`down -v` deletes the Postgres volume. That is the reset button — there is no undo.

---

## When something goes wrong

| What you see | What it means | Fix |
|---|---|---|
| `Cannot find module '@dispatch/shared'` | the shared package was never built | `npm run build:shared`, then retry |
| `Environment variable not found: DATABASE_URL` | no `backend/.env`, or it is at the project root instead | create `backend/.env` (Step 5) |
| `Can't reach database server at localhost:5432` | the containers are not running | `docker compose -f docker-compose.local.yml up -d`, then `docker compose -f docker-compose.local.yml ps` |
| `JWT_ACCESS_SECRET must be at least 32 characters` | a secret was pasted short or left as the placeholder | generate one with Step 5 and paste the whole string |
| `EADDRINUSE :4000` or `:5173` | something else owns the port — often an earlier terminal you forgot | Windows: `netstat -ano \| findstr :4000` gives a PID; `taskkill /PID <pid> /F`. macOS/Linux: `lsof -ti:4000 \| xargs kill` |
| `429 Too many attempts` | rate limits (sign-in is 10 per 5 minutes) | wait a minute — the limit is deliberate |
| Sign-in works on localhost but fails from another device | that address is not in the CORS allowlist | see *open it from your phone*, Step 3 |
| Page loads, everything is red / "Network Error" | the API is not running — look at the `npm run dev` terminal for the line that killed it | fix what the API printed, then restart |
| `npx prisma` errors about `prisma7.config.ts` | you used `npx` | use `npm run db:migrate` / `db:seed` instead |
| Docker: `error during connect` | Docker Desktop is not running | start it, wait for the whale to settle |

Still stuck? The terminal output is the useful thing, and both processes print the real error
rather than a generic one — copy that line rather than paraphrasing it.

---

## What you are running, and what is simulated

| | |
|---|---|
| **Real** | PostgreSQL 17, Redis 8, the NestJS API, the React app, authentication and permissions, the ledger and every money calculation, dispatch offers, the state machine on deliveries, report generation |
| **Simulated on purpose** | payments (`PAYMENTS_MODE=DEVELOPMENT` — a backend simulator, no money moves), SMS and email (printed to the API terminal), the map (grid tiles, exact coordinates) |
| **Off by default** | Google Maps, Paystack/Flutterwave live keys, Termii SMS, Resend email — each is one environment variable, no code change |

That is why the app shows an amber **DEVELOPMENT MODE** banner: it is a switch, not a missing
feature. See `documentation/DEMO-SCRIPT.md` for how to walk someone through what is on screen.
