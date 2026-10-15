# Hand-off notes for whoever continues this project (human or Claude)

Read this first. It explains how the app is built, how updates are delivered, what was done last and what is next.

## The people and the setup

- **Owner / builder:** Reymark Regencia. He uploads files to GitHub himself and commits. **Never commit or push for him** — deliver a zip.
- **Every update zip must come with a ready-to-paste commit title and description**, written for a non-technical reader (bullets, plain words).
- **Repo:** `regenr28/duda-site-audit` (branch `main`). Commits are numbered (`134 - …`, `135 + 136 + 137 - …`, `138 + 139 - …`, `140 - …`, `141 - …`, `142 - …`, `143 - …`). The next update is **144**.
- **Two deployments, both auto-deploy from `main`:**
  - **Company app** ("8bit"): 8bitcreative's Vercel, database = Supabase (Postgres-backed KV). URL `duda-site-audit.vercel.app`.
  - **Reymark's quiet copy** (`duda-site-audit-draft`): his own Vercel + Upstash Redis, env `APP_COPY=1`. It switches some things off on purpose (System health → "copy" banner lists them). Be careful with it: don't break it, don't fill its database.
- **Secrets:** API keys go straight into Vercel → Settings → Environment Variables (marked Sensitive) or a password manager. Never in chat, Slack, email, the repo or a zip. Never upload a real `.env`. Never decrypt or print env values. If someone pastes a key in chat, tell them to rotate it.

## How the app is built

- **Server:** Vercel serverless functions, Node ESM, one file per endpoint in `api/*.js`. Files starting with `_` are shared modules, not endpoints. Every handler ends with `export default metered('<name>', handler)` (usage metering, `api/_meter.js`).
- **Storage:** a Redis-style KV through `redis(...cmds)` from `api/_lib.js` (pipeline of commands). Every key starts with `P = 'dsa:'`. Works on Upstash and on the Supabase adapter (`api/_sql.js`). Big JSON is stored with `packJSON`/`unpackJSON`.
- **Front end:** plain JavaScript, no framework. `public/index.html` loads `styles.css`, `engine.js`, `app.js` with `?v=` numbers. **Bump the `?v=` of every file you change** (after 143: styles v26, engine v10, app v29).
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

- **On GitHub:** up to 142 (commit `992b721`). **Delivered as a zip, maybe not uploaded yet:** 143 (pick pages to exempt from the website's list, below). Check `git log origin/main` and ask Reymark if unsure.
- **Deploy hiccup (15 Oct):** Vercel didn't build the 137 commit on its own (no deployment, no GitHub status, in either project). The copy was deployed by hand (Vercel → Create Deployment from `main`). If it happens again, that's the fix; the company project needs it done from 8bitcreative's Vercel.
- **Harmless log noise:** red `[DEP0169] url.parse()` lines in Vercel's runtime logs are a Node 24 deprecation warning from outside the app's code. Requests succeed.
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

## Update 138 — joining the team (built)

- **Sign-up Slack check:** `op: 'slackcheck'` in `api/auth.js` (no sign-in needed; answers only yes/no, 20 per hour per network address). The form (`#auSlack` in `renderAuth`) warns when the email isn't on Slack.
- **Admins alerted:** `announceSignup` in `api/_lib.js` adds "⚠️ This email is not on our Slack" to the bell/Slack/email alert and stores `slackMissing` on the user (badge in Members → Admin for Approval).
- **Approve with a role:** the approval row has a role picker (required). `op: 'approve'` in `api/users.js` takes `role`, sets it, and sends a Slack DM (kind `approved`) with a **Sign in** button (Jaguars → `/#/tasks`, others → `/#/`). Sign-ups chose their own password, so nobody is asked to change it; only admin-created accounts (temporary password) must change it on first sign-in. Giving Admin needs `members.manage`.
- Test: `tests/tk/e2e_signup_slack.py`.
- **Send to Jaguars (from an audit, `jags.lead`):** `op: 'send'` in `api/jags.js` → card state `queued` (new state: in the queue, sent by an admin, audit unassigned and "Not started") or `progress` with the chosen person. `buildQueue` adds `queued` cards; `take` accepts them.
- **Audits list hides board websites:** the `list` op in `api/store.js` reads `jag:cards` and marks summaries `board: {state, byName}` for queued/progress/review cards; `renderSites` filters `!x.board` (local `SITES`) and shows a count linking to Tasks. Complete cards are listed again.

## Update 139 — exceptions (built)

- **Engine** (`public/engine.js`): `EXEMPT_GROUPS` (contact, meta, headings, content, links), `exemptGroupOf(f)`, `exemptPath`, `exemptMatch(pattern, path)` (exact path or `*` wildcards), `exemptRuleFor(f, rules)` (audit items: every page of the item must match, or a set value matches), `exemptIssueRule(x, rules)` (auto audit issues).
- **Storage:** sets `exsets` = `{ v, sets: [...] }` (admins, permission `exempt.global`); one website's page exceptions `exsite:<duda id>` = `[...]` (anyone on the team). Endpoint `api/exempt.js`.
- **Applied in `loadSite`** (`api/store.js`): an `open` item an exception covers gets `status: 'exempt'` and `f.exempt = {id, kind, name, by}`, computed on every load (nothing stored in `fstate`), so removing an exception reopens items. `summary()` counts Exempt as closed (`counts.exempt`) and stores `exv`; the list op re-counts summaries whose `exv` differs from the sets' `v` (30 per load).
- **Auto audit:** `readSite` in `api/_watch.js` drops issues `exemptIssueRule` covers (from the next read of each website).
- **Check first:** `op: 'preview'` (admins) counts, per audit, items a set change would make Exempt (`gain`) or bring back (`back`), reading every audit in chunks of 30. One website's preview is computed in the browser (`exImpact`). Forms are two steps (form → table → "Are you sure?"); removals list what comes back first.
- **Front end:** `openExceptions`, `exemptForm`, `drawExceptionSets` in `app.js` (search "EXCEPTIONS —"); 🚫 Exceptions button on the audit; 🚫 Exempt this page… in the item panel; Settings → 🚫 Exceptions. Test: `tests/tk/e2e_exempt.py`.

## Update 140 — audit exceptions reworked (built)

- One website's exception has `scope`: `all` (values only: phone, email, address, city, state, name, social — fine anywhere on the website) or `pages` (pages + what not to check). A reason (`note`) is required for website exceptions and sets.
- Engine: `placeValueIn` matches address (loose) and city/state (whole word) values inside an item's text.
- Audit page: **🚫 Audit exceptions** tab (`renderExceptionsTab`, route `#/site/<id>/exceptions`); `openExceptions` now goes there. Forms use `chipField` (+ Add / Enter, chips with ✕). Preview first: Exempt/Save stay disabled until **👁 Preview** and switch off again on any change. Set previews (`op: 'preview'`) return up to 40 items per website (`items`), shown in an expandable list.
- Item panel: **🚫 Exempt this page…** and **🚫 Exempt this <phone/email/…> on the whole website…** (`exValueOf`).

## Update 141 — cleaner audit header (built)

- `renderSite` header (`.site-head`): title + "also here" badge; one meta line (`.sh-meta`: site ID, published, last scan, `backupShort`, added by; details on hover); a bar with owner/status on the left and **Open ▾** (`#sOpen`), **⋯** (`#sMore`), **⟳ Rescan** on the right. Menus use `popMenu(anchor, items, bind)` / `closePop()` (keyboard: arrows, Escape). Menu item ids keep the old button ids (`#sViewAs`, `#sSum`, `#sCsv`, `#sBackup`, `#sExempt`, `#sJag`), so tests open the menu first.
- Scan panel: AI line folds into `<details data-ui="scanai">` with `aiShort()`; Reference data `<details data-ui="ref">` starts closed. Any `<details data-ui="x">` remembers open/closed per browser (`uiOpen`, localStorage `dsa-open-x`).
- Audits list: a board website stays visible to the person holding it (`board.by`), tagged "🐆 Yours on Tasks"; the empty message for people who can't add websites points to Tasks. Test: `tests/tk/e2e_head.py`.

## Update 142 — profile photos and the people picker (built)

- Photos: `op: 'photo'` in `api/users.js` (a data URL, JPEG/PNG/WebP, ≤ 60,000 chars; empty removes it), stored as `user.photo`, sent in `publicUser`. The browser crops and shrinks it first (`squarePhoto`, 160px JPEG, usually 5-15 KB). `avatar()` shows it. Upload/remove in **Your account** (`openMe`).
- People picker: any `<select data-people>` is enhanced automatically (a `MutationObserver` calls `ppEnhance`): the select is hidden, a `.pp-btn` shows photo + name, and `ppOpen` lists options grouped by role (Unassigned and other non-email options first; Admins, Jaguars, Members, other roles; "Switched off"), with emails, a search box (6+ people), keyboard support. Picking sets the select's value and fires its `change` event, so the old handlers still save. Used on: audit owner (`#sAssign`), Audits rows (`data-assign`), item rows (`data-fwho`), item panel (`#drWho`), bulk assign (`#bulkWho`), Add website (`#addWho`). Clients never appear. Test: `tests/tk/e2e_people.py`.

## Update 143 — pick pages to exempt (built)

- In `exemptForm` (Specific pages): `exSitePages(s)` lists the pages the last scan read (`site.pages`, minus missing ones) with title and open/exempt item counts, a filter box, tick boxes (add/remove exact-path chips); pages a wildcard chip covers show ticked and disabled. `chipField` gained `note` (chip note: "N pages" for patterns), `onType` (live "Matches N pages: …" hint) and returns `redraw`.

## Next: update 144

- **Update 144:** the Tasks tab also gets **Projects** (projects in the Jaguars phase assigned to me) and **Special tasks** (one-off tasks an admin creates: title, notes, link, due date, assignee).
