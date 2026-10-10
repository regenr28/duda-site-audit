// Pictures of a website's pages, for marking up change requests.
//
// GET  /api/capture?op=latest&site=&device=&path=   → the newest picture of that page, if still fresh
// GET  /api/capture?op=meta&cap=                    → one picture's size and slices
// GET  /api/capture?op=map&cap=                     → where every element sits on it
// GET  /api/capture?op=slice&cap=&i=                → slice i, as an image
// POST /api/capture { op:'shoot', site, device, path, fresh }   → take a new picture (or reuse a fresh one)
// POST /api/capture { op:'upload', site, data, type, w, h }     → the client's own screenshot, used as the page
// POST /api/capture { op:'test', site? }                         → admins: check pictures work on this server
// GET  /api/capture?op=thumb&site=<duda id>                      → the team: a website's small thumbnail (image)
// POST /api/capture { op:'thumb', site:<duda id>, pub }          → the team: take it if missing, or older than its last publish / a week
//
// `site` is always the website's record id in this app; the page itself is opened on the Duda
// preview of that website's draft, so it shows what the team is working on, not just what is live.
import { redis, P, newId, now, globalLog, readBody } from './_lib.js';
import { who, mayseeSite, getCap, capPublic, storeCap, capMap, settings, today, cleanPath, siteRec, previewUrl, getTickets, putTicketCmd, keepCapCmds, cleanReplay } from './_tickets.js';
import { shoot, DEVICES } from './_shoot.js';

const CLIENT_SHOTS_PER_DAY = 60;
const MAX_UPLOAD = 3 * 1024 * 1024;   // a request body can be at most about 4.5 MB once encoded

const idxField = (device, path) => `${device}|${path}`;

async function takePicture(rec, site, device, path, by, ttl, replay) {
  const { host, url } = await previewUrl(rec, path, device);
  const shot = await shoot(url, device, { replay });
  const meta = { id: newId(9), site, dudaSite: rec.siteId || site, host, path, device, kind: 'page', w: shot.w, h: shot.h, dsf: shot.dsf, cut: shot.cut,
    title: shot.title, links: shot.links, at: now(), by, ms: shot.ms, hasMap: true, scrollY: shot.scrollY || 0, replayed: !!replay, slices: shot.slices.map((s) => ({ y: s.y, h: s.h })) };
  await storeCap(meta, shot.slices.map((s) => s.data), shot.els);
  if (ttl) await redis(...[P + 'cap:' + meta.id, P + 'capmap:' + meta.id, ...meta.slices.map((_, i) => P + `capimg:${meta.id}:${i}`)].map((k) => ['EXPIRE', k, ttl]));
  return { meta, shot };
}

// ---------- website thumbnails (the picture at the top of a profile) ----------
// One small picture per website (480 px wide, about 15–30 KB), kept until the website is published
// again or a week has passed. Taken only when somebody opens that profile, so websites nobody looks
// at cost nothing.
const THUMB_W = 480;
const thumbKey = (id) => P + 'thumb:' + id;
const okDudaId = (id) => /^[A-Za-z0-9_-]{4,64}$/.test(String(id || ''));
async function thumbOp(req, res, w, b) {
  if (!w.team) return res.status(404).json({ error: 'Not found' });
  const site = String((req.method === 'GET' ? req.query.site : b.site) || '');
  if (!okDudaId(site)) return res.status(400).json({ error: 'Unknown website' });
  const [raw] = await redis(['GET', thumbKey(site)]);
  const t = raw ? JSON.parse(raw) : null;
  if (req.method === 'GET') {
    if (!t || !t.data) return res.status(404).json({ error: 'No picture yet' });
    const buf = Buffer.from(t.data, 'base64');
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.status(200).end(buf);
  }
  const pub = Date.parse(b.pub || '') || 0;
  const stale = !t || !t.data || (pub && pub > t.at) || Date.now() - t.at > 7 * 86400000;
  if (!stale && !b.again) return res.status(200).json({ at: t.at, made: false });
  const [lock] = await redis(['SET', P + 'thumblock:' + site, '1', 'NX', 'EX', 120]);
  if (lock !== 'OK') return res.status(200).json({ at: t ? t.at : 0, made: false, busy: true });
  try {
    const rec = (await siteRec(site)) || { id: site, siteId: site };
    const { url } = await previewUrl(Object.assign({}, rec, { siteId: rec.siteId || site }), '/', 'desktop');
    const shot = await shoot(url, 'desktop', { thumb: THUMB_W, timeout: 45000 });
    const at = Date.now();
    await redis(['SET', thumbKey(site), JSON.stringify({ at, w: shot.w, h: shot.h, data: shot.thumb })], ['DEL', P + 'thumblock:' + site]);
    return res.status(200).json({ at, made: true, kb: Math.round(shot.thumb.length * 0.75 / 1024) });
  } catch (e) {
    await redis(['DEL', P + 'thumblock:' + site]).catch(() => {});
    return res.status(200).json({ at: t ? t.at : 0, made: false, error: 'The picture could not be taken right now.' });
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const w = await who(req, res);
  if (!w) return;
  const b = req.method === 'GET' ? {} : (readBody(req) || {});
  const op = String((req.method === 'GET' ? req.query.op : b.op) || '');
  try {
    if (op === 'thumb') return await thumbOp(req, res, w, b);
    if (req.method === 'GET') {
      if (op === 'latest') {
        const site = String(req.query.site || '');
        if (!mayseeSite(w, site)) return res.status(404).json({ error: 'Not found' });
        const device = DEVICES[req.query.device] ? req.query.device : 'desktop';
        const path = cleanPath(req.query.path);
        if (!path) return res.status(400).json({ error: 'That page address is not valid.' });
        const [ref] = await redis(['HGET', P + 'capidx:' + site, idxField(device, path)]);
        const r = ref ? JSON.parse(ref) : null;
        const cap = r ? await getCap(r.id) : null;
        const cfg = await settings();
        const fresh = cap && Date.now() - Date.parse(cap.at) < cfg.freshHours * 3600000;
        return res.status(200).json({ cap: fresh ? capPublic(cap) : null, older: !fresh && cap ? capPublic(cap) : null });
      }
      const cap = await getCap(req.query.cap);
      if (!cap || !mayseeSite(w, cap.site)) return res.status(404).json({ error: 'That page picture has expired. Open the page again to take a new one.' });
      if (op === 'meta') return res.status(200).json({ cap: capPublic(cap) });
      if (op === 'map') {
        res.setHeader('Cache-Control', 'private, max-age=86400');
        return res.status(200).json({ els: cap.hasMap ? await capMap(cap.id) : [] });
      }
      if (op === 'slice') {
        const i = Math.floor(Number(req.query.i));
        if (!(i >= 0 && i < (cap.slices || []).length)) return res.status(400).end();
        const [b64] = await redis(['GET', P + `capimg:${cap.id}:${i}`]);
        if (!b64) return res.status(404).end();
        res.setHeader('Content-Type', cap.kind === 'upload' ? (cap.type || 'image/webp') : 'image/webp');
        res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
        return res.status(200).end(Buffer.from(b64, 'base64'));
      }
      return res.status(400).json({ error: 'Unknown operation' });
    }

    if (op === 'shoot') {
      const site = String(b.site || '');
      if (!mayseeSite(w, site)) return res.status(404).json({ error: 'Not found' });
      const device = DEVICES[b.device] ? b.device : 'desktop';
      const path = cleanPath(b.path);
      if (!path) return res.status(400).json({ error: 'That page address is not valid.' });
      const rec = await siteRec(site);
      if (!rec) return res.status(404).json({ error: 'Not found' });
      const cfg = await settings();
      const [ref] = await redis(['HGET', P + 'capidx:' + site, idxField(device, path)]);
      const r = ref ? JSON.parse(ref) : null;
      const prev = r ? await getCap(r.id) : null;
      const age = prev ? Date.now() - Date.parse(prev.at) : Infinity;
      // A freeze from the live view repeats what the client did, so it is always a new picture.
      // "Refresh" still reuses a picture taken in the last two minutes: it cannot be any newer.
      const replay = cleanReplay(b.replay);
      if (!replay && prev && (age < 120000 || (!b.fresh && age < cfg.freshHours * 3600000))) return res.status(200).json({ cap: capPublic(prev), reused: true });
      if (w.client && !w.preview) {
        const { day } = today();
        const [n] = await redis(['INCR', P + `capday:${w.me.email}:${day}`], ['EXPIRE', P + `capday:${w.me.email}:${day}`, 172800]);
        if (n > CLIENT_SHOTS_PER_DAY) return res.status(429).json({ error: 'You have opened a lot of pages today. Please try again tomorrow, or use one you already opened.' });
      }
      // One picture of a page at a time: a second visitor waits for the first rather than starting another.
      const lock = P + `caplock:${site}:${device}:${path}`;
      const [got] = await redis(['SET', lock, w.me.email, 'NX', 'EX', 110]);
      if (!got) return res.status(200).json({ busy: true });
      try {
        const { meta } = await takePicture(rec, site, device, path, w.me.email, 0, replay);
        await redis(['HSET', P + 'capidx:' + site, idxField(device, path), JSON.stringify({ id: meta.id, at: meta.at })]);
        return res.status(200).json({ cap: capPublic(meta) });
      } catch (e) {
        // What went wrong with the page itself is worth saying; anything about how pictures are
        // taken is not for a client's screen (admins see it under Requests → Settings → Test).
        const msg = String(e.message || e);
        console.error('capture failed', site, device, path, msg);
        return res.status(502).json({ error: /^The page (could not be opened|answered with an error|took too long)/.test(msg) ? msg : 'This page could not be opened right now. Please try again in a few minutes.' });
      } finally { await redis(['DEL', lock]).catch(() => {}); }
    }

    // A request marked on the live website: take its pictures now. The client does not wait for this —
    // the request was saved the moment they pressed Send; this adds the picture of the spot (with the
    // mark drawn on) and the whole page around it, for the team.
    if (op === 'attach') {
      const [t] = await getTickets([String(b.id || '')]);
      if (!t || !mayseeSite(w, t.site) || t.type === 'question') return res.status(404).json({ error: 'Not found' });
      if (!w.client && !w.view) return res.status(403).json({ error: 'Not allowed' });
      if (t.img && t.cap && !b.again) return res.status(200).json({ ok: true, already: true });
      const lock = P + 'tkattach:' + t.id;
      const [got] = await redis(['SET', lock, '1', 'NX', 'EX', 110]);
      if (!got) return res.status(200).json({ busy: true });
      try {
        const rec = await siteRec(t.site);
        if (!rec) return res.status(404).json({ error: 'Not found' });
        const { host, url } = await previewUrl(rec, t.path || '/', t.device || 'desktop');
        const shot = await shoot(url, t.device || 'desktop', { replay: t.replay || null, mark: { kind: t.kind, geo: t.geo } });
        const meta = { id: newId(9), site: t.site, dudaSite: rec.siteId || t.site, host, path: t.path || '/', device: t.device || 'desktop', kind: 'page', w: shot.w, h: shot.h, dsf: shot.dsf, cut: shot.cut,
          title: shot.title, links: shot.links, at: now(), by: t.by, ms: shot.ms, hasMap: true, scrollY: shot.scrollY || 0, replayed: true, slices: shot.slices.map((x) => ({ y: x.y, h: x.h })) };
        await storeCap(meta, shot.slices.map((x) => x.data), shot.els);
        const [fresh] = await getTickets([t.id]);
        const nt = fresh || t;
        Object.assign(nt, { cap: meta.id, capKind: 'page', capW: meta.w, capH: meta.h, host: nt.host || host });
        const cmds = [...keepCapCmds(meta)];
        if (shot.crop) { nt.img = true; cmds.push(['SET', P + 'tkimg:' + nt.id, JSON.stringify(shot.crop)]); }
        cmds.push(putTicketCmd(nt));
        await redis(...cmds);
        return res.status(200).json({ ok: true, cap: capPublic(meta), img: !!shot.crop });
      } catch (e) {
        const msg = String(e.message || e);
        console.error('attach failed', t.id, msg);
        return res.status(502).json({ error: w.client ? 'The picture could not be taken right now.' : msg.slice(0, 300) });
      } finally { await redis(['DEL', lock]).catch(() => {}); }
    }

    if (op === 'upload') {
      const site = String(b.site || '');
      if (!mayseeSite(w, site)) return res.status(404).json({ error: 'Not found' });
      if (!/^image\/(png|jpeg|webp)$/.test(b.type || '') || typeof b.data !== 'string') return res.status(400).json({ error: 'Please choose a PNG, JPG or WebP picture.' });
      if (Buffer.byteLength(b.data, 'base64') > MAX_UPLOAD) return res.status(413).json({ error: 'That picture is too large. Please try a smaller one.' });
      const wd = Math.round(Number(b.w)), ht = Math.round(Number(b.h));
      if (!(wd >= 50 && wd <= 6000 && ht >= 50 && ht <= 16000)) return res.status(400).json({ error: 'That picture could not be read.' });
      const path = cleanPath(b.path) || '/';
      const rec = await siteRec(site);
      if (!rec) return res.status(404).json({ error: 'Not found' });
      const meta = { id: newId(9), site, dudaSite: rec.siteId || site, host: rec.host || '', path, device: ['desktop', 'tablet', 'mobile'].includes(b.device) ? b.device : 'mobile',
        kind: 'upload', type: b.type, w: wd, h: ht, dsf: 1, title: 'Your screenshot', links: [], at: now(), by: w.me.email, hasMap: false, slices: [{ y: 0, h: ht }] };
      await storeCap(meta, [b.data], null);
      return res.status(200).json({ cap: capPublic(meta) });
    }

    if (op === 'test') {
      if (w.client || !w.admin) return res.status(403).json({ error: 'Admins only' });
      let site = String(b.site || '');
      if (!site) { const [ids] = await redis(['HKEYS', P + 'index']); site = (ids || [])[0] || ''; }
      const rec = site ? await siteRec(site) : null;
      if (!rec) return res.status(400).json({ error: 'Add at least one website to Audits first, so there is a page to photograph.' });
      const t0 = Date.now();
      try {
        const { meta, shot } = await takePicture(rec, site, 'desktop', '/', w.me.email, 3600);
        await globalLog({ email: w.me.email, name: w.me.name }, 'ticket-test', `tested page pictures on ${rec.businessName || site}`, {});
        return res.status(200).json({ ok: true, ms: Date.now() - t0, browserMs: shot.ms, slices: meta.slices.length, h: meta.h, els: shot.els.length, links: shot.links.length, site: rec.businessName || site, cap: capPublic(meta) });
      } catch (e) {
        return res.status(200).json({ ok: false, ms: Date.now() - t0, error: String(e.message || e).slice(0, 400) });
      }
    }
    return res.status(400).json({ error: 'Unknown operation' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e).slice(0, 300) });
  }
}
