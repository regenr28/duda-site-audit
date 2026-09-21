# Updating the live app (GitHub → Vercel)

Vercel redeploys automatically whenever you commit to `main` on GitHub. So updating = uploading the new files to GitHub.

## A. Settings (Vercel → your project → Settings → Environment Variables)
Add these **before** uploading, so the new deployment picks them up:

| Variable | Value | Needed? |
|---|---|---|
| `ADMIN_EMAILS` | `regencia.reymark28@gmail.com` | Yes |
| `SLACK_WEBHOOK_URL` | your Slack webhook (see README → "Slack alerts") | For Slack alerts |
| `RESEND_API_KEY` + `EMAIL_FROM` | see README → "Optional: email" | For emails (codes, approvals, suggestions) |
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
