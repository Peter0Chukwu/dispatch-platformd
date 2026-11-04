# Phase 2 — Authentication, Sessions and Access Control

**Date completed:** 4 November 2026
**Status:** ✅ Complete — 61 automated tests passing, full journey verified in a real browser.

---

## 1. What now works (in plain language)

| Capability | Status | Proof |
|---|---|---|
| Customer registration | ✅ | Creates a `PENDING` user, a customer profile and a ₦0 wallet |
| Rider application | ✅ | Creates a `PENDING` rider (code `RDR-00001`), vehicle record, stays offline |
| Email verification | ✅ | Single-use token, 24-hour expiry, hashed in the database |
| Phone OTP | ✅ | 6 digits, 10-minute expiry, hash-only storage, 5-attempt cap |
| Login (3 portals) | ✅ | Email **or** Nigerian phone; generic error messages; portal enforced |
| Account lockout | ✅ | 5 failed attempts → 15-minute lock, audited as `ACCOUNT_LOCKED` |
| Sessions | ✅ | 15-minute access JWT + HttpOnly refresh cookie |
| Refresh rotation | ✅ | Every refresh issues a new token and revokes the old one |
| **Reuse detection** | ✅ | Replaying a rotated token revokes the entire session family |
| Logout / logout-all | ✅ | Single device, or every device |
| Password reset | ✅ | 1-hour token, invalidates all sessions, no account enumeration |
| Password change | ✅ | Requires the current password; signs out other devices |
| Roles & permissions | ✅ | 5 roles, 37 permissions, enforced by a global guard |
| Rate limiting | ✅ | Redis-backed, per route and per identifier |
| Audit log | ✅ | Every sensitive action, with before/after values, IP and user agent |
| Session restore on reload | ✅ | Access token in memory only; restored from the refresh cookie |

---

## 2. Files created / modified

**Backend — new**
```
src/auth/auth.types.ts              Principal + token payload + session shape
src/auth/password.service.ts        Argon2id hash / verify / rehash
src/auth/token.service.ts           Access JWT + refresh rotation + reuse detection
src/auth/verification.service.ts    Email tokens, OTP, password reset
src/auth/auth.service.ts            Register, login, refresh, sessions, profile
src/auth/auth.controller.ts         All /auth endpoints (cookie handling)
src/auth/auth.module.ts
src/auth/guards/jwt-auth.guard.ts       Global authentication
src/auth/guards/permissions.guard.ts    Granular authorisation
src/auth/decorators/public.decorator.ts
src/auth/decorators/current-user.decorator.ts
src/auth/decorators/require-permissions.decorator.ts
src/auth/decorators/require-type.decorator.ts
src/common/rate-limit/rate-limit.guard.ts
src/common/rate-limit/rate-limit.decorator.ts
src/users/users.service.ts + module   Identifier lookup, safe user projection
src/messaging/messaging.service.ts + module   Console SMS/email drivers
src/audit/audit.service.ts + module    Append-only audit trail
src/admin/admin.controller.ts          /admin/whoami, /staff, /permissions, /audit-logs
src/admin/admin.service.ts + module
test/global-setup.ts                   Migrates + seeds the TEST database
test/helpers/app.ts                    Boots the real app for tests
test/helpers/auth-test-helpers.ts      Fixtures + safe data reset
test/auth.e2e.spec.ts                  36 integration tests (see §6)
```

**Backend — modified**
```
src/app.module.ts        Auth/Admin/Users/Audit/Messaging modules; 3 global guards; cookie-parser
src/main.ts              cookie-parser removed (moved into AppModule)
src/health/health.controller.ts   @Public() so the health probe stays open
src/common/pipes/zod-validation.pipe.ts   Converts Zod failures into AppError (422 + field details)
src/common/filters/all-exceptions.filter.ts   Duck-typed Zod detection
tsconfig.json / tsconfig.build.json  rootDir split (src vs whole project)
vitest.config.ts         globalSetup for the isolated test database
test/setup-env.ts        Forces DATABASE_URL → dispatch_dev_test (refuses to run otherwise)
```

**Shared package — new**
```
src/schemas/rider.ts     registerRiderSchema, changePasswordSchema
src/schemas/auth.ts      loginSchema.audience now REQUIRED (no silent default)
```

**Frontend — new**
```
src/contexts/AuthContext.tsx        Session state, login/logout, permission helpers
src/lib/api.ts                     Rewritten: in-memory access token, single-flight refresh, 401 retry
src/routes/guards.tsx              RequireAuth, RequirePermission, RedirectIfAuthenticated
src/layouts/AuthLayout.tsx         Split-screen auth shell
src/layouts/PortalShell.tsx        Sidebar + topbar + mobile bottom nav + verification banner
src/pages/auth/LoginPage.tsx                LoginPage + portal tabs
src/pages/auth/RegisterCustomerPage.tsx
src/pages/auth/RegisterRiderPage.tsx
src/pages/auth/VerifyPage.tsx               Email link + phone OTP in one screen
src/pages/auth/ForgotPasswordPage.tsx
src/pages/auth/ResetPasswordPage.tsx
src/pages/customer/CustomerHome.tsx
src/pages/rider/RiderHome.tsx
src/pages/admin/AdminHome.tsx
```
**Frontend — modified:** `App.tsx` (routes + guards), `main.tsx` (AuthProvider).

---

## 3. Database changes

**No new tables** — Phase 1's schema already had `refresh_tokens`, `verification_tokens`, `audit_logs`, `roles`, `permissions`, `role_permissions`, `staff_roles`. Phase 2 used them as designed. This is the payoff for doing the schema first.

Behaviour added at the data layer:
- `users.failedLogins` / `users.lockedUntil` drive lockout
- `refresh_tokens` rows are never deleted on logout — they are stamped `revokedAt`, so a reuse attempt is detectable (deleting them would destroy the evidence)
- `verification_tokens.attempts` caps OTP guessing

---

## 4. API endpoints created

| Method | Path | Auth | Rate limit |
|---|---|---|---|
| POST | `/api/v1/auth/register/customer` | public | 5 / 10 min per IP |
| POST | `/api/v1/auth/register/rider` | public | 5 / 10 min per IP |
| POST | `/api/v1/auth/login` | public | 10 / 5 min per identifier |
| POST | `/api/v1/auth/refresh` | cookie | 60 / min per IP |
| POST | `/api/v1/auth/logout` | cookie | — |
| POST | `/api/v1/auth/logout-all` | required | — |
| POST | `/api/v1/auth/verify-email` | public | 10 / 5 min |
| POST | `/api/v1/auth/resend-verification` | required | 3 / 5 min |
| POST | `/api/v1/auth/otp/request` | public | 5 / 5 min per phone |
| POST | `/api/v1/auth/otp/verify` | public | 10 / 5 min per phone |
| POST | `/api/v1/auth/password/forgot` | public | 5 / 15 min |
| POST | `/api/v1/auth/password/reset` | public | 10 / 15 min |
| PATCH | `/api/v1/auth/password` | required | — |
| GET | `/api/v1/auth/me` | required | — |
| PATCH | `/api/v1/auth/me` | required | — |
| GET | `/api/v1/auth/sessions` | required | — |
| DELETE | `/api/v1/auth/sessions/others` | required | — |
| GET | `/api/v1/admin/whoami` | STAFF + `dashboard:read` | — |
| GET | `/api/v1/admin/staff` | STAFF + `staff:read` | — |
| GET | `/api/v1/admin/permissions` | STAFF + `role:write` | — |
| GET | `/api/v1/admin/audit-logs` | STAFF + `audit:read` | — |

---

## 5. How the security model works (plain English)

```
Sign in
  → Argon2id verifies the password (memory-hard; a stolen hash is expensive to crack)
  → access token (JWT, 15 min) returned in the JSON body → kept in memory only
  → refresh token (32 random bytes) returned as an HttpOnly cookie → JavaScript cannot read it
Every request
  → Authorization: Bearer <access token>
  → JwtAuthGuard verifies the signature, loads the user, blocks suspended accounts,
    confirms the token's portal matches the account type
  → PermissionsGuard checks the route's declared permissions against the ones the
    database says this staff member has
  → controller runs
Every 15 minutes
  → the client silently calls /auth/refresh; the server issues a NEW refresh token and
    revokes the old one in the same "family"
  → if an already-rotated token is ever presented again, someone has a stolen copy:
    the whole family is revoked and the event is logged as suspicious
```

**Why the refresh token is a cookie and the access token is not:** the access token has to be readable by
JavaScript to be sent in a header, so it is exposed to XSS — that is why it lives for 15 minutes and in
memory only. The refresh token is the long-lived credential, so it is locked in an `HttpOnly` cookie where
script cannot touch it.

---

## 6. Testing

```bash
cd backend && npx vitest run
```
Result: **61 tests passed** (36 new in `auth.e2e.spec.ts`), run against a **separate database**
(`dispatch_dev_test`) that is migrated and seeded automatically.

What the new tests actually assert:

| Scenario | Test |
|---|---|
| Register → PENDING user, wallet created, password is an Argon2id hash | ✓ |
| Duplicate email / phone (including `0803…` vs `+234803…`) rejected with 409 | ✓ |
| Weak password rejected **by the API**, not just the browser | ✓ |
| Invalid Nigerian phone rejected | ✓ |
| Email verify activates the account; replaying the link fails | ✓ |
| Wrong OTP fails; OTP is not stored in plain text | ✓ |
| Login returns access token, **never** the refresh token in the body | ✓ |
| Cookie is `HttpOnly` and path-scoped | ✓ |
| Phone-number login works | ✓ |
| Wrong password and unknown account return an identical message | ✓ |
| 5 failures → lockout, correct password also refused, audited | ✓ |
| Customer refused in the admin portal; suspended account refused | ✓ |
| `/auth/me` works; missing / malformed / **expired** tokens rejected | ✓ |
| Refresh rotates the token | ✓ |
| **Replayed refresh token revokes the whole family** | ✓ |
| Logout and logout-all kill the session | ✓ |
| Customer → 403 on admin; **rider → 403 on every admin route** | ✓ |
| Support agent: dashboard 200, staff directory **403** (missing `staff:read`) | ✓ |
| Operations manager: staff 200, audit log 403 | ✓ |
| Finance manager: audit 200, role catalogue 403 | ✓ |
| Super admin: everything 200 | ✓ |
| Password reset works, old password dies, old sessions die, no enumeration | ✓ |
| Change password signs out other devices; wrong current password rejected | ✓ |
| Rate limiting returns 429 with a "wait N seconds" message | ✓ |
| Audit log records register / login / failure; **never stores passwords or hashes** | ✓ |

### Browser-level verification (`node scripts/capture-phase2.mjs`)
Runs the real UI in headless Chromium: admin signs in → dashboard renders 1 staff row + 37 permission
chips → signs out → customer registers → verifies email and phone → signs in → **visiting `/admin` as a
customer redirects home**. No console errors except the expected 401 from the anonymous session check.

---

## 7. Bugs found and fixed this phase

1. **`cookie-parser` only existed in `main.ts`** — the test harness boots the Nest app without
   `main.ts`, so refresh cookies were invisible and every refresh returned 401. Moved into
   `AppModule` middleware so *every* entry point behaves identically. (Caught by a test, not in production.)
2. **`instanceof ZodError` failed** — the same library loaded through two module paths produced two
   classes, turning validation errors into 500s. The validation pipe now translates to `AppError` itself,
   and the filter additionally duck-types.
3. **`TRUNCATE … CASCADE` on `staff` silently wiped seeded pricing rules** (they hold a nullable FK to
   staff). The test reset now uses ordered `DELETE`s.
4. **Health endpoints were behind the new global auth guard** — marked `@Public()`.
5. **RHF/Zod resolver type mismatch** — `loginSchema` defaulted `audience`; made it required (also
   more correct: a token must never be issued for an implied portal).
6. **Duplicate "super admin" badge** in the portal header — deduped role chips.

---

## 8. Commands

```bash
npm run setup          # first time in a fresh sandbox: services + install + migrate + seed
npm run dev            # API :4000 + web :5173  (live preview appears automatically)

npm test               # 61 tests, isolated test database
node scripts/capture-phase2.mjs        # browser journey + screenshots
python3 scripts/build-report.py        # regenerate BUILD-REPORT.html
```

**Sign in as the super administrator:** `admin@dispatch.test` / the password printed by `npm run db:seed`
(`Admin@12345` unless you set `SUPER_ADMIN_PASSWORD`). It is flagged `mustChangePassword`.

---

## 9. Outstanding issues / known limitations

- **No UI yet for**: uploading rider documents, staff/role management, audit log viewer (API exists at
  `/admin/audit-logs`, screen arrives in Phase 5).
- **Email/SMS are console-only.** Codes print to the API log and, in development, are returned to the
  browser so the flow is testable. Real drivers land in Phase 7 — the `MessagingService` interface will
  not change.
- **2FA for staff not implemented.** Recommended before real money moves; cheap to add now that TOTP
  storage and the verification flow exist.
- **No CAPTCHA** on registration/login. Rate limiting and lockout cover the basics; add hCaptcha/Turnstile
  if abuse appears.
- **`mustChangePassword` is flagged but not enforced** on the admin UI yet (Phase 5).
- **Session list UI** not built (`GET /auth/sessions` exists).
- **16 npm advisories** remain in the dev toolchain (transitively, via Nest CLI/Vite). Tracked for Phase 10.

---

## 10. What Phase 3 will deliver

The customer booking experience, end to end:

- 4-step booking wizard: addresses with map picker + autocomplete, package details and photo, delivery
  speed and scheduling, review and confirm
- **Server-side pricing engine** in integer kobo: base fee + distance + type surcharge + zone override +
  promo, with a `priceSnapshot` frozen onto the delivery
- `POST /deliveries/quote` returning the exact breakdown shown before payment
- Delivery creation, customer history and detail with a real status timeline
- Saved addresses, cancellation rules
- Tests: pricing edge cases (minimum fee, free km, surcharge stacking, promo caps, distance 0), quote
  equals the saved charge to the kobo, customer cannot read another customer's delivery
