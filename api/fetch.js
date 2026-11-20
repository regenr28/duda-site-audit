// GET /api/fetch?host=<editor host>&site=<siteId>&path=/about-us&device=desktop|tablet|mobile
// Proxies Duda's per-device preview HTML (the same thing the editor's Desktop/Tablet/Mobile preview shows).
import { metered, requireUser, allowedHost, fetchWithTimeout, UA_DESKTOP, redis, P } from './_lib.js';
import { fetchPublic } from './_net.js';

const UAS = {
  desktop: UA_DESKTOP,
  tablet: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  mobile: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
};

async function handler(req, res) {
  if (!(await requireUser(req, res))) return;
  // ?policy=<Termageddon policy address>: the text a policy script loads into a privacy / terms page. Only
  // Termageddon's own policy addresses are read, never anything else.
  if (req.query.policy) {
    let u; try { u = new URL(String(req.query.policy)); } catch (e) { return res.status(400).json({ error: 'Bad policy address' }); }
    if (u.protocol !== 'https:' || u.hostname !== 'app.termageddon.com' || !/^\/api\/policy\/[A-Za-z0-9=_-]{8,200}$/.test(u.pathname)) return res.status(400).json({ error: 'Not a policy address' });
    try {
      const r = await fetchPublic(u.href, { headers: { 'User-Agent': UAS.desktop, Accept: 'text/html,application/json' } }, 15000);
      const html = (await r.text()).slice(0, 600000);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ status: r.status, url: u.href, html });
    } catch (e) { return res.status(200).json({ status: 0, url: u.href, html: '', error: String(e.message || e).slice(0, 160) }); }
  }
  const { host, site, device = 'desktop' } = req.query;
  let path = String(req.query.path || '/');
  // live=1: the PUBLISHED page on the site's own domain (only the domain Duda reported for this site)
  const live = !!req.query.live;
  if (!live && !allowedHost(host)) return res.status(400).json({ error: 'Host not allowed' });
  if (!/^[A-Za-z0-9_-]{4,}$/.test(site || '')) return res.status(400).json({ error: 'Bad site id' });
  if (!UAS[device]) return res.status(400).json({ error: 'Bad device' });
  if (path.includes('..') || !/^\/[\w\-/.%~]*$/.test(path)) return res.status(400).json({ error: 'Bad path' });
  path = path === '/' ? '' : path.replace(/\/+$/, '');
  let url = `https://${host}/site/${site}${path}?showOriginal=true&preview=true&insitepreview=true&dm_device=${device}`;
  if (live) {
    const [dom] = await redis(['GET', P + 'livedom:' + site]);
    const want = String(req.query.domain || '').toLowerCase();
    if (!dom || dom !== want) return res.status(400).json({ error: 'Live domain not confirmed for this site' });
    url = `${process.env.LIVE_FETCH_PROTOCOL || 'https'}://${dom}${path || '/'}`;
  }
  try {
    const r = await fetchWithTimeout(url, { headers: { 'User-Agent': UAS[device], Accept: 'text/html' }, redirect: 'follow' }, 25000);
    const html = await r.text();
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ status: r.status, url, html });
  } catch (e) {
    res.status(200).json({ status: 0, url, html: '', error: e.name === 'AbortError' ? 'timeout' : String(e.message || e) });
  }
}
export default metered('fetch', handler);
