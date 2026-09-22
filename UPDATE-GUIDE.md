# Updating the live app (GitHub → Vercel)

Vercel redeploys automatically whenever you commit to `main` on GitHub. So updating = uploading the new files to GitHub.

## A. Settings (Vercel → your project → Settings → Environment Variables)
Add these **before** uploading, so the new deployment picks them up:

| Variable | Value | Needed? |
|---|---|---|
| `ADMIN_EMAILS` | `regencia.reymark28@gmail.com` | Yes |
| `SLACK_WEBHOOK_URL` | your Slack webhook (see README → "Slack alerts") | For Slack alerts |
| `RESEND_API_KEY` + `EMAIL_FROM` | see README → "Optional: email" | For emails (codes, approvals, suggestions) |
| `GEMINI_API_KEY` | aistudio.google.com → Get API key (free, no card) | For the free ✨ AI checks (alt text + page text) |
| `GROQ_API_KEY` | console.groq.com → API Keys (free, no card) | Backup model when Gemini hits its limit |
| `SLACK_BOT_TOKEN` | Slack app → OAuth & Permissions → Bot User OAuth Token (xoxb-…) | Slack DMs from "Site Auditor" (see README) |
| `ABLY_API_KEY` | ably.com → your app → API Keys → Root key (free, no card) | Instant "someone is on this website" pop-ups without using the database |
| `OPENROUTER_API_KEY` | openrouter.ai → Keys (free, no card) | Optional third backup |
| `AI_GATEWAY_API_KEY` | Vercel → AI Gateway → API Keys → Create key | Later, when you have budget. Takes priority over Gemini automatically |
| `GOOGLE_CLIENT_ID` | see README → "Sign in with Google" | For the Google button |

Delete `APP_PASSWORD` if it's still there. Login replaces it.

## B. Upload the new code
1. Unzip `duda-site-auditor.zip`.
2. Open your repository on github.com → **Add file → Upload files**.
3. Select **everything inside** the unzipped folder and drag it onto the page. GitHub replaces files with the same name and adds new ones such as `api/pulse.js` and `api/suggest.js`.
4. Click **Commit changes**.

## C. Check it
1. Vercel → **Deployments**: the newest row turns **Ready** within about a minute.
2. Open the app and hard-refresh (**Cmd+Shift+R** / **Ctrl+Shift+R**).
3. Sign in, or create your account with the `ADMIN_EMAILS` address.

## Adding a setting later
Add the variable, then go to **Deployments → ⋯ (on the top row) → Redeploy**.

## Troubleshooting
- **Still the old app?** Hard-refresh, and check the newest deployment is Ready and marked Production.
- **"Upstash Redis is not connected"**: Storage → your database → Connect to Project → Redeploy.
- **No emails**: check spam. Your Resend domain must be Verified and `EMAIL_FROM` must use it.
- **No Slack message**: check `SLACK_WEBHOOK_URL` is set and you redeployed. Test it by creating an account in a private window.
- **Rescan greyed out with "Queued by …" / "Being scanned by …"**: someone else's browser has that website. Only one scan per website runs at a time. The button frees up when their scan ends, or within 3 minutes (running scan) to 15 minutes (queued) if their tab closed without warning.
