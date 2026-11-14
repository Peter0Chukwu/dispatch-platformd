# Phase 8 — Maps, live tracking and realtime

> **Status:** complete · **Tests:** 237 passing (14 files, 23 new) · **Commit:** see `git log --oneline` for
> "Phase 8: maps, live tracking and realtime".

## What this phase is about

Every phase so far produced a *claim*: this delivery is priced at ₦4,894.50, this rider earned ₦3,915.50,
this wallet holds ₦27,555.50. Phase 8 adds the first claims that are about *the physical world* — where a
parcel is, when it will arrive, who is carrying it — and those are the easiest claims in software to fake.

So the phase was built around one rule, and the rule is enforced in code, not in a comment:

> **A position is only ever shown if a rider's device reported it.**

There is no interpolation, no "predicted position", no marker parked at the branch, no dashed line drawn
to a guess. When nothing has been reported the API returns `position: null` and the UI says so in words.
When a report is old, it is marked `stale: true` and drawn faded — the map never moves a rider to look
current. When a browser denies geolocation, the rider sees a banner explaining that dispatch cannot see
them, and **nothing is sent**.

The second rule is about who may look:

> **Coordinates are scoped.** A customer sees the rider carrying *their* delivery. A share-link viewer sees
> that one parcel and nothing else. A dispatcher needs `tracking:read`. Everything else is a 403 or a 404.

---

## 1. Maps: one adapter, three providers, no lying about accuracy

Address lookup, geocoding and routing all go through **`MapsService`** (`backend/src/pricing/maps.service.ts`),
which is the only file in the codebase that knows a maps provider exists.

| Capability | Google (when a key exists) | Stub (current default) |
|---|---|---|
| `autocomplete(query)` | Places API (New) — autocomplete + place details | 12 real Benin City locations, scored by term match |
| `geocode(address)` | Geocoding API, `components=country:NG` | nearest saved place, marked `approximate: true` |
| `reverseGeocode(lat, lng)` | Geocoding API | `Near <place> (±n km)` — honest about imprecision |
| `estimateRoute(from, to)` | Routes API (road distance, real duration) | haversine × road factor 1.35 at 22 km/h |

> **Updated 5 October 2026:** Google stopped selling the legacy **Places**, **Directions** and
> **Distance Matrix** APIs, so a Cloud project created today cannot enable them. The adapter now calls
> `places.googleapis.com/v1` and `routes.googleapis.com/directions/v2:computeRoutes`; Geocoding was not
> retired and is unchanged. Every request carries the `X-Goog-FieldMask` header the new APIs require.
> See `documentation/CREDENTIALS-SETUP.md` §3 for the four APIs to enable.

Two properties matter more than the provider choice:

* **The result declares its own source.** `PlaceResult.source` is `'STUB' | 'GOOGLE' | 'MAPBOX'`, and the
  booking form prints it: *"Suggestions from the platform's saved Benin City locations — exact coordinates, no
  street-level geocoding until a maps key is configured."* A customer is never invited to believe the stub
  is Google.
* **A provider outage cannot block a booking.** Every Google call is wrapped: on failure the service logs a
  warning and falls back to the stub, so a 500 from Mountain View does not stop a Benin City delivery from being
  priced. The `source` field then tells the truth about what was used.

Because the coordinates in the stub are the *same* ones pricing and dispatch use, distance, radius and ETA
arithmetic are real today; they simply are not road-accurate until `GOOGLE_MAPS_API_KEY` is set. See
[`documentation/CREDENTIALS-SETUP.md`](../CREDENTIALS-SETUP.md) §3 for the key walkthrough and the
post-March-2025 pricing reality.

### Public endpoints

```
GET /api/v1/maps/places?q=lekki      → { data: PlaceResult[], provider: 'stub' }
GET /api/v1/maps/geocode?address=…    → { data: GeocodeResult | null, provider }
GET /api/v1/maps/reverse?lat=…&lng=…  → { data: GeocodeResult | null, provider }
```

Public on purpose — the sign-up form needs suggestions before a token exists, and the answers contain no
private data. Rate-limited to 30/20 lookups a minute per IP, because each one can be a billed Google call.

---

## 2. Tracking: one write path, three readers

### Write path

`POST /rider/location` (rider-only, 120 pings/min) → `TrackingService.recordPing()`:

1. **Scopes the ping.** If the body names a `deliveryId`, it is attached only when *that rider* actually
   holds that job in an active status. Otherwise the nearest active job is used, or the ping is stored with
   `deliveryId: null` — a rider's position is always worth recording, but it is never attached to somebody
   else's delivery.
2. **Persists** to `rider_locations` (lat, lng, accuracy, speed, heading, battery, `recordedAt`).
3. **Pushes** `tracking:update` to the delivery room, the customer's room and the staff room.

`RidersService.ping()` now delegates here, so there is exactly one write path. A ping persists even when
the socket is down: the socket only decides how fast a map refreshes, never whether a position exists.

The cadence is configuration, served to the app: `GET /rider/location/config` →
`{ pingIntervalSeconds: 15, retentionDays: 30, staleAfterSeconds: 600 }`, read from
`TRACKING_PING_INTERVAL_SECONDS` / `LOCATION_RETENTION_DAYS`. The rider app's
`LocationReporter` uses `watchPosition` and re-uses the last fix between sends, so the GPS radio is not woken
on a timer.

### Readers

| Reader | Route | Sees |
|---|---|---|
| Customer | `GET /deliveries/:id/track` | own delivery only; 404 otherwise. Full rider name. |
| Share viewer | `GET /track/:token` | one parcel. Rider **first name only**, no phone, no customer identity. |
| Dispatcher | `GET /admin/tracking/live` | all positioned riders + live jobs. Requires `tracking:read`. |

All three are answered by one private `buildTracking()`, so they cannot drift apart. The payload:

```jsonc
{
  "delivery": { "reference", "status", "statusLabel", "pickupAddress", "destAddress",
                "pickup": {lat,lng}, "destination": {lat,lng}, "deliveredAt" },
  "rider":    { "riderCode", "name" },
  "position": { "lat", "lng", "accuracyM", "heading", "speedKph", "recordedAt", "ageSeconds" } | null,
  "live":     true,          // the job is underway (status), not a statement about data
  "stale":    false,         // last ping older than the 2-minute freshness window
  "eta":      { "minutes", "distanceRemainingKm", "source": "STUB|GOOGLE",
                "headingTo": "pickup|destination" } | null,
  "timeline": [ { "status", "label", "at", "reason" } ],
  "mapProvider": "stub"
}
```

**ETA follows the job, not the map.** Before collection the rider is measured to the *pickup*; after
`PICKED_UP` to the *destination* — measured from the rider's actual coordinates, never from the booking's
stored distance. `eta: null` when there is no position, or when the job is finished.

**Tracking stops at `DELIVERED`.** Once the parcel is handed over, `position` and `eta` become `null` even
for the owning customer: the job is over and the rider's location stops being anyone's business. `CANCELLED`
behaves the same way.

### Retention

`LocationRetentionScheduler` deletes pings older than `LOCATION_RETENTION_DAYS` (30) hourly, in one bounded
`deleteMany`. A rider pinging every 15 s produces ~5,760 rows a day; the *delivery*, its status history and
its timestamps survive — what is dropped is the breadcrumb trail, not the proof that the job happened.

---

## 3. Share links: a window, not a key

`POST /deliveries/:id/share-link` mints a 24-byte URL-safe token, stores it on the delivery
(`shareToken`, `shareTokenExpiresAt`) and returns `{ token, url, expiresAt, ttlHours }`. Default TTL is 72 h.

* **Revocable:** `POST /deliveries/:id/share-link/revoke` clears the token; the old URL 404s immediately.
* **Expiring:** an expired token returns **409 `CONFLICT`** with *"This tracking link has expired."* — not a
  404, because the link was real and the recipient deserves to know why it stopped.
* **Thin by construction:** the public payload has no `phone`, no `email`, no customer name, no order
  history. The E2E test asserts the serialised body contains neither `+234` nor the rider's phone nor the
  customer's email.
* **Not a session:** the token grants read access to one delivery's tracking and nothing else. There is no
  socket for share viewers — the public page polls every 15 s.

Frontend: `GET /track/:token` renders `TrackPage`, outside every auth guard: one page, the map, the ETA,
the status timeline, and the expiry date in the footer.

---

## 4. The dispatcher's map

`GET /admin/tracking/live` returns, in one payload: a summary block (riders online, on a delivery, active
deliveries, awaiting a rider, how many have a position), `riders[]` with position + `stale` flag + the job
they are carrying, and `deliveries[]` (PENDING and active, newest first, capped at 100) with their endpoints
and the assigned rider's last position.

Design decisions worth stating:

* **Only riders with a ping are drawn.** A rider who is online but has never reported is counted in the
  header ("1 of 1 online riders have a position") and is **absent from the map**.
* **Stale means faded.** A ping older than `freshnessWindowSeconds` (10 min) is drawn at 45% opacity with a
  "last seen" label. The marker is not moved.
* **Job endpoints are drawn; unassigned pins are not.** Without the pickup and drop-off a lone rider marker
  means nothing — you cannot tell where they are going. Pinning every one of a hundred pending addresses
  would bury the movement the dispatcher is looking for.
* **Every number comes from the payload that drew the markers**, so the counters and the map cannot disagree.

The map itself is `frontend/src/components/LiveMap.tsx`:

* with `VITE_GOOGLE_MAPS_API_KEY` set → real Maps JavaScript API, circle markers, dashed route polyline;
* without it → a **schematic**: every point plotted at its true lat/lng (longitude scaled by `cos(lat)` so
  east–west is not stretched), on a plain grid, with the caption *"positions are exact, the basemap is not"*.

That caption is the honest compromise. A schematic is not a street map, and nobody should be able to mistake
it for one.

---

## 5. Socket rooms: the room is the authorisation

`subscribe:delivery` was already refused to outsiders in Phase 6; Phase 8 leans on it for tracking and tests
it directly:

```
staff with delivery:read  → may join any delivery room
owning customer           → may join their own
assigned rider            → may join their own
anyone else               → { ok: false, error: 'FORBIDDEN' }, joins nothing
no principal              → { ok: false, error: 'UNAUTHORIZED' }
```

`RT.TRACKING_PING = 'tracking:update'` is the new event, carrying `{ deliveryId, riderId, lat, lng, status,
at }`. Clients treat it as *"something changed"* and invalidate their query — a dropped packet can never
leave a marker somewhere the rider is not, because the map's only source of truth is the REST answer.

---

## 6. Files

### Backend — new

| File | What it does |
|---|---|
| `src/pricing/maps-types.ts` | `PlaceResult` / `GeocodeResult` — the provider-agnostic shapes |
| `src/pricing/maps.service.ts` | **extended**: autocomplete, geocode, reverse geocode, stub place table, Google with fallback |
| `src/maps/maps.module.ts`, `src/maps/maps.controller.ts` | Public `/maps/*` lookup routes |
| `src/tracking/tracking.service.ts` | Ping write path, customer tracking, share links, public tracking, live map |
| `src/tracking/tracking.controller.ts` | Customer, public and admin tracking routes |
| `src/tracking/location-retention.scheduler.ts` | Hourly prune of old positions |
| `src/tracking/tracking.module.ts` | Wiring |

### Backend — changed

| File | Change |
|---|---|
| `src/riders/riders.service.ts` | `ping()` now delegates to `TrackingService.recordPing()` |
| `src/riders/riders.controller.ts` | `GET /rider/location/config` (cadence from config) |
| `src/realtime/realtime.types.ts` | `RT.TRACKING_PING` |
| `src/config/app.config.ts` | `trackingPingIntervalSeconds`, `locationRetentionDays`, `shareLinkTtlHours` |
| `src/app.module.ts` | `MapsModule`, `TrackingModule` |

### Frontend — new

| File | What it does |
|---|---|
| `src/hooks/useTracking.ts` | `useTracking`, `useShareLink`, `usePublicTracking`, `useLiveMap` |
| `src/components/LiveMap.tsx` | Google or schematic renderer; opt-in "show my location" |
| `src/components/DeliveryTrackingCard.tsx` | Customer live-tracking card + share-link controls |
| `src/components/LocationReporter.tsx` | Rider GPS reporting with denied/unavailable/failing states |
| `src/pages/TrackPage.tsx` | Public `/track/:token` page |
| `src/pages/admin/LiveMapPage.tsx` | Operations map with clickable markers and rider inspector |

### Frontend — changed

| File | Change |
|---|---|
| `src/components/LocationPicker.tsx` | Server-side suggestions, "Find coordinates", provider disclosure |
| `src/pages/customer/DeliveryDetailPage.tsx` | Tracking card; stale "arrives in Phase 8" copy removed |
| `src/pages/rider/{RiderHome,ActiveJobPage}.tsx` | Mount `LocationReporter` while online / on a job |
| `src/pages/admin/nav.ts`, `src/App.tsx` | Operations map route behind `tracking:read`; public `/track/:token` route |
| `src/lib/live.ts` | `TRACKING_PING`, `subscribeToDelivery()` |
| `src/pages/LandingPage.tsx`, `src/pages/customer/{CustomerHome,BookDeliveryPage}.tsx` | Stale phase copy replaced; hardcoded `₦0.00` wallet replaced with the real balance |

### Scripts and docs

| File | What it does |
|---|---|
| `scripts/seed-demo-phase8.mjs` | Books → pays → rider accepts → collects → drives, reporting 12 real pings |
| `scripts/capture-phase8.mjs` | 8 screenshots + 5 API checks through the real UI |
| `documentation/CREDENTIALS-SETUP.md` | How to obtain every third-party credential, and where each one goes |
| `documentation/PHASE-LOG/PHASE-8.md` | This file |

---

## 7. Routes added

```
GET    /api/v1/maps/places?q=                 public, 30/min per IP
GET    /api/v1/maps/geocode?address=          public, 20/min per IP
GET    /api/v1/maps/reverse?lat=&lng=         public, 20/min per IP
GET    /api/v1/deliveries/:id/track           CUSTOMER, own delivery
POST   /api/v1/deliveries/:id/share-link      CUSTOMER, own delivery
GET    /api/v1/deliveries/:id/share-link      CUSTOMER, re-reads/refreshes the link
POST   /api/v1/deliveries/:id/share-link/revoke  CUSTOMER, own delivery
GET    /api/v1/track/:token                   PUBLIC, no auth, expires
GET    /api/v1/admin/tracking/live            STAFF + tracking:read
GET    /api/v1/rider/location/config          RIDER
POST   /api/v1/rider/location                 RIDER, now writes through TrackingService
```

---

## 8. Tests — 23 new (`test/tracking.e2e.spec.ts`)

| # | Test | What it pins down |
|---|---|---|
| 1 | suggests real Benin City places and names the provider | suggestions carry real lat/lng and a declared source |
| 2 | returns nothing for a one-letter query | no guessing from noise |
| 3 | reverse geocodes a coordinate | stub answers are marked approximate |
| 4 | geocodes a written address server-side | "Yaba Commercial Avenue" → 6.5095 |
| 5 | stores the ping and attaches it to the held job | the write path is scoped correctly |
| 6 | ignores a `deliveryId` the rider does not hold | stored, but attached to nothing — no cross-customer leak |
| 7 | publishes the configured cadence | rider app reads interval from config |
| 8 | reports the rider's real position and an ETA | coordinates round-trip; ACCEPTED → ETA to *pickup* |
| 9 | 404 for a different customer | ownership, not obscurity |
| 10 | `position: null` before the first ping | no invented marker |
| 11 | stops at `DELIVERED` | position and ETA both null |
| 12 | share link works with no account, hides personal details | no `+234`, no email, first name only |
| 13 | share link dies on revoke | immediate 404 |
| 14 | expired link returns 409 | "expired", not "not found" |
| 15 | cannot mint a link for someone else's delivery | 404 |
| 16 | dispatcher map shows positioned riders and live jobs | marker coordinates + linked job |
| 17 | a 30-minute-old ping is `stale` | the map does not pretend it is fresh |
| 18 | support agent without `tracking:read` is refused | 403 |
| 19 | customer on an admin route is refused | 403 (portal separation) |
| 20 | owning customer may join the delivery room | joins `delivery:<id>` |
| 21 | non-owner socket gets `FORBIDDEN` | joins nothing |
| 22 | socket with no principal gets `UNAUTHORIZED` | — |
| 23 | retention prunes only pings past the window | old gone, fresh kept |

Run them alone: `cd backend && npx vitest run test/tracking.e2e.spec.ts` → **23 passed**.
Full suite: `npx vitest run` → **14 files / 237 tests**.

---

## 9. Screenshots (`documentation/screenshots/phase-8/`)

| File | What it shows |
|---|---|
| `01-address-suggestions.png` | "lekki" → two real matches, and a caption saying where they came from |
| `02-customer-live-tracking.png` | ~23 min / 8.4 km to the destination, rider mid-route, schematic labelled honestly |
| `03-customer-share-link.png` | the link created through the UI, with Copy and Revoke |
| `04-public-tracking.png` | the same delivery in a browser with no session — "In transit", "Rita" (first name), expiry in the footer |
| `05-admin-operations-map.png` | 0 online / 1 on delivery / 1 active / 1 awaiting, rider between pickup and drop-off |
| `06-admin-map-rider-focus.png` | clicking a rider: position 6.5432, 3.3876, reported 12:30:00, job link |
| `07-rider-sharing-position.png` | "Sharing your position · last report 12:28:09 · every 15 s" from a real browser geolocation |
| `08-rider-location-denied.png` | permission blocked → explicit banner, nothing sent, nothing drawn |

The capture run prints **5/5 API checks passing** and *"No console errors, no failed API calls."*

---

## 10. Bugs found and fixed during the phase

1. **`customerId` vs `userId` in scoping.** The first tracking query filtered
   `customer: { userId }` while the JWT carries `customerId` — every customer got a 404. Caught by the
   ownership test, which is why that test exists.
2. **`live` was computed from data, not status.** A job with no ping reported `live: false`, implying the
   delivery was not happening. Split: `live` = the job is underway; `position: null` = nothing reported yet.
3. **The public controller had no `@Public()`.** `GET /track/:token` returned 401 to the very people share
   links are for.
4. **Geolocation was requested on page load.** Every customer opening a delivery saw a permission dialog and,
   on decline, a scary banner. Now it is a deliberate "Show my location" click.
5. **Search results were padded with unrelated saved places.** A search for "lekki" appeared to offer
   Victoria Island. Server matches are now returned alone.
6. **A lone rider marker had no meaning on the ops map.** Job endpoints are now drawn, with a dashed line to
   the destination of the focused job.
7. **The seed cancelled a job that cannot be cancelled.** `IN_TRANSIT` is deliberately not cancellable, so
   the seed now *reuses* the job in progress instead — which is also the honest behaviour.
8. **Capture run hit the sign-in rate limiter.** The limiter works; the script now clears `ratelimit:*` keys
   first and uses a separate browser context per role instead of signing out.
9. **Stale copy removed:** "payment arrives in Phase 7" (two places), "Phase 3 adds the booking flow",
   "Phase 1 complete — next: authentication", and a hardcoded `₦0.00` wallet statistic on the customer home
   page that ignored the real balance.

## 11. Deferred, on purpose

* **Real tiles.** `MAPS_PROVIDER=STUB` until a Google key exists (see `CREDENTIALS-SETUP.md`). Everything
  that depends on maps — ETA, pricing distance, dispatch radius — is *already* wired to the adapter, so the
  switch is one environment variable and no code change.
* **Rider turn-by-turn navigation.** Deliberate: a phoneless routing UI is a separate product surface; the
  rider app shows the route, the addresses and the landmark. Phase 10 can add a "Navigate" deep link to the
  device's own maps app, which is what riders actually use.
* **Trail playback.** Positions are stored per delivery, so a breadcrumb replay is possible; it is not built
  because nobody has asked for it and it is the most privacy-sensitive thing on this list.
* **Notification centre** — still open from Phase 5, untouched here.
