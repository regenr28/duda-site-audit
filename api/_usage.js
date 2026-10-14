// The Usage & activity report (owner only, on System health): what every action costs, per website and
// per audit, what is left against each limit, and every pause or cooldown running right now.
// The counting itself is in _meter.js; this only reads it back and adds it up.
import { redisRaw, P, jparse, unpackJSON, dbKind, kvCapped, KV_CEILING, KV_MONTHLY_COMMANDS, fetchWithTimeout } from './_lib.js';
import { watchLive } from './_watch.js';
import { queueState } from './_queue.js';
import { _test as ai } from './ai.js';

const SEP = '\t';
const DAY = 86400000;
const num = (v) => Number(v) || 0;
const envN = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? Number(process.env[k]) : d);

/** Prices per million tokens (in, out) by model, for an estimate. AI_PRICES (JSON) adds or overrides: {"model-prefix":[in,out]}. */
const PRICES = [
  [/claude-haiku-5/i, 0.10, 0.50], [/claude-haiku-4/i, 1, 5], [/claude-3-5-haiku|claude-haiku-3/i, 0.80, 4],
  [/claude-sonnet/i, 3, 15], [/claude-opus/i, 5, 25],
  [/gpt-5(\.\d+)?-mini/i, 0.25, 2], [/gpt-5(\.\d+)?-nano/i, 0.05, 0.40], [/gpt-4\.1-mini/i, 0.40, 1.60], [/gpt-4o-mini/i, 0.15, 0.60],
];
function priceOf(provider, model) {
  try {
    const extra = JSON.parse(process.env.AI_PRICES || '{}');
    for (const [k, v] of Object.entries(extra)) if (String(model).toLowerCase().startsWith(k.toLowerCase()) && Array.isArray(v)) return v.map(Number);
  } catch (e) { /* ignore */ }
  for (const [re, i, o] of PRICES) if (re.test(model)) return [i, o];
  // The free tiers cost nothing; an unknown paid model is shown without a price rather than guessed.
  if (/^(groq|cerebras|mistral|cloudflare|gemini|openrouter)$/.test(provider)) return [0, 0];
  return null;
}
const WEBSEARCH_PER_1000 = envN('WEBSEARCH_PRICE_PER_1000', 10);

/** Add one action's metrics into a running total. */
function into(t, metric, v) {
  t[metric] = (t[metric] || 0) + v;
  const m = /^ai_(in|out|req):([^:]+):(.*)$/.exec(metric);
  if (m) {
    const [, kind, provider, model] = m;
    const k = provider + ':' + model;
    const a = (t._ai || (t._ai = {}))[k] || (t._ai[k] = { provider, model, req: 0, in: 0, out: 0 });
    a[kind] += v;
  }
}
/** Estimated cost of a set of metrics, in dollars, and whether every part of it had a known price. */
function costOf(t) {
  let usd = 0; let known = true;
  Object.values(t._ai || {}).forEach((a) => { const p = priceOf(a.provider, a.model); if (!p) { known = false; return; } usd += (a.in * p[0] + a.out * p[1]) / 1e6; });
  Object.entries(t).forEach(([k, v]) => { if (/^websearch:/.test(k)) usd += (v * WEBSEARCH_PER_1000) / 1000; });
  return { usd: Math.round(usd * 10000) / 10000, known };
}
/** The handful of numbers shown for any row: database, Duda, pages, AI, searches, Google, messages. */
function summary(t) {
  const sum = (re) => Object.entries(t).filter(([k]) => re.test(k)).reduce((a, [, v]) => a + v, 0);
  return {
    runs: t.runs || 0, ms: t.ms || 0, errors: t.errors || 0,
    db: t.db || 0, dbCalls: t['call:db'] || 0, duda: t['call:duda'] || 0, dudaSlow: t['slow:duda'] || 0, pages: t['call:web'] || 0,
    aiReq: sum(/^ai_req:/), aiIn: sum(/^ai_in:/), aiOut: sum(/^ai_out:/), aiCalls: t['call:ai'] || 0,
    searches: sum(/^websearch:/), places: t['call:places'] || 0, youtube: t['call:youtube'] || 0,
    ably: t['call:ably'] || 0, slack: t['call:slack'] || 0, email: t['call:email'] || 0, google: (t['call:google'] || 0) + (t['call:pagespeed'] || 0),
    cost: costOf(t),
  };
}

let ablyMemo = { at: 0, val: null };
/** Ably's own figures for the month (messages, peak connections), asked at most every 10 minutes. */
async function ablyStats() {
  const key = String(process.env.ABLY_API_KEY || '');
  if (!key.includes(':')) return null;
  if (ablyMemo.val && Date.now() - ablyMemo.at < 600000) return ablyMemo.val;
  try {
    const r = await fetchWithTimeout('https://rest.ably.io/stats?unit=month&limit=1&direction=backwards', { headers: { Authorization: 'Basic ' + Buffer.from(key).toString('base64') } }, 8000);
    const j = await r.json().catch(() => null);
    const s = Array.isArray(j) ? j[0] || {} : {};
    const all = (s.all && s.all.all) || (s.all && s.all.messages) || {};
    const val = r.ok ? { messages: num(all.count), connections: num(s.connections && s.connections.all && s.connections.all.peak), channels: num(s.channels && s.channels.peak), month: s.intervalId || '' } : { error: `Ably answered ${r.status}` };
    ablyMemo = { at: Date.now(), val }; return val;
  } catch (e) { return { error: 'Ably could not be reached' }; }
}

/** Everything resting, waiting or cooling down right now, each with when it ends. */
async function restingNow() {
  const now = Date.now(); const out = [];
  const [cwlock, cwlockT, cwsweepT, domsweepT, leadLockT, backoff] = await redisRaw(
    ['GET', P + 'cwlock'], ['PTTL', P + 'cwlock'], ['PTTL', P + 'cwsweep'], ['PTTL', P + 'domsweep'], ['PTTL', P + 'leadq:lock'], ['GET', P + 'cwbackoff']);
  const live = await watchLive().catch(() => ({}));
  if (live.paused) out.push({ what: 'Auto audit', state: 'paused', why: `Paused by ${live.paused.by || 'an admin'}`, until: 0 });
  if (live.wait && live.wait.until > now) out.push({ what: 'Auto audit', state: 'resting', why: live.wait.why || 'Asked to slow down', until: live.wait.until, note: num(backoff) ? `Wait number ${num(backoff)} in a row: each one is longer (5, 10, 20, 40, then 60 minutes).` : '' });
  else if (cwlock) out.push({ what: 'Auto audit', state: 'running', why: `Reading websites (started by ${cwlock})`, until: num(cwlockT) > 0 ? now + num(cwlockT) : 0 });
  if (num(cwsweepT) > 0) out.push({ what: 'Auto audit: daily run', state: 'done for today', why: 'Runs once a day; the next can start after this', until: now + num(cwsweepT) });
  if (num(domsweepT) > 0) out.push({ what: 'Domain check: daily run', state: 'done for today', why: 'Runs once a day; the next can start after this', until: now + num(domsweepT) });
  if (num(leadLockT) > 0) out.push({ what: 'Form submissions: fetching history', state: 'running', why: 'One batch at a time, paced for Duda (no more than 300 calls a minute)', until: now + num(leadLockT) });
  const q = await queueState().catch(() => null);
  if (q && q.pending) out.push({ what: 'Form submissions: websites waiting', state: 'queued', why: `${q.pending} website${q.pending === 1 ? '' : 's'} still to fetch`, until: 0 });
  // AI services resting (busy, at their daily cap, or out of credits)
  try {
    const st = await ai.loadStatus(await ai.applySavedModels(ai.providers()), true);
    st.filter((x) => !x.ready).forEach((x) => out.push({ what: `AI: ${x.label}`, state: x.state === 'limit' ? 'at its daily cap' : x.state === 'credits' ? 'out of credits' : 'resting', why: x.note || '', until: x.until || 0 }));
  } catch (e) { /* no AI set up */ }
  // Alerts to the owner sent recently and holding back repeats
  try {
    let cur = '0'; const keys = [];
    do { const [[next, ks]] = await redisRaw(['SCAN', cur, 'MATCH', P + 'alerted:*', 'COUNT', 500]); (ks || []).forEach((k) => keys.push(k)); cur = String(next); } while (cur !== '0' && keys.length < 50);
    if (keys.length) {
      const ttls = await redisRaw(...keys.map((k) => ['PTTL', k]));
      keys.forEach((k, i) => { if (num(ttls[i]) > 0) out.push({ what: 'Alert to the owner: ' + k.slice((P + 'alerted:').length), state: 'cooling down', why: 'Sent once; the same alert is held back until this ends', until: now + num(ttls[i]) }); });
    }
  } catch (e) { /* ignore */ }
  return out;
}

export async function usageReport({ days = 30 } = {}) {
  const today = new Date();
  const dayKeys = Array.from({ length: days }, (_, i) => new Date(today.getTime() - i * DAY).toISOString().slice(0, 10));
  const month = today.toISOString().slice(0, 7);
  const rows = await redisRaw(...dayKeys.map((d) => ['HGETALL', P + 'meter:d:' + d]),
    ['HGETALL', P + 'meter:s:' + month], ['LRANGE', P + 'meter:log', 0, 99], ['HGETALL', P + 'index'], ['GET', P + 'dudasites'], ['GET', P + 'usage:cmd:' + month]);
  const [siteRaw, logRaw, idxRaw, listRaw, cmdRaw] = rows.slice(days);
  const pairs = (raw) => { const o = []; for (let i = 0; raw && i < raw.length; i += 2) o.push([raw[i], num(raw[i + 1])]); return o; };

  // By action: today, the last 7 days, this month (calendar), and the whole window.
  const byAction = {}; const totals = { today: {}, week: {}, month: {} }; const perDay = [];
  dayKeys.forEach((d, i) => {
    const dayT = {};
    pairs(rows[i]).forEach(([f, v]) => {
      const [a, metric] = f.split(SEP); if (!metric) return;
      const t = byAction[a] || (byAction[a] = { all: {}, today: {}, month: {} });
      into(t.all, metric, v); into(dayT, metric, v);
      if (i === 0) { into(t.today, metric, v); into(totals.today, metric, v); }
      if (i < 7) into(totals.week, metric, v);
      if (d.slice(0, 7) === month) { into(t.month, metric, v); into(totals.month, metric, v); }
    });
    perDay.push({ day: d, ...summary(dayT) });
  });
  const actions = Object.entries(byAction).map(([a, t]) => {
    const all = summary(t.all);
    const per = (k) => (all.runs ? Math.round((all[k] / all.runs) * 10) / 10 : 0);
    return { action: a, today: summary(t.today), month: summary(t.month), all,
      avg: { ms: per('ms'), db: per('db'), duda: per('duda'), pages: per('pages'), aiReq: per('aiReq'), aiIn: per('aiIn'), aiOut: per('aiOut'), searches: per('searches'), places: per('places'), ably: per('ably'), cost: all.runs ? Math.round((all.cost.usd / all.runs) * 1e6) / 1e6 : 0 } };
  }).sort((x, y) => y.all.runs - x.all.runs);

  // By website (this month): audits are known by their audit id, live websites by their Duda id; both are
  // shown as one website.
  const idx = {}; for (let i = 0; idxRaw && i < idxRaw.length; i += 2) { const v = jparse(idxRaw[i + 1]); if (v) idx[idxRaw[i]] = v; }
  const names = {}; const list = unpackJSON(listRaw); ((list && list.sites) || []).forEach((x) => { names[String(x.id)] = x.name || x.domain || ''; });
  const sites = {};
  pairs(siteRaw).forEach(([f, v]) => {
    const [sid, a, metric] = f.split(SEP); if (!metric) return;
    const rec = idx[sid]; const duda = rec ? String(rec.siteId || sid) : sid;
    const s = sites[duda] || (sites[duda] = { id: duda, audit: rec ? sid : (Object.entries(idx).find(([, x]) => String(x.siteId) === duda) || [])[0] || '', name: (rec && rec.businessName) || names[duda] || '', total: {}, by: {} });
    into(s.total, metric, v);
    into(s.by[a] || (s.by[a] = {}), metric, v);
  });
  const siteList = Object.values(sites).map((s) => ({ id: s.id, audit: s.audit, name: s.name || s.id, total: summary(s.total), by: Object.fromEntries(Object.entries(s.by).map(([a, t]) => [a, summary(t)])) }))
    .sort((x, y) => (y.total.cost.usd - x.total.cost.usd) || (y.total.db - x.total.db)).slice(0, 300);

  // Limits: what is used and what is left.
  const m = summary(totals.month); const d = summary(totals.today);
  const aiStatus = await ai.loadStatus(await ai.applySavedModels(ai.providers()), true).catch(() => []);
  const limits = [];
  const db = dbKind();
  limits.push({ key: 'db', label: db === 'supabase' ? 'Database requests (Supabase)' : 'Database commands (Upstash)', used: num(cmdRaw) || m.db, limit: kvCapped() ? KV_CEILING : 0, period: 'month',
    note: kvCapped() ? `The first ${KV_MONTHLY_COMMANDS.toLocaleString()} are free; the app pauses itself at its cap.` : 'No charge per request: watched for speed, not cost.' });
  limits.push({ key: 'duda', label: 'Duda API calls', used: m.duda, limit: 0, period: 'month', note: `Today ${d.duda.toLocaleString()}${m.dudaSlow ? ` · Duda asked to slow down ${m.dudaSlow} time${m.dudaSlow === 1 ? '' : 's'} this month` : ''}. Form submissions are paced to stay under Duda's 300 a minute.` });
  aiStatus.forEach((x) => limits.push({ key: 'ai:' + x.id, label: `AI: ${x.label} (${x.model})`, used: x.used, limit: x.limit, period: 'day', resetsAt: x.resetsAt, state: x.state, note: x.note || '' }));
  const placesFree = envN('GOOGLE_PLACES_FREE_MONTHLY', 1000);
  limits.push({ key: 'places', label: 'Google Places lookups (GBP)', used: m.places, limit: placesFree, period: 'month', note: process.env.GOOGLE_MAPS_API_KEY ? `About ${placesFree.toLocaleString()} a month are free; beyond that Google charges per lookup.` : 'Not connected yet: add GOOGLE_MAPS_API_KEY.' });
  limits.push({ key: 'search', label: 'AI web searches', used: m.searches, limit: 0, period: 'month', note: `About $${WEBSEARCH_PER_1000} per 1,000 searches, plus the AI's tokens.` });
  const ably = await ablyStats();
  limits.push({ key: 'ably', label: 'Ably live updates: messages', used: ably && !ably.error ? ably.messages : m.ably, limit: envN('ABLY_MONTHLY_MESSAGES', 6000000), period: 'month',
    note: ably && ably.error ? `${ably.error}; showing the app's own count of messages it sent.` : ably ? `Peak connections ${ably.connections.toLocaleString()} of ${envN('ABLY_MAX_CONNECTIONS', 200).toLocaleString()} · peak channels ${ably.channels.toLocaleString()}. Figures from Ably.` : 'Not connected.' });
  limits.push({ key: 'email', label: 'Emails sent', used: m.email, limit: envN('EMAIL_MONTHLY_LIMIT', 3000), period: 'month', note: `Today ${d.email} of ${envN('EMAIL_DAILY_LIMIT', 100)} a day.` });
  limits.push({ key: 'slack', label: 'Slack messages', used: m.slack, limit: 0, period: 'month', note: 'Slack allows about one message a second per channel.' });

  const nameOf = (id) => { const first = String(id || '').split(',')[0]; const rec = idx[first]; return (rec && rec.businessName) || names[first] || ''; };
  const log = (logRaw || []).map((x) => jparse(x)).filter(Boolean).map((x) => Object.assign(summary(x.m || {}), { at: x.at, action: x.a, ms: x.ms, site: x.site || '', siteName: nameOf(x.site), sites: x.sites || 0 }));
  return { at: Date.now(), month, days, totals: { today: d, week: summary(totals.week), month: m }, perDay: perDay.reverse(), actions, sites: siteList, limits, resting: await restingNow(), log, ably };
}
