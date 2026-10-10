# Duda Site Auditor

A team web app for auditing Duda websites before and after launch. Paste an editor link and it crawls every page on **Desktop, Tablet and Mobile**, including side panels (hamburger drawers), popups and elements hidden on some devices. Everything is compared against the site's **Business Info** from the Duda API.

Each finding shows **page path · where (Header / Footer / Side panel / Popup / Body + devices) · unique CSS selector · the issue (found vs. expected)**, with an ID (#12), a status, an assignee and its own comment thread.

---

## Adding a feature later (checklist)
Keep these three in step with the code, or the team won't know what changed:
1. `api/_help.js` — the Help guide (also what the Help assistant answers from). Add or update the section.
2. `api/_news.js` — add a short "What's New" note at the top: what changed, and **Where to find it** steps. `audience: 'all'` for everyone, `'admin'` for admin-only tools. Never mention hosting, AI model names or settings.
3. `renderAbout()` in `public/app.js` — update only if the summary of what the app does has changed.
The light bulb glows for anyone whose latest seen note is older than the newest one.


## 1. Deploy to Vercel (about 15 minutes, no coding)

### Step 1: Put the files on GitHub
1. Go to https://github.com/new, name the repo `duda-site-auditor`, choose **Private** and click **Create repository**.
2. On the new repo page click **"uploading an existing file"**.
3. Drag in **everything inside** this folder (`api`, `public`, `src`, `package.json`, `vercel.json`, `README.md`, …), not the folder itself, then click **Commit changes**.

### Step 2: Import into Vercel
1. Go to https://vercel.com/new and **Import** the `duda-site-auditor` repo.
2. Set **Framework Preset** to **Other**. Leave Build Command, Output Directory and Install Command empty (`vercel.json` handles them).

### Step 3: Environment variables (Project → Settings → Environment Variables)

| Name | Value | |
|---|---|---|
| `DUDA_API_USERNAME` | your Duda API user | required |
| `DUDA_API_PASSWORD` | your Duda API password | required. Tick **Sensitive** |
| `ADMIN_EMAILS` | your email, e.g. `you@gmail.com` (comma-separate several) | recommended. These accounts are admins automatically. Otherwise the first person to sign up becomes admin. |
| `RESEND_API_KEY` | API key from resend.com | recommended. Needed for email verification codes, forgot password, and @mention emails. |
| `EMAIL_FROM` | e.g. `Duda Site Auditor <audit@yourdomain.com>` | with Resend. Must use a domain you verified in Resend. |
| `GOOGLE_CLIENT_ID` | OAuth Client ID from Google Cloud | optional. Shows the "Sign in with Google" button. |
| `GEMINI_API_KEY` | free key from aistudio.google.com | optional, **free**, no card. ✨ AI checks. |
| `GROQ_API_KEY` | free key from console.groq.com | optional, **free**, no card. Backup AI model. |
| `OPENROUTER_API_KEY` | free key from openrouter.ai | optional, **free**, no card (about 50 requests a day). |
| `CEREBRAS_API_KEY` | free key from cloud.cerebras.ai | optional, **free**, no card. gpt-oss-120b, about 1M tokens a day. |
| `MISTRAL_API_KEY` | free key from console.mistral.ai (Experiment plan) | optional, **free**, no card (phone check). Mistral Medium. |
| `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` | Workers AI token + account ID from dash.cloudflare.com | optional, **free**, no card. gpt-oss-120b, 10,000 neurons a day. |
| `AI_GATEWAY_API_KEY` | key from Vercel → AI Gateway | optional, paid. Add it once you have budget. (Or `ANTHROPIC_API_KEY`.) |
| `AI_ORDER` | `gateway,cerebras,cloudflare,groq,mistral,anthropic` (default) | optional. The order the models are tried in. |
| `AI_OFF` | `gemini,openrouter` (default) | optional. Models that sit out even when a key is set, because their free terms train on or log what we send. Name one in `AI_ORDER` to bring it back, or set `AI_OFF=` (empty) for all of them. |
| `DUDA_HOOK_KEY` | (none) | optional. The secret in the listening address. **Leave it unset** — the app makes one for itself when an admin clicks Connect. Set it only if you want to choose the value yourself; it then wins, and you must reconnect for Duda to learn the new address. |
| `DUDA_HOOK_SECRET` | (none) | optional. Duda's base64 signing secret (managed accounts / Custom plan). When set, every delivery is checked with HMAC-SHA256 and a bad signature is rejected. |
| `COMMENT_WAIT_HOURS` | `24` | optional. How long a client comment may sit unanswered before the admins are told. Weekends are skipped. |
| `AGENCY_EMAIL_DOMAINS` | (none) | optional. Extra domains counted as "one of us" when deciding whether a Duda comment came from the client. `ALLOWED_EMAIL_DOMAINS` already counts. |
| `GEMINI_MODEL`, `GROQ_MODEL`, `OPENROUTER_MODEL`, `AI_GATEWAY_MODEL` | model names | optional. Defaults: `gemini-2.5-flash`, `openai/gpt-oss-120b`, `qwen/qwen3.8-27b:free`, `anthropic/claude-haiku-4.5`. |
| `GEMINI_DAILY_LIMIT`, `GROQ_DAILY_LIMIT`, `OPENROUTER_DAILY_LIMIT` | defaults 250 / 1000 / 50 | optional. This app's own daily request cap per model (0 = no cap). |
| `AI_DAILY_LIMIT` | `5000` (default) | optional. Maximum items sent to AI per day across all models. |
| `AGENCY_NAMES` | `Detailers Roadmap, 8bit Creative` (default) | optional. Names the AI should never flag as "another business" (e.g. "Website by …"). |
| `SLACK_WEBHOOK_URL` | Slack Incoming Webhook URL | optional. Posts to Slack when someone signs up and needs approval. |
| `SUGGESTIONS_OWNER` | `regencia.reymark28@gmail.com` (default) | optional. The only person who sees every feature suggestion. |
| `ALLOWED_EMAIL_DOMAINS` | e.g. `8bitcreative.com` | optional. People with these email domains skip admin approval. |
| `DUDA_EDITOR_HOST` | e.g. `8bitcreative.responsivesiteeditor.com` | optional. Editor address used when adding sites from **Live DR Sites** (otherwise the most common one from existing audits). |
| `ALLOWED_EDITOR_HOSTS` | `responsivesiteeditor.com` | optional. Add your white-label editor domain(s). |

### Step 4: Shared storage (required)
Vercel project → **Storage** → **Create Database** → **Upstash for Redis** (Free) → **Connect to Project**. Accounts, websites, comments, screenshots and activity are all stored there.

### Step 5: Deploy
Click **Deploy**. After changing variables, use **Deployments → ⋯ → Redeploy**. Open the `*.vercel.app` URL and create your account first, so you become admin.

### Optional: email (Resend)
1. Sign up at https://resend.com → **Domains** → **Add domain** (e.g. `yourdomain.com`) and add the DNS records it shows at your domain host. Wait for **Verified**.
2. **API Keys** → **Create API key** (Sending access) → copy it into `RESEND_API_KEY`.
3. Set `EMAIL_FROM` to an address on that domain, then redeploy.

Until a domain is verified, Resend's test sender only delivers to your own Resend login email. **Without Resend:** new accounts skip the code but need admin approval, and admins reset forgotten passwords from **Members → Reset password**.

### Optional: Slack alerts for new sign-ups
1. Go to https://api.slack.com/apps → **Create New App** → **From scratch**, name it "Duda Site Auditor" and pick your workspace.
2. In the left menu, open **Incoming Webhooks**, switch it **On**, then click **Add New Webhook to Workspace**.
3. Choose the channel for alerts (e.g. `#site-audits`) → **Allow**.
4. Copy the webhook URL (starts with `https://hooks.slack.com/services/…`) into `SLACK_WEBHOOK_URL` and redeploy.

Every admin also gets an email (if Resend is set up) and a bell notification when someone signs up.

### Optional: ✨ AI checks (free models, with automatic fallback)
Add one or more free keys. None of them need a credit card:
1. **Gemini:** https://aistudio.google.com → **Get API key → Create API key** → `GEMINI_API_KEY`.
2. **Groq:** https://console.groq.com → **API Keys → Create API Key** → `GROQ_API_KEY`.
3. **Cerebras** (smart gpt-oss-120b, about 1M tokens a day): https://cloud.cerebras.ai → sign up → **API Keys** → `CEREBRAS_API_KEY`.
4. **Mistral** (Mistral Medium): https://console.mistral.ai → choose the free **Experiment** plan (phone check, no card) → **API Keys → Create new key** → `MISTRAL_API_KEY`.
5. **Cloudflare Workers AI** (gpt-oss-120b, 10,000 free "neurons" a day, roughly 50–100 checks): https://dash.cloudflare.com → sign up → **AI → Workers AI → Use REST API** → **Create a Workers AI API Token** → `CLOUDFLARE_API_TOKEN`, and copy the **Account ID** shown on the same page → `CLOUDFLARE_ACCOUNT_ID`.
6. **OpenRouter** (optional extra backup): https://openrouter.ai → **Keys → Create key** → `OPENROUTER_API_KEY`.

Tick **Sensitive** for each, then redeploy.

**How the fallback works:** models are tried in `AI_ORDER`, skipping anything in `AI_OFF`. When one hits its per-minute limit, its daily limit, this app's daily cap, or runs out of credits, it rests until it resets and the next one answers. If every model is resting for up to 3 minutes, the scan waits with a countdown; for longer, it finishes and the rest becomes **AI check pending** items (below).

**What the team sees about AI:** everyone except the super admin (`SUGGESTIONS_OWNER`) sees one combined **Site Auditor AI** on the AI Status tab: total credits per day, used, left, the earliest daily reset, and when it's back if paused. They don't see how many AI services there are, which ones, or that they are free tiers, and the app never shows setup names or hosting details to them. The super admin sees the full per-model view.

**Made-up AI names (super admin view):** the team only ever sees made-up names: **Atlas** (AI Gateway), **Nova** (Gemini), **Orion** (Groq), **Vega** (OpenRouter), **Lyra** (Anthropic). The real provider and model never reach their browser, including in the app's network responses and saved scan results. Only the app owner (`SUGGESTIONS_OWNER`) sees the real names on the AI Status tab, for troubleshooting. Rename them with `AI_ALIASES`, e.g. `gemini=Nova,groq=Orion`.

**Projects (`api/_project.js`, `api/projects.js`):** the build workflow, kept deliberately separate from audits — an audit is one scan, a project is the whole job and can exist before the website does. Eleven phases from Data collection to Jaguars; `handOver()` is one function because a phase that moved without telling anybody is the failure mode it exists to prevent. Deadlines are checked when somebody opens the list (`checkLate`), not on a timer, and `lateNotified` stops it nagging. Summaries live in `dsa:projindex` so the board never needs one read per project.

**Dropbox (`api/_dropbox.js`):** read-only, and everything goes through `shared_link`, so a PM pastes an ordinary share link and the folder never has to be in our own Dropbox. Short-lived tokens refreshed from `DROPBOX_REFRESH_TOKEN`, cached in the store rather than per instance. Scopes: `files.metadata.read`, `sharing.read`.

**Reading a brief (`api/_pdf.js`):** no dependencies — it walks the filter chain (ASCII85 and ASCIIHex as well as Flate; chained filters are the common case and skipping them makes an ordinary PDF look like a scan), inflates the content streams and reads the text operators. Labels first, patterns second, and every value carries how it was found so the screen can show a guess differently from an answer. A business name is only ever taken from a label: a wrong name becomes the reference every later audit is checked against, and unlike the other fields a plausible wrong one is invisible. No OCR — a scanned brief is reported as unreadable rather than guessed at.

**The brief as the audit reference:** `buildTruth(api, schema, brief)` puts the project's agreed details at the FRONT of each list while keeping Duda's, so the brief is what a finding quotes as expected and nothing is flagged for using a value Duda holds.

**Manual audit items:** `op=addItem` writes a finding with `manual: true`, a screenshot as a data URL (shrunk client-side, 1MB cap). `saveScan` carries manual findings across untouched — a rescan replaces what the *scanner* found, never what a person wrote.

**What makes two enquiries the same one (`api/_leadid.js`):** Duda's form-history endpoint returns only `date`, `form_title`, `message` and `utm_campaign` — no submission id and no page. So identity is decided by content: `leadSig` hashes the customer's answers (values only, envelope fields excluded, so the live and imported copies match even when labelled differently), and a submission with no id gets `stableId(at, sig)`, which makes re-importing idempotent. Copies within 30 minutes are merged by `clusterDupes`, keeping the copy that knows its page and carrying over any human ruling. Imports check `(site, sig)` before inserting; a late live copy hands its page to the stored one. An unknown page is stored as `''`, never `'/'`. Existing data is cleaned by `tidySite`, run after every import and, once per `TIDY_VERSION`, for every stored website by the background queue when there is nothing left to fetch.

**Form submissions, and why nothing is scheduled:** the account-wide `CONTACT_FORM_SENT_V2` webhook means Duda pushes every new submission for every website the moment it happens — no polling, no cron, no per-site subscription. Only *history* has to be fetched, which is a job that finishes: each published website is queued once for its past year and the queue drains a few at a time while somebody has the app open (`api/_queue.js`, lock-guarded in Redis so six open browsers still produce one pull). Websites join the queue on `PUBLISH`, on being sent for audit, and when they first appear in the website list. The manual **Get form submissions** button takes the same lock, so the two can never collide — a person who presses it mid-drain is told in plain words and the browser retries. Scheduled jobs would not help here anyway: on the free plan they are capped at once per day.

**Trends and domain health (`api/_pubhist.js`, `api/_domains.js`):** publish history is one short line per change in `dsa:pubev:<YYYY-MM>` lists, written by the `PUBLISH`/`UNPUBLISH`/`DOMAIN_UPDATED` webhooks (Duda's `first_publish`/`republish` flags say launch, re-publish or comeback) and by comparing each pull of the published list with the last (catches deletions and missed webhooks; a pull under 90% of the last is ignored). `GET /api/dudasites?op=stats` returns every website's dates plus the settled events; the browser buckets them, so changing the range costs nothing. First open copies the old per-site `sitefeed:` lists in once. Domain checks now also read the TLS certificate's expiry, the RDAP registration expiry (weekly) and response time, and alert admins (kinds `domain-problem`, `domain-expiring`, `domain-ok`, `domain-digest`; `urgent: true` on the loud ones) on a confirmed working→broken change, recovery, a broken brand-new launch, and the domain registration at 60/30/14/7/3/1 days (then every 3 days once expired). **Security certificates are Duda's job: shown as information only, never a problem, never alerted** (the `CERTIFICATE_CREATED` webhook no longer alerts). Problem starts/recoveries are also kept in `dsa:domev` (a capped list) for the date-filtered Domain monitoring cards on Trends; the sweep ends with one `domain-digest` report of everything still open. **The one scheduled job:** `vercel.json` runs `GET /api/dudasites?op=sweep` daily; it refreshes the list and checks every live domain not checked in 20 hours, inside a 95-second budget. It runs at most once per 20 hours whoever calls it; set `CRON_SECRET` to restrict it to Vercel's scheduler.

**Website analytics (`api/analytics.js`):** `GET /api/analytics?site=<duda id>&days=30|90|365` reads Duda's `GET /analytics/site/{id}` (traffic totals, previous period, `dateGranularity=DAYS` and `MONTHS`, activities, `dimension=system` and `geo`: 7 calls) plus any connected providers, cached 6 hours per site and range in `dsa:an:<id>:<days>` (10 minutes when something failed). Per-site providers live in the `dsa:anprov` hash; `PROVIDERS` in the file is the list to extend. Google Analytics 4 (Data API `batchRunReports`) and Search Console (`searchAnalytics/query`) use one service account from `GOOGLE_SERVICE_ACCOUNT` (JSON or base64 JSON), signed with a JWT in-process, scopes `analytics.readonly` and `webmasters.readonly`. Permissions `analytics.view` (members get it on a fresh install; an edited Member role needs it ticked) and `analytics.manage`. Clients get nothing.

**Profiles without records:** every live website has a profile at `#/dr/<dudaSiteId>`, assembled from the cached website list plus that site id's own enquiries. No record is written until somebody audits it. An audited website's `#/dr/<id>` goes to its audit's Profile tab, and both use the same `renderSiteProfile()` layout. **Thumbnails:** `POST /api/capture {op:'thumb', site:<duda id>, pub}` takes a 480 px WebP of the draft's first screen (about 15–30 KB) into `dsa:thumb:<id>`, only when a profile is opened and the stored one is missing, older than the last publish, or a week old; `GET /api/capture?op=thumb&site=` serves it (team only). This is deliberate — `dsa:index` is read whole on most page loads, so adding ~700 rows to it to display data that already exists would slow down every request in the app.

**Command budget (read before adding anything that runs on a timer):** the key-value store's free allowance is 500K commands a month, about 16K a day, and every open tab spends from it. Measured costs: one heartbeat 9, an idle tab ~0 between heartbeats, one website's history import ≤ ~80 (main store) or ~10 (analysis database). Rules that keep it there: nothing polls on its own timer — state that needs checking rides on the heartbeat (`api/pulse.js`); anything periodic pauses when the tab is hidden; reads of several keys go in one pipeline; totals are recounted once per job, never per step. The counter in `redis()` flushes in batches of 50, and `paceCheck` alerts the owner as soon as the month is on course to overrun. Measure before and after with `cost1.mjs` against the fake (it counts every command).

**System health (owner only):** **Your account → ⚑ System health** shows storage and monthly allowances as meters against their ceilings, a line per outside connection with whether anything has gone quiet, and a short list of what needs attention. It is refused to everyone else — including other admins — at the page, the route and the endpoint, and its Guide page and release note are hidden from them and from the Help assistant. Press **Measure storage now** to measure the key-value store; the result is kept, so the page can show how fast it is growing and roughly how long is left. Commands are counted exactly in `usage:cmd:<month>` and projected to month end. One figure it cannot show: rows *read* from the analysis database are billed too and only that provider's dashboard knows the number. It also alerts the owner (bell + Slack) on storage over 70%/85%, a month projected to overrun the command allowance, nothing arriving from Duda for three days, and websites whose history failed three times — each kind deduplicated for hours via `dsa:alerted:<kind>` so a persistent problem never becomes noise.

**Model names update themselves:** providers retire model names often. When a model is refused, the app lists that provider's current models, picks the best one (for example the newest Gemini Flash, or Groq's largest general model), remembers it for 7 days and marks it **auto-selected** on the AI Status tab. **Test all models** on that tab checks each model right away (1 credit each).

**AI Status tab:** shows today's free credits (requests) across all free models, how many are used and left, each model's status, and a live countdown to when it's back and when its daily limit resets. It also lists websites waiting for AI credits.

**When credits run out mid-scan:** the pages the AI couldn't read become audit items in the **AI check pending** category, with a button like "No more AI credits · will resume after Tue, Sep 22, 3:00 PM". You can check them by hand (the item lists every text block or image with **👁 Show on page**) and mark it **Done**: the AI will then skip that page, including on later rescans. Anything not marked Done resumes automatically once a model is back, as long as someone has the app open (or click **Run now** on the AI Status tab).

Daily resets: Gemini at midnight Pacific time; Groq's daily limits roll (the countdown uses the time Groq reports); OpenRouter at midnight UTC.

**Later, with budget:** add `AI_GATEWAY_API_KEY`. It's first in the default order, so it answers first and the free models become the backup. Its free tier only covers a few niche models, so don't add the key until you buy credits (or set `AI_GATEWAY_MODEL` to one of its free-tier models).

Privacy: free tiers may use requests to improve their models. The app only sends public page text and alt text.

What the AI checks after every scan (tuned for Detailers Roadmap detailing clients; product brands like Ceramic Pro, XPEL, SunTek or Gtechniq, booking tools like Urable, and `AGENCY_NAMES` are never treated as another business):
- **Alt text:** does it describe the photo, name this business, name **another** business, mention the **wrong city**, or look like placeholder text?
- **Page text** (headings, paragraphs, side panels, titles and descriptions): mentions of **another business** (template leftovers), a **city/state that doesn't match** the business location or its service-area pages, and **misspelled variants** of the business name. Each finding shows the quote, the reason and suggested wording.

### Optional: Slack direct messages from "Site Auditor"
The app can DM people on Slack when something needs them: a mention, a reply, an assigned audit item, a False alarm (admins), a new sign-up (admins), suggestion updates. It finds each person by the email they registered with, so their app email must match their Slack email. Each person can turn it off under their account (avatar, top right) and send themselves a test message.
1. https://api.slack.com/apps → your app (**DR Duda Site Auditor**).
2. **App Home** → **App Display Name** → set the bot name to **Site Auditor**. Also turn on **Messages Tab** so the DMs appear in its own chat.
3. **OAuth & Permissions** → **Bot Token Scopes** → add `chat:write`, `users:read` and `users:read.email`.
4. Click **Install to Workspace** (or **Reinstall**). A workspace admin may need to approve it again.
5. Copy the **Bot User OAuth Token** (starts with `xoxb-`) into Vercel as `SLACK_BOT_TOKEN` (tick **Sensitive**) and redeploy.

### Optional (recommended): instant "someone is on this website" pop-ups with Ably
Browsers signal each other directly through Ably's free realtime service. Nothing is written to your database for this.
1. Sign up at https://ably.com (free plan: 200 people connected at once, 6 million messages a month).
2. In the dashboard open your app → **API Keys** → copy the **Root** key (it looks like `abc123.XyZ9:long-secret`).
3. Add it in Vercel as `ABLY_API_KEY` (tick **Sensitive**) and redeploy.

The key stays on the server: each browser gets a short-lived pass that only allows joining website presence channels. Without `ABLY_API_KEY`, the app uses its regular heartbeat instead: the person entering still sees who is there right away, but people already inside hear about a newcomer within about 2 minutes.

### Optional: Sign in with Google
1. https://console.cloud.google.com → create or select a project.
2. **APIs & Services → OAuth consent screen**: choose External, enter the app name and support email, save, then click **Publish app** so it's "In production". No review is needed for basic sign-in.
3. **Credentials → Create credentials → OAuth client ID → Web application**. Under **Authorized JavaScript origins** add `https://duda-site-audit.vercel.app` (your app URL). No redirect URI is needed.
4. Copy the **Client ID** into `GOOGLE_CLIENT_ID` and redeploy.

A Google account and an email/password account with the same email are treated as the same person, so duplicates are impossible.

---

## 2. Using it

1. Everyone creates an account on the sign-in page (email + code, or Google). Admins approve new people under **Members**.
2. **Live DR Sites** (top menu) lists every published website in the Duda account (refreshed from Duda every 6 hours, or with **↻ Refresh from Duda**). Search by name, site ID, domain or label, filter by audited / not audited / open issues, and click **Audit this website** to add it to **Audits** and scan it. Audited sites show their last audit date and issue count and link straight to the audit. Business names are filled in automatically in the background (Duda's site list doesn't include them). **Domain status:** the app opens every live domain and marks it **Working**, **Redirects to another site** (flagged as spam/gambling when it is), **Not pointing to this website**, **404 / server error**, **DNS not resolving**, **Not responding** or **No custom domain**. It checks unchecked domains automatically and rechecks every 7 days, or on demand with **🌐 Check domains**. Filter by **Domain problems** or sort **Domain problems first**. A site with a domain problem asks before auditing, and its audit page shows a red banner, because the domain needs the customer to fix it first. Or use **+ Add website** → paste one or many editor links, one per line (e.g. `https://8bitcreative.responsivesiteeditor.com/home/site/f981a954/home`), choose an assignee and click **Add & start audit**.
3. Keep the tab open while it scans. Two sites run at a time, and each shows `Scanning 40/120`, then **✓ Scan complete**.
4. Open a site. Every audit item has an ID (#12). Click a row to open it: set its status (**Open / For clarification / Done / On hold / False alarm**), reassign it, comment, paste screenshots and reply.
5. Click anyone in **Team status** (the dots at the top right) to see what they worked on: the website they have open right now, their latest audit item (status change or comment), recent websites, and their full activity log across all websites, filterable by audit items, comments, scans and websites.
6. **Working on the same website:** when you open a website someone else has open, you get a pop-up ("Cler is currently working on this website"), and they get one too ("Euch just entered this website"), with a reminder to coordinate so two people don't work on the same audit item. A bar under the website title shows who else is there. Pop-ups appear top right, stack, show the date and time, and fade after the time each person picks under their account (avatar → Pop-up notifications stay on screen for…). Hover to pause; ✕ to close.
7. **Desktop notifications:** the app offers once (and the bell has a **Turn on** button) to show system notifications when it's minimized or in a background tab: new sign-ups for admins, mentions, replies, assignments and "someone joined this website". If someone declines or ignores it, the in-app pop-ups and the bell work as before. With `ABLY_API_KEY` these arrive instantly; without it, within a few minutes.
8. **False alarms (admins):** when anyone marks an audit item **False alarm**, they can add a short reason. The item appears under **Suggestions → False alarms**, visible to admins only, with the check name, website, what was found, the AI's opinion, and the reason. Admins set **New / Ongoing / Done / Skip**, add notes, and click **Open audit item** to jump to it. **Most reported checks** shows which checks cause the most false alarms, and **Copy open items as text** gives a ready-to-paste list for whoever updates the app.
9. Members don't see who is an admin; only admins see roles.
9. Admins see an app-wide **Activity** page (websites added or deleted, sign-ups, approvals, with date and time). The dots at the top right show who has the app open: green = active, grey = idle for 1 hour or more.
6. **💡 Suggest a feature** sends an idea privately to the app owner, who can mark it New, On going, Done or Nope and reply in comments.
7. Screenshots pasted or uploaded into comments are optimized automatically in the browser: resized to 1600px wide at most and saved as WebP (usually 30–400 KB).
8. Use the **Comments** tab for general discussion: `@` tags a member, `#12` links an audit item, and **Reply** quotes a comment. The **Activity log** tab records every comment, reply, status and assignee change.
8. Set the website status: **Not started / In progress / Complete with query / Complete / On hold**.
9. **Rescan** after fixing. IDs, statuses, assignees and comments stay with issues that still exist. Items no longer found on a scanned page close themselves as Done (`gone.why: 'gone'`, fstate `auto: 'rescan-gone'`), or as `check-corrected` when the check that raised them has since been corrected (the browser sends those codes as `corrected`). They stay on the site for 45 days. If one comes back it reopens (`auto: 'came-back'`) with its old number. An item whose selector shifted only because a sibling was removed is matched on code + found + message + page, and keeps its number and status. An item a person marked Done that the rescan still finds reopens (`auto: 'still-there'`, `autoRef` = who marked it Done, who is notified as a `challenge`). False alarm set by a person is never overwritten, `AI_PENDING` items checked by hand are exempt, and hand-written items are never touched.
10. **Export CSV** for a report.

**Jumping to an element:** click the selector (or **👁 Show on page**) on any audit item. A preview of that page opens on the right device with the element outlined in red and scrolled into view. Side-panel and device-hidden items are opened/shown automatically. Switch Desktop/Tablet/Mobile or the page at the top, or click **Open live preview ↗** to see the real page. **Copy** copies the selector, and **⌖ Copy highlight snippet** in the item still works in DevTools. Elements hidden on the live page (display:none or visibility:hidden on the element or a parent, opacity 0 while waiting for a scroll animation, off-screen, collapsed or screen-reader-only) are shown anyway, and the note says exactly what hides them.

**Adding a site that already exists** is skipped: the dialog shows it with **Open existing audit**.

**Live scan status:** a pulsing line shows how long the current step has taken. During AI steps there is a **Skip AI for now** button; skipped pages become AI check pending items that resume later. AI requests time out after about 2 minutes and retry once.

**Brand, partner and certification logos** (e.g. Fuel Off-Road, KMC, XPEL, IDA) are treated as correct when the alt text names them. Only the site's own logo (header / side panel, or footer linking home) must name this business. If the AI still flags a logo as another business, it takes a second look at the actual image (Gemini) before reporting it.

---

## Client tickets (questions and marked-up change requests)

Clients press **Send a ticket** on their page and choose **General question** (text plus an optional photo) or **Website change** (mark a picture of their own website; each mark is one ticket). The team handles them on **Tickets**.

- **Live browsing** (`api/live.js`): the client browses the Duda draft inside the app. The page is fetched through `/api/live`, with a `<base>` pointing back at Duda and a small helper script added (it reports page, scroll and clicks, keeps links inside the site, and switches off forms). It is served with `Content-Security-Policy: sandbox allow-scripts`, so it has no origin of its own. `vercel.json` allows only this route in a frame, and every endpoint refuses changes from a page with no origin. Marks are drawn **on the live page**: the helper reports scroll and, on request, where every element sits (`api/_map.js`, shared with the server pictures), and the overlay uses the same page-pixel arithmetic as on a picture. Send saves the ticket at once (`live: true`, with the page, device, scroll and clicks). The browser then calls `/api/capture { op: 'attach' }`, which takes the pictures in the background with `replay` (same page, clicks repeated where they were made, same scroll, sideways scroll reset). Chrome draws the mark onto the page for the cropped picture. Team: **📷 Take the picture now** retries it.
- **Page pictures** are taken on the server by `api/capture.js` with a real headless Chrome (`api/_shoot.js` drives it directly; the only dependency is `@sparticuz/chromium`, listed in `package.json`, which Vercel installs on deploy). `vercel.json` gives that one function more memory and includes the Chromium files. The page is opened on the Duda **preview of the draft** (`https://<editor host>/site/<id>/<page>?preview=true…`) at 1920 × 1000 (desktop), 820 × 1180 (tablet) or 390 × 844 (phone), scrolled once so late images load, then photographed in slices. Where every text, image and button sits is saved with it, so a tap can be matched to an element.
- A picture of a page is reused for 6 hours (adjustable in Settings). It expires after 14 days, or 60 days once a request points at it. Each request keeps its own small cropped picture for good.
- **Daily limit**: 10 requests per client per day by default (admins: **Tickets → ⚙ Settings**), counted in `TICKET_TZ` (default `Asia/Manila`). Clients can also open about 60 page pictures a day.
- **Is it checked?** Opening a request reads the current draft through `/api/fetch` and compares the marked element's text with what the client saw.
- **Test page pictures** in Settings shows straight away whether Chrome runs on the server.
- Local development: set `CAPTURE_CHROME_PATH` to any Chrome or Chromium binary.
- Database cost: a new picture is a few commands (one per slice). A request is about 10, plus 2 per person told. Listing requests is 2 (LRANGE + MGET).

## 3. What it checks

| Area | Checks |
|---|---|
| Contact info | Every phone and email in text, `tel:` / `mailto:` / `sms:` links, alt/title/aria/data attributes, SEO meta and schema vs Business Info. **Buttons that show one number but dial another.** |
| Other-client leftovers | Social links, Google Maps embeds and links, logo alt text and copyright lines naming another business, plus a text search for those names on every page. Links to other Duda sites or editor/preview URLs. |
| Devices | Desktop, Tablet and Mobile HTML fetched separately. Side panels, popups and device-hidden elements are included and labelled with where they are visible. |
| Links | 404 internal pages, broken external links and images, buttons with no link, http:// links |
| Images | Missing, empty, generic or filename-like alt text, and logo alt without the business name |
| Meta / SEO | Missing/long/short/duplicate titles and descriptions, noindex pages (from Duda SEO settings), missing H1, canonical domain, og:image |
| Content | Lorem ipsum, template placeholders, 555 numbers, `{{unresolved}}` fields, TBD/XXX, outdated copyright year, repeated words |
| Facebook / Google Business | Best-effort read of the public profile's name, phone and email (general note; these sites often block automated reads) |

**Still review by hand:** business hours, prices, service areas, form notification recipients (not visible in page HTML), text inside images, and third-party widgets loaded later by JavaScript.

---

## 4. How it works

- `api/site.js` calls the Duda API (`/sites/multiscreen/{id}`, `/content`, `/pages`) with your API credentials, server side only.
- `api/fetch.js` fetches Duda's per-device preview: `https://{editor-host}/site/{id}/{page}?preview=true&insitepreview=true&dm_device=desktop|tablet|mobile`.
- `public/engine.js` parses each page in the browser and applies Duda's visibility rules (`.showOnMedium`, `.showOnLarge`, `.hide-for-*`, `[data-hidden-on-*]`) to label every finding by device.
- `api/check.js` checks external links and images. `api/social.js` reads Facebook/GBP metadata. `api/store.js` saves to Upstash Redis.
- `api/auth.js` handles sign-in, `api/users.js` members, `api/pulse.js` presence and notifications, `api/suggest.js` suggestions, and `api/img.js` screenshots.
- No npm dependencies and no build step.
- Database usage: a team of about 5 stays within Upstash's free plan. For a bigger team, switch Upstash to Pay As You Go, which costs cents a month.

**Run locally:** copy `.env.example` to `.env.local`, fill it in, run `npm run dev` and open http://localhost:3000.

**Console-only version:** `console-audit.js` runs the same engine in DevTools on the site's preview page (`https://{editor-host}/preview/{siteId}`). It uses the site schema as the reference, prints a table and downloads a CSV. Useful for one-off checks without the app.

## Database usage (planned for 800+ websites)
Upstash's free plan allows 256 MB of data, 500K commands a month and 10 GB of bandwidth. It never charges you unless you add a card; over the limit it may slow down.

What the app stores and how it stays small:
- **Website audits:** compressed (about 7–9x smaller), roughly 5–25 KB per website, so 800 websites ≈ 5–20 MB.
- **Website list:** one small summary per website, loaded only when something changed (open tabs first ask "anything new?" with one tiny read).
- **Activity logs:** last 300 entries per website and per member; app-wide log last 1,000; notifications last 100 per person.
- **AI answers:** one small cache per business, removed automatically 45 days after the last scan.
- **Screenshots:** the biggest items (up to ~250 KB each after automatic optimization). They are deleted when their comment or website is deleted.
- **Presence:** with Ably, nothing is stored. The heartbeat runs every 2 minutes (5 minutes in background tabs).

Rough monthly total for 5 people auditing daily: about 200–350K commands, and 30–60 MB of data plus screenshots. Check real numbers any time in Upstash → your database → **Usage**. Admins can click **🧹 Optimize database** on the **Activity** page once after updating: it compresses older website records, trims long logs and removes the old AI cache format.

## Security notes
- Duda API credentials only live in Vercel environment variables and are never sent to the browser.
- Every API endpoint requires a signed-in, admin-approved account. Passwords are hashed (scrypt), and sessions use HttpOnly secure cookies.
- If your API password was ever shared in chat or a screenshot, rotate it in Duda and update the Vercel variable.


## Audit summary, backups and spelling

- **📋 Summary** (`openSummary` / `auditSummary` in `public/app.js`) builds a plain-text report from the loaded audit: coverage from `scan` (pages, external links, images), fixed items (status `done`, excluding `check-corrected`), false alarms, open items, and a spelling comparison from `NAME_SPELLING` items. Contact lines use `f.known.comments[].fromFound` and `site.ccSearched` (returned by `op=site`) to say whether the client's comments mention the value.
- **Comment cross-check** (`api/_crosscheck.js`) covers phones, emails, business names (squashed: `&`/`and`/spaces/punctuation ignored) and street addresses. Each comment hit carries `fromFound` (it mentions the value the item found, not just the official one).
- **Backups** (`api/_backup.js`): `POST /sites/multiscreen/backups/{site}/create` with `{ name }`. Name `R8<initials>_b4_audit_<YYYYMMDD>_<HHMM>` in the browser's local time; `_2`, `_3`… if taken. Made automatically by `scanState` before an audit's first scan, and by `store op=backup` on demand. Stored on the site as `backups[]` (last 20) and logged as activity type `backup`. Duda allows 50 manual backups per site.
- **NAME_SPELLING** (engine `nameVariants`, check release v19): word windows of the page text whose squashed form equals the official name (or is one letter off for names of 8+ letters, capitalised) but whose spelling differs.
- **One item per website** (engine `oneItemPerSite`, release v20): codes in `ONE_ITEM` (currently `MAILTO_SHARE_NO_TO`, a share-by-email link with no recipient) are collapsed into a single finding whose ID depends only on the code, with `dupPlaces` (selector, location, pages, devices) and `placesKind: 'link'`. The UI lists one row per page with its own Show on page. Fixing places shrinks the item; the rescan that finds none closes it.
- **Screenshot annotator** (`openAnnotator` in `public/app.js`): canvas editor with box/circle/arrow/text shapes kept as objects (move, resize, delete, undo) and flattened only on export (Copy picture via `ClipboardItem`, Download, or `onDone(blob)`). Used from the rich editor and from every comment composer.
- **Rich item detail** (`richEditor`, `cleanRich` in the browser; `api/_rich.js` `cleanRichHtml` on the server): allowlist of b/strong/i/em/u/br/p/div/ul/ol/li/a(http, https, mailto)/img(only `/api/img?id=…`). Pasted pictures upload to `/api/img`. Stored as `detailHtml` plus a plain-text `detail`.
- **Summary grouping**: `sumTopic` groups items by what they are about (phone number, email, other business's name, spelling variant, address, or code + message), so one problem in many places is one entry with its pages listed.
- **Business Info addresses**: a town-only address (or `address_geolocation`) is kept; ZIP and street checks only use addresses that have one; `truth.addressSeen` records what Duda sent, shown when the address is empty.
