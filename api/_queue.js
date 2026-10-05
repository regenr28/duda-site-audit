// A queue of websites whose form-submission history we still need from Duda, and the one place that
// decides whether the app has room to do that work right now.
//
// Why a queue at all. Ongoing enquiries do not need one: the account-wide CONTACT_FORM_SENT_V2
// webhook pushes every new submission the moment it is made, for every website, at no cost to us.
// What a queue is for is the *history* — roughly 8,400 calls to Duda to cover 700 websites a year
// back. That is a one-off job that must never run as one long job: it would outlast any function
// time limit, and it would sit on Duda's rate limit for half an hour while people are trying to use
// the app.
//
// So it is drained a few websites at a time, by whoever has the app open, under a lock. Nothing is
// scheduled: there is no timer to misfire, nothing runs while nobody is using the app, and the work
// finishes itself over a few hours of ordinary use and then stays finished.
import { redis, P, jparse, now, slack, slackEnabled, OWNER_EMAIL, notifyUser } from './_lib.js';

const Q = () => P + 'leadq';            // siteId -> {at, why, tries}
const DONE = () => P + 'leadq:done';    // siteId -> ISO of the last successful pull
const LOCK = () => P + 'leadq:lock';    // one drainer at a time
const STATE = () => P + 'leadq:state';  // what happened last, for the screen

// A chunk is sized by the clock, not by taste: each website costs up to MONTHS calls to Duda paced
// at 150ms, and the whole request must finish well inside the function's 120 seconds.
export const MONTHS = 12;
export const CHUNK = 4;                  // 4 × 12 × 150ms ≈ 7s of pacing, plus Duda's own latency
export const LOCK_MS = 90000;

/** Sites still waiting, and whether anybody is working on them. */
export async function queueState() {
  const [n, raw, lock] = await redis(['HLEN', Q()], ['GET', STATE()], ['EXISTS', LOCK()]);
  const last = jparse(raw) || null;
  return { pending: Number(n || 0), running: Number(lock || 0) > 0, last };
}

/**
 * Add websites that still need their history.
 *
 * Anything already pulled, or already waiting, is left alone — so this is safe to call on every
 * publish, every audit and every refresh of the website list, which is exactly what makes the queue
 * keep itself up to date without anybody maintaining it.
 */
export async function enqueue(ids, why) {
  const want = [...new Set([].concat(ids || []).map((x) => String(x || '').slice(0, 64)).filter(Boolean))];
  if (!want.length) return 0;
  const [doneRaw, pendRaw] = await redis(['HGETALL', DONE()], ['HGETALL', Q()]);
  const flat = (x) => { const o = {}; if (Array.isArray(x)) { for (let i = 0; i < x.length; i += 2) o[x[i]] = x[i + 1]; } else Object.assign(o, x || {}); return o; };
  const done = flat(doneRaw); const pend = flat(pendRaw);
  const add = want.filter((id) => !done[id] && !pend[id]);
  if (!add.length) return 0;
  await redis(['HSET', Q(), ...[].concat(...add.map((id) => [id, JSON.stringify({ at: now(), why: String(why || '').slice(0, 40), tries: 0 })]))]);
  return add.length;
}

/** Forget that a website was ever pulled, so the queue will pull it again. */
export async function requeue(ids, why) {
  const want = [].concat(ids || []).map((x) => String(x || '').slice(0, 64)).filter(Boolean);
  if (!want.length) return 0;
  await redis(['HDEL', DONE(), ...want]);
  return enqueue(want, why);
}

/**
 * Take the next few websites, if nobody else is already working.
 *
 * The lock is the whole concurrency story: six people can have the app open and only one browser
 * will be pulling from Duda. It expires on its own, so a browser closed mid-chunk costs one lock
 * period rather than stopping the queue forever.
 */
export async function claim(n = CHUNK) {
  const [lock] = await redis(['SET', LOCK(), now(), 'NX', 'PX', LOCK_MS]);
  if (lock !== 'OK') return null;
  const [raw] = await redis(['HGETALL', Q()]);
  const o = {}; if (Array.isArray(raw)) { for (let i = 0; i < raw.length; i += 2) o[raw[i]] = raw[i + 1]; } else Object.assign(o, raw || {});
  const ids = Object.keys(o);
  if (!ids.length) { await redis(['DEL', LOCK()]); return null; }
  // Oldest first, so a website that has been waiting does not keep losing to new arrivals.
  ids.sort((a, b) => String((jparse(o[a]) || {}).at || '').localeCompare(String((jparse(o[b]) || {}).at || '')));
  return { ids: ids.slice(0, Math.max(1, n)), meta: o, left: ids.length };
}

export const unlock = () => redis(['DEL', LOCK()]).catch(() => {});

/**
 * The same lock, for work that is not a queue chunk.
 *
 * A person pressing "Get form submissions" and the background queue are the same job asking Duda
 * the same questions, so they take the same lock. That is what makes the busy message honest rather
 * than a guess: if this fails, something really is already pulling.
 */
export async function takeLock() {
  const [got] = await redis(['SET', LOCK(), now(), 'NX', 'PX', LOCK_MS]);
  return got === 'OK';
}

/**
 * Record how a chunk went.
 *
 * A website that failed goes back on the queue with its try count raised, and is given up on after
 * three — a website Duda will not answer for must not block the ones behind it forever, and silently
 * retrying something broken is how an allowance gets spent on nothing.
 */
export async function settle(done, failed, meta, by) {
  const cmds = [];
  const stamp = now();
  if (done.length) {
    cmds.push(['HDEL', Q(), ...done.map((d) => d.id)]);
    cmds.push(['HSET', DONE(), ...[].concat(...done.map((d) => [d.id, stamp]))]);
  }
  const gaveUp = [];
  failed.forEach((f) => {
    const m = jparse(meta[f.id]) || {};
    const tries = Number(m.tries || 0) + 1;
    if (tries >= 3) { gaveUp.push(f); cmds.push(['HDEL', Q(), f.id], ['HSET', DONE(), f.id, stamp + ' (gave up)']); }
    else cmds.push(['HSET', Q(), f.id, JSON.stringify(Object.assign({}, m, { tries, lastError: String(f.error || '').slice(0, 120) }))]);
  });
  cmds.push(['SET', STATE(), JSON.stringify({ at: stamp, by: by || '', manual: !!(by && by !== 'auto'), ok: done.length, failed: failed.length, added: done.reduce((a, d) => a + (d.added || 0), 0) })]);
  if (cmds.length) await redis(...cmds);
  return { gaveUp };
}

// ---------------------------------------------------------------------------
// Telling the owner, without becoming noise
// ---------------------------------------------------------------------------
/**
 * Something the owner needs to know about.
 *
 * An alert nobody can bear to read is worse than no alert, so each kind is sent at most once in its
 * cooldown. The counter is set with NX and an expiry, so the deduplication survives across every
 * instance of the app without anything to clean up.
 */
export async function alertOwner(kind, text, { cooldownMs = 6 * 3600 * 1000, link = '' } = {}) {
  const key = P + 'alerted:' + String(kind || 'x').slice(0, 40);
  const [first] = await redis(['SET', key, now(), 'NX', 'PX', Math.max(60000, cooldownMs)]);
  if (first !== 'OK') return { skipped: 'cooldown' };
  const body = `⚠️ *Site Auditor* — ${text}${link ? `\n${link}` : ''}`;
  const out = { kind, at: now(), text: String(text).slice(0, 300) };
  await redis(['LPUSH', P + 'alertlog', JSON.stringify(out)], ['LTRIM', P + 'alertlog', 0, 49]).catch(() => {});
  // The bell always gets it; Slack only when it is set up. Neither failing may break the caller —
  // an alert is a courtesy on top of the work, never a reason the work did not happen.
  await notifyUser(OWNER_EMAIL, { kind: 'system', text: String(text).slice(0, 300), by: 'system', byName: 'Site Auditor' }).catch(() => {});
  if (slackEnabled()) await slack(body).catch(() => {});
  return { sent: true };
}

/** The last few alerts, for the health page. */
export async function recentAlerts(n = 10) {
  const [raw] = await redis(['LRANGE', P + 'alertlog', 0, Math.max(0, n - 1)]);
  return (raw || []).map((x) => jparse(x)).filter(Boolean);
}
