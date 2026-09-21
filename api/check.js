// POST /api/check  { urls: [...] }  → [{ url, status, finalUrl, error }]
// Checks external links and images for 404 / server errors. Social networks are skipped (they block bots).
import { requireUser, fetchWithTimeout, readBody, UA_DESKTOP } from './_lib.js';

const SKIP = /(^|\.)(facebook\.com|instagram\.com|linkedin\.com|tiktok\.com|twitter\.com|x\.com|yelp\.com|google\.[a-z.]+|goo\.gl|g\.page|youtube\.com)$/i;

async function check(url) {
  let u;
  try { u = new URL(url); } catch (e) { return { url, status: 0, error: 'invalid URL' }; }
  if (!/^https?:$/.test(u.protocol)) return { url, status: -1 };
  if (SKIP.test(u.hostname)) return { url, status: -1, skipped: true };
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(u.hostname)) return { url, status: -1 };
  const headers = { 'User-Agent': UA_DESKTOP, Accept: '*/*' };
  try {
    let r = await fetchWithTimeout(url, { method: 'HEAD', redirect: 'follow', headers }, 9000);
    if ([403, 405, 501, 400].includes(r.status)) r = await fetchWithTimeout(url, { method: 'GET', redirect: 'follow', headers }, 9000);
    return { url, status: r.status, finalUrl: r.url };
  } catch (e) {
    return { url, status: 0, error: e.name === 'AbortError' ? 'timeout' : (e.cause && e.cause.code) || e.message };
  }
}

export default async function handler(req, res) {
  if (!(await requireUser(req, res))) return;
  const { urls } = readBody(req);
  if (!Array.isArray(urls)) return res.status(400).json({ error: 'urls[] required' });
  const list = urls.slice(0, 25);
  const out = await Promise.all(list.map(check));
  res.status(200).json(out);
}
