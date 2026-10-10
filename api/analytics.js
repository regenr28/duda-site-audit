// Analytics for one website: Duda's own numbers, always there, plus any extra providers connected to
// that website (Google Analytics 4 and Google Search Console today; the PROVIDERS list is where a new
// one is added later).
//
// GET  /api/analytics?site=<duda id>&days=30|90|365[&fresh=1]  → everything the Analytics card draws
// POST /api/analytics { op:'connect', site, provider, value }      → connect a provider to this website
// POST /api/analytics { op:'disconnect', site, provider }          → remove it
//
// Answers are kept for 6 hours per website and range, so opening a profile again costs one database
// read and no calls to Duda or Google. Google is reached with one service account for the whole app
// (GOOGLE_SERVICE_ACCOUNT); each website only stores which property / Search Console site is its own.
import crypto from 'node:crypto';
import { redis, P, requireUser, readBody, jparse, can, fetchWithTimeout, globalLog } from './_lib.js';

const DUDA = process.env.DUDA_API_BASE || 'https://api.duda.co/api';
const TTL = 6 * 3600;
const CFG = P + 'anprov';                     // hash: duda site id → { ga4: {property,…}, gsc: {siteUrl,…} }
// The "2" makes every answer cached before the reading was fixed get fetched again at once.
const cacheKey = (id, days) => P + `an2:${id}:${days}`;
const okId = (id) => /^[A-Za-z0-9_-]{4,64}$/.test(String(id || ''));

export const PROVIDERS = {
  ga4: { label: 'Google Analytics 4', field: 'property', hint: 'The GA4 property ID: numbers only, e.g. 312345678 (Admin → Property settings).',
    clean: (v) => { const m = String(v || '').trim().replace(/^properties\//, ''); return /^\d{5,14}$/.test(m) ? m : null; } },
  gsc: { label: 'Google Search Console', field: 'siteUrl', hint: 'The property as Search Console shows it: sc-domain:example.com, or the full https:// address.',
    clean: (v) => { const s = String(v || '').trim(); if (/^sc-domain:[a-z0-9.-]+\.[a-z]{2,}$/i.test(s)) return s.toLowerCase(); try { const u = new URL(s); return /^https?:$/.test(u.protocol) ? u.origin + '/' : null; } catch (e) { return null; } } },
};

// ---------- dates ----------
const ymd = (d) => d.toISOString().slice(0, 10);
function ranges(days) {
  const to = new Date(); to.setUTCHours(0, 0, 0, 0);
  const from = new Date(to.getTime() - (days - 1) * 86400000);
  const pTo = new Date(from.getTime() - 86400000);
  const pFrom = new Date(pTo.getTime() - (days - 1) * 86400000);
  const yFrom = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 11, 1));
  return { from: ymd(from), to: ymd(to), pFrom: ymd(pFrom), pTo: ymd(pTo), yFrom: ymd(yFrom) };
}

// ---------- Duda ----------
async function duda(path) {
  const user = process.env.DUDA_API_USERNAME, pass = process.env.DUDA_API_PASSWORD;
  if (!user || !pass) throw new Error('The Duda connection is not set up yet.');
  const r = await fetchWithTimeout(DUDA + path, { headers: { Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'), Accept: 'application/json' } }, 15000);
  const text = await r.text();
  if (!r.ok) { const e = new Error(`Duda ${r.status}: ${text.slice(0, 160)}`); e.status = r.status; throw e; }
  return text ? JSON.parse(text) : null;
}
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
// Duda puts the numbers at the top of a plain answer ({"VISITS":100,…}) but under "data" in every
// row of a broken-down one ([{"data":{"VISITS":100,…},"dimension":{"country":"US"}}]).
const vals = (r) => (r && r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? r.data : r) || {};
const T = (r) => { const x = vals(r); return { visits: num(x.VISITS ?? x.visits), visitors: num(x.VISITORS ?? x.visitors), views: num(x.PAGE_VIEWS ?? x.page_views ?? x.pageViews) }; };
const A = (r) => { const x = vals(r); return { calls: num(x.CLICK_TO_CALLS), maps: num(x.CLICK_TO_MAPS), emails: num(x.CLICK_TO_EMAILS), forms: num(x.FORM_SUBMITS) }; };
const hasNums = (r) => { const x = vals(r); return x && typeof x === 'object' && ('VISITS' in x || 'VISITORS' in x || 'PAGE_VIEWS' in x || 'visits' in x); };
const DATE_RE = /^\d{4}-\d{2}(-\d{2})?/;
/** A date written anywhere on one row: a field, the dimension, a date range, or a timestamp. */
function dateIn(r, key) {
  const cands = [];
  const scan = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 2) return;
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'string' && DATE_RE.test(v)) cands.push([k, v.slice(0, 10)]);
      else if (typeof v === 'number' && v > 1e12 && v < 4e12 && /date|day|time|from|start|period/i.test(k)) cands.push([k, new Date(v).toISOString().slice(0, 10)]);
      else if (typeof v === 'number' && v > 1e9 && v < 4e9 && /date|day|time|from|start|period/i.test(k)) cands.push([k, new Date(v * 1000).toISOString().slice(0, 10)]);
      else if (v && typeof v === 'object' && k !== 'data') scan(v, depth + 1);
    }
  };
  scan(r, 0);
  // Prefer the start of a period over its end.
  const pick = cands.find(([k]) => /from|start|date|day|period/i.test(k) && !/to$|end/i.test(k)) || cands[0];
  if (pick) return pick[1];
  return key && DATE_RE.test(key) ? key.slice(0, 10) : '';
}
/**
 * Day-by-day (or month-by-month) rows from a dated answer. Duda's documentation lists the
 * dateGranularity values but shows no example answer, so this reads any likely layout: a list of rows
 * that each carry a date, an object keyed by date, or either of those wrapped one level down.
 */
function dated(j) {
  const out = [];
  const take = (r, key) => { if (!hasNums(r)) return; const d = dateIn(r, key); if (d) out.push(Object.assign({ d }, T(r))); };
  const walk = (x, depth) => {
    if (!x || typeof x !== 'object' || depth > 3) return;
    if (Array.isArray(x)) { x.forEach((r) => take(r)); if (out.length || !x.length) return; x.forEach((r) => walk(r, depth + 1)); return; }
    const entries = Object.entries(x);
    if (entries.some(([k, r]) => DATE_RE.test(k) && hasNums(r))) { entries.forEach(([k, r]) => take(r, k)); return; }
    for (const [, v] of entries) { if (v && typeof v === 'object' && !out.length) walk(v, depth + 1); }
  };
  walk(j, 0);
  const m = new Map(); out.forEach((r) => { const c = m.get(r.d); if (c) { c.visits += r.visits; c.visitors += r.visitors; c.views += r.views; } else m.set(r.d, r); });
  return [...m.values()].sort((a, b) => a.d.localeCompare(b.d));
}
const total = (j) => (Array.isArray(j) ? j.reduce((s, r) => { const t = T(r); return { visits: s.visits + t.visits, visitors: s.visitors + t.visitors, views: s.views + t.views }; }, { visits: 0, visitors: 0, views: 0 }) : T(j));
const dimRows = (j, pick) => (Array.isArray(j) ? j : []).map((r) => ({ k: pick(r.dimension || {}), v: T(r).visits })).filter((r) => r.k).sort((a, b) => b.v - a.v);
/** What came back, cut short, for an admin and the server log when it could not be read. */
const sample = (x) => { try { return JSON.stringify(x).slice(0, 400); } catch (e) { return String(x).slice(0, 400); } };

export const _test = { dated, dimRows, T, total };

async function dudaAnalytics(id, days) {
  const R = ranges(days);
  const q = (p) => `/analytics/site/${encodeURIComponent(id)}?${p}`;
  const parts = await Promise.allSettled([
    duda(q(`from=${R.from}&to=${R.to}&result=traffic`)),
    duda(q(`from=${R.pFrom}&to=${R.pTo}&result=traffic`)),
    duda(q(`from=${R.from}&to=${R.to}&result=traffic&dateGranularity=DAYS`)),
    duda(q(`from=${R.yFrom}&to=${R.to}&result=traffic&dateGranularity=MONTHS`)),
    duda(q(`from=${R.from}&to=${R.to}&result=activities`)),
    duda(q(`from=${R.from}&to=${R.to}&result=traffic&dimension=system`)),
    duda(q(`from=${R.from}&to=${R.to}&result=traffic&dimension=geo`)),
  ]);
  const v = (i) => (parts[i].status === 'fulfilled' ? parts[i].value : null);
  if (parts[0].status === 'rejected' && parts[2].status === 'rejected') {
    const e = parts[0].reason || {};
    return { error: e.status === 404 ? 'Duda has no analytics for this website.' : 'Duda analytics could not be read right now.', detail: String(e.message || '').slice(0, 200) };
  }
  const daily = dated(v(2));
  const months = dated(v(3)).map((r) => Object.assign(r, { d: r.d.slice(0, 7) }));
  // When the totals have numbers but a breakdown can't be read, keep what Duda sent (cut short) so it
  // can be fixed from facts, not guesses: in the server log, and on screen for admins.
  const diag = {};
  const sum = (rows) => rows.reduce((n, r) => n + r.visits, 0);
  const tot = v(0) ? total(v(0)).visits : 0;
  [['daily', 2, daily], ['months', 3, months], ['systems', 5, null], ['countries', 6, null]].forEach(([k, i, rows]) => {
    const bad = parts[i].status === 'rejected' ? 'failed: ' + String((parts[i].reason || {}).message || '').slice(0, 200)
      : tot && rows && !sum(rows) ? 'unread: ' + sample(v(i))
      : tot && !rows && Array.isArray(v(i)) && v(i).length && !dimRows(v(i), () => 'x').some((r) => r.v) ? 'unread: ' + sample(v(i)) : '';
    if (bad) diag[k] = bad;
  });
  if (Object.keys(diag).length) console.warn('[analytics] Duda answer not fully read for', id, JSON.stringify(diag));
  // Duda breaks traffic down by operating system and browser ({"browser":"Chrome 10","os":"Windows"}).
  const osKey = (d) => d.os || d.OS || d.device || d.Device || d.platform || '';
  const brKey = (d) => String(d.browser || d.Browser || '').replace(/\s+[\d.]+$/, '');
  const geoKey = (d) => d.country || d.Country || '';
  const merge = (rows) => { const m = new Map(); rows.forEach((r) => m.set(r.k, (m.get(r.k) || 0) + r.v)); return [...m.entries()].map(([k, v2]) => ({ k: String(k).slice(0, 40), v: v2 })).sort((a, b) => b.v - a.v).slice(0, 8); };
  return {
    totals: v(0) ? total(v(0)) : daily.reduce((s, r) => ({ visits: s.visits + r.visits, visitors: s.visitors + r.visitors, views: s.views + r.views }), { visits: 0, visitors: 0, views: 0 }),
    prev: v(1) ? total(v(1)) : null,
    daily, months,
    acts: v(4) && !Array.isArray(v(4)) ? A(v(4)) : null,
    devices: merge(dimRows(v(5), osKey)),
    browsers: merge(dimRows(v(5), brKey)),
    countries: merge(dimRows(v(6), geoKey)),
    diag,
  };
}

// ---------- Google (one service account for the whole app) ----------
function serviceAccount() {
  let raw = process.env.GOOGLE_SERVICE_ACCOUNT || '';
  if (!raw) return null;
  if (!raw.trim().startsWith('{')) { try { raw = Buffer.from(raw, 'base64').toString('utf8'); } catch (e) { return null; } }
  const j = jparse(raw);
  return j && j.client_email && j.private_key ? j : null;
}
const b64u = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const TOKEN_URL = () => process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const SCOPES = 'https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly';
let tokenMem = null;
async function googleToken() {
  if (tokenMem && tokenMem.exp > Date.now() + 60000) return tokenMem.t;
  const sa = serviceAccount(); if (!sa) throw new Error('Google is not connected to the app yet.');
  const nowS = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ iss: sa.client_email, scope: SCOPES, aud: TOKEN_URL(), iat: nowS, exp: nowS + 3600 }));
  const sig = b64u(crypto.createSign('RSA-SHA256').update(`${head}.${body}`).sign(sa.private_key));
  const r = await fetchWithTimeout(TOKEN_URL(), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${body}.${sig}` }).toString() }, 10000);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('Google refused the app\'s sign-in.');
  tokenMem = { t: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return tokenMem.t;
}
async function gpost(url, payload) {
  const tok = await googleToken();
  const r = await fetchWithTimeout(url, { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, 15000);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(r.status === 403 || r.status === 401 ? 'no-access' : (j.error && j.error.message) || `Google ${r.status}`);
    e.status = r.status; throw e;
  }
  return j;
}
const mval = (row, i) => num(row && row.metricValues && row.metricValues[i] && row.metricValues[i].value);
const dval = (row, i) => String((row && row.dimensionValues && row.dimensionValues[i] && row.dimensionValues[i].value) || '');

async function ga4(property, days) {
  const R = ranges(days);
  const base = process.env.GA_DATA_BASE || 'https://analyticsdata.googleapis.com/v1beta';
  const M = [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'screenPageViews' }, { name: 'engagementRate' }];
  const j = await gpost(`${base}/properties/${property}:batchRunReports`, { requests: [
    { dateRanges: [{ startDate: R.from, endDate: R.to }], metrics: M },
    { dateRanges: [{ startDate: R.pFrom, endDate: R.pTo }], metrics: M },
    { dateRanges: [{ startDate: R.from, endDate: R.to }], dimensions: [{ name: 'date' }], metrics: [{ name: 'sessions' }, { name: 'totalUsers' }], orderBys: [{ dimension: { dimensionName: 'date' } }], limit: 400 },
    { dateRanges: [{ startDate: R.from, endDate: R.to }], dimensions: [{ name: 'pagePath' }], metrics: [{ name: 'screenPageViews' }], orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }], limit: 8 },
    { dateRanges: [{ startDate: R.from, endDate: R.to }], dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 8 },
  ] });
  const rep = j.reports || [];
  const tot = (r) => { const row = (r && r.rows || [])[0]; return { sessions: mval(row, 0), users: mval(row, 1), views: mval(row, 2), engagement: mval(row, 3) }; };
  return {
    totals: tot(rep[0]), prev: tot(rep[1]),
    daily: ((rep[2] || {}).rows || []).map((r) => { const d = dval(r, 0); return { d: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, sessions: mval(r, 0), users: mval(r, 1) }; }),
    pages: ((rep[3] || {}).rows || []).map((r) => ({ k: dval(r, 0).slice(0, 120), v: mval(r, 0) })),
    channels: ((rep[4] || {}).rows || []).map((r) => ({ k: dval(r, 0).slice(0, 60), v: mval(r, 0) })),
  };
}
async function gsc(siteUrl, days) {
  // Search Console runs about three days behind, so the range ends three days ago.
  const end = new Date(Date.now() - 3 * 86400000); const start = new Date(end.getTime() - (days - 1) * 86400000);
  const base = process.env.GSC_BASE || 'https://www.googleapis.com/webmasters/v3';
  const url = `${base}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const [byDate, byQuery] = await Promise.all([
    gpost(url, { startDate: ymd(start), endDate: ymd(end), dimensions: ['date'], rowLimit: 500 }),
    gpost(url, { startDate: ymd(start), endDate: ymd(end), dimensions: ['query'], rowLimit: 10 }),
  ]);
  const daily = (byDate.rows || []).map((r) => ({ d: String(r.keys[0]).slice(0, 10), clicks: num(r.clicks), impressions: num(r.impressions) }));
  const clicks = daily.reduce((s, r) => s + r.clicks, 0), impressions = daily.reduce((s, r) => s + r.impressions, 0);
  return {
    totals: { clicks, impressions, ctr: impressions ? clicks / impressions : 0, position: (byDate.rows || []).length ? (byDate.rows || []).reduce((s, r) => s + num(r.position) * num(r.impressions), 0) / (impressions || 1) : 0 },
    daily, queries: (byQuery.rows || []).map((r) => ({ k: String(r.keys[0]).slice(0, 120), clicks: num(r.clicks), impressions: num(r.impressions), position: num(r.position) })),
    to: ymd(end),
  };
}
const googleError = (e) => (e && e.message === 'no-access' ? 'no-access' : String((e && e.message) || 'failed').slice(0, 160));

async function readCfg(id) { const [raw] = await redis(['HGET', CFG, id]); return jparse(raw) || {}; }

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const me = await requireUser(req, res);
  if (!me) return;
  if (me.role === 'client') return res.status(404).json({ error: 'Not found' });
  const view = await can(me, 'analytics.view');
  const manage = await can(me, 'analytics.manage');
  if (!view && !manage) return res.status(403).json({ error: 'Your role does not include website analytics.' });
  const sa = serviceAccount();
  try {
    if (req.method === 'POST') {
      const b = readBody(req) || {};
      const id = String(b.site || '');
      if (!okId(id)) return res.status(400).json({ error: 'Unknown website' });
      if (!manage) return res.status(403).json({ error: 'Your role does not include connecting analytics.' });
      const prov = PROVIDERS[b.provider];
      if (!prov) return res.status(400).json({ error: 'Unknown analytics provider' });
      const cfg = await readCfg(id);
      if (b.op === 'disconnect') {
        delete cfg[b.provider];
      } else if (b.op === 'connect') {
        if (!sa) return res.status(400).json({ error: 'Google is not connected to the app yet. The app owner sets this up once (Help → Connecting Google for analytics).' });
        const value = prov.clean(b.value);
        if (!value) return res.status(400).json({ error: prov.hint });
        // Try it before saving, so a wrong ID or missing access is said now, not on every visit.
        try { if (b.provider === 'ga4') await ga4(value, 7); else await gsc(value, 7); }
        catch (e) {
          const why = googleError(e);
          return res.status(400).json({ error: why === 'no-access' ? `Google says the app can't read that ${b.provider === 'ga4' ? 'property' : 'Search Console site'}. Add ${sa.client_email} as a Viewer (GA4: Admin → Property access management; Search Console: Settings → Users and permissions), then try again.` : `Google answered: ${why}` });
        }
        cfg[b.provider] = { [prov.field]: value, by: me.email, byName: me.name, at: new Date().toISOString() };
      } else return res.status(400).json({ error: 'Unknown op' });
      const cmds = [Object.keys(cfg).length ? ['HSET', CFG, id, JSON.stringify(cfg)] : ['HDEL', CFG, id], ...[30, 90, 365].map((d) => ['DEL', cacheKey(id, d)])];
      await redis(...cmds);
      await globalLog(me, 'analytics', `${b.op === 'connect' ? 'connected' : 'removed'} ${prov.label} for website ${id}`).catch(() => {});
      return res.status(200).json({ ok: true, providers: cfg });
    }
    const id = String(req.query.site || '');
    if (!okId(id)) return res.status(400).json({ error: 'Unknown website' });
    const days = [30, 90, 365].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    const [cached, rawCfg] = await redis(['GET', cacheKey(id, days)], ['HGET', CFG, id]);
    const cfg = jparse(rawCfg) || {};
    let data = !req.query.fresh ? jparse(cached) : null;
    if (!data) {
      const [d, g, s] = await Promise.all([
        dudaAnalytics(id, days).catch((e) => ({ error: 'Duda analytics could not be read right now.', detail: String(e.message || '').slice(0, 200) })),
        cfg.ga4 && sa ? ga4(cfg.ga4.property, days).catch((e) => ({ error: googleError(e) })) : null,
        cfg.gsc && sa ? gsc(cfg.gsc.siteUrl, days).catch((e) => ({ error: googleError(e) })) : null,
      ]);
      data = { at: Date.now(), days, range: ranges(days), duda: d, ga4: g, gsc: s };
      // A failed read is kept only briefly, so it is tried again soon.
      const failed = (d && d.error) || (g && g.error) || (s && s.error);
      await redis(['SET', cacheKey(id, days), JSON.stringify(data), 'EX', failed ? 600 : TTL]);
    }
    if (data.duda && !manage) { delete data.duda.detail; delete data.duda.diag; }
    return res.status(200).json(Object.assign({}, data, {
      providers: cfg, manage,
      google: { ready: !!sa, email: manage && sa ? sa.client_email : '' },
      catalog: Object.fromEntries(Object.entries(PROVIDERS).map(([k, p]) => [k, { label: p.label, field: p.field, hint: p.hint }])),
    }));
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
