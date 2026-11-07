# Pricing worksheet — fill this in and send it back

> **Why a worksheet.** Prices are **data**, not code. They live in a `PricingRule` row and are entered
> through **Admin → Pricing** at Stage 7 of the deployment roadmap. Nothing here requires a deploy, and
> changing a fare later is an admin action that is audited, not a release.
>
> Fill in the tables below (or answer the same questions in chat) and I will tell you exactly what to
> click — and flag anything that will produce a surprising price at the edges.

---

## 1. How the platform actually calculates a price

Reproduced from `backend/src/pricing/pricing.service.ts`, so you are pricing against the real model:

```
chargeableKm = round( max(0, distanceKm − freeKmIncluded), 2 )

tripRaw      = baseFee + (chargeableKm × perKmFee) + (additionalStopFee × stops)
tripFloor    = max(tripRaw, minFee)              ← the floor protects short trips
subtotal     = roundTo(tripFloor + typeSurcharge, roundToKobo)
total        = subtotal − promo
```

Three things worth noticing, because they are where tariffs usually go wrong:

- **There is no per-minute component.** The clock only matters as a **waiting fee** (per minute, applied
  while the rider waits at the destination). If your current tariff sheet is "base + per km + per minute",
  the per-minute part has to become either the waiting fee or extra per-km — tell me which you intend.
- **`freeKmIncluded` is subtracted before distance is charged.** 2 free km at ₦130/km is a ₦260 discount on
  *every* trip, which is worth knowing before you set it.
- **`roundToKobo` rounds once, on the customer's total.** Default ₦0.50, so prices end in `.00` or `.50`.

Zones are matched on **pickup and destination**. If both ends sit in the same zone, that zone's rule
applies. Rule precedence: zone-specific → branch default → global default.

---

## 2. Zones

List each zone you actually operate in. Start with the ones that will carry 80% of the work; you can add
the rest later without a deploy.

| # | Zone code | Zone name | Areas / LGAs it covers | Rule (see §3) |
|---|---|---|---|---|
| 1 | e.g. `LAG-ISL` | Lagos Island | Lagos Island, Ikoyi, Victoria Island | A |
| 2 | e.g. `LAG-MAIN` | Mainland | Yaba, Surulere, Ikeja, Gbagada | A |
| 3 | e.g. `LEK-AJK` | Lekki–Ajah | Lekki Phase 1, Ajah, Sangotedo | B |
| 4 | | | | |
| 5 | | | | |

*Are the boundaries a simple list of areas (good enough) or do you have polygons? A list of areas is what
the platform uses for matching today; polygons can come later.*

## 3. Fares — one column per rule, not per zone

Most operators need two or three rules, not one per zone. The seeded defaults are shown so you can see
the shape; replace them with your numbers.

| Field | What it means | Seeded default | **Your figure** |
|---|---|---|---|
| `baseFee` | paid the moment a rider accepts, before distance | ₦1,500 | |
| `perKmFee` | charged per km **after** the free km | ₦130 | |
| `minFee` | floor on base + distance + stops | ₦1,500 | |
| `freeKmIncluded` | km included in the base fee | 2 km | |
| `expressSurcharge` | added for express | ₦700 | |
| `scheduledSurcharge` | added for a scheduled (future) pickup | ₦0 | |
| `sameDaySurcharge` | added for same-day scheduling | ₦0 | |
| `waitingFeePerMin` | charged when the rider waits at the destination | ₦0 | |
| `additionalStopFee` | per extra stop (max 3) | ₦0 | |
| `defaultCommissionPct` | the platform's share of the delivery charge | 20% | |
| `roundToKobo` | rounding step on the final total | ₦0.50 | |

Copy this table once per distinct rule (e.g. "Rule A — Mainland", "Rule B — Lekki/Ajah").

## 4. Two check prices, please

Answer these two by hand — they become the acceptance test at Stage 7, and they catch a wrong field
immediately.

1. A **short** trip: 3 km, standard, no extra stops. What should the customer pay? **₦______**
2. A **typical** trip: 12 km, express, 1 extra stop. What should the customer pay? **₦______**

With the seeded defaults those come to:

| Trip | Working | Total |
|---|---|---|
| 3 km standard | base 1,500 + (3 − 2 free km) × 130 = 1,630 → floor 1,500 → 1,630 | **₦1,630.00** |
| 12 km express, 1 stop | base 1,500 + (12 − 2) × 130 = 2,800; +700 express = 3,500 | **₦3,500.00** |

If your numbers produce something you would not charge a customer, that is exactly what this worksheet is
for — better now than on a live quote page.

## 5. Rider economics, so the commission is a decision not an accident

| Question | Your answer |
|---|---|
| Is commission a **percentage of the delivery charge** (current model) or a fixed fee per job? | |
| Does the rider keep the express surcharge, or does the platform? | (current model: split by the same %) |
| How long should earnings sit **PENDING** before a rider can withdraw? (`EARNINGS_HOLD_HOURS`, default 24 h) | |
| Minimum withdrawal amount? | |
| Who approves withdrawals — one person, or two? | |

> The current model gives the rider `charge × (1 − commission)` and holds it for the hold window before it
> becomes withdrawable. If your riders are paid a fixed amount per delivery regardless of distance, say so
> — that is a real change to the earnings code, not a setting, and I would rather know before Stage 7.

---

## What I need back

Minimum: **§3 figures for one rule**, **§2 zones**, and **§4's two check prices**. Everything else can
follow.
