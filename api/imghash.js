// Fingerprinting the pictures on a website, so the same photo used in four places is one audit item.
//
// The work is split because each side can only do half of it. The BROWSER has an image decoder and a
// canvas, so it is the only place that can turn a JPEG into pixels for free; but it can't read those
// pixels from another origin without the canvas going blank. THIS FILE is same-origin to the app, so
// it hands the bytes over (GET) and remembers the answer (POST), which is what stops the next scan —
// and every other website using the same stock photo — from downloading anything at all.
//
// GET  /api/imghash?url=…            → the image bytes, same-origin, shrunk where the CDN allows it
// POST /api/imghash { urls: [...] }  → { hashes: { url: {h, photo, …} | null } }
// POST /api/imghash { save: [...] }  → { saved: n }
//
// Editorial-use-only stock photos (Settings → Editorial stock photos, and the STOCK_EDITORIAL check):
// POST { stock: 'list' }                 → { items: [{ id, h, preview, title, src, by, at }] }
// POST { stock: 'add', ids }             → add Shutterstock IDs to the list (exempt.global)
// POST { stock: 'remove', id }           → take one off the list (exempt.global)
// POST { stock: 'hash', id, h }          → the picture's fingerprint, made in the browser from its preview
// POST { stock: 'lookup', ids }          → { results: { id: { editorial, title, preview } } }: asks
//      Shutterstock's own page for an ID found in a file name; an editorial one joins the list.
import { metered, redis, P, readBody, requireUser, jparse, sha, can, fetchWithTimeout, UA_DESKTOP } from './_lib.js';
import { STOCK_SEED, STOCK_SEED_HASH } from './_stockseed.js';
import { aiUsage } from './_meter.js';
import { _test as ai } from './ai.js';

// Only the places a Duda website actually serves pictures from. This must never become a proxy for
// anything anyone asks for.
const IMG_HOSTS = /(^|\.)(cdn-website\.com|multiscreensite\.com|dudaone\.com|responsivesiteeditor\.com|dudamobile\.com|mobilesitesonline\.com|dudasites\.com|duda\.co|dudacdn\.com)$/i;
const MAX_BYTES = 6 * 1024 * 1024;
const TTL = 90 * 86400;          // a picture's pixels don't change under the same address
const KEY = (u) => P + 'ih:' + sha(u).slice(0, 24);

// ---- Editorial-use-only stock photos ----
const STOCK_BASE = () => String(process.env.SHUTTERSTOCK_BASE || 'https://www.shutterstock.com').replace(/\/+$/, '');
const ED_KEY = P + 'stock:ed';            // hash: Shutterstock ID → { id, h, preview, title, src, by, at }
const ED_SEEDED = P + 'stock:seeded';     // the starting list goes in once; what is removed later stays removed
const ED_SEEDED2 = P + 'stock:seeded2';   // …and its thumbnails and fingerprints, once, on lists made before they existed
const LK_KEY = (id) => P + 'stock:lk:' + id;
const okId = (v) => /^\d{5,12}$/.test(String(v || '').trim());
const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december';
/** Editorial titles always start with a place and a date ("Vinnytsia, Ukraine - August 04, 2025: …"), and so does the page address. */
const DATED_SLUG = new RegExp(`(^|-)(${MONTHS})-\\d{1,2}-(19|20)\\d\\d-`, 'i');
/** Shutterstock's preview pictures: only image files on its own hosts (and the stand-in used by the tests). */
function stockImgHost(u) {
  let base = ''; try { base = new URL(STOCK_BASE()).host; } catch (e) { /* default */ }
  const hostOk = /(^|\.)shutterstock\.com$/i.test(u.hostname) || (base && u.host === base && !/shutterstock\.com$/i.test(base));
  return hostOk && /\.(jpe?g|png|webp)$/i.test(u.pathname);
}
async function stockList() {
  const [seeded] = await redis(['GET', ED_SEEDED]);
  if (!seeded && STOCK_SEED.length) {
    const at = new Date().toISOString();
    await redis(...STOCK_SEED.map((id) => ['HSETNX', ED_KEY, id, JSON.stringify({ id, src: 'list', by: 'Shutterstock downloads (Editorial Use Only)', at })]), ['SET', ED_SEEDED, at]);
  }
  // The thumbnails from the Downloads screenshots and their fingerprints: filled in once where missing.
  const [seeded2] = await redis(['GET', ED_SEEDED2]);
  if (!seeded2) {
    const ids = Object.keys(STOCK_SEED_HASH);
    const rows = ids.length ? await redis(...ids.map((id) => ['HGET', ED_KEY, id])) : [];
    const up = [];
    ids.forEach((id, i) => {
      const cur = jparse(rows[i]); if (!cur) return;   // taken off the list: stays off
      const next = Object.assign({}, cur);
      if (!next.thumb) next.thumb = `/stock/${id}.jpg`;
      if (!next.h) Object.assign(next, { h: STOCK_SEED_HASH[id], hFrom: 'screenshot', hBy: 'Shutterstock Downloads screenshots' });
      if (next.editorial === undefined || next.editorial === null) next.editorial = true;
      up.push(['HSET', ED_KEY, id, JSON.stringify(next)]);
    });
    await redis(...up, ['SET', ED_SEEDED2, new Date().toISOString()]);
  }
  const [all] = await redis(['HGETALL', ED_KEY]);
  const out = [];
  if (Array.isArray(all)) for (let i = 0; i + 1 < all.length; i += 2) { const v = jparse(all[i + 1]); if (v && v.id) out.push(v); }
  else if (all && typeof all === 'object') Object.values(all).forEach((x) => { const v = typeof x === 'string' ? jparse(x) : x; if (v && v.id) out.push(v); });
  return out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
}
/** "Denver, USA - March 3, 2025: blue truck Stock Photo | Shutterstock" → the image's own title. */
const cleanTitle = (t) => String(t || '').replace(/\s*[|\u2013\u2014]\s*Shutterstock.*$/i, '').replace(/\s+(Stock|Editorial Stock)\s+(Photo|Image|Vector|Illustration)s?\s*$/i, '').trim();
/** Everything that follows from an image's address on Shutterstock: its page, the downloaded file's name, its preview picture. */
function stockFacts(id, pageUrl, title) {
  let kind = 'image-photo', slug = '';
  try {
    const u = new URL(pageUrl, STOCK_BASE());
    const m = u.pathname.match(/\/(image-photo|image-vector|image-illustration|editorial\/image-editorial)\/(.+?)(?:-(\d{5,12}))?\/?$/);
    if (m && (!m[3] || m[3] === id)) { kind = m[1]; slug = m[2].replace(new RegExp('-?' + id + '$'), ''); }
  } catch (e) { /* no page address */ }
  const dated = DATED_SLUG.test(slug + '-') || new RegExp(`^[^:]{2,80}[-\u2013\u2014]\\s*(${MONTHS})\\s+\\d{1,2},\\s*(19|20)\\d\\d\\s*:`, 'i').test(title || '');
  return {
    url: slug ? `${STOCK_BASE()}/${kind}/${slug}-${id}` : `${STOCK_BASE()}/image-photo/${id}`,
    // Shutterstock serves the preview by ID alone (the words before -260nw- are not needed), even when
    // it refuses its pages to servers. It carries a 20px white Shutterstock strip at the bottom, which is
    // cut off before the picture is fingerprinted (stockMeasure in engine.js).
    preview: `${STOCK_BASE()}/${kind}/${slug}-260nw-${id}.jpg`,
    file: `shutterstock_${id}.jpg`, slug, dated,
  };
}
/** When Shutterstock's own page will not answer: an AI web search for the ID, trusting only the addresses it returns. */
async function stockLookupAI(id) {
  const list = await ai.applySavedModels(ai.providers()).catch(() => ai.providers());
  const p = list.find((x) => x.id === 'anthropic');
  if (!p) return null;
  const model = process.env.STOCK_AI_MODEL || p.model;
  try {
    const r = await fetchWithTimeout(`${p.base}/messages`, {
      method: 'POST', headers: { 'x-api-key': p.key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 400, system: 'Find the Shutterstock image with the given ID. Search for it and reply with its page address only.',
        messages: [{ role: 'user', content: `Shutterstock image ID ${id}` }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2, allowed_domains: ['shutterstock.com'] }] }),
    }, 60000);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return null;
    const u = j.usage || {};
    aiUsage('anthropic', j.model || model, (u.input_tokens || 0) + (u.cache_read_input_tokens || 0), u.output_tokens || 0, (u.server_tool_use && u.server_tool_use.web_search_requests) || 0);
    // Only a search result whose address ends in this ID counts: the AI's own words are never used.
    let hit = null;
    (j.content || []).forEach((b) => {
      if (b.type !== 'web_search_tool_result' || !Array.isArray(b.content)) return;
      b.content.forEach((x) => { if (!hit && x && x.url && new RegExp(`shutterstock\\.com/.*-${id}/?(\\?|$)`).test(x.url)) hit = x; });
    });
    if (!hit) return { id, editorial: null, via: 'ai', status: 0 };
    const title = cleanTitle(hit.title);
    const f = stockFacts(id, new URL(hit.url).pathname, title);
    return { id, editorial: f.dated ? true : null, title: title.slice(0, 200), url: f.url, preview: f.preview, file: f.file, via: 'ai', status: 200 };
  } catch (e) { return null; }
}
/** What Shutterstock's own page says about one ID. null fields = it could not tell (blocked, not found). */
async function stockLookup(id) {
  try {
    const r = await fetchWithTimeout(`${STOCK_BASE()}/image-photo/${id}`, { headers: { 'User-Agent': UA_DESKTOP, Accept: 'text/html', 'Accept-Language': 'en-US,en' }, redirect: 'follow' }, 9000);
    if (!r.ok) { const f = stockFacts(id, '', ''); return { id, editorial: null, preview: f.preview, url: f.url, file: f.file, via: 'id', status: r.status }; }
    const html = (await r.text()).slice(0, 600000);
    const slug = String((r.url || '').split('?')[0].split('/').pop() || '');
    const meta = (prop) => { const m = html.match(new RegExp(`<meta[^>]+(?:property|name)="${prop}"[^>]+content="([^"]+)"`, 'i')) || html.match(new RegExp(`<meta[^>]+content="([^"]+)"[^>]+(?:property|name)="${prop}"`, 'i')); return m ? m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'") : ''; };
    const flag = html.match(/"is_?editorial"\s*:\s*(true|false)/i);
    const title = cleanTitle(meta('og:title'));
    const dated = DATED_SLUG.test(slug) || new RegExp(`^[^:]{2,80}[-\u2013\u2014]\\s*(${MONTHS})\\s+\\d{1,2},\\s*(19|20)\\d\\d\\s*:`, 'i').test(title);
    const editorial = flag ? flag[1].toLowerCase() === 'true' : dated;
    const f = stockFacts(id, r.url || '', title);
    let preview = meta('og:image');
    try { const pu = new URL(preview, STOCK_BASE()); preview = stockImgHost(pu) ? pu.href : ''; } catch (e) { preview = ''; }
    return { id, editorial, title: title.slice(0, 200), preview: (preview || f.preview).slice(0, 600), url: f.url, file: f.file, via: 'page', status: r.status };
  } catch (e) { const f = stockFacts(id, '', ''); return { id, editorial: null, preview: f.preview, url: f.url, file: f.file, via: 'id', status: 0 }; }
}

/**
 * The same picture served at a dozen sizes is one picture. Duda appends the width to the file name
 * and repeats it in the query, so both are dropped before anything is compared or cached.
 */
export function imgKey(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch (e) { return String(raw || '').toLowerCase().trim(); }
  u.hash = '';
  u.search = '';
  const path = u.pathname
    .replace(/-\d{2,5}w(?=\.[a-z0-9]+$)/i, '')          // hero-1920w.jpg  → hero.jpg
    .replace(/_\d{2,5}x\d{2,5}(?=\.[a-z0-9]+$)/i, '')   // hero_800x600.jpg → hero.jpg
    .replace(/\/(?:opt|resize|fit|crop)\/(?=[^/]+$)/i, '/');
  return (u.origin + path).toLowerCase();
}

/** A smaller copy, when the CDN knows how to make one: fingerprinting needs 64px, not 4000. */
function smallUrl(raw) {
  try {
    const u = new URL(raw);
    if (/cdn-website\.com|multiscreensite\.com|dudaone\.com/i.test(u.hostname)) {
      u.searchParams.set('width', '96');
      u.searchParams.delete('height');
    }
    return u.href;
  } catch (e) { return raw; }
}

async function handler(req, res) {
  const me = await requireUser(req, res);
  if (!me) return;
  try {
    if (req.method === 'GET') {
      const raw = String(req.query.url || '');
      let u;
      try { u = new URL(raw); } catch (e) { return res.status(400).json({ error: 'Bad url' }); }
      const stockPic = stockImgHost(u);
      if ((u.protocol !== 'https:' && !stockPic) || !(IMG_HOSTS.test(u.hostname) || stockPic)) return res.status(400).json({ error: 'Host not allowed' });
      const r = await fetch(stockPic ? raw : smallUrl(raw), { headers: Object.assign({ Accept: 'image/*' }, stockPic ? { 'User-Agent': UA_DESKTOP } : {}), redirect: 'follow' });
      if (!r.ok) return res.status(502).json({ error: 'Upstream ' + r.status });
      const type = r.headers.get('content-type') || '';
      if (!/^image\//i.test(type)) return res.status(415).json({ error: 'Not an image' });
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > MAX_BYTES) return res.status(413).json({ error: 'Too large' });
      res.setHeader('Content-Type', type);
      res.setHeader('Cache-Control', 'private, max-age=86400');
      return res.status(200).end(buf);
    }

    const b = readBody(req);
    if (b.stock) {
      const op = String(b.stock);
      if (op === 'list') return res.status(200).json({ items: await stockList(), canEdit: await can(me, 'exempt.global') });
      if (op === 'add' || op === 'remove') {
        if (!(await can(me, 'exempt.global'))) return res.status(403).json({ error: 'Only people who manage exception sets can change this list.' });
        await stockList(); // the starting list first, so it is not added again over a change
        if (op === 'remove') { if (!okId(b.id)) return res.status(400).json({ error: 'Not a Shutterstock ID' }); await redis(['HDEL', ED_KEY, String(b.id).trim()]); return res.status(200).json({ ok: true }); }
        const ids = [...new Set([].concat(b.ids || []).map((x) => String(x).trim()).filter(okId))].slice(0, 500);
        const at = new Date().toISOString();
        const facts = b.facts && typeof b.facts === 'object' ? b.facts : {};
        const clean = (v) => { const x = facts[v] || {}; const f = stockFacts(v, x.url || '', x.title || '');
          let preview = ''; try { const pu = new URL(String(x.preview || f.preview || '')); preview = stockImgHost(pu) ? pu.href : ''; } catch (e) { /* none */ }
          return { title: String(x.title || '').slice(0, 200), url: f.slug ? f.url : '', preview: preview.slice(0, 600), editorial: x.editorial === true ? true : x.editorial === false ? false : null }; };
        if (ids.length) await redis(...ids.map((id) => ['HSETNX', ED_KEY, id, JSON.stringify(Object.assign({ id, src: 'added', by: me.name || me.email, at }, clean(id)))]));
        return res.status(200).json({ added: ids.length });
      }
      if (op === 'hash') {
        const id = String(b.id || '').trim(); const h = String(b.h || '');
        if (!okId(id) || !/^[01]{64}$/.test(h)) return res.status(400).json({ error: 'Bad fingerprint' });
        const [raw] = await redis(['HGET', ED_KEY, id]); const cur = jparse(raw);
        if (!cur) return res.status(404).json({ error: 'Not on the list' });
        // Anyone scanning may fill in a missing fingerprint; replacing one is for the list's managers.
        if (cur.h && !(await can(me, 'exempt.global'))) return res.status(403).json({ error: 'Already fingerprinted' });
        const next = Object.assign({}, cur, { h, hBy: me.name || me.email, hAt: new Date().toISOString(), hFrom: b.from === 'upload' ? 'upload' : 'preview' });
        await redis(['HSET', ED_KEY, id, JSON.stringify(next)]);
        return res.status(200).json({ ok: true, item: next });
      }
      if (op === 'lookup') {
        const ids = [...new Set([].concat(b.ids || []).map((x) => String(x).trim()).filter(okId))].slice(0, 30);
        if (!ids.length) return res.status(200).json({ results: {} });
        const cached = await redis(...ids.map((id) => ['GET', LK_KEY(id)]));
        const results = {}; const fresh = [];
        // A page that did not answer is asked again when the AI may now fill in (adding by hand, Get previews).
        ids.forEach((id, i) => { const v = jparse(cached[i]); if (v && v.preview && !(b.ai && v.editorial === null && !v.title && v.via !== 'ai')) results[id] = v; else fresh.push(id); });
        // A few at a time: this is Shutterstock's public website, not an API.
        // Side by side, so ten of them (an AI web search each, when Shutterstock's page does not answer) stay well inside the time limit.
        await Promise.all(fresh.slice(0, 10).map(async (id) => {
          let v = await stockLookup(id);
          // When Shutterstock's page does not answer, an AI web search finds its address (adding by hand, Get previews).
          if (b.ai && v.editorial === null && !v.title) { const w = await stockLookupAI(id); if (w && w.title) v = Object.assign({}, v, { title: w.title, url: w.url || v.url, preview: w.preview || v.preview, editorial: w.editorial, via: 'ai' }); }
          results[id] = v;
          await redis(['SET', LK_KEY(id), JSON.stringify(v), 'EX', v.editorial === null ? 86400 : 30 * 86400]);
        }));
        const [all] = await redis(['HKEYS', ED_KEY]);
        const listed = new Set([].concat(all || []).map(String));
        const at = new Date().toISOString(); const cmds = [];
        Object.values(results).forEach((v) => {
          if (!v || !v.id) return;
          if (v.editorial === true && !listed.has(v.id) && !b.ai) cmds.push(['HSETNX', ED_KEY, v.id, JSON.stringify({ id: v.id, src: 'lookup', by: 'Found by a scan', at, preview: v.preview || '', url: v.url || '', title: v.title || '', editorial: true })]);
        });
        if (cmds.length) await redis(...cmds);
        // Listed IDs without a preview get the one the page gave.
        const needPrev = Object.values(results).filter((v) => v && v.preview && listed.has(v.id));
        if (needPrev.length) {
          const rows = await redis(...needPrev.map((v) => ['HGET', ED_KEY, v.id]));
          const up = []; needPrev.forEach((v, i) => { const cur = jparse(rows[i]); if (cur && (!cur.preview || !cur.url)) up.push(['HSET', ED_KEY, v.id, JSON.stringify(Object.assign(cur, { preview: cur.preview || v.preview, url: cur.url || v.url || '', title: cur.title || v.title || '', editorial: cur.editorial === undefined ? v.editorial : cur.editorial }))]); });
          if (up.length) await redis(...up);
        }
        return res.status(200).json({ results, pending: Math.max(0, fresh.length - 10) });
      }
      return res.status(400).json({ error: 'Unknown stock op' });
    }
    if (Array.isArray(b.save)) {
      const rows = b.save.slice(0, 120).filter((x) => x && x.url && typeof x.h === 'string');
      if (!rows.length) return res.status(200).json({ saved: 0 });
      const cmds = rows.map((x) => ['SET', KEY(imgKey(x.url)), JSON.stringify({
        h: String(x.h).slice(0, 64), photo: !!x.photo, why: String(x.why || '').slice(0, 40),
        w: Number(x.w) || 0, h2: Number(x.h2) || 0, colors: Number(x.colors) || 0, alpha: Number(x.alpha) || 0,
      }), 'EX', TTL]);
      await redis(...cmds);
      return res.status(200).json({ saved: rows.length });
    }
    const urls = [].concat(b.urls || []).slice(0, 200).map(String);
    if (!urls.length) return res.status(200).json({ hashes: {} });
    const rows = await redis(...urls.map((u) => ['GET', KEY(imgKey(u))]));
    const hashes = {};
    urls.forEach((u, i) => { hashes[u] = jparse(rows[i]) || null; });
    return res.status(200).json({ hashes });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
export default metered('imghash', handler);
