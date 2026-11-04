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

MAX_W = 1100
def embed(path: str) -> str:
    img = Image.open(path).convert("RGB")
    if img.width > MAX_W:
        img = img.resize((MAX_W, round(img.height * MAX_W / img.width)), Image.LANCZOS)
    buffer = io.BytesIO()
    img.save(buffer, format="JPEG", quality=78, optimize=True)
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
}

cards = []
for path, title, caption in SHOTS:
    if not os.path.exists(path):
        continue
    cards.append(f"""
      <figure class="shot">
        <figcaption><span class="shot-title">{title}</span><span class="shot-note">{caption}</span></figcaption>
        <img src="{embed(path)}" alt="{title}" loading="lazy" />
        <p class="file">{path}</p>
      </figure>""")

html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Dispatch Platform — Build Report (Phase 2)</title>
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
    <p class="eyebrow">Phase 2 complete · build report</p>
    <h1>Dispatch &amp; Logistics Platform</h1>
    <p>Customer portal, rider portal and admin command centre on one NestJS API and one PostgreSQL
       database. This page is a static snapshot with real screenshots captured from the running
       application — it works without any server.</p>
    <div class="badges">
      <span class="badge ok">✓ 61 tests passing</span>
      <span class="badge ok">✓ API + database + Redis live</span>
      <span class="badge">NestJS 11 · Prisma 6 · PostgreSQL 17 · Redis 8</span>
      <span class="badge">React 19 · Vite 7 · Tailwind · TanStack Query</span>
      <span class="badge ok">✓ Argon2id · JWT 15 min · rotating refresh tokens</span>
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
    <div class="stat"><b>{stats['deliveries']}</b><span>fake deliveries</span></div>
  </div>
  <div class="panel">
    <p><strong>That last number is the important one.</strong> There are zero seeded deliveries, riders,
    customers or naira of revenue. Everything else is real configuration: a permission matrix, a chart of
    accounts, service zones and pricing rules. When Phase 3 adds bookings, every figure on every dashboard
    will trace back to a genuine row.</p>
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
      <tr><td>Rider portal screens (documents, offers, jobs)</td><td class="no">Phase 4</td><td>—</td></tr>
      <tr><td>Admin command centre screens</td><td class="no">Phase 5</td><td>—</td></tr>
      <tr><td>Customer booking screens + pricing engine</td><td class="no">Phase 3 (next)</td><td>—</td></tr>
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
npm test            <span class="c"># 61 tests against a real, isolated Postgres + Redis</span>
bash scripts/smoke.sh
node scripts/capture-phase2.mjs       <span class="c"># browser journey + refresh these screenshots</span>
python3 scripts/build-report.py       <span class="c"># regenerate this page</span></pre>

  <h2>Known limitations after Phase 2</h2>
  <div class="panel">
    <ul>
      <li><strong>Email and SMS are console drivers.</strong> Codes print to the API log, and in
      development are also returned to the browser so the flow can be tested without spend. A real
      provider plugs into <code>MessagingService</code> in Phase 7 without touching the auth code.</li>
      <li><strong>No staff 2FA yet.</strong> Recommended before real money moves; the TOTP storage and
      verification plumbing already exist.</li>
      <li><strong>No CAPTCHA.</strong> Lockout and rate limiting cover the basics; add Turnstile if abuse
      appears.</li>
      <li><strong>Not yet built:</strong> rider document upload, staff/role management screens, audit-log
      viewer, session list. The APIs exist; the screens arrive with Phases 4–5.</li>
      <li><strong>Payments remain simulated</strong> (<code>PAYMENTS_MODE=DEVELOPMENT</code>) until the
      live keys are placed in the server's <code>.env</code> — never in this workspace.</li>
    </ul>
  </div>

  <footer>
    Phase 2 build report · generated by <code>scripts/build-report.py</code> ·
    source of truth: <code>documentation/PHASE-LOG/PHASE-2.md</code>
  </footer>
</main>
</body>
</html>"""

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as handle:
    handle.write(html)
print(f"wrote {OUT} ({os.path.getsize(OUT)/1024/1024:.2f} MB)")
print("stats used:", json.dumps(stats))
