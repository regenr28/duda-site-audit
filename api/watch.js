// Live content check: every published website read like a visitor reads it, and compared with its
// Business Info (name, phone, email, address, social accounts). The work itself is in _watch.js.
//
// GET  /api/watch?op=status            → how far it has got, and every website's counts
// GET  /api/watch?op=site&id=<duda id> → one website's findings
// POST /api/watch { op:'drain' }        → read the next few websites (open browsers keep it moving)
// POST /api/watch { op:'check', id }    → read this website now
// POST /api/watch { op:'ok', id, key }  → "not a problem" for this website (and { op:'unok' } undoes it)
// POST /api/watch { op:'settings', on } → pause or resume the whole thing (admins)
// GET  /api/watch?op=cron               → once a day from Vercel's scheduler: read, then send the report
import { redis, P, requireUser, readBody, jparse, denyUnless, appUrl } from './_lib.js';
import { runWatch, watchStatus, watchDigest, markOk, unmarkOk, okList, WKEY, WCFG } from './_watch.js';

const okId = (id) => /^[A-Za-z0-9_-]{4,64}$/.test(String(id || ''));

async function cron(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && String(req.headers.authorization || '') !== 'Bearer ' + secret) return res.status(401).json({ error: 'Not allowed' });
  const [gate] = await redis(['SET', P + 'cwsweep', new Date().toISOString(), 'NX', 'EX', 20 * 3600]);
  if (gate !== 'OK') return res.status(200).json({ skipped: 'already ran in the last 20 hours' });
  const r = await runWatch({ budgetMs: 100000, by: 'cron' });
  const reported = await watchDigest().catch(() => 0);
  return res.status(200).json(Object.assign({ reported }, r));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  appUrl(req);   // links in the alerts point back at this app
  try {
    if (req.method === 'GET' && req.query.op === 'cron') return await cron(req, res);
    const me = await requireUser(req, res);
    if (!me) return;
    if (await denyUnless(res, me, 'live.view', 'Your role does not include Live DR Sites.')) return;
    if (req.method === 'GET') {
      if (req.query.op === 'site') {
        const id = String(req.query.id || '');
        if (!okId(id)) return res.status(400).json({ error: 'Which website?' });
        const [[raw], ok] = await Promise.all([redis(['GET', WKEY(id)]), okList(id)]);
        return res.status(200).json({ result: jparse(raw), ok });
      }
      return res.status(200).json(await watchStatus());
    }
    const b = readBody(req);
    if (b.op === 'drain') return res.status(200).json(await runWatch({ budgetMs: 40000, by: me.email }));
    if (b.op === 'settings') {
      if (me.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
      await redis(['SET', WCFG, JSON.stringify(b.on ? {} : { off: true, by: me.name, at: Date.now() })]);
      return res.status(200).json(await watchStatus());
    }
    const id = String(b.id || '');
    if (!okId(id)) return res.status(400).json({ error: 'Which website?' });
    if (await denyUnless(res, me, 'live.content', 'Your role does not allow changing the live content check.')) return;
    if (b.op === 'check') {
      const r = await runWatch({ only: id, budgetMs: 95000, by: me.email });
      if (r.busy) return res.status(409).json({ error: 'This website is being read right now. Give it a minute.' });
      if (r.error) return res.status(503).json({ error: r.error });
      if (r.wait) return res.status(503).json({ error: `Duda asked us to slow down (${r.problem || 'too many requests'}). Try again in ${Math.ceil(r.wait / 60)} minute${r.wait > 60 ? 's' : ''}.` });
      const [[raw], ok] = await Promise.all([redis(['GET', WKEY(id)]), okList(id)]);
      return res.status(200).json({ result: jparse(raw), ok, partial: r.partial, found: !!r.done.length || r.partial });
    }
    const key = String(b.key || '').slice(0, 300);
    if (!key) return res.status(400).json({ error: 'Which finding?' });
    if (b.op === 'ok') return res.status(200).json({ result: await markOk(id, key), ok: await okList(id) });
    if (b.op === 'unok') { await unmarkOk(id, key); return res.status(200).json({ ok: await okList(id) }); }
    return res.status(400).json({ error: 'Unknown op' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
