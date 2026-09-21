# Duda Site Auditor

A team web app for auditing Duda websites before and after launch. Paste an editor link and it crawls every page on **Desktop, Tablet and Mobile**, including side panels (hamburger drawers), popups and elements hidden on some devices. Everything is compared against the site's **Business Info** from the Duda API.

Each finding shows **page path · where (Header / Footer / Side panel / Popup / Body + devices) · unique CSS selector · the issue (found vs. expected)**, with a checkbox and an assignee.

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
| `APP_PASSWORD` | a team password you choose | strongly recommended. It locks the app and its API. |
| `ALLOWED_EDITOR_HOSTS` | `responsivesiteeditor.com` | optional. Add your white-label editor domain(s), comma-separated. |

### Step 4: Shared team storage (recommended)
Vercel project → **Storage** → **Create Database** → **Upstash for Redis** (free plan) → **Connect to Project**.
This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically. Members, statuses, checkboxes and assignees are then shared by everyone.
*Without it, the app still works, but data is saved only in the browser you use.*

### Step 5: Deploy
Click **Deploy**. If you change variables later, use **Deployments → ⋯ → Redeploy**. Open the `*.vercel.app` URL, enter the APP_PASSWORD, then share the URL and password with your team.

**Using the terminal instead:** `npm i -g vercel`, then `vercel` inside this folder, then `vercel env add DUDA_API_USERNAME` (and the other variables), then `vercel --prod`.

---

## 2. Using it

1. **Members** → add your team.
2. **+ Add website** → paste one or many editor links, one per line (e.g. `https://8bitcreative.responsivesiteeditor.com/home/site/f981a954/home`), choose an assignee and click **Add & start audit**.
3. Keep the tab open while it scans. Two sites run at a time, and each shows `Scanning 40/120`, then **✓ Scan complete**.
4. Open a site. Filter by severity, category, location, device, assignee or open/checked-off. Tick items as they're fixed. Reassign tricky items to another member (each item defaults to the website's assignee).
5. Set the website status: **Not started / In progress / Complete with query / Complete / On hold**.
6. **Rescan** after fixing. Checkboxes and assignees carry over for issues that still exist, and fixed ones drop off.
7. **Export CSV** for a report.

**Jumping to an element:** click a selector to copy it, or click **⌖ highlight snippet**. Then open the page's device preview (click the path), open DevTools (Cmd+Option+J / Ctrl+Shift+J) and paste. The element scrolls into view with a red outline. "Side panel" items are inside the hamburger menu, so open it first.

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
- No npm dependencies and no build step.

**Run locally:** copy `.env.example` to `.env.local`, fill it in, run `npm run dev` and open http://localhost:3000.

**Console-only version:** `console-audit.js` runs the same engine in DevTools on the site's preview page (`https://{editor-host}/preview/{siteId}`). It uses the site schema as the reference, prints a table and downloads a CSV. Useful for one-off checks without the app.

## Security notes
- Duda API credentials only live in Vercel environment variables and are never sent to the browser.
- Set `APP_PASSWORD` so the proxy endpoints aren't open to the internet.
- If your API password was ever shared in chat or a screenshot, rotate it in Duda and update the Vercel variable.
