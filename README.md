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
| `SLACK_WEBHOOK_URL` | Slack Incoming Webhook URL | optional. Posts to Slack when someone signs up and needs approval. |
| `SUGGESTIONS_OWNER` | `regencia.reymark28@gmail.com` (default) | optional. The only person who sees every feature suggestion. |
| `ALLOWED_EMAIL_DOMAINS` | e.g. `8bitcreative.com` | optional. People with these email domains skip admin approval. |
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

### Optional: Sign in with Google
1. https://console.cloud.google.com → create or select a project.
2. **APIs & Services → OAuth consent screen**: choose External, enter the app name and support email, save, then click **Publish app** so it's "In production". No review is needed for basic sign-in.
3. **Credentials → Create credentials → OAuth client ID → Web application**. Under **Authorized JavaScript origins** add `https://duda-site-audit.vercel.app` (your app URL). No redirect URI is needed.
4. Copy the **Client ID** into `GOOGLE_CLIENT_ID` and redeploy.

A Google account and an email/password account with the same email are treated as the same person, so duplicates are impossible.

---

## 2. Using it

1. Everyone creates an account on the sign-in page (email + code, or Google). Admins approve new people under **Members**.
2. **+ Add website** → paste one or many editor links, one per line (e.g. `https://8bitcreative.responsivesiteeditor.com/home/site/f981a954/home`), choose an assignee and click **Add & start audit**.
3. Keep the tab open while it scans. Two sites run at a time, and each shows `Scanning 40/120`, then **✓ Scan complete**.
4. Open a site. Every audit item has an ID (#12). Click a row to open it: set its status (**Open / For clarification / Done / On hold / False alarm**), reassign it, comment, paste screenshots and reply.
5. Admins see an app-wide **Activity** page (websites added or deleted, sign-ups, approvals, with date and time). The dots at the top right show who has the app open: green = active, grey = idle for 1 hour or more.
6. **💡 Suggest a feature** sends an idea privately to the app owner, who can mark it New, On going, Done or Nope and reply in comments.
7. Use the **Comments** tab for general discussion: `@` tags a member, `#12` links an audit item, and **Reply** quotes a comment. The **Activity log** tab records every comment, reply, status and assignee change.
8. Set the website status: **Not started / In progress / Complete with query / Complete / On hold**.
9. **Rescan** after fixing. IDs, statuses, assignees and comments stay with issues that still exist, and fixed ones drop off.
10. **Export CSV** for a report.

**Jumping to an element:** click a selector to copy it, or open the item and click **⌖ Copy highlight snippet**. Then open the page's device preview (click the path), open DevTools (Cmd+Option+J / Ctrl+Shift+J) and paste. The element scrolls into view with a red outline. "Side panel" items are inside the hamburger menu, so open it first.

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

## Security notes
- Duda API credentials only live in Vercel environment variables and are never sent to the browser.
- Every API endpoint requires a signed-in, admin-approved account. Passwords are hashed (scrypt), and sessions use HttpOnly secure cookies.
- If your API password was ever shared in chat or a screenshot, rotate it in Duda and update the Vercel variable.
