# Google Maps — setting it up

This is the whole job, start to finish. It is mostly clicking in the Google Cloud
console; the code is already done and committed.

---

## 1. What changed in the code (read this first, it saves you a day)

Google **stopped selling three old APIs on 5 October 2026**:

| Retired | Replacement |
| --- | --- |
| Places API (old) | **Places API (New)** |
| Directions API | **Routes API** |
| Distance Matrix API | **Routes API** |

A Google Cloud project created **today** cannot switch the retired ones on at all —
the checkbox simply is not there, and a key minted for them returns
`LegacyApiNotActivatedMapError`.

So the backend now speaks only to what a new project can use:

* **Places API (New)** → `places.googleapis.com/v1/places:autocomplete`, then
  `places.googleapis.com/v1/places/{id}` for the coordinates
* **Routes API** → `routes.googleapis.com/directions/v2:computeRoutes`
* **Geocoding API** → unchanged (`maps.googleapis.com/maps/api/geocode/json`); it was not retired

If you follow an old tutorial that says "enable Places, Directions and Distance Matrix",
you will end up with a key that does not work. That is the single most common way this
step goes wrong.

**Nothing about the app's behaviour changes when the key arrives** — same suggestions,
same fares, same map. Only the numbers get road-accurate.

---

## 2. Enable exactly four APIs

1. Go to <https://console.cloud.google.com> and create a project (name it something you
   will recognise in a year, e.g. `traders-welfare-dispatch`).
2. **APIs & Services → Library**, search each of these and press **Enable**:

   | API | Search for exactly | What it does here |
   | --- | --- | --- |
   | Maps JavaScript API | `Maps JavaScript API` | draws the live map in the portals |
   | Places API (New) | `Places API (New)` — **note the "(New)"** | address suggestions |
   | Routes API | `Routes API` | road distance and ETA |
   | Geocoding API | `Geocoding API` | written address ↔ coordinates |

   That is all four. Do not enable more "just in case" — extra APIs are extra ways to
   be billed.

3. **Billing → attach a billing account.** Required, even on the free tier. A card is
   needed; there is no way around it.

---

## 3. Create two keys, not one

**APIs & Services → Credentials → Create credentials → API key.** Create two.

### Key A — the browser key

Used by the map component, so it is visible in the page source. Lock it down:

* **Application restrictions:** HTTP referrers
  * `https://your-domain.com/*`
  * `http://localhost:5173/*` (only while testing on your machine)
* **API restrictions:** *Maps JavaScript API* only.

### Key B — the server key

Used by the backend. It never reaches a browser.

* **Application restrictions:** IP addresses → your server's egress IP
  (Northflank tells you the outbound IP; on a VPS it is the VPS's own IP).
* **API restrictions:** *Places API (New)*, *Routes API*, *Geocoding API*.

> If you are on Northflank's free tier and cannot find a stable egress IP, you can leave
> Key B unrestricted **only while testing**, then restrict it before real customers.
> A leaked unrestricted key is somebody else's free Google Maps usage on your card.

---

## 4. Put the keys in the right places

**Backend** (Northflank → `twl-frontend` service → Environment, or `backend/.env` locally):

```dotenv
MAPS_PROVIDER=GOOGLE
GOOGLE_MAPS_API_KEY=AIza...your-server-key...
```

Type it bare — no quotes, no trailing space. Quotes pasted from Notepad become part of
the value and the key silently fails.

**Frontend** (Northflank → the web service → Environment):

```dotenv
VITE_GOOGLE_MAPS_API_KEY=AIza...your-browser-key...
```

`VITE_` variables are baked in at **build time**, not read at run time. After adding it
you must **rebuild/redeploy the web service**, otherwise the map keeps using the plain
fallback drawing. This is the second most common way this step appears to fail.

**Locally**, same two files: `backend/.env` and `frontend/.env`.

---

## 5. Check that it actually worked

**a. The API's own report.** Open `https://<your-api-host>/api/v1` in a browser (or
`http://localhost:4000/api/v1`). The small status block lists `maps:` — it should now
read `GOOGLE` instead of `STUB`.

**b. Address suggestions.** On the booking form type `ring road`. The line under the
suggestions should read *"Address suggestions by Google."* instead of *"Popular Benin
City locations."* Pick a suggestion and confirm the fare appears — that means the
coordinates came back.

**c. The route.** A fare's breakdown should show a distance that matches what Google
Maps gives you for the same two points, give or take a few hundred metres. The tracking
card labels the ETA *"Road route"* rather than *"Estimated route"*.

**d. Logs.** If something is wrong, the backend log says exactly which call failed:

```
[MapsService] Routes API failed, falling back to the stub estimate: Routes responded 403
[MapsService] Google autocomplete failed, falling back to local places: Places autocomplete responded 403
```

`403` = key restrictions do not include that API, or the API is not enabled.
`400` on Places = the field mask or the request shape, i.e. the old endpoint; check you
enabled *Places API (New)* and not something else.

---

## 6. What it costs

Google replaced the old pooled $200/month credit in March 2025 with a per-SKU monthly
free allowance — roughly **10,000 free events a month** for the Essentials SKUs we use
(Dynamic Maps, Geocoding, Autocomplete, Compute Routes). One booking costs one
Compute Routes call, usually one Geocoding call, and one map load.

A Benin City operation doing a few hundred deliveries a day sits inside the free
allowance. Above it, roughly $5 per 1,000 events. **Set a budget alert** in
**Billing → Budgets & alerts** at, say, $10, so a mistake tells you instead of surprising
you at month end.

---

## 7. If you would rather not do this yet

Leave it alone and everything still works. `MAPS_PROVIDER=STUB` prices from real Benin
City coordinates with a straight-line distance model, and the UI now says
*"estimated distance"* rather than pretending otherwise. No booking is ever blocked.

The only thing you give up is road accuracy, and the live map falls back to a simplified
drawing instead of Google tiles.
