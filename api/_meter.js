// What every action costs: database calls, Duda API calls, pages read, AI requests and tokens, web
// searches, Google lookups, Ably, Slack and email. Counted as the app runs, so the owner can see the
// average cost of each action, per website and per audit, and what is left against each limit.
//
// How it works:
//  - Each API request runs inside a "meter" (AsyncLocalStorage), named after the endpoint and its op.
//  - Every outgoing call (fetch) is counted by where it goes; the database counts its own commands;
//    the AI layer adds tokens. A long job (the auto audit) switches the meter to the website it is on,
//    so a website's share is known.
//  - Counts are added up in memory and written in one go: right after a notable action, otherwise every
//    20 seconds or so. A server instance that stops early loses at most a few seconds of counts.
//
// Nothing here may ever break the work it measures: every step is wrapped, and the meter's own writes
// are not counted.
import { AsyncLocalStorage } from 'node:async_hooks';

const als = new AsyncLocalStorage();
const env = (k) => String(process.env[k] || '');

// ---------- where an outgoing call goes ----------
const hostOf = (u) => { try { return new URL(u).host.toLowerCase(); } catch (e) { return ''; } };
function kindOf(url) {
  const u = String(url || ''); const h = hostOf(u);
  // Configured addresses first, the longest that fits winning (tests and proxies can share one host).
  const CONF = [['db', 'KV_REST_API_URL'], ['db', 'SUPABASE_URL'], ['duda', 'DUDA_API_BASE'], ['places', 'GOOGLE_PLACES_API_BASE'], ['ai', 'ANTHROPIC_API_BASE'], ['ai', 'OPENAI_API_BASE'], ['sql', 'LEADS_DB_URL']];
  let best = ''; let bestLen = 0;
  CONF.forEach(([kind, k]) => { const b = env(k).replace(/\/+$/, ''); if (b && u.startsWith(b) && b.length > bestLen) { best = kind; bestLen = b.length; } });
  if (best) return best;
  // A configured address counts when the call is under it (same host AND path), so two services on one host stay apart.
  const base = (k) => { const b = env(k).replace(/\/+$/, ''); return !!b && hostOf(b) === h && u.startsWith(b); };
  if (/upstash\.io$/.test(h) || /\.supabase\.co$/.test(h) || base('KV_REST_API_URL') || base('SUPABASE_URL') || /\/rest\/v1\/rpc\/dsa_exec|\/pipeline$/.test(u)) return 'db';
  if (/(^|\.)duda\.co$/.test(h) || base('DUDA_API_BASE')) return 'duda';
  if (/places\.googleapis\.com$|maps\.googleapis\.com$/.test(h) || base('GOOGLE_PLACES_API_BASE')) return 'places';
  if (/anthropic\.com$|openai\.com$|groq\.com$|cerebras\.ai$|mistral\.ai$|openrouter\.ai$|generativelanguage\.googleapis\.com$|ai-gateway\.vercel\.sh$/.test(h) || /\/ai\/(v1|run|models)/.test(u) || base('ANTHROPIC_API_BASE') || base('OPENAI_API_BASE')) return 'ai';
  if (/youtube\.googleapis\.com$/.test(h) || /googleapis\.com\/youtube/.test(u)) return 'youtube';
  if (/pagespeedonline|googleapis\.com\/pagespeedonline/.test(u)) return 'pagespeed';
  if (/slack\.com$/.test(h)) return 'slack';
  if (/resend\.com$/.test(h)) return 'email';
  if (/ably\.(io|com)$|ably-realtime\.com$/.test(h)) return 'ably';
  if (/turso\.io$/.test(h) || base('LEADS_DB_URL')) return 'sql';
  if (/dropbox(api)?\.com$/.test(h)) return 'dropbox';
  if (/googleapis\.com$|google\.com$/.test(h)) return 'google';
  return 'web';
}

// ---------- the running totals ----------
let buf = new Map();          // field → number, for the day hash
let siteBuf = new Map();      // field → number, for the month-by-website hash
let logBuf = [];              // notable runs, newest last
let lastFlush = Date.now();
let flushing = null;
const add = (map, k, n) => map.set(k, (map.get(k) || 0) + n);
const SEP = '\t';
const ACTIVE = () => !process.env.METER_OFF;

/** Count something for the action that is running now (and its website, if it has one). */
export function bump(metric, n = 1) {
  if (!ACTIVE() || !n) return;
  try {
    const c = als.getStore();
    if (!c) { add(buf, 'background' + SEP + metric, n); return; }
    c.m[metric] = (c.m[metric] || 0) + n;
    if (c.site) { const s = c.sites[c.site] || (c.sites[c.site] = {}); s[metric] = (s[metric] || 0) + n; }
  } catch (e) { /* never in the way */ }
}
/** What the running action has used so far (for a reply that wants to show its own cost). */
export const used = () => { const c = als.getStore(); return c ? Object.assign({}, c.m) : {}; };
/** Run fn with its counts attributed to one website (the auto audit, a scan, a form submission). */
export function forSite(site, fn) {
  const c = als.getStore();
  if (!c || !site) return fn();
  return als.run(Object.assign({}, c, { site: String(site).slice(0, 60) }), fn);
}
/** A loop that works through websites one after another: what follows counts against this one ('' to stop). */
export function onSite(site) { const c = als.getStore(); if (c) c.site = site ? String(site).slice(0, 60) : ''; }
/** Name the website (or audit) the whole request is about, once it is known. */
export function setSite(site) { const c = als.getStore(); if (c && site && !c.site) c.site = String(site).slice(0, 60); }
/** Rename the action once its real name is known (e.g. a webhook's event type). */
export function setAction(name) { const c = als.getStore(); if (c && name) c.action = String(name).slice(0, 60); }
/** AI usage, by provider and model, with web searches when the model searched. */
export function aiUsage(provider, model, inTok, outTok, searches) {
  const key = `${provider}:${String(model || '').slice(0, 60)}`;
  bump('ai_req:' + key, 1);
  if (inTok) bump('ai_in:' + key, inTok);
  if (outTok) bump('ai_out:' + key, outTok);
  if (searches) bump('websearch:' + provider, searches);
}

// ---------- counting outgoing calls ----------
const origFetch = globalThis.fetch;
if (origFetch && !globalThis.__dsaMeterFetch) {
  globalThis.__dsaMeterFetch = true;
  globalThis.fetch = async function meteredFetch(input, init) {
    const url = typeof input === 'string' ? input : input && input.url;
    const kind = kindOf(url);
    if (kind !== 'db' || !globalThis.__dsaMeterQuiet) bump('call:' + kind, 1);
    const r = await origFetch(input, init);
    try { if (r && r.status === 429) bump('slow:' + kind, 1); } catch (e) { /* ignore */ }
    return r;
  };
}

// ---------- running an action ----------
/**
 * Wrap an API handler: everything it does is counted under its name ("store.patchFinding",
 * "watch.cron", "dudahook"…). `site` picks the website or audit it is about from the request.
 */
export function metered(file, handler, flushFn) {
  return async function (req, res) {
    if (!ACTIVE()) return handler(req, res);
    let op = '';
    try { op = (req.query && req.query.op) || (req.body && typeof req.body === 'object' && req.body.op) || ''; } catch (e) { /* ignore */ }
    const c = { action: file + '.' + (op ? String(op).slice(0, 30) : String(req.method || 'get').toLowerCase()), m: {}, sites: {}, site: '', t0: Date.now(), who: '' };
    try {
      const q = req.query || {}; const b = (req.body && typeof req.body === 'object') ? req.body : {};
      const hs = req.headers && req.headers['x-dsa-site'];
      const s = (hs && /^[A-Za-z0-9_-]{2,60}$/.test(String(hs))) ? hs
        : b.siteId || q.siteId || (['site', 'store', 'watch', 'sitehealth', 'leads', 'capture', 'social', 'dudasites'].includes(file) ? (b.id || q.id || '') : '');
      if (s && /^[A-Za-z0-9_-]{2,60}$/.test(String(s))) c.site = String(s);
    } catch (e) { /* ignore */ }
    return als.run(c, async () => {
      try { return await handler(req, res); }
      finally {
        try { record(c, res); if (flushFn) await maybeFlush(flushFn, c); } catch (e) { /* never in the way */ }
      }
    });
  };
}
/** The same, for work started outside a request (a test, a script). */
export function runAs(action, fn) { const c = { action, m: {}, sites: {}, site: '', t0: Date.now() }; return als.run(c, fn).finally(() => record(c)); }

const NOTABLE = /^(call:(duda|ai|places|youtube|slack|email|web|pagespeed|google|dropbox)|websearch|ai_req)/;
function record(c, res) {
  const ms = Date.now() - c.t0;
  const a = c.action;
  add(buf, a + SEP + 'runs', 1);
  add(buf, a + SEP + 'ms', ms);
  if (res && res.statusCode >= 500) add(buf, a + SEP + 'errors', 1);
  Object.entries(c.m).forEach(([k, v]) => add(buf, a + SEP + k, v));
  // By website: what was counted while the action was on that website, or all of it for a one-website request.
  const sites = Object.keys(c.sites).length ? c.sites : c.site ? { [c.site]: c.m } : {};
  Object.entries(sites).forEach(([site, m]) => {
    add(siteBuf, site + SEP + a + SEP + 'runs', 1);
    Object.entries(m).forEach(([k, v]) => add(siteBuf, site + SEP + a + SEP + k, v));
  });
  if (ms > 1500 || Object.keys(c.m).some((k) => NOTABLE.test(k))) {
    logBuf.push({ at: c.t0, a, ms, site: c.site || Object.keys(c.sites).slice(0, 3).join(','), m: c.m, sites: Object.keys(c.sites).length || undefined });
    if (logBuf.length > 60) logBuf = logBuf.slice(-60);
  }
}
async function maybeFlush(flushFn, c) {
  const notable = Object.keys(c.m).some((k) => NOTABLE.test(k)) || Date.now() - c.t0 > 1500;
  if (!notable && Date.now() - lastFlush < 20000 && buf.size < 400) return;
  await flushNow(flushFn);
}
/** Write what has been counted. flushFn(cmds) runs uncounted database commands. */
export async function flushNow(flushFn) {
  if (flushing) return flushing;
  if (!buf.size && !siteBuf.size && !logBuf.length) return;
  const b = buf, sb = siteBuf, lb = logBuf; buf = new Map(); siteBuf = new Map(); logBuf = []; lastFlush = Date.now();
  const day = new Date().toISOString().slice(0, 10); const month = day.slice(0, 7);
  const P = process.env.STORE_PREFIX || 'dsa:';
  const cmds = [];
  b.forEach((v, k) => cmds.push(['HINCRBY', P + 'meter:d:' + day, k, String(Math.round(v))]));
  if (b.size) cmds.push(['EXPIRE', P + 'meter:d:' + day, String(120 * 86400)]);
  sb.forEach((v, k) => cmds.push(['HINCRBY', P + 'meter:s:' + month, k, String(Math.round(v))]));
  if (sb.size) cmds.push(['EXPIRE', P + 'meter:s:' + month, String(400 * 86400)]);
  if (lb.length) cmds.push(['LPUSH', P + 'meter:log', ...lb.map((x) => JSON.stringify(x))], ['LTRIM', P + 'meter:log', '0', '299']);
  flushing = (async () => {
    globalThis.__dsaMeterQuiet = true;
    try { for (let i = 0; i < cmds.length; i += 300) await flushFn(cmds.slice(i, i + 300)); }
    catch (e) { /* put them back for next time */ console.warn('[meter] could not write the counts:', String(e.message || e).slice(0, 200)); b.forEach((v, k) => add(buf, k, v)); sb.forEach((v, k) => add(siteBuf, k, v)); }
    finally { globalThis.__dsaMeterQuiet = false; flushing = null; }
  })();
  return flushing;
}
export const _test = { kindOf, peek: () => ({ buf: Object.fromEntries(buf), siteBuf: Object.fromEntries(siteBuf), log: logBuf.slice() }) };
