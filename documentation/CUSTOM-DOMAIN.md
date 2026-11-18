# Going live on traderswelfarelogistics.online

The domain you bought is the right call, and **yes — it works for Resend**. Resend
does not care about the ending: `.online`, `.com`, `.ng` are the same to it. What it
cares about is that you can add DNS records to the domain, which you can.

Two jobs, in this order. Do the website first (10 minutes), then email (15 minutes
plus DNS waiting).

---

## 0. You already have a DNS provider — the registrar

There is no separate purchase and nothing extra to sign up for. Whoever sold you the
domain runs DNS for it: your domain's nameservers point at them, and their control
panel has a *DNS* or *Advanced DNS* page where records are added.

Check what is actually answering for your domain (this is a live lookup of
`traderswelfarelogistics.online` at the time of writing):

| Question | Answer | What it means |
|---|---|---|
| Nameservers | `dns1.registrar-servers.com`, `dns2.registrar-servers.com` | **Namecheap's** DNS is active on your domain |
| Address record | `192.64.119.246` | Namecheap's default parking page — nothing is pointed anywhere yet |

So: **your DNS provider is Namecheap**, it came free with the domain, and every
record in this document is added at **Namecheap → Domain List → your domain →
Manage → Advanced DNS**. No card, no new account.

(If you bought through a reseller, log in to the reseller's panel — the *Advanced
DNS* page looks the same. If a panel ever says "nameservers: custom", that domain's
DNS is managed elsewhere and that "elsewhere" is your DNS provider.)

### 0a. Which record goes on the bare domain

A CNAME on the bare domain (`@`) is not allowed by the DNS standard, which is why
registrars refuse it. Namecheap's answer is an **ALIAS record**, which behaves like a
CNAME at the root — and it is available on their free DNS. Northflank's own Namecheap
guide says exactly this: add an **ALIAS** record with host `@` and the target
Northflank generated.

So the scheme is:

| Host | Type | What it points at |
|---|---|---|
| `@` (bare domain) | `ALIAS` | the target Northflank gives you |
| `www` | `CNAME` | the same target |

Result: `https://traderswelfarelogistics.online` works, and `www.` works too. No
redirect tricks needed, and no reason to move DNS to Cloudflare.

If Namecheap ever refuses the ALIAS record for your domain (some old accounts or
hosting-DNS setups cannot), the fallback is the plain one: CNAME on `www`, and a
**URL Redirect Record** on `@` pointing at `https://www.traderswelfarelogistics.online`.
Then the public address is the `www` version — swap it in §1b.

---

## 1. Point the site at the domain

Only the **web** service needs a domain. The browser talks to the same origin for
everything — `/api/v1` and `/socket.io` are proxied inside the web container to the
API — so the API stays on its `code.run` address where nobody has to type it.

### 1a. In Northflank

1. **Account settings → Domains → Add domain**, enter `traderswelfarelogistics.online`.
2. Northflank shows a **TXT record** (a name and a value). Add it at your DNS host —
   this proves the domain is yours.
3. Back in Northflank, press **Verify**.
4. **Add subdomain**: `www` under that domain. Northflank shows a **CNAME** target.
   Add that at your DNS host too, then verify.
5. Open your **web** service → **Run → Networking** → expand *Custom domains* for the
   public port → **Choose a domain** → pick `traderswelfarelogistics.online` (and
   `www.traderswelfarelogistics.online`) → save.

Certificates are issued automatically. A minute or two after DNS resolves, the site
is up over HTTPS on the new name.

### 1a½. The records, as Namecheap wants them

Namecheap's *Advanced DNS* table has four columns: **Type**, **Host**, **Target**,
**TTL**. Host is the part *before* the domain — `www`, not `www.example.com`. Use
**Automatic** TTL everywhere.

| Type | Host | Target | When |
|---|---|---|---|
| `TXT Record` | the *record name* Northflank showed, **without the domain on the end** | the *record content* | first — this verifies ownership |
| `ALIAS Record` | `@` | the target Northflank showed for the bare domain | after verification |
| `CNAME Record` | `www` | the target Northflank showed for `www` | after verification |

**The Host field is the part before the domain, not the whole thing.** If Northflank
says the record name is `_northflank-challenge.traderswelfarelogistics.online`, the
Host in Namecheap is `_northflank-challenge`. Pasting the whole string produces
`_northflank-challenge.traderswelfarelogistics.online.traderswelfarelogistics.online`
and the verification will simply never pass. If Northflank gives only the bare
domain, use `@`.

Paste the target exactly: no `https://`, no quotes (Namecheap adds them), no
trailing dot. Set TTL to **1 min** while verifying, and finish with the green
checkmark — Namecheap does not save a record until you do.

### 1b. In the API's environment variables

These two must match the new address **exactly** — scheme and host, no trailing
slash. A mismatch breaks sign-in in the browser while every `curl` test still passes,
which is the most confusing failure there is.

```dotenv
FRONTEND_URL=https://traderswelfarelogistics.online
CORS_ORIGINS=https://traderswelfarelogistics.online,https://www.traderswelfarelogistics.online
```

If you took the redirect fallback in §0a, use `https://www.traderswelfarelogistics.online`
as `FRONTEND_URL` instead. **Pick one and use it everywhere**: the value in
`FRONTEND_URL` is the address that appears in every verification email, and
`CORS_ORIGINS` decides whether the browser is allowed to sign in.

Restart the API. The verification links inside emails are built from `FRONTEND_URL`,
so they now point at the real site instead of a `code.run` address.

### 1c. Check

- Open the address you chose — the site loads, padlock is green. Typing the other one
  should land you on the same place (a redirect, not an error).
- Sign in. If sign-in fails with a session error, `CORS_ORIGINS` has a typo or a
  trailing slash.
- `GET <your address>/api/v1/health` returns `{"status":"ok"}`
  — this proves the proxy and the API are still wired correctly under the new name.

---

## 2. Set up Resend on the same domain

### 2a. Add the domain

1. <https://resend.com> → **Domains → Add domain**.
2. Enter **`traderswelfarelogistics.online`** — the root domain, not a subdomain.
   Resend recommends sending from a subdomain such as
   `updates.traderswelfarelogistics.online`, and that is the better long-term habit.
   For a transactional-only sender at low volume the root is fine, and it gives you
   the clean address `no-reply@traderswelfarelogistics.online`. If you later add
   marketing mail, move that to its own subdomain instead.
3. **Region:** choose the one closest to your recipients — for Nigeria that is
   normally **EU (Ireland)** or **US East**; either works, EU is usually a little
   faster from Lagos.
4. Resend now shows the records to add. **Copy them exactly** — they are unique to
   your account. Typically:

| Type | Name (roughly) | Purpose |
|---|---|---|
| `TXT` | `resend._domainkey` | DKIM — proves the mail really came from you |
| `TXT` | `send` (SPF) | SPF — says which servers may send for you |
| `MX` | `send` | Return-Path, so bounces are handled (priority `10`) |

**One important rule:** if the record is a `CNAME` and you use Cloudflare, set it to
**DNS only** — the grey cloud, not the orange one. Proxying breaks verification.

### 2b. Verify

At Namecheap these go in the same *Advanced DNS* table as the site records: Type
`TXT Record` / `MX Record`, Host exactly as Resend shows it (`send`,
`resend._domainkey`, `_dmarc`), Target pasted verbatim.

Press **Verify** in Resend. It usually completes within 15 minutes; DNS can take up
to 72 hours to propagate everywhere, so if it fails, wait and retry. You can check
what the world sees at <https://dns.email>.

### 2c. Add DMARC (do not skip this)

Add one more record at your DNS host:

| Type | Name | Value |
|---|---|---|
| `TXT` | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@traderswelfarelogistics.online` |

`p=none` means "report but do not punish" — the correct starting point. DMARC is
what makes Gmail and Yahoo trust a young domain, and without it a first-time sender
is far more likely to land in spam.

### 2d. Create the key and set the variables

**API Keys → Create** (sending permission only), then in the API environment:

```dotenv
EMAIL_MODE=RESEND
RESEND_API_KEY="re_..."
EMAIL_FROM="Traders Welfare Logistics <no-reply@traderswelfarelogistics.online>"
```

Restart the API and check `GET /api/v1/health` — `integrations.email` should now read
`RESEND`, not `RESEND_NO_KEY`.

### 2e. Check it end to end

1. Register a test account with a **Gmail** address (not your own domain — you want
   to see what a real inbox does).
2. The verification email should arrive within seconds. If it is in **Spam**, open
   it, mark **Not spam** — that single action teaches Gmail more than any setting.
3. In Gmail, open the message → **⋮ → Show original**. You want `SPF: PASS`,
   `DKIM: PASS`, `DMARC: PASS`. If all three pass, your email set-up is done and the
   same message will reach most other inboxes.

---

## 3. About `.online` specifically

Being straight with you, because it affects expectations:

- **It works.** Gmail, Yahoo and Outlook will deliver authenticated mail from a
  `.online` domain. Nothing in the platform needs a `.com`.
- **It starts with no reputation.** A domain registered this week has no sending
  history, so the first few messages are judged on authentication alone — which is
  exactly why DKIM, SPF and DMARC are not optional here.
- **Cheap TLDs get slightly more scrutiny.** `.online`, `.xyz` and `.top` are
  popular with spammers, so filters are a shade less forgiving than with `.com`.
  Authentication plus low volume plus people actually opening the mail fixes that
  within a couple of weeks.
- **Do not send bulk mail from day one.** Transactional codes and receipts only at
  first. If you later add marketing email, put it on its own subdomain
  (`news.traderswelfarelogistics.online`) so a spam complaint never touches the mail
  that carries verification codes.

---

## 4. What still stays on `code.run`

Nothing a customer sees. The API keeps its generated address, and the internal
service-to-service traffic stays as it is. If you later want the API on
`api.traderswelfarelogistics.online` — useful if a mobile app ever talks to it
directly — it is the same three steps as §1a, with `api` as the subdomain, and then
the web container's `API_UPSTREAM` and the frontend's proxy stay unchanged because
the browser still uses the same origin.

---

## 5. Checklist

- [ ] Bare domain or `www` chosen as the public address (§0a)
- [ ] Domain added and verified in Northflank (TXT record)
- [ ] `www` CNAME added and verified
- [ ] Domain linked to the web service's public port
- [ ] `ALIAS` record on `@` and `CNAME` on `www` added in Namecheap's *Advanced DNS*
- [ ] `FRONTEND_URL` set to the chosen address, no trailing slash
- [ ] `CORS_ORIGINS` lists both the bare and `www` origins, no trailing slash
- [ ] API restarted; `…/api/v1/health` returns `ok` on the new domain
- [ ] Domain added in Resend; DKIM, SPF and MX records added (CNAMEs DNS-only)
- [ ] DMARC record added
- [ ] `EMAIL_MODE=RESEND`, `RESEND_API_KEY`, `EMAIL_FROM` set; health reads `RESEND`
- [ ] Test registration email arrives in Gmail with SPF, DKIM and DMARC all PASS
- [ ] SMS sender ID request still pending with Termii (separate, see
      [MESSAGES-AND-CALLS.md](MESSAGES-AND-CALLS.md))
