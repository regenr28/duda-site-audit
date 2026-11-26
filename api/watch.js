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
import { metered, redis, P, requireUser, readBody, jparse, denyUnless, appUrl, isCopy } from './_lib.js';
import { runWatch, watchStatus, watchLive, retryFailed, watchDigest, markOk, unmarkOk, okList, applyFixes, WKEY, WCFG } from './_watch.js';

const okId = (id) => /^[A-Za-z0-9_-]{4,64}$/.test(String(id || ''));

async function cron(req, res) {
  if (isCopy()) return res.status(200).json({ skipped: 'this is the copy: the auto audit runs in the main app' });
  const secret = process.env.CRON_SECRET;
  if (secret && String(req.headers.authorization || '') !== 'Bearer ' + secret) return res.status(401).json({ error: 'Not allowed' });
  const [gate] = await redis(['SET', P + 'cwsweep', new Date().toISOString(), 'NX', 'EX', 20 * 3600]);
  if (gate !== 'OK') return res.status(200).json({ skipped: 'already ran in the last 20 hours' });
  // Each auto audit runs on the days Settings → Auto audits gives it.
  const { aaCfg, aaToday, aaMark } = await import('./_autoaudits.js');
  const [biz, ed, pres] = await Promise.all([aaCfg('bizinfo'), aaCfg('editorial'), aaCfg('presence')]);
  const r = aaToday(biz) || aaToday(ed) ? await runWatch({ budgetMs: 70000, by: 'cron' }) : { skipped: 'not a day the Business Info and editorial photo checks run' };
  const reported = await watchDigest().catch(() => 0);
  const { presenceAuto } = await import('./_presence.js');
  r.presence = aaToday(pres) ? await presenceAuto({ budgetMs: 40000, by: 'cron' }).catch((e) => ({ error: String(e.message || e) })) : { skipped: 'not today' };
  if (r.presence && Array.isArray(r.presence.done) && r.presence.done.length) await aaMark('presence', { by: 'cron', done: r.presence.done.length });
  // Websites whose forms have just gone quiet: one message a day to the admins.
  const { quietAlerts } = await import('./_leadkv.js');
  r.quiet = await quietAlerts().catch((e) => ({ error: String(e.message || e) }));
  return res.status(200).json(Object.assign({ reported }, r));
}

/**
 * Every 10 minutes from Vercel's scheduler: read the next websites, so the auto audit keeps going with
 * nobody's app open. Only when Settings → Auto audits allows it (on, today, "around the clock"); a break
 * Duda asked for is respected, and with nothing waiting it costs one quick look.
 */
async function tick(req, res) {
  if (isCopy()) return res.status(200).json({ skipped: 'this is the copy' });
  const secret = process.env.CRON_SECRET;
  if (secret && String(req.headers.authorization || '') !== 'Bearer ' + secret) return res.status(401).json({ error: 'Not allowed' });
  const { aaCfg, aaToday } = await import('./_autoaudits.js');
  const [biz, ed] = await Promise.all([aaCfg('bizinfo'), aaCfg('editorial')]);
  if (biz.fields.roundClock === false) return res.status(200).json({ skipped: 'around the clock is off (Settings \u2192 Auto audits)' });
  if (!aaToday(biz) && !aaToday(ed)) return res.status(200).json({ skipped: 'not a day it runs' });
  const [due] = await redis(['GET', P + 'cwdue']);
  if (due !== null && Number(due) === 0) { await watchStatus().catch(() => {}); const [again] = await redis(['GET', P + 'cwdue']); if (!Number(again)) return res.status(200).json({ skipped: 'nothing waiting' }); }
  const r = await runWatch({ budgetMs: 90000, by: 'cron' });
  return res.status(200).json({ done: (r.done || []).length, pending: r.pending || 0, wait: r.wait || 0, off: !!r.off, busy: !!r.busy });
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  appUrl(req);   // links in the alerts point back at this app
  try {
    if (req.method === 'GET' && req.query.op === 'cron') return await cron(req, res);
    if (req.method === 'GET' && req.query.op === 'tick') return await tick(req, res);
    const me = await requireUser(req, res);
    if (!me) return;
    if (await denyUnless(res, me, 'live.view', 'Your role does not include Live DR Sites.')) return;
    if (req.method === 'GET') {
      // Settings → Auto audits: the list, and one auto audit's settings.
      if (req.query.op === 'autoaudits') { const { aaList } = await import('./_autoaudits.js'); return res.status(200).json({ list: await aaList(), canEdit: me.role === 'admin' }); }
      if (req.query.op === 'aa') {
        const { aaDetail } = await import('./_autoaudits.js');
        const d = await aaDetail(String(req.query.id || ''));
        return d ? res.status(200).json(Object.assign(d, { canEdit: me.role === 'admin' })) : res.status(404).json({ error: 'No such auto audit' });
      }
      if (req.query.op === 'site') {
        const id = String(req.query.id || '');
        if (!okId(id)) return res.status(400).json({ error: 'Which website?' });
        const [[raw], ok] = await Promise.all([redis(['GET', WKEY(id)]), okList(id)]);
        return res.status(200).json({ result: jparse(raw), ok });
      }
      // The status panel: one small read, polled while the auto audit is busy.
      // Online presence: the last check of one website (and the settings)
      if (req.query.op === 'presence') {
        const { PKEY, presenceCfg } = await import('./_presence.js');
        const cfg = await presenceCfg();
        const id = String(req.query.id || '');
        if (!id) return res.status(200).json({ cfg, maps: !!process.env.GOOGLE_MAPS_API_KEY });
        if (!okId(id)) return res.status(400).json({ error: 'Which website?' });
        const [raw] = await redis(['GET', PKEY(id)]);
        return res.status(200).json({ result: jparse(raw), cfg, maps: !!process.env.GOOGLE_MAPS_API_KEY });
      }
      // The status panel is open somewhere: a good moment to apply any pending correction (one read when there is none).
      if (req.query.op === 'live') { await applyFixes(8000).catch(() => {}); return res.status(200).json(await watchLive()); }
      return res.status(200).json(await watchStatus());
    }
    const b = readBody(req);
    if (b.op === 'retry') {
      if (me.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
      const n = await retryFailed();
      return res.status(200).json({ retried: n, live: await watchLive() });
    }
    if (b.op === 'drain') {
      if (isCopy()) return res.status(200).json({ off: true, copy: true, done: [] });
      const r = await runWatch({ budgetMs: 40000, by: me.email });
      // Nothing for the auto audit to read: the automatic online presence checks (when switched on) use the time.
      if (!r.busy && !r.wait && !r.error && !(r.done || []).length && !r.partial) {
        const { presenceAuto } = await import('./_presence.js');
        const p = await presenceAuto({ budgetMs: 45000, by: me.email }).catch(() => null);
        if (p && (p.checked || []).length) Object.assign(r, { presenceDone: p.checked.length, pending: p.left || 0 });
        if (r.off && p && !p.off) delete r.off;           // the auto audit is paused, the presence checks are not
      }
      return res.status(200).json(r);
    }
    if (b.op === 'presenceSettings') {
      if (me.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
      const { PCFG, presenceCfg } = await import('./_presence.js');
      const cur = await presenceCfg();
      const next = { auto: b.auto === undefined ? cur.auto : !!b.auto, perDay: Math.max(1, Math.min(200, Number(b.perDay) || cur.perDay)), clientDefault: b.clientDefault === undefined ? cur.clientDefault : !!b.clientDefault, by: me.name, at: Date.now() };
      await redis(['SET', PCFG, JSON.stringify(next)], next.auto ? ['SET', P + 'presence:due', '1', 'EX', 86400] : ['DEL', P + 'presence:due']);
      return res.status(200).json({ cfg: next });
    }
    if (b.op === 'aaSave' || b.op === 'aaTest' || b.op === 'aaPreview' || b.op === 'aaRun') {
      const A = await import('./_autoaudits.js');
      const def = A.aaDef(String(b.id || ''));
      if (!def) return res.status(400).json({ error: 'Which auto audit?' });
      if (b.op === 'aaPreview' || b.op === 'aaTest') {
        // The message as it would be sent with the settings on screen (not saved yet), for a made-up website.
        const cfg = Object.assign(await A.aaCfg(def.id), { notify: Object.assign({}, (await A.aaCfg(def.id)).notify, b.notify || {}) });
        if (!def.notify) return res.status(400).json({ error: 'This auto audit sends no messages.' });
        const m = A.aaMessage(def, cfg, { kind: def.id === 'domains' ? 'domain-problem' : def.id === 'quiet' ? 'leads-quiet' : 'watch-issue', test: true }, A.aaSample(def.id));
        if (b.op === 'aaTest') { const { notifyUser } = await import('./_lib.js'); await notifyUser(me.email, Object.assign({}, m, { headline: '[Test] ' + m.headline })); }
        return res.status(200).json({ message: { headline: m.headline, sections: m.sections, lines: m.lines } });
      }
      if (me.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
      if (b.op === 'aaSave') { const cfg = await A.aaSave(def.id, b.cfg || {}, me); await watchStatus().catch(() => {}); return res.status(200).json({ cfg }); }
      // Run now: the reading pass (Business Info and editorial photos) or the forms-gone-quiet message.
      if (def.id === 'bizinfo' || def.id === 'editorial') {
        if (isCopy()) return res.status(409).json({ error: 'This is the copy of the app: the auto audit runs in the main app.' });
        const r = await runWatch({ budgetMs: 45000, by: me.email });
        return res.status(200).json({ ran: true, done: (r.done || []).length, pending: r.pending || 0, off: !!r.off, wait: r.wait || 0, busy: !!r.busy });
      }
      if (def.id === 'quiet') { const { quietAlerts } = await import('./_leadkv.js'); const r = await quietAlerts({ force: true }); return res.status(200).json({ ran: true, quiet: r.quiet || 0, fresh: r.fresh || 0 }); }
      return res.status(400).json({ error: 'This one runs on its own schedule only.' });
    }
    if (b.op === 'settings') {
      if (me.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
      await redis(['SET', WCFG, JSON.stringify(b.on ? {} : { off: true, by: me.name, at: Date.now() })]);
      await watchStatus();
      return res.status(200).json(await watchLive());
    }
    const id = String(b.id || '');
    if (!okId(id)) return res.status(400).json({ error: 'Which website?' });
    if (await denyUnless(res, me, 'live.content', 'Your role does not allow changing the live content check.')) return;
    if (b.op === 'presence') {
      if (isCopy()) return res.status(409).json({ error: 'This is the copy of the app: the online presence check runs in the main app.' });
      const { presenceCheck } = await import('./_presence.js');
      const lock = P + 'presencelock:' + id;
      const [got] = await redis(['SET', lock, me.email, 'NX', 'EX', 120]);
      if (got !== 'OK') return res.status(409).json({ error: 'This website is being checked right now. Give it a minute.' });
      try { return res.status(200).json({ result: await presenceCheck(id, { by: me.name }) }); }
      finally { await redis(['DEL', lock]).catch(() => {}); }
    }
    if (b.op === 'check') {
      if (isCopy()) return res.status(409).json({ error: 'This is the copy of the app: Check now runs in the main app.' });
      const r = await runWatch({ only: id, budgetMs: 95000, by: me.email });
      if (r.busy) return res.status(409).json({ error: 'This website is being read right now. Give it a minute.' });
      if (r.error) return res.status(503).json({ error: r.error });
      if (r.wait) return res.status(503).json({ error: `The auto audit is taking a break: ${r.problem || 'asked to slow down'}. Try again in ${Math.ceil(r.wait / 60)} minute${r.wait > 60 ? 's' : ''}.` });
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
export default metered('watch', handler);
