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
import { redis, P, readBody, requireUser, jparse, sha } from './_lib.js';

// Only the places a Duda website actually serves pictures from. This must never become a proxy for
// anything anyone asks for.
const IMG_HOSTS = /(^|\.)(cdn-website\.com|multiscreensite\.com|dudaone\.com|responsivesiteeditor\.com|dudamobile\.com|mobilesitesonline\.com|dudasites\.com|duda\.co|dudacdn\.com)$/i;
const MAX_BYTES = 6 * 1024 * 1024;
const TTL = 90 * 86400;          // a picture's pixels don't change under the same address
const KEY = (u) => P + 'ih:' + sha(u).slice(0, 24);

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

export default async function handler(req, res) {
  const me = await requireUser(req, res);
  if (!me) return;
  try {
    if (req.method === 'GET') {
      const raw = String(req.query.url || '');
      let u;
      try { u = new URL(raw); } catch (e) { return res.status(400).json({ error: 'Bad url' }); }
      if (u.protocol !== 'https:' || !IMG_HOSTS.test(u.hostname)) return res.status(400).json({ error: 'Host not allowed' });
      const r = await fetch(smallUrl(raw), { headers: { Accept: 'image/*' }, redirect: 'follow' });
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
