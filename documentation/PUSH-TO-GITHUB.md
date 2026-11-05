# Putting this project on your GitHub account

**State of the repository right now — verified, not assumed:**

| | |
|---|---|
| Commits | **11**, one per phase (Phase 1–10), on branch `main` |
| Branch | `main` |
| Tracked files | **393** |
| Total history size | 35 MB (mostly the screenshots and the build report) |
| Secrets in the history | **none** — scanned every tracked file for `sk_live_`, `FLWSECK-`, `ghp_`, `github_pat_`, AWS keys, Google keys and private keys; the single hit is the *word* `sk_live_…` inside `CREDENTIALS-SETUP.md` |
| `.env` in the repo | **no** — only `.env.example` files, with placeholders |
| `node_modules` / `dist` | excluded by `.gitignore` |
| Prepared for you | `dispatch-platform.bundle` (35 MB) — a single file containing the entire repository, history included |

There is **nothing to configure first** and **no account to set up in this chat**. You need about ten
minutes, and your own GitHub credentials never leave your computer.

---

## Why this way, and not "give me a token"

I could push for you, and there is a section at the bottom for that if you prefer it. But it would mean
your access token travelling through this conversation, where it is stored. The route below needs **no
token at all**: you download one file, and your own machine — which is already signed in to GitHub —
does the push. Same result, nothing to revoke afterwards.

---

## Part 1 — Create the empty repository (2 minutes)

1. Sign in at <https://github.com>.
2. Click **+** (top right) → **New repository**.
3. Fill in exactly this:
   - **Repository name:** `dispatch-platform`
   - **Visibility:** **Private**
   - **Do not tick anything else.** No README, no `.gitignore`, no licence. The repository has to be
     completely empty, or Git will reject the first push with `updates were rejected`.
4. **Create repository**. Leave the page open — you will need the URL.

> **Why private?** It is your company's platform, and it contains the pricing logic, the commission
> structure and the full investor-facing build report. You can flip it to public later in
> *Settings → General → Danger Zone*, but you cannot un-publish history that has already been cloned.

## Part 2 — Get the code out of this workspace (1 minute)

1. In the workspace file list, find **`dispatch-platform.bundle`** and download it.
2. Move it somewhere sensible — e.g. `~/Downloads/dispatch-platform.bundle`.

That one file contains all 11 commits, every file, and the full history. It is not a zip: it is a
portable Git repository, which is exactly why the history survives the trip.

## Part 3 — Push it from your computer (3 minutes)

Open a terminal in the folder that contains the bundle and run these five commands, replacing
`YOURNAME` with your GitHub username:

```bash
# 1. Rebuild the repository from the bundle
git clone dispatch-platform.bundle dispatch-platform
cd dispatch-platform

# 2. Forget where it came from, and point it at your new GitHub repository
git remote remove origin
git remote add origin https://github.com/YOURNAME/dispatch-platform.git

# 3. Send everything
git push -u origin main
```

**If Git asks for a username and password:** use your GitHub username, and a **personal access token**
as the password — GitHub stopped accepting account passwords in 2021. Create one at
*Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token*:
name it `dispatch-push`, expire it in **7 days**, **Repository access: Only select repositories →
dispatch-platform**, and set **Contents: Read and write**. Paste it when Git asks for the password.

### The path of least resistance, per operating system

| Your machine | Easiest route |
|---|---|
| **Windows** | Just run the commands. Git Credential Manager opens a browser window, you sign in, done. No token needed. |
| **macOS** | `brew install gh` then `gh auth login` and `gh auth setup-git`. After that `git push` simply works. (Keychain may also prompt you — either is fine.) |
| **Linux** | `gh auth login` if you have the GitHub CLI, otherwise a fine-grained token as the password, as above. |

> **Sanity check before you push.** Run `git log --oneline` inside the cloned folder. You should see
> **11 commits**, the newest being `docs: how to open the platform in a real browser`, the oldest
> `Initial commit — dispatch platform, Phases 1 and 2`. If you see the same, you have the whole history.

## Part 4 — Verify it landed (1 minute)

Refresh your repository page on GitHub. You should see:

- **11 commits** (click *commits* to check), **393 files**
- Folders `backend/`, `frontend/`, `packages/`, `scripts/`, `documentation/`, `docs/`, `deploy/`, `e2e/`
- `README.md` rendered on the landing page, with the amber-and-green badges block
- A green **main** badge — GitHub sets the default branch automatically on first push

Then check three things yourself, because they are the ones that matter:

1. **There is no `backend/.env`** (the file holding real secrets). The only environment files in the
   repository are `.env.example` at the root and `deploy/.env.example` — open either and confirm the
   values are placeholders such as `replace-with-openssl-rand-hex-32`, not real secrets.
2. **There is no `node_modules/`** anywhere.
3. **`documentation/BUILD-REPORT.html`** is there and is 5.3 MB. GitHub will not render it in the file
   view (it is too large and full of inline images) — download it and open it locally instead.

---

## Part 5 — Optional: make the commits yours

Every commit is currently authored as `Dispatch Build <build@dispatch.local>`, which is why GitHub will
not attribute them to your profile. If you want the history to read as yours, say so **before** you
clone and I will rewrite the author on all 11 commits to your name and the email on your GitHub account.
Thirty seconds of work, and it is much easier before the repository exists than after.

---

## What this does *not* do

- **It does not deploy anything.** Pushing to GitHub is storage, not hosting. The deployment roadmap
  (server, database, domain, TLS, payments, then go-live) is a separate document, and it is the next
  thing we do.
- **It does not connect this workspace to GitHub.** The sandbox has no way to reach your account without
  a credential, which is the whole point. If you later want me to push directly — convenient for final
  polish — you add a 1-day fine-grained token and I use it once; until then, each batch of changes can be
  exported as a fresh bundle for you to push, or we set up the remote properly at that time.
- **It does not change your local-only state.** Nothing in the workspace is deleted by doing this.

---

## Appendix — If you would rather I push directly

Only if you prefer it. Then:

1. Create a **fine-grained** token: *Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token*
   - Name: `dispatch-push` · Expiration: **1 day**
   - Repository access: **Only select repositories** → `dispatch-platform`
   - Permissions: **Contents: Read and write** — everything else **No access**
   - Do **not** create a classic `ghp_…` token; those carry account-wide scope.
2. Tell me the token and the repo URL. I push, verify the commits are visible on GitHub, and tell you to
   delete the token immediately.
3. **Revoke it as soon as I confirm** — *Settings → the token → Delete*. Revoking takes five seconds and
   makes a leaked token worthless.

Understand the trade-off before choosing this: anything sent in this chat is stored in the conversation,
and a token — even a narrow one — is a credential. The bundle route in Part 3 exists precisely so that
you never have to make that trade.

---

## If a secret is ever committed by mistake

1. **Rotate it first.** Treat it as public: changing the code afterwards does not un-leak it.
2. Then clean the history (`git filter-repo`) or, while the repository is young, delete it on GitHub and
   push a fresh history.

This is exactly why `PAYSTACK_SECRET_KEY` and friends are empty in `.env.example` and live only in the
server's own environment when you go live — and why the token in the appendix is scoped to a single
repository, with one permission, for one day.
