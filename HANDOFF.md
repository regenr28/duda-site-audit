# Hand-off notes for whoever continues this project (human or Claude)

Read this first. It explains how the app is built, how updates are delivered, what was done last and what is next.

## The people and the setup

- **Owner / builder:** Reymark Regencia. He uploads files to GitHub himself and commits. **Never commit or push for him** — deliver a zip.
- **Every update zip must come with a ready-to-paste commit title and description**, written for a non-technical reader (bullets, plain words).
- **Repo:** `regenr28/duda-site-audit` (branch `main`). Commits are numbered (`134 - …`, `135 + 136 + 137 - …`, `138 + 139 - …`, `140 - …` … `143 - …`, `144 - …`). The next update is **184**.
- **Two deployments, both auto-deploy from `main`:**
  - **Company app** ("8bit"): 8bitcreative's Vercel, database = Supabase (Postgres-backed KV). URL `duda-site-audit.vercel.app`.
  - **Reymark's quiet copy** (`duda-site-audit-draft`): his own Vercel + Upstash Redis, env `APP_COPY=1`. It switches some things off on purpose (System health → "copy" banner lists them). Be careful with it: don't break it, don't fill its database.
- **Secrets:** API keys go straight into Vercel → Settings → Environment Variables (marked Sensitive) or a password manager. Never in chat, Slack, email, the repo or a zip. Never upload a real `.env`. Never decrypt or print env values. If someone pastes a key in chat, tell them to rotate it.

## How the app is built

- **Server:** Vercel serverless functions, Node ESM, one file per endpoint in `api/*.js`. Files starting with `_` are shared modules, not endpoints. Every handler ends with `export default metered('<name>', handler)` (usage metering, `api/_meter.js`).
- **Storage:** a Redis-style KV through `redis(...cmds)` from `api/_lib.js` (pipeline of commands). Every key starts with `P = 'dsa:'`. Works on Upstash and on the Supabase adapter (`api/_sql.js`). Big JSON is stored with `packJSON`/`unpackJSON`.
- **Front end:** plain JavaScript, no framework. `public/index.html` loads `styles.css`, `engine.js`, `app.js` with `?v=` numbers. **Bump the `?v=` of every file you change** (after 183: styles v48, demo v3, engine v21, app v62).
- **The audit engine** is `public/engine.js` (`window.DudaAudit`). The server imports the same file (`import '../public/engine.js'` → `globalThis.DudaAudit`) so the rules are identical on both sides.
- **Check releases:** `CHECK_RELEASES` in engine.js. `CHECKS_VERSION` = the last entry's `v` (keep entries in order). An entry's `fixes: [codes]` closes items with those codes as "check-corrected" (the app's own mistake) on the next scan when they disappear. Latest is v29.
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

## Where things stand (10 Nov 2026)

- **On GitHub:** up to 146 (commit `bbbdf84`, "145 + 146 - …"). Up to 159 on GitHub (`16b9708`). Up to 169 on GitHub (`1423e8f`). **Delivered as a zip, maybe not uploaded yet:** 170 (time zones; another tab's dragged order sticks; old tabs marked).
- **Vercel didn't build 145 + 146 on its own** (Git connection had dropped on both projects; the company project was reconnected 10 Nov). If a commit doesn't deploy: Settings → Git (reconnect), then Deployments → ⋯ → Create Deployment with `main`.
- **Custom domain:** `audits.8bitcreative.com` added to the company project (10 Nov); needs the CNAME at 8bitcreative.com's DNS, the Google sign-in origin and `APP_URL`. Check `git log origin/main` and ask Reymark if unsure.
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
  - **Complete means everything is fixed** — must-fix, Design polish and SEO Lengths. "Done" rescans first and only completes if nothing is open.
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

## Update 144 — on hold, peeking, watchers (built)

- **On hold:** `op: 'hold'` (holder or lead, note required) → card `state: 'review'`, `card.hold = {note, at, by}`, audit status "On hold", approvers told; frees the Jaguar's slot (only `progress` counts). `op: 'resume'` → back to `progress` with the same person. `approve` is refused for held cards; `sendback`/`reassign` clear the hold. UI: ⏸ On hold on the card, ⏸ Put on hold on the audit (`#sHold`), ▶ Resume on held cards.
- **Owner/status for people without `site.manage`** (Jaguars) are shown as text (`.ro-who`, `.ro-pill`) on the audit header and Audits rows, instead of controls that fail.
- **Watchers:** `site.watchers = [{email, name, how: 'peek'|'assigned'|'mentioned', at}]`; summaries carry `watch: [{e, h}]`. `canSeeSite` and the Audits list include watchers. `bringIn()` in `api/store.js` adds item assignees (`patchFinding`) and @mentioned people (`comment`) to `site.people` + watchers, logged.
- **Peek:** setting `peek` on the board (admins). `op: 'peek'` (dudaId) adds a `peek` watcher (logged); `op: 'unpeek'` (auditId) removes it (logged). Peek-only users (`peekOnly()`) are refused every store write except comments (guard at the top of the POST switch); the page gets `body.ro-site` (CSS disables editing controls) and a "You're watching" note with Stop watching. Test: `tests/tk/e2e_jags2.py`.

## Update 145 — watching and reviewing (built)

- **Peek notifies the holder (bell only):** `op: 'peek'` in `api/jags.js` tells the card's holder (kind `jag-watch`, its own notify group `watching` with `channels: ['bell', 'popup']` (no Slack); `wants()` now refuses slack/popup for a group that doesn't list them, and `popupMuted` in app.js likewise; KIND text in `api/_lib.js`; `notifLink` opens the audit) when a new watcher is added and the card is in progress or review.
- **Watchers on cards:** the board GET adds `watchers: [{email, how}]` to every card from the audit summary's `watch` (holder left out). Front end `watching(c)` in `renderTasks` shows their avatars after 👁 (hover: name + how). Note: a peeker later given an item has `how: 'assigned'`.
- **Needs review lists the flagged items:** `reviewItems(list)` in `api/jags.js` (one pipeline: site, `fstate`, `fnum` per review card without `hold`) → `card.reviewItems: [{id, num, status, message, by, at, ok}]` = false alarms marked since `takenAt` (not `auto`), plus every For clarification / On hold item; max 40. Front end `revItems(c)` lists them with links `#/site/<auditId>/item/<num>`. Approvers: **✓ OK** → new `op: 'itemok'` (`{dudaId, findingId, ok}`, `jags.lead`, stored as `card.itemOk[findingId] = {by, byName, at}`, cleared by approve/sendback); **↺ Reopen** → store `patchFinding` status `open`. Reopened numbers are kept in `jg.reopened[dudaId]` and pre-fill the **Send back** note ("Reopened #1, #4: ").
- **Duplicate "Comments waiting" Slack fix:** `alertStale` in `api/comments.js` runs on every Duda comments load; concurrent loads all saw "nothing said yet". Each due website is now claimed with `SET dsa:cmtclaim:<site> NX EX QUIET_HOURS*3600` before sending; only the winner sends; the claim is deleted when the website is answered.
- **Only mine filter:** `.jg-filter` above the board, `localStorage dsa-jg-mine`; `involved(c)` = holder, `sentBy`, or in `watchers`. Queue never filtered.
- Styles `.jg-watch`, `.jg-w`, `.jg-ri*`. Help `jaguars` ("Reviewing a website", peek notice), What's New `2026-10-16-review-items`. Test: `tests/tk/e2e_jags2.py` (145 section).

## Update 146 — every page read against its address (built)

Why: the hhceramiccoatings.com owner scanned his website and found what the audit missed: `/locations/nolanville-tx/ceramic-coating` was about PPF (and the PPF page about ceramic coating), the Temple PPF page's H1 said "Copperas Cove", the Georgetown H1 said "Harker Heights Ceramic Coating" (singular), and `/fort-hood-window-tint-law` still had "[Matthew: confirm this is free before publishing.]".

- **Rules (engine.js `pageFitFindings`, run in `runScan` after the cross-page duplicates):** `servicesOfPath` (last address segment naming a service: ppf, tint, ceramic, graphene, correction, wrap, headlight, detailing) and `placeOfPath` (`/locations/<town>-<st>/`, any `…-<town>-<st>` segment, or the segment after `locations|service-areas|areas|cities…`). The business's own name(s) are removed first (`withoutNames`). `PAGE_TOPIC_MISMATCH` critical per part (SEO title, H1, meta description) naming another primary service (ppf/tint/ceramic) and not the address's; `PAGE_TOPIC_BODY` warning when another primary service has ≥6 mentions and ≥3× the address's (critical if a headline was also wrong; not on blog paths). `PAGE_WRONG_CITY` critical when a title/H1/description names another of the site's towns and not its own; `PAGE_WRONG_CITY_BODY` when copy names another town ≥3 times and more than its own (home town left out). Town mentions must be capitalised ("temple" the word doesn't count). Town-only pages get the town check only.
- **Business name (`nameVariants`):** near-twin spellings in Business Info ("Coating"/"Coatings") no longer excuse each other: the one the website uses most is the name, the other is reported ("Business Info has this spelling too"). The name without LLC/Inc is a target too; a one-letter slip of any other Business Info name counts (but not singular/plural against an alias). Critical in an H1 or SEO title (SEO titles are now checked; `textIndex` rows carry `heading`).
- **Notes left in (`PLACEHOLDERS` + `DEFAULT_LABEL`):** `[Name: …]`, `[note/todo/insert/confirm…]`, "… before publishing", "note to client", "pending client approval", "insert … here", FIXME, and Duda default labels alone ("Button", "Heading", "Subtitle"…).
- **AI (`op: 'pagefit'` in `api/ai.js`, `PAGEFIT_SYSTEM`, cached `f1<hash>` 45 days):** `runScan` returns `res.fit` (not saved: path, title, description, H1s, H2/H3s, 2,400-character excerpt, `urlServices`, `urlPlace`); `aiDeepCheck` in app.js sends 6 pages per call before proofreading; `applyPageFit` makes `AI_PAGE_TOPIC/CITY/NAME/NOTE` (critical for title/H1/description and notes, warning for body; confidence ≥0.7) or attaches `.ai` to the rule's item. `TEXT_SYSTEM` now says another town in a title/heading on a different town's page IS wrong_location. Scan panel line "Read N pages against their address".
- `PAGE_WRONG_CITY*` and `AI_PAGE_*` are full-rescan only (`RECHECK_SITE_WIDE`). CHECK_RELEASES v27.
- **"Lengths" → "SEO Lengths"** everywhere in the UI and Help (old What's New entries left as written).
- Help `rules` + `ai` paragraphs, What's New `2026-11-10-page-fit`. Test: `tests/tk/e2e_pagefit.py` (an hh-like website, Business Info with both spellings).

## Audit checklist (every website, every scan — add to it when a client finds something we missed)

- Each page matches its address: service in the URL = service in the SEO title, H1, meta description and most of the copy.
- Town pages name their own town (not a sister page's) in the title, H1 and description, and mostly in the copy.
- The business name is spelled one way everywhere, H1s and titles included (watch singular/plural, LLC, "&"/"and").
- No notes left in: [Name: …], TBD, "before publishing", "insert … here", a button that says "Button".
- Contact details, other businesses' names, placeholder text, broken links, alt text, schema (the existing checks).
- Biggest clients: rescan and read the critical list before telling the client the website is done.

## Update 147 — demo mode (built)

- `public/demo.js` (loaded before engine/app, `window.DemoMode`). On with `?demo=1` (removed from the address), the profile's **🎭 Start demo mode**, or Search "demo"; `localStorage dsa-demo` = end time (8 h). Off with the bar's **Exit demo** or `?demo=0`.
- `api()` in app.js: in demo mode every non-GET goes through `DemoMode.allowWrite(path, body)` (allowed: auth logout/me, pulse, check, social, ops preview/help/test; answered quietly: seen/opened/read/checked/busy/seclog/presence/thumb; everything else refused with a "view-only" toast), and every JSON answer goes through `DemoMode.harvest(data)`.
- `harvest` learns business names (businessName, names, company, customer…, `name` next to siteId/host/phones), people (`name` next to `email`, byName…; first names too), hosts (owner = that object's businessName), streets, cities and ZIPs from address objects. Fakes are stable per value (`twin()`): businesses "Summit Auto Spa" (one fake per business whatever the spelling; a spelling that differs from the main one in plural gets an extra "s" so name items still make sense), people "Alex Rivera", phones (555) 555-01xx, websites `<fake>.example`, agencies Detailers Roadmap → Northstar Growth, 8bit Creative → Pixelworks Agency. Emails, phones and web addresses are also caught by shape; social profile handles swapped; well-known platforms kept (`KEEP_HOST`).
- A MutationObserver rewrites text nodes, title/alt/placeholder/aria-label/href/data-copy/data-tip/data-who, input values (made read-only), initials avatars, the tab title, clipboard writes, copy events and desktop notifications; hides `.c-body, .cmt-text, .tk-d-text, .quote` text; blocks `a[download]`. CSS (`html.demo-mode`) blurs images, iframes and background images; `.demo-bar` (top on phones).
- Limits: words quoted from a website's own text in an item can still hold a name the app never loaded (another shop's); towns in page paths are kept.
- Help `demo`, What's New `2026-11-11-demo-mode`. Test: demo section at the end of `tests/tk/e2e_pagefit.py` (no real name/person/phone/agency in text or attributes, title swapped, stays on across pages, status change refused, name slip still reads as a slip, Exit restores).

## Update 148 — audit Dashboard and scan history (built)

- **Scan history:** `saveScan` in `api/store.js` appends `site.scans[]` (last 40): `{at, by, byName, tool:'Site Auditor', auto:true, cv, pages, counts{critical,outdated,warning,info}, total, cats{category:n}, groups{must,polish,length}, fixed, added, reopened}`. `aiResume` updates the last auto line instead of adding one. Audits scanned before 148 show one line made from `site.scan` until rescanned.
- **Other tools:** store ops `compareAdd` {id, tool, date YYYY-MM-DD, critical, warning, info, total?, pages?, note} and `compareRemove` {id, at, tool} (only `auto:false` lines), both `site.scan` permission, logged as activity type `compare`. Up to 60 lines.
- **Front end:** tab `#/site/<id>/dashboard` (📊 Dashboard, before Audit items), `renderDashboardTab`: tiles (open, critical open, % closed, Done, pages, scans), severity segmented bar (`--sev-*` tokens: status critical/serious/warning + neutral info, every part labelled), work status line, open-by-category and top-8 pages bars (`--viz-1`), scan history columns stacked by severity (other tools striped with a mask; hover/focus tooltip `#dbTip`), "since the first scan" line, history table (change vs the previous result of the SAME tool), add/remove another tool's result, CSV download.
- demo.js v2 also blocks downloads started by `a.click()` on an anchor not in the page (CSV exports).
- Help `dashboard`, What's New `2026-11-11-dashboard`. Test: Dashboard section in `tests/tk/e2e_pagefit.py`.

## Update 149 — look-alike characters in titles (built, asked for by QA)

- engine.js `PIPE_LIKE`, `DASH_SEP`, `INVISIBLE`, `CHAR_NAME`, and `oddChars()` in `auditDocument` next to the spacing check: code `META_LOOKALIKE_CHAR` (warning, Meta / SEO, falls under the Meta exception group). SEO title: pipe look-alikes (│ ┃ ║ ∣ ❘ ｜ ǀ । …), dashes used as a separator (" – ", " — ", minus, Unicode hyphens), invisible characters (zero-width, soft hyphen, BOM). Meta description: pipe look-alikes and invisible characters only. `expected` = the text with plain " | " and invisible characters removed. Non-breaking spaces and a plain " - " are not flagged.
- CHECK_RELEASES v28. Help `rules`, What's New `2026-11-12-lookalike-pipe`. Test: `/window-tint` and `/paint-correction` pages in `tests/tk/e2e_pagefit.py`.

## Update 150 — colour contrast (built)

- `api/_contrast.js` (`contrastScan(url, device)`, `judge()`): real Chrome (same launcher as `_shoot.js`, whose `chromePath`, `Pipe`, `sleep`, `within`, `SETTLE` are now exported), device pixel ratio 1, reduced motion. `COLLECT` lists every text node's element (its own line boxes via Range rects), buttons/links, and form fields (placeholder colour from `::placeholder`, typed-text colour after filling "Sample text", border, the ring just outside the field); `HIDE` makes all text transparent; the page is photographed in 1500px PNG strips and `MEASURE` (in the page, on a canvas) gives the 10th/50th/90th percentile luminance and mean colour behind each box. Needs: 4.5:1 normal, 3:1 large (24px / 18.66px bold), placeholder 4.5:1, field edge (border or fill vs surroundings) 3:1. Codes `CONTRAST_TEXT`, `CONTRAST_IMAGE` (varied background; Info when only the lightest/darkest part fails), `CONTRAST_PLACEHOLDER`, `CONTRAST_FIELD_TEXT`, `CONTRAST_FIELD_EDGE`; category Accessibility; `f.contrast = {fg, bg, ratio, worst, need, large, image, edge}`.
- Endpoint: `POST /api/capture {op:'contrast', site, path, devices}` (team + `site.scan`), runs inside capture.js so it uses the Chromium bundle already configured there.
- App: `contrastCheck()` after `aiDeepCheck` in a scan: real pages (no blog posts / thank-you), max 40, 3 at a time, desktop + mobile; merged with `mergeDevices` + `groupAcrossPages`. `scan.contrast` summary in the scan panel. Pages that failed (or Chrome missing) are sent as `notChecked: [{prefix:'CONTRAST_', pages}]`; `saveScan` then carries those items unchanged (never closed as fixed, never reopened). `ctrChip()` shows the two colours and the ratio. `CONTRAST_*` is full-rescan only and "unknown" in the live check.
- Tests: `tests/tk/harness.mjs` now finds Playwright's installed Chromium itself (the old hard-coded path was wrong, which is why e2e_profile's picture failed); `tests/tk/fixsite.mjs` `/contrast-test` (gold form, gray text, white-on-yellow button, text over a parent's photo, text over a sibling overlay); checks in `tests/tk/e2e_pagefit.py`.
- CHECK_RELEASES v29, Help `rules`, What's New `2026-11-12-contrast`.

## Update 151 — scan reports and comparisons (built)

- `saveScan` gives each new scan line `rep` (newId) and writes `dsa:scanrep:<auditId>:<rep>` = packJSON `{at, cv, pages, counts, by, items:[{id, n(num), c(code), s(severity), g(category), m(message), p(path), pc(pages), f(found), e(expected), l(location), st(status at the time), k(contrast)}]}`. AI resume rewrites the same report. Reports of scans that fall off the 40-line history are deleted. `GET /api/store?op=scanReport&id=&rep=`.
- App (`public/app.js`, before `renderDashboardTab`): `dbReport` (saved, or `now` from today's findings), `openScanReport` (tiles, severity bar, category bars, searchable item list, download, compare-with select), `compareReports` (match by id, then code+found+path), `openCompare` (fixed / new / still there, before-after bars, category table; notes a checks-version change), downloads as standalone HTML (`reportHtml`, `compareDoc`, `REP_CSS`, print-to-PDF friendly). Dashboard table: 📋 View per scan with a report, "numbers only" for older ones; buttons 📋 Today's report and ⇄ First scan vs today.
- Help `dashboard`, What's New `2026-11-13-scan-reports`. Test: third scan + report/compare section in `tests/tk/e2e_pagefit.py`.

## Update 152 — vs Docs and scanning chosen pages (built)

- **Fix:** `saveScan` crashed ("Cannot access 'carried' before initialization") whenever an item had to be kept as it was (150's contrast "not checked" path): the Set was renamed `keptAsIs` (an inner `const carried` shadowed it).
- **Docs:** `api/_docx.js` reads a .docx without a library (zip via zlib, XML walked tag by tag) into `{client, requested, site, pages:[{name, title, meta, url, blocks:[{t:text|heading|button|note, text}]}], footer}` using the writers' conventions (TITLE/PAGE NAME/META TITLE, META DESCRIPTION, BUTTON>, DEVELOPER>>>, "Website Pages To Include", top table). Store ops `docUpload` (≤3.2 MB, ≤12 per audit, file kept in 700 KB base64 pieces `dsa:docf:<doc>:<i>`, list packed in `dsa:docs:<auditId>`), `docSave` ({ai} or {result}, 10 results kept), `docRemove`; GET `op=docs`, `op=docFile` (download). AI ops `docread` (page names, client details) and `docmatch` (document page → website path) in `api/ai.js` (`docAI`, cached in `aic:docs`).
- **App:** tab `#/site/<id>/docs` (`renderDocsTab`): upload, one sub-tab per document, `docCheck` = match (exact SEO title / document URL first, then AI, word overlap without AI) → `runScan` of the matched pages only (desktop) → `docCompare` per page (title/meta equality, copy by word trigrams: ≥85% found, ≥40% changed, else missing; buttons by words, call buttons by tel:, same words → different targets, targets that are 404, call buttons not dialling Business Info) + `docClient` (business name, email, phone, address, colours vs Business Info; a colour is looked for on the home page). Report download (`repDoc`).
- Engine: `auditDocument` returns `meta.buttons` (every button and tel/mailto link in page order: text, `to` path or tel:/mailto:, href, where, hidden); `runScan` returns `buttons` per path (desktop; not saved).
- **Scan chosen pages:** ⋯ → 🎯 Scan chosen pages (`openScanPages`, `scanPages`) → `state.scanOpts[id].paths` → `scanSiteRun` scans only those (+ home, which is left out of the save) and calls `saveScan` with `partial`: new items only for those pages (whole-site checks excluded), everything else kept as it was, page list merged, fonts/photos untouched, snapshot `partial`.
- Help `docs`, `scan-pages`; What's New `2026-11-13-vs-docs`. Test: `tests/tk/e2e_docs.py` (builds a .docx in the test).

## Update 153 — SEO Websites (built)

- `api/seo.js`: the list = Duda sites (KV `dsa:dudasites`) labelled `SEO_LABEL` (default "SEO Customer", any capitals); last publish = later of the list's `published` and the webhook's `dsa:watch` entry; due when 4 h (`SEO_DELAY_HOURS`) have passed since the last publish and the last run (`dsa:seoauto` hash: `{at, pub, auditId, by, error}`) was for an older publish or failed. `op=due` (oldest publish first, skipping `dsa:seolock:<id>`), `claim` (SET NX 2 h), `done` (records the run, reads the Activity Log and attaches `seo: {by, pages, error, pub}` + `seoAuto` to the audit's last scan line), `op=pages` (cached 1 h in `dsa:seopages:<id>`).
- Activity Log: `GET /sites/multiscreen/{id}/activities?limit=100&offset=&activities=page_created`. Duda doesn't document the answer, so fields are read loosely (`user|user_email|email|performed_by…`, `date|timestamp|created…`, `page_title|details.page_title…`, `page_url|page_path…`); the first row's keys are kept in the cache (`fields`) for checking against a real answer. **Check this with a real website and adjust `seoPages()` if it finds nothing.**
- App: DR Websites tab `#/live/seo` (`renderSeo`), runner `seoTick()` every 5 min (first after 45 s) in tabs of people with `site.scan` + `live.view`, unless unticked (`localStorage dsa-seo-auto=off`), not while scanning, previewing a role or in demo mode. `seoAudit()` claims, creates the audit if missing (`op:create`), runs `scanSite` with `scanOpts {bulk:true, seo:true}` (no bells), then `done`. Dashboard history shows "🔍 SEO auto audit · n pages by …"; the scan report lists those pages with their item counts.
- Help `seo-websites`, What's New `2026-11-14-seo-websites`. Test `tests/tk/e2e_seo.py` (fake Duda activity log).

## Update 154 — proof pictures (built)

- `api/_proof.js` `proofShots(url, device, [{id, selector}])`: one Chrome per page (dpr 1), each element scrolled into view, a red box drawn, a crop around it (≥600 px wide or the screen, ≤900 tall, scaled to ≤900 px, WebP q70) and its outerHTML (700 chars). Head elements: code only.
- `POST /api/capture {op:'proof', site(audit id), path, device, items, why}` (team + `site.scan`, ≤12 items per call) stores `dsa:proofs:<auditId>` hash (findingId → `{at, by, device, path, w, h, code, img, head, why, note}`) and `dsa:proofimg:<auditId>:<findingId>` (base64 WebP), both 180 days. `GET ?op=proofImg&site=&f=`. `op=site` adds `f.proof` to findings.
- App: `proofTake()` groups by page+device (2 at a time); after `saveScan` the open critical items without a proof (≤25) are pictured (skipped when the contrast check reported no page browser, and in demo mode); `setFinding` pictures items marked False alarm; `proofHtml()` on rows and the drawer (thumbnail → lightbox, code, or "📸 Capture proof" — not for "missing" codes); `proofImages()` embeds pictures in downloaded reports/comparisons (≤40).
- Help `proof`, What's New `2026-11-14-proof`. Test `tests/tk/e2e_proof.py` (real Chrome on the fixture preview server).

## Next (agreed, NOT started)

- Forms gone quiet per form (not only per website), and forms that never received anything.

- Technical SEO checks (no API): copy-paste/thin town pages, service + town in title/H1, robots.txt, sitemap, orphan pages, redirects, per-page canonical, schema by page type, image weight, Googlebot's 2 MB HTML limit, content hidden on mobile, invalid tags in `<head>`, non-`<a>` links, mobile pop-ups on load, text in background images. Then Search Console URL Inspection (free API).
- Then (was 146/147):

- The Tasks tab also gets **Projects** (projects in the Jaguars phase assigned to me) and **Special tasks** (one-off tasks an admin creates: title, notes, link, due date, assignee).

## Update 155 — vs Docs drag and drop (built)
- `renderDocsTab`: a dashed `#dcDrop` area (label for hidden `#dcFile2`, multiple .docx) above the document tabs, big when there are no documents, slim (`.small`) after. Dragging anywhere on the tab works (`body.ondragover/ondrop`), Enter/Space opens the picker.
- Files that are not .docx are skipped; the reason stays in the drop area (`.dc-drop-note`, `state.docDropNote`) because the "Reading…" toasts replace any toast straight away.
- Test: `tests/tk/e2e_docs.py` drops two .docx + a .txt with a DataTransfer.

## Update 156 — audit tabs, scan progress everywhere, vs Docs on the live website (built)
- Audit tabs: Profile · 📊 Audit Report (was Dashboard; `#/site/<id>/report`, `/dashboard` still works) · 🔎 Audit results · Comments · Activity log. Audit results has its own row (`.pf-nav.res-tabs`): Audit items, Design polish, SEO Lengths, vs Docs, Audit exceptions. Routes unchanged.
- `scanStrip(s)`: the scan's progress above the tabs on every audit tab (the bar's ids `pg-/pm-/pb-` exist once; the Audit items panel no longer shows its own badge while scanning).
- Reload mid-scan: `pagehide` saves `{ ids, opts, stopped }` to sessionStorage `dsa:scanAfterReload` (opts from `state.runOpts`, so chosen-page scans resume as chosen pages); `resumeAfterReload` restarts and says so.
- vs Docs `docCheck`: asks `/api/site?light=1` and, when published, reads pages with `/api/fetch?live=1&domain=` (draft otherwise, or when `#dcSrc` = draft). `result.source = { live, domain }` shown on the Checked tile, the row links and the download.
- Fixed from 154: the contrast chip and proof picture were added twice on each audit item row.

## Update 157 — vs Docs: copy block by block (built)
- engine `pageCopy(body, device)`: a page's headings and paragraphs, body only, in reading order `{ t, tag, hid? }`. Only when `runScan({ keepCopy: true })` (vs Docs), first device; returned as `res.copy[path]`.
- app `docCopy(dp, site)`: each website block looked up in the document page (word bags to pick candidates, then a word-level LCS `dlcs`): same / part / changed / extra; document blocks whose words never turned up: `missing`. `docCopyRows` slots missing ones after the block before them; `docCopyHtml` / `docDiffHtml` (ins/del) draw it; "Only differences" = `state.dcOnlyDiff`; open rows kept in `state.dcOpen`.
- Stored as `result.rows[].copy` (site text only; document text comes from the parsed document). store `docSave` keeps the copy rows on the newest check only.
- The page's difference count uses changed + not in the document + missing when a check has the copy (older checks: as before).

## Update 158 — vs Docs: copy section by section (built; replaces 157's block list)
- engine `pageCopy` also returns buttons (`a.dmButtonLink`, tag `btn`) in their place.
- app `docCopy(dp, site)`: `dsections` splits both sides into sections (a heading starts one; headings in a row stay together). Sections are paired by shared words (+ heading likeness), greedy; out-of-order pairs (not in the longest in-order run) are `mv` with a note. Inside a pair `align` lines blocks up (weighted LCS on `bsim`, ≥0.45); unmatched blocks in the same gap are paired as `replaced`/`changed`; left-over document blocks are `missing` (or `moved` when found elsewhere on the page, also inside a longer paragraph), website ones `added` (or `dup`). Missing notes say what they should come after. Result `{ secs: [{ k, dh, sh, rows, mv?, note? }], same, changed, missing, added, moved }`.
- `docCopyHtml` / `docCopyCells` / `docCopyReport` (download). Document left, website right (red = left out, green = added). Old checks without `secs` show the old list.

## Update 159 — vs Docs: draft and live in one check (built)
- `docCheck`: page list = last scan's pages + Duda's current list (`/api/site`, new ones `fresh`), so new draft pages are matched without a full scan. `docMatch(s, d, pages, sitePages)`. Reads the draft, then the live domain when published (`read('draft' | 'live')`); a matched page that does not open on a side is `gone` (with `why`).
- Result: `rows` = draft, `live` = live rows (when published), `source: { draft: true, live, domain }`. Older checks (one side) still show through `docSides(last)`.
- UI: `docRowHtml(s, i, sides, dp)` shows a Draft and a Live pill per page (each links to its page); open a page → `[data-dcv]` picks the side (`state.dcView`), `docSideBody` draws it; "same as the draft" note when both sides compare alike. Tiles show both sides. The "against" picker (`#dcSrc`) is gone. `docBad(r)` counts a side's differences.

## Update 160 — SEO Websites: page names (built)
- Duda's Activity Log answer is undocumented and the real one did not have the page name where `seoPages` looked, so every page showed as "Page". `seoPages` now flattens each activity (`data.page_title` etc.) and picks the page's title / address / id by field name, skipping anything under a person (`user.name`) or the site. What is still missing is filled from `/sites/multiscreen/{id}/pages` by uuid, address or title; a page found nowhere is `deleted`. Cache entries carry `v: 2` (older ones are read again).
- Super admins see "What Duda sent" (the first activity, 600 characters) under the list when a page still has no name, to adjust the field names if Duda's answer looks different.

## Update 161 — backups before every scan somebody starts (built)
- Client `scanSiteRun` sends `backup: !auto` on `scanState`; `scanOpts[id].auto` is set only by the automatic SEO tick (`seoAudit(x, false)`). store `scanState`: backs up when `b.backup` (old tabs without the flag: first scan only, as before), unless an ok backup was made in the last 30 minutes. Same `_2` numbering as Back up now.
- Backup names: `initialsOf(name, email, own)` skips words with digits ("Reymark 8bit" → "R", was "RB"); `user.backupInitials` (1–4 letters, account modal "Initials for backups", live preview) wins. `publicUser` returns it.
- Test: `tests/tk/e2e_seo.py` (fake Duda takes the backup POSTs).

## Update 162 — saved filters (built)
- Tabs above the Audits list and DR Websites (`viewTabsHtml` / `bindViewTabs`). Built-ins in `BUILTIN_VIEWS`; people's own in KV hash `dsa:views` (store GET `op=views`, POST `viewSave` / `viewRemove`; private unless `shared`; owner or admin changes; 30 per person).
- A filter is a query string: `vlex` / `vparse` / `vcond` (AND before OR, NOT, brackets; `= != ~ !~ > < >= <=`, words is / contains / not contains). Fields per list in `VFIELDS` (kinds text, list, person, num, date, yes). Dates with a length mean "how long ago". Compiled queries cached in `vcache` by text.
- Sorts: `VSORTS` + `vsortFn` (Audits `#asort` / `state.asort`; DR `#liveSort` / `live.sort`, now with label and critical).
- Audit summaries carry `cmBy`, `faBy`, `doneBy` (emails) and `sv: 2`; older summaries are rebuilt 40 per list load.
- Test: `tests/tk/e2e_views.py`.

## Update 163 — YouTube video links (built)
- A video/post link was read as an account ("watch" from watch?v=) and flagged "link to an account that is not theirs" (super critical in the auto audit). engine `postLink(net, href)` (exported) spots YouTube videos (watch, youtu.be, shorts, embed, live, playlist), Facebook watch/reel/photo/events/groups, Instagram p/reel/tv/stories; the scan's `checkSocial` skips them. CHECK_RELEASES v30.
- `_watch.js checkPage` notes YouTube videos with `video: <id>`; `videoChannels(found, truth)` asks YouTube's oEmbed (`/oembed?url=…`, no key) for the channel (cached `dsa:ytch:<id>` 30 days, 1 day when unreadable): own handle or business name → dropped; another channel → warning "YouTube video from another channel: <name>"; unreadable → dropped. Unit test in `tests/tk/watch_unit.mjs`.

## Update 164 — AI business-name check reads the whole paragraph (built)
- Text blocks for the AI name check (`res.texts`, from `textIndex`) are split where a link or styled span starts, so "our team at" + link "86 Auto Lab" reached the AI as "our team at" and came back as other_business. `textIndex` entries now carry `para` (the whole paragraph, when longer); `buildTextBlocks` keeps it; `aiTextCheck` sends it as `in`; `api/ai.js` textPrompt shows it and TEXT_SYSTEM says how to use it (cache key `t2…` when `in` is sent, so these are asked again once).
- `applyTextIssues`: other_business must quote a name (capital or digit after the first word, or LLC/Inc/Co), and is dropped when the paragraph goes on with this business's own name. Test: `tests/tk/engine_textai.py` (also covers 163's video links).

## Update 165 — why a website is Queued (built)
- `state.scanning[id].stage`: 'update' (checking for a newer app), 'reserve' (scanClaim), 'line' (in `state.queue`). `queueWhy(id)` words it (names the websites the tab is busy with, place in line); `cancelQueued(id)` (`[data-cancelq]`) takes it out and releases the claim. The header badge says Queued while waiting.
- Scan heartbeat every 30 s (was 60) sends `p: { done, total, msg }`; store `scanClaim` keeps it on the claim (`p.at`). Others see it in the scan strip ("<name> is scanning it in their browser: 7/18 …", with "the hold runs out within 3 minutes") and in the Audits list badge.
- Test: `tests/tk/e2e_queue.py` (holds the page reads so two scans stay busy).

## Update 166 — map labels that start with a number (built)
- engine Maps & iframes: the embed's `!2s` label was "address-like" whenever it started with digits + space, so "86 Auto Lab Franklin…" became street number 86 → MAP_ADDRESS critical. Now address-like needs a street word (`STREET_WORD`) or ", ST", and never when the label matches the business. CHECK_RELEASES v31. Test added to `tests/tk/engine_textai.py`.

## Update 167 — the scan line (built)
- Scans still run per browser tab (2 at a time, own line). `state.kind[id]`: manual | bulk | seo | pages (`requestScan(ids, kind)`; Rescan all = bulk, seoAudit auto = seo, scanPages = pages). `enqueue` puts manual/pages ahead of bulk/seo. `syncLine()` (debounced) sends the tab's whole line in order (`scanClaim { line: true, k }`) → claims carry `k`, `pos`, `of`; scanning claims carry `k` and progress `p`.
- `/api/pulse` returns live `claims`, so every tab knows every scan within a heartbeat (`setClaims` signature now includes progress and position; the open site's strip refreshes).
- UI: `#btnScans` chip in the top bar (`renderScanChip`), `scanBarHtml()` on Audits, `openScanLine()` / `drawScanLine()` modal (this tab + other browsers grouped by `cid`; Move to the front, Remove, clear the line), refreshed every 2.5 s. Queued strip: "Number N of M", links, Move it to the front.
- Test: `tests/tk/e2e_queue.py`.

## Update 168 — scan line: status, who and why, drag, asking other tabs (built)
- `state.qmeta[id] = { why, at, mv: { n, at, to } }` (`noteQueued`, `metaOut`); requestScan(ids, kind, why) (`rescanAllWhy` names the tab and filters; seoAudit says the publish). Sent as `m` with every scanClaim; claims carry `why`, `qat`, `mv`. First scanning claim carries progress; heartbeat every 20 s.
- Line rows (`lineRowHtml`): Now / numbers, kind, step text (`stepTxt`, with "updated N min ago" for other tabs), who added it and why, who moved it (`metaTxt`). Own line: drag to reorder (`moveInLine`), Move to the front, Remove. Other tabs: `lineAsk` (store POST) → `dsa:lineask:<cid>` hash → that tab reads `GET op=lineask&cid` every 15 s and applies it, noting who asked.
- A website queued in another tab shows "Number N of M in <tab>'s line" with Ask to move it to the front.
- Also in 168: `autoHeld()`: seoTick does not start while auto audits are paused (KV `dsa:autopause`, store POST `autoPause`, 12 h) or while any claim/local scan has a kind other than seo. `autoPauseHtml()` in the scan line and on SEO Websites. Bug fixed: other tabs' claims (3-minute holds, renewed every 20 s) were only refreshed by the page heartbeat (up to 4 min with realtime), so they expired on screen; `refreshClaims()` (GET `op=claims`, which also returns the pause) runs every 15 s while anything is scanning or the line is open.

## Update 169 — scan line: labels, why, drag any line (built)
- `kindChip`: 🤖 Auto audit · SEO / 👤 By hand · <kind> / "kind not known" (a tab on an older version sends no k). `metaTxt` always has a Why (or "not recorded … reload it"); seo rows say "added automatically in <who>'s tab".
- `bindLineDrag(list, done)` for every line: own → `moveInLine`; another tab's (`ol.ln-other`) → `askLine(cid, id, 'order', owner, ids, to)`; store `lineAsk` act 'order' keeps `ids` under field `_order`; the owning tab applies the order and notes `mv`.
- SEO auto audits are never in a line (seoTick runs one at a time, only when the tab is idle), so 16 waiting rows with no kind come from a tab on old code (a Rescan all or a reload restart), not auto audits.

## Update 170 — time zones; dragging another tab's line (built)
- `user.tz` (account → Time zone; validated with Intl; `publicUser` returns it). app.js wraps `Date.prototype.toLocaleString/DateString/TimeString` once to add `timeZone: state.me.tz` when none is given, so every date follows the person's zone. Activity log adds `theirTime(by, at)` ("9:38 AM for Chris") when the actor's zone differs.
- Another tab's line after a drag: `state.pendingOrder[cid] = { ids, at }` keeps the new order on screen until that tab reports it (≤60 s), else "did not take the new order". A tab whose claims carry no k, why or qat is `g.old`: banner "This tab runs an older version… reload it", and no drag/asks there (old code never reads lineask, which is why the drag snapped back).
- Note: the privacy hook refuses Bash commands that name api/_lib.js or api/users.js together with user-record edits; use the Edit tool for those files.

## 171 — One shared scan line on the server (scans survive closing a tab)
- **The line lives in KV**, not in a tab: `dsa:line` (id → `{ k, why, name, by, byName, at, o, paths?, seo?, back?, old? }`) and `dsa:lineord` (id → `{ o, mv }`, written only by drags, so a drag can never re-add a website a worker just took). Order = `lineord.o ?? line.o`. `dsa:scanworkers` (cid → `{ by, byName, at, free }`): tabs that asked for work in the last 3 min.
- **Ops (`api/store.js`):** `lineAdd {items}` (manual/pages after the last manual item, or after leading dragged rows; others at the end; skips ids waiting or locked), `lineNext {cid, n, build}` (every tab with site.scan; takes up to n with `scanlock` SET NX, cap `SCAN_MAX` env, default 6; refuses a stale build; SEO waits while paused or the team has non-SEO work, unless dragged), `lineMove {id, ids}`, `lineRemove {ids}` (lets go of an SEO item's `seolock`), `lineGiveBack {cid}` (pagehide beacon: the tab's scans go back to the front), GET `op=line`.
- **Put back:** a claim with `item` that expires (tab crashed/asleep) is put back at the front by `freshClaims` → `putBack` (once, via `dsa:lineback:<id>:<until>`). `scanClaim` heartbeats keep `item`.
- **Older tabs (≤170)** keep their own queue as `state: 'queued'` claims: `lineState` → `adoptOld` copies them into the line once (`dsa:adopted:<id>:<cid>`, 6 h). `lineNext` takes over their lock when the item comes up; if the old tab is already scanning it, the item leaves the line.
- **Client (`public/app.js`, "THE SCAN LINE"):** `state.line`, `applyLine` (ignores answers older than the last local change: `lineEpoch`), `workTick` (15 s while anything is going, 60 s idle; pulse's `lineN` wakes it), `runItem` → `scanSite(id, true)`, `seoDone` after SEO items, `addToLine`/`requestScan`, `moveLine`, `moveToFront`, `removeFromLine`, `lineClaim` (a waiting website looks like a claim to `otherClaim`, so every Rescan button knows). `seoTick`/`seoAudit` only add to the line. `state.queue`, `enqueue`, `pump`, asks between tabs are gone (server `lineAsk` kept for old tabs).
- **Limit:** scans still run in browsers. With no app open anywhere, the line waits. A server-side scanner (headless Chrome, chunked) would be a later step.
- Test: `tests/tk/e2e_queue.py` (two tabs, close one mid-scan, crash put-back, old-tab adoption, drag kept on the server).

## 172 — Readable "client comments waiting" notices
- The pop-up and the bell no longer show the Slack text (`1. *#2* · 855h · desktop — …`). `waitLine` (app.js) takes each line apart; `waitLinesHtml` shows a summary ("7 client comments waiting · oldest 36 days"), then up to 3 comments (5 in the bell), each "#2 waiting 36 days · Desktop" over the quoted comment (2 lines max), then "…and N more" and "Open the comments →". `waitTxt`: hours under 48, days after. The desktop notification gets the same as short plain lines. The Slack message is unchanged.
- Test: `tests/tk/e2e_notifpop.py`.

## 173 — Technical problems: Slack DM to the app owner only
- `alertOwner` (`api/_queue.js`) now sends the bell + a **direct Slack message** to `OWNER_EMAIL` (the `SUGGESTIONS_OWNER` setting) through `slackDM`, never the team webhook channel. `slackDM` lets `kind: 'system'` through even when the owner switched Slack DMs off, and takes `n.link`; `notifLink` sends `system` to `#/health`.
- New alerts: `api/ai.js` `park()` → an AI key rejected/expired or a setup problem (`ai-<id>-error`, every 12 h at most) or out of credits (`ai-<id>-credits`, 24 h), saying which env var to replace and to redeploy. Daily limits and per-minute rests stay quiet. `api/site.js` → Duda API login refused (401/403, `duda-auth`, 6 h).
- Existing alerts (database full, monthly commands, Duda webhook quiet, enquiry imports failing) now arrive the same way.
- Test: `tests/tk/owner_alert.mjs` (fake Slack + fake Redis).

## 174 — A hidden "Button" (display:none) is not reported
- `engine.js`: a default label that is exactly "Button" and hidden by display:none (`hiddenReason` contains `display: none`) is skipped. Every other `DEFAULT_LABEL` ("Heading", "Caption"…) and a "Button" hidden another way are still reported (asked for "just the Button for now"). A Duda photo gallery with captions switched off keeps `.caption-container` (display:none) with a "Button" per picture; that was reported as critical. Other placeholders (notes like "[Matthew: confirm…]", "insert … here") are still reported when hidden. CHECK_RELEASES v32 (no `fixes`: PLACEHOLDER covers real notes too, so it is not declared corrected; the old items close on rescan).
- Test: `tests/tk/engine_textai.py` (gallery caption "Button" hidden → nothing; a visible "Button" → still critical).

## 175 — Ticking audit items no longer redraws the page
- Audit items list: ticking a box (or select all, or Clear selection) used to call `renderSite()`, rebuilding the whole audit page (every row, the filters, the people pickers) on each tick: about 2 seconds on a big website. Now `syncPick()` only updates the ticked rows' `picked` class, the select-all box and the selection bar (`bulkHtml()` + `bindBulk()`; `#bulkBar` is always in the page, hidden when nothing is ticked). The bar's actions read the selection when used (`pickedNow()`).
- Test: `tests/tk/e2e_pick.py` (400 items: 10 ticks, untick, Set status on 9, select all, clear).

## 176 — A town page is about its town (AI page check)
- `applyPageFit` (engine.js) drops a `wrong_city` verdict whose quote names the town in the page's own address (`pathNamesPlace`) unless the AI's suggestion keeps that town too. The AI had told /brentwood-window-tinting that "…in Brentwood, TN" should say Franklin (where the shop is).
- `slugTown(p)`: the address words that are not a service and that the title/H1 also says ("brentwood"), sent as `urlPlace` when `placeOfPath` finds none (it only knows /…-tn and /locations/…). PAGEFIT_SYSTEM now says the town comes from the address, never from where the business is. Cache key `f1` → `f2`. CHECK_RELEASES v33.
- The AI box said "Suggested alt text" on page checks; `AI_PAGE_*` now says "Suggested wording".
- Test: `tests/tk/engine_textai.py`.

## 177 — Show in editor / Show on preview reuse one tab per website
- `openInTab(kind, site, url)` (app.js): opens `window.open('', 'dsa-<kind>-<siteId>')` and navigates it, keeping the window in `dudaTabs` too; the next item loads in the same tab and focuses it. Falls back to a plain new tab when pop-ups are blocked. The tab keeps `opener` on purpose: nulling it made Chrome put the cross-site page in a new browsing context group, and the next click opened a new tab again. The clipboard copy's promise rejection is now caught.
- If Duda's editor ever sends Cross-Origin-Opener-Policy, the name is lost and each click opens a new tab (the old behaviour); nothing breaks.
- Test: `tests/tk/e2e_pick.py` (two items → one editor tab; preview the same).

## 178 — Speed (status, Audit items tab) + town rule for pages with no town
- `setFinding` (plain statuses/assignee): changes the items in memory, lights the pressed button (`#drawer [data-set]`) on this frame, re-renders on the next, and saves in the background. No `loadSite` after the save: `patchFinding` now returns `siteVer`, adopted when it is exactly one more than before (so the 90 s poll does not reload for our own change). A failed save restores the old values and says so. Sets `statusBy/statusAt/updatedBy/updatedAt` locally like the server does.
- Audit items list: `rowHtml(f)`; the first 60 rows are drawn with the page (`#itemRows`), the rest 100 at a time after each paint (stops if the page is redrawn). Row handlers are in `bindRows(root)`, run on the page and on each batch. Switching to the tab went from ~650 ms to ~65 ms with 700 items in the test.
- `applyPageFit`: on a page with no town in its address (`urlPlace` empty), a `wrong_city` whose quote names a Business Info town is dropped. PAGEFIT_SYSTEM says the same. Cache key `f3`. CHECK_RELEASES v34. (176 told the AI the town comes from the address; with no town there it started flagging the shop's own town.)
- **Lag while scans run:** the always-on animations (`.sc-spin`, `.pulse-dot`, `.spin-dot`, the What's New bulb `bulbGlow`, `mkGlow`/`mkDotGlow`/`acPulse`) animated filter/box-shadow or had no layer, so the browser repainted the page every frame: ~1.8 s of every 10 s busy in the test, worse on a big Audits list. Now they only fade or move, with `will-change` (≈0.15 s per 10 s). Don't add `contain` to `.topbar` (it would trap its fixed-position menus).
- The scan bar, the scan chip and the open scan line are only redrawn when their HTML changed (`syncScanBar`, `_h`); the Audits list is redrawn for line changes at most every 8 s; the 2.5 s refresh skips hidden tabs.
- `applyLinkVerdicts`: drops "should open <a page the link is already on>", and a link whose words name a service (`SERVICES`) opening that service's page (`servicesOfPath`). LINK_SYSTEM says so; cache key `l2`. CHECK_RELEASES v35.
- Tests: `tests/tk/e2e_pick.py` (tab speed, all rows arrive, Done instant + saved, failed save reverts), `tests/tk/engine_textai.py`.

## 179 — Domain check false "Connection refused" (699 of 704) + security review
- 699 websites showed "Connection refused (ECONNRESET)": the domain check was cut off by the websites' host, not 699 websites down (the auto audit read the same websites fine). `_domains.js` now: sends the same browser user agent as the auto audit (not "SiteAuditor … health check"); retries a cut-off connection once after 2.5 s; and when ≥60% of a run (≥6 checked) fails with network errors (`NET_FAIL`), throws those results away (each website keeps its last result and stays due), sends no domain alerts, and DMs the app owner (`alertOwner('domains-blocked')`). The daily sweep checks 6 at a time (was 12) and rechecks cut-off results first; "🌐 Check domains" rechecks them too and stops with a message when blocked (`blocked` in the `op: 'domains'` reply). The morning digest leaves out cut-off results when there are 20+ of them. Test: `tests/domains.mjs`.
- Security review: no keys, passwords or tokens in the repo, its history (155 commits) or the docs; every key is read from Vercel settings. All API files check the signed-in user (or the cron/webhook secret). Fixed: `/api/check` (link checker) and `/api/social` (profile reader) could be pointed at the server's own network (localhost, 10.x, 169.254.169.254 metadata, redirects to them). New `api/_net.js` `fetchPublic`/`publicAddress`: public http(s) only, checked on the name, on what it resolves to, and on every redirect; `/api/social` only reads social profile hosts. Added `.gitignore` (.env, keys, test output) and security headers in `vercel.json` (nosniff, Referrer-Policy, HSTS, Permissions-Policy). Test: `tests/tk/net_unit.mjs`.
- Still recommended (in Vercel, not code): set `CRON_SECRET` on the company project so only Vercel's scheduler can start the daily runs.

## 180 — Audit items doubling (#1 shown 1,024 times)
- Cause: "AI check resumed" (`aiResume` in app.js) sent EVERY item back in `saveScan`, including hand-written and auto-audit (`AUTO_LIVE`, `manual: true`) items; `saveScan` then added the server's own copies of those again (`byHand`), so each resume doubled them (2^10 = 1,024 after ten resumes; Naples Auto Armour had 5,448 "critical").
- Fixes: `aiResume` sends only the scan's own items; `saveScan` ignores any `manual` item (or one with a hand-written item's ID) in the result; `loadSite` keeps one item per ID (`uniqById`) and saves the tidied record once; `syncAudit` (_watch.js) dedupes too. Summaries rebuilt (`sv: 3`) so the Audits counts are right again.
- Test: `tests/tk/e2e_dupe.py`.

## 181 — Demo mode: Exit demo in the profile, no bar
- `demo.js` no longer adds `.demo-bar`. `openMe()` (app.js) in demo mode opens a small "🎭 Demo mode" modal with only **Exit demo** (`#meDemoExit` → `DemoMode.set(false)`) in its footer, instead of the account form. Test: `tests/tk/e2e_pagefit.py`.

## 182 — Blog posts open in the editor under /blog/; a hidden "Button" of any kind is not reported
- `runScan` marks a page `blog: true` when its HTML says `pageType: 'BLOG_LAYOUT'` or has `[data-blog-template]` / `[data-blog-post-alias]` (Duda blog posts live at /<slug> with no /blog/ in the address). Saved in `site.pages`. `editorUrl()` (app.js) opens such a page at `/home/site/<id>/blog/<slug>`. Audits scanned before this need one rescan for it.
- Engine: `DEFAULT_LABEL` skips a "Button" hidden in ANY way (`hiddenReason` non-empty: display:none or visibility:hidden); other default labels are still reported hidden or not. CHECK_RELEASES v36.
- Tests: `tests/tk/engine_textai.py`, `tests/tk/e2e_pick.py`.

## 183 — Show on live
- `liveAtItem(site, f)` (app.js): `https://<domain><path>#dsa=<selector>` (+ text fragment), domain = `f.liveDomain` (auto-audit items) → `liveDomain(site)` (Duda's answer / DR list) → the scan's `truth.domain` while Duda's answer isn't loaded yet; none → no button. `selLinks` shows **🌐 Show on live**; `bindSelLinks` opens it with `openInTab('live', …)` (one live tab per website). Highlighter help mentions it. Test: `tests/tk/e2e_pick.py`.

## 184 — Preview / Live pills, find the spot by words
- After every scan of a published website (`scanSiteRun` → `liveCompare(id, only)`), app.js reads the same pages on the live domain (`liveRead`: `A.runScan` with `/api/fetch?live=1` + AI alt/text checks) and maps each item to `t` (also on live) / `o` (fine on live) / `u` (unknown: CONTRAST, manual, AI pending) with `liveResults`. Stored as `site.live = {at, by, domain, publishedAt, pages, res}` by new store op `saveLive` (site.scan permission; `cleanLive`); `saveVerify` (Verify on live) stores it too. Partial rescans merge.
- `pvLivePills(s, f)` in the list WHERE cell and the drawer (+ `.pvl-say` sentence); AUTO_LIVE items use `f.autoLive.gone`. Styles `.dev.pvl-t/o/u`.
- `fragmentText(f)` falls back to `f.found` (4–80 chars); Show on preview/live add `&t=<words>` to `#dsa=`; HIGHLIGHT_BM finds the element by those words when the selector is missing on the page (bookmark must be dragged again).
- Test: `tests/tk/e2e_livecmp.py` (mocked live HTML differs from preview).

## 185 — Both pills always; click to check live
- `pvLive` always returns both: Preview `t/o/u`, Live `t/o/u/n/x` (n = not compared yet → `<button data-livecmp>` "? Live · check", x = not published via `isPublished(s)`). Manual items: Preview ✗, Live ? .
- `liveCheckItem(s, f)` (document capture click on `[data-livecmp]`): claims the site, `liveCompare(id, recheckPages(f))`, reloads. `recheckItems` also runs `liveCompare(s.id, paths)`.
- `liveResults` now only judges items whose pages were read on live (a failed live page → `u`), so a one-page compare no longer marks other pages' items "fine". `liveCompare` returns 'ok' / 'unpublished' / 'error'; partial compares keep earlier results.

## 186 — Calmer audit item rows
- `rowHtml` (renderSite list): columns ☐ | ID (+severity, category) | Audit item (title, chips incl. `📸 Proof` [data-proofimg] and 💬 count, `<dl class="rw-fe">` Found red / Expected green, notes, `rowActs`) | Where (path clamp, +N pages, location · `devWords`, pills) | Status | Assignee. Selector code, proof thumbnail, Capture proof, device chips moved out of the list (drawer has them).
- `rowActs`: 👁 Page / ▶ Preview / 🌐 Live / ✎ Editor / ⧉ Copy selector / ⟳ Recheck; none of the selector ones for head selectors. Faded until row hover (`.rw-acts`).
- Row click opens the item unless the target is a/select/button/input/summary, or text is selected; only the checkbox cell and the assignee picker keep `data-stop`.
- Tests: e2e_proof checks the list chip and captures from the drawer.

## 187 — ⚡ Apply check updates
- engine `CHECK_RELEASES[].scope = { fixes:[codes], adds:[codes], ai, contrast, links, files }` (v27+; older releases have none → full rescan only). `A.updatePlan(cv, findings)` → `{codes, pages:'all'|[paths], ai, contrast, links, steps, full}`; `A.codeIn(codes, code)` (a code ending in `_` is a prefix).
- Line kind `update` (LKIND) → `runItem` sets `scanOpts[id] = {upd:true}` → `scanSiteRun` computes the plan: `only` = plan pages (`['/']` when only files), skips AI / contrast / link checks / image hashes unless needed, no backup (`scanState` `upd`), filters results to the codes, sends `codes` to saveScan. Nothing to do → store op `checksUpToDate` (bumps cv).
- `saveScan` with `codes`: only those codes are replaced (others are `skipped` = kept as is), fonts/photos kept, the scan record stays the full scan's plus `updAt/updBy`, log "applied the check updates", no notifications, response `upd: {closed, added}`.
- Banner `newChecksBanner` → `#ckApply` + `updPlanHtml(s, plan)` (per update: items #, pages, what is left alone).
## 188 — Technical SEO, NAP, automation emails
- `buildTruth`: `t.autoEmails` (AUTOMATION_EMAIL: robot.zapier.com, mailparser, cloudmailin, inbound., no-reply…) removed from `t.emails`. `EMAIL_AUTOMATION` (critical) in page text, mailto, schema, llms.txt.
- `schemaQuality` (desktop, every page): SCHEMA_INVALID_JSON / NO_TYPE / NO_CONTEXT / MULTI_BUSINESS / REQUIRED / RECOMMENDED (home) / TYPE_GENERIC (home) / RATING / SELF_REVIEW / URL / FAQ_EMPTY. Home business block summary → `res.schemaBiz` → `site.schemaBiz`.
- `runScan({fetchFile, fileDomain})` reads /robots.txt /sitemap.xml /llms.txt on the live domain (app: `/api/fetch?live=1`), `fileFindings` → ROBOTS_* SITEMAP_* (incl. SITEMAP_EMPTY) LLMS_* items at path '/', location = file name; `res.files` → `site.files`. liveResults marks them 't'; Preview pill '?'.
- Group `tech` (`A.isTech`, TECH_RE): those + FAQ_SCHEMA_*, SCHEMA_LOCALBUSINESS_OFF, META_NOINDEX/CANONICAL_DOMAIN/THANKYOU_INDEXED, MIXED_CONTENT, ANALYTICS_*, FAVICON/HOMESCREEN, META_OG_IMAGE. SCHEMA_NAME/PHONE/EMAIL/ADDRESS stay `must`. Tab `#/site/<id>/tech` (`techHeadHtml`), `#/site/<id>/nap` (`renderNapTab`, uses `prof.pres` online presence).
- Releases v37 (files), v38 (schema), v39 (automation email). Tests: `tests/tk/e2e_techseo.py` (also Apply check updates: no AI/capture/check calls, other items untouched).

## 189 — Hidden "Button" via stylesheet
- engine's DEFAULT_LABEL skip (`hiddenReason`) only sees inline styles / Duda hide classes. A gallery caption "Button" hidden by a stylesheet rule got through; `markHiddenText` (computed style in a sandboxed iframe) saw it hidden everywhere but only set `hiddenLive`. Now it sets `dropHidden` for PLACEHOLDER "Button" default labels hidden on every device (log line). `recheckItems` runs `markHiddenText` too.
- Release v40 (fixes + scope PLACEHOLDER) so ⚡ Apply check updates closes them as check-corrected. Test `tests/tk/e2e_hiddenbtn.py` (fails on the old code).

## 190 — Scan timer and durations
- `state.scanT0[id]` set at the start of `scanSiteRun` (cleared at the end); `liveLine` shows `⏱ <b data-elapsed>` updated by the 1s interval. `fmtTook(ms)`.
- `saveScan` stores `ms` (the client's `scan.durationMs`, capped at 24h) on each `site.scans` line and in the scan report (`scanrep`); check updates keep the full scan's record and add `scan.updMs`. Summary index carries `updAt/updMs`.
- Shown: scan summary ("⏱ took"), Scan history "Took" column, report modal and downloaded report. Test `tests/tk/e2e_took.py`.

## 191 — Live pill: items judged by their words
- `liveRead` keeps each live page's text (desktop: title, meta/og, alt, tel/mailto hrefs, JSON-LD, body) in `res.liveText` (Map path → `liveNorm` text, ≤60k). `liveResults`: no vKey match → `liveQuote(f)` (found without quotes; phones by digits) on the live text → 't' / 'o'; nothing to look for → 'u' for AI and `LIVE_UNCHECKED` codes (checks liveRead doesn't run), else 'o'. Bug: AI name_variant item said ✓ Live while live title still said "Denver Auto Spa".
- Live pill is a `data-livecmp` button for any state (except not published / AUTO_LIVE): re-reads that item's pages on live.
- Test: e2e_livecmp (AI items aiT/aiO).

## 192 — "Button" labels and the AI
- Third path for the same hidden gallery "Button": the AI page-fit read (`editor_note` → AI_PAGE_NOTE) and proofreading got the labels in the page text (fit excerpt from textIdx, `prose`, textIndex `para`). Now: `textNoLabels(el)` (clone, drop descendants whose text is a DEFAULT_LABEL) for prose and para; fit body skips DEFAULT_LABEL pieces; `AI_LABEL_ONLY(quote, reason)` drops AI page-fit / proof results about a "Button" label. The default-label rule (+ markHiddenText) is the only judge.
- Release v41 (fixes AI_PAGE_NOTE + proof codes, ai). Test `tests/tk/e2e_labelai.py` (stand-in AI; fails on the old engine).
- Lesson: when a value is wrong, fix it where text is collected for EVERY check (rules, hidden-text check, AI inputs, AI outputs), not one check at a time.

## 193 — llms.txt line context, read the files again
- `fileFindings` items take a `snippet`: LLMS_PHONE / LLMS_EMAIL / EMAIL_AUTOMATION (llms) quote the line and the read date.
- Line item `{k:'update', files:1}` (store lineAdd keeps `files`) → `scanOpts.files` → plan `{files, keepCv, codes: ROBOTS_/SITEMAP_/LLMS_/EMAIL_AUTOMATION, pages: []}` (only '/' read); `scan.cv` is kept (not marked up to date). Button `#techReread` on the Technical SEO header. NAP llms column shows the read date and links the file.
- Why: a user saw "(719) 873-7834" in the NAP llms column but the live llms.txt no longer had it (Duda rebuilds llms.txt from page descriptions on every publish).

## 194 — NAP profile cells
- Profile columns (presence listings) pass `{profile, unconf, url}` to `cell`: an empty detail is "? Not read by the search" (or "Seen, but not confirmed word for word" when in `l.unconfirmed`), never "Not there" (Instagram showed "Not there" for an address that is in its bio).
- `addrNote(v)`: same ZIP but written differently (abbreviations normalised; a suite/unit on one side only) → `≈` cell (`.nap-fmt`) with what differs. Test in e2e_techseo (mocked presence).

## 195 — Service-area towns
- engine `serviceAreas(paths, truth)` (towns from `placeOfPath` of every page in pagesMeta + pageInfo, plus Business Info cities) → `res.truth.serviceAreas`. `applyTextIssues`: AI `wrong_location` dropped when the quote names a service-area town and the block's pages have no town in their address (town pages keep the stricter rules).
- New LINK_TOWN_SERVICE (warning, Links): `focusTown(head, body, areas)` (in title/H1, or ≥2 mentions and ≥2× any other town); body links (`pageLinks`, desktop) to an own non-town, non-blog service page → the town's page for that service (`placeOfPath` + `servicesOfPath`) or "no page yet".
- AI business header gets `areas` (towns) and town pages first in `areaPages`. Release v42. Test `tests/tk/e2e_towns.py` (stand-in AI).

## 196 — Own towns on pages without a town
- `ownTowns(truth)` = Business Info cities + `truth.serviceAreas` + the first word of the business name when not a trade word ("Denver" in Denver Auto Shield); `namesOwnTown(quote, truth)`. Used by `applyPageFit` (wrong_city on a page with no `urlPlace`) and `applyTextIssues` (wrong_location on pages with no town in the address).
- `slugTown(p, areas)` no longer takes a car make (CAR_WORDS: /tesla, /porsche…) for a town; a slug word counts as a town only if it is a service-area town or the title/H1 says "in X" / "X, ST". (/tesla-window-tinting had urlPlace "tesla", so "…in Denver, CO" looked like the wrong town.)
- Release v42 now also fixes AI_PAGE_CITY. Test e2e_towns extended.

## 197 — Vendor schema and the word "copyright"
- `_watch.js bizSchema`: a `provider` counts as the business only under a Service/Product/Offer (SpamKill names itself as a WebPage's provider). Copyright regex: © / (c) / "Copyright" + year only. FIXES `copyright-word-1`, `vendor-provider-1` close existing auto-audit items (tests: watch_unit.mjs, e2e_fix.py).
- engine `extractSchema` walk skips everything inside WebPage / WebSite / app blocks (`NOT_BIZ_PARENT`). Release v43 (fixes SCHEMA_*). Test `tests/tk/engine_vendor.py`.

## 198 — Auto audit items open on the page
- app `itemView(s, f)`: AUTO_LIVE items (no selector) → `autoTwin` (a scan item on the same page whose found contains the value; phones by digits) gives selector/path/devices + `twin` (#num); otherwise `pageOnly` with `snippet = autoWords(f)` (the quoted words from `detail`). Used by `rowActs`, `bindRows` data-inspect, `bindSelLinks` find, and the drawer (`fv`; drSnip, drInspect).
- HIGHLIGHT_BM: no selector + words → no clipboard/prompt, finds the element by its text. Test: e2e_livecmp (al-phone / al-words).

## 199 — Placeholder samples, form pages first for contrast
- engine `sampleValue(v)`: placeholder / data-placeholder-original attributes with only sample emails (name@, you@, …@email.com/example.com…) or sample phones (555, repeated digits) are not scanned for contact details. Release v44.
- auditDocument `meta.forms` → `pages[].forms`; `contrastCheck` orders pages: home, pages with a form, then shortest path (CONTRAST_MAX_PAGES 40). Test: engine_vendor.py.

## 200 — Photos (AI vision), watermarks, redirects / old 404s, form options, policy template text
- `api/_contrast.js`: in-page `PHOTOS` (img + computed background-image ≥240×140, not header/footer/logo/svg; kind image | background | parallax — `background-attachment: fixed` or a parallax class/data attr; `around(el, over)` = heading on a background first, else the last heading ABOVE the photo, stopping at section/.dmRespRow), `CENTER`, `ORIGINAL`/`UNORIGINAL`. `contrastScan(..., { photos })` pictures up to 10 photos as shown (JPEG ≤560 wide) + whole file (≤8 per page) BEFORE measuring. Fixed backgrounds are switched to `scroll` before measuring (otherwise a whole-page capture draws them blank → white-on-white false alarms). Returns `fields` (typed fields count).
- `api/capture.js` op contrast passes `photos` (desktop only). `api/ai.js` op `photos`: `PHOTO_SYSTEM`, `callVision`/`visionChain` (anthropic, gemini, openai image inputs), cache `aiph:` per photo+page+heading+kind, 120 days.
- `public/app.js`: `contrastCheck` asks for photos when the AI is on, `photoAI` per page → `A.applyPhotoVerdicts` (PHOTO_WRONG_PAGE warning ≥0.75, PHOTO_WRONG_SECTION info ≥0.8, PHOTO_WATERMARK warning ≥0.6, one per file). Scan panel `<details data-ui="scanctr">` lists measured pages with typed-field counts and pages not measured.
- engine: `formChoices` → FORM_SERVICE_MISSING (`serviceCatalog`, `choiceCovers`); `policies` (Termageddon `data-policy-key` → `/api/fetch?policy=` → app.termageddon.com/api/policy/<key>) → POLICY_TEMPLATE / POLICY_NAME / POLICY_CONTACT / POLICY_ADDRESS (+ static legal pages via LEGAL_PATH); `redirectFindings` → REDIRECT_LOOP/CHAIN/SHADOWS_PAGE/BROKEN/TEMPORARY/MISSING (`bestMatch`). `api/site.js` reads `/urlrules`; `api/store.js` keeps `site.pastPaths` (≤600) for MISSING; REDIRECT_ counts as every-scan (Technical SEO). Releases v45–47. engine v29, app v75.
- Tests: engine_forms_policy.py, e2e_photos.py (fixsite `/site/abc123/rv-rentals` with PNG photos, column background, parallax).

## 201 — Gallery "Button" judged as visitors see it
- engine `galleryCaptionButton(el)`: a "Button" inside a photo gallery caption (`.caption-button` in `.caption-container`, gallery `[data-widget-type="photoGallery"]`/`.dmPhotoGallery`) with no link (empty, `#`, javascript:) is never PLACEHOLDER. Release v48 (fixes PLACEHOLDER).
- `api/_proof.js visibleCheck(url, device, selectors)` + `capture.js op 'visible'`: real Chrome, page settled (scrolled through, network quiet), each selector: '' shown, a reason when hidden (display/visibility/opacity chain, no size, cut off by an overflow container), null when not found.
- app `buttonSeenCheck` (after markHiddenText): remaining "Button" default-label items, ≤12 pages, desktop + mobile; hidden on both → dropped (scan note). Not found (null) decides nothing. Test: e2e_gallerybtn.py (fixsite `/ppf-vs-ceramic`).
- engine v30, app v76.
- Also in 201: engine link check — a relative href (not starting with http(s):// or //) that is not /site/<id>/… is an internal link to its path, never LINK_EDITOR_URL (one client page wrote every header/footer link as "/…", 176 false criticals). Release v49. Test: engine_links.py.

## 202 — Gallery caption buttons are not BUTTON_NO_LINK
- engine BUTTON_NO_LINK `control` also true for `galleryCaptionButton(a)` and an inline-hidden button (SNEAKY_HIDE). Release v50 (fixes BUTTON_NO_LINK).
- app `buttonSeenCheck` also takes BUTTON_NO_LINK items: hidden on desktop and phone in a real browser → dropped. e2e_gallerybtn.py covers both. engine v31, app v77.
- Also in 202: Google Maps short links. `api/check.js` `{ places: [...] }` → follows maps.app.goo.gl / goo.gl/maps / g.page / share.google hop by hop (public addresses only, stops on google.*/maps, unwraps consent.google.com?continue=), reads the place ID (`!1s0x…:0x…`, cid, ftid, place_id) and name (/maps/place/<name>), and when only an ID: `https://www.google.com/maps?cid=<decimal of the second hex>` og:title "Name · Address". Cached `gplace:` 30 days. Engine (opts.googlePlaces, after the link checks): SOCIAL_GENERIC / GMB_ID_* items on short links → dropped when the place is the business's (name via matchesBusiness, or an ID already known), GMB_OTHER_PLACE warning when another name, GMB_ID_ONLY info when unnamed. Release v51. Test: engine_gplaces.py (stand-in). The live Google page format could not be tried from the dev sandbox: if names never come back, items fall to the ID-only note.

## 203 — Every item opens the page; Google short links (held back from 202)
- Google Maps short links (see the 202 notes: check.js places, engine opts.googlePlaces, release v51) ship here: the pushed 202 was the first zip without them. `gbpIdNote` reads the cid from a feature ID (…:0x… → BigInt) in found/expected, so Online presence can confirm an unnamed place.
- `rowActs`: an item with no element (selector '(page)', head/meta, empty) still gets ▶ Preview / 🌐 Live / ✎ Editor (not Redirects/Files). Fixed `data-inspect=""id"` (extra quote) that broke 👁 Page in the list. Drawer explains head vs whole-page items and shows the same links.
- `fragmentText`: AI items scroll to `f.ai.quote`, not the AI's reason; head items have no fragment.
- engine `applyPageFit(findings, fit, issues, truth, locate)`: a body quote is located with app `wordsLocator(res)` (smallest prose/text block on that page containing the quote) → selector/location; the item ID is computed before, so existing items keep their ID. e2e_pagefit checks both. engine v32, app v78.

## 204 — Client report (PDF)
- `api/_print.js htmlToPdf(html, {header, footer})`: Chrome (same as pictures) `Page.setDocumentContent` + `Page.printToPDF` (Letter, header/footer templates, margins 0.75/0.7in). Network blocked except data: and Google Fonts (Fetch domain), so a report can't make the server open other addresses. `capture.js op 'pdf'` (team, site they can see) returns the PDF file.
- `api/ai.js op 'report'` (`REPORT_SYSTEM`, `reportWrite`): ≤10 findings per call → {k, title, current, recommendation, priority now|soon|later}; written from the facts only (page name + URL, SEO title, H1, meta description, each check's message/found/expected/AI reason, Business Info address/phone/email/towns), styled on the user's example (target town of the Home & Office Coating page). Cache `airep:` 60 days per finding hash.
- app: `crItems` (open/clarification, not gone, no AI_PENDING/Scan), `crEntries` (one finding per page for town (CITY|TOWN|PLACE) and topic, per code+words otherwise, readability all together), `CR_SECTIONS` B/C/P/L/G/R/D/O, `crWrite` (batches of 8; `crPlain` without AI), `crHtml` (cover, sections each on a new page, readability table per page, corrected since the scan before via `compareReports`, pages, limits; proof pictures from `proofImages`), `downloadClientPdf(s, x, scans)` (today = latest scan with statuses since; compared with the scan before it). Falls back to an HTML download if the PDF can't be made. Buttons: Audit Report `#dbPdf`, per scan `[data-dbpdf]`, scan report `#repPdf`.
- engine pages[] keep `description` (≤320). Test: e2e_clientpdf.py (two scans; PDF text via pdftotext). engine v33, app v79.

## 205 — Redirected pages; report merges repeats, links clickable
- engine runScan: `ruleMap` from `opts.redirects.rules` (path sources, no patterns); a queued page that is a rule's source is not fetched (`pageInfo.redirectTo`, target enqueued). After a fetch, `landedPath(res)` (`res.finalUrl` from /api/fetch, or a 0-second meta refresh; same host and same /site/<id> only) different from the path → skipped the same way. pages[] carry `redirectTo`; app contrast/photos, AI page list and the client report skip them. No release entry (a full-rescan release would block ⚡ Apply check updates for every audit); it takes effect on the next rescan. Test: engine_redirpage.py.
- `api/fetch.js` returns `finalUrl` when the fetch was redirected.
- Client report: `crEntries` merges entries of the same kind (section + town/topic family, else code + message without quotes/numbers) across pages into one with `rows`; AI gets one write-up request ("Page: N pages", one check per page) and REPORT_SYSTEM says to write once, not per page, and not to repeat the business address everywhere; `rowsTable` prints page (link) / what is there / should be. `crUrl` falls back to the preview URL so every address is a link; text URLs are linkified. Section/family matching uses code tokens (CONTRAST_PLACEHOLDER is not a "place").

## 206 — Make a report: Findings or Progress, with leave-out choices
- `openReportMaker(s, x, scans)` replaces the direct PDF buttons (`#dbPdf`, `[data-dbpdf]`, `#repPdf`): type (findings | progress; progress only from today), "count fixes since" (any saved scan), leave-out checkboxes `CR_LEAVE` (clar, hold, contrast default on; polish, tech, info off) with live counts; false alarms/exempt always out. Choices kept in localStorage `dsa:repmaker`.
- Findings: `downloadClientPdf(s, x, scans, ex, msg, list)`; `crItems(s, list, ex)` (open/clarification/hold minus left-out); the corrected list skips items now marked False alarm.
- Progress: `crFixed(s, since, ex)` = gone.at or Done statusAt ≥ since (not false/exempt); `crEntries` groups them like findings; `crWriteFixed` → `/api/ai op report mode fixed` (`FIXED_SYSTEM`: title past tense with page count, impact, area business|seo|visitors; cache prefix f1); `prHtml` (cover with tiles + highlights, What was fixed by subject with pages and "Was:", Still to do with recommendations, About). `crPdf` shared. Styles `.rm-*`. Test: e2e_clientpdf.py covers both. app v80, styles v56.

## 207 — Towns in links to the business's own pages
- engine `applyTextIssues(findings, texts, issues, truth, links)` + `ownPageLink(blk, quote, links)`: a wrong_location quote that is (part of) the words of a link, on that page, to another service/area page of the website (not /, contact, quote, about, reviews, gallery, thank-you, nor the page itself) is skipped. Release v52 (fixes AI_TEXT_LOCATION, ai).
- AI text prompt: read the whole paragraph; cross-references to the business's other services or areas are never wrong_location; blocks that are own-page link words are sent with "(link to /…)" (app `linkTo` in aiTextCheck). Cached text verdicts are not re-asked: the rule covers the link case. Test: engine_textloc.py. engine v34, app v81.
- Also in 207: page-fit body text (`bodyOf`) is built from `proseIdx` (whole paragraphs, links/bold in place), falling back to `textIdx` pieces only for pages without prose. `applyPageFit` drops an editor_note whose reason says incomplete/cut off/fragment when `locate(path, quote, true)` finds a page paragraph that continues after the quote (app `wordsLocator` third arg). Page-fit AI answers are re-asked once (body text changed). Release v52 also fixes AI_PAGE_NOTE.

## 208 — wrong_service judged by the page's own consistency
- PAGEFIT_SYSTEM wrong_service rewritten (user's spec): title/H1/description/copy must describe one consistent service; address is a clue; never judge by business type; the website's own pages are the evidence (`businessHeader` lists `b.services` from app `aiBusiness`: page names, service pages first); never say the business does not offer something; unclear → `clarify: true`. Cache key f3→f4 (page-fit asked again once).
- engine `applyPageFit`: wrong_service dropped when the reason says "not a service they offer" (`NOT_OFFERED`) or `pageAgrees(pg, quote)` (a path token in both the SEO title and the H1, and in the quote). `clarify` → warning + `clarify: true`; store saveScan sets such untouched items to For clarification (`auto: 'ai-unclear'`). Release v53 (fixes AI_PAGE_TOPIC, ai). Tests: engine_textloc.py, e2e_pagefit.py. engine v35, app v82.

## 209 — Redirect-aware auditing on the published website
- `api/check.js { routes: { domain, paths } }` → `liveRoute`: hop by hop (manual, public addresses only, HEAD then GET on 403/405/501), chain/final/loop/error.
- engine runScan `opts.liveRoutes { domain, check }` (app passes it when published): before the crawl, every queued + Duda page is checked (25 per call, ≤300); `liveMap` path → { to, status, chain } (same domain → path; http→https/www/trailing slash ignored), loop, or error after a 3xx. Worker skips such pages like rule redirects (`redirectTo`, `redirectLive`), enqueues the destination, `viaFrom` → pages[].via. After the crawl: REDIRECT_RETIRED_PAGE (info, category "Retired page / preview cleanup", the user's wording) for every redirected page without a Duda rule; REDIRECT_LIVE_LOOP (critical); REDIRECT_UNVERIFIED (info). `res.retired` → saveScan `retiredPages`.
- store: items whose pages are all retired close with gone.why / auto `retired-page` (reopens like rescan-gone). app: badge "↪ Page now redirects — closed", drawer note, `crFixed` and the Findings report's corrected list skip them; drawer "Visitors also land on this page from …". No release entry (needs a rescan). Test: engine_redirpage.py. engine v36, app v83.
- Also in 209: location judgement. TEXT_SYSTEM wrong_location and PAGEFIT wrong_city rewritten with the user's rules (physical location vs service area vs towns inside the targeted county/region; only explicit physical claims are errors; ambiguous wording → `clarify: true`; never from mention counts). Text answers keep `lv: 2` (+ clarify) on wrong_location; a cached wrong_location without lv 2 is asked again (only those blocks). engine applyTextIssues: clarify or confidence < 0.8 → warning, `clarify: true` (store sets For clarification), message "AI: location wording to confirm…". Release v54 (fixes AI_TEXT_LOCATION, AI_PAGE_CITY, ai). Live redirect checks only on full scans (not on ⚡ updates).

## 210 — Spelling vs. industry terms
- PROOF_SYSTEM spelling: wrong letters only, same word fixed; automotive/detailing term list (wheel barrels, wheel wells, calipers, door jambs…); a fix must keep the same component/product/service; unsure → `clarify: true`; types kept apart. `minimalFix` spelling now also needs `spellingEdit` (each changed word has a close-spelled partner, or joined/split words): "barrels"→"wells" fails. Proof answers carry `sv: 2`; a cached spelling flag without it is asked again (those blocks only). Clarify items skip the letters test.
- engine `applyProofIssues`: clarify → Info, "Wording to confirm (the term may be correct)", `clarify: true` (store → For clarification). Release v55 (fixes TEXT_SPELLING, ai). Test: engine_textloc.py. engine v37.

## 211 — Reports: completed work only; notes and screenshots
- Report window "Include": `#rmTodo` (progress only; off → `makeProgress` skips pending items and `prHtml` its section/tile/footer, `withTodo`) and `#rmNotes` (both reports). Saved in `dsa:repmaker`.
- `crLoadNotes(s, entries, msg)`: item comments (`s.comments`, target = item id, not deleted, ≤6 per entry), mentions turned into plain names, screenshots fetched and shrunk to ≤1000px JPEG (≤3 per note, ≤40 and ~2.4 MB per report); `crNotesHtml` under each finding/fix. e2e_clientpdf.py covers both. app v84, styles v57.

## 212 — Grammar keeps the meaning
- PROOF_SYSTEM grammar: read the whole sentence/paragraph; the fix keeps meaning, subject and comparison and is checked as a whole sentence for grammar and logic; automotive synonyms (clear bra = PPF); real-subject agreement; product-performance claims are not grammar (→ clarify); no sure fix → clarify with empty suggestion. Answers carry `gv: 2`; cached grammar flags without it are asked again.
- PROOF_VERIFY_SYSTEM now also returns `fix_ok` and `better`: a confirmed error whose fix changes the meaning gets the second reader's version, or no suggestion + clarify. engine: grammar clarify → Info "Wording to confirm (no sure correction; a product claim may need checking)". Release v56 (fixes TEXT_GRAMMAR, ai). Tests: e2e_aicheck.py (clear bra), engine_textloc.py. engine v38.

## 213 — Town service links judged by the destination
- engine LINK_TOWN_SERVICE: skipped when the focus town is the shop's own town (Business Info address) and no dedicated town+service page exists, or when the linked page's title/H1/description/copy names the town (`covers`), whatever its address. Dedicated page exists and the link skips it → warning (unless the linked page covers the town too); no dedicated page and the linked page does not mention the town → Info "Optional: …" with an optional-strategy suggestion. Release v57 (fixes LINK_TOWN_SERVICE). e2e_towns.py adds the "Window Tint in Littleton" H1 case.
- `crFixed` also skips items closed as check-corrected (not real fixes). engine v39, app v85.

## 214 — Website health report (owner-facing)
- The Progress report is renamed Website health report (window, PDF title/header/footer, file `website-health-…pdf`). New cover in `prHtml`: verdict (good shape / small things left / nearly there, from open included items), `CR_HEALTH` checklist (contact, google, links, forms, copy, photos, social, read [only when contrast is not left out]) with "what it is for", All good / N to finish / N fixed; "What we fixed for you" (top fixes + impact); "Do you need to do anything?". Fix groups carry `CR_WHY`; pending items are "What we are finishing" with In progress / We may ask you / On hold tags. makeProgress passes `openAll` (crItems with ex), `fixedAll`, `ex`. e2e_clientpdf.py checks the cover and that no severity/technical words appear. app v86.

## 215 — Health report: completed work only hides everything open
- `prHtml` with `withTodo` false: no open counts in the checklist (shows "N fixed" or "Checked"), verdict "Your website has been checked and improved." (or "…checked."), urgent/asks zeroed, the do-anything box says nothing is needed. e2e_clientpdf.py checks no "to finish / nearly there / left / In progress" text. app v87.

## 216 — A status change takes the item; auto audit items start with no one
- store patchFinding: a status change without an assignee in the same change sets `assignee: me.email` (if not already), logged in the status line ("…, and it is now assigned to X (was Y)"). Client sets it at once too.
- Assignee '-' = no one on purpose (not the site default): `effWho` treats it as nobody; item selects (`userOptions(…, true)`) offer "No one"; no notify / bring-in for '-'. `_watch.js` merge: new or untouched AUTO_LIVE items get fstate assignee '-' (reopened live-back items keep theirs, or '-'). Tests: e2e_autoassign.py, e2e_watch.py. app v88.

## 217 — Health report date range
- Report window: "Count fixes since" select replaced by `#rmFrom` / `#rmTo` date inputs (local days, start 00:00 to end 23:59:59.999) and `#rmQuick` (first / last scan, 7 / 30 days, this / last month). `crFixed(s, since, ex, until)`; `makeProgress` passes `opt.until`; `prHtml` says "Since X" or "Between X and Y" (when the range ends before today). e2e_clientpdf.py covers it. app v89, styles v58.

## 218 — Client-facing wording for the Website health report
- `FIXED_SYSTEM` (api/ai.js) rewritten: "WORK COMPLETED", returns `{k,title,purpose,group,significant}`; title past tense and proportional, purpose practical with no claims about rankings/traffic/leads/trust; group from a fixed list (Content Refinements, Gallery Content Cleanup, Brand Consistency, Page Title and Description Updates, Contact Details, Links and Navigation, Images, Forms, Search Listing Details, Readability, Design Consistency); cache prefix f2.
- `crWhere(f)` adds where the item was (photo gallery caption, page title, page description, main heading, button, link, hidden from visitors) to the facts sent to the AI. `crPlainFixed` (no AI) returns the same shape with neutral titles.
- `prHtml` rewritten: groups by `e.w.group` (significant first), skips `e.include === false`, "What we reviewed" (neutral `CR_HEALTH` topics; copy/google topics renamed), "Summary of work completed", "Work completed" (✓ title, purpose, pages, notes; no "Was:"), `Awaiting publication` tag when `e.pub === 'pending'`; `ctx.verdict` / `ctx.intro` override.
- `makeProgress` sets `e.pub` ('pending' when the site is not published or the fix is newer than `publishedAt` from `pubInfo`/`liveOf`; 'published'; '' when unknown) and opens `crReview` in the report window: headline, per update include / heading / title / purpose, internal finding in a details block, then Export the PDF. Report button reads "Next: review the wording" for the health report.
- e2e_clientpdf.py: stand-in AI answers the new prompt; edits the headline and a title in the review step and checks them in the PDF; checks Awaiting publication and no "Was:", trust, leads or rankings claims. app v90, styles v59.

## 219 — Health report: completed work only, no publication status
- Removed the "Awaiting publication" tag and every mention of publishing from the health report, the review step and the window text (Done = done and published). `e.pub` is gone from `makeProgress`/`prHtml`/`crReview`.
- Removed the "What is still to do" option (`#rmTodo`) from the report window: the health report is always completed work only (`opt.todo = type !== 'progress'`). The `withTodo` path stays in `prHtml` but is no longer reachable from the window.
- e2e_clientpdf.py checks there is no `#rmTodo` and no awaiting/publication/pending/in progress text in the review list or the PDF. app v91.

## 220 — Editorial-use-only stock photos (STOCK_EDITORIAL)
- Check release v58 (`adds: ['STOCK_EDITORIAL']`): `editorialStockFindings(byKey, opts, log)` in engine.js runs after `fingerprintPhotos` (same byKey). Match by Shutterstock ID in the file name (`stockIdOf`: `shutterstock_ID`, `…-260nw-ID`, `stock-photo-…-ID`) or by fingerprint within 7 bits (`STOCK_LOOK`) of a listed image's fingerprint (photos only, not graphics, not flat). Unknown IDs in file names → `opts.stockLookup` (≤20 per scan). `stockFingerprints` fills up to 8 missing fingerprints per scan from listed previews. One item per Shutterstock ID: critical when visible, warning when hidden everywhere; fields `stockId`, `stockUrl`, `stockHow` ('name'|'look'), `stockTitle`, `dupPlaces`. Site-wide in updatePlan, store.js SITE_WIDE, app RECHECK_SITE_WIDE.
- api/imghash.js `stock` ops: list (seeds `api/_stockseed.js` once, flag `dsa:stock:seeded`), add/remove (perm exempt.global), hash (anyone fills a missing one; replacing needs exempt.global), lookup (fetches `${SHUTTERSTOCK_BASE||https://www.shutterstock.com}/image-photo/ID`, follows the redirect; editorial = JSON is_editorial flag, else place-and-date slug/og:title; preview from og:image; cached 30 days, 1 day when unknown; ≤10 fresh per call; editorial ones join the list). The GET proxy also lets Shutterstock preview image files through (`stockImgHost`). Store: hash `dsa:stock:ed`, `dsa:stock:lk:ID`.
- App: `stockOpts()` passed to audit scans (when wants STOCK_) and live auto audits; `stockNote(f)` in the item; Settings → 📷 Editorial stock photos (`drawStockList`: add IDs/links, Get previews from Shutterstock, Upload a copy per row, Remove); search entry; Help topic `stock`; report wording "Replaced a stock photo…" (group Images).
- Shutterstock could not be reached from the dev sandbox, so lookups and previews are untested against the real site: if Shutterstock blocks Vercel, lookups return "can't tell" (logged, nothing reported) and fingerprints come from Upload a copy.
- Tests: tk/stock_unit.mjs (file names, name/look matching, lookups, hidden) and tk/e2e_stock.py (API, permissions, stand-in Shutterstock, previews, Settings page). engine v40, app v92.

## 221 — Fix: editorial stock check could not read its list
- `stockOpts()` used `sPost`, which only exists inside the scan (from `siteApi(id)`), so every scan logged "Editorial stock list could not be read: ReferenceError: sPost is not defined" and the check never ran. It now takes it as an argument (`stockOpts(sPost)`) at both call sites. e2e_clientpdf.py now has a photo on a test page and checks that the scan log has no editorial stock errors (it fails on the old code). app v93.

## 222 — Editorial photos: add by ID, with preview
- Settings section renamed **📷 Editorial photos**; table: preview thumbnail (through the /api/imghash proxy), ID, title + Shutterstock page link, file name `shutterstock_ID.jpg`, recognised by, actions. `+ Add editorial photo` on the page and **+ New → 📷 Editorial photo** (`newChoices`, perm exempt.global) open `openStockAdd`: Look it up → card (thumbnail, title, licence badge, page, file name) → Add to the list (stores title/url/preview/editorial via `facts`, then fingerprints the preview).
- imghash.js: `stockFacts(id, pageUrl, title)` builds page URL, preview (`/{kind}/{slug}-260nw-{id}.jpg`) and file name from the page address; `cleanTitle`; `stockLookupAI(id)` = Anthropic web search limited to shutterstock.com, trusting only a result URL ending in the ID (never the model's text); used by `lookup` when `ai: true` and the page gave nothing (Add box and Get previews). Lookups in a batch run in parallel; a cached "no answer" is retried when `ai: true`.
- e2e_stock.py: stand-in AI web search; AI fallback facts; Add box via + New (card, thumbnail, row with fingerprint). app v94, styles v60.

## 223 — Editorial photos: thumbnails and fingerprints built in
- The 67 thumbnails were cut from the Shutterstock Downloads screenshots (grid cards, grey padding trimmed) and kept as `public/stock/<ID>.jpg` (240px, ~560 KB total). Their fingerprints were made in Chromium with the app's own `measureImage` and are `STOCK_SEED_HASH` in `api/_stockseed.js` (closest pair 18 bits apart; a resized/JPEG copy is 0–4 bits off; match limit 7).
- `stockList` fills `thumb` and `h` (hFrom 'screenshot') once, behind flag `dsa:stock:seeded2`, for listed images that lack them (lists created by 220–222 included); removed images are not put back, hand-added ones are untouched. `stockThumb` prefers `x.thumb` (only `/stock/<digits>.jpg`). "Still need a preview" now counts images without a fingerprint only.
- e2e_stock.py checks the seeded thumbnails/fingerprints, the static files, thumbnails on the list, and the upgrade of an existing list. app v95.

## 224 — Editorial photos: the ID is enough
- Checked from a Vercel sandbox (iad1, same network as the functions): `www.shutterstock.com/image-photo/<ID>` pages answer 403 to servers, but previews load by ID alone: `/image-photo/-260nw-<ID>.jpg` (200, ~390×280, `access-control-allow-origin: *`, also `-600w-`). The 260nw preview has a 20px white Shutterstock strip at the bottom. Fingerprints of real previews (strip cut) were 0–3 bits from the screenshot-made `STOCK_SEED_HASH`.
- `stockFacts` always builds `preview` (`/{kind}/{slug}-260nw-{id}.jpg`, slug may be empty); `stockLookup` returns preview/url/file even when the page is refused (`via: 'id'`). AI web search is now only for the title (Add box, `ai: true`); Get previews no longer uses AI.
- `stockMeasure(img, url)` in engine.js crops the bottom 20px of a `-NNNnw-ID.jpg` preview before `measureImage`; used by scans (`stockFingerprints`) and the app (`stockHashOf`). An ID added by hand counts as editorial when Shutterstock cannot say.
- e2e_stock.py: stand-in previews carry the strip; checks the ID-only preview and that the preview's fingerprint matches the clean photo. engine v41, app v96.

## 225 — Editorial photos: sliders, galleries, hidden sections
- Seen on a published Duda page (detailersroadmap.com, from a Vercel sandbox): an `ssrimageslider` renders only the first slide as `<img>`; the other slides are only in `data-initial-props` (url-encoded JSON), `data-model` (base64 JSON) and the hydration `<script>` (`"imgSrc"`). Row backgrounds are in inline `<style>` as `.u_<id>{background-image:url(…)}`.
- `photosUsed` now also reads picture URLs from scripts and `data-initial-props / data-model / data-image-url / data-gallery / data-slides` (decoded), and keeps stylesheet backgrounds whose `.u_…`/`#id` selector matches nothing (section hidden on every device, not in the page) as location 'Hidden section', hidden. These rows carry `fromData: true`; `duplicatePhotoFindings` ignores fromData places. Cap 600 rows per page (200 from data). `photosUsed` exported.
- Check release v59 (`adds: ['STOCK_EDITORIAL']`) so Apply check updates looks again.
- Test: tk/e2e_stockplaces.py (published-style page: last slide, gallery data, hidden row not in the page, hidden row in the page, parallax, fixed+covered). engine v42, app v97.

## 226 — Settings → Auto audits (and editorial photos on every published website)
- New `api/_autoaudits.js`: `AA` definitions (bizinfo, editorial, domains, quiet, presence, seo) with a check tree, fields and notification templates; settings in `dsa:aacfg:<id>` (only changes; defaults in code; presence keeps `presencecfg`); last runs in `dsa:aarun:<id>`. `aaCfg`, `aaOn`, `aaToday` (UTC day of the cron), `aaSave` (admins), `aaSend(id, 'instant'|'daily', base, items)` / `aaMessage` (templates with {words}; `base.headlineDefault` and `item.plain` keep the standard wording), `aaList`, `aaDetail`, `aaSample`, `bumpStockVer`.
- Endpoints in `api/watch.js`: GET `op=autoaudits`, `op=aa&id=`; POST `aaSave`, `aaPreview`, `aaTest` (to me), `aaRun` (reading pass or forms gone quiet). Cron (`op=cron`) and the domain sweep check `aaToday`.
- `_watch.js`: `runSettings()`; `checkKey`/`wanted` filter findings by the tree; editorial photos in the same reading (`pictureUrls` incl. slider/gallery data and base64 data-model; ID in file name; by look via the browser-made `ih:` fingerprint cache); type `stock` (critical) in results, digests and audit items; `dueOrder` rank 3 re-reads every website when `sv < stock:ver` (bumped when the check is switched on or photos are added); recheck days and max pages from settings; `syncsTo(rec, toAudits)`: default 'auto' = only audits with an `seoAuto` scan. Messages split: editorial photos are their own message (`aaSend('editorial')`).
- `_domains.js` / `_leadkv.js` / `_presence.js`: messages through `aaSend`, filtered by the tree; quiet thresholds (min, gaps, minDays) and presence profiles from settings.
- SEO websites (`api/seo.js`): hours after publish from settings; `op=due` is held while `cwstat.pending` > 0 per priority (`after` / `interleave` every N read, counter `dsa:aa:sinceSeo` incremented per website read, reset on claim / `first`); `seo.pages` toggle; `saveIndex` after done. Index summary `auto: 'seo'` (sv 4) → Audits filter `#fby` and the 🤖 Auto audited tag.
- UI: Settings → 🤖 Auto audits (`drawAutoAudits`, `drawAutoAudit`), route `#/settings/autoaudits/<id>`; ⚙ Settings on the DR Websites panel; search entry; Help `autoaudits`. Test: tk/e2e_autoaudits.py; e2e_watch.py sets toAudits 'all' for its audit-item checks. app v98, styles v61.

## 227 — Auto audits: live state and reading speed
- Production logs showed the reading backing off 5 → 10 → 20 → 40 min ("Websites stopped answering us (could not be reached)") after ~142 websites: Duda's servers refusing connections when read fast. Nothing was stopped; the row only showed the daily cron time.
- `PACE` in `_watch.js` (normal 4 pages/300 ms/1.5 s per site, gentle 2/800 ms/4 s, slow 1/1.5 s/8 s); `runSettings().pace` from bizinfo field `pace` (default gentle).
- `aaList` adds `live` { pending, reading, running, waitUntil, waitWhy } to the bizinfo/editorial rows; the page shows it (`aaLive`) and labels the column "Next daily run". Tests in e2e_autoaudits.py. app v99, styles v62.

## 228 — Auto audits around the clock (Vercel Pro)
- vercel.json cron `*/10 * * * *` → `/api/watch?op=tick` (CRON_SECRET like the daily one): skipped when bizinfo `roundClock` is false, not today, or `cwdue` is 0 after a fresh `watchStatus`; otherwise `runWatch({ budgetMs: 90000, by: 'cron' })` (the lock, Duda's breaks and the reading speed apply as always).
- `aaList`: bizinfo/editorial rows get `next` = the next 10-minute mark (or the end of a break) with `nextKind: 'tick'` while websites are waiting; the page labels it "Next run (every 10 min)". Field `roundClock` (default on). Tests in e2e_autoaudits.py. app v100.

## 229 — Scan line: automatic jobs, names
- The "kind not known · added by <person> · added from a tab on an older version" rows were automatic AI-check resumes (`aiResume`, started by any open tab when AI credits return), and verify/recheck runs: all claimed without `k`/why. Now: `aiResume` sends `k: 'ai'`, `auto: !manual`, a why and progress; verify (`k: 'verify'`) and recheck (`k: 'recheck'`) send a why and progress. store.js `scanClaim` keeps `ai|verify|recheck|update` kinds and `auto: true`.
- Scan line: `kindChip(k, auto)` → "🤖 Automatic · ✨ AI check"; `metaTxt` → "started automatically in <name>'s open tab" (never "added by"); missing why reads "not recorded" (no version guess). `claimText` says "An AI check is running by itself in …". `siteName` falls back to the Duda name (DR Websites) or "Site <site id>", never "A website". `autoHeld` ignores automatic claims.
- Test: tk/e2e_scanline_auto.py. app v101.

## 230 — Auto audits page (results apart from the Audits tab)
- New left-menu item **Auto audits** (`#/auto/<tab>`, `live.view`), under Websites. Tabs: `bizinfo` (non-stock findings), `editorial` (stock findings, thumbnail from the proxied preview, falling back to `/stock/<id>.jpg`), `domains` (from `live.data.sites` with `domProblem`), `quiet` (link to `#/analysis/quiet`), `seo` (links to `#/live/seo` and the Audits "auto audited" filter).
- Data: `GET /api/watch?op=results` → `{ sites:[{id,name,domain,at,pub,pages,recId,issues:[…]}], read, canRule }` from `cwsum` + `cw:<id>` (websites with findings and no error). "Not a problem" posts `{op:'ok'}` (live.content). Search entry, Help topic `autoresults`, news. Test: tk/e2e_autoresults.py. app v102, styles v63.

## 231 — Grammar: smallest fix, judged in its sentence; "Wrong word"; optional apart
- Reported case: "We believe in treating your vehicle is treated…" got "that your vehicle is treated" (changes a value into a description) and the reason "subject and verb are duplicated". Now `PROOF_SYSTEM` spells out the order (whole sentence → smallest meaning-keeping fix → read the corrected sentence → name the real problem), with this mixed-construction example; names problems accurately.
- New proof type `wordchoice` → `TEXT_WORD_CHOICE` "Wrong word" (a real word used wrongly, e.g. "cartouches"), reported separately from grammar in the same sentence; `minimalFix` allows ≤2 words changed.
- `optional: true` = a style improvement, not a mistake → Info, message "Optional style improvement (not a mistake)", expected "Optional: …", UI label "Optional rewording". Kept only when the second reader says `optional_ok`.
- Second reader (`PROOF_VERIFY_SYSTEM`) now gets `corrected sentence:` built by `correctedSentence(text, quote, suggestion)`, prefers the smallest meaning-keeping fix, and returns `reason_ok`/`why` (the reason is replaced when wrong).
- Cache: grammar flags with `gv !== 3` are asked again (only those blocks). Check release v60 (`fixes: TEXT_GRAMMAR`, `adds: TEXT_WORD_CHOICE`, ai). Test: tk/e2e_grammarfix.py. engine v43, app v103.

## 232 — Links judged by their promise (town pages, packages, brands, sections, redirects)
- Reported on Menard (#1426–#1520): ~40 LINK_TOWN_SERVICE warnings ("page is about Voorhees, link the Voorhees page"), "VIEW PACKAGES" → `/services-overview`, redirected brand links called "non-existent", split anchors judged as "auto", and two contradictory recommendations for the STEK link. No site- or ID-specific code; the IDs live only in the test comments.
- `LINK_TOWN_SERVICE` (engine): the page's focus town no longer triggers anything. Only a link whose OWN words name a served town, with `linkPurpose(text, to) === 'service'`, a town/service page existing, and a destination not already naming the town → Info, `optional: true`. The "general page does not mention the town" Info is gone. `linkPurpose` = lead | brand (`BRAND_RE`) | vehicle (`MAKE_RE`) | packages (`PACKAGE_RE`) | service.
- Link rows: `frag` (the `#…` kept for links only; `normalizePath` unchanged), `anchor: {found, text}` for same-page sections (ids, names, `data-anchor*`/anchor-ish data attributes), `parts`/`part` when formatting split one phrase across neighbouring links with the same href (one row, first element's selector). `#section` buttons are noted too. Missing section → `LINK_ANCHOR_MISSING` (warning, `clarify: true`). linkMap key includes frag (and the page for anchors).
- Pages carry `pkg: true` when their body shows packages/coverage/pricing.
- AI link check: app follows redirects with `A.finalPage` (title/H1 of the landing page), sends `final`, `frag`, `section`, `pkg`, `parts`; `linkNeedsJudging` skips found sections that match the words and brand/vehicle/packages links that land on such pages. `LINK_SYSTEM` rewritten (purpose list, town is background, sections, redirects, split phrases, evidence-based reason, `optional`). Cache prefix `l3`, key includes the new evidence.
- `applyLinkVerdicts`: drops same-page section verdicts, brand/vehicle/packages links already on their page, and service-named links (as before, now against the landing page); `expected === landing page` of a redirect → `LINK_VIA_REDIRECT` Info (optional tidy-up); a suggested page must be a working, non-redirect page from the scan, else no suggestion and `clarify: true`; `optional` → Info. `reconcileLinks` drops a LINK_TOWN_SERVICE idea on the same selector+page as a wrong-page/redirect/missing-section item; nothing else is touched.
- Check release v61 (fixes LINK_TOWN_SERVICE, LINK_WRONG_PAGE; adds LINK_ANCHOR_MISSING, LINK_VIA_REDIRECT; ai). Old town warnings close as "check corrected"; False alarm marks stay.
- Tests: tk/e2e_linkpromise.py (full scan, stand-in AI that calls every link wrong), tk/link_unit.mjs, tk/e2e_towns.py updated (general links on a town page: no item; town-named link: optional Info; packages link: kept). engine v44, app v104.
- Limits: section detection reads the page HTML (ids, names, Duda anchor attributes); a section placed only by scripts asks for clarification rather than failing. Links to a section of ANOTHER page are kept with their fragment but the section is not checked. Preview vs live is not compared for links (redirects come from the scan's own redirect data).

## 233 — Links: destination copy, not its SEO title's town; no "fix" to the same page
- Reported #2256: home page "machinery" → /service/industrial-and-agricultural-coating, AI said wrong because the SEO title says Philadelphia (home is Warminster), and "Should open" was the same page.
- app `linkNeedsJudging(l, dest, destText)`: link words found in the destination's H1 + copy (`res.fit` excerpt) → not asked. Link items carry `toText` (400 chars of the destination's copy); prompt shows `says: …`.
- `LINK_SYSTEM`: judge by heading and copy, not SEO title/address; another town in the destination's title is not evidence (belongs to that page's own review); never answer with expected = current page.
- `applyLinkVerdicts`: expected equal to `l.to` with the same fragment → dropped (link fine). Compared before the redirect branch only against `l.to`, so a redirect landing on the suggested page still becomes LINK_VIA_REDIRECT. `/x#b` vs `/x` is a different place and is kept.
- Cache prefix `l4` (key adds `toText`). Check release v62 (fixes LINK_WRONG_PAGE, ai). Tests: e2e_linkpromise.py (#2256 cases), link_unit.mjs. engine v45, app v105.

## 234 — When an item's status changed, shown in the list
- fstate records now carry `stAt`/`stBy`/`stFor` (the status they belong to), written by `patchFinding` only when the status changes (kept as they were on an assignee-only change). On load (`store.js`), `f.stAt`/`f.stBy` come from them when `stFor === status`, else from `updatedAt`/`updatedBy` — so automatic closes/reopens that copy the old record (rescan-gone, came-back, ai-unclear…) show their own time without touching those writers. Old records fall back to `updatedAt`.
- app: `stWhen(f)` / `stWhenHtml(f)` under the status select in the items table ("Fri, Nov 27, 12:33 AM" + who, or "fixed on rescan (who)" via `AUTO_HOW` / `f.gone`); title = full date. Sort select `#ffsort` (`state.ff.sort`: '' by ID, 'changed' newest first); not counted as a filter. Optimistic `setFinding` sets `stAt`/`stBy`.
- Test tk/e2e_stwhen.py. app v106, styles v64.

## 235 — Filter: status changed today / yesterday / last 7 days
- `state.ff.when` ('' | today | yesterday | 7d), select `#ffwhen` with counts, `changedIn(f, when)` on `stWhen(f).at` using the viewer's local midnight. In `FF_DEFAULTS` (cleared by Clear filters), named in `activeFilters`, highlighted when on. Combine with the status filter (Done + today = closed today). Test in tk/e2e_stwhen.py. app v107.

## 236 — Custom date range for "Changed:"
- `#ffwhen` option `range` shows `#ffFrom`/`#ffTo` date inputs (`state.ff.from`/`to`, YYYY-MM-DD, local days, both inclusive); picking it with no dates starts at today. `rangeLabel()` names it in the filter line. In `FF_DEFAULTS`. Test in tk/e2e_stwhen.py. app v108, styles v65.
