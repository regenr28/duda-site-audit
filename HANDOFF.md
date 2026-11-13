# Hand-off notes for whoever continues this project (human or Claude)

Read this first. It explains how the app is built, how updates are delivered, what was done last and what is next.

## The people and the setup

- **Owner / builder:** Reymark Regencia. He uploads files to GitHub himself and commits. **Never commit or push for him** — deliver a zip.
- **Every update zip must come with a ready-to-paste commit title and description**, written for a non-technical reader (bullets, plain words).
- **Repo:** `regenr28/duda-site-audit` (branch `main`). Commits are numbered (`134 - …`, `135 + 136 + 137 - …`, `138 + 139 - …`, `140 - …` … `143 - …`, `144 - …`). The next update is **160**.
- **Two deployments, both auto-deploy from `main`:**
  - **Company app** ("8bit"): 8bitcreative's Vercel, database = Supabase (Postgres-backed KV). URL `duda-site-audit.vercel.app`.
  - **Reymark's quiet copy** (`duda-site-audit-draft`): his own Vercel + Upstash Redis, env `APP_COPY=1`. It switches some things off on purpose (System health → "copy" banner lists them). Be careful with it: don't break it, don't fill its database.
- **Secrets:** API keys go straight into Vercel → Settings → Environment Variables (marked Sensitive) or a password manager. Never in chat, Slack, email, the repo or a zip. Never upload a real `.env`. Never decrypt or print env values. If someone pastes a key in chat, tell them to rotate it.

## How the app is built

- **Server:** Vercel serverless functions, Node ESM, one file per endpoint in `api/*.js`. Files starting with `_` are shared modules, not endpoints. Every handler ends with `export default metered('<name>', handler)` (usage metering, `api/_meter.js`).
- **Storage:** a Redis-style KV through `redis(...cmds)` from `api/_lib.js` (pipeline of commands). Every key starts with `P = 'dsa:'`. Works on Upstash and on the Supabase adapter (`api/_sql.js`). Big JSON is stored with `packJSON`/`unpackJSON`.
- **Front end:** plain JavaScript, no framework. `public/index.html` loads `styles.css`, `engine.js`, `app.js` with `?v=` numbers. **Bump the `?v=` of every file you change** (after 159: styles v39, demo v2, engine v15, app v44).
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

- **On GitHub:** up to 146 (commit `bbbdf84`, "145 + 146 - …"). Up to 158 on GitHub (`820839b`). **Delivered as a zip, maybe not uploaded yet:** 159 (vs Docs: draft and live in one check).
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
