# Getting the real credentials (and where they go)

**Short answer: no accounts were created for you, and none exist.**

Everything in this platform was built against *sandbox and simulated* integrations. I cannot sign up for
services, agree to anyone's terms of service, or hold a payment method — so no Paystack, Flutterwave, Google
Maps, Termii or Resend account was ever created from this build. What exists instead is a working adapter for
each one, sitting one environment variable away from going live:

| Service | Current mode | Goes live when you set |
|---|---|---|
| Paystack | `PAYMENTS_MODE=DEVELOPMENT` (simulator) | `PAYMENTS_MODE=SANDBOX` (or `LIVE`) + `PAYSTACK_*` keys |
| Flutterwave | same | `FLUTTERWAVE_*` keys |
| Maps | `MAPS_PROVIDER=STUB` (real Benin City coordinates, straight-line distances) | `MAPS_PROVIDER=GEOAPIFY` + `GEOAPIFY_API_KEY` + `VITE_GEOAPIFY_API_KEY` (recommended, no card) or `GOOGLE` + `GOOGLE_MAPS_API_KEY` |
| SMS | `SMS_MODE=CONSOLE` (printed to the API log) | `SMS_MODE=TERMII` + `TERMII_API_KEY` + approved sender ID |
| Email | `EMAIL_MODE=CONSOLE` | `EMAIL_MODE=RESEND` + `RESEND_API_KEY` + verified domain |

**If you already hold keys from your own accounts, nothing needs rebuilding.** Paste them into
`backend/.env` (never into a file that gets committed, never into the frontend), restart the API, and the
same code switches to the real provider. If you do not hold them yet, the table below is exactly what to
create and which value to copy.

---

## Where every credential lives

All secrets live in **one file**: `backend/.env`. That file is git-ignored, is never sent to the browser, and
is the only place the API reads them from. The template at the repository root — `.env.example` — documents
every variable name with placeholders.

```
cp .env.example backend/.env      # create your own file from the template
backend/.env                      ← the only place secrets belong (git-ignored)
.env.example                      ← the template you commit, placeholders only
```

The API reads `.env` from its working directory and falls back to the repository root (`envFilePath:
['.env', '../.env']` in `app.module.ts`), so either location works — `backend/.env` is the convention.

---

## 1. Paystack — card, bank transfer, USSD, rider payouts

**What we use it for:** customer payments (`/payments/...`), the settlement webhook, rider withdrawal
transfers, refunds.

**How to get the keys**

1. Sign up at <https://paystack.com> (test mode needs no business documents).
2. In the dashboard go to **Settings → API Keys & Webhooks**.
3. Copy **Test Secret Key** (`sk_test_…`) and **Test Public Key** (`pk_test_…`).
   Live keys (`sk_live_…` / `pk_live_…`) appear only after business/KYC activation.
4. Webhook URL — set it to `https://<your-api-domain>/api/v1/webhooks/payments/paystack`
   (test and live URLs are separate fields). There is **no separate webhook secret**: Paystack signs every
   request with your secret key, and `src/payments/payment-providers.ts` verifies that HMAC-SHA512 against the
   raw body.

```dotenv
PAYMENTS_MODE=SANDBOX
PAYSTACK_SECRET_KEY="sk_test_xxxxxxxxxxxxxxxxxxxxx"
PAYSTACK_PUBLIC_KEY="pk_test_xxxxxxxxxxxxxxxxxxxxx"
```

**Safety rules already built in:** secret key server-side only; the frontend receives only the public key;
webhooks are signature-checked, deduped on `(provider, eventId)`, and every payment is re-verified at the
provider before a kobo is credited. Test cards: `4084 0840 8408 4081`, any future expiry, CVV `408`, PIN
`0000`, OTP `123456`.

**Cost:** 1.5% + ₦100 per local card charge (capped ₦2,000); transfers ≈ ₦10–₦50 each. Test mode is free.

---

## 2. Flutterwave — the second rail

1. Sign up at <https://dashboard.flutterwave.com> (sandbox/test keys are immediate).
2. **Settings → API Keys** → copy **Secret key** and **Public key**.
3. **Settings → Webhooks** → set the URL to
   `https://<your-api-domain>/api/v1/webhooks/payments/flutterwave` and set a **secret hash**.
4. Copy that same secret hash into `FLUTTERWAVE_WEBHOOK_HASH` — that is what
   `verif-hash` is compared against.

```dotenv
FLUTTERWAVE_SECRET_KEY="FLWSECK_TEST-xxxxxxxxxxxx"
FLUTTERWAVE_PUBLIC_KEY="FLWPUBK_TEST-xxxxxxxxxxxx"
FLUTTERWAVE_WEBHOOK_HASH="the-hash-you-typed-in-the-dashboard"
```

**Cost:** ≈1.4% local cards.

---

## 3. Maps — addresses, routes, distance, ETA, live map (Phase 8)

**What we use it for:** address autocomplete, geocoding of pickup/drop-off, road distance instead of
straight-line, ETA, and the customer/admin map.

**Pick one provider.** `MAPS_PROVIDER` decides; the rest of the codebase does not care. The
recommendation is **Geoapify**, because it needs no card and one key covers suggestions, geocoding,
routing *and* the map tiles. Google is supported too if you already have a billing-enabled Cloud
project.

### 3a. Geoapify (recommended)

1. Sign up at <https://myprojects.geoapify.com/register> — an email form, **no card, no billing
   screen**.
2. Create a project, then an **API key** (the free plan is 3,000 credits a day, up to 5 requests a
   second, commercial use allowed with attribution).
3. Put the same key in both places — it is a single key, not two:

   ```dotenv
   # backend
   MAPS_PROVIDER=GEOAPIFY
   GEOAPIFY_API_KEY=your-geoapify-key

   # frontend (build-time: rebuild the web image after setting it)
   VITE_GEOAPIFY_API_KEY=your-geoapify-key
   ```

4. Optional but recommended: `MAPS_SEARCH_BIAS` is the `lon,lat` that suggestions are ranked
   around. It defaults to Ring Road, Benin City (`5.6222,6.3329`). Change it if you ever
   operate from another city — it is what stops "ring" answering with Ring Road, Lagos.

5. What a booking costs against the 3,000 daily credits: **1** for the route, **1** if the customer's
   typed address has to be geocoded, and **0.25 per map tile** (a typical map view is 20–30 tiles, so
   roughly 5–8 credits). That is several hundred map views plus thousands of bookings a day.
6. The free plan requires the **"Powered by Geoapify"** attribution and OpenStreetMap credit — the
   map component renders both automatically; do not remove them.

**Coverage, measured:** OpenStreetMap has Benin City's roads (Ring Road → Ugbowo routes as 10.6 km),
but many Benin City streets are unnamed in it and informal landmarks are absent. That is why the
booking form leads with the platform's own saved locations — keep that list maintained and the
provider only has to handle the long tail.

### 3b. Google Maps (if you already have a Cloud project)

1. Sign in at <https://console.cloud.google.com> → create (or pick) a project.
2. **APIs & Services → Library** → enable **exactly these four**, and nothing else:

   | API | Used for | Called from |
   | --- | --- | --- |
   | **Maps JavaScript API** | the live map in the customer, rider and admin portals | browser |
   | **Places API (New)** | address suggestions and place coordinates | server |
   | **Routes API** | road distance and ETA | server |
   | **Geocoding API** | written address ↔ coordinates | server |

   > **Do not look for "Places API", "Directions API" or "Distance Matrix API".**
   > Google ended their sale on **5 October 2026**: a newly created Cloud project cannot enable them.
   > The current services above are their replacements — Places API (New) covers autocomplete and
   > place details, and Routes API covers what Directions and Distance Matrix used to do. The code in
   > `backend/src/pricing/maps.service.ts` already talks to the new ones.

3. **Billing** → attach a billing account. Required even to use the free tier.
4. **APIs & Services → Credentials → Create credentials → API key**. Create **two keys**:
   * a **browser key** restricted by HTTP referrer (`https://your-domain.com/*`, `http://localhost:5173/*`)
     and limited to **Maps JavaScript API** only;
   * a **server key** restricted by IP (your Northflank/VPS egress IP), limited to
     **Places API (New)**, **Routes API** and **Geocoding API**.
5. Paste the server key into `GOOGLE_MAPS_API_KEY`, and give the browser key to the frontend
   (`VITE_GOOGLE_MAPS_API_KEY`, a **build-time** variable — the web image must be rebuilt after you set it).

**If you enable the wrong set**, nothing breaks loudly: the API logs (this line, and the Geoapify
equivalent, is the same signal — a key that is missing, restricted too tightly, or pointed at an API
that is not enabled):
`Routes API failed, falling back to the stub estimate: Routes responded 403` (or the same line for
Places) and keeps pricing with the stub model. That warning in the logs is the signal that a key is
missing, restricted too tightly, or pointed at an API that is not enabled.

```dotenv
MAPS_PROVIDER=GOOGLE
GOOGLE_MAPS_API_KEY="AIza... server key, IP-restricted"
```

**Cost (2026 reality):** the old pooled **$200/month credit no longer exists** — Google replaced it in
March 2025 with a *per-SKU* monthly free allowance: **10,000 free events per Essentials SKU** (Dynamic Maps,
Geocoding, Autocomplete, Compute Routes) and 5,000/1,000 for Pro/Enterprise SKUs
([maps.guru](https://maps.guru/blog/google-maps-api-pricing-explained-2026), [mapatlas.eu](https://mapatlas.eu/blog/google-maps-api-pricing-2026)).
Above that, roughly **$5 per 1,000** Essentials events at Tier 1. For a Benin City operation doing a few hundred
deliveries a day, the free allowances typically cover the whole month — a booking costs one Geocoding call,
one Compute Routes call and one map load.

**Until then:** `MAPS_PROVIDER=STUB` uses real Benin City coordinates and haversine distance, so pricing,
dispatch radii and ETAs are all computed honestly — they are simply not road-accurate yet. Nothing is faked.

---

## 4. SMS — Termii (Nigeria)

Used for OTPs and rider offer alerts (the SMS fallback behind the socket).

1. Sign up at <https://termii.com>.
2. **API Keys** → copy into `TERMII_API_KEY`.
3. Request a **sender ID** (e.g. `DispX`). Approval is required before production traffic — this is the one
   step that can take a few days, so start it early.
4. Set `TERMII_SENDER_ID` to the approved value.
5. **Ask Termii support to enable the DND (transactional) route on your account**, in writing. The
   `generic` route is for promotional traffic: it is refused for OTPs, it does not reach numbers with
   do-not-disturb active, and MTN blocks it between 20:00 and 08:00. Without the DND route, OTP delivery
   is unreliable no matter how correct your key is.

```dotenv
SMS_MODE=TERMII
TERMII_API_KEY="TL..."
TERMII_SENDER_ID="DispX"
TERMII_CHANNEL=dnd          # dnd (transactional, needed for OTP) | generic
```

**How to tell it is on:** `GET /api/v1/health` → `integrations.sms` reads `TERMII` when the key is
present and `TERMII_NO_KEY` when the mode is set but the key is empty — the state that looks configured
and sends nothing. The full walk-through is in [MESSAGES-AND-CALLS.md](MESSAGES-AND-CALLS.md).

**Cost:** ~₦3.5–₦5 per message. Until then `SMS_MODE=CONSOLE` writes every message to the API log, which is
why the dev OTP/`devCode` flow works end to end without an SMS bill — but it sends nothing, and the
verification screen now says so rather than claiming a code went out.

---

## 4b. Calls — in-app (working) or masked numbers (needs their support)

**In-app calling is on by default** (`VOICE_MODE=IN_APP`): the customer and the rider talk inside the
app, browser to browser. No phone number exists on either side, so the "never reveal a number" rule
holds by construction, and the line closes with the delivery.

```dotenv
VOICE_MODE=IN_APP           # IN_APP | CONSOLE | TERMII
```

To make a **real handset ring** instead, you need Termii's **number masking** product: KYC documents, a
rented pool of numbers and per-minute billing, activated by their support team (it is not self-serve).
When that account exists, set `VOICE_MODE=TERMII` and implement `requestCall()` in
`backend/src/messaging/voice.service.ts` — that one method is the whole adapter. See
[MESSAGES-AND-CALLS.md](MESSAGES-AND-CALLS.md#phone-to-phone-with-a-proxy-number-voice_modetermii-not-connected).

---

## 5. Email — Resend

Verification links, receipts, report delivery.

0. You need a domain you own — `traderswelfarelogistics.online` is the one. The
   step-by-step for both the site and email lives in [CUSTOM-DOMAIN.md](CUSTOM-DOMAIN.md).
1. Sign up at <https://resend.com> (3,000 emails/month free).
2. **Domains → Add domain**, then add the DNS records it gives you (SPF/DKIM). Verification is usually
   minutes once DNS propagates.
3. **API Keys → Create** → `RESEND_API_KEY`; set `EMAIL_FROM` to an address on that domain.

```dotenv
EMAIL_MODE=RESEND
RESEND_API_KEY="re_..."
EMAIL_FROM="Traders Welfare Logistics <no-reply@traderswelfarelogistics.online>"
```

Also add a `_dmarc` TXT record (`v=DMARC1; p=none; rua=mailto:dmarc@…`). Without it a
domain with no sending history lands in spam far more often — see
[CUSTOM-DOMAIN.md](CUSTOM-DOMAIN.md) §2c.

---

## 6. Object storage (only when you leave local disk)

ID documents, proof-of-delivery photos and avatars are currently written to `backend/storage` by
`STORAGE_DRIVER=LOCAL`. For production, Cloudflare R2 (10 GB free) or Cloudinary:

```dotenv
STORAGE_DRIVER=S3
S3_BUCKET="dispatch-private"
S3_REGION="auto"
S3_ENDPOINT="https://<account-id>.r2.cloudflarestorage.com"
S3_ACCESS_KEY_ID="..."
S3_SECRET_ACCESS_KEY="..."
```

(Phase 10 finishes the S3 driver; the local driver already streams files through an authenticated endpoint,
so documents are never publicly guessable.)

---

## 7. What you must do, in order

| # | Action | Why it is first |
|---|---|---|
| 1 | Create Paystack + Flutterwave, copy **test** keys into `backend/.env` | Unblocks real payment flows with zero risk |
| 2 | Set the provider webhook URLs to `…/api/v1/webhooks/payments/{paystack,flutterwave}` | Webhooks are how money becomes real; without them only browser-verify works |
| 3 | Create the Google Cloud project, enable the four APIs, make two restricted keys | Phase 8 needs the server key |
| 4 | Start the Termii sender-ID approval | It has the longest lead time |
| 5 | Add and verify your email domain at Resend | Needed before real users register |
| 6 | Only after everything is tested: switch `PAYMENTS_MODE=LIVE` with live keys | Live keys move real money |

**After changing any value:** restart the API (`npm run dev --workspace @dispatch/api`) and check
`GET /api/v1/health` — it reports the live integration modes:
`{"integrations":{"payments":"SANDBOX","maps":"GEOAPIFY","sms":"TERMII","email":"RESEND"}}` —
`TERMII_NO_KEY` / `RESEND_NO_KEY` mean the mode is selected but the key is missing.

---

## 8. Rules this project will keep

* **No secret ever reaches the browser.** Only public keys do (`pk_…`, the Maps *browser* key).
* **No secret in git.** `backend/.env` is ignored; the root `.env.example` carries names only.
* **No secret in a chat, a screenshot, or a support ticket.** If one is exposed, rotate it in the provider
  dashboard — the code needs no change.
* **Sandbox before live, always.** Live mode is a deliberate one-line change, never a default.
* **The DEVELOPMENT banner stays honest.** With `PAYMENTS_MODE=DEVELOPMENT` the UI says payments are
  simulated, and the simulator endpoint refuses to run in production.
