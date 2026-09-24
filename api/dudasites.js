// "Live DR Sites": every PUBLISHED site in the Duda account, for picking what to audit.
// GET /api/dudasites            → cached list (refreshed automatically every 6 hours)
// GET /api/dudasites?refresh=1  → fetch again from Duda now
// POST /api/dudasites { op: 'names', ids }    → fills in business names (the list endpoint doesn't include them)
// POST /api/dudasites { op: 'domains', ids }  → checks each site's live domain (working, redirecting elsewhere, 404, DNS…)
// Uses Duda's List Sites endpoint (100 per page), so 800 sites = 8 API calls. Stored compressed in one small key.
import { redis, P, requireUser, fetchWithTimeout, packJSON, unpackJSON, readBody, jparse, learnEditorHost } from './_lib.js';

const DUDA = process.env.DUDA_API_BASE || 'https://api.duda.co/api';
const KEY = P + 'dudasites';
const KEY_UN = P + 'dudadrafts';   // websites not published yet — the ones clients comment on
const MAX_AGE = 6 * 3600 * 1000;
const NAMES = P + 'dudanames';   // hash: site id → business name
const DOMS = P + 'domstat';      // hash: site id → domain check result

async function duda(path) {
  const user = process.env.DUDA_API_USERNAME, pass = process.env.DUDA_API_PASSWORD;
  if (!user || !pass) throw new Error('Duda API access is not set up yet. Please contact the app owner.');
  const r = await fetchWithTimeout(DUDA + path, { headers: { Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'), Accept: 'application/json' } }, 25000);
  const text = await r.text();
  if (!r.ok) throw new Error(`Duda API ${r.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}
const slim = (x) => ({
  id: x.site_name,
  name: (x.site_business_info && x.site_business_info.business_name) || x.site_alternate_name || '',
  domain: String(x.site_domain || '').replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
  defaultDomain: String(x.site_default_domain || '').replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
  published: x.last_published_date || '',
  created: x.creation_date || '',
  labels: (x.labels || []).map((l) => (typeof l === 'string' ? l : l && (l.name || l.label))).filter(Boolean).slice(0, 6),
});

async function fetchAll(status = 'PUBLISHED') {
  // Duda may return fewer rows per page than requested (e.g. 100 even when asking for 200), so keep paging
  // until a page comes back empty or adds nothing new, instead of assuming a short page means the end.
  const out = []; const seen = new Set(); let offset = 0;
  const PAGE = 100;
  for (let page = 0; page < 150; page++) { // up to 15,000 sites
    const j = await duda(`/sites/multiscreen?publish_status=${status}&limit=${PAGE}&offset=${offset}&sort=CREATION_DATE&direction=DESC`);
    const rows = Array.isArray(j) ? j : j.results || j.sites || j.data || [];
    let added = 0;
    rows.forEach((x) => { if (x && x.site_name && !seen.has(x.site_name) && (!x.publish_status || x.publish_status === status)) { seen.add(x.site_name); out.push(slim(x)); added++; } });
    const total = Number(j.total_responses || j.total || j.totalCount || j.total_count || 0);
    offset += rows.length;
    if (!rows.length || !added || (total && offset >= total)) break;
  }
  return out;
}

// ---------- business names ----------
async function businessName(id) {
  try {
    const site = await duda(`/sites/multiscreen/${encodeURIComponent(id)}`);
    // Learn the agency's editor address from Duda, so audits added by site ID get the right links
    await learnEditorHost(site.preview_site_url || site.site_default_domain_url || '');
    let name = (site.site_business_info && site.site_business_info.business_name) || '';
    if (!name) { const c = await duda(`/sites/multiscreen/${encodeURIComponent(id)}/content`).catch(() => null); name = (c && c.business_data && c.business_data.name) || (c && c.location_data && c.location_data.label) || ''; }
    return String(name || '').trim();
  } catch (e) { return null; }
}

// ---------- domain health ----------
const norm = (h) => String(h || '').toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
const DUDA_MARK = /cdn-website\.com|multiscreensite\.com|dmRoot|dmBody|dudaone|data-page-alias/i;
const BAD_CONTENT = /\b(casino|slots?|poker|betting|sportsbook|judi|togel|gambl\w*|viagra|cialis|escort|porn\w*|crypto ?casino)\b|domain (is )?for sale|buy this domain|this domain (name )?(is|may be) for sale|parked (free|domain)|hugedomains|sedo\.com|dan\.com|afternic/i;
function textOf(html) { return String(html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 4000); }
async function checkDomain(domain) {
  const out = { domain, checkedAt: Date.now() };
  const hops = [];
  let url = (process.env.DOMAIN_CHECK_PROTOCOL || 'https') + '://' + domain + '/';
  let r = null, body = '';
  for (let i = 0; i < 6; i++) {
    try {
      r = await fetchWithTimeout(url, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SiteAuditor/1.0; domain health check)', Accept: 'text/html' } }, 9000);
    } catch (e) {
      const m = String((e && e.cause && (e.cause.code || e.cause.message)) || e.message || e);
      if (i === 0 && url.startsWith('https://') && /CERT|SSL|TLS|certificate|self.signed|ERR_TLS|UNABLE_TO_VERIFY|EPROTO/i.test(m)) { out.sslError = true; url = 'http://' + domain + '/'; continue; }
      if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(m)) return Object.assign(out, { status: 'dns', label: "Domain doesn't resolve (DNS)", detail: 'The domain has no working DNS record. It may have expired or its DNS was changed.' });
      if (/abort|timeout|ETIMEDOUT/i.test(m)) return Object.assign(out, { status: 'timeout', label: 'Not responding', detail: 'The domain did not respond within 9 seconds.' });
      if (/ECONNREFUSED|ECONNRESET/i.test(m)) return Object.assign(out, { status: 'down', label: 'Connection refused', detail: m.slice(0, 120) });
      return Object.assign(out, { status: 'error', label: 'Could not open', detail: m.slice(0, 160) });
    }
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      const next = new URL(r.headers.get('location'), url).href; hops.push(next); url = next; continue;
    }
    body = r.status < 400 ? (await r.text().catch(() => '')).slice(0, 300000) : '';
    // Meta-refresh or tiny script redirects (common with hijacked domains)
    const meta = body.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["'][^"']*url=([^"'>\s]+)/i);
    const js = body.length < 8000 && body.match(/(?:window\.|document\.)?location(?:\.href)?\s*=\s*["'](https?:\/\/[^"']+)["']/i);
    const target = (meta && meta[1]) || (js && js[1]);
    if (target && i < 5) { try { const next = new URL(target, url).href; if (norm(new URL(next).host) !== norm(new URL(url).host)) { hops.push(next); url = next; continue; } } catch (e) { /* ignore */ } }
    break;
  }
  const finalUrl = url; let finalHost = ''; try { finalHost = new URL(finalUrl).host; } catch (e) { /* ignore */ }
  Object.assign(out, { code: r ? r.status : 0, finalUrl: finalUrl.slice(0, 300), hops: hops.length });
  const title = ((body.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '').trim().slice(0, 140);
  if (title) out.title = title;
  const spam = BAD_CONTENT.test(title + ' ' + textOf(body));
  if (norm(finalHost) !== norm(domain)) return Object.assign(out, { status: spam ? 'hijacked' : 'redirect', label: `Redirects to ${norm(finalHost) || 'another site'}${spam ? ' (spam / gambling site)' : ''}`, detail: `Opening ${domain} ends up on ${finalUrl}${title ? ` ("${title}")` : ''}. Fix the domain before auditing.` });
  if (r && r.status === 404) return Object.assign(out, { status: 'http', label: '404 Not found', detail: 'The home page returns 404.' });
  if (r && r.status >= 500) return Object.assign(out, { status: 'http', label: `Server error ${r.status}`, detail: 'The server behind the domain returns an error.' });
  if (r && r.status >= 400) return Object.assign(out, { status: 'http', label: `Error ${r.status}`, detail: `The home page returns HTTP ${r.status}.` });
  const text = textOf(body);
  if (BAD_CONTENT.test(title + ' ' + text) && !DUDA_MARK.test(body)) return Object.assign(out, { status: 'hijacked', label: 'Shows unrelated content', detail: `The domain loads a page that isn't this website${title ? ` ("${title}")` : ''} and looks like spam, gambling or a parked domain.` });
  if (!DUDA_MARK.test(body)) return Object.assign(out, { status: 'notduda', label: 'Not pointing to this website', detail: `The domain loads, but not the Duda website${title ? ` ("${title}")` : ''}. Its DNS may point to another host.` });
  if (out.sslError) return Object.assign(out, { status: 'ssl', label: 'SSL certificate problem', detail: 'The site only works over http://, the security certificate is missing or invalid.' });
  return Object.assign(out, { status: 'ok', label: 'Working', detail: hops.length ? `Loads after ${hops.length} redirect(s) on the same domain.` : 'Loads normally.' });
}

export const _test = { checkDomain };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const me = await requireUser(req, res);
  if (!me) return;
  if (req.method === 'POST') {
    try {
      const b = readBody(req);
      const [raw] = await redis(['GET', KEY]);
      const cached = unpackJSON(raw);
      const known = new Map(((cached && cached.sites) || []).map((x) => [x.id, x]));
      const ids = [].concat(b.ids || []).filter((id) => known.has(id));
      if (b.op === 'names') {
        const pick = ids.slice(0, 20); const found = {};
        for (let k = 0; k < pick.length; k += 5) {
          const part = pick.slice(k, k + 5);
          const names = await Promise.all(part.map(businessName));
          part.forEach((id, j) => { if (names[j] !== null) found[id] = names[j] || '-'; });
        }
        // Remember the name together with the site's last publish date: a republish triggers a fresh lookup
        const flat = [].concat(...Object.entries(found).map(([id, n]) => [id, JSON.stringify({ n, p: known.get(id).published || '' })]));
        if (flat.length) await redis(['HSET', NAMES, ...flat]);
        return res.status(200).json({ names: found });
      }
      if (b.op === 'domains') {
        // Only domains from our own Duda list are checked (never arbitrary URLs)
        const pick = ids.slice(0, 10);
        const results = await Promise.all(pick.map((id) => { const x = known.get(id); return x.domain ? checkDomain(x.domain) : Promise.resolve({ status: 'nodomain', label: 'No custom domain', detail: 'This site is only on its Duda address.', checkedAt: Date.now() }); }));
        const out = {}; pick.forEach((id, j) => { out[id] = results[j]; });
        const flat = [].concat(...Object.entries(out).map(([k, v]) => [k, JSON.stringify(v)]));
        if (flat.length) await redis(['HSET', DOMS, ...flat]);
        return res.status(200).json({ domains: out });
      }
      return res.status(400).json({ error: 'Unknown op' });
    } catch (e) { return res.status(500).json({ error: String(e.message || e) }); }
  }
  try {
    // Not-yet-published websites: the ones clients are commenting on before launch. Kept in its own
    // cache and only fetched when somebody asks, so it costs nothing on a normal day.
    const drafts = req.query.scope === 'unpublished';
    const key = drafts ? KEY_UN : KEY;
    const [raw] = await redis(['GET', key]);
    let data = unpackJSON(raw);
    if (!(data && !req.query.refresh && Date.now() - data.at < MAX_AGE)) {
      // Someone else refreshing right now? Serve the cached copy instead of hitting Duda twice
      const [lock] = await redis(['SET', key + ':lock', '1', 'NX', 'PX', 60000]);
      if (lock !== 'OK' && data) data = Object.assign({}, data, { refreshing: true });
      else {
        const sites = await fetchAll(drafts ? 'UNPUBLISHED' : 'PUBLISHED');
        // Remember when and by whom the list was pulled (manual refresh vs automatic 6-hour refresh)
        data = { at: Date.now(), by: me.email, byName: me.name, manual: !!req.query.refresh, count: sites.length, sites };
        data.scope = drafts ? 'unpublished' : 'published';
        await redis(['SET', key, packJSON(data)], ['DEL', key + ':lock']);
      }
    }
    // Merge remembered business names and domain checks
    const [names, doms] = await redis(['HGETALL', NAMES], ['HGETALL', DOMS]);
    const nm = {}; for (let i = 0; names && i < names.length; i += 2) { const v = names[i + 1]; const j = String(v).startsWith('{') ? jparse(v) : null; nm[names[i]] = j || { n: v, p: null }; }
    const dm = {}; for (let i = 0; doms && i < doms.length; i += 2) dm[doms[i]] = jparse(doms[i + 1]);
    data.sites = data.sites.map((x) => { const m = nm[x.id]; const fresh = m && (m.p === null || m.p === (x.published || '')); return Object.assign({}, x, { name: x.name || (m && m.n !== '-' ? m.n : ''), nameChecked: !!(x.name || fresh), dom: dm[x.id] && (!x.domain || dm[x.id].domain === x.domain || dm[x.id].status === 'nodomain') ? dm[x.id] : null }); });
    return res.status(200).json(data);
  } catch (e) {
    await redis(['DEL', KEY + ':lock'], ['DEL', KEY_UN + ':lock']).catch(() => {});
    return res.status(502).json({ error: String(e.message || e) });
  }
}
