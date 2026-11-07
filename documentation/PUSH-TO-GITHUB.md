# Putting this project on your GitHub account

**State of the repository right now — verified, not assumed:**

| | |
|---|---|
| Commits | one per phase (Phase 1–10) plus documentation commits — count them with `git log --oneline | wc -l` |
| Branch | `main` |
| Tracked files | **393** |
| Total history size | 35 MB (mostly the screenshots and the build report) |
| Secrets in the history | **none** — scanned every tracked file for `sk_live_`, `FLWSECK-`, `ghp_`, `github_pat_`, AWS keys, Google keys and private keys; the single hit is the *word* `sk_live_…` inside `CREDENTIALS-SETUP.md` |
| `.env` in the repo | **no** — only `.env.example` files, with placeholders |
| `node_modules` / `dist` | excluded by `.gitignore` |
| Prepared for you | **two** files: `dispatch-platform.bundle` (35 MB, the repository as a portable bundle) and `dispatch-platform-github.zip` (66 MB, the same repository as an ordinary folder, `.git` included) |

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

> **Skip this part if you are using GitHub Desktop (Route 1 below)** — *Publish repository* creates the
> repository for you, private, with the right name. Creating it twice will only confuse things.

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

Download **`dispatch-platform-github.zip`** if you are using GitHub Desktop (Route 1), or
**`dispatch-platform.bundle`** if you are using the terminal (Route 2 / Part 3).

1. In the workspace file list, find **`dispatch-platform.bundle`** and download it.
2. Move it somewhere sensible — e.g. `~/Downloads/dispatch-platform.bundle`.

That one file contains every commit, every file, and the full history. It is not a zip: it is a
portable Git repository, which is exactly why the history survives the trip.

## Part 2b — If Git is not installed on your computer

`git` not being available is not a problem, and you do **not** need a terminal. There are three ways
forward; the first one needs nothing installed at all.

### Route 1 — GitHub Desktop (no terminal, no install of Git, keeps the full history)

GitHub Desktop ships its own copy of Git, so this works on a machine where `git` has never existed.

1. Download and install **GitHub Desktop** from <https://desktop.github.com> — sign in with your GitHub
   account when it opens.
2. Download **`dispatch-platform-github.zip`** from the workspace (66 MB) and **extract it** — you get a
   folder called `dispatch-platform`. (Windows: right-click → *Extract All*. macOS: double-click.)
   Extract it somewhere simple like `Documents\dispatch-platform`, **not** inside OneDrive or iCloud.
3. In GitHub Desktop: **File → Add local repository…** → choose the extracted `dispatch-platform`
   folder. It recognises it immediately, with all the commit history intact.
4. Click **Publish repository** (top bar). Set:
   - **Name:** `dispatch-platform`
   - **Description:** optional
   - **Keep this code private:** ✅ **tick it**
5. **Publish repository.** Wait for it to finish — 35 MB is a minute on a slow connection.

That is the whole job: no terminal, no token, no Git installation, and the history is preserved
because the `.git` folder travelled inside the zip.

> **Do not use GitHub's "upload files" web page instead.** It would flatten thirteen commits into one,
> drop the phase-by-phase history, and struggle with 393 files including large images.

### Route 2 — Install Git, then follow Part 3

Two minutes, and it is the most useful thing to have on a development machine anyway.

| System | Command / step |
|---|---|
| **Windows** | Open **PowerShell** and run `winget install --id Git.Git -e --source winget`. No winget? Download from <https://git-scm.com/download/win> and accept the defaults. **Then close and reopen the terminal** so it finds the new PATH entry. |
| **macOS** | `xcode-select --install` (this includes Git), or `brew install git` |
| **Ubuntu / Debian** | `sudo apt update && sudo apt install -y git` |

Check it with `git --version`, then continue from Part 3. Note that the terminal **must be reopened**
after installing — "not recognised" almost always means an old terminal window with an old PATH.

### Route 3 — I push it for you

Covered in the appendix at the bottom. It requires a 1-day token in this chat, which is exactly what the
other two routes exist to avoid — but it is there if you prefer it.

---

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

> > **Sanity check before you push.** Run `git log --oneline` inside the cloned folder. The oldest commit
> should be `Initial commit — dispatch platform, Phases 1 and 2`, and you should see one commit per phase
> after it. If the log looks complete, you have the whole history.

## Part 4 — Verify it landed (1 minute)

Refresh your repository page on GitHub. You should see:

- the full commit history — click *commits* and compare the count with `git log --oneline | wc -l`
- **393 files**
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
clone and I will rewrite the author on every commit to your name and the email on your GitHub account.
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

## Keeping GitHub current from now on

Part 3 is a one-off. This is the recurring habit.

**The rule:** every change made in the workspace is committed there, and the bundle is rebuilt in the same
step. So `dispatch-platform.bundle` is always the newest version of the repository — you never have to ask
"is the bundle current?".

**To bring GitHub up to date, three commands.** Download the fresh bundle first, then:

```powershell
# Windows PowerShell — from inside your clone of the repo
git fetch C:\Users\YOU\Downloads\dispatch-platform.bundle main
git merge FETCH_HEAD
git push
```

```bash
# macOS / Linux
git fetch ~/Downloads/dispatch-platform.bundle main
git merge FETCH_HEAD
git push
```

Then confirm the top commit matches what you were told:

```powershell
git log --oneline -3
```

If the newest commit there is the one from the bundle, GitHub now has it too.

**Before you do this, make sure your clone has no work of its own.** If you have edited files or committed
locally since the last sync, run `git status` first. A merge will then either fast-forward cleanly or stop
and ask you to reconcile — and it is much easier to see that coming than to undo it. Two safe habits:

- Pull before you push: `git pull --rebase`, then fetch and merge the bundle.
- Or tell me what you changed locally, and I will merge from your repository instead of writing over it.

**What the bundle does not carry.** It contains the branches and their commits — history, not the working
directory. Untracked things (your `backend/.env`, `node_modules`, uploaded files, any new file you have not
committed) are not in it, by design: the bundle is a git object store, and secrets have no business in one.

**If you would rather not run this by hand every time**, there are two options: keep your own work in your
clone and push it yourself while I only touch documentation, or use the scoped token in the appendix so I
push directly. Neither is required — the three commands above take about twenty seconds.

---

## If a secret is ever committed by mistake

1. **Rotate it first.** Treat it as public: changing the code afterwards does not un-leak it.
2. Then clean the history (`git filter-repo`) or, while the repository is young, delete it on GitHub and
   push a fresh history.

This is exactly why `PAYSTACK_SECRET_KEY` and friends are empty in `.env.example` and live only in the
server's own environment when you go live — and why the token in the appendix is scoped to a single
repository, with one permission, for one day.
