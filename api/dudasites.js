// "Live DR Sites": every PUBLISHED site in the Duda account, for picking what to audit.
// GET /api/dudasites            → cached list (refreshed automatically every 6 hours)
// GET /api/dudasites?refresh=1  → fetch again from Duda now
// POST /api/dudasites { op: 'names', ids }    → fills in business names (the list endpoint doesn't include them)
// POST /api/dudasites { op: 'domains', ids }  → checks each site's live domain (working, redirecting elsewhere, 404, DNS…)
// Uses Duda's List Sites endpoint (100 per page), so 800 sites = 8 API calls. Stored compressed in one small key.
import { redis, P, requireUser, fetchWithTimeout, packJSON, unpackJSON, readBody, jparse, learnEditorHost } from './_lib.js';
import { enqueue } from './_queue.js';
import { markRun, lastRuns } from './leadq.js';
import { checkDomain, checkAndStore, sendDigest, problemClass, isProblem, DOMS, DOMEV } from './_domains.js';
import { evCmds, diffEvents, seedFromFeeds, readEvents, settleEvents } from './_pubhist.js';

const DUDA = process.env.DUDA_API_BASE || 'https://api.duda.co/api';
const KEY = P + 'dudasites';
const KEY_UN = P + 'dudadrafts';   // websites not published yet — the ones clients comment on
const MAX_AGE = 6 * 3600 * 1000;
const NAMES = P + 'dudanames';   // hash: site id → business name

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
  // When it first went live: the launch date the Trends tab counts. Empty for a website never published.
  first: x.first_published_date || '',
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
    const keep = (x) => (status === 'PUBLISHED' ? (!x.publish_status || x.publish_status === 'PUBLISHED') : x.publish_status !== 'PUBLISHED');
    rows.forEach((x) => { if (x && x.site_name && !seen.has(x.site_name) && keep(x)) { seen.add(x.site_name); out.push(slim(x)); added++; } });
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

export const _test = { checkDomain };

// Bumped when a website row gains a field the Trends tab needs, so an older cached list is pulled again.
const LIST_V = 2;

/**
 * One of the two lists (published, or not published), from the cache or freshly from Duda.
 * Refreshing the published list also compares it with the last pull and writes down any website that
 * appeared or disappeared — that is how the Trends tab still knows about a website deleted outright,
 * or a change while the Duda connection was off.
 */
async function loadList(scope, me, force) {
  const drafts = scope === 'unpublished';
  const key = drafts ? KEY_UN : KEY;
  const [raw] = await redis(['GET', key]);
  let data = unpackJSON(raw);
  if (data && !force && Date.now() - data.at < MAX_AGE && data.v === LIST_V) return data;
  // Someone else refreshing right now? Serve the cached copy instead of hitting Duda twice
  const [lock] = await redis(['SET', key + ':lock', '1', 'NX', 'PX', 60000]);
  if (lock !== 'OK' && data) return Object.assign({}, data, { refreshing: true });
  try {
    const sites = await fetchAll(drafts ? 'UNPUBLISHED' : 'PUBLISHED');
    // Remember when and by whom the list was pulled (manual refresh vs automatic 6-hour refresh)
    const next = { v: LIST_V, at: Date.now(), by: me.email, byName: me.name, manual: !!force, count: sites.length, sites, scope: drafts ? 'unpublished' : 'published' };
    const cmds = [['SET', key, packJSON(next)], ['DEL', key + ':lock']];
    if (!drafts && data && data.sites) cmds.push(...evCmds(diffEvents(data.sites, sites, data.at)));
    await redis(...cmds);
    await markRun('pull', me, !!force, { count: sites.length, scope: next.scope });
    // Every published website should have its form history. Anything already pulled or already
    // waiting is ignored, so this is just "keep the queue in step with the account".
    if (!drafts) await enqueue(sites.map((x) => x.id), 'listed').catch(() => {});
    return next;
  } catch (e) {
    await redis(['DEL', key + ':lock']).catch(() => {});
    throw e;
  }
}

/** The domain-check list: every published website, with the date it first went live. */
const checkRows = (list) => (list.sites || []).map((x) => ({ id: x.id, name: x.name, domain: x.domain, first: Date.parse(x.first) || 0 }));

/**
 * Once a day (Vercel's scheduler, see vercel.json), with nobody needing to have the app open: pull the
 * list, and check every live domain not checked in the last 20 hours, oldest first, until the time
 * runs out. Anybody can call this address; it does nothing more than once in 20 hours, so calling it
 * by hand changes nothing but the hour. With CRON_SECRET set, only Vercel's scheduler may call it.
 */
async function sweep(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && String(req.headers.authorization || '') !== 'Bearer ' + secret) return res.status(401).json({ error: 'Not allowed' });
  const [gate] = await redis(['SET', P + 'domsweep', new Date().toISOString(), 'NX', 'EX', 20 * 3600]);
  if (gate !== 'OK') return res.status(200).json({ skipped: 'already ran in the last 20 hours' });
  const bot = { email: '', name: 'Daily check' };
  const list = await loadList('published', bot, false);
  const [doms, names] = await redis(['HGETALL', DOMS], ['HGETALL', NAMES]);
  const last = {}; for (let i = 0; doms && i < doms.length; i += 2) { const v = jparse(doms[i + 1]); last[doms[i]] = (v && v.domain && v.checkedAt) || 0; }
  const nm = {}; for (let i = 0; names && i < names.length; i += 2) { const v = String(names[i + 1] || ''); const j = v.startsWith('{') ? jparse(v) : null; nm[names[i]] = (j ? j.n : v) || ''; }
  const due = checkRows(list).filter((x) => x.domain && Date.now() - (last[x.id] || 0) > 20 * 3600000)
    .map((x) => Object.assign(x, { name: x.name || (nm[x.id] !== '-' ? nm[x.id] : '') }))
    .sort((a, b) => (last[a.id] || 0) - (last[b.id] || 0));
  const out = await checkAndStore(due, { budgetMs: 95000, concurrency: 12 });
  await markRun('domains', bot, false, { count: Object.keys(out).length });
  const open = await sendDigest().catch(() => 0);
  return res.status(200).json({ checked: Object.keys(out).length, due: due.length, open });
}

/**
 * Everything the Trends tab draws, in one answer. The charts are drawn and re-cut (week, month,
 * year, any date range) in the browser, so changing the range never asks the server again.
 */
async function stats(me) {
  const [pub, un] = await Promise.all([loadList('published', me, false), loadList('unpublished', me, false).catch(() => null)]);
  await seedFromFeeds().catch(() => {});
  const [{ since, events }, [names, doms, domev]] = await Promise.all([readEvents(), redis(['HGETALL', NAMES], ['HGETALL', DOMS], ['LRANGE', DOMEV, 0, 3999])]);
  const nm = {}; for (let i = 0; names && i < names.length; i += 2) { const v = String(names[i + 1] || ''); const j = v.startsWith('{') ? jparse(v) : null; nm[names[i]] = (j ? j.n : v) || ''; }
  const dm = {}; for (let i = 0; doms && i < doms.length; i += 2) dm[doms[i]] = jparse(doms[i + 1]);
  const ms = (v) => Date.parse(v) || 0;
  const row = (x, live) => {
    const d = live ? dm[x.id] : null;
    const r = { id: x.id, n: x.name || (nm[x.id] && nm[x.id] !== '-' ? nm[x.id] : ''), dm: x.domain || '', c: ms(x.created), f: ms(x.first), l: ms(x.published), live: live ? 1 : 0 };
    if (d && (!x.domain || d.domain === x.domain || d.status === 'nodomain')) {
      r.ds = d.status; r.dl = d.label;
      if (isProblem(d)) { r.dc = problemClass(d.status); if (d.downSince) r.dsn = d.downSince; }
      if (d.ssl) r.sd = d.ssl.days - Math.floor((Date.now() - (d.checkedAt || Date.now())) / 86400000);
      if (d.reg && d.reg.expires) r.re = d.reg.expires;
      if (d.ms) r.ms = d.ms;
    }
    return r;
  };
  const sites = (pub.sites || []).map((x) => row(x, true));
  const unRows = ((un && un.sites) || []).filter((x) => x.first);   // was live once: the ones that left
  sites.push(...unRows.map((x) => row(x, false)));
  const firstPub = {}; sites.forEach((x) => { if (x.f) firstPub[x.id] = x.f; });
  const settled = settleEvents(events, firstPub).map((e) => [e.t, e.s, e.at, e.src === 's' ? 1 : 0]);
  return {
    at: Date.now(), listAt: pub.at, since, sites, events: settled,
    // Domain problems as they started and ended (from the daily check): ["D"|"U", site, at, class]
    domev: (domev || []).map((x) => jparse(x)).filter(Boolean),
    drafts: un ? Math.max(0, (un.count || 0) - unRows.length) : null,
    hasFirst: (pub.sites || []).some((x) => x.first),
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET' && req.query.op === 'sweep') {
    try { return await sweep(req, res); } catch (e) { return res.status(500).json({ error: String(e.message || e) }); }
  }
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
        const [names] = await redis(['HMGET', NAMES, ...(pick.length ? pick : ['-'])]);
        const rows = checkRows({ sites: pick.map((id) => known.get(id)) }).map((x, i) => {
          const v = String((names || [])[i] || ''); const j = v.startsWith('{') ? jparse(v) : null; const n = (j ? j.n : v) || '';
          return Object.assign(x, { name: x.name || (n !== '-' ? n : '') });
        });
        const out = await checkAndStore(rows);
        await markRun('domains', me, true, { count: pick.length });
        return res.status(200).json({ domains: out });
      }
      return res.status(400).json({ error: 'Unknown op' });
    } catch (e) { return res.status(500).json({ error: String(e.message || e) }); }
  }
  try {
    if (req.query.op === 'stats') return res.status(200).json(await stats(me));
    // Not-yet-published websites: the ones clients are commenting on before launch. Kept in its own
    // cache and only fetched when somebody asks, so it costs nothing on a normal day.
    const drafts = req.query.scope === 'unpublished';
    const data = Object.assign({}, await loadList(drafts ? 'unpublished' : 'published', me, !!req.query.refresh));
    // Merge remembered business names and domain checks
    // One extra command: whether the form-history catch-up has work, so opening this page (or a pull
    // that just queued 700 websites) starts it at once instead of waiting for the next heartbeat.
    const [names, doms, lqLen] = await redis(['HGETALL', NAMES], ['HGETALL', DOMS], ['HLEN', P + 'leadq']);
    data.lq = { pending: Number(lqLen || 0) };
    data.runs = await lastRuns(['pull', 'domains', 'leads']).catch(() => ({}));
    const nm = {}; for (let i = 0; names && i < names.length; i += 2) { const v = names[i + 1]; const j = String(v).startsWith('{') ? jparse(v) : null; nm[names[i]] = j || { n: v, p: null }; }
    const dm = {}; for (let i = 0; doms && i < doms.length; i += 2) dm[doms[i]] = jparse(doms[i + 1]);
    data.sites = data.sites.map((x) => { const m = nm[x.id]; const fresh = m && (m.p === null || m.p === (x.published || '')); return Object.assign({}, x, { name: x.name || (m && m.n !== '-' ? m.n : ''), nameChecked: !!(x.name || fresh), dom: dm[x.id] && (!x.domain || dm[x.id].domain === x.domain || dm[x.id].status === 'nodomain') ? dm[x.id] : null }); });
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) });
  }
}
