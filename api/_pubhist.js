// Publish history: what happened to each website, and when — for the Trends tab on Live DR Sites.
//
// Duda's list of websites only knows the present: which websites are live now, when each was first
// published and when it was last published. It cannot say how many went live in March, or which ones
// were switched off. So every change is written down as it happens, one short line per change, in one
// list per month:
//
//   type | site id | seconds (base 36) | source | extra
//
//   L  launched (Duda's webhook says first_publish)        U  unpublished
//   R  re-published an already live website                D  custom domain changed (extra = domain)
//   B  back: published again after being unpublished       P  published, kind not known yet (decided when read)
//
//   source: w = Duda's webhook (exact) · s = spotted by comparing two pulls of the website list
//           (extra = when the previous pull was) · f = copied from the per-website feed kept before this existed
//
// Writing costs one command per event, folded into commands that were being sent anyway. Reading costs
// one command per month shown, and only when somebody opens the Trends tab.
import { redis, P } from './_lib.js';

export const EV_KEY = (month) => P + 'pubev:' + month;
const SINCE = P + 'pubev:since';       // the first month there is anything to read
const SEEDED = P + 'pubev:seeded';     // the old per-website feeds have been copied in
const monthOf = (ms) => new Date(ms).toISOString().slice(0, 7);
const s36 = (ms) => Math.round(ms / 1000).toString(36);

export function evLine(type, site, ms, src, extra = '') {
  return [type, String(site).replace(/\|/g, ''), s36(ms), src, String(extra || '').replace(/[|\s]/g, '').slice(0, 120)].join('|');
}
export function parseEv(line) {
  const [t, s, sec, src, extra] = String(line || '').split('|');
  const at = parseInt(sec, 36) * 1000;
  if (!t || !s || !Number.isFinite(at)) return null;
  return { t, s, at, src: src || 'w', x: extra || '' };
}
/** The commands that store these events: one RPUSH per month touched. */
export function evCmds(lines) {
  const by = {};
  lines.forEach(([ms, line]) => { const m = monthOf(ms); (by[m] = by[m] || []).push(line); });
  return Object.entries(by).map(([m, ls]) => ['RPUSH', EV_KEY(m), ...ls]);
}

/**
 * Two pulls of the published list, compared. A webhook can be missed (the connection was off, Duda
 * had a bad hour), and a deleted website sends nothing at all — this is what still notices.
 * A pull that came back much shorter than the last one is treated as a bad pull, not a mass exodus.
 */
export function diffEvents(prevSites, nextSites, prevAt, now = Date.now()) {
  if (!prevSites || !prevSites.length || !nextSites) return [];
  if (nextSites.length < prevSites.length * 0.9) return [];
  const before = new Set(prevSites.map((x) => x.id));
  const after = new Set(nextSites.map((x) => x.id));
  const out = [];
  prevSites.forEach((x) => { if (!after.has(x.id)) out.push([now, evLine('U', x.id, now, 's', s36(prevAt || now))]); });
  nextSites.forEach((x) => { if (!before.has(x.id)) out.push([now, evLine('P', x.id, now, 's', s36(prevAt || now))]); });
  return out;
}

/**
 * Before this existed, each website's webhook events were already kept in a short feed of their own.
 * Copied in once, so the charts start from the day the Duda connection was made rather than today.
 * About one command per website, once.
 */
export async function seedFromFeeds() {
  const [done, watchIds] = await redis(['GET', SEEDED], ['HKEYS', P + 'watch']);
  if (done) return false;
  const ids = (watchIds || []).filter(Boolean);
  const lines = [];
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200);
    const feeds = await redis(...part.map((id) => ['LRANGE', P + 'sitefeed:' + id, 0, 99]));
    part.forEach((id, k) => (feeds[k] || []).forEach((raw) => {
      let e = null; try { e = JSON.parse(raw); } catch (x) { return; }
      const ms = Date.parse(e && e.at);
      if (!Number.isFinite(ms)) return;
      if (e.type === 'PUBLISH') lines.push([ms, evLine('P', id, ms, 'f')]);
      else if (e.type === 'UNPUBLISH') lines.push([ms, evLine('U', id, ms, 'f')]);
      else if (e.type === 'DOMAIN_UPDATED') lines.push([ms, evLine('D', id, ms, 'f')]);
    }));
  }
  const first = lines.length ? monthOf(Math.min(...lines.map((l) => l[0]))) : monthOf(Date.now());
  // Written in slices, so one request never grows past what the database accepts in one go.
  for (let i = 0; i < lines.length; i += 1500) await redis(...evCmds(lines.slice(i, i + 1500)));
  await redis(['SET', SINCE, first], ['SET', SEEDED, new Date().toISOString()]);
  return true;
}

/** Every event from the first month there is one, up to now. One command per month. */
export async function readEvents() {
  const [since] = await redis(['GET', SINCE]);
  const now = new Date();
  const start = since && /^\d{4}-\d{2}$/.test(since) ? since : monthOf(now.getTime());
  const months = [];
  const d = new Date(start + '-01T00:00:00Z');
  while (months.length < 120 && d.toISOString().slice(0, 7) <= monthOf(now.getTime())) { months.push(d.toISOString().slice(0, 7)); d.setUTCMonth(d.getUTCMonth() + 1); }
  const got = await redis(...months.map((m) => ['LRANGE', EV_KEY(m), 0, -1]));
  const events = [];
  got.forEach((list) => (list || []).forEach((l) => { const e = parseEv(l); if (e) events.push(e); }));
  return { since: Date.parse(start + '-01T00:00:00Z'), events };
}

/**
 * The same change can arrive twice (the webhook and the old feed; the webhook and a pull of the list).
 * Duplicates are dropped, and every "published" is settled as a launch, a re-publish or a comeback.
 *
 * firstPub: site id → when Duda says it was first published (ms), for the events whose kind isn't known.
 */
export function settleEvents(raw, firstPub) {
  const fam = (t) => (t === 'U' ? 'off' : t === 'D' ? 'dom' : 'on');
  const sorted = raw.slice().sort((a, b) => a.at - b.at);
  const exact = sorted.filter((e) => e.src !== 's');
  // 1. the same website, the same kind of change, within ten minutes: one change. The webhook's own
  //    flags (L/R/B) beat a plain P from the old feed.
  const kept = [];
  exact.forEach((e) => {
    const twin = kept.find((k) => k.s === e.s && fam(k.t) === fam(e.t) && Math.abs(k.at - e.at) < 10 * 60000);
    if (!twin) kept.push(Object.assign({}, e));
    else if (twin.t === 'P' && e.t !== 'P') Object.assign(twin, e);
  });
  // 2. a change spotted between two pulls of the list only counts when nothing exact explains it
  sorted.filter((e) => e.src === 's').forEach((e) => {
    const from = parseInt(e.x, 36) * 1000 || e.at - 7 * 3600000;
    const explained = kept.some((k) => k.s === e.s && fam(k.t) === fam(e.t) && k.at >= from - 60000 && k.at <= e.at + 60000);
    if (!explained) kept.push(Object.assign({}, e, { from }));
  });
  kept.sort((a, b) => a.at - b.at);
  // 3. what each unknown "published" really was
  const last = {};
  kept.forEach((e) => {
    if (e.t === 'P') {
      const prev = last[e.s];
      const first = firstPub[e.s] || 0;
      const nearFirst = first && Math.abs(e.at - first) < 36 * 3600000;
      if (prev === 'off') e.t = 'B';
      else if (e.src === 's') e.t = nearFirst || (first && first >= (e.from || e.at) - 36 * 3600000) ? 'L' : 'B';
      else e.t = nearFirst && !prev ? 'L' : 'R';
    }
    if (e.t !== 'D') last[e.s] = fam(e.t);
  });
  return kept;
}
