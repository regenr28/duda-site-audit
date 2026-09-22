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
async function log(siteId, me, type, text, extra = {}) {
  const e = { id: newId(6), at: now(), by: me.email, byName: me.name, type, text, ...extra };
  await redis(['LPUSH', P + 'act:' + siteId, JSON.stringify(e)], ['LTRIM', P + 'act:' + siteId, 0, 299],
    // Same entry in the member's own list, so "what did this person work on" is one read instead of one per website
    ['LPUSH', P + 'uact:' + me.email, JSON.stringify(Object.assign({ siteKey: siteId, siteName: extra.siteName || '' }, e))], ['LTRIM', P + 'uact:' + me.email, 0, 299]);
}
const notify = (email, n) => notifyUser(email, n);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const me = await requireUser(req, res);
  if (!me) return;
  try {
    if (req.method === 'GET') {
      const op = req.query.op || 'list';
      if (op === 'list') {
        if (req.query.since) { const [v] = await redis(['GET', P + 'ver:index']); if (String(v || 0) === String(req.query.since)) return res.status(200).json({ unchanged: true, ver: String(v || 0) }); }
        const [idx, v] = await redis(['HGETALL', P + 'index'], ['GET', P + 'ver:index']);
        return res.status(200).json({ mode: 'kv', sites: Object.values(pairs(idx, true)), ver: String(v || 0) });
      }
      if (op === 'site') {
        if (req.query.since) { const [v] = await redis(['GET', P + 'ver:s:' + req.query.id]); if (String(v || 0) === String(req.query.since)) return res.status(200).json({ unchanged: true, ver: String(v || 0) }); }
        const l = await loadSite(req.query.id);
        if (!l) return res.status(404).json({ error: 'Not found' });
        const [act] = await redis(['LRANGE', P + 'act:' + req.query.id, 0, 299]);
        l.site.comments = l.comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        l.site.activity = (act || []).map((x) => jparse(x)).filter(Boolean);
        const [sv] = await redis(['GET', P + 'ver:s:' + req.query.id]);
        l.site.ver = String(sv || 0);
        return res.status(200).json(l.site);
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
        const [idx, g, own] = await redis(['HGETALL', P + 'index'], ['LRANGE', P + 'gact', 0, 999], ['LRANGE', P + 'uact:' + email, 0, 299]);
        const sites = Object.values(pairs(idx, true));
        const byId = new Map(sites.map((x) => [x.id, x]));
        const items = []; const seenIds = new Set();
        (own || []).forEach((raw) => { const e = jparse(raw); if (!e) return; seenIds.add(e.id); const x = byId.get(e.siteKey); items.push(Object.assign(e, { siteName: x ? x.businessName || x.siteId : e.siteName || '(deleted website)', siteStatus: x ? x.status : '' })); });
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
        items.forEach((e) => { if (e.siteKey && !e.global && !seenSites.has(e.siteKey) && recent.length < 5) { seenSites.add(e.siteKey); recent.push({ siteKey: e.siteKey, siteName: e.siteName, siteStatus: e.siteStatus, at: e.at, text: e.text, findingNum: e.findingNum || null, type: e.type }); } });
        const counts = { items: items.filter((e) => e.type === 'item-status').length, comments: items.filter((e) => /comment|reply/.test(e.type) && e.type !== 'comment-delete').length, scans: items.filter((e) => e.type === 'scan-start').length, sites: seenSites.size };
        const lastItem = items.find((e) => e.findingNum && !e.global && /^item-|comment|reply/.test(e.type) && e.type !== 'comment-delete') || null;
        return res.status(200).json({ items: items.slice(0, 150), recent, counts, lastItem });
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
        ['host', 'businessName', 'truth', 'profiles', 'pages', 'scan'].forEach((k) => { if (r[k] !== undefined) site[k] = r[k]; });
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
        if ('status' in ch && SITE_STATUSES.includes(ch.status) && ch.status !== site.status) { await log(b.id, me, 'status', `changed website status from "${site.status}" to "${ch.status}"`); site.status = ch.status; }
        if ('assignee' in ch && ch.assignee !== site.assignee) { await log(b.id, me, 'assign', `assigned the website to ${nameOf(ch.assignee)}`); site.assignee = ch.assignee; }
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
        for (const t of touched.slice(0, 20)) {
          if (t.kind === 'status') await log(b.siteId, me, 'item-status', `changed #${t.f.num} from "${FLABEL[t.from]}" to "${FLABEL[t.to]}"`, { findingId: t.f.id, findingNum: t.f.num });
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
        if (me.role !== 'admin' && site.addedBy !== me.email) return res.status(403).json({ error: 'Only an admin or the person who added it can delete this website' });
        const [cm] = await redis(['HVALS', P + 'cmt:' + b.id]);
        const imgKeys = [].concat(...(cm || []).map((x) => (jparse(x) || {}).images || [])).map((u) => P + 'img:' + String(u).split('id=')[1]);
        await redis(['DEL', P + 'site:' + b.id, P + 'fstate:' + b.id, P + 'fnum:' + b.id, P + 'seq:' + b.id, P + 'cmt:' + b.id, P + 'act:' + b.id, P + 'ailock:' + b.id, P + 'ver:s:' + b.id, ...imgKeys], ['HDEL', P + 'index', b.id], ['INCR', P + 'ver:index']);
        await globalLog(me, 'site-delete', `deleted the website ${site.businessName ? site.businessName + ' (' + site.siteId + ')' : site.siteId}`, { siteRef: site.siteId, addedByName: site.addedByName || '', findings: (site.findings || []).length });
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
