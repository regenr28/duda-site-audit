// POST /api/check  { urls: [...] }  → [{ url, status, finalUrl, error }]
// POST /api/check  { routes: { domain, paths } } → [{ path, chain:[{url,status}], final, finalStatus, loop?, error? }] — redirects on the published website
// POST /api/check  { places: [...] } → [{ url, finalUrl, id, name, address }] — Google Maps short links
//      (maps.app.goo.gl, goo.gl/maps, g.page, share.google) followed to where they open, and the place named.
// Checks external links and images for 404 / server errors. Social networks are skipped (they block bots).
import { metered, requireUser, readBody, UA_DESKTOP, fetchWithTimeout, redis, P, sha } from './_lib.js';
import { fetchPublic, publicAddress } from './_net.js';

const SKIP = /(^|\.)(facebook\.com|instagram\.com|linkedin\.com|tiktok\.com|twitter\.com|x\.com|yelp\.com|google\.[a-z.]+|goo\.gl|g\.page|youtube\.com)$/i;

async function check(url) {
  let u;
  try { u = new URL(url); } catch (e) { return { url, status: 0, error: 'invalid URL' }; }
  if (!/^https?:$/.test(u.protocol)) return { url, status: -1 };
  if (SKIP.test(u.hostname)) return { url, status: -1, skipped: true };
  const headers = { 'User-Agent': UA_DESKTOP, Accept: '*/*' };
  try {
    // Only public addresses, on every redirect too: a link on a page must not reach the server's own network.
    let r = await fetchPublic(url, { method: 'HEAD', headers }, 9000);
    if ([403, 405, 501, 400].includes(r.status)) r = await fetchPublic(url, { method: 'GET', headers }, 9000);
    return { url, status: r.status, finalUrl: r.url };
  } catch (e) {
    if (e.blocked) return { url, status: -1 };
    return { url, status: 0, error: e.name === 'AbortError' ? 'timeout' : (e.cause && e.cause.code) || e.message };
  }
}

// ---- Google Maps short links ----
const SHORT = /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|g\.page|share\.google|g\.co\/kgs)\b/i;
const GOOGLE = /(^|\.)google\.[a-z.]+$/i;
const unhtml = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\\u0026/g, '&');
function idOf(h) {
  const s = String(h || '').replace(/%3a/gi, ':');
  const m = s.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i) || s.match(/[?&](?:ftid|cid|place_id|query_place_id)=([^&]+)/i);
  return m ? decodeURIComponent(m[1]).toLowerCase() : '';
}
function nameOf(h) {
  const m = String(h || '').match(/\/maps\/place\/([^/@?]+)/i);
  if (!m || /^(data=|@)/i.test(m[1])) return '';
  try { return decodeURIComponent(m[1].replace(/\+/g, ' ')).trim(); } catch (e) { return ''; }
}
/** Follow the short link hop by hop (public addresses only) until it lands on Google Maps. */
async function expand(url) {
  let cur = url;
  for (let hop = 0; hop < 6; hop++) {
    let u; try { u = new URL(cur); } catch (e) { return ''; }
    if (GOOGLE.test(u.hostname) && u.hostname.startsWith('consent.') && u.searchParams.get('continue')) { cur = u.searchParams.get('continue'); continue; }
    if (GOOGLE.test(u.hostname) && (/^\/maps/.test(u.pathname) || u.searchParams.get('cid') || u.searchParams.get('ftid'))) return cur;
    if (!(await publicAddress(cur))) return '';
    const r = await fetchWithTimeout(cur, { method: 'GET', redirect: 'manual', headers: { 'User-Agent': UA_DESKTOP, Accept: 'text/html' } }, 9000);
    const loc = r.status >= 300 && r.status < 400 && r.headers.get('location');
    if (!loc) {
      // Some short links answer with a page that moves on by itself.
      const html = await r.text().catch(() => '');
      const m = html.match(/https:\/\/(?:www\.)?google\.[a-z.]+\/maps[^"'<>\s]+/i);
      return m ? unhtml(m[0]) : cur;
    }
    cur = new URL(loc, cur).href;
  }
  return cur;
}
/** The name (and address) Google shows for a place, read from its Maps page; {} when Google does not say. */
async function placeName(id) {
  const m = String(id).match(/^0x[0-9a-f]+:(0x[0-9a-f]+)$/i);
  const q = m ? 'cid=' + BigInt(m[1]).toString() : /^\d+$/.test(id) ? 'cid=' + id : '';
  if (!q) return {};
  try {
    const r = await fetchWithTimeout(`https://www.google.com/maps?${q}&hl=en&gl=us`, { headers: { 'User-Agent': UA_DESKTOP, Accept: 'text/html', 'Accept-Language': 'en-US,en', Cookie: 'CONSENT=YES+; SOCS=CAI' } }, 9000);
    if (!r.ok) return {};
    const html = (await r.text()).slice(0, 400000);
    const t = html.match(/<meta[^>]+(?:property="og:title"|itemprop="name")[^>]+content="([^"]+)"/i) || html.match(/<meta[^>]+content="([^"]+)"[^>]+(?:property="og:title"|itemprop="name")/i);
    const title = unhtml(t ? t[1] : '').trim();
    if (!title || /^google maps$/i.test(title)) return {};
    const [name, address] = title.split(/\s+·\s+/);
    return { name: (name || '').slice(0, 160), address: (address || '').slice(0, 200) };
  } catch (e) { return {}; }
}
async function place(url) {
  if (!SHORT.test(url)) return { url };
  const key = P + 'gplace:' + sha(url).slice(0, 24);
  const [hit] = await redis(['GET', key]).catch(() => [null]);
  if (hit) { try { return Object.assign({ url }, JSON.parse(hit)); } catch (e) { /* again */ } }
  let finalUrl = '';
  try { finalUrl = await expand(url); } catch (e) { return { url, error: 'could not be opened' }; }
  const id = idOf(finalUrl); let name = nameOf(finalUrl), address = '';
  if (!name && id) { const p = await placeName(id); name = p.name || ''; address = p.address || ''; }
  const out = { finalUrl: String(finalUrl || '').slice(0, 1500), id, name, address };
  if (finalUrl) await redis(['SET', key, JSON.stringify(out), 'EX', 30 * 86400]).catch(() => {});
  return Object.assign({ url }, out);
}

// ---- Where a page's public address really goes (redirects followed hop by hop) ----
async function liveRoute(domain, path) {
  const start = `https://${domain}${path === '/' ? '/' : path}`;
  const chain = []; const seen = new Set(); let cur = start;
  try {
    for (let hop = 0; hop < 8; hop++) {
      if (seen.has(cur)) return { path, chain, loop: true };
      seen.add(cur);
      if (!(await publicAddress(cur))) return { path, chain, error: 'address not allowed' };
      let r = await fetchWithTimeout(cur, { method: 'HEAD', redirect: 'manual', headers: { 'User-Agent': UA_DESKTOP } }, 8000);
      if ([403, 405, 501].includes(r.status)) r = await fetchWithTimeout(cur, { method: 'GET', redirect: 'manual', headers: { 'User-Agent': UA_DESKTOP, Accept: 'text/html' } }, 8000);
      const loc = r.status >= 300 && r.status < 400 && r.headers.get('location');
      chain.push({ url: cur, status: r.status });
      if (!loc) return { path, chain, final: cur, finalStatus: r.status };
      cur = new URL(loc, cur).href;
    }
    return { path, chain, loop: true };
  } catch (e) { return { path, chain, error: e.name === 'AbortError' ? 'timeout' : 'could not be opened' }; }
}

async function handler(req, res) {
  if (!(await requireUser(req, res))) return;
  const body = readBody(req) || {};
  // { routes: { domain, paths } }: where each page's public address goes (the published website's redirects).
  if (body.routes && typeof body.routes === 'object') {
    const domain = String(body.routes.domain || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return res.status(400).json({ error: 'domain required' });
    const paths = [].concat(body.routes.paths || []).map((p) => '/' + String(p || '').replace(/^\/+/, '')).slice(0, 25);
    return res.status(200).json(await Promise.all(paths.map((p) => liveRoute(domain, p))));
  }
  if (Array.isArray(body.places)) return res.status(200).json(await Promise.all(body.places.slice(0, 20).map((u) => place(String(u || '')))));
  const { urls } = body;

  if (!Array.isArray(urls)) return res.status(400).json({ error: 'urls[] required' });
  const list = urls.slice(0, 25);
  const out = await Promise.all(list.map(check));
  res.status(200).json(out);
}
export default metered('check', handler);
