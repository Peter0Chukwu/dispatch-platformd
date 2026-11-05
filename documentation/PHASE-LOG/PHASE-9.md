# Phase 9 — Reports and analytics

> **Status:** complete · **Tests:** 253 passing (15 files, 16 new) · **Commit:** see `git log --oneline` for
> "Phase 9: reports, exports and analytics".

## What this phase is about

A report is not a picture of the data. It is a **claim about the data** — and the only claim worth making is
one that somebody else can check. So the phase was built around a single rule, enforced in code:

> **A report's totals must equal a number the rest of the platform already knows.**

If the financial summary says net ₦15,749.43 for September, then `GET /admin/finance/summary` for the same
dates says ₦15,749.43, and the ledger says the same thing after the same arithmetic. The test suite asserts
exactly that (`backend/test/reports.e2e.spec.ts`), and so does the demo seed before it prints its verdict.

The second rule is about pace:

> **Generating a file must never hold a request open.**

A report is a read-heavy query across `deliveries`, `payments`, `rider_earnings` and `ledger_lines`. Making a
manager's browser wait for it is fine once and catastrophic on the day the finance team all clicks at 09:00.
So a report is a **job**: the API accepts it, returns in milliseconds, and a worker renders it.

---

## 1. The nine reports

| Type | Answers | Rows | Totals |
|---|---|---|---|
| `DAILY_DELIVERIES` | Bookings, completions, cancellations and failed jobs per day | one per day | bookings, delivered, delivered revenue |
| `MONTHLY_DELIVERIES` | The same measures rolled up per month — the board view | one per month | same |
| `REVENUE` | Settled payments by provider and day, with gateway fees and net | one per day | collected, fees, net after fees |
| `RIDER_EARNINGS` | Gross, commission and net per rider, split by hold status | one per rider | gross, commission, net owed |
| `CUSTOMERS` | Who is booking, what they have spent, when they were last active | one per customer | customers, bookings, spend |
| `CANCELLATIONS` | Every cancelled job with its reason, who cancelled it and when | one per job | cancellations, value lost |
| `RIDER_PERFORMANCE` | Completion rate, average delivery time, acceptance rate, ratings | one per rider | — |
| `ZONE_PERFORMANCE` | Deliveries and revenue per service zone, with average trip distance | one per zone | bookings, delivered, revenue |
| `FINANCIAL_SUMMARY` | Revenue, refunds, rider cost, gateway fees, liabilities, **gross vs net** | one per line | 7 lines incl. Net |

Each is available as **CSV** and **PDF**. Both come from one `ReportTable` object, so the CSV and the PDF of
the same report cannot disagree about a number — they are two renderings of one computation, not two queries.

## 2. A job, not a request

```
POST /admin/reports { type, format, from, to }   → 201 { id, status: 'QUEUED' }   (~40 ms)
      ↓  the row *is* the queue
ReportsScheduler.tick() every 2 s
      ↓  conditional claim: updateMany({ where: { id, status: 'QUEUED' } })
  PROCESSING → render → store file → READY            (or FAILED, with the error kept)
      ↓
POST /admin/reports/:id/download-link            → { url, expiresAt }            (signed, 15 min)
GET  /reports/download/:token                    → the file, no session required
```

Three properties fall out of this design:

* **Nothing is lost on a restart.** The queue is the `report_requests` table, not a variable. A deploy in the
  middle of a report leaves the row `QUEUED`; a crash leaves it `PROCESSING`, and `requeueStale()` puts
  anything older than 15 minutes back in the queue on the next tick.
* **A job is rendered exactly once.** The worker claims it with a conditional `updateMany` — the second
  caller sees zero rows affected and gives up. A test drives `process()` twice and asserts the second call
  fails while the file is still the first one.
* **One report per tick.** Deliberate: five concurrent report queries is how a reporting feature takes a
  production database down. Throughput is a queue-length problem, not an emergency.

The dashboard never blocks while this happens; the list endpoint tells the client which jobs are outstanding
and the UI polls only while something is `QUEUED` or `PROCESSING`.

## 3. Downloads: a signed link, not a session

A browser cannot put a bearer token on an `<a href>`, and a report file should not require the customer's
session cookie to be shared. So the file is served behind a **token that is itself the credential**:

```
token    = base64url("<reportId>.<expiryEpoch>") + "." + base64url(hmac_sha256(payload, secret))
secret   = "report-download:" + TRACKING_LINK_SECRET      (purpose-prefixed key)
TTL      = 900 s, minted per download, never reused
```

* Tampering with the id or the expiry breaks the signature → **403**.
* A valid signature after the expiry → **403**.
* The comparison is `timingSafeEqual`, so a signature cannot be guessed byte by byte.
* `Cache-Control: no-store, private` — a short-lived link must not be cached by a proxy.

Tests cover all three refusals and the happy path (`200`, correct `Content-Type`, correct filename).

## 4. Money in a file people actually open

The CSV is opened in Excel, and the first thing anybody does with it is `SUM()`. Two decisions follow:

* **Money is a plain naira decimal** — `4894.50`, never `₦4,894.50`. A currency symbol turns a number into
  text and breaks every formula. The PDF keeps the ₦ formatting, because PDFs are for reading.
* **Every file carries its own provenance** in `#` comment lines: title, the sentence describing the period,
  the exact dates, the generation timestamp and the report id, plus a `# Totals` block at the end. A file
  emailed around in March can still be identified in June.
* **A UTF-8 BOM is written first**, so Excel opens the file as UTF-8 instead of mojibake. A test asserts the
  first three bytes are `EF BB BF`.

The PDF (pdfkit, A4 landscape) repeats the header row on every page, prints the totals *above* the table —
where a manager looks first — and footers each page with `Page x of y`.

## 5. Gross and net are separate lines

The financial summary deliberately refuses to blend them:

```
Collected          ₦60,943.50   cash that actually arrived
Gross revenue      ₦60,943.50   ledger 4000 + 4100 inside the period
Refunds                 ₦0.00   ledger 5300
Net revenue        ₦60,943.50   gross − refunds
Rider cost         ₦42,180.00   ledger 5000
Gateway fees        ₦3,014.07   ledger 5100
Net                ₦15,749.43   net revenue − rider cost − gateway fees
```

"We invoiced ₦60k" and "we kept ₦15.7k" answer different questions, and a single blended number answers
neither. The net line is computed by the same arithmetic as `AdminFinanceService.summary()`, which is what
makes the reconciliation test possible at all.

**Ledger figures are now period-scoped** as part of this phase: `LedgerService.accountBalance()` takes an
optional window and filters on `journalEntry.postedAt`. Before, a summary dated September would quietly have
included every posting since the company started — a bug that only shows up once there is history, which is
exactly what this phase created.

## 6. Verified numbers (this run)

Seeded history: 26 bookings across five weeks — 18 delivered, 3 cancelled, 3 failed, 2 still open — created by driving the
real API and the real rider state machine, then spread backwards in time (dates only; amounts, statuses and
ledger postings untouched).

| Check | Result |
|---|---|
| Report net = finance screen net | ✓ ₦15,749.43 = ₦15,749.43 |
| Report collected = finance screen collected | ✓ ₦60,943.50 = ₦60,943.50 |
| Gross revenue − refunds = net revenue | ✓ ₦60,943.50 − ₦0.00 = ₦60,943.50 |
| `DAILY_DELIVERIES` delivered revenue = `SUM(chargeKobo WHERE DELIVERED)` | ✓ ₦52,726.50 |
| `REVENUE` collected = `SUM(amountKobo WHERE SUCCESS)` | ✓ |
| `RIDER_EARNINGS` gross − commission = net, per row and in total | ✓ |
| A preview writes no file | ✓ (job count unchanged) |

## 7. Endpoints

```
GET  /api/v1/admin/reports/catalogue             report:generate
POST /api/v1/admin/reports                       report:generate   → QUEUED job
GET  /api/v1/admin/reports?limit=25              report:generate   → newest first
GET  /api/v1/admin/reports/preview?type=&from=&to=  report:generate   → inline, writes nothing
GET  /api/v1/admin/reports/:id                   report:generate
POST /api/v1/admin/reports/:id/download-link     report:generate   → signed URL, 15 min
GET  /api/v1/reports/download/:token             public — the token is the credential
```

`report:generate` is held by super admin and finance manager. A support agent gets `403` (tested), and a
customer token gets `403` (tested). Requests are rate limited per route and per IP.

## 8. What the UI does

`/admin/reports` is one screen with two halves:

* **Preview** runs the chosen report immediately and shows its totals and up to 25 rows, with an explicit
  notice when the file will contain more. It writes nothing. Because preview and file share the dataset
  builder, what an operator checks is what the operator gets.
* **Generate** queues the file. The row shows `queued → working → ready`, a failure keeps its error text and
  offers **Retry**, and a ready row offers **Download**, which mints a fresh link and saves the file.

## 9. Known limitations, recorded deliberately

* **Email scheduling is stubbed, not built.** The report catalogue and job model are shaped for a scheduler
  (`params` holds the period, so a recurring job is the same row with a cron), but no recurring job or email
  delivery exists yet. It is the one Phase 9 item deliberately left unbuilt rather than faked; it lands with
  the notification centre (still an open Phase 5 deferral).
* **Files accumulate.** `storage/reports/` is never pruned. A retention sweep (delete `READY` rows older than
  N days) belongs with the Phase 10 hardening work, alongside the backup drill.
* **`MAX_REPORT_ROWS` (5,000) truncates, it does not paginate.** A truncated file says so in its header and
  in the `truncated` flag; the honest fix for a 500k-row request is a warehouse, not a bigger limit.
* **The PDF is landscape A4 and unstyled beyond the header.** It is readable and branded, not designed.
* **Rider performance uses `deliveries.deliveredAt − acceptedAt`** for delivery time. That is the time from
  acceptance to hand-over, which includes travel to the pickup — it is labelled as such in the column header
  rather than being quietly described as "trip time".

## 10. Files

| Path | What it is |
|---|---|
| `backend/src/reports/report-types.ts` | contract (`ReportTable`, columns, totals), catalogue, row caps |
| `backend/src/reports/report-datasets.service.ts` | the nine builders — the only place that reads for a report |
| `backend/src/reports/report-render.ts` | `renderCsv()` and `renderPdf()` from one table |
| `backend/src/reports/reports.service.ts` | queue, preview, claim, render, signed links, stale recovery |
| `backend/src/reports/reports.controller.ts` | staff endpoints + the public download |
| `backend/src/reports/reports.scheduler.ts` | the 2-second worker tick |
| `backend/src/reports/reports.module.ts` | wiring |
| `backend/src/ledger/ledger.service.ts` | `accountBalance(code, window)` — period-scoped balances |
| `backend/src/storage/storage.service.ts` | `saveBuffer()` / `readBuffer()` for generated files |
| `frontend/src/pages/admin/ReportsPage.tsx` | the screen |
| `frontend/src/hooks/useReports.ts` | catalogue, jobs (poll-while-working), preview, request, download |
| `backend/test/reports.e2e.spec.ts` | 16 tests |
| `scripts/seed-demo-phase9.mjs` | builds five weeks of history, then generates and checks reports |
| `scripts/capture-phase9.mjs` | browser run + 7 screenshots |
| `documentation/samples/*.csv, *.pdf` | real generated files, kept as artefacts |

## 11. Reproduce it

```bash
bash scripts/dev-env-up.sh                     # PostgreSQL + Redis
cd backend && npx prisma migrate deploy && npm run db:seed && cd ..
node scripts/seed-demo-phase4.mjs              # demo users, rider, one booking
node scripts/seed-demo-phase9.mjs              # five weeks of history + real reports
node scripts/capture-phase9.mjs                # screenshots into documentation/screenshots/phase-9/
cd backend && npx vitest run test/reports.e2e.spec.ts
```

The generated files land in `documentation/samples/`. Open `financial-summary.pdf` to see the branded
landscape report, and `daily-deliveries.csv` to see the spreadsheet-safe export.
