# Dispatch & Logistics Platform — System Architecture (v1.0)

**Client:** Nigerian dispatch & logistics company (single company, single-city launch, multi-branch ready)
**Prepared by:** Technical development partner (Arena.ai Agent Mode)
**Date:** 4 November 2026
**Status:** ⏸ **AWAITING OWNER APPROVAL — no application code has been written yet.**

---

## 0. Development environment report (completed first, as instructed)

| Check | Result | Implication |
|---|---|---|
| OS | Debian GNU/Linux 13 (trixie), x64 | Standard Linux target, matches typical VPS |
| CPU / RAM | 2 vCPU / 1.9 GB | Enough for dev + tests; production needs ≥2 GB (4 GB recommended) |
| Node.js | **v20.20.2** (LTS) | NestJS 11 & Vite 7 both require Node ≥20 — ✅ compatible |
| npm | 10.8.2 | We will use **npm workspaces** (already installed, no extra tools) |
| PostgreSQL | Not installed → **installable** via apt (`postgresql-17` = 17.11) | Real Postgres locally, not SQLite |
| Redis | Not installed → **installable** via apt (`redis-server` 8.0.2) | Real Redis → real BullMQ queues |
| Docker | Not installed, no daemon | We run services natively here; `docker-compose.yml` still delivered for your production server |
| npm registry | Reachable (HTTP 200) | Real dependency installs and real test runs are possible |
| sudo | Available | One-time system package install is possible in Phase 1 |

**Bottom line:** this sandbox can host a *genuinely running* version of the full stack — real PostgreSQL, real Redis, real HTTP API, real React dev server, real automated tests. That is the standard I will hold every phase to.

---

## 1. Complete system architecture

### 1.1 Architecture style: modular monolith (deliberately)

Three separate microservices at launch would triple your running cost and debugging difficulty for zero business benefit at <1,000 deliveries/day. Instead:

- **One deployable backend** (NestJS) that is *internally modular* — 20+ feature modules with hard boundaries.
- **One deployable frontend** (React SPA) that is *internally partitioned* into three portals by route.
- **One worker process** (same codebase, different entrypoint) that consumes Redis/BullMQ queues.

Every module communicates through explicit service interfaces, and no module reaches into another module's tables directly through raw SQL — this is what makes a later split into services (e.g. a standalone dispatch engine or notification service) a mechanical change rather than a rewrite.

```
                                 ┌──────────────────────────────┐
                                 │   Customers (browser/mobile)  │
                                 │   Riders (mobile browser/PWA) │
                                 │   Admins / staff (desktop)    │
                                 └───────────────┬──────────────┘
                                                 │  HTTPS
                                                 ▼
                        ┌────────────────────────────────────────────────┐
                        │  CDN / Reverse Proxy (Nginx or Cloudflare)     │
                        │  TLS termination · gzip/brotli · rate limiting  │
                        └───────┬────────────────────────────┬───────────┘
                                │ static assets              │ /api/v1, /socket.io
                                ▼                            ▼
                    ┌───────────────────┐      ┌──────────────────────────────────┐
                    │ React SPA (Vite)  │      │  NestJS API  (REST + Socket.IO)  │
                    │ · Customer portal │      │  ──────────────────────────────  │
                    │ · Rider portal    │      │  Auth · Users · Customers        │
                    │ · Admin portal    │      │  Riders · Vehicles · Deliveries  │
                    └───────────────────┘      │  Dispatch · Pricing · Payments   │
                                               │  Wallets · Earnings · Withdrawals│
                                               │  Tracking · Notifications        │
                                               │  Reports · Support · Admin       │
                                               │  Audit · Common (guards, etc.)   │
                                               └───┬───────────┬──────────┬───────┘
                                                   │           │          │
                        ┌──────────────────────────┘           │          └──────────────┐
                        ▼                                      ▼                         ▼
              ┌──────────────────┐                 ┌───────────────────┐     ┌──────────────────┐
              │  PostgreSQL 17   │                 │  Redis            │     │  Object Storage  │
              │  (Prisma ORM)    │                 │  · BullMQ queues  │     │  S3 / Cloudinary │
              │  · 40+ tables    │                 │  · cache          │     │  (ID docs, POD   │
              │  · double-entry  │                 │  · rate-limit     │     │   photos, avatars│
              │    ledger        │                 │  · socket adapter │     │  — private ACL)  │
              └──────────────────┘                 └─────────┬─────────┘     └──────────────────┘
                                                             │
                                                             ▼
                                               ┌──────────────────────────────┐
                                               │ Worker process (BullMQ)      │
                                               │ · dispatch offer timeouts    │
                                               │ · auto-assignment            │
                                               │ · SMS/email/WhatsApp fan-out │
                                               │ · payment reconciliation     │
                                               │ · withdrawal payouts         │
                                               │ · report generation (CSV/PDF)│
                                               │ · GPS retention cleanup      │
                                               └───────────┬──────────────────┘
                                                           │ outbound HTTPS
                        ┌──────────────────────────────────┴─────────────────────────────┐
                        ▼                ▼                 ▼              ▼              ▼
                  Paystack        Flutterwave        Maps provider     Termii        Resend/
                 (payments)       (payments)      (Google/Mapbox)  (SMS, OTP)   Postmark (email)
                                                  + optional WhatsApp Cloud API
```

### 1.2 The three portals in one codebase, isolated by role

One React build, three route trees, one shared design system:

| Portal | Route prefix | Device priority | Auth principal |
|---|---|---|---|
| Customer | `/app/*` | Mobile-first, desktop-safe | `user.type = CUSTOMER` |
| Rider | `/rider/*` | **Mobile-only priority** (PWA, big tap targets, works on 3G) | `user.type = RIDER` |
| Admin | `/admin/*` | Desktop-first, tablet-safe | `user.type = STAFF` + role/permissions |

Route guards check the JWT's *server-issued* role — never a role stored in `localStorage`. A rider typing `/admin` gets a 403 route, and even if they forge the frontend state, **every admin endpoint re-checks permissions on the server**.

### 1.3 Worker/API separation

Anything that (a) talks to a third party, (b) takes >300 ms, or (c) must survive a deploy, runs in the worker: dispatch timers, SMS, webhook reconciliation, PDF generation, payout execution. The API stays fast and returns `202 Accepted` with a job reference where appropriate.

---

## 2. How the three portals communicate

### 2.1 Two channels, one backend

**Channel A — REST over HTTPS (`/api/v1/*`)** for everything transactional: reads, writes, mutations, reports. TanStack Query handles caching, retries (with jitter, never on 4xx), background refetch, and optimistic updates. React Hook Form + shared Zod schemas validate *before* the request; the **same schemas run again on the server** — the frontend copy is UX sugar, the server copy is the security boundary.

**Channel B — Socket.IO** for push facts: rider location, delivery status changes, new delivery offers, admin live feed. Every socket connection is authenticated with the same access token, joins rooms derived from server-side data only:

| Room | Who joins | Events received |
|---|---|---|
| `delivery:{id}` | Customer who owns it, assigned rider, admins | `delivery.status_changed`, `rider.location`, `delivery.eta_updated` |
| `rider:{riderId}` | That rider, admins | `dispatch.offer`, `dispatch.offer_cancelled`, `earnings.updated` |
| `zone:{zoneId}` | Riders in zone, admins | `dispatch.zone_activity` (aggregate counts only) |
| `admin:operations` | Staff with `delivery:read` | `ops.new_booking`, `ops.rider_status`, `ops.alert` |

A customer **cannot** subscribe to `delivery:{someone-else}` — the gateway verifies ownership before joining. Tracking data is pushed, but the *source of truth* for a status is always the database row, and every push carries the authoritative state after the DB commit (never before).

### 2.2 The full request path for one delivery (birds-eye)

```
Customer confirms booking
  → POST /api/v1/deliveries            (Zod validation, auth, rate limit)
  → PricingEngine computes fee server-side → priceSnapshot JSON frozen onto the row
  → Delivery row created: status=PENDING, paymentStatus=UNPAID   [DB tx]
  → Response: { reference, amountKobo, pricingBreakdown }        ← UI shows breakdown
Customer pays
  → POST /api/v1/payments/initialize   → provider reference returned
  → Customer redirected to Paystack/Flutterwave checkout
Provider webhook (server-to-server, signature verified, idempotent)
  → POST /api/v1/payments/webhooks/:provider
  → verify signature → dedupe by event id → verify with provider API → DB tx:
      payment.status=SUCCESS, delivery.paymentStatus=PAID,
      ledger lines written (debit gateway-clearing, credit customer-unearned)
  → enqueue auto-assignment job
Dispatch engine
  → ranks eligible riders → DeliveryAssignment(status=OFFERED, expiresAt=now+45s)
  → socket push dispatch.offer to rider phone + SMS fallback
Rider presses Accept
  → POST /api/v1/rider/assignments/:id/accept   [server re-checks offer still valid]
  → delivery.status=ASSIGNED → socket push to delivery:{id} → customer sees rider
Rider progresses: ARRIVED_AT_PICKUP → PICKED_UP (photo) → IN_TRANSIT
  → each transition: backend state-machine check + history row + socket event
Rider marks ARRIVED_AT_DESTINATION → recipient OTP issued to recipient phone
Recipient OTP verified by rider  → delivery.status=DELIVERED
  → DB tx: rider earnings + company commission + ledger entries + wallet credits
  → customer prompted to rate → review row
Admin dashboard
  → every figure computed by SQL aggregates at request time (no cached fake numbers)
```

### 2.3 How the admin sees "real-time"

The admin overview does **not** poll. On mount it fetches aggregates (`GET /api/v1/admin/dashboard/summary?from=&to=`), then subscribes to `admin:operations`. Socket events are treated as *invalidation signals* (`queryClient.invalidateQueries(['dashboard', range])`), so numbers are re-read from the database and can never drift from reality.

---

## 3. Technology stack — pinned versions

Versions are pinned (not `^latest`) for reproducibility, and chosen as **stable majors** rather than bleeding-edge RCs (e.g. Prisma 6 stable, not Prisma 8 RC — verified against the registry today).

### Frontend
| Package | Version | Notes |
|---|---|---|
| react / react-dom | 19.1.10 | |
| vite | 7.3.7 | |
| @vitejs/plugin-react | 5.2.0 | |
| typescript | 5.9.3 | |
| tailwindcss | 3.4.19 | v3 (PostCSS config) — most stable, best-documented |
| react-router-dom | 7.18.5 | data router + route guards |
| @tanstack/react-query | 5.105.3 | |
| react-hook-form | 7.91.0 | |
| zod | 3.25.76 | shared with backend |
| recharts | 3.10.1 | |
| socket.io-client | 4.8.4 | |
| leaflet + react-leaflet | 5.x / 4.x | map rendering (provider-agnostic tiles) |

### Backend
| Package | Version | Notes |
|---|---|---|
| @nestjs/core, common, platform-express | 11.2.8 | |
| prisma / @prisma/client | 6.19.3 | |
| socket.io | 4.8.4 | |
| @socket.io/redis-adapter | 8.x | multi-instance ready |
| bullmq | 5.81.5 | |
| ioredis | 5.11.1 | |
| @nestjs/jwt, passport-jwt | 11.x / 4.x | |
| argon2 | 0.44.x | password hashing |
| nestjs-zod | 5.x | one validation library end-to-end |
| helmet, class-sanitizer, express-rate-limit | latest | |
| pdfkit or @react-pdf/renderer | latest | server-side PDF reports |

### Testing
| Tool | Version | Scope |
|---|---|---|
| vitest | 3.2.7 | unit + integration (fast, ESM-native) |
| supertest | 7.3.1 | HTTP-level integration against a real Nest app |
| @playwright/test | 1.64.1 | browser E2E of the three portals |

### Monorepo
`npm workspaces` (npm is already installed — no extra tooling to learn).
`frontend/`, `backend/`, `packages/shared/` (Zod schemas + shared TS types + money helpers).

---

## 4. Database schema and relationships

**Reference artifact:** `docs/DATABASE-DRAFT.prisma` in this repo contains the same model in Prisma syntax for line-by-line review. It is a *design draft*; it becomes `backend/prisma/schema.prisma` in Phase 1.

### 4.1 Design rules that everything else depends on

1. **Money is stored as integer minor units** — `amountKobo BigInt`. ₦1,500.00 = `150000`. **Never `float`/`decimal-as-number`.** Floating-point money is the #1 way logistics platforms lose money. (JSON responses serialise kobo as *strings* to avoid JS 2^53 precision loss; the frontend formats with `Intl.NumberFormat('en-NG', { currency: 'NGN' })`.)
2. **UUID v4 primary keys** everywhere (`@db.Uuid`), so IDs are non-guessable in URLs and merge-safe across branches later.
3. **`createdAt` / `updatedAt` on every table**; immutable append-only tables (`delivery_status_history`, `ledger_lines`, `audit_logs`, `payment_webhooks`) carry `createdAt` only.
4. **Soft delete = `deletedAt`** on identity/config tables only (`users`, `addresses`, `pricing_rules`, `promotions`). Financial and delivery records are **never** deleted — they're cancelled/voided so the audit trail survives.
5. **`branchId` on every operational row** from day one, even though we launch with one branch. Adding multi-branch later then means *seeding rows*, not *rewriting every query*.
6. **Snapshots over joins for money.** A delivery stores `priceSnapshot` (JSON) and `commissionSnapshot` (JSON). When you raise the base fee next month, last month's invoices do not silently change.
7. **Every status change writes history.** `deliveries.status` is the current state; `delivery_status_history` is the truth of what happened, who did it, from where, and why.

### 4.2 Domain map (how the tables cluster)

```
IDENTITY & ACCESS        ORGANISATION            FLEET & COMPLIANCE
users ─┬─ customers       branches                riders ── vehicles
       ├─ riders          service_zones           rider_documents
       └─ staff(admins)   staff_branches          rider_locations
roles ─ role_permissions                     
permissions              PRICING & MONEY
sessions/refresh_tokens  pricing_rules ── deliveries.price_snapshot
verification_tokens      promotions ── promo_redemptions
                         payments ── payment_webhooks ── refunds
DELIVERY CORE            wallets ── wallet_transactions
deliveries ─┬─ delivery_items        rider_earnings ── withdrawals
            ├─ delivery_assignments  ledger_accounts ── ledger_lines(─ journal_entries)
            ├─ delivery_status_history  expenses
            ├─ delivery_proofs
            ├─ delivery_stops        ENGAGEMENT
            └─ reviews               notifications
                                     complaints ─ support_tickets ─ ticket_messages
                                     audit_logs · system_settings
```

### 4.3 Tables — purpose and key relationships

#### Identity & access

| Table | Purpose | Key relations / constraints |
|---|---|---|
| `users` | Single identity table for all humans. Business-specific data lives in profile tables. | `email` UNIQUE (citext-lowered), `phone` UNIQUE (E.164 `+234…`), `passwordHash`, `type` enum(`CUSTOMER`,`RIDER`,`STAFF`), `status` enum(`ACTIVE`,`SUSPENDED`,`PENDING`,`DELETED`), `emailVerifiedAt`, `phoneVerifiedAt`, `avatarUrl`, `lastLoginAt` |
| `customers` | Customer profile | `userId` UNIQUE → users.id (1:1); `referralCode`; `defaultBranchId` → branches.id |
| `riders` | Rider profile + live state | `userId` UNIQUE (1:1); `approvalStatus` enum(`PENDING`,`APPROVED`,`REJECTED`,`SUSPENDED`), `reviewedById`/`reviewedAt`/`rejectionReason`; `availability` enum(`OFFLINE`,`ONLINE`,`ON_DELIVERY`); `lastLat`/`lastLng`/`lastLocationAt` (denormalised "current position" for fast dispatch); `ratingAvg` (maintained aggregate), `ratingCount`; `commissionRatePct` (per-rider override), `emergencyContactName/Phone`; `branchId`, `serviceZoneId` |
| `staff` (`administrators`) | Admin profile | `userId` UNIQUE; `staffCode`; `branchId`; `isSuperAdmin` |
| `roles` | Named permission bundles | `key` UNIQUE (`SUPER_ADMIN`,`OPERATIONS_MANAGER`,`FINANCE_MANAGER`,`RIDER_MANAGER`,`SUPPORT_AGENT`), `isSystem` (cannot be deleted) |
| `permissions` | Atomic capabilities | `key` UNIQUE (`delivery:assign`,`pricing:write`,`withdrawal:approve`,`rider:approve`,`customer:suspend`,`report:read`,`audit:read`, …) |
| `role_permissions` | M:N join | composite PK (`roleId`,`permissionId`) |
| `staff_roles` | M:N — a staffer may hold 2 roles | composite PK (`staffId`,`roleId`) |
| `staff_branches` | Staff scoped to branches (expansion) | composite PK |
| `refresh_tokens` | Rotating refresh sessions | `tokenHash` UNIQUE, `familyId` (rotation chain), `revokedAt`, `replacedByTokenId`, `ip`, `userAgent`, `expiresAt`; index (`userId`,`revokedAt`) |
| `verification_tokens` | Email verify, phone OTP, password reset | `tokenHash` UNIQUE, `purpose` enum, `consumesAt`, `attempts`, `expiresAt` |

#### Organisation & fleet

| Table | Purpose | Notes |
|---|---|---|
| `branches` | Operating branch/hub | `code` UNIQUE, `city`, `state`, `lat/lng`, `isActive` |
| `service_zones` | Priced/operable zones | `branchId` → branches; `name`, `code` UNIQUE per branch, `centerLat/centerLng`, `radiusKm`, `polygonGeoJson` (optional precise boundary); `baseFeeKobo`, `perKmFeeKobo`, `minFeeKobo` overrides; `supportsSameDay` |
| `vehicles` | Rider vehicle records | `riderId` → riders; `type` enum(`MOTORCYCLE`,`BICYCLE`,`TRICYCLE`,`VAN`,`CAR`), `registrationNumber` UNIQUE, `make/model/year`, `capacityKg`, `isVerified`, `verifiedById`, `documentsUrl[]` |
| `rider_documents` | ID, licence, guarantor, vehicle papers | `riderId`; `docType` enum(`NIN`,`DRIVERS_LICENCE`,`VEHICLE_REGISTRATION`,`PROOF_OF_ADDRESS`,`GUARANTOR_FORM`,`SELFIE`); `fileKey` (private storage key **not** a public URL), `mimeType`, `sizeBytes`, `status` enum(`PENDING`,`APPROVED`,`REJECTED`), `reviewedById`/`reviewedAt`/`reviewNote`, `expiresAt` |
| `rider_locations` | GPS breadcrumb trail | `riderId`, `deliveryId?`, `lat`, `lng`, `accuracyM`, `speedKph`, `heading`, `recordedAt`; index (`riderId`,`recordedAt` DESC) and (`deliveryId`,`recordedAt`). **Retention:** raw pings purged after N days (setting, default 30) by a nightly job; aggregated trip summary kept with the delivery record. |

#### Delivery core

| Table | Purpose | Notes |
|---|---|---|
| `deliveries` | The central order record | `reference` UNIQUE (e.g. `DSP-261104-8F3K2A`), `customerId`, `branchId`, `serviceZoneId`, `riderId?` (current assignee, denormalised for fast queries), `deliveryType` enum(`STANDARD`,`EXPRESS`,`SCHEDULED`,`SAME_DAY`), `status` enum (see §5), `paymentStatus` enum(`UNPAID`,`PAID`,`PARTIALLY_REFUNDED`,`REFUNDED`,`FAILED`), pickup/destination address fields + `pickupLat/Lng` + `destLat/Lng`, `distanceKm`, `durationMinutes`, `senderName/Phone`, `recipientName/Phone`, `packageCategory`, `packageDescription`, `packageWeightKg?`, `packagePhotoKey?`, `specialInstructions`, `scheduledFor?`, `isFragile/isInsured`, `declaredValueKobo?`, `chargeKobo` (what we billed), `codAmountKobo` (cash-on-delivery), `priceSnapshot` JSON, `commissionSnapshot` JSON, `otpHash?`/`otpExpiresAt`/`otpAttempts`, timestamps `acceptedAt`/`pickedUpAt`/`deliveredAt`/`cancelledAt`, `cancellationReason`, `cancelledById`, `shareToken` UNIQUE (secure tracking link), `trackingTokenExpiresAt` |
| `delivery_items` | Multi-item parcels | `deliveryId`, `description`, `quantity`, `weightKg`, `declaredValueKobo` |
| `delivery_stops` | Extra stops (chargeable) | `deliveryId`, `sequence`, `address`, `lat/lng`, `contactName/Phone`, `completedAt` |
| `delivery_assignments` | **Every** offer made, accepted, rejected or expired — the audit trail of the dispatch engine | `deliveryId`, `riderId`, `status` enum(`OFFERED`,`ACCEPTED`,`REJECTED`,`EXPIRED`,`CANCELLED`), `offeredAt`, `expiresAt`, `respondedAt`, `rank`, `scoreBreakdown` JSON, `assignmentMethod` enum(`AUTO`,`MANUAL`,`REASSIGNMENT`), `assignedById?`; UNIQUE (`deliveryId`,`riderId`) |
| `delivery_status_history` | Append-only lifecycle log | `deliveryId`, `fromStatus?`, `toStatus`, `changedByUserId?`, `actorType` enum(`CUSTOMER`,`RIDER`,`STAFF`,`SYSTEM`), `reason?`, `lat?`/`lng?`, `createdAt` |
| `delivery_proofs` | POD evidence | `deliveryId`, `type` enum(`RECIPIENT_OTP`,`PHOTO`,`SIGNATURE`,`RECIPIENT_NAME`,`RIDER_GEOSTAMP`), `fileKey?`, `otpVerifiedAt?`, `recipientNameEntered?`, `capturedAt`, `lat?`/`lng?` |
| `reviews` | Ratings | `deliveryId` UNIQUE (one review per delivery), `customerId`, `riderId`, `rating` (1–5 CHECK), `comment`, `tags[]`; feeding `riders.ratingAvg` via transaction |
| `complaints` | Customer-raised issue on a delivery | `deliveryId?`, `customerId`, `category`, `description`, `status` enum(`OPEN`,`INVESTIGATING`,`RESOLVED`,`REJECTED`), `resolutionNote`, `resolvedById` |
| `support_tickets` | General support threads | `ticketNumber` UNIQUE, `customerId`/`riderId?` (raised by), `subject`, `priority`, `status` enum(`OPEN`,`PENDING_CUSTOMER`,`PENDING_AGENT`,`RESOLVED`,`CLOSED`), `assignedToStaffId?`, `lastMessageAt` |
| `ticket_messages` | Messages in a thread | `ticketId`, `authorUserId`, `body`, `attachmentKey?`, `isInternalNote` |

#### Money (the part that must never be wrong)

| Table | Purpose | Notes |
|---|---|---|
| `payments` | One row per payment *attempt* with a provider | `deliveryId?`, `customerId`, `provider` enum(`PAYSTACK`,`FLUTTERWAVE`,`WALLET`,`BANK_TRANSFER`,`CASH`), `providerReference` (our ref, UNIQUE), `providerTransactionId` (theirs, UNIQUE when present), `amountKobo`, `feeKobo`, `currency` default `NGN`, `status` enum(`PENDING`,`SUCCESS`,`FAILED`,`ABANDONED`,`REFUNDED`), `method`, `channel`, `paidAt`, `rawResponse` JSON (sanitised), `verifiedAt` |
| `payment_webhooks` | Raw inbound webhook log + idempotency | `provider`, `eventId` **UNIQUE per provider** (this is the duplicate-payment guard), `signatureValid` bool, `payload` JSON, `processedAt`, `processingError` |
| `refunds` | Refund records | `paymentId`, `amountKobo`, `reason`, `status` enum(`PENDING`,`PROCESSING`,`COMPLETED`,`FAILED`), `providerRefundId`, `processedById`, `completedAt` |
| `wallets` | One wallet per user (customer prepaid credit, rider earnings) | `userId` UNIQUE, `type` enum(`CUSTOMER`,`RIDER`,`COMPANY`), `balanceKobo` **BigInt with CHECK (>= 0)**, `currency`, `version` (optimistic lock) |
| `wallet_transactions` | Wallet movement audit | `walletId`, `direction` enum(`CREDIT`,`DEBIT`), `amountKobo`, `balanceAfterKobo`, `category` enum(`TOPUP`,`DELIVERY_PAYMENT`,`EARNING`,`WITHDRAWAL`,`REFUND`,`ADJUSTMENT`,`BONUS`,`PENALTY`), `reference` UNIQUE, `journalEntryId?`, `description`, `idempotencyKey` UNIQUE |
| `ledger_accounts` | Chart of accounts (double-entry) | `code` UNIQUE (`1000_CASH_CLEARING`, `1010_PS_CLEARING`, `1020_FLW_CLEARING`, `2000_CUSTOMER_WALLET_LIABILITY`, `2100_RIDER_EARNINGS_PAYABLE`, `2200_WITHDRAWALS_PAYABLE`, `3000_TAX_PAYABLE`, `4000_DELIVERY_REVENUE`, `4100_EXPRESS_SURCHARGE`, `5000_RIDER_COMMISSION_COST`, `5100_GATEWAY_FEES`, `5200_OPERATING_EXPENSE`, `5300_REFUNDS`, `3900_OPENING_BALANCE`), `type` enum(`ASSET`,`LIABILITY`,`EQUITY`,`REVENUE`,`EXPENSE`), `normalBalance` enum(`DEBIT`,`CREDIT`), `isSystem` |
| `journal_entries` | One balanced financial event | `reference` UNIQUE, `eventType` (`DELIVERY_PAYMENT`,`PAYOUT`,`REFUND`,`WALLET_TOPUP`,`EARNING_ACCRUAL`,`ADJUSTMENT`,`EXPENSE`,`OPENING`), `description`, `deliveryId?`, `paymentId?`, `withdrawalId?`, `idempotencyKey` UNIQUE, `createdById?`, `postedAt`; **lines must sum to zero** — enforced in the service layer *and* re-checked by a nightly integrity job |
| `ledger_lines` | Debit/credit rows | `journalEntryId`, `accountId`, `debitKobo` XOR `creditKobo`, `memo`; index (`accountId`,`createdAt`) |
| `rider_earnings` | Per-delivery earning accrual | `riderId`, `deliveryId` UNIQUE, `grossKobo`, `commissionKobo`, `bonusKobo`, `penaltyKobo`, `netKobo`, `status` enum(`PENDING`,`AVAILABLE`,`PAID`,`REVERTED`), `availableAt` (T+ hold), `payoutWithdrawalId?` |
| `withdrawals` | Rider payout requests | `riderId`, `amountKobo`, `feeKobo`, `netAmountKobo`, `status` enum(`REQUESTED`,`APPROVED`,`PROCESSING`,`PAID`,`REJECTED`,`FAILED`), `bankCode`/`accountNumber`/`accountName` (resolved & verified), `requestedById`, `reviewedById`/`reviewedAt`/`decisionNote`, `providerTransferRef` UNIQUE, `paidAt`, `failureReason` |
| `pricing_rules` | Versioned pricing config | `branchId?`, `serviceZoneId?`, `name`, `version`, `isActive`, `effectiveFrom`, `baseFeeKobo`, `perKmFeeKobo`, `minFeeKobo`, `expressSurchargeKobo`, `scheduledSurchargeKobo`, `waitingFeePerMinKobo`, `additionalStopFeeKobo`, `defaultCommissionPct`, `freeKmIncluded`, `roundToKobo`, `createdById`; index (`isActive`,`effectiveFrom`) |
| `promotions` | Discount codes | `code` UNIQUE, `type` enum(`PERCENT`,`FIXED`,`FREE_DELIVERY`), `value`, `maxDiscountKobo?`, `minOrderKobo?`, `usageLimit`, `usageCount`, `perCustomerLimit`, `startsAt`/`endsAt`, `isActive` |
| `promo_redemptions` | Redemption ledger | `promotionId`, `customerId`, `deliveryId` UNIQUE, `discountKobo`; UNIQUE (`promotionId`,`customerId`,`deliveryId`) |
| `expenses` | Operating costs | `branchId`, `category`, `amountKobo`, `description`, `spentAt`, `receiptKey?`, `recordedById` |

#### Engagement, ops & system

| Table | Purpose |
|---|---|
| `notifications` | In-app inbox: `userId`, `type`, `title`, `body`, `data` JSON, `channelsSent` JSON, `readAt`, `createdAt`; index (`userId`,`readAt`) |
| `admin_alerts` | Operations feed: new booking / rider registered / verification request / failed delivery / payment failure / withdrawal request / suspicious activity; `severity`, `acknowledgedById` |
| `audit_logs` | **Every sensitive action**: `actorUserId`, `actorRole`, `action` (`PRICING_UPDATED`,`RIDER_APPROVED`,`WITHDRAWAL_APPROVED`,`CUSTOMER_SUSPENDED`,`COMMISSION_CHANGED`,`DELIVERY_REASSIGNED`,`REFUND_ISSUED`…), `entityType`, `entityId`, `before` JSON, `after` JSON, `ip`, `userAgent`, `createdAt`; append-only, index (`entityType`,`entityId`), (`actorUserId`,`createdAt`) |
| `system_settings` | Typed key/value config: `key` UNIQUE, `valueJson`, `type`, `description`, `isSecret`, `updatedById` — e.g. `dispatch.offerTimeoutSeconds=45`, `dispatch.maxActiveDeliveriesPerRider=2`, `tracking.pingIntervalSeconds=15`, `location.retentionDays=30`, `payments.mode=SANDBOX` |
| `faqs` | Editable FAQ content for the customer portal |

### 4.4 Relationship summary (cardinality)

```
users 1──1 customers
users 1──1 riders ──< vehicles
                  ──< rider_documents
                  ──< rider_locations
                  ──< rider_earnings   >── 1 deliveries
                  ──< withdrawals
users 1──1 staff ──< staff_roles >── roles ──< role_permissions >── permissions
users 1──1 wallets 1──< wallet_transactions
customers 1──< deliveries ──< delivery_items
                        ──< delivery_stops
                        ──< delivery_assignments >── 1 riders
                        ──< delivery_status_history
                        ──< delivery_proofs
                        ──1 reviews
                        ──< complaints
                        ──< payments ──< refunds
                                     ──< payment_webhooks
branches 1──< service_zones 1──< deliveries
branches 1──< pricing_rules
pricing_rules 1──< deliveries        (via priceSnapshot for history)
journal_entries 1──< ledger_lines >── ledger_accounts
```

**Why `deliveries.riderId` *and* `delivery_assignments`?** The column is the fast, current truth (used in every rider dashboard query); the table is the history of every offer/refusal, which is what you need for dispatch quality analysis and disputes ("I was never offered that job"). Denormalise for speed, keep the log for truth.

### 4.5 Indexing strategy (the ones that matter)

- `deliveries`: (`customerId`,`createdAt` DESC), (`riderId`,`status`), (`branchId`,`status`,`createdAt` DESC), (`status`,`createdAt`) for the ops queue, (`reference`) unique, (`scheduledFor`) partial for the scheduler.
- `riders`: (`availability`,`branchId`,`serviceZoneId`) — the dispatch engine's hot path; (`userId`) unique; GIST/btree on `lastLat/lastLng` once volume justifies a PostGIS migration (deliberately *not* in v1 — PostGIS adds deployment complexity for a single-city launch; the swap is one column change later).
- `rider_locations`: (`riderId`,`recordedAt` DESC), (`deliveryId`,`recordedAt`).
- `ledger_lines`: (`accountId`,`createdAt`), (`journalEntryId`).
- `wallet_transactions`: (`walletId`,`createdAt` DESC), `reference` unique, `idempotencyKey` unique.
- `payment_webhooks`: (`provider`,`eventId`) **unique** — the single most important index in the system, because it is what makes duplicate Paystack callbacks harmless.
- `audit_logs`: (`entityType`,`entityId`), (`actorUserId`,`createdAt` DESC), (`createdAt`).

### 4.6 Seed data required for a working system

Exactly 5 roles + ~40 permissions, 1 branch, 2–3 service zones (Lagos: Lagos Island / Mainland / Lekki–Ajah), 1 `pricing_rules` row, the 14 ledger accounts, `system_settings` defaults, 1 super-admin (credentials printed once to the console, forced password change), and the FAQ starter set. **No fake deliveries, riders or revenue.**

---

## 5. Delivery lifecycle state machine (enforced on the backend)

```
                    ┌──────────┐
                    │ PENDING  │ (booking created, awaiting payment/assignment)
                    └────┬─────┘
             payment ok  │            customer/staff cancels
                         ▼                    │
                    ┌──────────┐              │
                    │ ASSIGNED │──────────────┤
                    └────┬─────┘              │
             rider accept│   rider reject/timeout → back to PENDING (next candidate)
                         ▼                  │
                    ┌──────────┐             │
                    │ ACCEPTED │─────────────┤
                    └────┬─────┘             │
        arrive at pickup │                   │
                         ▼                   │
                 ┌───────────────────┐       │
                 │ ARRIVED_AT_PICKUP │───────┤
                 └────────┬──────────┘       │   ┌───────────┐
      package collected   │                  ├──▶│ CANCELLED │
                          ▼                  │   └───────────┘
                    ┌───────────┐            │   ┌──────────┐
                    │ PICKED_UP │────────────┤──▶│ REJECTED │ (rider refused;
                    └─────┬─────┘            │   └──────────┘  delivery re-queued)
                          ▼                  │
                    ┌───────────┐            │
                    │ IN_TRANSIT│────────────┤
                    └─────┬─────┘            │
    arrive at destination │                  │
                          ▼                  │
                ┌────────────────────────┐   │
                │ ARRIVED_AT_DESTINATION │───┤
                └───────────┬────────────┘   │
     POD satisfied (OTP /  │                │
     photo / recipient)    ▼                │
                    ┌───────────┐            │   ┌──────────┐   ┌──────────┐
                    │ DELIVERED │            ├──▶│  FAILED  │──▶│ RETURNED │
                    └───────────┘            │   └──────────┘   └──────────┘
```

**Allowed transitions** (anything else → HTTP 409 `INVALID_STATUS_TRANSITION`, with the error listing valid next states):

| From | Allowed to | Who |
|---|---|---|
| PENDING | ASSIGNED, CANCELLED | system, staff, customer |
| ASSIGNED | ACCEPTED, PENDING (timeout/reject), CANCELLED | rider, system, staff, customer (with rules) |
| ACCEPTED | ARRIVED_AT_PICKUP, CANCELLED, FAILED | rider (owning), staff |
| ARRIVED_AT_PICKUP | PICKED_UP, FAILED, CANCELLED | rider, staff |
| PICKED_UP | IN_TRANSIT, FAILED | rider, staff |
| IN_TRANSIT | ARRIVED_AT_DESTINATION, FAILED | rider, staff |
| ARRIVED_AT_DESTINATION | DELIVERED, FAILED | rider (POD required), staff (with reason + permission) |
| FAILED | RETURNED, DELIVERED, CANCELLED | staff |
| DELIVERED | (terminal) — refunds create separate records | — |
| CANCELLED / RETURNED / REJECTED | (terminal) | — |

Guards attached to transitions: **ownership** (only the currently assigned rider may progress), **POD** (`DELIVERED` requires a valid `delivery_proof`; OTP must match and be unexpired), **payment** (`PICKED_UP` blocked for unpaid non-COD deliveries), **capacity** (a rider at `maxActiveDeliveries` cannot accept another), **zone** (rider outside the delivery's zone cannot accept unless `dispatch.allowCrossZone`).

---

## 6. API structure

Base URL: `/api/v1`. JSON only. Auth via `Authorization: Bearer <accessToken>`; refresh token in an `HttpOnly; Secure; SameSite=Strict` cookie (CSRF-safe for the SPA) with rotation + reuse detection.

**Conventions**
- Money fields always end in `Kobo` and are serialised as strings.
- Times are ISO-8601 UTC; the UI renders in `Africa/Lagos`.
- Lists: `?page=1&pageSize=20&sort=-createdAt&search=&status=` → `{ data, meta:{ page, pageSize, total, totalPages } }`.
- Errors: `{ error:{ code, message, details?, requestId } }` — codes like `VALIDATION_FAILED`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_STATUS_TRANSITION`, `INSUFFICIENT_BALANCE`, `OFFER_EXPIRED`, `DUPLICATE_REQUEST`.
- Idempotency: `Idempotency-Key` header required on `POST` money/assignment endpoints.

### 6.1 Auth & profile
| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/auth/register/customer` | Customer signup (email or phone) |
| POST | `/auth/register/rider` | Rider application (creates PENDING rider) |
| POST | `/auth/login` | Login → access + refresh (portal-inferring via `audience`) |
| POST | `/auth/refresh` | Rotate refresh token |
| POST | `/auth/logout` · `/auth/logout-all` | Revoke session(s) |
| POST | `/auth/verify-email/:token` · `/auth/resend-verification` | Email verification |
| POST | `/auth/otp/request` · `/auth/otp/verify` | Phone OTP |
| POST | `/auth/password/forgot` · `/auth/password/reset` | Reset flow (single-use token) |
| GET/PATCH | `/me` | Profile; `POST /me/avatar`, `PATCH /me/password` |
| GET/POST/PATCH/DELETE | `/me/addresses` | Saved addresses (soft delete) |
| GET/POST/DELETE | `/me/devices` | Push/socket registrations |

### 6.2 Customer — booking, tracking, money, support
| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/deliveries/quote` | **Server-side** price preview from coords/type/zone/promo — no delivery created |
| POST | `/deliveries` | Create booking (freezes `priceSnapshot`) |
| GET | `/deliveries` · `/deliveries/:id` | List / detail (own only) |
| POST | `/deliveries/:id/cancel` | Cancel (rules: not after PICKED_UP without support) |
| POST | `/deliveries/:id/confirm-delivery` | Customer confirms receipt |
| POST | `/deliveries/:id/share-link` | Issue/rotate secure public tracking token |
| GET | `/track/:token` (public, rate-limited) | Sanitised tracking payload (no PII beyond first name, no earnings) |
| POST | `/reviews` | Rate a delivered delivery |
| GET/POST | `/payments/initialize` · `/payments/:id` | Start payment / status |
| GET | `/wallet` · `/wallet/transactions` | Balance + history |
| POST | `/wallet/topup` | Fund wallet via provider |
| GET | `/transactions` | Unified history (payments + wallet) |
| POST | `/support/tickets` · `GET /support/tickets` · `POST /support/tickets/:id/messages` | Support threads |
| POST | `/complaints` | Delivery complaint |

### 6.3 Rider portal
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/rider/dashboard` | Today's jobs, earnings snapshot, ratings, availability |
| PATCH | `/rider/availability` | `{ availability: ONLINE|OFFLINE, lat?, lng? }` (server checks approval) |
| GET | `/rider/offers` · `/rider/assignments/:id/accept` · `/reject` | Offer handling |
| GET | `/rider/deliveries?scope=today|active|completed` | Job lists |
| POST | `/rider/deliveries/:id/arrive-pickup` | Status transition |
| POST | `/rider/deliveries/:id/pickup` | Requires package photo |
| POST | `/rider/deliveries/:id/in-transit` · `/arrive-destination` | Transitions |
| POST | `/rider/deliveries/:id/complete` | `{ otp }` or `{ recipientName, photoKey }` |
| POST | `/rider/deliveries/:id/fail` | `{ reason, photoKey? }` |
| POST | `/rider/deliveries/:id/location` | HTTP fallback for GPS pings (socket is primary) |
| GET | `/rider/earnings` · `/rider/earnings/summary` | Gross, commission, net, bonuses |
| GET/POST | `/rider/withdrawals` | Request payout; bank account resolution |
| POST | `/rider/documents` | Upload/replace docs (private storage) |
| GET | `/rider/notifications` | Inbox |

### 6.4 Admin portal (every route `.use(PermissionsGuard)`)
| Area | Endpoints |
|---|---|
| Dashboard | `GET /admin/dashboard/summary?from&to` · `GET /admin/dashboard/trends?from&to&granularity` · `GET /admin/dashboard/operations` (avg completion time, success/cancel rate, ratings, top zones) |
| Deliveries | `GET /admin/deliveries` (filters, search, pagination) · `GET /admin/deliveries/:id` (timeline) · `POST /admin/deliveries/:id/assign` · `/auto-assign` · `/reassign` · `/cancel` · `/fail` · `GET /admin/deliveries/:id/proof` (signed URL) · `GET /admin/deliveries/export?format=csv|pdf` |
| Riders | `GET /admin/riders` · `/admin/riders/:id` · `POST /admin/riders/:id/approve|reject|suspend|reactivate` · `GET /admin/riders/:id/documents` (signed URLs) · `GET /admin/riders/:id/performance` · `PATCH /admin/riders/:id/commission` · `POST /admin/riders/:id/adjustments` · `GET /admin/riders/live` |
| Customers | `GET /admin/customers` · `/:id` · `POST /:id/suspend|reactivate` · `GET /:id/deliveries|payments|tickets` |
| Finance | `GET /admin/finance/summary` · `/revenue` · `/ledger` · `/ledger/trial-balance` · `/payments` · `/refunds` (`POST /admin/refunds`) · `/withdrawals` (`POST /:id/approve|reject`, `POST /:id/mark-paid`) · `/expenses` (CRUD) · `/reconciliation` |
| Pricing | `GET/POST/PATCH /admin/pricing-rules` · `POST /admin/pricing-rules/:id/activate` · `POST /admin/pricing-rules/:id/deactivate` · `GET/POST/PATCH /admin/promotions` · `GET/POST/PATCH /admin/service-zones` |
| Live map | `GET /admin/tracking/live` (online riders + active deliveries) — data from `riders.lastLat/lastLng` + socket stream |
| Reports | `POST /admin/reports` (async job) · `GET /admin/reports` · `GET /admin/reports/:id/download` — types: daily-deliveries, monthly-deliveries, revenue, rider-earnings, customers, cancellations, rider-performance, zone-performance, financial-summary (CSV + PDF) |
| Notifications | `GET /admin/alerts` · `POST /admin/alerts/:id/ack` · `POST /admin/notifications/broadcast` |
| Staff & RBAC | `GET/POST/PATCH /admin/staff` · `POST /admin/staff/:id/suspend` · `GET /admin/roles` · `GET /admin/permissions` · `PATCH /admin/roles/:id/permissions` |
| Settings & audit | `GET/PATCH /admin/settings` · `GET /admin/audit-logs?entityType&actorId&from&to` |

### 6.5 Webhooks & realtime
| Method | Endpoint | Notes |
|---|---|---|
| POST | `/webhooks/paystack` | `x-paystack-signature` HMAC-SHA512 verification, `event.id` dedupe, then **re-verify** with provider API before crediting |
| POST | `/webhooks/flutterwave` | `verif-hash` header verification, same pattern |
| POST | `/webhooks/whatsapp` | Optional: Meta signature verification |
| Socket.IO | namespace `/tracking` | `join:delivery`, `rider:location` (rider→server), `delivery:status` (server→room) |
| Socket.IO | namespace `/rider` | `dispatch:offer`, `dispatch:offer_expired`, `earnings:updated` |
| Socket.IO | namespace `/admin` | `ops:new_booking`, `ops:alert`, `ops:rider_location` |

### 6.6 Cross-cutting middleware stack (order matters)
`helmet` → CORS allowlist → body-limit (2 MB, 10 MB for upload endpoints) → rate limiter (Redis-backed; stricter buckets on auth/OTP/webhooks) → request-id → Zod validation pipe (strip unknown keys) → JWT guard → permissions guard → ownership guard → controller → service (DB transaction) → Prisma query logging (slow-query only) → audit interceptor (on `@Audit()` routes) → error filter (never leaks stack traces or SQL in production).

---

## 7. Recommended project folder structure

```
dispatch-platform/
├── package.json                    # npm workspaces root; scripts: dev, build, test, db:*
├── docker-compose.yml              # Postgres + Redis + api + worker + frontend (for your VPS)
├── .env.example                    # every variable, documented, no real secrets
├── README.md                       # beginner-friendly run book
├── documentation/
│   ├── ARCHITECTURE.md             # ← this document
│   ├── DATABASE-DRAFT.prisma       # reviewable schema draft
│   ├── API-REFERENCE.md            # generated + curated
│   ├── RUNBOOK.md                  # start/stop/troubleshoot, backups, restore drills
│   ├── SECURITY.md                 # threat model, secrets policy, NDPA compliance
│   ├── GO-LIVE-CHECKLIST.md        # provider setup, DNS, TLS, monitoring
│   └── PHASE-LOG/                  # one file per phase: what changed, how to test
├── packages/
│   └── shared/                     # imported by BOTH frontend and backend
│       ├── src/schemas/            # Zod: delivery, auth, pricing, withdrawal, review…
│       ├── src/enums/              # DeliveryStatus, PaymentStatus, roles, permissions
│       ├── src/money.ts            # kobo helpers + NGN formatting
│       ├── src/constants/          # Nigerian states, package categories, banks
│       └── src/validators/phone.ts  # NG phone normalisation → E.164
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/             # managed migration history
│   │   └── seed.ts                 # roles, permissions, ledger accounts, branch, zones
│   └── src/
│       ├── main.ts                 # bootstrap (HTTP)
│       ├── worker.ts               # bootstrap (BullMQ consumers)
│       ├── app.module.ts
│       ├── config/                 # env validation (fails fast on missing vars)
│       ├── common/                 # guards, interceptors, filters, pipes, decorators,
│       │                           # repository helpers, pagination DTOs, money utils
│       ├── infra/                  # prisma.service, redis.service, storage.service,
│       │                           # queue.service, socket adapter
│       ├── auth/  users/  customers/  riders/  vehicles/
│       ├── deliveries/  dispatch/  tracking/  pricing/
│       ├── payments/  wallets/  earnings/  withdrawals/  ledger/
│       ├── notifications/  reports/  support/  admin/  audit/  settings/
│       ├── jobs/                   # processors: dispatch-timeout, notifications,
│       │                           # reconciliation, payouts, reports, cleanup
│       └── test/                   # test bootstrap, factories, e2e helpers
├── frontend/
│   ├── index.html
│   ├── tailwind.config.ts · postcss.config.js · vite.config.ts
│   └── src/
│       ├── main.tsx · App.tsx
│       ├── routes/                 # router config + guards per portal
│       ├── layouts/                # CustomerLayout, RiderLayout, AdminLayout, AuthLayout
│       ├── components/ui/          # Button, Input, Select, Modal, Table, Badge, Card,
│       │                           # Toast, Skeleton, EmptyState, ErrorState, Pagination,
│       │                           # ConfirmDialog, FileDropzone, StatusPill, MoneyText
│       ├── components/maps/        # MapPicker, LiveMap, RoutePolyline, AddressAutocomplete
│       ├── components/charts/      # wrappers around Recharts with brand theming
│       ├── customer/               # dashboard, BookDelivery(4-step), DeliveryDetail,
│       │                           # Tracking, Wallet, Support, Profile
│       ├── rider/                  # MobileDashboard, Offers, ActiveDelivery, Earnings,
│       │                           # Withdrawals, Documents, Profile
│       ├── admin/                  # Dashboard, Deliveries, Riders, Customers, Finance,
│       │                           # Pricing, LiveMap, Reports, Notifications, Staff,
│       │                           # Settings, AuditLog
│       ├── hooks/                  # useAuth, useSocket, useDeliveryTracking,
│       │                           # useGeolocation, usePermission, usePagination
│       ├── services/               # apiClient (fetch + interceptors), one file per domain
│       ├── contexts/               # AuthContext, SocketContext, ThemeContext
│       ├── lib/                    # queryClient, formatters, constants
│       └── styles/
├── tests/
│   ├── e2e/                        # Playwright: 3 portals, full delivery journey
│   └── load/                       # k6/autocannon smoke for booking + dispatch
└── scripts/                        # dev-db-up.sh, backup.sh, restore.sh, seed-admin.ts
```

**Backend module anatomy (uniform, so any module is navigable):**
```
deliveries/
├── deliveries.module.ts
├── deliveries.controller.ts        # customer-facing
├── rider-deliveries.controller.ts
├── admin-deliveries.controller.ts
├── deliveries.service.ts           # business logic, no HTTP knowledge
├── deliveries.repository.ts        # Prisma queries only
├── transition.service.ts           # the state machine (single source of truth)
├── dto/                            # Zod schemas re-exported from packages/shared
└── deliveries.service.spec.ts
```

---

## 8. Detailed development roadmap

Each phase ends with: code, migration, tests, a `documentation/PHASE-LOG/PHASE-N.md`, and a **live demo you can click through**. I will not start phase N+1 until phase N is green and you've approved.

| Phase | Deliverables | Definition of "done" (tested) |
|---|---|---|
| **1. Foundation** | Monorepo, Postgres 17 + Redis 8 installed in this environment, Prisma schema (all tables) + first migration, seed script (roles/permissions/ledger accounts/branch/zones/settings/super-admin), NestJS boot (config validation, helmet, CORS, Zod pipe, error filter, health endpoint), Vite+Tailwind design system with 15 UI primitives and a styleguide page | `npm run db:up && npm run db:migrate && npm run db:seed` works from zero; `/health` returns DB+Redis status; 20 UI components render in a styleguide route; `npm test` green |
| **2. Auth & RBAC** | Argon2id hashing, JWT access+rotating refresh with reuse detection, email verify, phone OTP, password reset, `PermissionsGuard` + `@RequirePermission`, seeded roles, audit interceptor, login/register/verify screens for all three portals, route guards | Integration tests: register→verify→login→refresh→logout; invalid login; expired token; rider hitting admin endpoint = 403; permission matrix test per role; brute-force rate limit returns 429 |
| **3. Customer portal + pricing** | 4-step booking wizard (map pickers, address autocomplete, geocoding, package photo, scheduling), `PricingEngine` (zone + distance + type + promo, kobo integer math), quote endpoint, delivery creation with `priceSnapshot`, history + detail, saved addresses | Unit tests for pricing (edge cases: minimum fee, free km, express surcharge, promo cap, distance 0); booking creates real DB row; quote matches saved charge to the kobo |
| **4. Rider portal** | Rider application + private document upload → admin review gate, mobile dashboard, online/offline with GPS, offers list, full status workflow with POD (OTP + photo), earnings view, withdrawals request | Rider cannot go online while `PENDING`; OTP mismatch blocks `DELIVERED`; illegal transitions return 409; rider can only act on own deliveries; earnings arithmetic asserted |
| **5. Admin portal** | Overview dashboard with all §7-A statistics computed by SQL, date-range filters, deliveries/riders/customers/finance/pricing/staff/audit screens, data tables with search/filter/pagination/CSV export, notification centre | Dashboard numbers asserted against seeded scenarios; permission tests (support agent cannot approve withdrawal); suspend/reactivate actually blocks login |
| **6. Dispatch engine** | Eligibility filters, scoring + ranking, offer → accept/reject/timeout, automatic next-candidate escalation, manual assign/reassign/override, capacity & zone rules, `delivery_assignments` audit, socket + SMS offer delivery | Test: no eligible rider → delivery stays PENDING and alerts ops; timeout escalates to rider #2; concurrent accept attempts → exactly one wins (DB constraint); rider at capacity never gets offered |
| **7. Payments, wallet, ledger** | Paystack + Flutterwave init/verify/webhook (signature + dedupe + re-verify), wallet top-up & deduction, commission split on `DELIVERED`, double-entry ledger posting, refunds, withdrawal approval + Paystack transfer payout, reconciliation job, `DEVELOPMENT/SANDBOX mode` banner | Duplicate webhook fires twice → one credit only; forged webhook signature → 401 & logged; wallet cannot go negative (constraint test); trial balance always sums to zero; withdrawal double-click → one payout |
| **8. Maps, tracking, realtime** | Address autocomplete + reverse geocode, route/distance/ETA, rider GPS ping cadence configurable, customer live tracking with ETA, public share link, admin live operational map with clickable markers, socket auth + rooms | Only owning customer subscribes to a delivery room (403 otherwise); tracking stops at `DELIVERED`; share link expires/rotates; location permission denied → graceful degraded UI (no fake positions) |
| **9. Reports & analytics** | CSV + PDF for the 9 report types, async job → signed download, rider performance, zone performance, financial summary (gross vs net clearly separated), email scheduling ready | PDF/CSV totals reconcile with dashboard and ledger; large report doesn't block the API (job queue test) |
| **10. Hardening & deployment** | Playwright E2E of the 20-step master scenario, load smoke, security review (OWASP checklist, dependency audit), backup/restore script + documented drill, Docker compose for VPS, CI workflow file, RUNBOOK + GO-LIVE checklist | Full journey passes headlessly; `npm audit` clean of highs; restore-from-backup verified; deploy doc followed end-to-end |

**Estimated effort (realistic, working with you):** Phases 1–2 ≈ 1–2 sessions each; 3–5 are the heavy UI phases; 6–8 the hardest logic; 9–10 the polish. The overall build is a multi-session project — not one prompt. I'll keep a running phase log so you can always see exactly where the project stands.

---

## 9. External services and accounts required

| Service | Needed for | Free/sandbox path | What you must do | Est. cost at launch |
|---|---|---|---|---|
| **Paystack** | Card/bank/USSD payments, transfers for rider payouts | Test keys work immediately; **no business docs needed for test mode** | Create account → Settings → API Keys → copy test public/secret; add webhook URL later | **1.5% + ₦100** (local cards, capped ₦2,000); transfers ₦10–₦50 |
| **Flutterwave** | Second payment rail | Sandbox keys instantly | Create account → API keys; set `secret hash` for webhooks | ~1.4% local |
| **Maps** | Autocomplete, geocoding, routing, ETA, map tiles | Google $200/mo free credit (card required) **or** Mapbox free tier | Choose provider (§11 decision) → create project → enable *Places, Geocoding, Directions* → restrict key by HTTP referrer | ₦0–15,000/mo at low volume |
| **SMS (Termii)** — primary NG SMS | OTP, delivery alerts | Small trial credit | Register sender ID (`DispX`) — **sender-ID approval required for production** | ~₦3.5–₦5 / SMS |
| **Email (Resend)** | Verification, receipts, reports | 3,000/mo free | Verify sending domain (DNS records) | ₦0 initially |
| **Object storage** | ID docs, POD photos, avatars | Cloudinary free tier or Cloudflare R2 (10 GB free) | Create bucket + private ACL; keys to backend only | ₦0–3,000/mo |
| **WhatsApp Business (optional)** | Notifications on WhatsApp | Meta Cloud API free conversations tier | Business verification with Meta takes days–weeks | deferred |
| **Domain + TLS** | Public HTTPS | — | Buy domain; TLS via Let's Encrypt (free) | ~₦12,000/yr |
| **VPS** | Hosting API + Postgres + Redis | Local dev in this sandbox | 2 vCPU/4 GB (Hetzner/DigitalOcean/AWS Lightsail) | ~₦15,000–40,000/mo |
| **Sentry (optional)** | Error monitoring | Free tier | DSN into env | ₦0 |

**First-run mode:** until real keys exist, `PAYMENTS_MODE=DEVELOPMENT`, `SMS_MODE=CONSOLE`, `EMAIL_MODE=CONSOLE`, `MAPS_PROVIDER=STUB`. Everything still writes to the real database; the UI shows a permanent amber **"DEVELOPMENT MODE — no real money or messages"** banner. Mock payments are produced only by a backend-only simulator endpoint guarded by `NODE_ENV !== 'production'` — never by the frontend claiming success.

---

## 10. Estimated complexity and major risks

### Complexity rating
| Area | Complexity | Why |
|---|---|---|
| CRUD + dashboards | ●●○○○ Medium | Volume of screens, not difficulty |
| Pricing engine | ●●●○○ Medium-high | Must be exact integer math, snapshot-based, testable |
| Dispatch engine | ●●●●○ High | Concurrency: two riders, one job; timers; fairness |
| Payments + ledger | ●●●●● Very high | Idempotency, webhooks, double-entry, payouts |
| Realtime tracking | ●●●●○ High | Socket auth, rooms, battery, flaky Nigerian mobile networks |
| RBAC + audit | ●●●○○ Medium-high | Many endpoints × many roles; easy to miss a check |
| Multi-branch readiness | ●●○○○ Medium | Cheap if done in Phase 1, expensive if retrofitted |

### Top risks and mitigations

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | **Wrong money math** (floats, double credits, double withdrawal) | Business-destroying | Integer kobo only; unique `idempotencyKey`s; DB `CHECK (balance >= 0)`; ledger must balance; nightly integrity job; explicit tests for replay attacks |
| R2 | **Duplicate/late webhooks** | Double crediting | `payment_webhooks(provider, eventId)` unique; re-verify with provider; state-check before posting (`PENDING → SUCCESS` only) |
| R3 | **Scope too large to finish** | Project stalls | 10 phases, each shippable; you can go live after Phase 7 with the core business working; later phases add leverage, not dependency |
| R4 | **WhatsApp/Meta verification delays, SMS sender-ID approval** | Notifications blocked | Email + in-app + console in dev; SMS provider approval started in Phase 1, not Phase 8 |
| R5 | **Maps API cost blow-up** | Unexpected bills | Server-side geocoding with caching (address→coords cached), key restrictions, per-IP quotas, session tokens for autocomplete, hard spend alert |
| R6 | **Payment provider compliance** (Paystack requires CAC/business docs + settlement account for live mode) | Cannot accept real money | Start CAC/business registration and settlement account now; build against sandbox; separate go-live checklist |
| R7 | **Wallet regulatory exposure** — holding customer funds can edge toward CBN e-money rules | Legal | Launch wallet as *prepaid credit for our services only* (no cash-out to customers) via provider-held funds; rider payouts via Paystack Transfers (provider is the licensed party). Legal review before enabling customer cash-out |
| R8 | **Location privacy (NDPA 2023)** | Legal/reputational | Consent capture, purpose limitation, GPS only while `ONLINE`/on active delivery, retention purge job, signed URLs for documents, no location in share links, documented in SECURITY.md |
| R9 | **Rider fraud / collusion** (fake deliveries, POD abuse) | Revenue loss | OTP to recipient, geo-stamped POD, GPS trail plausibility check, earnings hold (T+1) before withdrawal, anomaly alerts to admins |
| R10 | **Flaky mobile networks / GPS denial** | Broken UX for riders | Offline-tolerant rider UI (queue transitions, retry), HTTP fallback for GPS, optimistic UI with reconciliation, cached "last known" location clearly labelled |
| R11 | **Device clock/OTP clock skew** | False OTP failures | Server-side expiry only, generous window, attempt caps + lockout |
| R12 | **Single-city assumptions leaking into code** | Costly multi-city retrofit | `branchId`/`serviceZoneId` on every operational row from day one; no hardcoded Lagos logic outside seed data |
| R13 | **Credential leakage** | Catastrophic | Backend-only secrets, `.env` git-ignored, `config` validation at boot, no secret in frontend bundle (verified by a test that greps the built assets for key patterns) |

### Deliberate non-goals for v1 (so you know what you're *not* paying for)
No multi-company marketplace, no customer app store binaries (PWA instead), no PostGIS until volume demands it, no driver-dispatch auto-routing optimisation (we score, we don't solve VRP), no customer wallet cash-out, no live chat widget (ticketed support instead).

---

## 11. Decisions I need from you before Phase 1

1. **Map provider** — Google Maps (best Nigerian address coverage & autocomplete, needs a card) vs Mapbox (generous free tier, cheaper at scale, slightly weaker local POIs). My recommendation: **Google Maps for launch**, geocoding cached server-side.
2. **Launch scope** — I recommend **one branch, Lagos, 3 service zones**. Confirm, or give me your real city/zone list and base fee + per-km numbers (or approve placeholders you can edit in the admin UI).
3. **Wallet policy at launch** — customer wallet top-up enabled, but **cash-out disabled** (recommended), rider payouts via Paystack Transfers.
4. **Branding** — business name, primary brand colour, and whether you already have a logo. Otherwise I'll ship a neutral professional palette (deep navy + logistics green) with a placeholder mark you can swap.
5. **Provider keys** — do you have Paystack/Flutterwave accounts yet? If not, we build in `DEVELOPMENT` mode (real DB, simulated payments) and flip to sandbox/live when keys arrive.

---

## 12. What happens when you approve

Phase 1 will install PostgreSQL 17 and Redis 8 in this environment, scaffold the workspace, write the real Prisma schema with migrations, seed the permission matrix and ledger accounts, bring up a NestJS API with `/health`, and stand up the React design-system styleguide — then run the first test suite and report back with exact commands and file locations.

**No application code has been written yet. Awaiting your approval.**
