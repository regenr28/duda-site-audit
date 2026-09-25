// Comments left in the Duda editor — on every website in the account, audited or not.
//
// GET  /api/comments?op=sites              → every site we have heard from, with counts and what is new to you
// GET  /api/comments?op=threads&site=<id>  → the conversations on one site, newest first
// POST /api/comments { op: 'seen', site }              → mark that site read, for you
// POST /api/comments { op: 'who', email, as }          → say whether an author is the client or one of us
//
// Comments arrive through /api/hook and are stored against the Duda site ID, so a website does NOT
// have to be on the Audits list to be read here. Most client comments happen on drafts, before a
// site is ever published, which is exactly why this is kept separate from the Audits list.
//
// Replying and resolving still happen in the Duda editor — there is no API to write a comment.
// When somebody resolves one there, Duda tells us and it turns green here.
import { redis, P, requireUser, readBody, jparse, now, listUsers, notifyUser, fetchWithTimeout, unescapeHtml, savedEditorHost } from './_lib.js';

const DUDA = process.env.DUDA_API_BASE || 'https://api.duda.co/api';
const WAIT_HOURS = Number(process.env.COMMENT_WAIT_HOURS || 24);
const NAME_LOOKUPS = 8;   // Duda calls per request, so a first load never crawls

function pairs(arr, json) {
  const o = {};
  for (let i = 0; arr && i < arr.length; i += 2) o[arr[i]] = json ? jparse(arr[i + 1], {}) : arr[i + 1];
  return o;
}
async function duda(path) {
  const user = process.env.DUDA_API_USERNAME, pass = process.env.DUDA_API_PASSWORD;
  if (!user || !pass) throw new Error('Duda API access is not set up yet.');
  const r = await fetchWithTimeout(DUDA + path, { headers: { Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'), Accept: 'application/json' } }, 12000);
  const t = await r.text();
  if (!r.ok) throw new Error(`Duda API ${r.status}`);
  try { return JSON.parse(t); } catch (e) { return null; }
}

/** The shared business-name cache holds {"n": name, "p": last published} — not a bare name. */
function cachedName(v) {
  if (!v) return '';
  const j = String(v).startsWith('{') ? jparse(v) : null;
  const n = j ? j.n : v;
  return n && n !== '-' ? String(n) : '';
}
const nameEntry = (name, published) => JSON.stringify({ n: name || '-', p: published || '' });

const domainsOf = (v) => String(v || '').split(',').map((s) => s.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);

/**
 * Is this comment one of ours, or the client's? Duda tells us the author's email but not which side
 * they are on, so: anyone with an account here, or an address at one of the agency's domains, is us.
 * Anyone else is the client. An admin can correct any address, and the correction wins.
 */
export function sideTest(users, overrides) {
  const mine = new Set(users.map((u) => String(u.email || '').toLowerCase()));
  const doms = [...domainsOf(process.env.ALLOWED_EMAIL_DOMAINS), ...domainsOf(process.env.AGENCY_EMAIL_DOMAINS)];
  return (email) => {
    const e = String(email || '').toLowerCase().trim();
    if (!e) return 'team';
    if (overrides[e]) return overrides[e] === 'team' ? 'team' : 'client';
    if (mine.has(e)) return 'team';
    return doms.includes(e.split('@')[1] || '') ? 'team' : 'client';
  };
}

/** 24 hours from the comment, but never landing on a Saturday or Sunday when nobody is there. */
function answerDueAt(atISO, hours = WAIT_HOURS) {
  let t = Date.parse(atISO || '') || Date.now();
  t += hours * 3600000;
  for (let i = 0; i < 3; i++) {
    const day = new Date(t).getUTCDay();
    if (day === 0 || day === 6) t += 86400000; else break;
  }
  return t;
}

/**
 * The one notification this feature sends: a client asked something and nobody has answered.
 * It goes to admins, once per conversation, and never nags again.
 */
async function alertStale(rows, isClient, nameOf) {
  // Only when the CLIENT spoke last. A teammate's own note — a worklog, "this has been updated,
  // let us know" — is us holding the ball, not the client waiting, so it never rings.
  const late = Object.entries(rows).filter(([, r]) => r && !r.al && r.st !== 'resolved' && r.lb && isClient(r.lb) === 'client' && Date.now() > answerDueAt(r.la));
  if (!late.length) return 0;
  const admins = (await listUsers()).filter((u) => u.role === 'admin' && u.status === 'active');
  if (!admins.length) return 0;
  const host = await savedEditorHost().catch(() => '');
  const cmds = [];
  for (const [uuid, r] of late.slice(0, 20)) {
    const site = nameOf(r.s);
    const hours = Math.round((Date.now() - (Date.parse(r.la) || Date.now())) / 3600000);
    const where = [r.n ? `#${r.n}` : '', r.d ? String(r.d).toLowerCase() : ''].filter(Boolean).join(' · ');
    await Promise.all(admins.map((a) => notifyUser(a.email, {
      kind: 'comment-waiting', by: '', byName: site || r.s, siteId: '', siteName: '',
      text: `${where ? where + ' — ' : ''}waiting ${hours} hours with no reply from us: “${unescapeHtml(r.tx || '').slice(0, 140)}”`,
      dudaSite: r.s,
      editorUrl: host ? `https://${host}/home/site/${encodeURIComponent(r.s)}/home` : '',
    })));
    cmds.push(['HSET', P + 'convidx', uuid, JSON.stringify(Object.assign({}, r, { al: now() }))]);
  }
  if (cmds.length) await redis(...cmds);
  return late.length;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const me = await requireUser(req, res);
  if (!me) return;
  try {
    if (req.method === 'GET') {
      const op = req.query.op || 'sites';

      if (op === 'sites') {
        const [watch, idx, seen, over, names, ver] = await redis(
          ['HGETALL', P + 'watch'], ['HGETALL', P + 'convidx'], ['HGETALL', P + 'cmtseen:' + me.email],
          ['HGETALL', P + 'cmtwho'], ['HGETALL', P + 'dudanames'], ['GET', P + 'ver:cmt']);
        const sites = pairs(watch, true); const rows = pairs(idx, true);
        const mySeen = pairs(seen); const nameMap = pairs(names);
        const isClient = sideTest(await listUsers(), pairs(over));
        const nameOf = (id) => (sites[id] && sites[id].name) || cachedName(nameMap[id]);

        // Fill in a few missing business names from Duda, so the list reads as names not IDs.
        const unknown = Object.keys(sites).filter((id) => !nameOf(id)).slice(0, NAME_LOOKUPS);
        if (unknown.length) {
          const got = await Promise.allSettled(unknown.map((id) => duda(`/sites/multiscreen/${id}`)));
          const cmds = [];
          got.forEach((g, k) => {
            const id = unknown[k];
            const d = g.status === 'fulfilled' ? g.value : null;
            const nm = (d && ((d.site_business_info && d.site_business_info.business_name) || d.site_alternate_name)) || '';
            const w = Object.assign({}, sites[id], { name: nm, needName: false,
              published: (d && d.last_published_date) || (sites[id] || {}).published || '',
              domain: String((d && d.site_domain) || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '') });
            if (d === null && g.status !== 'fulfilled') w.gone = true;
            sites[id] = w;
            cmds.push(['HSET', P + 'watch', id, JSON.stringify(w)]);
            if (nm) cmds.push(['HSET', P + 'dudanames', id, nameEntry(nm, w.published)]);
          });
          if (cmds.length) await redis(...cmds);
        }

        await alertStale(rows, isClient, nameOf);

        const per = {};
        Object.values(rows).forEach((r) => {
          if (!r || !r.s) return;
          const p = per[r.s] || (per[r.s] = { total: 0, open: 0, unread: 0, waiting: 0, last: '' });
          p.total++;
          if (r.st !== 'resolved') p.open++;
          if (r.la > (mySeen[r.s] || '')) p.unread++;
          if (r.st !== 'resolved' && r.lb && isClient(r.lb) === 'client' && Date.now() > answerDueAt(r.la)) p.waiting++;
          if (r.la > p.last) p.last = r.la;
        });

        const out = Object.values(sites).map((w) => Object.assign({
          id: w.id, name: nameOf(w.id), published: w.published || '', domain: w.domain || '',
          firstSeen: w.firstSeen || '', lastEvent: w.lastEvent || '', gone: !!w.gone,
        }, per[w.id] || { total: 0, open: 0, unread: 0, waiting: 0, last: '' }));
        out.sort((a, b) => String(b.last || b.lastEvent).localeCompare(String(a.last || a.lastEvent)));
        return res.status(200).json({ sites: out, ver: String(ver || 0) });
      }

      if (op === 'threads') {
        const siteId = String(req.query.site || '').trim();
        if (!siteId) return res.status(400).json({ error: 'site required' });
        const [conv, pg, over, seen] = await redis(['HGETALL', P + 'conv:' + siteId], ['HGETALL', P + 'pages:' + siteId], ['HGETALL', P + 'cmtwho'], ['HGETALL', P + 'cmtseen:' + me.email]);
        const threads = Object.values(pairs(conv, true));
        let pages = pairs(pg);
        // Page IDs mean nothing to a person: swap them for real page paths, fetched once per site.
        if (threads.some((t) => t.page && !pages[t.page])) {
          try {
            const j = await duda(`/sites/multiscreen/${siteId}/pages`);
            const arr = Array.isArray(j) ? j : (j && (j.results || j.pages)) || [];
            const cmds = [];
            arr.forEach((p) => {
              const u = String(p.uuid || p.page_uuid || p.id || '');
              const path = '/' + String(p.path || p.page_path || '').replace(/^\/+/, '');
              if (u) { pages[u] = p.title || path; cmds.push(['HSET', P + 'pages:' + siteId, u, pages[u]]); }
            });
            if (cmds.length) await redis(...cmds);
          } catch (e) { /* names are a nicety, the comments still read fine */ }
        }
        const isClient = sideTest(await listUsers(), pairs(over));
        const since = pairs(seen)[siteId] || '';
        const out = threads.map((t) => ({
          uuid: t.u, num: t.num || 0, device: t.device || '', status: t.status || 'open', partial: !!t.partial,
          page: pages[t.page] || (t.page ? 'Page ' + String(t.page).slice(0, 6) : ''),
          startedAt: t.at, lastAt: t.last || t.updatedAt || t.at,
          unread: (t.last || t.at) > since,
          waiting: t.status !== 'resolved' && t.lastBy && isClient(t.lastBy) === 'client' && Date.now() > answerDueAt(t.last || t.at),
          comments: (t.comments || []).map((c) => ({ text: unescapeHtml(c.text), by: c.by, at: c.at, side: isClient(c.by), deleted: !!c.deleted, edited: c.edited || '' })),
        })).sort((a, b) => (b.waiting ? 1 : 0) - (a.waiting ? 1 : 0) || String(b.lastAt).localeCompare(String(a.lastAt)));
        return res.status(200).json({ site: siteId, threads: out, waitHours: WAIT_HOURS });
      }

      if (op === 'log') {
        // Owner-only: did anything actually arrive? Useful while Duda is being set up.
        if (me.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
        const [list] = await redis(['LRANGE', P + 'hooklog', 0, 49]);
        return res.status(200).json({ items: (list || []).map((x) => jparse(x)).filter(Boolean), listening: !!process.env.DUDA_HOOK_KEY, checked: !!process.env.DUDA_HOOK_SECRET });
      }
      return res.status(400).json({ error: 'Unknown op' });
    }

    const b = readBody(req);
    if (b.op === 'seen') {
      const siteId = String(b.site || '').trim();
      if (!siteId) return res.status(400).json({ error: 'site required' });
      await redis(['HSET', P + 'cmtseen:' + me.email, siteId, now()]);
      return res.status(200).json({ ok: true });
    }
    if (b.op === 'who') {
      if (me.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
      const email = String(b.email || '').toLowerCase().trim();
      const as = b.as === 'team' ? 'team' : b.as === 'client' ? 'client' : '';
      if (!email) return res.status(400).json({ error: 'email required' });
      if (as) await redis(['HSET', P + 'cmtwho', email, as]);
      else await redis(['HDEL', P + 'cmtwho', email]);
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'Unknown op' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
