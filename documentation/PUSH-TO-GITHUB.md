# Getting this project onto your GitHub account

The repository is **already committed and ready** — 150 files, one clean commit, no secrets.
There are only two things left: create the empty repo on GitHub, then send the commits there.

---

## Part 1 — Create the empty repository on GitHub (2 minutes)

1. Sign in at <https://github.com>.
2. Click the **+** in the top-right → **New repository**.
3. Fill in:
   - **Repository name:** `dispatch-platform`
   - **Visibility:** **Private** (recommended while it is unfinished — you can flip it to public later
     in Settings → General → Danger Zone)
   - **Do NOT** tick "Add a README", "Add .gitignore" or "Choose a license". The repo must be
     completely empty, or the first push will be rejected.
4. Click **Create repository**. Leave the page open — you need the URL it shows.

---

## Part 2 — Choose how the code gets there

### Option A — I push it for you (fastest)

You create a **temporary, narrowly-scoped** access token, and I use it once to push:

1. GitHub → your avatar → **Settings** → **Developer settings** (bottom of the left sidebar)
   → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. Set:
   - **Token name:** `dispatch-push`
   - **Expiration:** **1 day** (the shortest available)
   - **Repository access:** **Only select repositories** → `dispatch-platform`
   - **Permissions** → Repository permissions → **Contents: Read and write**
     (everything else stays *No access*)
3. **Generate token** and copy the value (`github_pat_…`).
4. Send me that token **and** your repo URL, e.g. `https://github.com/yourname/dispatch-platform`.
5. I push, confirm the commit is visible on GitHub, and immediately tell you to **revoke the token**
   (Settings → Developer settings → the token → Delete). Revoking takes 5 seconds and makes the
   token worthless even if it leaks later.

> **Be aware:** anything you paste in this chat is stored in the conversation. That is why the token
> above is scoped to one repository, with only write access to contents, and expires in a day.
> Never send a classic `ghp_…` token with full account access, and never send your password.

### Option B — You push it yourself

Download the repository bundle from the workspace (`dispatch-platform.bundle`), then on your own
computer:

```bash
# 1. Recreate the repository from the bundle
git clone dispatch-platform.bundle dispatch-platform
cd dispatch-platform

# 2. Point it at your new GitHub repository (use YOUR username)
git remote add github https://github.com/YOURNAME/dispatch-platform.git

# 3. Send everything
git push -u github main
```

Git will ask for credentials: use your GitHub username as the username, and a personal access
token as the password (GitHub stopped accepting account passwords in 2021).

---

## Part 3 — Verify

Refresh your repository page. You should see:

- **150 files**, one commit: *"Initial commit — dispatch platform, Phases 1 and 2"*
- Folders: `backend/`, `frontend/`, `packages/`, `scripts/`, `documentation/`, `screenshots/`
- `README.md` rendered on the landing page
- **No `.env` file** and **no `node_modules`** — confirm this yourself, it matters

Click `backend/.env.example` and check that every secret line is a placeholder
(`replace-with-openssl-rand-hex-32`), not a real value.

---

## What was deliberately NOT uploaded

| Excluded | Why |
|---|---|
| `backend/.env` | Contains your local JWT secrets and the Postgres password. `.gitignore` blocks it. |
| `node_modules/`, `dist/`, `build/` | Generated, huge, and reproducible with `npm install` |
| `*.log`, `playwright-report/`, `test-results/` | Machine-specific test output |

`.env.example` **is** included, with placeholders only. That is the file another developer (or a
future you on a new laptop) copies to `.env` and fills in.

---

## If you ever commit a secret by mistake

1. **Rotate the secret immediately** — treat it as public. Changing the code does not un-leak it.
2. Then clean the history (`git filter-repo`) or, for a young repository, delete it on GitHub and
   push a fresh history.

This is why `PAYSTACK_SECRET_KEY` and friends stay empty in `.env.example` and live only in the
server's own environment when you go live.
