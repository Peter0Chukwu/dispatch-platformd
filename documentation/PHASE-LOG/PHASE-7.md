# Phase 7 — Payments, wallets and the double-entry ledger

**Date completed:** 5 November 2026
**Status:** ✅ Complete — 214 automated tests passing (21 new), every money screen driven end to end in a
real browser against the real database.

---

## 1. The rule that shaped this phase

> **A naira exists only if the books say it does.**

Everything else follows from that sentence:

* a payment is not money until the **gateway** says so — a signature-verified webhook, re-verified against
  the provider's own API, with the amount compared to what we asked for;
* a wallet balance is a *cache* of a ledger account, never a number we trust on its own;
* a rider's earning is a liability of the company from the moment the job is done, held for a window, then
  paid through an approval nobody can shortcut;
* and the finance screen can prove all of it, live, on demand.

The proof is a screen the finance team can run at any time (`Reconciliation`): trial balance, every payment
posted exactly once, wallet balances equalling the ledger, rider payables equalling accruals, withdrawals in
transit equalling their account. Five checks, all green, or the day is not closed.

---

## 2. The money map

```
                    ┌──────────── CUSTOMER PAYS ────────────┐
   card / transfer  │  POST /payments/deliveries/:id/initialize
   (Paystack /      │      → Payment PENDING (our reference)
    Flutterwave)    │      → gateway authorisation URL
                    │  webhook (signature) ─┬→ re-verify at the gateway
                    │  or POST /verify      ┘→ settle()  ← ONE code path
                    └───────────────────────────────────────────────┘
   wallet           POST /payments/deliveries/:id/pay-with-wallet
                        → SELECT … FOR UPDATE, balance check, debit + journal

                    ┌──────────── RIDER EARNED ─────────────┐
   job delivered    → RiderEarning PENDING (hold = finance.earningsHoldHours)
   hold elapsed     → AVAILABLE (lazy release + 60 s sweep)
   rider asks       → Withdrawal REQUESTED  (min, daily cap, withdrawable)
   finance approves → Withdrawal APPROVED   (earnings payable → withdrawals payable)
   finance pays     → Withdrawal PAID       (withdrawals payable → clearing, provider transfer)
                    └───────────────────────────────────────────────┘

                    ┌──────────── REFUND ───────────────────┐
   staff refunds    → wallet payment: credited straight back to the wallet
                    → gateway payment: reversed at the provider (simulated in DEVELOPMENT)
                    → Refund COMPLETED + journal + delivery paymentStatus
```

### The postings

Every business event writes one **balanced** journal entry, keyed by an idempotency key:

| Event | Debit | Credit |
|---|---|---|
| Delivery paid by gateway | clearing (gross), gateway fees | delivery revenue, surcharge revenue, clearing (fee) |
| Delivery paid by wallet | customer wallet liability | delivery revenue, surcharge revenue |
| Cash on delivery at completion | cash clearing | delivery revenue, surcharge revenue |
| Wallet top-up settled | clearing | customer wallet liability |
| Rider earning accrued | rider commission cost | rider earnings payable |
| Withdrawal approved | rider earnings payable | withdrawals payable |
| Withdrawal paid | withdrawals payable | clearing |
| Withdrawal rejected after approval | withdrawals payable | rider earnings payable |
| Refund (gateway) | refunds issued | clearing |
| Refund (wallet) | refunds issued | customer wallet liability |

A single unbalanced entry is refused outright — the service validates `Σ debits = Σ credits` **before**
anything is written, and the test suite asserts the trial balance after every money scenario.

---

## 3. What was built

### Backend

| File | What it does |
|---|---|
| `src/ledger/accounts.ts` | The chart of accounts the code posts against (codes match the seed exactly) |
| `src/ledger/ledger.service.ts` | `post()` (balance check, idempotency, single transaction), `trialBalance()`, `accountBalance()` |
| `src/ledger/ledger.module.ts` | Global module — money is posted from payments, jobs, withdrawals and refunds |
| `src/ledger/ledger.controller.ts` | `GET /admin/ledger/trial-balance` (`finance:read`) |
| `src/payments/payment-providers.ts` | Paystack + Flutterwave adapters: initialize, verify, constant-time signature check, event id extraction |
| `src/payments/payments.service.ts` | Initialize, settle (one path for webhook / verify / simulator), amount check, wallet payment, webhook store-then-process |
| `src/payments/refunds.service.ts` | Refund a payment, reverse at the provider or credit the wallet, book it, update the delivery |
| `src/payments/payments.controller.ts` | Customer: config, list, detail, initialize, pay-with-wallet, verify, simulate (dev-only), wallet top-ups |
| `src/payments/webhooks.controller.ts` | `POST /webhooks/payments/{paystack,flutterwave}` — public, raw-body signature verification |
| `src/wallet/wallet.service.ts` | `SELECT … FOR UPDATE` + optimistic `version`, `balanceAfterKobo`, idempotent credit/debit with its own journal entry |
| `src/wallet/wallet.controller.ts` | `GET /wallet`, `GET /wallet/transactions` |
| `src/withdrawals/withdrawals.service.ts` | `withdrawable()`, request (min / daily cap / available), approve, reject (with reversal), payout (provider transfer) |
| `src/withdrawals/withdrawals.controller.ts` | Rider: list + request |
| `src/withdrawals/earnings.scheduler.ts` | Releases matured holds (boot, every 60 s, `FINANCE_SCHEDULER=off` in tests) |
| `src/admin/admin-finance.controller.ts` | Summary, payments, reconciliation, refunds, withdrawals, approve/reject/payout — each behind its own permission |
| `src/admin/admin-finance.service.ts` | The finance read models and the five reconciliation checks |
| `src/rider-jobs/rider-jobs.service.ts` | Completion now books cash-on-delivery revenue and the rider accrual |
| `src/riders/riders.service.ts` | `earningsSummary` rewritten: available / committed / withdrawn, consistent with the withdrawal rule |

### Frontend

| File | What it does |
|---|---|
| `src/pages/admin/FinancePage.tsx` | Five tabs: overview, reconciliation, payments (with refund), withdrawals (approve / reject / pay), refunds |
| `src/pages/customer/WalletPage.tsx` | Balance, top-up (presets + provider), statement, payment history, simulator confirmation |
| `src/components/PaymentPanel.tsx` | Pay a delivery from the wallet or through a gateway, with the DEVELOPMENT banner stated plainly |
| `src/pages/rider/EarningsPage.tsx` | Withdrawal request (bank, account, amount) and the request history |
| `src/hooks/usePayments.ts` | Every query/mutation, and one `invalidateMoney()` so a balance can never lag the ledger in the UI |

### Contracts the API now keeps

* An unverified webhook credits **nothing**; a genuine replayed one credits **nothing twice**
  (`@@unique([provider, eventId])`).
* A payment whose confirmed amount differs from the amount requested is marked `FAILED`, never accepted.
* A wallet can never go below zero — service check plus the database `CHECK (balance >= 0)`.
* A withdrawal requires: ≥ ₦2,000, within the daily cap, ≤ withdrawable, and a unique idempotency key.
* Only `SUPER_ADMIN` and `FINANCE_MANAGER` hold `withdrawal:approve` / `withdrawal:payout`; a rider asking
  to approve their own request gets 403.
* Refunds cannot exceed the payment, and are idempotent per refund row.

---

## 4. Configuration

| Variable | Purpose |
|---|---|
| `PAYMENTS_MODE` | `DEVELOPMENT` (simulated, no gateway calls) · `SANDBOX` · `LIVE` |
| `PAYSTACK_SECRET_KEY` / `PAYSTACK_PUBLIC_KEY` | Server-side API calls / checkout public key |
| `PAYSTACK_WEBHOOK_SECRET` | Reserved; Paystack signs with the secret key |
| `FLUTTERWAVE_SECRET_KEY` / `FLUTTERWAVE_PUBLIC_KEY` | Same, for Flutterwave |
| `FLUTTERWAVE_WEBHOOK_HASH` | The `verif-hash` value configured in their dashboard |
| `FRONTEND_URL` | Where a gateway returns the customer after paying |

`PAYMENTS_MODE=DEVELOPMENT` is the default **and** the simulator endpoint refuses to run unless that is the
mode; the API logs a warning at boot whenever it is on. Tests force it explicitly and use throwaway keys, so
the suite can never touch a real gateway.

Runtime settings (editable, no deploy): `finance.earningsHoldHours` (24), `finance.minWithdrawalKobo`
(₦2,000), `finance.maxWithdrawalPerDayKobo` (₦50,000), `payments.mode`.

---

## 5. Tests — 21 new, 214 total

`backend/test/payments.e2e.spec.ts`

| Group | What it proves |
|---|---|
| Chart of accounts | Seeded; books start balanced; an unbalanced entry is refused; the same event posts once |
| Gateway payments | PENDING until confirmed; settles once with revenue + fee; second simulate is a no-op; another customer's delivery is 404; already-paid is 409 |
| Webhooks | Bad signature → 401 and recorded; genuine signature accepted; replay is a duplicate, one row |
| Wallet | Top-up credits only on settlement and books the liability; wallet payment debits and refuses when short |
| Earnings & withdrawals | Accrual is a liability and held; hold release; min/cap/available rules; duplicate request refused; rider cannot approve; approve → pay → payables zero |
| Refunds | Wallet refund returns to the wallet and flips the delivery to REFUNDED; over-refund is 409 |
| Finance desk | Summary from real rows; support agent gets 403; reconciliation passes after a mixed day |
| Cash on delivery | Completing an unpaid job books the cash payment and the revenue |

Every money test ends with `expectBooksBalanced()` — debits equal credits, to the kobo.

Run it: `cd backend && npx vitest run test/payments.e2e.spec.ts`

---

## 6. Screenshots (real browser, real database)

`documentation/screenshots/phase-7/`

| File | What it shows |
|---|---|
| `01-finance-overview.png` | Collected ₦37,900, rider cost ₦3,758.50, gateway fees ₦831.83, net ₦108.17 — after a refund |
| `02-reconciliation.png` | Five checks green and the trial balance totalling ₦46,391.83 on both sides |
| `03-payments.png` | The payment ledger: card, wallet, top-up, with fees and statuses |
| `04-withdrawals-queue.png` | A rider's ₦3,758.50 request awaiting a finance decision |
| `05-withdrawals-approved.png` | After approval: obligation moved, "Pay rider" now offered |
| `06-customer-wallet.png` | ₦27,555.50 balance, statement with the top-up and the delivery debit, receipts |
| `07-pay-delivery.png` | The pay panel on an unpaid booking: wallet or gateway, simulator explained |
| `08-rider-earnings.png` | Cleared ₦3,758.50, requested ₦3,758.50, withdrawable ₦0.00, and the approved request below |

Reproduce: `node scripts/seed-demo-phase7.mjs` then `node scripts/capture-phase7.mjs`.

---

## 7. Bugs found and fixed while building this

1. **The webhook body was re-serialised before verification.** Express parses JSON, so `JSON.stringify(body)`
   would never match the provider's HMAC. Fixed by enabling `rawBody: true` on both bootstrap paths and
   verifying the raw bytes; if the raw body is missing the request is refused rather than checked weakly.
2. **An unhandled rejection on every webhook in DEVELOPMENT.** The handler called `adapter.verify()` before
   checking the mode, so the "verification unavailable" error escaped as an unhandled promise. Reordered.
3. **Tests were signing with an empty secret.** `ConfigService` prefers the env file over `process.env`, and
   `.env` carried `PAYSTACK_SECRET_KEY=`. The test setup now forces deterministic fake keys, so the suite can
   never use a real one *and* the signature test is reproducible.
4. **`earningsSummary` only counted `AVAILABLE` earnings — and nothing ever set them.** Withdrawable was
   always ₦0. Fixed with a real hold release (scheduler + lazy release on read) and a rewritten summary that
   subtracts committed withdrawals instead of mutating earnings.
5. **A completed delivery was blanket-marked PAID**, which would have booked revenue for money nobody had
   collected. Completion now settles a real CASH payment for unpaid (cash-on-delivery) jobs and leaves
   prepaid jobs alone.
6. **Reconciliation counted only `DELIVERY_PAYMENT` entries**, so wallet top-ups looked unposted. It now
   matches any journal entry that names a payment.
7. **`getByRole('button', { name: 'Approve' })` clicked the "approved" filter chip** — Playwright matches
   names as substrings. The capture script now uses `exact: true`, and the chips read in Title Case.
8. **The withdrawal allocation model invented money.** The first draft marked earnings `PAID` at request time
   and could strand or double-count naira when a single earning straddled the amount. Replaced with a derived
   rule — `available earnings + adjustments − in-flight withdrawals` — which cannot invent or lose a kobo.

---

## 8. What Phase 7 deliberately left to later phases

* **Live GPS tracking and maps** — Phase 8 (the customer's "waiting for a rider" copy now says so).
* **Reports & analytics with CSV/PDF exports** — Phase 9, building on the finance read models.
* **Notification centre** — still open from Phase 5.
* **Real gateway keys** live only in `backend/.env`; nothing here ships a secret, and the frontend never sees
  one beyond the public key it needs for checkout.
