# Phase 4 — Rider portal, offer engine and the delivery workflow

**Date completed:** 4 November 2026
**Status:** ✅ Complete — 149 automated tests passing (47 new), full rider journey verified in a real browser.

---

## 1. The one rule that shaped this phase

> **Two riders can never hold the same job.**

Everything else in Phase 4 exists to support that sentence. An offer is not a screen — it is a row with a
deadline, and accepting it is a race that the database decides.

The race, in order:

```
rider taps Accept
  → Redis SET NX PX 5000 lock on the assignment      "one accept at a time, across every API process"
  → BEGIN
      updateMany(assignment) WHERE riderId = me AND status = 'OFFERED' AND expiresAt > now()
        → 0 rows? someone else already resolved it → rollback, 409 OFFER_EXPIRED
      updateMany(delivery)   WHERE id = … AND status = 'PENDING' AND riderId IS NULL
        → 0 rows? another rider claimed the job → rollback, 409 DELIVERY_TAKEN
      write delivery_status_history + freeze commissionSnapshot
    COMMIT
  → updateMany(assignment) WHERE deliveryId = … AND status = 'OFFERED'   → rivals expire
  → rider becomes ON_DELIVERY, Redis lock released
```

The rival expiry is **after** the commit, and that is not a style choice. The first version expired the
rival rows *inside* the transaction, and two simultaneous accepts then each held the row the other needed.
Postgres detected the deadlock (ABBA) and killed one transaction — the loser saw a **500**. Moving the
expiry outside the transaction removed the lock inversion entirely; the loser now gets a clean `409`.

Proof, from the suite (run three times in a row, identical result):

```
✓ lets exactly one of two racing riders win the same delivery
    statuses observed: [201, 409]
    assignments: 1 ACCEPTED, 1 EXPIRED
    delivery.riderId === winner.riderId
```

---

## 2. How a job reaches a rider

| Step | Rule | Why |
|---|---|---|
| Who may be offered | APPROVED, ACTIVE, `availability = ONLINE`, same branch, under their concurrent-job limit | Offering work to a suspended or busy rider wastes the 20-second window |
| Ranked by | Haversine from the latest location ping; if the ping is older than 10 minutes, from their zone centre **and pushed down the list** | A stale ping is not evidence of proximity, so it must not outrank a fresh one |
| Batch size | Best 3 | Wide enough to fill a job quickly, narrow enough to stay honest |
| Window | 20 s (`DISPATCH_OFFER_TIMEOUT_SECONDS`) | Stored on the assignment row; the browser countdown is display only |
| Expiry | A sweep expires late offers before every list/accept | An expired offer can be offered again later — the rider may have been driving |
| Refusal | `REJECTED` is permanent for that delivery and that rider | Respecting "no" is the entire point of the button |
| Nobody online | Going online triggers `offerWaitingDeliveries()` | A paid booking must not rot because every rider happened to be offline |

That last row was a real bug found while seeding the demo: a delivery booked while all riders were offline
created zero offers and **nothing ever retried it**. The comment in `deliveries.service.ts` promised "the
next sweep", but no sweep existed. Fixed properly (see §7, bug 3).

---

## 3. The workflow a rider walks

```
PENDING → ACCEPTED → ARRIVED_AT_PICKUP → PICKED_UP → IN_TRANSIT → ARRIVED_AT_DESTINATION → DELIVERED
                                                                                          ↘ FAILED
```

Each step is a separate authenticated `POST`. The shared state machine (`@dispatch/shared`) decides what is
legal, so the UI can only ever render the next legal button and a hand-written request that skips a step
gets `409 INVALID_STATUS_TRANSITION`. Every step writes a `delivery_status_history` row with a timestamp,
which is exactly what the customer's tracking page reads.

**`ACCEPTED`, not `ASSIGNED`.** This caught a real inconsistency: the state machine forbids
`ASSIGNED → ARRIVED_AT_PICKUP`, because `ASSIGNED` means "staff assigned this to you, confirm it". A rider
who *accepted an offer* is already committed, so accepting moves the delivery `PENDING → ACCEPTED`.

### Proof of delivery

The recipient's 6-digit code (stored only as a SHA-256 hash, 5 attempts, then locked) **or** a photo plus
the recipient's name. The photo is uploaded first to private storage (`proofs/<deliveryId>/…`) and the
completion call carries only the key — so a rider can retry a flaky upload without completing twice.

Completing twice returns `409 DUPLICATE_REQUEST`. The earning row is written once, inside the same
transaction that marks the delivery DELIVERED.

---

## 4. Money

Commission is a percentage of the delivery charge, taken from the pricing rule and **frozen into the
delivery at acceptance** (`deliveries.commissionSnapshot`). Changing the rate tomorrow cannot rewrite what
a rider was promised today.

From the verified browser run: charge **₦3,201.50**, commission 20% (**₦640.50**), rider net
**₦2,561.00** — and the earnings screen showed exactly that, twice, after two deliveries.

Earnings become `AVAILABLE` after a 24-hour hold, and `withdrawableKobo` is
`available + adjustments − withdrawals requested`, floored at zero. The withdrawal UI is deliberately
absent until Phase 7 — the ledger is real, the payout is not built yet, and the screen says so.

---

## 5. Files created

**Backend**
```
src/dispatch/dispatch.service.ts        the offer engine: candidates, offers, accept race, expiry, sweep
src/dispatch/dispatch.controller.ts     GET /rider/offers · accept · reject
src/dispatch/dispatch.module.ts
src/rider-jobs/rider-jobs.service.ts    the workflow, OTP/photo completion, fail, earnings write
src/rider-jobs/rider-jobs.controller.ts  7 job routes incl. POST :id/proof-photo
src/rider-jobs/rider-jobs.module.ts
src/riders/riders.service.ts            profile, availability (+ capacity sweep), documents, ping, earnings
src/riders/riders.controller.ts         rider self-service
src/riders/admin-riders.service.ts      the review queue, document review, approve/reject/suspend
src/riders/admin-riders.controller.ts   5 staff routes incl. the private document stream
src/storage/storage.service.ts          private file storage: 5 MB cap, JPEG/PNG/WebP/PDF, no public URLs
test/dispatch.e2e.spec.ts               29 tests
test/admin-riders.e2e.spec.ts           18 tests
```

**Frontend**
```
src/hooks/useRider.ts                      profile, availability, documents, offers, jobs, earnings
src/components/OfferCountdown.tsx          the countdown ring + useCountdown (recomputes from expiresAt)
src/pages/rider/RiderHome.tsx              availability toggle, current job, real stats, document state
src/pages/rider/OffersPage.tsx             live offers, countdown, accept/pass, honest "taken" message
src/pages/rider/ActiveJobPage.tsx          six-step workflow, proof modal, report-a-problem
src/pages/rider/EarningsPage.tsx           balance breakdown, recent deliveries, net per trip
src/pages/rider/DocumentsPage.tsx          upload/replace per document type, review notes
src/pages/rider/nav.ts                     shared rider navigation
```

**Scripts**
```
scripts/seed-demo-phase4.mjs   a real rider day through the public API (no direct DB writes)
scripts/capture-phase4.mjs     Playwright: sign in → offer → accept → deliver → earnings
```

---

## 6. API endpoints added

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/api/v1/rider/profile` | rider | approval, availability, documents, earnings |
| POST | `/api/v1/rider/availability` | rider | specific refusals; returns `waitingOffers` |
| GET | `/api/v1/rider/documents` | rider | required vs uploaded vs approved |
| POST | `/api/v1/rider/documents` | rider | JSON + base64, 5 MB, validated server-side |
| POST | `/api/v1/rider/location` | rider | 120/min — the app pings every ~30 s |
| GET | `/api/v1/rider/earnings` | rider | from the earnings ledger, not a counter |
| GET | `/api/v1/rider/offers` | rider | sweeps expired offers first |
| POST | `/api/v1/rider/offers/:id/accept` | rider | the race described in §1 |
| POST | `/api/v1/rider/offers/:id/reject` | rider | reason optional, respected permanently |
| GET | `/api/v1/rider/jobs/active` | rider | the job in progress, if any |
| GET | `/api/v1/rider/jobs` | rider | history, paginated |
| GET | `/api/v1/rider/jobs/:id` | rider | 404 if it is not yours |
| POST | `/api/v1/rider/jobs/:id/arrive-pickup` | rider | step 1 |
| POST | `/api/v1/rider/jobs/:id/pickup` | rider | step 2 |
| POST | `/api/v1/rider/jobs/:id/start-transit` | rider | step 3 |
| POST | `/api/v1/rider/jobs/:id/arrive-destination` | rider | step 4 |
| POST | `/api/v1/rider/jobs/:id/proof-photo` | rider | stores the photo, returns the key |
| POST | `/api/v1/rider/jobs/:id/complete` | rider | OTP or photo+name, pays once |
| POST | `/api/v1/rider/jobs/:id/fail` | rider | reason required, hands back to dispatch |
| GET | `/api/v1/admin/riders` | staff + `rider:read` | the review queue |
| GET | `/api/v1/admin/riders/:id` | staff + `rider:read` | documents, missing list, `canApprove` |
| GET | `/api/v1/admin/riders/:id/documents/:documentId/file` | staff + `rider:document:read` | private stream, `no-store` |
| POST | `/api/v1/admin/riders/:id/documents/:documentId/review` | staff + `rider:approve` | reason required to reject |
| POST | `/api/v1/admin/riders/:id/approval` | staff + `rider:approve` | approve / reject / suspend |

"Admin approval" was an acceptance criterion for this phase, so the staff endpoints exist and are tested
here. Their screens belong to Phase 5 and will call exactly these routes.

---

## 7. Testing

```bash
cd backend && npx vitest run     # 149 tests, 9 files
```

**47 new tests this phase** — 29 in `dispatch.e2e.spec.ts`, 18 in `admin-riders.e2e.spec.ts`, and two
earlier suites grew (`state-machine`, `schema-sync` were already covering the shared pieces).

Selected results from `dispatch.e2e.spec.ts`:

| What | Expected | Result |
|---|---|---|
| Rider not yet approved goes online | 403 "still being reviewed" | ✓ |
| Approved rider with unapproved documents | 409 `DOCUMENTS_INCOMPLETE`, names NIN | ✓ |
| Approved, documented rider | 201, `availability = ONLINE` | ✓ |
| Unsupported upload type / empty file | 422 | ✓ |
| Second upload of the same document type | replaces the row, back to PENDING | ✓ |
| Offer to an online rider | 201, offer window read from the payload | ✓ |
| Offer to an offline rider | none | ✓ |
| **Two riders accept simultaneously** | **exactly `[201, 409]`**, one ACCEPTED assignment | ✓ |
| Same rider accepts twice | 409 | ✓ |
| Accept after expiry | 409 `OFFER_EXPIRED` | ✓ |
| Rejection hands the job to the next rider | ✓ | ✓ |
| Delivery booked while nobody online, then a rider comes online | offer appears, `waitingOffers ≥ 1` | ✓ |
| A refused job is never re-offered to the refuser, but reaches another rider | ✓ | ✓ |
| Walk the full workflow | 6 statuses in order | ✓ |
| Skip a step | 409 `INVALID_STATUS_TRANSITION` | ✓ |
| Completion without proof | 422 | ✓ |
| Wrong OTP ×5 | locked, 423/code `OTP_LOCKED` | ✓ |
| Correct OTP | DELIVERED, one earning row | ✓ |
| Second completion | 409 `DUPLICATE_REQUEST`, still one earning | ✓ |
| Proof photo before pickup | 409 | ✓ |
| Proof photo on another rider's job | 404 | ✓ |
| Another rider's job detail | 404 (not 403) | ✓ |
| Location pings | stored as a time series | ✓ |
| Earnings before/after a job | honest zeros → pending balance | ✓ |
| Customer token on every rider route | 403 | ✓ |

From `admin-riders.e2e.spec.ts`: the queue with document counts, search, detail with `canApprove` and the
missing list, approve/reject documents (rejection without a reason is refused), the rejection note shown
back to the rider, the private document stream (200 for staff with the permission, 403 for a support agent,
401 anonymous, `no-store`), re-upload after rejection, approval refused while documents are unapproved,
approval + audit trail, rejection with a reason, suspension taking the rider offline and blocking them, no
double approval, and the authorisation matrix on all of it.

### Browser journey (`node scripts/capture-phase4.mjs`)

A real Chromium run against the real API: sign in as a rider → overview shows **Online — receiving
offers** → offers screen with the ring at **18 s of 20** → accept → walk four workflow steps → complete
with a photo and the recipient's name → land on earnings showing **₦2,561.00** net for that trip →
documents all approved → the same overview at 390 px. One console message, the expected 401 from the
anonymous session check.

---

## 8. What the rider sees

| Screen | What it proves |
|---|---|
| Overview | Availability, approval, earnings and document state all read from the database |
| Offers | The countdown is computed from the server's `expiresAt`; "no longer available" is a real race loss |
| Active job | Only the next legal step is offered; the history column is the same data the customer sees |
| Proof modal | Two real paths, both server-validated; the button stays disabled until the proof is complete |
| Earnings (`45-rider-earnings.png`) | Net pay after commission, per trip, from the ledger |
| Documents (`46-rider-documents.png`) | Approved by a human, with the reviewer's note visible when rejected |
| Mobile (`47-rider-overview-mobile.png`) | Usable at 390 px — where riders actually work |

Screenshots live in `documentation/screenshots/phase-4/` and are embedded in `BUILD-REPORT.html`.

---

## 9. Bugs found and fixed

1. **ABBA deadlock in offer acceptance.** Expiring the rival assignments inside the accept transaction made
   two concurrent accepts lock each other; Postgres killed one and the rider saw a 500. Rival expiry moved
   outside the transaction into a single `updateMany`. The suite now runs the race three times in a row
   without a flake.
2. **Accepting set the delivery to `ASSIGNED`.** The state machine then refused `ASSIGNED → ARRIVED_AT_PICKUP`.
   Accepting now moves `PENDING → ACCEPTED`; `ASSIGNED` stays reserved for staff assignment.
3. **A delivery booked while every rider was offline was never offered again.** Found while seeding the
   demo — the code comment promised a sweep that did not exist. Added `offerWaitingDeliveries()`, called
   when a rider comes online, and fixed the exclusion rule so an *expired* offer no longer blocks a rider
   forever while an explicit *refusal* still does.
4. **The proof-of-delivery photo path had no upload endpoint.** `complete` accepted a `proofPhotoKey` that
   nothing could produce. Added `POST /rider/jobs/:id/proof-photo` (in transit only, own job only).
5. **A missing file on disk returned a 500.** A restored database can outlive its uploads. Now a 404 with a
   readable message: "ask the rider to upload it again".
6. **`resetUsers` broke on a new foreign key.** `rider_earnings_deliveryId_fkey` blocked table resets; the
   delete order now includes earnings, adjustments and withdrawals before deliveries.
7. **The demo rider's phone was left unverified** after a crashed seed run, and the UI quietly showed a
   "verify your phone" banner. The seed now finishes any missing verification, and the script is
   re-runnable: it releases a stale job and re-books so an offer always exists.

---

## 10. Commands

```bash
npm run setup                        # fresh sandbox: services + install + migrate + seed
npm run dev                          # API :4000, web :5173

node scripts/seed-demo-phase4.mjs    # a real rider: registered, verified, approved, online, with an offer
node scripts/capture-phase4.mjs      # sign in → accept → deliver → earnings + screenshots

cd backend && npx vitest run         # 149 tests
python3 scripts/build-report.py      # regenerate BUILD-REPORT.html
```

Demo credentials created by the seed (development only):

```
rider    demo.rider@dispatch.test    / Rider@12345
customer demo.customer@dispatch.test / Customer@12345
admin    admin@dispatch.test         / Admin@12345
```

> **If the capture script fails with 429:** the login limiter allows 10 attempts per 5 minutes per IP, and
> repeated capture runs will hit it. Wait five minutes, or clear the limiter in development with
> `redis-cli --scan --pattern 'ratelimit:*' | xargs -r redis-cli del`.

---

## 11. Known limitations

- **Offers are polled, not pushed.** The rider app refetches every 4 seconds; Socket.IO push and BullMQ
  arrive in Phase 6. The deadline itself is enforced server-side, so a slow poll can never extend an offer.
- **The waiting-delivery sweep runs when a rider comes online**, not on a timer. Deliveries that find no
  rider wait for capacity or for staff assignment in Phase 5; the scheduled worker joins them in Phase 6.
- **No withdrawals yet.** Earnings accrue, clear after 24 hours and are shown honestly; the payout flow is
  Phase 7.
- **Google Maps is still stubbed.** Distance-to-pickup ranking uses haversine from the last ping, which is
  the right shape for the real distance matrix to slot into.
- **A rider has one vehicle.** The schema supports several; the onboarding form and the payroll snapshot
  use the first.
