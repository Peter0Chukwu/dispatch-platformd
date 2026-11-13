# Staff invitations

How a new administrator gets an account, without anybody learning their password.

## The rule

**There is no public way into the admin portal.** The landing page offers two doors —
sign up as a customer, sign up as a rider — and nothing else. Staff accounts are
created by invitation from an existing super admin, or by a staff member with
`staff:write` using the older "create with a temporary password" form.

## What the super admin does

1. **Staff & roles → Invite an admin.**
2. Enter the email address, pick the roles, choose how long the link lives
   (24 hours to 14 days; 72 hours by default).
3. **Create invitation.** The link appears **once**:

   ```
   https://your-domain/admin-invite/<64-character token>
   ```

   Copy it and send it however you like — WhatsApp, email, in person.

4. Send the link. The invitee opens it and signs in at `/login?portal=admin`
   afterwards.

## What the invitee does

1. Opens the link. The page shows **which email address was invited** and the roles
   attached to it, so a forwarded link is obvious for what it is.
2. Chooses their own first name, last name, phone number and password.
3. Is signed in at the admin portal with the roles the invitation granted.

## Why the link is safe to treat as a credential

| Property | How it is enforced |
| --- | --- |
| Only a super admin can mint one | `staff:write` gates the route, and the service additionally requires `isSuperAdmin`. A staff member who can read the team list still gets 403. |
| Works exactly once | The claim is a conditional `UPDATE … WHERE usedAt IS NULL`. Two tabs opened at the same instant cannot both succeed. |
| Expires | Default 72 hours; the maximum is 14 days. Expiry is checked at both the peek and the accept step. |
| Can be withdrawn | **Withdraw** on the invitations list. A withdrawn link is refused with `INVITE_REVOKED`. |
| Cannot be re-read | Only the SHA-256 hash is stored. There is no endpoint that returns a token, so a lost link is replaced, never recovered. |
| Cannot be redirected | The email address is fixed by the invitation; the person accepting cannot change it. |
| Surprising acceptances are visible | The invitations list shows `pending → accepted`, and the audit log records `staff.invite` and the account creation. |

### The one honest limitation

The link is a **bearer credential**: whoever opens it first becomes that admin. That is
why it is short-lived by default, why minting is super-admin only, and why the list shows
what happened. If a link is sent to the wrong person, **Withdraw** it and mint another —
do not wait for it to expire.

## A failed sign-up does not burn the link

If the account cannot be created — the phone number is already in use, for example — the
claim is released and the invitation stays usable. The invitee corrects the form; nobody
has to ask for a new link.

## Related

* Endpoints: `POST/GET /api/v1/admin/invites`, `DELETE /api/v1/admin/invites/:id`,
  `GET /api/v1/auth/invites/:token`, `POST /api/v1/auth/invites/:token/accept`.
* Tests: `backend/test/admin-invites.e2e.spec.ts` — single use, expiry, withdrawal,
  non-super-admin refusal, and the failed-sign-up release.
* Provisioned accounts can be suspended on the same screen; suspension revokes their
  refresh tokens immediately.
