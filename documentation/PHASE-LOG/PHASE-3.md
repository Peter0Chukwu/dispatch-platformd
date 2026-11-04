# Phase 3 — Booking, pricing engine and the customer delivery API

**Date completed:** 4 November 2026
**Status:** ✅ Complete — 102 automated tests passing (41 new), full booking journey verified in a real browser.

---

## 1. The one rule that shaped this phase

> **The browser never sends a price.**

The customer's browser sends two coordinates. The server looks up the pricing rule, measures the
distance, applies every fee, applies any promotion, and returns a breakdown. When the customer
confirms, the server **recalculates from scratch** — a quote is never trusted as a payment instruction.

Proof, from the test suite:

```
✓ charges exactly the quoted total and freezes the breakdown
✓ ignores a price sent by the client   ← body contained chargeKobo: 1, totalKobo: 1
```

That second test sends a booking claiming to cost ₦0.01. The stored charge is the real ₦4,341.

---

## 2. How a price is calculated

The order of operations is deliberate — each step is a business decision, not a formula:

```
1. Zone        Which service zone contains the pickup? (nearest centre, max 60 km)
                 → zone rule, or branch rule, or global rule (highest version wins)
2. Distance    Haversine between the two coordinates × 1.35 road factor
                 (Lagos roads are not straight lines; a bridge is never free)
3. Base fee    Flat fee from the rule
4. Distance    (distance − freeKmIncluded) × perKmFee
5. Stops       additionalStopFee × extra stops
6. Minimum     base + distance + stops is raised to minFeeKobo if it falls short
                 ↳ applied to the TRIP, before surcharges, so the floor
                   protects the trip and never hides a surcharge
7. Surcharge   express / same-day / scheduled, added on top of the floor
8. Round       once, to the rule's roundToKobo (50 kobo), in integer arithmetic
9. Promo       percentage (capped), fixed amount, or free delivery
                 ↳ can make a delivery free, never negative
10. Freeze     the whole breakdown is written into deliveries.priceSnapshot
```

Every number is an integer number of **kobo** (`BigInt`). No floating-point naira anywhere in the
money path — `0.1 + 0.2` problems are impossible by construction.

### Where the numbers live

| Value | Location | Changed by |
|---|---|---|
| Base fee, per-km rate, surcharges, minimum, rounding | `pricing_rules` table | Seed now; admin Pricing screen in Phase 5 |
| Free kilometres included | `pricing_rules.freeKmIncluded` | same |
| Zone list & radii | `service_zones` table | same |
| Promotions and caps | `promotions` table | Admin screen in Phase 5 |
| Road detour factor | `src/pricing/distance.ts` (named constant) | a code change — it is a physical assumption, not a business setting |

**Your real figures are not in the code.** When you send the city, zones, base fee and per-km rate,
they replace the placeholder rows in `prisma/seed-data/zones.ts` and every future quote uses them
immediately — no code change, no deploy.

---

## 3. Files created

**Backend**
```
src/pricing/distance.ts            haversine, road factor, multi-stop totals (pure, 14 unit tests)
src/pricing/maps.service.ts        the ONLY place that measures routes; Google or stub
src/pricing/pricing.service.ts     rule resolution, fee assembly, breakdown, freezing
src/pricing/promotions.service.ts  promo validation: window, limits, min order, caps
src/pricing/pricing.module.ts
src/deliveries/deliveries.service.ts        booking, list, detail, cancel, summary
src/deliveries/deliveries.controller.ts     customer routes (CUSTOMER-only, ownership-scoped)
src/deliveries/deliveries.staff.controller.ts  staff routes (STAFF + delivery:read)
src/deliveries/deliveries.module.ts
test/pricing.math.spec.ts          14 tests — pure maths, no database
test/deliveries.e2e.spec.ts        27 tests — quotes, bookings, ownership, cancellation, promos
```

**Frontend**
```
src/lib/lagos-locations.ts              12 real Lagos locations with coordinates
src/hooks/useDeliveries.ts              quote, list, detail, create, cancel (TanStack Query)
src/components/PriceBreakdown.tsx       the server's breakdown, rendered verbatim
src/components/LocationPicker.tsx       searchable saved locations + manual address
src/pages/customer/BookDeliveryPage.tsx 4-step wizard with a live server price
src/pages/customer/DeliveriesPage.tsx   history with status filters and pagination
src/pages/customer/DeliveryDetailPage.tsx  detail, timeline, cancel with reason
src/pages/customer/nav.ts               shared customer navigation
```

**Modified**
```
src/app.module.ts                       PricingModule + DeliveriesModule
src/config/app.config.ts                mapsProviderKey, googleMapsApiKey accessors
src/common/errors/app-error.ts          3 new codes: DELIVERY_NOT_CANCELLABLE, PRICING_UNAVAILABLE, PROMO_INVALID
prisma/seed.ts                          now loads .env explicitly (see §7, bug 1)
frontend/App.tsx                        real routes replace the Phase 3 placeholders
frontend/pages/customer/CustomerHome.tsx real counters from /deliveries/summary
```

---

## 4. API endpoints added

| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/api/v1/deliveries/quote` | customer | 60/min — safe to call on every pin drag |
| POST | `/api/v1/deliveries` | customer | 10/min — creates the booking |
| GET | `/api/v1/deliveries` | customer | own deliveries, `?page`, `?status` |
| GET | `/api/v1/deliveries/summary` | customer | real counters for the dashboard |
| GET | `/api/v1/deliveries/:id` | customer | 404 if it is not yours |
| POST | `/api/v1/deliveries/:id/cancel` | customer | state-machine checked |
| GET | `/api/v1/staff/deliveries` | staff + `delivery:read` | every customer's deliveries |
| GET | `/api/v1/staff/deliveries/:id` | staff + `delivery:read` | includes the customer's name |

Ownership is enforced in the query (`where: { id, customerId }`), not by a post-fetch `if`.
Another customer's delivery returns **404, not 403** — a 403 would confirm the reference exists.

---

## 5. Testing

```bash
cd backend && npx vitest run     # 102 tests, 7 files
```

**41 new tests this phase.**

`pricing.math.spec.ts` (14) — no database, no HTTP:
- one degree of latitude is ~111.19 km (a property of the planet, independent of our code)
- distance is symmetric; a zero-length trip still reports 1 minute
- the road factor is actually applied
- multi-stop distance exceeds the direct route
- rounding is half-up to 50 kobo and never returns a negative
- percentages are exact (`10% of ₦1,234.56 → ₦123.50`), and 140% throws instead of silently pricing
- the minimum-fee floor works

`deliveries.e2e.spec.ts` (27) — real database:
| What | Result |
|---|---|
| Quote comes from the active rule row, not a constant | ✓ |
| `total = subtotal − discount`, exactly | ✓ |
| Express costs more than standard on the same trip | ✓ |
| A 50-metre trip still charges the minimum fee | ✓ |
| An Abuja pickup is refused with `field: "pickup"` | ✓ |
| Rider token → **403** on quote; no token → **401** | ✓ |
| Booking charges exactly the quoted total to the kobo | ✓ |
| A client-sent price is ignored | ✓ |
| Snapshot frozen with rule name, version and every line | ✓ |
| First timeline entry written by `CUSTOMER` | ✓ |
| The completion OTP hash never leaves the server | ✓ |
| Another customer's delivery → **404** | ✓ |
| Lists are scoped per customer | ✓ |
| Staff blocked from booking; customers blocked from staff routes | ✓ |
| Cancel records the reason, the user id and a timeline entry | ✓ |
| Second cancel → **409** `DELIVERY_NOT_CANCELLABLE` | ✓ |
| Cancel after pickup → **409** "already on the way" | ✓ |
| Promo percentage capped at its maximum; redemption recorded | ✓ |
| Same customer cannot reuse a promo | ✓ |
| Expired promo → **422** "expired"; unknown → generic message | ✓ |
| Free-delivery promo totals exactly ₦0, never negative | ✓ |

### Browser journey (`node scripts/capture-phase3.mjs`)

A real Chromium run: register → verify → log in → book through the 4-step wizard → land on the
delivery → see it in the list → dashboard counters change from 0 to 1 → cancel with a reason → status
becomes **Cancelled**. No console errors except the expected 401 from the anonymous session check.

---

## 6. What the customer sees

| Screen | What it proves |
|---|---|
| Dashboard | Counters come from `SUM`/`COUNT` in Postgres — zero before booking, real after |
| Booking step 1–2 | 12 real Lagos coordinates; distance is measured server-side |
| Booking step 3 | Delivery type changes the price; promo field validates against the database |
| Booking step 4 | The full breakdown, line by line, before confirming |
| Delivery detail | The **frozen** breakdown, so a later rule change cannot alter a past charge |
| Cancel | A reason is required and stored; the UI offers it only while the state machine allows |

---

## 7. Bugs found and fixed

1. **`npm run db:seed` failed from a clean shell** — `tsx` does not read `.env`, so `DATABASE_URL`
   was undefined and the CLI worked only by accident. The seed now imports `dotenv/config` and behaves
   identically however it is invoked. (Found because the sandbox reset emptied the database.)
2. **Cancel recorded the wrong user** — `deliveries.cancelledById` references `users.id`, but the
   service passed `customers.id`. Caught while writing the assertion `expect(row.cancelledById).toBe(customer.userId)`.
3. **The cancel dialog's textarea had no accessible label** — the Playwright run timed out on
   `getByLabel('Why are you cancelling?')`. A screen-reader user would have hit the same wall. Fixed by
   wiring `htmlFor`/`id`.
4. **`RateLimit` option names** (`limit` vs `points`) — type-checked, not guessed.
5. **Prisma's relation is `vehicles`, not `vehicle`** — a test fixture failed loudly rather than
   silently doing nothing.

---

## 8. Commands

```bash
npm run setup                       # fresh sandbox: services + install + migrate + seed
npm run dev                         # API :4000, web :5173
cd backend && npx vitest run        # 102 tests
node scripts/capture-phase3.mjs     # browser booking journey + screenshots
python3 scripts/build-report.py     # regenerate BUILD-REPORT.html
```

---

## 9. Known limitations

- **Google Maps is not connected.** Distances are haversine × 1.35, labelled "straight-line estimate"
  in the UI. `MAPS_PROVIDER=GOOGLE` + a key switches `MapsService` to real Directions with no other change.
- **Payment is not taken.** A booking is created `UNPAID`; the Paystack/Flutterwave/wallet flow is
  Phase 7. The UI says so instead of pretending.
- **No rider assignment yet** — a booking sits at `PENDING`. That is Phase 4.
- **Additional stops are priced but not yet collected** by the create endpoint (the quote accepts up to 3).
- **Cancelling a paid delivery logs that a refund is owed**, but does not issue it — refunds land with the
  payment module. This is deliberate: no fake refunds.
- **No promo is seeded.** The engine and its tests are complete, but inventing a discount code is a
  business decision — create one when you want one (admin screen in Phase 5, or a `promotions` row today).
- **Scheduled deliveries** are validated (15+ minutes ahead) and priced, but no scheduler dispatches them yet.

---

## 10. What Phase 4 will deliver

The rider portal, end to end: document upload and approval, going online/offline, the offer engine with
a 20-second countdown and redis locking, the full delivery workflow (arrive → pick up → in transit →
delivered with OTP or photo proof), earnings and commission, and rider tests including double-acceptance
races.
