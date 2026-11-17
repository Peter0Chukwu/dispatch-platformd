# Maps — set up Geoapify (no card, no billing account)

You have two decisions to make and one thing to type. This is the whole job.

---

## 1. Sign up (2 minutes, no card)

1. Go to <https://myprojects.geoapify.com/register> and register with your email.
2. It drops you in **MyProjects**. Create a project — call it `traders-welfare`.
3. Click **API keys** → **Create a new key**, or just copy the key already generated for you.
4. Copy it. It is one long string. **This is the only secret you need for maps.**

There is no billing screen, no card, and no way to be charged on the free plan: 3,000 credits a day,
up to 5 requests a second, commercial use allowed.

---

## 2. Put the key in two places

It is the **same** key in both — unlike Google, Geoapify does not split browser and server keys.

**Backend** (Northflank → the API service → Environment, or `backend/.env` locally):

```dotenv
MAPS_PROVIDER=GEOAPIFY
GEOAPIFY_API_KEY=paste-your-key-here
```

**Frontend** (Northflank → the web service → Environment, or `frontend/.env` locally):

```dotenv
VITE_GEOAPIFY_API_KEY=paste-your-key-here
```

Type or paste it **bare** — no quotes, no trailing space. A quote pasted from Notepad becomes part of
the key and the call fails with a 401 that looks like a bad key.

> **The frontend one is a build-time variable.** Vite bakes `VITE_` values into the JavaScript when
> the web image is built, so adding it and restarting is not enough — the web service must be
> **rebuilt/redeployed**. This is the single most common reason a map "doesn't turn on".

---

## 3. Check it worked

**a. The API reports the provider.** Open `https://<your-api-host>/api/v1` — the status block shows
`maps: GEOAPIFY` instead of `STUB`.

**b. Suggestions are live.** On the booking form, type `sapele`. The line under the results changes
from *"Popular Benin City locations."* to *"Address suggestions as you type."*

**c. The distance is a road distance.** Price a trip and compare the km against a Geoapify route for
the same two points. Straight-line-plus-35% becomes a real road measurement, and the tracking card
labels the ETA **"Road route"** rather than "Estimated route".

**d. The map has streets.** Open a delivery's tracking page (or the admin city view). You should see
a street map with the "Powered by Geoapify · © OpenStreetMap contributors" line in the corner.

**e. Logs.** If nothing changes, the API log says why:

```
[MapsService] Geoapify routing failed, falling back to the stub estimate: Geoapify routing responded 401
[MapsService] Geoapify suggestions failed, falling back to local places: Geoapify autocomplete responded 403
```

`401` = the key is wrong (or has a stray quote). `403` = the key was deleted or the plan is
exhausted. `429` = you hit the 5 requests/second limit.

---

## 3½. Two rules built into the suggestions

**The platform's own Benin City locations always rank first.** Typing `ring` returns our
surveyed Ring Road — not Ring Road *in Lagos*, which is what a plain OpenStreetMap search
returns (the Lagos one is bigger and better mapped). Typing `sapele` returns Benin-Sapele
Road, not the town of Sapele in Delta State. The provider fills in everything the saved
list does not cover.

**Suggestions are biased to the depot city.** `MAPS_SEARCH_BIAS=5.6222,6.3329` (Ring Road,
Benin City — longitude first) is sent with every request so nearby results win ties. Change
it if you ever operate from another city.

## 4. What a booking costs you

The free plan gives **3,000 credits a day**, and:

| Call | Credits |
| --- | --- |
| One route (distance + ETA) | 1 |
| One address suggestion, already geocoded | 1 |
| One geocode of a typed address | 1 |
| One map tile | 0.25 (a full map view is ~20–30 tiles → ~5–8) |

A hundred deliveries in a day, each looked at on the map a couple of times, is a few hundred credits
— comfortably inside the free allowance. The first paid plan is $59/month for 10,000 credits/day if
you ever outgrow it.

---

## 5. Where the code is, if you want to look

- `backend/src/pricing/maps.service.ts` — the adapter. `geoapifyPlaces()` (suggestions + geocode),
  `geoapifyReverse()`, `geoapifyRoute()`.
- `backend/test/maps.geoapify.spec.ts` — the tests that pin the URLs, the Nigeria filter, the
  longitude-before-latitude ordering, and the fallbacks.
- `frontend/src/components/LiveMap.tsx` — Leaflet over Geoapify tiles.
- `documentation/CREDENTIALS-SETUP.md` §3 — the same instructions in the repo.

---

## 6. Honest limits

- **OpenStreetMap data, not Google's.** Benin City's roads route correctly, but many streets there
  are unnamed in the data and informal landmarks are missing. This is why the booking form leads
  with the platform's saved Benin City locations — keep that list current and let the provider
  handle the rest.
- **No uptime guarantee on the free plan.** If Geoapify is slow or down, the API logs a warning and
  prices from the stub model. A booking is never blocked by a map outage — the fare is just less
  precise for that one trip, and `routeSource` on the delivery says so.
- **Attribution is a condition of the free plan.** The map must keep the Geoapify and OpenStreetMap
  credit. It is already there; do not remove it.
- **Google is still supported** (`MAPS_PROVIDER=GOOGLE`) if you ever get your Cloud account sorted.
  Nothing needs to change but the environment variables.
