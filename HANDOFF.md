# Hand-off notes for whoever continues this project (human or Claude)

Read this first. It explains how the app is built, how updates are delivered, what was done last and what is next.

## The people and the setup

- **Owner / builder:** Reymark Regencia. He uploads files to GitHub himself and commits. **Never commit or push for him** — deliver a zip.
- **Every update zip must come with a ready-to-paste commit title and description**, written for a non-technical reader (bullets, plain words).
- **Repo:** `regenr28/duda-site-audit` (branch `main`). Commits are numbered (`134 - …`, `135 + 136 - …`, `137 - …`). The next update is **138**.
- **Two deployments, both auto-deploy from `main`:**
  - **Company app** ("8bit"): 8bitcreative's Vercel, database = Supabase (Postgres-backed KV). URL `duda-site-audit.vercel.app`.
  - **Reymark's quiet copy** (`duda-site-audit-draft`): his own Vercel + Upstash Redis, env `APP_COPY=1`. It switches some things off on purpose (System health → "copy" banner lists them). Be careful with it: don't break it, don't fill its database.
- **Secrets:** API keys go straight into Vercel → Settings → Environment Variables (marked Sensitive) or a password manager. Never in chat, Slack, email, the repo or a zip. Never upload a real `.env`. Never decrypt or print env values. If someone pastes a key in chat, tell them to rotate it.

## How the app is built

- **Server:** Vercel serverless functions, Node ESM, one file per endpoint in `api/*.js`. Files starting with `_` are shared modules, not endpoints. Every handler ends with `export default metered('<name>', handler)` (usage metering, `api/_meter.js`).
- **Storage:** a Redis-style KV through `redis(...cmds)` from `api/_lib.js` (pipeline of commands). Every key starts with `P = 'dsa:'`. Works on Upstash and on the Supabase adapter (`api/_sql.js`). Big JSON is stored with `packJSON`/`unpackJSON`.
- **Front end:** plain JavaScript, no framework. `public/index.html` loads `styles.css`, `engine.js`, `app.js` with `?v=` numbers. **Bump the `?v=` of every file you change** (after 137: styles v21, engine v8, app v24).
- **The audit engine** is `public/engine.js` (`window.DudaAudit`). The server imports the same file (`import '../public/engine.js'` → `globalThis.DudaAudit`) so the rules are identical on both sides.
- **Check releases:** `CHECK_RELEASES` in engine.js. `CHECKS_VERSION` = the last entry's `v` (keep entries in order). An entry's `fixes: [codes]` closes items with those codes as "check-corrected" (the app's own mistake) on the next scan when they disappear. Latest is v26.
- **Item groups:** `must` (everything important), `polish` (FONT_*, IMAGE_DUPLICATE) and `length` (META_TITLE_LONG/SHORT, META_DESC_LONG/SHORT, ALT_LONG). `groupOf(f)` in engine.js. The server summary (`api/store.js` `summary()`) counts must-only in `critical/warning/info/closed/total`, polish in `pt/pc/po`, lengths in `lt/lc/lo`.
- **AI:** `api/ai.js` (proofreading, wrong-page links, alt text, business name/location wording, verification pass). Answers cached 45 days in `aic:<hash>`. Several providers with fallbacks; the company app uses Anthropic/OpenAI keys, the copy uses free providers.
- **Auto audit (live websites):** `api/_watch.js` reads the ~700 published websites (plain HTML) for contact-info discrepancies. Per-site result `cw:<dudaId>`, summary hash `cwsum` (`n` issues, `c` criticals). Cron in `api/watch.js` (also runs the "forms gone quiet" alert from `api/_leadkv.js`).
- **Roles and permissions:** `PERMISSIONS`, `BUILTIN_ROLES` (admin, member), `can(user, perm)` in `api/_lib.js`. Admin and the owner (`OWNER_EMAIL`) have everything.
- **Website statuses** (`SITE_STATUSES` in store.js): Not started, In progress, Complete with query, Complete, On hold. Item states in `fstate:<siteKey>` (open, done, false, clarification, hold…). Website activity log already exists (`l.site.activity`).
- **Projects:** `api/_project.js` (phases, including a "Jaguars" phase).
- **Help and What's New:** every user-visible change gets an entry in `api/_help.js` (Guide + search) and `api/_news.js` (What's New, newest first, id `YYYY-MM-DD-slug`). `node scripts/check-search.mjs` checks the help search.

## How to test

The test suite is in `tests/` (end-to-end tests with Playwright + a fake Redis and fake AI). Run everything with `bash tests/run-all.sh`. Run one test with `python3 -I tests/tk/e2e_polish.py "$PWD" "$PWD/tests"`. Some tests (e2e_customers) are timing-sensitive under load; rerun alone before believing a failure. Look at the screenshots the tests write, on desktop and phone width, light and dark.

## How to deliver an update

1. Make the change, bump `?v=` numbers, add Help + What's New entries, run the tests.
2. Zip only the changed files with their folders (`zip update-137.zip api/x.js public/app.js …`).
3. Send the zip plus the commit title and description. Don't commit.
4. Once Reymark says it's uploaded: `git fetch && git merge --ff-only origin/main`.

## Where things stand (15 Oct 2026)

- **On GitHub:** up to 134 when this was written. **Delivered as zips:** 136 (includes 135: hidden content checks, Lengths tab, alt-text/punctuation/spacing checks, Google Maps ID confirmation) and 137 (Jaguars board, below). 137's zip also contains every 135/136 file, so uploading 137 alone brings GitHub fully up to date. Check `git log origin/main` and ask Reymark if unsure.
- **Waiting on keys (Reymark adds them in Vercel):** `GOOGLE_MAPS_API_KEY` (Google Maps ID check, Online presence), PageSpeed key, a Google service account (GA4 + Search Console). Rotating the Anthropic/OpenAI keys was recommended.

## Update 137 — the Jaguars task board (built)

The Jaguars are a team of 6 being onboarded. Their job: fix all the audits. Agreed design:

- **New role "Jaguar":** can take websites from the queue, scan, fix/close items, mark them false alarm or needs clarification, hand single items to another Jag or an admin. Can't change queue settings, remove audits, or see websites that aren't theirs.
- **New permission "Approve Jaguar audits"** (admins have it; QA are admins for now).
- **New Tasks tab** with a board: **Queue → In progress → Needs review → Complete.**
  - The queue = live websites with critical issues from the auto audit (`cwsum`), in the order the admin chooses: oldest first, newest first, most errors first, fewest errors first. Admins can pin a website to the top. A note says the counts are contact-info errors from the auto audit; the full count shows after the scan.
  - **First in, first out:** a Jag clicks **"Take next"** and gets the top website. With the lock on (admin switch, this tab only), other queue cards can't be taken. A **per-Jag limit** on websites held at once (start at 1).
  - Queue cards don't show the issues. Once taken and scanned, the card shows its error count to everyone, plus progress like "Criticals: 0 left · All items: 23 left".
  - **Complete means everything is fixed** — must-fix, Design polish and Lengths. "Done" rescans first and only completes if nothing is open.
  - If any item is false alarm or needs clarification → **Needs review**; an approver approves or sends it back with a note.
  - **Reassigning a whole website needs a note** (why). Every card has an activity log. Notifications for assigned, sent back, approved.
  - Scanned websites appear on the Audits tab as usual (a scan creates the audit).
- **How it's built:** `api/jags.js` (endpoint, all rules; keys `jag:cards` hash Duda id → card, `jag:set` settings, `jag:taking:<id>` 20 s take lock). Front end: `renderTasks`, `jgNote`, `jgHand`, `jgLog` in `public/app.js` (search "TASKS — the Jaguars board"); styles `.jg-*`. Role `jaguar` and permissions `jags.take` / `jags.lead` in `api/_lib.js`; notification kinds `jag-assign`, `jag-back`, `jag-approved`, `jag-review` (in the "Work assigned to you" group). Help section `jaguars`, test `tests/tk/e2e_jags.py`.
- **Done rule as built:** the card needs a scan finished after it was taken AND after the last item marked fixed by hand; no open items in any group (items For clarification don't block); false alarms marked since taking it, clarification or hold items → Needs review.
- **Release** (hand on → "Nobody: put it back in the queue") removes the card; the audit goes to "Not started"; its history stays in the audit's Activity tab.

## Next: update 138

- **Update 138:** the Tasks tab also gets **Projects** (projects in the Jaguars phase assigned to me) and **Special tasks** (one-off tasks an admin creates: title, notes, link, due date, assignee).
