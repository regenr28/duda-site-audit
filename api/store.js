// Team data (Upstash Redis).
// GET  /api/store?op=list | site&id= | notifs
// POST /api/store { op: create | scanState | saveScan | patchSite | patchFinding | comment | deleteComment | deleteSite | readNotifs, ... }
//
// Keys:  site:<id> (scan results + meta)   index (hash id → summary)   fstate:<id> (hash findingId → {status, assignee})
//        fnum:<id> (hash findingId → #)   seq:<id>   cmt:<id> (hash commentId → comment)   act:<id> (list)
//        notif:<email> (list)   notifseen:<email>
import { redis, P, readBody, requireUser, jparse, packJSON, unpackJSON, newId, now, listUsers, sendEmail, emailShell, esc, appUrl, globalLog, notifyUser } from './_lib.js';

const FSTATUS = ['open', 'clarification', 'done', 'hold', 'false'];
const FLABEL = { open: 'Open', clarification: 'For clarification', done: 'Done', hold: 'On hold', false: 'False alarm' };
const SITE_STATUSES = ['Not started', 'In progress', 'Complete with query', 'Complete', 'On hold'];

async function loadSite(id) {
  const [raw, fstate, fnum, cmts] = await redis(['GET', P + 'site:' + id], ['HGETALL', P + 'fstate:' + id], ['HGETALL', P + 'fnum:' + id], ['HGETALL', P + 'cmt:' + id]);
  const site = unpackJSON(raw);
  if (!site) return null;
  const st = pairs(fstate, true); const nums = pairs(fnum); const comments = Object.values(pairs(cmts, true));
  const cCount = {};
  comments.forEach((c) => { if (c.target && c.target !== 'site' && !c.deleted) cCount[c.target] = (cCount[c.target] || 0) + 1; });
  (site.findings || []).forEach((f) => {
    const s = st[f.id] || {};
    f.status = s.status || (f.done ? 'done' : 'open');
    f.assignee = s.assignee !== undefined ? s.assignee : (f.assignee || '');
    f.statusBy = s.updatedBy || ''; f.statusAt = s.updatedAt || '';
    f.num = nums[f.id] ? Number(nums[f.id]) : f.num || null;
    f.comments = cCount[f.id] || 0;
    delete f.done;
  });
  return { site, comments };
}
function pairs(arr, json) {
  const o = {};
  for (let i = 0; arr && i < arr.length; i += 2) o[arr[i]] = json ? jparse(arr[i + 1], {}) : arr[i + 1];
  return o;
}
function summary(site, comments) {
  const c = { critical: 0, warning: 0, info: 0, clarification: 0, hold: 0, closed: 0, total: 0, comments: 0, aiPending: 0, aiPendingBlocks: 0 };
  (site.findings || []).forEach((f) => {
    c.total++;
    if (/^AI_PENDING/.test(f.code) && f.status !== 'done' && f.status !== 'false') { c.aiPending++; c.aiPendingBlocks += ((f.aiPending && f.aiPending.items) || []).length; }
    if (f.status === 'done' || f.status === 'false') c.closed++;
    else if (f.status === 'hold') c.hold++;
    else { c[f.severity]++; if (f.status === 'clarification') c.clarification++; }
  });
  c.comments = (comments || []).filter((x) => !x.deleted).length;
  return {
    id: site.id, siteId: site.siteId, host: site.host, editorUrl: site.editorUrl, businessName: site.businessName || '',
    assignee: site.assignee || '', status: site.status || 'Not started', scan: slimScan(site.scan), addedBy: site.addedBy || '', addedByName: site.addedByName || '',
    createdAt: site.createdAt, updatedAt: site.updatedAt, counts: c,
    ...(site.completedAt ? { completedBy: site.completedBy, completedByName: site.completedByName, completedAt: site.completedAt } : {}),
    ...(site.verify ? { verify: { at: site.verify.at, ok: site.verify.ok, still: site.verify.still } } : {}),
  };
}
// The website list loads every summary at once, so keep each one small (no scan log, no AI details)
function slimScan(sc) {
  sc = sc || {};
  const o = {};
  ['state', 'startedAt', 'finishedAt', 'pages', 'error', 'by', 'startedBy', 'startedByName', 'durationMs'].forEach((k) => { if (sc[k] !== undefined && sc[k] !== '') o[k] = sc[k]; });
  if (sc.counts) o.counts = sc.counts;
  if (sc.ai && sc.ai.paused) o.ai = { paused: { retryAt: sc.ai.paused.retryAt } };
  if (o.error) o.error = String(o.error).slice(0, 200);
  return o;
}
async function saveIndex(id) {
  const l = await loadSite(id);
  // Version counters let open browsers ask "anything new?" with one tiny read instead of reloading everything
  if (l) await redis(['HSET', P + 'index', id, JSON.stringify(summary(l.site, l.comments))], ['INCR', P + 'ver:index'], ['INCR', P + 'ver:s:' + id]);
  return l ? summary(l.site, l.comments) : null;
}
// Scan claims: queued items hold for 15 min (refreshed every 5 min while the queue waits), a running scan for 3 min
// (refreshed every minute). If a tab closes or crashes, its claim simply runs out and anyone can rescan.
const QUEUE_TTL = 15 * 60000, SCAN_TTL = 3 * 60000;
function liveClaim(raw) { const c = typeof raw === 'string' ? jparse(raw) : raw; return c && c.until > Date.now() ? c : null; }
async function freshClaims(raw) {
  const all = pairs(raw, true), out = {}, old = [];
  Object.entries(all).forEach(([id, c]) => { if (liveClaim(c)) out[id] = c; else old.push(id); });
  if (old.length) { try { await redis(['HDEL', P + 'scanclaims', ...old]); } catch (e) { /* tidy-up only */ } }
  return out;
}
async function log(siteId, me, type, text, extra = {}) {
  const e = { id: newId(6), at: now(), by: me.email, byName: me.name, type, text, ...extra };
  await redis(['LPUSH', P + 'act:' + siteId, JSON.stringify(e)], ['LTRIM', P + 'act:' + siteId, 0, 299],
    // Same entry in the member's own list, so "what did this person work on" is one read instead of one per website
    ['LPUSH', P + 'uact:' + me.email, JSON.stringify(Object.assign({ siteKey: siteId, siteName: extra.siteName || '' }, e))], ['LTRIM', P + 'uact:' + me.email, 0, 299]);
}
const notify = (email, n) => notifyUser(email, n);
/** The record of removed audits is a keepsake, not a backup: keep the newest 400 and let the rest go. */
async function trimRemoved() {
  try {
    const [all] = await redis(['HGETALL', P + 'removed']);
    const rows = Object.entries(pairs(all, true));
    if (rows.length <= 400) return;
    const drop = rows.sort((a, c) => String(c[1].removedAt || '').localeCompare(String(a[1].removedAt || ''))).slice(400).map((x) => x[0]);
    if (drop.length) await redis(['HDEL', P + 'removed', ...drop]);
  } catch (e) { /* tidy-up only */ }
}
/** Small per-person counters, so admins can see who closed what (and spot odd patterns). */
async function bump(email, field, by = 1) {
  if (!email || !field) return;
  try { await redis(['HINCRBY', P + 'stat:' + email, field, by]); } catch (e) { /* counters are best-effort */ }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const me = await requireUser(req, res);
  if (!me) return;
  try {
    if (req.method === 'GET') {
      const op = req.query.op || 'list';
      if (op === 'list') {
        // Scan claims (who has a website queued or scanning) ride along with every poll; the list is tiny
        if (req.query.since) { const [v, cl] = await redis(['GET', P + 'ver:index'], ['HGETALL', P + 'scanclaims']); if (String(v || 0) === String(req.query.since)) return res.status(200).json({ unchanged: true, ver: String(v || 0), claims: await freshClaims(cl) }); }
        const [idx, v, cl] = await redis(['HGETALL', P + 'index'], ['GET', P + 'ver:index'], ['HGETALL', P + 'scanclaims']);
        return res.status(200).json({ mode: 'kv', sites: Object.values(pairs(idx, true)), ver: String(v || 0), claims: await freshClaims(cl) });
      }
      if (op === 'site') {
        if (req.query.since) { const [v, cr] = await redis(['GET', P + 'ver:s:' + req.query.id], ['HGET', P + 'scanclaims', req.query.id]); if (String(v || 0) === String(req.query.since)) return res.status(200).json({ unchanged: true, ver: String(v || 0), claim: liveClaim(cr) }); }
        const l = await loadSite(req.query.id);
        if (!l) return res.status(404).json({ error: 'Not found' });
        const [act] = await redis(['LRANGE', P + 'act:' + req.query.id, 0, 299]);
        l.site.comments = l.comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        l.site.activity = (act || []).map((x) => jparse(x)).filter(Boolean);
        const [sv] = await redis(['GET', P + 'ver:s:' + req.query.id]);
        l.site.ver = String(sv || 0);
        const [cr] = await redis(['HGET', P + 'scanclaims', req.query.id]);
        l.site.claim = liveClaim(cr);
        return res.status(200).json(l.site);
      }
      if (op === 'stats') {
        // Who closed what: counters per person (admins see everyone, members see their own)
        const all = await listUsers();
        const who = me.role === 'admin' ? all.filter((u) => u.status !== 'rejected') : all.filter((u) => u.email === me.email);
        const rows = await redis(...who.map((u) => ['HGETALL', P + 'stat:' + u.email]));
        const [idx] = await redis(['HGETALL', P + 'index']);
        const sites = Object.values(pairs(idx, true));
        return res.status(200).json({ rows: who.map((u, k) => {
          const c = pairs(rows[k]);
          const mine = sites.filter((s) => s.assignee === u.email);
          return { email: u.email, name: u.name, status: u.status,
            assigned: mine.length, complete: mine.filter((s) => s.status === 'Complete').length,
            sitesComplete: Number(c.sitesComplete) || 0, itemsDone: Number(c.itemsDone) || 0, itemsFalse: Number(c.itemsFalse) || 0,
            itemsHold: Number(c.itemsHold) || 0, itemsClarify: Number(c.itemsClarify) || 0, itemsReopen: Number(c.itemsReopen) || 0 };
        }) });
      }
      if (op === 'removed') {
        // Audits that were taken off the list: what it was, who removed it, when and why.
        const [all] = await redis(['HGETALL', P + 'removed']);
        let rows = Object.values(pairs(all, true));
        if (me.role !== 'admin') rows = rows.filter((x) => x.removedBy === me.email || x.addedBy === me.email || x.assignee === me.email);
        rows.sort((a, c) => String(c.removedAt || '').localeCompare(String(a.removedAt || '')));
        return res.status(200).json({ rows: rows.slice(0, 400) });
      }
      if (op === 'gactivity') {
        if (me.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
        const [list] = await redis(['LRANGE', P + 'gact', 0, 999]);
        return res.status(200).json({ items: (list || []).map((x) => jparse(x)).filter(Boolean) });
      }
      if (op === 'userActivity') {
        // Everything one member did (newest first), plus the websites they touched most recently
        const email = String(req.query.email || '').toLowerCase().trim();
        if (!email) return res.status(400).json({ error: 'email required' });
        const [idx, g, own, rem] = await redis(['HGETALL', P + 'index'], ['LRANGE', P + 'gact', 0, 999], ['LRANGE', P + 'uact:' + email, 0, 299], ['HGETALL', P + 'removed']);
        const sites = Object.values(pairs(idx, true));
        const byId = new Map(sites.map((x) => [x.id, x]));
        // A website that is no longer on the Audits list still has a name: take it from the removed record.
        const gone = new Map(Object.entries(pairs(rem, true)).map(([id, x]) => [id, x]));
        const items = []; const seenIds = new Set();
        (own || []).forEach((raw) => {
          const e = jparse(raw); if (!e) return; seenIds.add(e.id);
          const x = byId.get(e.siteKey); const r = x ? null : gone.get(e.siteKey);
          items.push(Object.assign(e, { siteName: x ? x.businessName || x.siteId : (r ? r.businessName || r.siteId : e.siteName || 'No longer on the Audits list'),
            siteStatus: x ? x.status : '', removedSite: x ? false : true, removedInfo: r || null }));
        });
        if ((own || []).length < 300) {
          // Older history (from before per-member lists existed): look through the 40 most recently updated websites only
          const recentSites = sites.sort((a, c) => String(c.updatedAt || '').localeCompare(String(a.updatedAt || ''))).slice(0, 40);
          const lists = recentSites.length ? await redis(...recentSites.map((x) => ['LRANGE', P + 'act:' + x.id, 0, 299])) : [];
          recentSites.forEach((x, k) => (lists[k] || []).forEach((raw) => {
            const e = jparse(raw); if (!e || e.by !== email || seenIds.has(e.id)) return;
            seenIds.add(e.id); items.push(Object.assign(e, { siteKey: x.id, siteName: x.businessName || x.siteId, siteStatus: x.status }));
          }));
        }
        (g || []).forEach((raw) => { const e = jparse(raw); if (e && e.by === email && e.type === 'site-delete') items.push(Object.assign(e, { global: true, siteKey: '', siteName: e.siteRef || e.name || '' })); });
        items.sort((a, c) => String(c.at).localeCompare(String(a.at)));
        const recent = []; const seenSites = new Set();
        items.forEach((e) => { if (e.siteKey && !e.global && !seenSites.has(e.siteKey) && recent.length < 5) { seenSites.add(e.siteKey); recent.push({ siteKey: e.siteKey, siteName: e.siteName, siteStatus: e.siteStatus, at: e.at, text: e.text, findingNum: e.findingNum || null, type: e.type, removedSite: !!e.removedSite, removedInfo: e.removedInfo || null }); } });
        const counts = { items: items.filter((e) => e.type === 'item-status').length, comments: items.filter((e) => /comment|reply/.test(e.type) && e.type !== 'comment-delete').length, scans: items.filter((e) => e.type === 'scan-start').length, sites: seenSites.size };
        const lastItem = items.find((e) => e.findingNum && !e.global && /^item-|comment|reply/.test(e.type) && e.type !== 'comment-delete') || null;
        return res.status(200).json({ items: items.slice(0, 150), recent, counts, lastItem });
      }
      if (op === 'falseAlarms') {
        if (me.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
        const [all] = await redis(['HGETALL', P + 'fa']);
        const items = Object.values(pairs(all, true)).sort((a, c) => String(c.markedAt || c.createdAt).localeCompare(String(a.markedAt || a.createdAt)));
        return res.status(200).json({ items });
      }
      if (op === 'notifs') {
        const [list, seen] = await redis(['LRANGE', P + 'notif:' + me.email, 0, 49], ['GET', P + 'notifseen:' + me.email]);
        const items = (list || []).map((x) => jparse(x)).filter(Boolean);
        return res.status(200).json({ items, unread: items.filter((n) => !seen || n.at > seen).length });
      }
      return res.status(400).json({ error: 'Unknown op' });
    }

    const b = readBody(req);
    switch (b.op) {
      case 'create': {
        if (!b.siteId || !/^[A-Za-z0-9_-]{4,}$/.test(b.siteId)) return res.status(400).json({ error: 'Bad site id' });
        const [idx] = await redis(['HGETALL', P + 'index']);
        const dup = Object.values(pairs(idx, true)).find((s) => s.siteId === b.siteId);
        if (dup) return res.status(409).json({ error: 'Already in the list', id: dup.id });
        const site = { id: newId(8), siteId: b.siteId, host: b.host, editorUrl: b.editorUrl, businessName: '', assignee: b.assignee || '', status: 'Not started', addedBy: me.email, addedByName: me.name, createdAt: now(), updatedAt: now(), findings: [], scan: { state: 'queued' } };
        await redis(['SET', P + 'site:' + site.id, packJSON(site)]);
        await log(site.id, me, 'site', 'added this website');
        await globalLog(me, 'site-add', `added the website ${b.siteId}`, { siteId: site.id, siteRef: b.siteId, editorUrl: b.editorUrl });
        return res.status(200).json(await saveIndex(site.id));
      }
      case 'scanState': {
        const [raw] = await redis(['GET', P + 'site:' + b.id]);
        const site = unpackJSON(raw); if (!site) return res.status(404).json({ error: 'Not found' });
        const wasScanned = !!(site.scan && site.scan.finishedAt);
        site.scan = Object.assign({}, site.scan, b.scan || {}); site.updatedAt = now();
        if (b.scan && b.scan.state === 'scanning') { site.scan.startedBy = me.email; site.scan.startedByName = me.name; }
        await redis(['SET', P + 'site:' + b.id, packJSON(site)]);
        if (b.scan && b.scan.state === 'scanning') await log(b.id, me, 'scan-start', wasScanned ? 'clicked Rescan (started a rescan)' : 'started the first scan');
        if (b.scan && b.scan.state === 'failed') await log(b.id, me, 'scan', 'scan failed: ' + String(b.scan.error || '').slice(0, 120));
        return res.status(200).json(await saveIndex(b.id));
      }
      case 'saveScan': {
        const [raw, fnum, seqRaw] = await redis(['GET', P + 'site:' + b.id], ['HGETALL', P + 'fnum:' + b.id], ['GET', P + 'seq:' + b.id]);
        const site = unpackJSON(raw); if (!site) return res.status(404).json({ error: 'Not found' });
        const r = b.result || {};
        ['host', 'editorUrl', 'businessName', 'truth', 'profiles', 'pages', 'scan'].forEach((k) => { if (r[k] !== undefined) site[k] = r[k]; });
        if (site.scan && Array.isArray(site.scan.log)) site.scan.log = site.scan.log.slice(0, 40).map((l) => String(l).slice(0, 300));
        site.findings = (r.findings || []).map((f) => { const c = Object.assign({}, f); ['status', 'assignee', 'num', 'comments', 'statusBy', 'statusAt', 'done'].forEach((k) => delete c[k]); return c; });
        // Stable ID numbers: the same issue keeps its # across rescans; new issues get the next number
        const nums = pairs(fnum); let seq = Number(seqRaw || 0); const add = [];
        site.findings.sort((a, c) => ({ critical: 0, warning: 1, info: 2 }[a.severity] - { critical: 0, warning: 1, info: 2 }[c.severity]));
        site.findings.forEach((f) => { if (!nums[f.id]) { seq++; nums[f.id] = seq; add.push(f.id, String(seq)); } });
        if (site.status === 'Not started') site.status = 'In progress';
        site.updatedAt = now();
        const cmds = [['SET', P + 'site:' + b.id, packJSON(site)], ['SET', P + 'seq:' + b.id, String(seq)]];
        if (add.length) cmds.push(['HSET', P + 'fnum:' + b.id, ...add]);
        await redis(...cmds);
        const c = (r.scan && r.scan.counts) || {};
        if (b.mode === 'aiResume') {
          const a = b.aiLog || {};
          await log(b.id, me, 'ai', `resumed the AI check: ${a.checked || 0} item(s) checked, ${a.flagged || 0} new finding(s)${a.stillPending ? `, ${a.stillPending} still waiting for AI credits` : ''}`);
          await redis(['DEL', P + 'ailock:' + b.id]);
          return res.status(200).json(await saveIndex(b.id));
        }
        await log(b.id, me, 'scan', `completed a scan: ${site.findings.length} findings (${c.critical || 0} critical)${add.length && Number(seqRaw || 0) ? `, ${add.length / 2} new` : ''}`);
        // Tell the person who added the website and whoever it's assigned to (bell, desktop and Slack) that it's ready
        const wasComplete = site.status === 'Complete' || !!site.completedAt;
        const tell = [...new Set([site.addedBy, site.assignee, wasComplete ? site.completedBy : null].filter((e) => e && e !== me.email))];
        const name = site.businessName || site.siteId;
        for (const email of tell) {
          await notify(email, { by: me.email, byName: me.name, siteId: b.id, siteName: name, kind: wasComplete ? 'rescan-done' : 'scan-done',
            text: `${wasComplete ? `This audit was completed${site.completedAt ? ' on ' + new Date(site.completedAt).toDateString() : ''} and has been scanned again. ` : ''}${site.findings.length} audit item${site.findings.length === 1 ? '' : 's'}, ${c.critical || 0} critical · ${(r.pages || []).length} page${(r.pages || []).length === 1 ? '' : 's'}` });
        }
        return res.status(200).json(await saveIndex(b.id));
      }
      case 'maintenance': {
        // Admin clean-up: compress old website records, slim the list, trim long logs, remove the old AI cache format
        if (me.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
        const out = { sitesCompressed: 0, bytesBefore: 0, bytesAfter: 0, logsTrimmed: 0, oldKeysRemoved: 0 };
        const [idx] = await redis(['HGETALL', P + 'index']);
        const ids = Object.keys(pairs(idx, true));
        for (let k = 0; k < ids.length; k += 25) {
          const chunk = ids.slice(k, k + 25);
          const raws = await redis(...chunk.map((id) => ['GET', P + 'site:' + id]));
          const cmds = [];
          chunk.forEach((id, j) => {
            const raw = raws[j]; if (!raw) return;
            out.bytesBefore += raw.length;
            if (!String(raw).startsWith('z1:')) {
              const site = unpackJSON(raw); if (!site) return;
              if (site.scan && Array.isArray(site.scan.log)) site.scan.log = site.scan.log.slice(0, 40);
              const packed = packJSON(site); out.bytesAfter += packed.length; out.sitesCompressed++;
              cmds.push(['SET', P + 'site:' + id, packed]);
            } else out.bytesAfter += raw.length;
            cmds.push(['LTRIM', P + 'act:' + id, 0, 299]);
          });
          if (cmds.length) await redis(...cmds);
          for (const id of chunk) await saveIndex(id); // rewrites the slim summary
        }
        // Old one-key-per-item AI cache (replaced by one hash per business) and old presence rooms
        for (const pattern of [P + 'ai:*', P + 'ai2:*', P + 'room:*']) {
          let cursor = '0', loops = 0;
          do {
            const [r] = await redis(['SCAN', cursor, 'MATCH', pattern, 'COUNT', 1000]);
            cursor = String((r && r[0]) || '0'); const keys = (r && r[1]) || [];
            if (keys.length) { await redis(['DEL', ...keys]); out.oldKeysRemoved += keys.length; }
          } while (cursor !== '0' && ++loops < 200);
        }
        try { const [n] = await redis(['DBSIZE']); out.totalKeys = n; } catch (e) { /* not available */ }
        await globalLog(me, 'maintenance', `optimized the database: ${out.sitesCompressed} website records compressed, ${out.oldKeysRemoved} old cache entries removed`);
        return res.status(200).json(out);
      }
      case 'faUpdate': case 'faComment': {
        if (me.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
        const [raw] = await redis(['HGET', P + 'fa', String(b.key || '')]);
        const rec = jparse(raw); if (!rec) return res.status(404).json({ error: 'Not found' });
        if (b.op === 'faUpdate') {
          if (!['new', 'ongoing', 'done', 'skip'].includes(b.status)) return res.status(400).json({ error: 'Bad status' });
          if (rec.status !== b.status) (rec.history = rec.history || []).push({ by: me.name, at: now(), from: rec.status, to: b.status });
          rec.status = b.status; rec.updatedAt = now(); rec.updatedBy = me.name;
        } else {
          const text = String(b.text || '').trim().slice(0, 3000);
          if (!text) return res.status(400).json({ error: 'Write something' });
          rec.comments = (rec.comments || []).concat([{ id: newId(6), by: me.email, byName: me.name, text, at: now() }]).slice(-60);
        }
        if (rec.history) rec.history = rec.history.slice(-30);
        await redis(['HSET', P + 'fa', rec.key, JSON.stringify(rec)]);
        return res.status(200).json(rec);
      }
      case 'faDelete': {
        if (me.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
        await redis(['HDEL', P + 'fa', String(b.key || '')]);
        return res.status(200).json({ ok: true });
      }
      case 'allowAdd': case 'allowRemove': {
        // "Correct for this website" exceptions: values (email, phone, social link, business name) that must not be flagged
        const [raw] = await redis(['GET', P + 'site:' + b.id]);
        const site = unpackJSON(raw); if (!site) return res.status(404).json({ error: 'Not found' });
        site.allow = site.allow || [];
        if (b.op === 'allowAdd') {
          const type = ['email', 'phone', 'social', 'name'].includes(b.type) ? b.type : '';
          const value = String(b.value || '').trim().slice(0, 300); const key = String(b.key || '').slice(0, 300);
          if (!type || !value || !key) return res.status(400).json({ error: 'Nothing to approve' });
          if (!site.allow.some((x) => x.key === key)) site.allow.push({ key, type, value, reason: String(b.reason || '').trim().slice(0, 500), by: me.email, byName: me.name, at: now(), item: Number(b.item) || null });
          site.allow = site.allow.slice(-200);
          await redis(['SET', P + 'site:' + b.id, packJSON(site)]);
          await log(b.id, me, 'allow', `approved ${value} as correct for this website${b.reason ? ': ' + String(b.reason).slice(0, 200) : ''}`);
        } else {
          const x = site.allow.find((y) => y.key === b.key);
          site.allow = site.allow.filter((y) => y.key !== b.key);
          await redis(['SET', P + 'site:' + b.id, packJSON(site)]);
          if (x) await log(b.id, me, 'allow', `removed the approval for ${x.value} (it will be checked again on the next scan)`);
        }
        return res.status(200).json(await saveIndex(b.id));
      }
      case 'saveVerify': {
        // Result of "Verify on live site": which closed items are really gone from the published site
        const [raw] = await redis(['GET', P + 'site:' + b.id]);
        const site = unpackJSON(raw); if (!site) return res.status(404).json({ error: 'Not found' });
        const v = b.verify || {};
        const results = {}; Object.entries(v.results || {}).slice(0, 2000).forEach(([k, x]) => { if (['ok', 'still', 'unknown', 'fixed-open'].includes(x)) results[String(k).slice(0, 40)] = x; });
        const count = (t) => Object.values(results).filter((x) => x === t).length;
        site.verify = { at: now(), by: me.email, byName: me.name, domain: String(v.domain || '').slice(0, 200), publishedAt: String(v.publishedAt || '').slice(0, 40), pages: Number(v.pages) || 0, results,
          ok: count('ok'), still: count('still'), unknown: count('unknown'), fixedOpen: count('fixed-open') };
        site.updatedAt = now();
        await redis(['SET', P + 'site:' + b.id, packJSON(site)]);
        await log(b.id, me, 'verify', `verified fixes on the live site: ${site.verify.ok} confirmed fixed${site.verify.still ? `, ${site.verify.still} still on the live site` : ''}${site.verify.unknown ? `, ${site.verify.unknown} couldn't be checked` : ''}`);
        return res.status(200).json(await saveIndex(b.id));
      }
      case 'scanClaim': {
        // One browser at a time may queue or scan a website. The lock key is atomic (SET NX); the "scanclaims" hash is
        // what other browsers read to show "Queued by …" / "Scanning by …" and to disable Rescan.
        const cid = String(b.cid || '').slice(0, 40);
        if (!cid) return res.status(400).json({ error: 'Missing tab id' });
        const st = b.state === 'scanning' ? 'scanning' : 'queued';
        const ttl = st === 'scanning' ? SCAN_TTL : QUEUE_TTL;
        const ids = [...new Set([].concat(b.ids || (b.id ? [b.id] : [])).map(String))].slice(0, 1000);
        if (!ids.length) return res.status(200).json({ ok: [], taken: [], claims: {} });
        const got = await redis(...ids.map((id) => ['SET', P + 'scanlock:' + id, cid, 'NX', 'PX', ttl]));
        const ok = ids.filter((id, i) => got[i] === 'OK'); const taken = [];
        const busy = ids.filter((id, i) => got[i] !== 'OK');
        if (busy.length) {
          const info = await redis(...busy.map((id) => ['GET', P + 'scanlock:' + id]), ...busy.map((id) => ['HGET', P + 'scanclaims', id]));
          const mine = [];
          busy.forEach((id, i) => {
            if (info[i] === cid) mine.push(id);
            else { const c = jparse(info[busy.length + i]) || {}; taken.push({ id, byName: c.byName || 'Another member', by: c.by || '', state: c.state || 'scanning' }); }
          });
          if (mine.length) { await redis(...mine.map((id) => ['SET', P + 'scanlock:' + id, cid, 'XX', 'PX', ttl])); ok.push(...mine); }
        }
        const claims = {};
        if (ok.length) {
          const until = Date.now() + ttl;
          ok.forEach((id) => { claims[id] = { by: me.email, byName: me.name, cid, state: st, at: now(), until }; });
          await redis(['HSET', P + 'scanclaims', ...ok.flatMap((id) => [id, JSON.stringify(claims[id])])]);
        }
        return res.status(200).json({ ok, taken, claims });
      }
      case 'scanRelease': {
        const cid = String(b.cid || '').slice(0, 40);
        const ids = [...new Set([].concat(b.ids || (b.id ? [b.id] : [])).map(String))].slice(0, 1000);
        if (!cid || !ids.length) return res.status(200).json({ ok: [] });
        const holders = await redis(...ids.map((id) => ['GET', P + 'scanlock:' + id]));
        const mine = ids.filter((id, i) => holders[i] === cid);
        if (mine.length) await redis(['DEL', ...mine.map((id) => P + 'scanlock:' + id)], ['HDEL', P + 'scanclaims', ...mine]);
        return res.status(200).json({ ok: mine });
      }
      case 'aiLock': {
        // Only one browser resumes a site's AI check at a time
        const [ok] = await redis(['SET', P + 'ailock:' + b.id, me.email, 'NX', 'PX', 10 * 60000]);
        return res.status(200).json({ ok: ok === 'OK' });
      }
      case 'aiUnlock': { await redis(['DEL', P + 'ailock:' + b.id]); return res.status(200).json({ ok: true }); }
      case 'patchSite': {
        const [raw] = await redis(['GET', P + 'site:' + b.id]);
        const site = unpackJSON(raw); if (!site) return res.status(404).json({ error: 'Not found' });
        const ch = b.changes || {};
        const users = await listUsers();
        const nameOf = (e) => (users.find((u) => u.email === e) || {}).name || 'Unassigned';
        const siteName = site.businessName || site.siteId;
        const reason = String(b.reason || '').trim().slice(0, 300);
        if ('status' in ch && SITE_STATUSES.includes(ch.status) && ch.status !== site.status) {
          const was = site.status;
          await log(b.id, me, 'status', `changed website status from "${was}" to "${ch.status}"${reason ? ` · ${reason}` : ''}`);
          if (ch.status === 'Complete') { site.completedBy = me.email; site.completedByName = me.name; site.completedAt = now(); await bump(me.email, 'sitesComplete'); }
          if (was === 'Complete' && ch.status !== 'Complete') {
            // Someone reopened a finished audit: tell whoever completed it (and the assignee)
            for (const email of [...new Set([site.completedBy, site.assignee].filter((e) => e && e !== me.email))]) {
              await notify(email, { by: me.email, byName: me.name, siteId: b.id, siteName, kind: 'site-reopen', text: `Status changed from Complete to "${ch.status}"${reason ? ` · ${reason}` : ''}` });
            }
          }
          site.status = ch.status;
        }
        if ('assignee' in ch && ch.assignee !== site.assignee) {
          const from = site.assignee, to = ch.assignee;
          const took = to === me.email && from && from !== me.email;
          await log(b.id, me, 'assign', to ? `${took ? 'took over this website from ' + nameOf(from) : 'assigned the website to ' + nameOf(to) + (from ? ' (was ' + nameOf(from) + ')' : '')}${reason ? ` · ${reason}` : ''}` : `removed the assignee (was ${nameOf(from)})`);
          if (from && from !== me.email) {
            await notify(from, { by: me.email, byName: me.name, siteId: b.id, siteName, kind: 'site-unassign',
              text: took ? `${me.name} took this website over from you${reason ? ` · ${reason}` : ''}` : `Reassigned to ${nameOf(to) || 'nobody'} by ${me.name}${reason ? ` · ${reason}` : ''}` });
          }
          if (to && to !== me.email) {
            await notify(to, { by: me.email, byName: me.name, siteId: b.id, siteName, kind: 'site-assign',
              text: `${me.name} assigned this website to you${from ? ` (was ${nameOf(from)})` : ''}${reason ? ` · ${reason}` : ''}` });
          }
          site.assignee = to;
        }
        site.updatedAt = now();
        await redis(['SET', P + 'site:' + b.id, packJSON(site)]);
        return res.status(200).json(await saveIndex(b.id));
      }
      case 'patchFinding': {
        const l = await loadSite(b.siteId); if (!l) return res.status(404).json({ error: 'Not found' });
        const ids = [].concat(b.findingIds || []);
        const ch = b.changes || {};
        const users = await listUsers();
        const nameOf = (e) => (users.find((u) => u.email === e) || {}).name || 'Unassigned';
        const cmds = []; const touched = [];
        l.site.findings.filter((f) => ids.includes(f.id)).forEach((f) => {
          const next = { status: f.status, assignee: f.assignee, updatedAt: now(), updatedBy: me.email };
          if ('status' in ch && FSTATUS.includes(ch.status) && ch.status !== f.status) { next.status = ch.status; touched.push({ f, kind: 'status', from: f.status, to: ch.status }); }
          if ('assignee' in ch && ch.assignee !== f.assignee) { next.assignee = ch.assignee; touched.push({ f, kind: 'assign', to: ch.assignee }); }
          cmds.push(['HSET', P + 'fstate:' + b.siteId, f.id, JSON.stringify(next)]);
        });
        if (cmds.length) await redis(...cmds);
        // False alarms feed the admins' review list, so the checks can be improved
        const faCmds = [];
        const faKeys = touched.filter((t) => t.kind === 'status' && (t.to === 'false' || t.from === 'false')).map((t) => b.siteId + ':' + t.f.id);
        const faOld = faKeys.length ? (await redis(['HMGET', P + 'fa', ...faKeys]))[0] || [] : [];
        const note = String(ch.note || '').trim().slice(0, 1000);
        touched.filter((t) => t.kind === 'status' && (t.to === 'false' || t.from === 'false')).forEach((t, k) => {
          const key = b.siteId + ':' + t.f.id;
          const old = jparse(faOld[k]);
          const f = t.f;
          const rec = old || { key, siteId: b.siteId, siteRef: l.site.siteId, findingId: f.id, status: 'new', comments: [], createdAt: now() };
          Object.assign(rec, {
            siteName: l.site.businessName || l.site.siteId, num: f.num, code: f.code, category: f.category, severity: f.severity, message: f.message,
            found: String(f.found || '').slice(0, 300), expected: String(f.expected || '').slice(0, 300), selector: f.selector, path: f.path, location: f.location,
            ai: f.ai ? { verdict: f.ai.verdict, reason: String(f.ai.reason || '').slice(0, 200) } : undefined,
          });
          if (t.to === 'false') { Object.assign(rec, { active: true, markedBy: me.email, markedByName: me.name, markedAt: now() }); if (note) rec.reason = note; if (old && old.status === 'done') rec.status = 'new'; }
          else { rec.active = false; rec.unmarkedBy = me.name; rec.unmarkedAt = now(); }
          faCmds.push(['HSET', P + 'fa', key, JSON.stringify(rec)]);
        });
        if (faCmds.length) await redis(...faCmds);
        const marked = touched.filter((t) => t.kind === 'status' && t.to === 'false');
        if (marked.length) {
          for (const a of users.filter((u) => u.role === 'admin' && u.status === 'active' && u.email !== me.email)) {
            await notify(a.email, { by: me.email, byName: me.name, siteId: b.siteId, siteName: l.site.businessName || l.site.siteId, findingNum: marked[0].f.num, kind: 'false-alarm', text: (note ? note + ' · ' : '') + marked[0].f.message });
          }
        }
        // Per-person counters (Done / False alarm / On hold / For clarification), for the team stats
        const FIELD = { done: 'itemsDone', false: 'itemsFalse', hold: 'itemsHold', clarification: 'itemsClarify', open: 'itemsReopen' };
        for (const t of touched.filter((x) => x.kind === 'status')) await bump(me.email, FIELD[t.to] || '');
        for (const t of touched.slice(0, 20)) {
          if (t.kind === 'status') await log(b.siteId, me, 'item-status', `changed #${t.f.num} from "${FLABEL[t.from]}" to "${FLABEL[t.to]}"${t.to === 'false' && note ? ` (reason: ${note.slice(0, 120)})` : ''}`, { findingId: t.f.id, findingNum: t.f.num });
          else {
            await log(b.siteId, me, 'item-assign', `assigned #${t.f.num} to ${nameOf(t.to)}`, { findingId: t.f.id, findingNum: t.f.num });
            if (t.to && t.to !== me.email) await notify(t.to, { by: me.email, byName: me.name, siteId: b.siteId, siteName: l.site.businessName || l.site.siteId, findingNum: t.f.num, kind: 'assign', text: t.f.message });
          }
        }
        return res.status(200).json(await saveIndex(b.siteId));
      }
      case 'comment': {
        const l = await loadSite(b.siteId); if (!l) return res.status(404).json({ error: 'Not found' });
        const text = String(b.text || '').slice(0, 5000);
        const images = [].concat(b.images || []).filter((u) => /^\/api\/img\?id=[\w-]+$/.test(u)).slice(0, 8);
        if (!text.trim() && !images.length) return res.status(400).json({ error: 'Write something or attach an image' });
        const target = b.target && b.target !== 'site' ? b.target : 'site';
        const finding = target !== 'site' ? l.site.findings.find((f) => f.id === target) : null;
        if (target !== 'site' && !finding) return res.status(404).json({ error: 'Audit item not found' });
        const users = (await listUsers()).filter((u) => u.status === 'active');
        const mentions = [].concat(b.mentions || []).filter((e) => users.some((u) => u.email === e));
        let replyTo = null;
        if (b.replyTo) {
          const parent = l.comments.find((c) => c.id === b.replyTo);
          if (parent) replyTo = { id: parent.id, by: parent.by, byName: parent.byName, excerpt: String(parent.text || (parent.images && parent.images.length ? '[image]' : '')).slice(0, 160) };
        }
        const c = { id: newId(8), siteId: b.siteId, target, findingNum: finding ? finding.num : null, by: me.email, byName: me.name, text, images, mentions, replyTo, createdAt: now() };
        await redis(['HSET', P + 'cmt:' + b.siteId, c.id, JSON.stringify(c)]);
        const where = finding ? ` on #${finding.num}` : '';
        await log(b.siteId, me, replyTo ? 'reply' : (finding ? 'item-comment' : 'comment'), replyTo ? `replied to ${replyTo.byName}${where}` : (finding ? `commented on #${finding.num}` : 'added a comment'), { commentId: c.id, findingId: finding ? finding.id : null, findingNum: finding ? finding.num : null });
        // Notifications: people mentioned + the person being replied to
        const siteName = l.site.businessName || l.site.siteId;
        const link = `${appUrl(req)}/#/site/${b.siteId}${finding ? '/item/' + finding.num : '/comments'}`;
        const recipients = new Map();
        mentions.forEach((e) => recipients.set(e, 'mention'));
        if (replyTo && replyTo.by !== me.email && !recipients.has(replyTo.by)) recipients.set(replyTo.by, 'reply');
        for (const [email, kind] of recipients) {
          if (email === me.email) continue;
          await notify(email, { by: me.email, byName: me.name, siteId: b.siteId, siteName, commentId: c.id, findingNum: finding ? finding.num : null, kind, text: text.slice(0, 200) });
          await sendEmail(email, `${me.name} ${kind === 'mention' ? 'mentioned you' : 'replied to you'} on ${siteName}${where}`,
            emailShell(`${esc(me.name)} ${kind === 'mention' ? 'mentioned you' : 'replied to you'}`, `<p style="color:#5d6572">${esc(siteName)}${esc(where)}</p>
              <blockquote style="border-left:3px solid #2563eb;margin:0;padding:8px 12px;background:#f1f3f6">${esc(text.slice(0, 600)).replace(/\n/g, '<br>')}</blockquote>
              <p><a href="${link}" style="display:inline-block;background:#2563eb;color:#fff;padding:9px 14px;border-radius:8px;text-decoration:none">Open in Duda Site Auditor</a></p>`)).catch(() => {});
        }
        await saveIndex(b.siteId);
        return res.status(200).json(c);
      }
      case 'deleteComment': {
        const [raw] = await redis(['HGET', P + 'cmt:' + b.siteId, b.commentId]);
        const c = jparse(raw); if (!c) return res.status(404).json({ error: 'Not found' });
        if (c.by !== me.email && me.role !== 'admin') return res.status(403).json({ error: 'You can only delete your own comments' });
        const imgKeys = (c.images || []).map((u) => P + 'img:' + String(u).split('id=')[1]).filter((k) => !k.endsWith('undefined'));
        if (imgKeys.length) await redis(['DEL', ...imgKeys]); // screenshots are the largest items in the database
        Object.assign(c, { deleted: true, text: '', images: [], deletedBy: me.email, deletedAt: now() });
        await redis(['HSET', P + 'cmt:' + b.siteId, c.id, JSON.stringify(c)]);
        await log(b.siteId, me, 'comment-delete', `deleted a comment${c.findingNum ? ' on #' + c.findingNum : ''}`, { findingNum: c.findingNum });
        await saveIndex(b.siteId);
        return res.status(200).json({ ok: true });
      }
      case 'deleteSite': {
        const [raw] = await redis(['GET', P + 'site:' + b.id]);
        const site = unpackJSON(raw); if (!site) return res.status(404).json({ error: 'Not found' });
        if (me.role !== 'admin' && site.addedBy !== me.email) return res.status(403).json({ error: 'Only an admin or the person who added it can remove this audit' });
        const reason = String(b.reason || '').trim().slice(0, 400);
        const whoList = await listUsers();
        const whoName = (e) => (whoList.find((u) => u.email === e) || {}).name || '';
        const [cm, fst] = await redis(['HVALS', P + 'cmt:' + b.id], ['HGETALL', P + 'fstate:' + b.id]);
        const stateOf = pairs(fst, true);
        const imgKeys = [].concat(...(cm || []).map((x) => (jparse(x) || {}).images || [])).map((u) => P + 'img:' + String(u).split('id=')[1]);
        // Keep a small record of what was removed, so months later anyone can see what it was and why.
        const f = site.findings || [];
        const cleared = (x) => { const st = (stateOf[x.id] || {}).status || x.status || 'open'; return st === 'done' || st === 'false'; };
        const card = { id: b.id, siteId: site.siteId, businessName: site.businessName || '', url: site.url || '', domain: site.domain || '',
          status: site.status || '', assignee: site.assignee || '', assigneeName: whoName(site.assignee), addedBy: site.addedBy || '', addedByName: site.addedByName || whoName(site.addedBy),
          completedBy: site.completedBy || '', completedByName: site.completedByName || '', completedAt: site.completedAt || '', addedAt: site.createdAt || site.addedAt || '',
          findings: f.length, cleared: f.filter(cleared).length, comments: (cm || []).length,
          removedBy: me.email, removedByName: me.name, removedAt: now(), reason };
        await redis(['DEL', P + 'site:' + b.id, P + 'fstate:' + b.id, P + 'fnum:' + b.id, P + 'seq:' + b.id, P + 'cmt:' + b.id, P + 'act:' + b.id, P + 'ailock:' + b.id, P + 'scanlock:' + b.id, P + 'ver:s:' + b.id, ...imgKeys],
          ['HDEL', P + 'index', b.id], ['HDEL', P + 'scanclaims', b.id], ['HSET', P + 'removed', b.id, JSON.stringify(card)], ['INCR', P + 'ver:index']);
        await trimRemoved();
        await globalLog(me, 'site-delete', `removed the audit for ${site.businessName ? site.businessName + ' (' + site.siteId + ')' : site.siteId} from the Audits list${reason ? ` · ${reason}` : ''}`,
          { siteRef: site.siteId, siteName: site.businessName || '', addedByName: site.addedByName || '', findings: f.length, reason });
        // Whoever had a stake in it should hear about it rather than find it gone.
        const tell = [...new Set([site.assignee, site.addedBy, site.completedBy].filter((e) => e && e !== me.email))];
        await Promise.all(tell.map((email) => notify(email, { kind: 'site-removed', by: me.email, byName: me.name, siteId: '', siteName: site.businessName || site.siteId,
          text: `${me.name} removed this audit from the Audits list${reason ? ` · ${reason}` : ''}. The website itself is untouched in Duda.` })));
        return res.status(200).json({ ok: true });
      }
      case 'readNotifs':
        await redis(['SET', P + 'notifseen:' + me.email, now()]);
        return res.status(200).json({ ok: true });
      default:
        return res.status(400).json({ error: 'Unknown op' });
    }
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
