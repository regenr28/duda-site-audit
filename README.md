# Duda Site Auditor

A team web app for auditing Duda websites before and after launch. Paste an editor link and it crawls every page on **Desktop, Tablet and Mobile**, including side panels (hamburger drawers), popups and elements hidden on some devices. Everything is compared against the site's **Business Info** from the Duda API.

Each finding shows **page path · where (Header / Footer / Side panel / Popup / Body + devices) · unique CSS selector · the issue (found vs. expected)**, with an ID (#12), a status, an assignee and its own comment thread.

---

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
| `AI_ORDER` | `gateway,gemini,groq,openrouter,anthropic` (default) | optional. The order the models are tried in. |
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

**How the fallback works:** models are tried in `AI_ORDER`. When one hits its per-minute limit, its daily limit, this app's daily cap, or runs out of credits, it rests until it resets and the next one answers. If every model is resting for up to 3 minutes, the scan waits with a countdown; for longer, it finishes and the rest becomes **AI check pending** items (below).

**What the team sees about AI:** everyone except the super admin (`SUGGESTIONS_OWNER`) sees one combined **Site Auditor AI** on the AI Status tab: total credits per day, used, left, the earliest daily reset, and when it's back if paused. They don't see how many AI services there are, which ones, or that they are free tiers, and the app never shows setup names or hosting details to them. The super admin sees the full per-model view.

**Made-up AI names (super admin view):** the team only ever sees made-up names: **Atlas** (AI Gateway), **Nova** (Gemini), **Orion** (Groq), **Vega** (OpenRouter), **Lyra** (Anthropic). The real provider and model never reach their browser, including in the app's network responses and saved scan results. Only the app owner (`SUGGESTIONS_OWNER`) sees the real names on the AI Status tab, for troubleshooting. Rename them with `AI_ALIASES`, e.g. `gemini=Nova,groq=Orion`.

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
2. **Live DR Sites** (top menu) lists every published website in the Duda account (refreshed from Duda every 6 hours, or with **↻ Refresh from Duda**). Search by name, site ID, domain or label, filter by audited / not audited / open issues, and click **Audit this website** to add it to **Audits** and scan it. Audited sites show their last audit date and issue count and link straight to the audit. Business names are filled in automatically in the background (Duda's site list doesn't include them). **Domain status:** the app opens every live domain and marks it **Working**, **Redirects to another site** (flagged as spam/gambling when it is), **Not pointing to this website**, **404 / server error**, **DNS not resolving**, **SSL problem**, **Not responding** or **No custom domain**. It checks unchecked domains automatically and rechecks every 7 days, or on demand with **🌐 Check domains**. Filter by **Domain problems** or sort **Domain problems first**. A site with a domain problem asks before auditing, and its audit page shows a red banner, because the domain needs the customer to fix it first. Or use **+ Add website** → paste one or many editor links, one per line (e.g. `https://8bitcreative.responsivesiteeditor.com/home/site/f981a954/home`), choose an assignee and click **Add & start audit**.
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
9. **Rescan** after fixing. IDs, statuses, assignees and comments stay with issues that still exist, and fixed ones drop off.
10. **Export CSV** for a report.

**Jumping to an element:** click the selector (or **👁 Show on page**) on any audit item. A preview of that page opens on the right device with the element outlined in red and scrolled into view. Side-panel and device-hidden items are opened/shown automatically. Switch Desktop/Tablet/Mobile or the page at the top, or click **Open live preview ↗** to see the real page. **Copy** copies the selector, and **⌖ Copy highlight snippet** in the item still works in DevTools. Elements hidden on the live page (display:none or visibility:hidden on the element or a parent, opacity 0 while waiting for a scroll animation, off-screen, collapsed or screen-reader-only) are shown anyway, and the note says exactly what hides them.

**Adding a site that already exists** is skipped: the dialog shows it with **Open existing audit**.

**Live scan status:** a pulsing line shows how long the current step has taken. During AI steps there is a **Skip AI for now** button; skipped pages become AI check pending items that resume later. AI requests time out after about 2 minutes and retry once.

**Brand, partner and certification logos** (e.g. Fuel Off-Road, KMC, XPEL, IDA) are treated as correct when the alt text names them. Only the site's own logo (header / side panel, or footer linking home) must name this business. If the AI still flags a logo as another business, it takes a second look at the actual image (Gemini) before reporting it.

---

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
