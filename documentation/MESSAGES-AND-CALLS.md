# Messages, verification and calls

Everything a customer needs in the first five minutes — "prove you are you" — and
everything the two people on a delivery need while it is happening. Written for
whoever is running this deployment, not for a developer reading code.

---

## 0. Three different things, often confused

They are separate on purpose, and only the third one costs money.

| | What it is | Needs a provider? |
|---|---|---|
| **Chat** | Customer ↔ rider text, per delivery, inside the app | **No** — built, free |
| **Calling** | A voice call inside the app, no phone numbers on either side | **No** — built, free |
| **SMS** | A text message to a real handset: verification codes, alerts | **Yes — that is all Termii does** |

Termii is a text-messaging company. It sends "123456 is your code" to a phone. It
cannot host a conversation and nothing in the chat depends on it. Turning SMS off
(`SMS_MODE=CONSOLE`) leaves chat, calling, email verification and the map working
exactly as they are; the only loss is automatic verification of phone numbers, and
alerts reaching a phone whose app is closed.

## 1. The verification screen

Sign-up creates the account and immediately tries to send **two** things:

| Step | What is sent | Where it goes | How long it lasts |
|---|---|---|---|
| Email | a link | `‹site›/verify?token=…` | 24 hours |
| Phone | a 6-digit code | `‹site›/verify` (type it in) | 10 minutes |

Open the verification screen from the link in the email, or from `/verify`. Either
way it is one screen with two halves: the email link confirms the address by
itself (no typing), then the six digits confirm the phone.

### What changed, and why the screen used to fail

1. **The emailed link pointed at a page that did not exist.** The link was built as
   `/verify-email?token=…` but the app only had `/verify`. Every click landed on
   the 404 page, so the token was never used and the address could never be
   confirmed. The link is now `/verify?token=…`, and `/verify-email` still works so
   old links in people's inboxes stop failing.
2. **The screen said "we sent you a code" whether or not anything was sent.** With
   no SMS provider configured the code was written to the API log — useful for a
   developer, invisible to a customer. The API now reports whether each message
   actually left, and the screen says "we could not send the email just now"
   instead of pretending. The code still works; the customer just knows to ask for
   another one.
3. **There was no way to ask for the email again.** A brand-new account has no
   session yet, so the old resend button refused with a 401. There is now a
   "Send the link again" button that needs only the address.
4. **A failed message no longer breaks sign-up.** Previously any provider problem
   threw, which turned registration into a 500 and lost the account. Messages are
   now best-effort: the account is created, and the delivery result is reported.

### Turning on real email (Resend)

1. Sign up at <https://resend.com> (3,000 emails/month on the free tier). The
   domain-specific walk-through — including DMARC, which is what gets a young domain
   out of the spam folder — is in [CUSTOM-DOMAIN.md](CUSTOM-DOMAIN.md).
2. **Domains → Add domain**, then add the DNS records Resend shows you. Until the
   domain is verified, Resend will only deliver to your own address.
3. **API Keys → Create**, and copy the key.
4. In the API environment:

```dotenv
EMAIL_MODE=RESEND
RESEND_API_KEY="re_…"
EMAIL_FROM="Traders Welfare <no-reply@yourdomain.com>"
```

### Turning on real SMS (Termii)

1. Sign up at <https://termii.com> and top up a little credit (roughly ₦3.5–₦5 a
   message).
2. **Sender ID** — request one (3–11 letters/digits, e.g. `TWL`). Approval takes a
   few days, so start it first.
3. **The DND route.** Termii has two routes. `generic` is the promotional one: it
   is blocked for OTP traffic, it does not reach numbers with do-not-disturb
   active, and it cannot be used for OTPs. `dnd` is the transactional route we
   need, and Termii support must switch it on for your account. Ask them in
   writing: *"Please enable the DND/transactional route on my account for OTP
   delivery."*
4. In the API environment:

```dotenv
SMS_MODE=TERMII
TERMII_API_KEY="TL…"
TERMII_SENDER_ID="TWL"
TERMII_CHANNEL=dnd
```

### How to check it is really on

- `GET /api/v1/health` → `integrations.sms` and `.email` report **`TERMII`** and
  **`RESEND`**. If they say `TERMII_NO_KEY` / `RESEND_NO_KEY`, the mode is selected
  but the key is missing — a combination that looks configured and sends nothing.
- The API boot log prints one line: `SMS: TERMII · Email: RESEND` (or
  `console only`).
- End to end: register a new account with a real address and a real number. The
  email arrives within seconds; the SMS usually within 10.

---

## 1b. Chat: where it lives, and how you know there is a message

The chat sits where the conversation belongs — **inside the delivery**:

- the **customer** opens *My deliveries → a delivery → Contact*;
- the **rider** opens *Current job → Contact*;
- it opens when a rider accepts the job and closes for new messages once the job
  ends. The history stays readable, and it cannot be reopened — that is the "no
  contact after the job" rule, enforced by the server.

There is no separate inbox screen, by choice. Instead, nothing has to be hunted for:

- the delivery row in **My deliveries** carries a **"2 new messages"** badge;
- the rider's **Current job** card carries the same badge;
- a message that arrives while that thread is *not* on screen raises a small toast
  with the first line of the message;
- opening the thread is what marks it read — there is no separate "seen" button for
  a client to forget.

A message that looks like a phone number is refused before it is stored, so chat
cannot be used to swap numbers. The count comes from `GET /api/v1/chat/unread`,
which reports the other side's unread messages per delivery for the signed-in party
and never marks anything read by itself.

---

## 2. Calls between the customer and the rider

The rule that has not changed: **neither person ever learns the other's phone
number, and the line closes when the delivery does.**

There are two ways to honour that. Only one of them works without a provider
account, and it is the one that is on:

### In-app calling (on by default — `VOICE_MODE=IN_APP`)

The call happens inside the app: the browser-to-browser audio connection known as
WebRTC. There is no phone number anywhere in it, so there is nothing to reveal and
nothing to leak. Pressing **Call** in the Contact card on a live delivery makes the
other person's phone ring *inside the app*; they press **Answer**.

What the server enforces (not the browser):

- only the two people on that delivery may call each other;
- only while the job is live — before a rider is assigned, and after delivery
  (delivered, cancelled, failed), the call is refused;
- one call at a time per person;
- a call that is not answered stops ringing after 45 seconds;
- a closed tab hangs the call up, so the other side is never left ringing;
- a fresh call id every time, so an old id cannot be replayed.

The audio never passes through our server and nothing is recorded.

**Two honest limits.**

1. *Both people must be online.* The call arrives over the live connection the app
   keeps open. Someone with the app closed gets nothing — a phone-style
   notification needs a push service (see §3).
2. *Some networks block direct audio.* The connection uses free STUN servers to
   find a path. Most home and mobile networks are fine; some corporate firewalls
   and a minority of carrier NATs are not. When that happens the screen says the
   call could not connect and points at the message box, which always works. The
   fix is a TURN relay (e.g. Metered or Twilio), a paid per-gigabyte service —
   a deployment decision, and a five-line change when you want it.

### Phone-to-phone with a proxy number (`VOICE_MODE=TERMII`, not connected)

The other route is the one people usually mean by "masked calling": the provider
rents a temporary number, both parties dial it, and the provider joins the two
calls. Neither sees the other's real number.

This is **not self-serve**. It needs a Termii (or Africa's Talking) number-masking
account with KYC documents, a rented pool of numbers and per-minute billing, and it
is switched on by their support team. When that exists, `requestCall()` in
`backend/src/messaging/voice.service.ts` is the single place that changes, and the
Contact card starts ringing real handsets instead of the app.

Until then the Contact card says *"Calls happen inside the app"* — it does not
pretend to dial a number.

### What to try in a demo

1. Sign in as the customer (`/login`), book a delivery, and let a rider accept it
   (or accept it in the rider portal on a second browser profile).
2. Both open the delivery. Under **Contact**, press **Call**.
3. The other browser shows "Customer is calling" with **Answer** / **Decline**.
4. Speak — allow the microphone when the browser asks. The timer starts once the
   audio is connected.
5. Mark the delivery delivered, then press **Call** again: it is refused, because
   the job is over. That refusal is the feature.

---

## 3. What still has to be connected

The platform runs today without any of the paid accounts below: the demo is real,
it just does not yet reach the outside world in these specific ways. In rough order
of urgency.

| # | What | What it unlocks | Where the key goes | Cost / lead time |
|---|---|---|---|---|
| 1 | **Resend** + a verified sending domain | Verification emails, password resets, receipts | `RESEND_API_KEY`, `EMAIL_FROM` | Free to 3,000/month · ~15 min (DNS) |
| 2 | **Termii** sender ID + **DND route** | Real SMS codes and rider alerts | `TERMII_API_KEY`, `TERMII_SENDER_ID`, `TERMII_CHANNEL=dnd` | ~₦4/message · sender ID a few days |
| 3 | **Paystack** (and/or Flutterwave) live keys + webhook URL | Customers paying into the wallet; rider payouts | `PAYSTACK_SECRET_KEY`, `PAYSTACK_WEBHOOK_SECRET` | Free · instant (sandbox works now) |
| 4 | **Push notifications** (Firebase Cloud Messaging) | Calls and new-job alerts reaching a closed app or a locked phone | a Firebase project + a service key | Free · a day's work |
| 5 | **TURN relay** (optional, Metered/Twilio) | In-app calls on networks that block direct audio | add to `ICE_SERVERS` in `frontend/src/lib/call.ts` | ~$1–$10/month |
| 6 | **Termii number masking** (only if you want a real handset to ring) | Phone-to-phone calls through a proxy number | `VOICE_MODE=TERMII`, number pool | KYC + per-minute · support request |
| 7 | **Geoapify** production key | Address search, road distance and the map — currently a demo key | `VITE_GEOAPIFY_API_KEY` (rebuild the site), `GEOAPIFY_API_KEY` | Free to 3,000 credits/day |
| 8 | **Postgres that never pauses** | Data surviving the free tier's one-week idle pause | `DATABASE_URL`, `DIRECT_URL` | Supabase free / ~$25 month to stop pausing |
| 9 | **A domain** | A link people trust in an email or an SMS | `FRONTEND_URL`, `CORS_ORIGINS` | ~₦15,000/year |
| 10 | **A server that does not sleep** | No 30–60 second cold start before the first page loads | a paid instance | ~$5–7/month |

Things already connected and working: Geoapify maps and address search, the
database and Redis, chat over the live channel, in-app calling, saved places,
staff invitations, and payments in **sandbox** mode (real flows, test cards).

---

## 4. Where the code lives

| Concern | File |
|---|---|
| Outbound SMS (Termii) and email (Resend) | `backend/src/messaging/messaging.service.ts` |
| Verification codes, links, resends | `backend/src/auth/verification.service.ts` |
| The registration responses that report delivery | `backend/src/auth/auth.service.ts` |
| Proxy-number calling (not connected) and the call status the screens read | `backend/src/messaging/voice.service.ts` |
| In-app call permission rules and ringing timeout | `backend/src/realtime/call-signaling.service.ts` |
| Call events on the live channel | `backend/src/realtime/realtime.gateway.ts` |
| The call itself, in the browser | `frontend/src/lib/call.ts` |
| The call panel | `frontend/src/components/CallOverlay.tsx` |
| The verification screen | `frontend/src/pages/auth/VerifyPage.tsx` |
| Unread counts (the badge) | `backend/src/messaging/chat.service.ts` (`unread`), `GET /chat/unread` |
| The message nudge | `frontend/src/components/MessageNotifier.tsx` |

Tests: `backend/test/messaging.spec.ts`, `backend/test/call-signaling.spec.ts` and
`backend/test/chat-unread.spec.ts` (28 tests between them, no database needed).
