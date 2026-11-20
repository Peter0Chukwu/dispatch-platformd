# Requesting a rider, and the price conversation

The booking flow is now three questions and a decision:

1. **From** — where the parcel is collected.
2. **To** — where it is going.
3. **Size** — how big it is. A photo and a description are offered, never required.

Then the platform shows a **bill**, worked out from the real route and the size. The
customer answers it in one of two ways, and that answer decides what riders see.

| The customer chooses | What riders are asked for | What the rider can do |
| --- | --- | --- |
| **Accept the bill** | exactly the bill | take the job, or ask for more |
| **Negotiate** | the customer's own number | take it, ask for more, or pass |

Nothing is charged at either point. Payment happens **after** a rider has the job,
from the delivery page.

## The rules, and why they exist

**A negotiation has a floor and a ceiling.** The customer may offer between half and
three times the bill, both rounded to whole naira. Below half, a rider is working for
fuel money and every rider in the city refuses — the customer waits, then books again
at a higher price. Above three times the bill is nearly always a slipped keystroke.
Both refusals are said in naira, not in error codes.

**A rider may only ask for more.** Asking for exactly the asking price is not a
counter, it is an acceptance with extra steps; asking for less would have the platform
quietly charging the customer less than they offered, which is a bug dressed as a
favour. The ceiling is three times the asking price, for the same keystroke reason.

**The customer decides every counter.** When a rider names a price, the customer sees
that price and accepts or declines it. Accepting assigns that rider at that number.
Declining does **not** end the rider's offer: it stays open at the asking price, so a
customer who turns down ₦2,500 has not lost the rider who might still take ₦2,000.

**One winner, always.** Both routes into an assignment — a rider tapping Accept, a
customer accepting a rider's price — pass through the same transaction
(`DispatchService.conclude`). The offer row is claimed atomically, the delivery is
claimed atomically, the commission is frozen on the agreed number, the losing riders
are told the job is gone, and the rider is marked busy. There is no second path that
could assign a delivery twice.

**The agreed number is the charged number.** `deliveries.chargeKobo` is replaced with
the agreed amount at the moment of acceptance, and `commissionSnapshot` is computed
from it in the same transaction. Whatever was agreed is what the customer pays and
what the rider's cut is worked out from.

## What is stored where

On the delivery:

| Column | Meaning |
| --- | --- |
| `quotedKobo` | the bill the platform calculated |
| `askKobo` | what the customer asked riders for (equal to the bill when they accepted it) |
| `isNegotiated` | whether the customer pushed back |
| `agreedKobo` | the settled amount — null until somebody takes the job |
| `agreedBasis` | `QUOTE` (took the bill), `ASK` (took the customer's number), `COUNTER` (customer took a rider's number) |
| `chargeKobo` | the amount payable, always equal to `agreedKobo` once a rider has the job |

On each offer (`delivery_assignments`):

| Column | Meaning |
| --- | --- |
| `counterKobo` | the price this rider asked for, if any |
| `counterState` | `NONE` / `PENDING` (waiting on the customer) / `DECLINED` / `ACCEPTED` |
| `agreedKobo`, `agreedBasis` | what this rider settled at, and on which number |

## API

| Method | Path | Who | What |
| --- | --- | --- | --- |
| `POST` | `/api/v1/deliveries/quote` | customer | the bill, no writes |
| `POST` | `/api/v1/deliveries` | customer | creates the job — `pricingDecision: ACCEPT \| NEGOTIATE`, `askKobo` |
| `GET` | `/api/v1/deliveries/:id/offers` | customer (own job) | the bill, the ask, and every rider's price |
| `POST` | `/api/v1/deliveries/:id/offers/:assignmentId/accept` | customer | take a rider's price; that rider gets the job |
| `POST` | `/api/v1/deliveries/:id/offers/:assignmentId/decline` | customer | refuse a price; the offer stays open |
| `GET` | `/api/v1/rider/offers` | rider | live offers with the bill and the ask |
| `POST` | `/api/v1/rider/offers/:id/accept` | rider | take the job at the asking price |
| `POST` | `/api/v1/rider/offers/:id/counter` | rider | ask for more (`amountKobo`) |
| `POST` | `/api/v1/rider/offers/:id/reject` | rider | pass |

Both portals are pushed the change over the socket (`offer:countered`,
`offer:counter-answered`), and both pages still refetch from the API — a socket
message can never invent a price.

## Where the two of them end up

Accepting an offer sends **both** people to the thread for that delivery:
`/app/deliveries/:id/chat` for the customer, `/rider/deliveries/:id/chat` for the
rider. It is the same `ContactCard` the delivery pages already use — chat and in-app
calling, no phone numbers either side, and the thread closes when the job finishes.
There is still no inbox: a thread belongs to one delivery and nothing else.

## Tests

`backend/test/price-bands.spec.ts` covers the two bands (including the ₦50 rounding,
which caught a real factor-of-100 bug: 50 kobo is not ₦50). The acceptance transaction
is covered by the existing dispatch tests.
