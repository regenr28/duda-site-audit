// The form-submission backfill queue: how many websites are still waiting, and one chunk of work.
//
// GET  /api/leadq               → { pending, running, last, retryAfter }
// POST /api/leadq { op:'drain' }→ does one chunk, if nobody else is doing one
// POST /api/leadq { op:'add', ids }    → put websites on the queue
// POST /api/leadq { op:'again', ids }  → pull a website's history again, even if already done
//
// Nothing here is scheduled. An open browser asks whether there is work and, if there is and nobody
// else has the lock, does a few websites' worth. That is what "automatic" means in this app: the
// work happens while people are using it and stops dead when they are not.
import { requireUser, readBody, denyUnless, can, globalLog, now, jparse, P, redis } from './_lib.js';
import { queueState, claim, settle, unlock, enqueue, requeue, alertOwner, takeLock, CHUNK, MONTHS } from './_queue.js';
import { pullMonth } from './leads.js';
import { addLeads, compactOldMonths, bumpSummary, tidySite, TIDY_VERSION } from './_leads.js';

/**
 * How busy the app is, in words anybody can act on.
 *
 * The honest answer to "why can't I press this" is almost never a status code. It is either "the app
 * is already doing exactly this for somebody else" or "we are close to a limit this month" — and
 * both have a different thing to do next, so they are different messages.
 */
export async function busyCheck() {
  const st = await queueState();
  if (st.running) {
    const since = st.last && st.last.at ? Date.now() - Date.parse(st.last.at) : 0;
    const wait = Math.max(10, Math.round((90000 - Math.min(since, 85000)) / 1000));
    return {
      busy: true, retryAfter: wait,
      message: `Form submissions are being fetched right now — the app does this a few websites at a time so it never overloads. Please try again in about ${wait} seconds.`,
    };
  }
  return { busy: false, retryAfter: 0, message: '' };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const me = await requireUser(req, res);
  if (!me) return;
  try {
    if (req.method === 'GET') {
      const st = await queueState();
      const busy = st.running ? await busyCheck() : { busy: false, retryAfter: 0, message: '' };
      // The ids as well as the count: a few thousand characters, and it is what lets the list say
      // "waiting" against the right websites instead of "none yet" against all of them.
      let ids = [];
      if (st.pending) { const [raw] = await redis(['HKEYS', P + 'leadq']); ids = (raw || []).slice(0, 2000); }
      return res.status(200).json(Object.assign(st, await tidyState(), { ids, retryAfter: busy.retryAfter, busyMessage: busy.message, chunk: CHUNK, months: MONTHS }));
    }

    const b = readBody(req);

    if (b.op === 'add' || b.op === 'again') {
      if (await denyUnless(res, me, 'leads.import', 'Your role does not allow fetching form submissions.')) return;
      const ids = [].concat(b.ids || []);
      const n = b.op === 'again' ? await requeue(ids, 'asked') : await enqueue(ids, 'asked');
      return res.status(200).json(Object.assign({ queued: n }, await queueState()));
    }

    if (b.op !== 'drain') return res.status(400).json({ error: 'Unknown op' });

    // Draining is open to anyone who may see enquiries: it is the app catching up with itself, not
    // somebody starting a job. Whether it runs at all is decided by the lock, not by who asked.
    if (!(await can(me, 'leads.view'))) return res.status(200).json({ skipped: 'not allowed', pending: 0 });

    const got = await claim(CHUNK);
    if (!got) {
      const st = await queueState();
      // Nothing to fetch: spend the turn tidying what is already stored instead, a few websites at a
      // time, under the same lock. Nothing here asks Duda for anything.
      if (!st.pending && !st.running) {
        const tidied = await tidyBatch().catch(() => null);
        if (tidied) return res.status(200).json(Object.assign({ tidied }, await queueState(), await tidyState()));
      }
      return res.status(200).json(Object.assign({ skipped: st.pending ? 'someone else is doing it' : 'nothing to do' }, st, await tidyState()));
    }

    const done = []; const failed = [];
    try {
      for (const siteId of got.ids) {
        const d = new Date(); let added = 0; let seen = 0; let err = '';
        for (let i = 0; i < MONTHS; i++) {
          const ym = d.toISOString().slice(0, 7);
          try { const rows = await pullMonth(siteId, ym); seen += rows.length; added += await addLeads(siteId, rows, { repair: true }); }
          catch (e) { err = String(e.message || e).slice(0, 140); break; }
          d.setUTCMonth(d.getUTCMonth() - 1);
          // Duda allows 300 form-submission calls a minute. One every 150ms is 400/min of headroom
          // short of that, and leaves the account's other calls room to get through.
          await new Promise((r) => setTimeout(r, 150));
        }
        if (err) { failed.push({ id: siteId, error: err }); continue; }
        await compactOldMonths(siteId).catch(() => {});
        await tidySite(siteId).catch(() => 0);
        const s = await bumpSummary(siteId).catch(() => ({}));
        done.push({ id: siteId, seen, added, total: s.total || 0 });
      }
    } finally {
      await unlock();
    }

    const { gaveUp } = await settle(done, failed, got.meta, b.by === 'auto' ? 'auto' : me.email);
    await markRun('leads', me, b.by !== 'auto', { count: done.length, added: done.reduce((a, d) => a + d.added, 0) });
    if (gaveUp.length) {
      await alertOwner('leadq-failed',
        `${gaveUp.length} website${gaveUp.length === 1 ? '' : 's'} could not have their form-submission history fetched after three tries. The first one said: "${gaveUp[0].error}". Everything else is still being fetched normally.`,
        { cooldownMs: 12 * 3600 * 1000 }).catch(() => {});
    }
    // One line in the activity log per chunk would drown it; only a person pressing the button is
    // worth recording, and only when it actually did something.
    if (b.by !== 'auto' && done.length) await globalLog(me, 'leads-fetch', `fetched form submissions for ${done.length} website${done.length === 1 ? '' : 's'}`).catch(() => {});

    const st = await queueState();
    return res.status(200).json(Object.assign({ done, failed, gaveUp: gaveUp.length }, st));
  } catch (e) {
    await unlock();
    return res.status(500).json({ error: String(e.message || e).slice(0, 300) });
  }
}

/** Remember when a bulk action last ran, and whether a person asked for it. Used by the stamps. */
export async function markRun(kind, me, manual, extra) {
  await redis(['SET', P + 'lastrun:' + kind, JSON.stringify(Object.assign({
    at: now(), by: me && me.email ? me.email : '', byName: me && me.name ? me.name : '', manual: !!manual,
  }, extra || {}))]).catch(() => {});
}
export async function lastRuns(kinds) {
  const keys = [].concat(kinds || []);
  if (!keys.length) return {};
  const got = await redis(...keys.map((k) => ['GET', P + 'lastrun:' + k]));
  const out = {};
  keys.forEach((k, i) => { const v = jparse(got[i]); if (v) out[k] = v; });
  return out;
}

// ---------------------------------------------------------------------------
// Tidying what is already stored
// ---------------------------------------------------------------------------
/**
 * Has every website been tidied at the current version?
 *
 * One key, read on every queue check, so that once the job is finished it costs one command and
 * nothing more. Only while it is unfinished does anything heavier happen.
 */
async function tidyState() {
  const [v] = await redis(['GET', P + 'leadtidy:all']);
  return { tidyDone: v === TIDY_VERSION };
}

/**
 * Tidy the next few websites that need it.
 *
 * Every website with enquiries is in the totals hash; any not yet tidied at this version gets
 * merged and cleaned. When none are left, the "all done" key is set and this stops being called.
 */
async function tidyBatch(n = 8) {
  const [done] = await redis(['GET', P + 'leadtidy:all']);
  if (done === TIDY_VERSION) return null;
  if (!(await takeLock())) return null;
  try {
    const [keys, marks] = await redis(['HKEYS', P + 'leadtot'], ['HGETALL', P + 'leadtidy']);
    const seen = {};
    if (Array.isArray(marks)) { for (let i = 0; i < marks.length; i += 2) seen[marks[i]] = marks[i + 1]; } else Object.assign(seen, marks || {});
    const todo = (keys || []).filter((k) => seen[k] !== TIDY_VERSION);
    let merged = 0;
    for (const id of todo.slice(0, n)) merged += await tidySite(id).catch(() => 0);
    const left = Math.max(0, todo.length - n);
    if (!left) await redis(['SET', P + 'leadtidy:all', TIDY_VERSION]);
    return { sites: Math.min(n, todo.length), merged, left };
  } finally { await unlock(); }
}
