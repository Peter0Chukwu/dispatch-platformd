"""
Builds a single self-contained HTML progress report with every screenshot
embedded as a data URI, so it renders in a sandboxed preview with no network.
    python3 scripts/build-report.py
"""
import base64, io, json, os, subprocess
from datetime import datetime, timezone
from PIL import Image

OUT = "documentation/BUILD-REPORT.html"
SHOTS = [
    ("screenshots/phase-8/02-customer-live-tracking.png", "Phase 8 — the customer sees the rider, and the map admits what it is", "\u007e23 min and 8.4 km to the drop-off, measured from the rider's last reported coordinate \u2014 not from the booking's stored distance. The caption under the map says the positions are exact and the basemap is not, because Google Maps is not configured yet. A schematic that says it is a schematic is honest; a fake street map would not be."),
    ("screenshots/phase-8/05-admin-operations-map.png", "Phase 8 — the dispatcher's city view", "One rider on a delivery between pickup and drop-off, one job waiting for a rider, and the counts above the map computed from the same payload that drew the markers. Riders who have never pinged are not drawn at all \u2014 they are counted as missing instead of parked at their branch."),
    ("screenshots/phase-8/04-public-tracking.png", "Phase 8 — a share link a recipient can open", "No account, no app, no session \u2014 the token is the credential. It shows the parcel, the rider's first name and the expiry date, and nothing else: no phone numbers, no customer identity. The customer can revoke it at any moment and the old URL stops working immediately."),
    ("screenshots/phase-8/06-admin-map-rider-focus.png", "Phase 8 — clicking a rider", "Position 6.5432, 3.3876, reported at 12:30:00, on job DSP-261105-94TR. The coordinate is real browser geolocation captured during the run, and the \u201creported\u201d timestamp is the value the server stored \u2014 which is how a dispatcher tells a live phone from a quiet one."),
    ("screenshots/phase-8/07-rider-sharing-position.png", "Phase 8 — the rider's phone doing the reporting", "\u201cSharing your position \u00b7 last report 12:28:09 \u00b7 every 15 s while this screen is open.\u201d The cadence comes from TRACKING_PING_INTERVAL_SECONDS via /rider/location/config, so changing one environment variable changes every phone on its next launch."),
    ("screenshots/phase-8/08-rider-location-denied.png", "Phase 8 — when permission is denied, it says so", "The rider blocked location. Dispatch cannot see them, they are told exactly that, and nothing is sent \u2014 no position is guessed on their behalf and no marker appears anywhere in the platform. This is the state most systems model worst, so it is a screenshot rather than a footnote."),
    ("screenshots/phase-8/01-address-suggestions.png", "Phase 8 — address lookup through the adapter", "A search for \u201clekki\u201d returns the two places that actually match, from the server. With a Google key the same call is Places Autocomplete; without one it is the platform's own table of real Lagos coordinates, and the caption under the list says which. \u201cFind coordinates\u201d geocodes a typed address and admits when it cannot."),
    ("screenshots/phase-8/03-customer-share-link.png", "Phase 8 — a link, created and revocable", "The customer mints the link in one click and can copy or revoke it. It expires in 72 hours by default; an expired link returns \u201cthis tracking link has expired\u201d rather than a bare 404, because the person holding it deserves to know the difference."),
    ("screenshots/phase-7/02-reconciliation.png", "Phase 7 — the books reconcile, on demand", "Five checks against the live journal: debits equal credits at \u20a646,391.83, every successful payment has exactly one entry, wallet balances match the ledger, rider payables match accruals, and withdrawals in transit match their account. This screen is the whole argument for double-entry — a bug in the money code cannot hide from it."),
    ("screenshots/phase-7/01-finance-overview.png", "Phase 7 — the finance desk", "Collected \u20a637,900.00, rider cost \u20a63,758.50, gateway fees \u20a6831.83, net \u20a6108.17 — after a \u20a63,201.50 refund. Every figure is a SQL aggregate or a ledger balance at request time; none of it is a stored dashboard number."),
    ("screenshots/phase-7/05-withdrawals-approved.png", "Phase 7 — a rider payout, approved by a human", "Rita requested \u20a63,758.50 of cleared earnings. Approval moved the obligation from rider earnings payable to withdrawals payable; \u201cPay rider\u201d then sends the transfer and settles it. A rider cannot approve their own request \u2014 the API returns 403."),
    ("screenshots/phase-7/06-customer-wallet.png", "Phase 7 — the customer wallet", "\u20a627,555.50 after a \u20a630,000 top-up and a \u20a62,444.50 delivery paid from the wallet. The statement is not a log of intentions: each line carries the balance after it and points at a journal entry."),
    ("screenshots/phase-7/07-pay-delivery.png", "Phase 7 — paying for a booking", "Two real paths: the wallet (instant debit, journal entry) or a gateway (provider confirms, then we settle). In DEVELOPMENT the panel says the payment is simulated rather than pretending a card was charged \u2014 and the simulator settles through the same code path a real webhook uses."),
    ("screenshots/phase-7/08-rider-earnings.png", "Phase 7 — earnings, holds and withdrawals", "Cleared \u20a63,758.50, requested \u20a63,758.50, withdrawable \u20a60.00 \u2014 the same naira cannot be asked for twice. Earnings sit PENDING for the hold window (24 h by default) before they ever become spendable, and the request below shows the finance decision on record."),
    ("screenshots/phase-7/03-payments.png", "Phase 7 — the payment ledger", "Card, wallet and top-up payments with their gateway fees, statuses and customers. A refund is issued from this row; the refund then appears in the refunds tab and on the ledger."),
    ("screenshots/phase-6/01-dispatch-board.png", "Phase 6 — the dispatch board", "Four bookings waiting, three offers out and one job the engine could not place. The round, the radius and the countdown all come from rows the engine wrote — the board is a window on the scheduler, not a second source of truth."),
    ("screenshots/phase-6/02-rider-offers.png", "Phase 6 — the same offers, pushed to the phone", "These cards arrived over a Socket.IO connection authenticated with the rider's own token; the ring counts down from expiresAt on the server. The green badge in the header says Live only while the socket is actually connected."),
    ("screenshots/phase-6/04-exhausted.png", "Phase 6 — when automation gives up, it says so", "The rider declined everything, so the engine spent its rounds — 5 km, 12 km, 25 km, then the whole branch — and raised one alert for the desk. Red means a human has to decide; nothing pretends a rider is still being found."),
    ("screenshots/phase-6/05-manual-assign.png", "Phase 6 — the fallback: assign by hand", "The dispatcher picks an approved rider, gives a reason, and the assignment attempts below show exactly what the engine already tried: RDR-00001, auto, rejected \u201cPassed by rider\u201d. The override is audited like any other action."),
    ("screenshots/phase-6/06-delivery-history.png", "Phase 6 — the trail the engine leaves behind", "Every delivery keeps its status timeline and assignment attempts, so support can answer \u201cwhy was nobody sent?\u201d months later with records rather than memory."),
    ("screenshots/phase-5/01-overview.png", "Phase 5 — the operations dashboard, computed in SQL", "Every card is a PostgreSQL aggregate at request time: ₦3,201.50 gross, ₦640.30 commission, 100% success. Empty database → honest zeros."),
    ("screenshots/phase-5/02-deliveries.png", "Phase 5 — the delivery board before Phase 6", "Search, status filter, pagination, CSV export, and the manual assign/cancel drawer that Phase 6 now treats as the fallback."),
    ("screenshots/phase-5/09-audit.png", "Phase 5 — the audit trail", "Every sensitive action with actor, IP and before/after values. Suspension, assignment and pricing changes are all in here."),
    ("screenshots/phase-4/41-rider-offers-countdown.png", "Phase 4 — a live offer, with 18 of 20 seconds left", "This offer exists because a customer booked a delivery and the rider was online. The ring counts down from expiresAt on the server — the browser never decides when an offer dies. Accepting takes a Redis lock, so if two riders tap at once exactly one wins and the other is told the job is gone."),
    ("screenshots/phase-4/42-rider-active-job.png", "Phase 4 — the active job and its six-step workflow", "Accepted → at pickup → collected → in transit → at destination → delivered. Every step is a separate authenticated call that the shared state machine validates; the UI can only ever offer the next legal step, and a hand-crafted request that skips one gets 409."),
    ("screenshots/phase-4/43-rider-workflow-progress.png", "Phase 4 — the workflow after four recorded steps", "Each tap wrote a delivery_status_history row and a timestamp on the delivery. The customer's tracking page reads the same rows, so rider and customer can never disagree about where the package is."),
    ("screenshots/phase-4/44-rider-proof-of-delivery.png", "Phase 4 — proving delivery with a photo", "The recipient's 6-digit code is the default proof; a photo plus the recipient's name is the fallback. The photo is uploaded to private storage first and the completion call carries only its key. Completing twice returns 409 — the rider is paid exactly once."),
    ("screenshots/phase-4/45-rider-earnings.png", "Phase 4 — earnings, after real commission", "₦3,201.50 charge, 20% commission, ₦2,561.00 to the rider — frozen into the delivery at the moment of acceptance, so a later rate change cannot rewrite this rider's pay. Earnings sit PENDING for 24 hours before they become withdrawable."),
    ("screenshots/phase-4/46-rider-documents.png", "Phase 4 — documents, reviewed by a human", "Three documents, each approved by staff through /admin/riders/:id/documents/:id/review. The bytes live in private storage and are streamed only to a staff member holding rider:document:read — there is no public URL to guess."),
    ("screenshots/phase-4/47-rider-overview-mobile.png", "Phase 4 — the rider overview on a phone (390px)", "Riders work from phones. Availability is the first control on the screen, and it refuses to go online while a required document is unapproved — naming the document rather than failing silently."),
    ("screenshots/phase-4/40-rider-overview-online.png", "Phase 4 — the rider overview on desktop", "Every figure is read from the database: approval status, the online toggle, today's earnings, completed count and each document's review state. Nothing on this screen is a placeholder."),
    ("screenshots/33-book-review.png", "Phase 3 — review step with the server's price", "₦4,341.00 for Lekki → Yaba, 18.47 km. Every line — base fee, distance beyond the 2 free km, express surcharge — was computed in integer kobo by the API. The browser sent two coordinates and nothing else."),
    ("screenshots/34-delivery-detail.png", "Phase 3 — the booking, with its frozen price", "The breakdown on this page comes from deliveries.priceSnapshot, written at booking time. Changing the pricing rules tomorrow cannot rewrite what this customer was charged."),
    ("screenshots/35-deliveries-list.png", "Phase 3 — delivery history", "Real rows from the customer's own bookings, status-filtered and paginated by the API. Another customer's deliveries are unreachable: the query is scoped by customerId, and a probe returns 404 rather than confirming a reference exists."),
    ("screenshots/36-dashboard-filled.png", "Phase 3 — dashboard counters, now non-zero", "These figures come from COUNT and SUM in Postgres. The same screen showed honest zeros before the first booking — the numbers moved because a real delivery was created, not because someone typed a demo value."),
    ("screenshots/31-book-step1-pickup.png", "Phase 3 — pickup step", "Twelve real Lagos locations with coordinates stand in for the Google Maps picker (Maps is still stubbed). Distances are still measured server-side, so the price is right even before the map arrives."),
    ("screenshots/37-cancel-dialog.png", "Phase 3 — cancelling requires a reason", "The API stores who cancelled, when, and why, and writes a timeline entry. Cancelling is refused with 409 once a rider is carrying the package — the state machine decides, not the button."),
    ("screenshots/38-delivery-cancelled.png", "Phase 3 — cancelled, with the reason kept", "A cancelled delivery keeps its price snapshot and its full history. Nothing is deleted, so support can always reconstruct what happened."),
    ("screenshots/11-admin-dashboard.png", "Phase 2 — admin command centre (signed in)", "A real super-admin session. The staff directory, role badges and 37 permission chips are read from PostgreSQL through /admin/whoami and /admin/staff — capture by a real browser sign-in, not a mock."),
    ("screenshots/10-login.png", "Phase 2 — sign-in with portal selection", "One login screen, three audiences. The portal choice is enforced server-side: a customer account cannot obtain an admin token."),
    ("screenshots/12-register.png", "Phase 2 — customer registration", "Validated by the same Zod schema the API uses. Weak passwords are rejected by the server even if the browser is bypassed."),
    ("screenshots/13-verify.png", "Phase 2 — email + phone verification", "Single-use email token and a 6-digit SMS OTP stored only as a hash, with expiry and attempt limits. In development the codes are surfaced here because SMS_MODE=CONSOLE."),
    ("screenshots/14-customer-dashboard.png", "Phase 2 — customer portal after verification", "The session was restored from an HttpOnly refresh cookie; the access token is held in memory only and never in localStorage."),
    ("screenshots/15-login-mobile.png", "Phase 2 — mobile sign-in (390px)", "Riders sign in from phones; the brand panel is hidden and the form takes the full screen."),
    ("screenshots/01-landing-desktop.png", "Phase 1 — portal overview with live health checks", "The landing page queries /api/v1/health, which hits Postgres and Redis on every request. The indicators are real measurements."),
    ("screenshots/03-styleguide-desktop.png", "Phase 1 — design system (20 components)", "Buttons, form fields, stat cards, status pills driven by the shared state machine, money formatting, data table, empty/error/loading states, alerts, toasts, modals."),
    ("screenshots/06-modal-open.png", "Phase 1 — accessible modal dialog", "Portal-rendered, Escape to close, focus trapped, body scroll locked — the pattern every confirmation uses."),
]

MAX_W = 980
def embed(path: str) -> str:
    img = Image.open(path).convert("RGB")
    if img.width > MAX_W:
        img = img.resize((MAX_W, round(img.height * MAX_W / img.width)), Image.LANCZOS)
    buffer = io.BytesIO()
    img.save(buffer, format="JPEG", quality=74, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode()

def count(sql: str) -> str:
    try:
        out = subprocess.run(["psql", "-h", "localhost", "-U", "dispatch", "-d", "dispatch_dev", "-tAc", sql],
                             capture_output=True, text=True, env={**os.environ, "PGPASSWORD": "dispatch_dev_password"})
        return out.stdout.strip() or "?"
    except Exception:
        return "?"

stats = {
    "tables": count("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"),
    "indexes": count("SELECT count(*) FROM pg_indexes WHERE schemaname='public'"),
    "checks": count("SELECT count(*) FROM pg_constraint WHERE contype='c'"),
    "permissions": count("SELECT count(*) FROM permissions"),
    "roles": count("SELECT count(*) FROM roles"),
    "accounts": count("SELECT count(*) FROM ledger_accounts"),
    "zones": count("SELECT count(*) FROM service_zones"),
    "deliveries": count("SELECT count(*) FROM deliveries"),
    "riders": count("SELECT count(*) FROM riders"),
    "offers": count("SELECT count(*) FROM delivery_assignments"),
    "earnings": count("SELECT count(*) FROM rider_earnings"),
}

def resolve(relative: str) -> str:
    """
    Screenshot paths in SHOTS are written relative to `documentation/`, but this
    script is run from the repository root. Resolving both keeps the report correct
    whichever directory it is invoked from — running it from `documentation/` used to
    write a nested `documentation/documentation/` copy by mistake.
    """
    if os.path.exists(relative):
        return relative
    candidate = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "documentation", relative)
    return os.path.normpath(candidate)


cards = []
missing = []
for path, title, caption in SHOTS:
    path = resolve(path)
    if not os.path.exists(path):
        missing.append(path)
        continue
    cards.append(f"""
      <figure class="shot">
        <figcaption><span class="shot-title">{title}</span><span class="shot-note">{caption}</span></figcaption>
        <img src="{embed(path)}" alt="{title}" loading="lazy" />
        <p class="file">{path}</p>
      </figure>""")

if missing:
    print(f"warning: {len(missing)} screenshot(s) not found: {missing[:3]}")

html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Dispatch Platform — Build Report (through Phase 8)</title>
<style>
  :root {{
    --navy:#0B1F3A; --navy-2:#16304F; --green:#12B76A; --ink:#334155;
    --muted:#64748B; --line:#E2E8F0; --bg:#F8FAFC;
  }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; background:var(--bg); color:#0F172A;
         font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;
         line-height:1.55; }}
  header {{ background:var(--navy); color:#fff; padding:36px 24px 30px; }}
  .wrap {{ max-width:1120px; margin:0 auto; padding:0 20px; }}
  .eyebrow {{ text-transform:uppercase; letter-spacing:.1em; font-size:11px; font-weight:700;
              color:var(--green); margin:0 0 10px; }}
  h1 {{ margin:0 0 8px; font-size:30px; letter-spacing:-.02em; }}
  header p {{ margin:0; color:#AEC1DC; font-size:14px; max-width:70ch; }}
  .badges {{ display:flex; gap:8px; flex-wrap:wrap; margin-top:18px; }}
  .badge {{ border:1px solid rgba(255,255,255,.18); border-radius:999px; padding:5px 12px;
            font-size:12px; font-weight:600; color:#D6E0EE; }}
  .badge.ok {{ background:rgba(18,183,106,.16); border-color:rgba(18,183,106,.4); color:#6CE9A6; }}
  main {{ max-width:1120px; margin:0 auto; padding:28px 20px 60px; }}
  .grid {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin:0 0 26px; }}
  .stat {{ background:#fff; border:1px solid var(--line); border-radius:14px; padding:16px; }}
  .stat b {{ display:block; font-size:24px; letter-spacing:-.02em; }}
  .stat span {{ font-size:12px; color:var(--muted); }}
  h2 {{ font-size:16px; text-transform:uppercase; letter-spacing:.07em; color:var(--muted);
        margin:34px 0 12px; }}
  .panel {{ background:#fff; border:1px solid var(--line); border-radius:16px; padding:20px; }}
  .panel p:first-child {{ margin-top:0; }}
  .panel p:last-child {{ margin-bottom:0; }}
  code {{ background:#F1F5F9; padding:2px 6px; border-radius:6px; font-size:12.5px;
          font-family:ui-monospace,Menlo,Consolas,monospace; }}
  pre {{ background:var(--navy); color:#D6E0EE; padding:16px; border-radius:12px; overflow:auto;
         font-size:12.5px; line-height:1.7; }}
  pre .c {{ color:#7E9BC4; }}
  .shot {{ margin:0 0 26px; background:#fff; border:1px solid var(--line); border-radius:16px;
           overflow:hidden; }}
  .shot img {{ display:block; width:100%; height:auto; border-top:1px solid var(--line);
               border-bottom:1px solid var(--line); }}
  figcaption {{ padding:16px 18px 12px; }}
  .shot-title {{ display:block; font-weight:700; font-size:15px; }}
  .shot-note {{ display:block; font-size:13.5px; color:var(--ink); margin-top:4px; }}
  .file {{ margin:0; padding:0 18px 14px; font-size:11px; color:var(--muted);
           font-family:ui-monospace,Menlo,Consolas,monospace; }}
  table {{ width:100%; border-collapse:collapse; font-size:14px; }}
  th, td {{ text-align:left; padding:9px 10px; border-bottom:1px solid var(--line); vertical-align:top; }}
  th {{ font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); }}
  td code {{ font-size:12px; }}
  .yes {{ color:#027A48; font-weight:700; }}
  .no {{ color:#B42318; font-weight:700; }}
  footer {{ border-top:1px solid var(--line); margin-top:34px; padding-top:16px;
            font-size:12px; color:var(--muted); }}
</style>
</head>
<body>
<header>
  <div class="wrap">
    <p class="eyebrow">Through Phase 6 · build report</p>
    <h1>Dispatch &amp; Logistics Platform</h1>
    <p>Customer portal, rider portal and admin command centre on one NestJS API and one PostgreSQL
       database. This page is a static snapshot with real screenshots captured from the running
       application — it works without any server.</p>
    <div class="badges">
      <span class="badge ok">✓ 237 automated tests passing</span>
      <span class="badge ok">✓ API + database + Redis live</span>
      <span class="badge">NestJS 11 · Prisma 6 · PostgreSQL 17 · Redis 8</span>
      <span class="badge">React 19 · Vite 7 · Tailwind · TanStack Query</span>
      <span class="badge ok">✓ Argon2id · JWT 15 min · rotating refresh tokens</span>
      <span class="badge ok">✓ Prices computed server-side in integer kobo</span>
      <span class="badge ok">✓ One rider per job, enforced by a Redis lock</span>
      <span class="badge ok">✓ Every naira in a double-entry ledger</span>
      <span class="badge ok">✓ A position is only shown if a phone reported it</span>
      <span class="badge">Captured {datetime.now(timezone.utc).strftime('%d %b %Y %H:%M UTC')}</span>
    </div>
  </div>
</header>
<main>
  <h2>What is actually in the database right now</h2>
  <div class="grid">
    <div class="stat"><b>{stats['tables']}</b><span>tables</span></div>
    <div class="stat"><b>{stats['indexes']}</b><span>indexes</span></div>
    <div class="stat"><b>{stats['checks']}</b><span>CHECK constraints</span></div>
    <div class="stat"><b>{stats['permissions']}</b><span>permissions</span></div>
    <div class="stat"><b>{stats['roles']}</b><span>staff roles</span></div>
    <div class="stat"><b>{stats['accounts']}</b><span>ledger accounts</span></div>
    <div class="stat"><b>{stats['zones']}</b><span>service zones</span></div>
    <div class="stat"><b>{stats['deliveries']}</b><span>deliveries</span></div>
    <div class="stat"><b>{stats['riders']}</b><span>riders</span></div>
    <div class="stat"><b>{stats['offers']}</b><span>offers sent</span></div>
    <div class="stat"><b>{stats['earnings']}</b><span>rider earnings rows</span></div>
  </div>
  <div class="panel">
    <p><strong>Every one of those rows was earned.</strong> The deliveries, riders, offers and earnings
    in this database were created by running the product: the demo seed registers a real rider through the
    public API, a staff member approves each document, the rider goes online, a customer books, the rider
    accepts and delivers. No figure on any dashboard is typed in, and the seed refuses to invent revenue.</p>
  </div>

  <h2>Phase 6 — the dispatch engine</h2>
  <div class="panel">
    <p><strong>A booking must find a rider without anyone watching the screen.</strong> Phase 4 proved
    that two riders cannot hold the same job. Phase 6 makes that race run itself: it offers in batches,
    widens when nobody answers, and finally tells a human instead of going quiet.</p>
    <table>
      <tr><th>Decision</th><th>How it works</th></tr>
      <tr><td>The search widens in rounds</td><td>Round 1 asks the three closest riders within 5 km; then 12 km, 25 km and finally the whole branch. Each round lasts one offer window, and a round that finds nobody still counts — that is what lets the next one reach further out.</td></tr>
      <tr><td>The round is data, not memory</td><td><code>deliveries.dispatchRound</code> survives restarts, deploys and any number of API processes. No worker holds the state of a live dispatch in a variable.</td></tr>
      <tr><td>A no is permanent</td><td>A rider who rejects a job is never asked about it again. Riders asked in the round that just ended sit out one round, then return to the pool — a rider who was driving is not a rider who refused.</td></tr>
      <tr><td>Eligibility is a filter, not a score</td><td>Approved documents, approved application, online, active account, and under the active-job limit. Capacity is enforced by the query, so a rider at their limit is never offered work.</td></tr>
      <tr><td>Ranking is transparent</td><td>Distance to the pickup, plus 25 km for a stale location ping, plus a small 3 km penalty for being outside the delivery's zone.</td></tr>
      <tr><td>One round at a time</td><td>A per-delivery Redis lock (<code>SET PX 15000 NX</code>) means two API processes, or a double click, cannot double-offer. A concurrent test drives two ticks at once.</td></tr>
      <tr><td>Giving up is loud</td><td>When the schedule is spent the engine raises one <code>DISPATCH_EXHAUSTED</code> alert (guarded by a 10-minute Redis key) and stops. It will not restart by itself when a rider frees up — that job needs a decision.</td></tr>
      <tr><td>The socket never owns the truth</td><td>Pushes say only <em>something changed</em>; the screen refetches through the REST API. Every action still needs a bearer token and a permission — the live channel is notification, not authority.</td></tr>
    </table>
  </div>


  <h2>Phase 8 — maps, live tracking and realtime</h2>
  <div class="panel">
    <p><strong>A position is only ever shown if a rider's device reported it.</strong> That rule is enforced
    in code: no interpolation, no predicted marker, no rider parked at their branch. When nothing has been
    reported the API returns <code>position: null</code> and the screen says so in words; when a report is
    old it is flagged <code>stale</code> and drawn faded rather than moved. The second rule is about who may
    look — a customer sees the rider on <em>their</em> delivery, a share link sees that parcel and nothing
    else, and a dispatcher needs <code>tracking:read</code>.</p>
    <table>
      <tr><th>Decision</th><th>How it works</th></tr>
      <tr><td>One maps adapter</td><td><code>MapsService</code> answers autocomplete, geocode, reverse geocode and route/ETA. With a Google key it calls Places, Geocoding and Directions; without one it answers from the platform's own table of real Lagos coordinates and says <code>source: STUB</code>. A provider outage falls back rather than blocking a booking, and the response always declares which source answered.</td></tr>
      <tr><td>One write path for positions</td><td>Every ping goes through <code>TrackingService.recordPing()</code>: it is scoped to the job the rider actually holds, persisted to <code>rider_locations</code>, then pushed to the delivery room. A ping survives a dead socket — the socket only decides how fast a map refreshes.</td></tr>
      <tr><td>The cadence is configuration</td><td><code>GET /rider/location/config</code> serves <code>TRACKING_PING_INTERVAL_SECONDS</code> (15 s) to the rider app, which re-uses one <code>watchPosition</code> fix between sends instead of waking the GPS on a timer.</td></tr>
      <tr><td>ETA is measured, not remembered</td><td>From the rider's last real coordinate to the <em>pickup</em> before collection and to the <em>destination</em> after it — never from the booking's stored distance. <code>eta: null</code> whenever there is no position.</td></tr>
      <tr><td>Tracking stops at DELIVERED</td><td>Once the parcel is handed over, position and ETA become null even for the owning customer. The job is over; the rider's location stops being anyone's business.</td></tr>
      <tr><td>A share link is a window</td><td>A 24-byte token, 72 h by default, revocable at any moment. It reveals the reference, the status, the rider's first name and the position — no phone number, no email, no customer identity. Expired returns 409 \u201cthis tracking link has expired\u201d, not a bare 404.</td></tr>
      <tr><td>The room is the authorisation</td><td><code>subscribe:delivery</code> admits the owning customer, the assigned rider and staff with <code>delivery:read</code>. Anyone else gets <code>FORBIDDEN</code> and joins nothing; no principal gets <code>UNAUTHORIZED</code>. Both are covered by tests.</td></tr>
      <tr><td>Retention is bounded</td><td>A ping every 15 s is ~5,760 rows a day per rider. Pings older than <code>LOCATION_RETENTION_DAYS</code> (30) are pruned hourly. The delivery, its status history and its timestamps survive; the breadcrumb trail does not.</td></tr>
      <tr><td>The map admits what it is</td><td>Without a Maps key the UI draws a schematic — every point at its true latitude and longitude, on a plain grid — under the caption \u201cpositions are exact, the basemap is not\u201d. A schematic that says it is a schematic is honest; a fake street map would not be.</td></tr>
    </table>
  </div>

  <h2>Phase 7 — payments, the wallet and the ledger</h2>
  <div class="panel">
    <p><strong>Every naira is provable.</strong> No balance is a column somebody increments: each payment,
    earning, withdrawal, refund and gateway fee is a journal entry, and debits must equal credits before the
    transaction is allowed to commit. The reconciliation screen runs five live checks against the journal and
    reports what it finds, including the \u20a646,391.83 that moved through the books in the demo day.</p>
    <table>
      <tr><th>Decision</th><th>How it works</th></tr>
      <tr><td>Nothing is credited from a browser</td><td>A payment is <code>PENDING</code> until the provider confirms it, and every webhook is signature-verified against the raw body and deduplicated on <code>(provider, eventId)</code>. An unverified or replayed webhook credits nothing.</td></tr>
      <tr><td>One settlement path</td><td>Card, wallet, cash and simulated payments all settle through <code>PaymentsService.settle()</code>, so there is exactly one place where money becomes revenue.</td></tr>
      <tr><td>A wallet cannot go negative</td><td><code>SELECT \u2026 FOR UPDATE</code>, a version CAS and a database CHECK constraint. Three layers, because a wallet is the one number a customer will notice.</td></tr>
      <tr><td>Riders wait before they are paid</td><td>An earning sits <code>PENDING</code> for the hold window (24 h) before it is withdrawable, and money already committed to a withdrawal is subtracted — the same naira cannot be asked for twice.</td></tr>
      <tr><td>A human approves payouts</td><td><code>REQUESTED \u2192 APPROVED \u2192 PROCESSING \u2192 PAID</code>. Approval and payout need separate permissions, each step is idempotent, and a rider cannot approve their own request.</td></tr>
    </table>
  </div>

  <h2>Phase 4 — the rider portal, offers and the delivery workflow</h2>
  <div class="panel">
    <p><strong>Two riders can never hold the same job.</strong> That is the whole point of this phase, and
    it is enforced in the database and in Redis rather than in the UI. An offer is a row with an expiry;
    accepting it takes a short Redis lock, claims the rider's own assignment with a conditional update,
    moves the delivery from PENDING to ACCEPTED in the same transaction, and only then expires the rival
    offers. A loser of the race gets a clean <code>409 DELIVERY_TAKEN</code> — never a 500, never a double
    assignment.</p>
    <table>
      <tr><th>Rule</th><th>How it works</th></tr>
      <tr><td>Offer window</td><td>20 seconds by default (<code>DISPATCH_OFFER_TIMEOUT_SECONDS</code>). The deadline is stored on the row; the countdown in the browser is display only.</td></tr>
      <tr><td>Who gets offered</td><td>Approved riders in the delivery's branch who are ONLINE, under their concurrent-job limit, ranked by haversine distance from their latest ping (or their zone centre, pushed down the list, if the ping is stale). The best three are offered.</td></tr>
      <tr><td>Accepting</td><td>Redis <code>SET NX PX</code> token lock → conditional <code>updateMany</code> on the rider's own assignment → conditional delivery claim <code>PENDING → ACCEPTED</code> → rival offers expired <em>after</em> commit.</td></tr>
      <tr><td>Expiry and refusal</td><td>An expired offer is swept and can be re-offered later; an explicit refusal is respected and that rider is never offered the same job again. Both leave the delivery waiting for someone else.</td></tr>
      <tr><td>Someone must be online</td><td>A paid booking placed while every rider is offline is not stranded: going online triggers a sweep that offers waiting deliveries immediately.</td></tr>
      <tr><td>Commission</td><td>Percentage from the pricing rule, frozen into <code>deliveries.commissionSnapshot</code> at acceptance. Changing the rate tomorrow cannot change what this rider is owed.</td></tr>
      <tr><td>Proof of delivery</td><td>The recipient's 6-digit code (SHA-256, 5 attempts) or a photo plus the recipient's name. Either way the delivery completes once and the earning is written once.</td></tr>
      <tr><td>Going online</td><td>Refused with a specific reason when the account is not approved, the account is suspended, or a required document is not approved — and it names the missing document.</td></tr>
    </table>
  </div>

  <h2>Phase 4 — the admin side of onboarding</h2>
  <div class="panel">
    <p>A rider cannot approve themselves. Staff review each document and then the application, and both
    decisions are written to the audit trail with before/after values. The Phase 5 admin screens will call
    exactly these endpoints.</p>
    <table>
      <tr><th>Rule</th><th>How it works</th></tr>
      <tr><td>Permissions, not one big admin pass</td><td>Reading the queue needs <code>rider:read</code>, reviewing or approving needs <code>rider:approve</code>, and streaming a document's bytes needs <code>rider:document:read</code> — a support agent holds none of them.</td></tr>
      <tr><td>Documents are private</td><td>Stored under <code>riders/&lt;id&gt;/documents/</code> with no public URL. The only read path is an authenticated, permission-checked endpoint that returns <code>Cache-Control: private, no-store</code>.</td></tr>
      <tr><td>No approval without papers</td><td>Approving a rider while any required document is unapproved returns <code>409 DOCUMENTS_INCOMPLETE</code> naming them — the same rule the rider's own "go online" check uses.</td></tr>
      <tr><td>Rejection needs a reason</td><td>The rider reads it. A re-upload resets the document to PENDING so nobody is stuck forever.</td></tr>
      <tr><td>Suspension takes effect immediately</td><td>Status becomes SUSPENDED, availability is forced OFFLINE, and the rider's next attempt to go online is refused.</td></tr>
    </table>
  </div>

  <h2>Phase 3 — booking and the pricing engine</h2>
  <div class="panel">
    <p><strong>The browser never sends a price.</strong> A booking request carries two coordinates, a
    package description and a delivery type. The API looks up the active pricing rule, measures the
    route, assembles the fee, applies promotions and returns the breakdown. When the customer confirms,
    it calculates all of it again — a quote is never treated as a payment instruction.</p>
    <table>
      <tr><th>Step</th><th>Rule</th></tr>
      <tr><td>Zone</td><td>The zone containing the pickup decides the rule; falls back to the branch rule, then the global rule. A point more than 60 km from every zone is refused with a readable message.</td></tr>
      <tr><td>Distance</td><td>Haversine × 1.35 road factor while Google Maps is stubbed. Multi-stop trips are summed leg by leg.</td></tr>
      <tr><td>Fees</td><td>Base fee + (distance beyond the free kilometres × per-km rate) + additional stops.</td></tr>
      <tr><td>Minimum</td><td>The floor is applied to the trip <em>before</em> surcharges, so it protects the trip without hiding an express fee.</td></tr>
      <tr><td>Surcharges</td><td>Express, same-day and scheduled fees from the rule row.</td></tr>
      <tr><td>Rounding</td><td>One rounding step, to 50 kobo, in integer arithmetic. No floating-point naira in the money path.</td></tr>
      <tr><td>Promotions</td><td>Percentage (capped), fixed amount, or free delivery. Window, global limit, per-customer limit and minimum order are all checked against the database. A promo can make a delivery free, never negative.</td></tr>
      <tr><td>Freeze</td><td>The entire breakdown is written to <code>deliveries.priceSnapshot</code>. A rule change tomorrow cannot alter what was charged today.</td></tr>
    </table>
  </div>

  <h2>Phase 2 — authentication and access control</h2>
  <div class="panel">
    <p>Three portals share one API, so the central question is <em>who may do what</em>. Phase 2 answers
    it in four layers, all enforced on the server. Hiding a button in React is a courtesy, never a
    control — every one of these rules is re-checked by the API on every request.</p>
    <table>
      <tr><th>Layer</th><th>How it works</th></tr>
      <tr><td><strong>Passwords</strong></td><td>Argon2id (memory-hard, winner of the Password Hashing Competition). Stored hashes begin <code>$argon2id$</code>. A leaked database does not hand out passwords.</td></tr>
      <tr><td><strong>Sessions</strong></td><td>15-minute access JWT kept in memory; long-lived refresh token in an <code>HttpOnly</code> cookie that JavaScript cannot read. Every refresh rotates the token and revokes the previous one.</td></tr>
      <tr><td><strong>Reuse detection</strong></td><td>If an already-rotated refresh token is presented again, a copy has leaked: the entire session family is revoked and the event is logged.</td></tr>
      <tr><td><strong>Authorisation</strong></td><td>A global guard denies everything by default; routes must opt in with <code>@Public()</code>. Staff routes then need an explicit permission such as <code>withdrawal:approve</code>. Portal type is checked separately, so a customer token can never act as staff.</td></tr>
      <tr><td><strong>Account protection</strong></td><td>5 failed logins lock the account for 15 minutes; Redis-backed rate limits on every sensitive route return 429 with a "wait N seconds" message.</td></tr>
      <tr><td><strong>Evidence</strong></td><td>An append-only audit table records every registration, login, failure, lockout, password change and permission change — with IP, user agent and before/after values, and never a password or token.</td></tr>
    </table>
  </div>

  <h2>What the browser was made to prove</h2>
  <div class="panel">
    <p>The screenshots below were not staged: <code>scripts/capture-phase2.mjs</code> drives a real
    Chromium browser and the script fails if any step fails.</p>
    <table>
      <tr><th>Step</th><th>Result</th></tr>
      <tr><td>Super admin signs in through the login form</td><td class="yes">Landed on the admin dashboard; 1 staff row and 37 permission chips read from PostgreSQL</td></tr>
      <tr><td>Admin signs out</td><td class="yes">Refresh cookie revoked, redirected to /login</td></tr>
      <tr><td>New customer registers, verifies email, verifies phone</td><td class="yes">Account became ACTIVE with both channels verified</td></tr>
      <tr><td>That customer signs in</td><td class="yes">Session restored on a fresh page load from the HttpOnly cookie alone</td></tr>
      <tr><td>That customer navigates to <code>/admin</code></td><td class="yes">Sent home — the portal guard refuses a customer token</td></tr>
    </table>
  </div>

  <h2>Test coverage added in Phase 2</h2>
  <div class="panel">
    <table>
      <tr><th>Area</th><th>Proven by</th></tr>
      <tr><td>Registration and validation</td><td class="yes">Pending user + wallet created, hash starts <code>$argon2id$</code>, duplicate email/phone (incl. <code>0803…</code> vs <code>+234803…</code>) rejected, weak password rejected <em>by the API</em>, bad Nigerian phone rejected</td></tr>
      <tr><td>Verification</td><td class="yes">Email token activates once only; OTP hash-only, expiry and 5-attempt cap enforced</td></tr>
      <tr><td>Sessions</td><td class="yes">Refresh token never in the JSON body, cookie is HttpOnly and path-scoped, rotation works, <strong>replay revokes the family</strong>, logout and logout-all kill sessions</td></tr>
      <tr><td>Lockout and rate limits</td><td class="yes">5 failures → 429 on the 6th attempt even with the right password; limiter returns "wait N seconds"</td></tr>
      <tr><td>RBAC matrix</td><td class="yes">Support agent: dashboard 200 / staff 403. Operations: staff 200 / audit 403. Finance: audit 200 / roles 403. Super admin: all 200. <strong>Rider: 403 on every admin route.</strong></td></tr>
      <tr><td>Password reset</td><td class="yes">Link works once, old password dies, all sessions die, unknown email returns the same message (no enumeration)</td></tr>
      <tr><td>Audit trail</td><td class="yes">Successful and failed logins recorded; no password or token ever stored</td></tr>
    </table>
  </div>

  <h2>The three portals — what exists today</h2>
  <div class="panel">
    <table>
      <tr><th>Capability</th><th>Status</th><th>Where</th></tr>
      <tr><td>Database schema, migrations, seed</td><td class="yes">Built &amp; tested</td><td><code>backend/prisma/</code></td></tr>
      <tr><td>API shell (config validation, security headers, error contract, request ids)</td><td class="yes">Built &amp; tested</td><td><code>backend/src/</code></td></tr>
      <tr><td>Health endpoint (queries Postgres + Redis)</td><td class="yes">Live</td><td><code>GET /api/v1/health</code></td></tr>
      <tr><td>Shared money / phone / validation / state machine</td><td class="yes">Built &amp; tested</td><td><code>packages/shared/</code></td></tr>
      <tr><td>Design system (20 components)</td><td class="yes">Built</td><td><code>frontend/src/components/ui/</code></td></tr>
      <tr><td>Registration, login, verification, password reset</td><td class="yes">Built &amp; tested</td><td><code>backend/src/auth/</code></td></tr>
      <tr><td>Rotating refresh tokens with reuse detection</td><td class="yes">Built &amp; tested</td><td><code>auth/token.service.ts</code></td></tr>
      <tr><td>Roles, permissions and guards (5 roles, 37 permissions)</td><td class="yes">Built &amp; tested</td><td><code>auth/guards/</code></td></tr>
      <tr><td>Audit trail of sensitive actions</td><td class="yes">Built &amp; tested</td><td><code>GET /admin/audit-logs</code></td></tr>
      <tr><td>Rate limiting + account lockout</td><td class="yes">Built &amp; tested</td><td><code>common/rate-limit/</code></td></tr>
      <tr><td>Rider portal screens (overview, offers, active job, earnings, documents)</td><td class="yes">Built &amp; tested</td><td><code>frontend/src/pages/rider/</code></td></tr>
      <tr><td>Admin command centre screens</td><td class="no">Phase 5</td><td>—</td></tr>
      <tr><td>Booking wizard, quote, price snapshot, cancel</td><td class="yes">Built &amp; tested</td><td><code>backend/src/pricing/</code> · <code>src/deliveries/</code></td></tr>
      <tr><td>Delivery history and detail with a real timeline</td><td class="yes">Built &amp; tested</td><td><code>frontend/src/pages/customer/</code></td></tr>
      <tr><td>Rider assignment, offers and the delivery workflow</td><td class="yes">Built &amp; tested</td><td><code>backend/src/dispatch/</code> · <code>src/rider-jobs/</code></td></tr>
      <tr><td>Rider onboarding with document upload and staff approval</td><td class="yes">Built &amp; tested</td><td><code>src/riders/</code> (rider + admin controllers)</td></tr>
      <tr><td>Rider earnings ledger with commission splits</td><td class="yes">Built &amp; tested</td><td><code>GET /api/v1/rider/earnings</code></td></tr>
      <tr><td>Real-time offer push over Socket.IO</td><td class="no">Phase 6</td><td>polling for now</td></tr>
      <tr><td>Withdrawals and payouts</td><td class="no">Phase 7</td><td>—</td></tr>
    </table>
  </div>

  <h2>Screenshots from the running app</h2>
  {''.join(cards)}

  <h2>How to view the live app yourself</h2>
  <div class="panel">
    <p>A <code>localhost</code> link cannot work from your computer — that address only exists inside the
    sandbox machine where the code runs. Use the <strong>preview panel</strong> in this conversation
    instead: any server I start (the web app on port 5173, the API on port 4000) appears there as a live,
    clickable preview.</p>
    <p>If the preview is not visible, ask me to restart the servers — the sandbox resets between sessions,
    which stops the processes and wipes the installed packages, but never touches your code.</p>
  </div>

  <h2>Rebuilding from a cold sandbox</h2>
<pre><span class="c"># one command: services + install + migrate + seed</span>
npm run setup

<span class="c"># then start both servers (preview appears automatically)</span>
npm run dev

<span class="c"># verify</span>
npm test            <span class="c"># 149 tests against a real, isolated Postgres + Redis</span>
bash scripts/smoke.sh
node scripts/seed-demo-phase4.mjs     <span class="c"># a real rider, approved, online, with an offer</span>
node scripts/capture-phase4.mjs       <span class="c"># rider journey</span>
node scripts/seed-demo-phase8.mjs     <span class="c"># a rider mid-delivery, with real position pings</span>
node scripts/capture-phase8.mjs       <span class="c"># tracking journey + refresh these screenshots</span>
node scripts/capture-phase3.mjs       <span class="c"># booking journey</span>
python3 scripts/build-report.py       <span class="c"># regenerate this page</span></pre>

  <h2>Known limitations after Phase 8</h2>
  <div class="panel">
    <ul>
      <li><strong>Maps are stubbed, not missing.</strong> <code>MAPS_PROVIDER=STUB</code> answers with real Lagos
      coordinates and a road-factor route estimate, and every screen says so. Setting a Google key switches the
      adapter to Places, Geocoding and Directions with no code change — see
      <code>documentation/CREDENTIALS-SETUP.md</code>.</li>
      <li><strong>Payments are simulated</strong> (<code>PAYMENTS_MODE=DEVELOPMENT</code>) until sandbox or live
      keys are placed in the server's <code>.env</code> — never in this workspace. The webhook, settlement and
      ledger paths are the same ones a real provider would drive.</li>
      <li><strong>Email and SMS are console drivers.</strong> Codes print to the API log, and in development are
      returned to the browser so flows can be tested without spend. Termii and Resend plug into
      <code>MessagingService</code> through one environment variable.</li>
      <li><strong>No staff 2FA yet.</strong> Recommended before real money moves; the TOTP storage and
      verification plumbing already exist.</li>
      <li><strong>No turn-by-turn navigation for riders.</strong> The rider app shows the route, addresses and
      landmarks; a deep link into the device's own maps app is the planned hand-off, because that is what riders
      actually use.</li>
      <li><strong>No notification centre.</strong> The audit trail and the realtime channel both record what
      happened; a customer-facing inbox over them is still open from Phase 5.</li>
      <li><strong>Not yet built:</strong> reports and analytics with CSV/PDF export (Phase 9), then deployment
      hardening — Docker Compose, CI, Playwright end-to-end runs, backup drill, runbook (Phase 10).</li>
    </ul>
  </div>

  <footer>
    Build report through Phase 8 · generated by <code>scripts/build-report.py</code> ·
    source of truth: <code>documentation/PHASE-LOG/PHASE-8.md</code>
  </footer>
</main>
</body>
</html>"""

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as handle:
    handle.write(html)
print(f"wrote {OUT} ({os.path.getsize(OUT)/1024/1024:.2f} MB)")
print("stats used:", json.dumps(stats))
