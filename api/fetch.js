// GET /api/fetch?host=<editor host>&site=<siteId>&path=/about-us&device=desktop|tablet|mobile
// Proxies Duda's per-device preview HTML (the same thing the editor's Desktop/Tablet/Mobile preview shows).
import { requireUser, allowedHost, fetchWithTimeout, UA_DESKTOP } from './_lib.js';

const UAS = {
  desktop: UA_DESKTOP,
  tablet: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  mobile: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
};

export default async function handler(req, res) {
  if (!(await requireUser(req, res))) return;
  const { host, site, device = 'desktop' } = req.query;
  let path = String(req.query.path || '/');
  if (!allowedHost(host)) return res.status(400).json({ error: 'Host not allowed' });
  if (!/^[A-Za-z0-9_-]{4,}$/.test(site || '')) return res.status(400).json({ error: 'Bad site id' });
  if (!UAS[device]) return res.status(400).json({ error: 'Bad device' });
  if (path.includes('..') || !/^\/[\w\-/.%~]*$/.test(path)) return res.status(400).json({ error: 'Bad path' });
  path = path === '/' ? '' : path.replace(/\/+$/, '');
  const url = `https://${host}/site/${site}${path}?showOriginal=true&preview=true&insitepreview=true&dm_device=${device}`;
  try {
    const r = await fetchWithTimeout(url, { headers: { 'User-Agent': UAS[device], Accept: 'text/html' }, redirect: 'follow' }, 25000);
    const html = await r.text();
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ status: r.status, url, html });
  } catch (e) {
    res.status(200).json({ status: 0, url, html: '', error: e.name === 'AbortError' ? 'timeout' : String(e.message || e) });
  }
}
