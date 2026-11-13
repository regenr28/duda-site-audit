// SEO Websites: the websites a third-party SEO company works on (Duda label "SEO Customer").
//
// Their pages have come back with content that doesn't match the address, spelling mistakes and design
// slips, so every one of these websites is audited again after each publish: 4 hours after the last
// publish (so a burst of publishes is audited once, when they have finished), one website at a time.
//
// Scans run in a team member's browser (the audit engine needs a browser to read pages), so the
// server only keeps the list and says which website is due; an open tab of someone allowed to run
// the auto audit picks it up, claims it (one tab at a time) and scans it. Who created which pages
// comes from Duda's Activity Log (page_created by the SEO company's account).
//
// GET  /api/seo?op=list                     → { sites: [{ id, name, domain, published, audit, last, due, dueAt }], label, email, delayH }
// GET  /api/seo?op=due                      → { site } the website to audit next, or {}
// GET  /api/seo?op=pages&site=<duda id>     → { pages: [{ at, title, path, by }] } created by the SEO company (Activity Log)
// POST /api/seo { op: 'claim', site }        → { ok } one tab at a time, for 2 hours
// POST /api/seo { op: 'done', site, auditId, pub, error? } → records the run, adds the SEO company's pages to that scan's line
import { metered, redis, P, readBody, requireUser, jparse, unpackJSON, packJSON, now, fetchWithTimeout, can } from './_lib.js';

const LABEL = () => process.env.SEO_LABEL || 'SEO Customer';
const EMAIL = () => (process.env.SEO_EMAIL || 'seo@8bitcreative.com').toLowerCase();
const DELAY_H = () => Number(process.env.SEO_DELAY_HOURS || 4);
const RUNS = P + 'seoauto';          // hash: duda id → { at, pub, auditId, by, error }
const LOCK = (id) => P + 'seolock:' + id;
const PAGES = (id) => P + 'seopages:' + id;
const DUDA = () => process.env.DUDA_API_BASE || 'https://api.duda.co/api';

function flat(x) { const o = {}; if (Array.isArray(x)) { for (let i = 0; i < x.length; i += 2) o[x[i]] = x[i + 1]; } else Object.assign(o, x || {}); return o; }
const isSeo = (s) => (s.labels || []).some((l) => String(l).trim().toLowerCase() === LABEL().toLowerCase());

/** The SEO websites, with when each was last published, its audit, and whether an auto audit is due. */
async function seoSites() {
  const [ds, watch, idx, runs] = await redis(['GET', P + 'dudasites'], ['HGETALL', P + 'watch'], ['HGETALL', P + 'index'], ['HGETALL', RUNS]);
  const list = ((unpackJSON(ds) || {}).sites || []).filter(isSeo);
  const W = flat(watch); const R = flat(runs);
  const audits = new Map();
  Object.values(flat(idx)).forEach((v) => { const s = typeof v === 'string' ? jparse(v) : v; if (s && s.siteId) audits.set(String(s.siteId), s); });
  const delay = DELAY_H() * 3600000; const t = Date.now();
  return list.map((s) => {
    const w = jparse(W[s.id]) || {};
    // The webhook says the moment it happens; the list is refreshed every few hours. The later one wins.
    const pubs = [s.published, w.published].filter(Boolean).map((x) => Date.parse(x)).filter((x) => !isNaN(x));
    const pub = pubs.length ? Math.max(...pubs) : 0;
    const last = jparse(R[s.id]);
    const a = audits.get(String(s.id));
    const dueAt = pub ? pub + delay : 0;
    const due = !!pub && t >= dueAt && !(last && last.pub && Date.parse(last.pub) >= pub && !last.error);
    return { id: s.id, name: (a && a.businessName) || s.name || s.domain || s.id, domain: s.domain || s.defaultDomain || '', published: pub ? new Date(pub).toISOString() : '',
      audit: a ? { id: a.id, critical: (a.counts || {}).critical || 0, open: ((a.counts || {}).critical || 0) + ((a.counts || {}).warning || 0) + ((a.counts || {}).info || 0), scanned: (a.scan && a.scan.finishedAt) || '' } : null, last: last || null, due, dueAt: dueAt ? new Date(dueAt).toISOString() : '' };
  }).sort((x, y) => String(y.published).localeCompare(String(x.published)));
}

async function duda(path) {
  const user = process.env.DUDA_API_USERNAME, pass = process.env.DUDA_API_PASSWORD;
  if (!user || !pass) throw new Error('Duda API access is not set up yet.');
  const r = await fetchWithTimeout(DUDA() + path, { headers: { Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'), Accept: 'application/json' } }, 20000);
  const text = await r.text();
  if (!r.ok) throw new Error(`Duda said ${r.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch (e) { return null; }
}
/**
 * Pages the SEO company created on a website, from Duda's Activity Log. Duda does not document the
 * answer's fields, so each activity is read loosely: whatever names the person, the time and the page.
 */
async function seoPages(site, fresh) {
  const [cached] = await redis(['GET', PAGES(site)]);
  const c = jparse(cached);
  if (c && !fresh && Date.now() - c.at < 3600000) return c;
  const pick = (o, keys) => { for (const k of keys) { const v = k.split('.').reduce((x, y) => (x == null ? x : x[y]), o); if (v != null && v !== '') return v; } return ''; };
  const out = []; let fields = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const j = await duda(`/sites/multiscreen/${encodeURIComponent(site)}/activities?limit=100&offset=${offset}&activities=page_created`);
    const rows = Array.isArray(j) ? j : (j && (j.results || j.activities || j.data || j.items)) || [];
    if (!fields.length && rows[0]) fields = Object.keys(rows[0]).slice(0, 20);
    rows.forEach((a) => {
      const type = String(pick(a, ['activity', 'type', 'activity_type', 'event', 'name']) || '').toLowerCase();
      if (type && !/page.?created/.test(type)) return;
      const by = String(pick(a, ['user', 'user_email', 'email', 'performed_by', 'account_name', 'actor', 'user.email', 'source.user', 'details.user'])).toLowerCase();
      out.push({ at: String(pick(a, ['date', 'timestamp', 'created', 'created_at', 'time', 'activity_date'])), by,
        title: String(pick(a, ['page_title', 'details.page_title', 'page.title', 'data.page_title', 'title', 'page_name', 'details.page_name', 'data.page_name'])),
        path: String(pick(a, ['page_url', 'details.page_url', 'page.url', 'data.page_url', 'page_path', 'details.page_path', 'data.page_path', 'url'])),
        id: String(pick(a, ['page_uuid', 'page_id', 'details.page_uuid', 'details.page_id', 'data.page_uuid', 'page.uuid'])) });
    });
    if (rows.length < 100) break;
  }
  const mine = out.filter((x) => x.by.includes(EMAIL()));
  const r = { at: Date.now(), pages: mine, all: out.length, fields };
  await redis(['SET', PAGES(site), JSON.stringify(r), 'EX', 86400]);
  return r;
}

async function handler(req, res) {
  const me = await requireUser(req, res);
  if (!me) return;
  const runner = (await can(me, 'site.scan')) && (await can(me, 'live.view'));
  if (!(await can(me, 'live.view'))) return res.status(403).json({ error: 'Your role does not include DR Websites.' });
  try {
    if (req.method === 'GET') {
      const op = req.query.op || 'list';
      if (op === 'list') return res.status(200).json({ sites: await seoSites(), label: LABEL(), email: EMAIL(), delayH: DELAY_H() });
      if (op === 'due') {
        if (!runner) return res.status(200).json({});
        const all = await seoSites();
        const [locks] = await redis(['MGET', ...(all.length ? all.map((s) => LOCK(s.id)) : [LOCK('none')])]);
        // Oldest publish first; a website another tab is working on is skipped.
        const next = all.filter((s, i) => s.due && !(locks || [])[i]).sort((a, b) => String(a.published).localeCompare(String(b.published)))[0];
        return res.status(200).json(next ? { site: next } : {});
      }
      if (op === 'pages') {
        if (!/^[\w-]{4,64}$/.test(String(req.query.site || ''))) return res.status(400).json({ error: 'Unknown website' });
        try { return res.status(200).json(await seoPages(req.query.site, req.query.fresh === '1')); }
        catch (e) { return res.status(200).json({ pages: [], error: e.message }); }
      }
      return res.status(400).json({ error: 'Unknown operation' });
    }
    const b = readBody(req) || {};
    if (!runner) return res.status(403).json({ error: 'Your role does not allow running scans.' });
    const site = String(b.site || '');
    if (!/^[\w-]{4,64}$/.test(site)) return res.status(400).json({ error: 'Unknown website' });
    if (b.op === 'claim') {
      const [got] = await redis(['SET', LOCK(site), me.email, 'NX', 'EX', 7200]);
      return res.status(200).json({ ok: got === 'OK' });
    }
    if (b.op === 'done') {
      const run = { at: now(), pub: b.pub || '', auditId: String(b.auditId || ''), by: me.email, byName: me.name, error: String(b.error || '').slice(0, 300) };
      const cmds = [['HSET', RUNS, site, JSON.stringify(run)], ['DEL', LOCK(site)]];
      // The pages the SEO company created, attached to that scan's line in the audit's history.
      let pages = null;
      if (!run.error && run.auditId) {
        try { pages = await seoPages(site, true); } catch (e) { pages = { pages: [], error: e.message }; }
        const [raw] = await redis(['GET', P + 'site:' + run.auditId]);
        const a = unpackJSON(raw);
        if (a && Array.isArray(a.scans) && a.scans.length) {
          const last = a.scans[a.scans.length - 1];
          last.seo = { by: EMAIL(), pages: (pages.pages || []).slice(0, 80), error: pages.error || '', pub: run.pub };
          last.auto = true; last.seoAuto = true;
          cmds.push(['SET', P + 'site:' + run.auditId, packJSON(a)]);
        }
      }
      await redis(...cmds);
      return res.status(200).json({ ok: true, pages: pages ? (pages.pages || []).length : 0 });
    }
    if (b.op === 'release') { await redis(['DEL', LOCK(site)]); return res.status(200).json({ ok: true }); }
    return res.status(400).json({ error: 'Unknown operation' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
export default metered('seo', handler);
