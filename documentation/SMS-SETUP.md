# Turning SMS on

**You do not need any of this to launch.** Nothing in the product requires a text
message: sign-up completes on the emailed link, booking and dispatch run on the app's
own sockets, and phone confirmation is optional — it is switched off, and said to be
switched off, wherever a provider is missing. Read this when someone asks for texts,
not before.

The driver is already written. `MessagingService.sendSms` posts to Termii with the
DND channel, reads the reply rather than trusting HTTP 200, and returns the provider's
own words on failure. What is missing is not code — it is an account.

## What "not working" has always meant

Every SMS failure on this platform has been one of four things, and none of them are
visible from the app:

| Symptom | Real cause |
| --- | --- |
| Code printed in the server log | `SMS_MODE=CONSOLE` — nothing is being sent |
| "TERMII_API_KEY is not set" | the key was never pasted into the host |
| "Sender ID not found" | the sender ID is not approved yet, or is spelled differently |
| "Insufficient balance" | the Termii wallet is empty |
| Delivered, never received | the message went on the **generic** route to a DND number |

That last one is the quiet killer. In Nigeria most numbers have do-not-disturb active.
The generic route does not reach them, and Termii still accepts the message.

## Why this is not a five-minute job

Email was one DNS record set and a key. SMS in Nigeria is a business-verification
process: an account, a sender ID that a human approves, and — the part nobody mentions
up front — the DND route, which Termii switches on by hand after you ask support. There
is no self-serve equivalent for a sender ID that reaches every network. Plan for days,
start it early, and do not wait for it to launch.

## What you need from Termii

1. **Account** — termii.com, business details.
2. **API key** — Settings → API Keys → create. Shown once; copy it to Notepad.
3. **Sender ID** — Settings → Sender IDs. Up to 11 alphanumeric characters, e.g.
   `TWL`. Approval is manual and typically takes **24 hours to a few days**.
4. **DND route** — request it from Termii support. The DND (transactional) route is
   what delivers OTPs to numbers that have do-not-disturb active. Without it, OTPs
   appear to send and never arrive. Activation is manual and can take longer than the
   sender ID.
5. **Credit** — SMS is prepaid. Expect roughly **₦3.50–₦5.00** per message on the
   generic route and **₦5.50–₦8.00** on the DND route. At ₦7, a thousand verification
   codes is about ₦7,000. Check the current price in your Termii dashboard before you
   top up — these move.

## What you set on the host (never in chat, never in the frontend)

On the **API** service in Northflank:

```dotenv
SMS_MODE=TERMII
TERMII_API_KEY=<the key you copied to Notepad>
TERMII_SENDER_ID=TWL
TERMII_CHANNEL=dnd
```

`TERMII_CHANNEL` accepts `dnd`, `generic` or `whatsapp`. Use `dnd` for OTPs. `generic`
is for promotional traffic and will not reach DND numbers.

Then restart the API. The boot log states the truth in one line:

```
SMS: console only · Email: Resend
SMS: Termii (dnd) · Email: Resend
```

and `/api/v1/health` reports `"sms": "TERMII"` — or `"TERMII_NO_KEY"`, which is the
case that used to be invisible.

## Proving it works — the button

**Admin → Settings → Messaging.** Two cards (the configuration) and two buttons
(send a real message). The result panel prints the provider's own sentence, so:

| What the panel says | What to do |
| --- | --- |
| `Accepted by the provider` | wait a minute, then check the handset |
| `Sender ID not found` | the sender ID is not approved — check its status in Termii |
| `Insufficient balance` | top up the Termii wallet |
| `Invalid API key` | the key was pasted with a space, or is from another account |
| `Nothing was delivered` with no provider message | the key is missing entirely — the config card above says the same thing |

Send to your own phone first. Then send to a phone you know is on DND — that is the
one that tells you whether the DND route is really active, and it is the only test that
matters.

If SMS is not live yet, the panel says exactly why, in words, rather than showing a
button that quietly does nothing.

## While you wait for approval

`SMS_MODE=CONSOLE` (the default) prints the code to the API log. It is honest about it:
the verification screen tells the user the code could not be sent, and the delivery
result carries `driver: 'console'`. Nothing pretends.

Phone verification is not required to sign in or to book, so a demo works without SMS.
Email is already live through Resend.

## If Termii's DND approval is too slow

Other Nigerian providers issue OTP sender names on sign-up rather than after manual
review, and route DND numbers automatically — Arkesel, Robase, Sendar and BulkSMS
Nigeria all advertise this, at roughly ₦6–₦8 per message. Adding one is a second
driver in `MessagingService.sendSms` (about forty lines, same shape as the Termii one)
plus an env flag. Say the word and I will add it; there is no reason to do it
speculatively.

## What this does not cover

- **A2P registration with the carriers.** Termii handles it as part of sender-ID
  approval; you are not dealing with MTN directly.
- **WhatsApp.** `TERMII_CHANNEL=whatsapp` exists in the code, but it needs a Meta
  business account and its own templates — a separate piece of work.
- **Two-way SMS.** Not implemented: replies to the sender ID go nowhere by design.
  Customers reply in the app, which is the point of the masked-number rule.
