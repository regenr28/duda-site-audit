// Shared helpers for the Vercel serverless functions (Node 18+, zero dependencies).

export const UA_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

/** Protect every endpoint with APP_PASSWORD (if set). Returns true when the request may continue. */
export function authorize(req, res) {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return true;
  const given = req.headers['x-app-password'] || '';
  if (given === pw) return true;
  res.status(401).json({ error: 'Wrong or missing app password' });
  return false;
}

export function allowedHost(host) {
  if (!host || !/^[a-z0-9.-]+$/i.test(host)) return false;
  const list = (process.env.ALLOWED_EDITOR_HOSTS || 'responsivesiteeditor.com,duda.co,dudamobile.com,multiscreensite.com,dudaone.com')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  host = host.toLowerCase();
  return list.some((h) => host === h || host.endsWith('.' + h));
}

/** Parse an editor link (or preview link, or bare site ID) into { host, siteId }. */
export function parseEditorLink(input) {
  input = String(input || '').trim();
  let host = process.env.DEFAULT_EDITOR_HOST || '';
  let siteId = '';
  try {
    const u = new URL(input);
    host = u.hostname;
    const m = u.pathname.match(/\/(?:site|preview|editor\/direct|editor)\/([A-Za-z0-9_-]{4,})/);
    siteId = m ? m[1] : '';
  } catch (e) {
    if (/^[A-Za-z0-9_-]{4,}$/.test(input)) siteId = input;
  }
  return { host, siteId };
}

export async function fetchWithTimeout(url, opts = {}, ms = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctl.signal }); } finally { clearTimeout(t); }
}

export function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; }
}
