// "Live DR Sites": every PUBLISHED site in the Duda account, for picking what to audit.
// GET /api/dudasites            → cached list (refreshed automatically every 6 hours)
// GET /api/dudasites?refresh=1  → fetch again from Duda now
// Uses Duda's List Sites endpoint (200 per page), so 800 sites = 4 API calls. Stored compressed in one small key.
import { redis, P, requireUser, fetchWithTimeout, packJSON, unpackJSON } from './_lib.js';

const DUDA = process.env.DUDA_API_BASE || 'https://api.duda.co/api';
const KEY = P + 'dudasites';
const MAX_AGE = 6 * 3600 * 1000;

async function duda(path) {
  const user = process.env.DUDA_API_USERNAME, pass = process.env.DUDA_API_PASSWORD;
  if (!user || !pass) throw new Error('DUDA_API_USERNAME / DUDA_API_PASSWORD are not set in Vercel');
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

async function fetchAll() {
  const out = []; let offset = 0;
  for (let page = 0; page < 40; page++) { // up to 8,000 sites
    const j = await duda(`/sites/multiscreen?publish_status=PUBLISHED&limit=200&offset=${offset}&sort=LAST_PUBLISHED_DATE&direction=DESC`);
    const rows = Array.isArray(j) ? j : j.results || j.sites || j.data || [];
    rows.forEach((x) => { if (x && x.site_name && (!x.publish_status || x.publish_status === 'PUBLISHED')) out.push(slim(x)); });
    const total = Number(j.total_responses || j.total || j.totalCount || 0);
    offset += rows.length;
    if (rows.length < 200 || (total && offset >= total)) break;
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const me = await requireUser(req, res);
  if (!me) return;
  try {
    const [raw] = await redis(['GET', KEY]);
    const cached = unpackJSON(raw);
    if (cached && !req.query.refresh && Date.now() - cached.at < MAX_AGE) return res.status(200).json(cached);
    // Someone else refreshing right now? Serve the cached copy instead of hitting Duda twice
    const [lock] = await redis(['SET', KEY + ':lock', '1', 'NX', 'PX', 60000]);
    if (lock !== 'OK' && cached) return res.status(200).json(Object.assign({}, cached, { refreshing: true }));
    const sites = await fetchAll();
    // Remember when and by whom the list was pulled (manual refresh vs automatic 6-hour refresh)
    const data = { at: Date.now(), by: me.email, byName: me.name, manual: !!req.query.refresh, count: sites.length, sites };
    await redis(['SET', KEY, packJSON(data)], ['DEL', KEY + ':lock']);
    return res.status(200).json(data);
  } catch (e) {
    await redis(['DEL', KEY + ':lock']).catch(() => {});
    return res.status(502).json({ error: String(e.message || e) });
  }
}
