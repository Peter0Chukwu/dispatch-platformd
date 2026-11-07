# Demo script — showing the platform to someone

> **What this is for.** A stakeholder walkthrough that takes **two minutes** if that is all you have, and
> ten if they are interested. It is ordered so that each screen sets up the next one, and it ends with the
> thing most platforms cannot show: **the numbers agreeing**.

---

## Before you start

| | |
|---|---|
| **What to open** | The live preview named **"Dispatch web app (all three portals)"** in the preview panel. One link — the customer, rider and admin portals all live behind it. |
| **Can they open it themselves?** | Yes — send them the same preview link. It is a normal public https URL, not something tied to your machine. They sign in with the demo accounts below. |
| **Screen sharing instead?** | Fine, and better for the rider-on-a-phone part, which is easier to narrate than to describe. |

**Sign-in — one portal selector, three audiences:**

| Portal | Email | Password |
|---|---|---|
| **Admin** (start here) | `admin@dispatch.test` | `Admin@12345` |
| **Customer** | `demo.customer@dispatch.test` | `Customer@12345` |
| **Rider** | `demo.rider@dispatch.test` | `Rider@12345` |

The data in it is real: 24 deliveries, 10 delivered, ₦28,677 of gross revenue, 4 generated reports, one
rider currently mid-delivery with a live position — all created by exercising the product, not inserted as
display data.

---

## The two-minute version

Sign in as **admin**, and do only these four things.

**1. Overview.** Say: *"Every number on this page is a query against the database at the moment you loaded
it. Nothing here is a stored dashboard figure, and if there had been no deliveries today, it would say
zero."* Point at the delivery count and the revenue.

**2. Live dispatch board.** Point at the columns: waiting, offers out, assigned — and the fourth one,
**exhausted**. Say: *"That column is the honest part. When the engine has asked every eligible rider and
nobody took it, it stops and raises an alert for a human. It does not pretend a rider is still being
found."*

**3. Finance → Reconciliation.** Five green checks. Say: *"This is the reason I trust it with money. Every
naira that moves is written twice, in a ledger that can only be appended to. This screen re-adds all of it
and proves it balances. If someone introduced a bug in the payment code tomorrow, this is where it would
show up — not in a customer complaint three weeks later."*

**4. Reports → Financial summary → Preview.** Pick last 45 days, press Preview. Say: *"This is a preview —
it ran the real query and wrote nothing. Generate it and the request returns in milliseconds while a worker
builds the file. The net figure here is the same arithmetic as the finance screen, and the test suite
asserts that rather than trusting it."*

**Then stop talking and let them click.** That is the whole pitch.

---

## The ten-minute version

Continue from the admin screens:

**5. Admin → Deliveries.** Open any completed delivery and scroll to the **timeline**. Every status change,
with a timestamp and who did it. *"Support can answer 'what happened to my parcel' months later from
records, not memory."*

**6. Admin → Live map.** One rider, mid-delivery, with a real position. *"That coordinate came from a
phone reporting its location, not from a model guessing. If a rider's phone goes quiet, the marker fades
and says when it was last reported — we never draw a rider where we think they might be."*

Now open a **second tab** and sign in as the **customer**:

**7. Book a delivery.** Pick two addresses, choose a package size, and stop on the quote. *"The browser
sent two coordinates. The price was computed on the server, in kobo, from the zone's tariff. Every line is
shown so the customer can argue with it — and the price is frozen when they book, so changing the tariff
tomorrow cannot rewrite what they were charged."*

**8. Wallet.** Point at the balance and the statement. *"Topped up ₦30,000, paid for a delivery from it, and
each line shows the balance after it and points at a ledger entry. This is not a log of intentions."*

Then a **third tab** as the **rider** (use a narrow window — it is a phone app):

**9. Offers and the active job.** One job in transit. *"Every step here is a separate authenticated call
that the server validates against a state machine. The screen can only ever offer the next legal step, and
a hand-crafted request that skips one is rejected. The countdown on an offer comes from the server, not the
browser."*

**10. The public tracking link.** Open a path like `/track/<token>` on the preview URL (no login). *"The
recipient of the parcel gets this. No account, no app. It shows the reference, the rider's first name and
the position — no phone numbers, no customer identity — and the customer can revoke it at any moment."*

---

## Questions they will probably ask, with real answers

| They ask | Answer |
|---|---|
| *"Is this a mock-up?"* | No. The database is PostgreSQL, the API is NestJS, and every screen is reading it live. The audit log on the admin side records what you just did, with your IP address. |
| *"Where does the money go?"* | Paystack or Flutterwave, with signature-verified webhooks. Rider payouts are a withdrawal request plus a staff approval, and each step writes its own ledger entry. |
| *"What happens if a rider's phone dies mid-delivery?"* | The job stays assigned; the customer sees the last reported position and when it was reported, and the dispatcher can reassign by hand — with a reason, which is audited. |
| *"Can a customer see another customer's delivery?"* | No. Ownership is part of the database query, not a check in the page. Changing an id in the URL returns "not found" rather than someone else's parcel. |
| *"How do we know it's not slow when busy?"* | It was load-tested at 40 concurrent users: the most expensive read (a quote) holds p50 ~150 ms, and a report is queued in about 10 ms while a worker builds the file. |

## Two things to say before they find them

- **The amber DEVELOPMENT MODE banner.** Payments are simulated and SMS/email print to a log. That is a
  deliberate switch, changed in one config file when the real keys are in — it is not a missing feature.
- **The map looks like a plain grid.** The coordinates are exact; the streets are not, because no Google
  Maps key is configured yet. The screen says so under the map rather than pretending. One key changes it,
  with no code change.

And if anyone spots **"super admin" listed twice** in Admin → Team → Roles: it is a cosmetic duplicate in
that one list. Permissions are correct. It is logged as a known issue and deliberately not fixed yet.

---

## If the preview is not running

The sandbox that hosts it gets cleaned up between sessions, so ask me to restart it — it takes about a
minute to bring the API, the web app and the seeded data back.

## If you would rather send a file than a link

`documentation/BUILD-REPORT.html` is a single self-contained page — screenshots, the database's real
numbers, and the design decisions written out. It needs no server and no login, works offline, and can be
emailed. It is the better artefact when the person you are showing is not going to click anything.
