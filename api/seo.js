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
async function seoSites(delayH = DELAY_H()) {
  const [ds, watch, idx, runs] = await redis(['GET', P + 'dudasites'], ['HGETALL', P + 'watch'], ['HGETALL', P + 'index'], ['HGETALL', RUNS]);
  const list = ((unpackJSON(ds) || {}).sites || []).filter(isSeo);
  const W = flat(watch); const R = flat(runs);
  const audits = new Map();
  Object.values(flat(idx)).forEach((v) => { const s = typeof v === 'string' ? jparse(v) : v; if (s && s.siteId) audits.set(String(s.siteId), s); });
  const delay = delayH * 3600000; const t = Date.now();
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
  if (c && c.v === 2 && !fresh && Date.now() - c.at < 3600000) return c;
  // Every text in an activity, with where it sits ("data.page_title"), so the page's name, address
  // and id are found wherever Duda puts them (the answer's fields are not documented).
  const flatten = (o, pre = '', out = [], depth = 0) => {
    if (o == null || depth > 4) return out;
    if (typeof o !== 'object') { out.push([pre, String(o)]); return out; }
    for (const [k, v] of Object.entries(o)) flatten(v, pre ? pre + '.' + k : k, out, depth + 1);
    return out;
  };
  const NOT_PAGE = /user|account|actor|author|by|site_?name|site_?(url|domain)|email|source|activity|type|event/i;
  // A field about the person (user.name, account.email) or the site is never the page's.
  const PERSON = /^(user|users|account|actor|author|performed_?by|by|editor|site|source)$/i;
  const find = (pairs, keyRe, valRe) => { const hit = pairs.find(([k, v]) => { const seg = k.split('.'); const last = seg.pop(); return keyRe.test(last) && !NOT_PAGE.test(last) && !seg.some((x) => PERSON.test(x)) && v && (!valRe || valRe.test(v)); }); return hit ? hit[1] : ''; };
  const out = []; let sample = null;
  for (let offset = 0; offset < 1000; offset += 100) {
    const j = await duda(`/sites/multiscreen/${encodeURIComponent(site)}/activities?limit=100&offset=${offset}&activities=page_created`);
    const rows = Array.isArray(j) ? j : (j && (j.results || j.activities || j.data || j.items)) || [];
    rows.forEach((a) => {
      const pairs = flatten(a);
      if (!sample) sample = JSON.stringify(a).slice(0, 600);
      const type = (find(pairs, /^(activity|type|activity_type|event|name)$/) || (pairs.find(([k]) => /^(activity|type|event)$/i.test(k)) || [])[1] || '').toLowerCase();
      if (type && /page|site|backup|publish|domain/.test(type) && !/page.?created/.test(type)) return;
      const by = pairs.filter(([k, v]) => /user|email|account|actor|performed|author/i.test(k) && /@|\w/.test(v)).map(([, v]) => v).join(' ').toLowerCase();
      out.push({
        at: find(pairs, /^(date|timestamp|created|created_at|time|activity_date|.*_date)$/i),
        by,
        title: find(pairs, /(page_?)?(title|name|label)$/i, /^(?![a-z]+(_[a-z]+)+$)/),
        path: find(pairs, /(page_?)?(url|path|alias|link|slug)$/i, /^\/|^https?:|^[\w-]+(\/[\w-]+)*$/),
        id: find(pairs, /(page_?)?(uuid|id)$/i),
      });
    });
    if (rows.length < 100) break;
  }
  const mine = out.filter((x) => x.by.includes(EMAIL()));
  // Whatever the activity leaves out, the page itself says: its address and title from the pages list.
  if (mine.some((x) => !x.title || !x.path)) {
    try {
      const pj = await duda(`/sites/multiscreen/${encodeURIComponent(site)}/pages`);
      const list = (Array.isArray(pj) ? pj : (pj && (pj.results || pj.pages)) || []).map((p) => ({ uuid: String(p.uuid || p.page_uuid || p.id || ''), path: '/' + String(p.path || p.page_path || p.url || '').replace(/^\/+/, ''), title: p.title || p.page_title || (p.seo && p.seo.title) || '' }));
      const norm = (x) => String(x || '').replace(/^https?:\/\/[^/]+/i, '').replace(/^\/+|\/+$/g, '').toLowerCase();
      mine.forEach((x) => {
        const hit = list.find((p) => (x.id && p.uuid && p.uuid === x.id) || (x.path && norm(p.path) === norm(x.path)) || (x.title && p.title && p.title.toLowerCase() === x.title.toLowerCase()));
        if (hit) { x.path = x.path || hit.path; x.title = x.title || hit.title; }
        else if (!x.title && !x.path) x.deleted = true;
      });
    } catch (e) { /* names stay as the activity gave them */ }
  }
  mine.forEach((x) => { if (x.path && /^https?:/i.test(x.path)) x.path = x.path.replace(/^https?:\/\/[^/]+/i, '') || '/'; if (x.path && !x.path.startsWith('/')) x.path = '/' + x.path; });
  const r = { v: 2, at: Date.now(), pages: mine, all: out.length, sample };
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
      const { aaCfg, aaToday } = await import('./_autoaudits.js');
      const cfg = await aaCfg('seo');
      const delayH = cfg.fields.delayH === undefined ? DELAY_H() : cfg.fields.delayH;
      if (op === 'list') return res.status(200).json({ sites: await seoSites(delayH), label: LABEL(), email: EMAIL(), delayH, on: cfg.on });
      if (op === 'due') {
        if (!runner) return res.status(200).json({});
        // Settings → Auto audits: on, today, and its turn next to the websites still waiting to be read.
        if (!aaToday(cfg)) return res.status(200).json({ held: cfg.on ? 'not a day it runs' : 'switched off' });
        const [stat, since] = await redis(['GET', P + 'cwstat'], ['GET', P + 'aa:sinceSeo']);
        const pending = (jparse(stat) || {}).pending || 0;
        if (pending && cfg.fields.priority === 'after') return res.status(200).json({ held: `waiting until the ${pending} websites still to read are done` });
        if (pending && cfg.fields.priority === 'interleave' && (Number(since) || 0) < cfg.fields.everyN) return res.status(200).json({ held: `${Number(since) || 0} of ${cfg.fields.everyN} websites read since the last SEO website` });
        const all = await seoSites(delayH);
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
      // Its turn is used: the next one waits for another few websites to be read (Settings → Auto audits).
      if (got === 'OK') await redis(['SET', P + 'aa:sinceSeo', '0']);
      return res.status(200).json({ ok: got === 'OK' });
    }
    if (b.op === 'done') {
      const run = { at: now(), pub: b.pub || '', auditId: String(b.auditId || ''), by: me.email, byName: me.name, error: String(b.error || '').slice(0, 300) };
      const cmds = [['HSET', RUNS, site, JSON.stringify(run)], ['DEL', LOCK(site)]];
      // The pages the SEO company created, attached to that scan's line in the audit's history.
      let pages = null;
      const { aaCfg, aaOn } = await import('./_autoaudits.js');
      const wantPages = aaOn(await aaCfg('seo'), 'seo.pages');
      if (!run.error && run.auditId) {
        if (wantPages) { try { pages = await seoPages(site, true); } catch (e) { pages = { pages: [], error: e.message }; } } else pages = { pages: [] };
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
      // The Audits list marks it as auto audited (its filter and tag).
      if (run.auditId) { try { const { saveIndex } = await import('./store.js'); await saveIndex(run.auditId); } catch (e) { /* next list load */ } }
      return res.status(200).json({ ok: true, pages: pages ? (pages.pages || []).length : 0 });
    }
    if (b.op === 'release') { await redis(['DEL', LOCK(site)]); return res.status(200).json({ ok: true }); }
    return res.status(400).json({ error: 'Unknown operation' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
export default metered('seo', handler);
