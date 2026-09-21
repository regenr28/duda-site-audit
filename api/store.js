// Shared team storage backed by Upstash Redis (Vercel Marketplace → "Upstash for Redis", free tier).
// GET  /api/store?op=list                 → { mode, members, sites: [summaries] }
// GET  /api/store?op=site&id=…            → full site (with findings)
// POST /api/store { op: 'saveSite', site } | { op: 'deleteSite', id } | { op: 'saveMembers', members }
//                 { op: 'patchSite', id, changes } | { op: 'patchFinding', siteId, findingId, changes }
import { authorize, readBody } from './_lib.js';

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const P = process.env.STORE_PREFIX || 'dsa:';

async function redis(...cmds) {
  const r = await fetch(`${URL_}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error(`Redis ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const out = await r.json();
  return out.map((x) => { if (x.error) throw new Error(x.error); return x.result; });
}

function summary(s) {
  return {
    id: s.id, siteId: s.siteId, host: s.host, editorUrl: s.editorUrl, businessName: s.businessName || '',
    assignee: s.assignee || '', status: s.status || 'Not started', scan: s.scan || {}, createdAt: s.createdAt, updatedAt: s.updatedAt,
    counts: countOpen(s),
  };
}
function countOpen(s) {
  const c = { critical: 0, warning: 0, info: 0, done: 0, total: 0 };
  (s.findings || []).forEach((f) => { c.total++; if (f.done) c.done++; else c[f.severity] = (c[f.severity] || 0) + 1; });
  return c;
}

async function getSite(id) {
  const [raw] = await redis(['GET', P + 'site:' + id]);
  return raw ? JSON.parse(raw) : null;
}
async function putSite(site) {
  site.updatedAt = new Date().toISOString();
  await redis(['SET', P + 'site:' + site.id, JSON.stringify(site)], ['HSET', P + 'index', site.id, JSON.stringify(summary(site))]);
  return site;
}

export default async function handler(req, res) {
  if (!authorize(req, res)) return;
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_ || !TOKEN) return res.status(200).json({ mode: 'local', message: 'No Upstash Redis connected — the app will store data in this browser only.' });
  try {
    if (req.method === 'GET') {
      const op = req.query.op || 'list';
      if (op === 'list') {
        const [idx, members] = await redis(['HGETALL', P + 'index'], ['GET', P + 'members']);
        const sites = [];
        for (let i = 0; i < (idx || []).length; i += 2) sites.push(JSON.parse(idx[i + 1]));
        return res.status(200).json({ mode: 'kv', members: members ? JSON.parse(members) : [], sites });
      }
      if (op === 'site') {
        const s = await getSite(req.query.id);
        return s ? res.status(200).json(s) : res.status(404).json({ error: 'Not found' });
      }
      return res.status(400).json({ error: 'Unknown op' });
    }
    const body = readBody(req);
    switch (body.op) {
      case 'saveSite': {
        if (!body.site || !body.site.id) return res.status(400).json({ error: 'site.id required' });
        const s = await putSite(body.site);
        return res.status(200).json(summary(s));
      }
      case 'deleteSite':
        await redis(['DEL', P + 'site:' + body.id], ['HDEL', P + 'index', body.id]);
        return res.status(200).json({ ok: true });
      case 'saveMembers':
        await redis(['SET', P + 'members', JSON.stringify(body.members || [])]);
        return res.status(200).json({ ok: true });
      case 'patchSite': {
        const s = await getSite(body.id);
        if (!s) return res.status(404).json({ error: 'Not found' });
        const allowed = ['status', 'assignee', 'notes', 'businessName'];
        allowed.forEach((k) => { if (k in (body.changes || {})) s[k] = body.changes[k]; });
        await putSite(s);
        return res.status(200).json(summary(s));
      }
      case 'patchFinding': {
        const s = await getSite(body.siteId);
        if (!s) return res.status(404).json({ error: 'Not found' });
        const ids = [].concat(body.findingId);
        (s.findings || []).forEach((f) => {
          if (!ids.includes(f.id)) return;
          ['done', 'assignee', 'note'].forEach((k) => { if (k in (body.changes || {})) f[k] = body.changes[k]; });
          if ('done' in (body.changes || {})) { f.doneAt = body.changes.done ? new Date().toISOString() : null; f.doneBy = body.changes.done ? body.by || '' : ''; }
        });
        await putSite(s);
        return res.status(200).json(summary(s));
      }
      default:
        return res.status(400).json({ error: 'Unknown op' });
    }
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
