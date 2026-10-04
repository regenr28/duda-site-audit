// Form submissions: how they are stored, read and counted.
//
// This module is the ONLY place that touches lead storage. The team's endpoint and the client's
// endpoint both call it, each after doing its own authorisation — so there is one implementation of
// the data and two separate decisions about who may see it.
//
// Shape, and why:
//   lead:<siteId>:<YYYY-MM>   a LIST of compact rows, one RPUSH per submission.
//   leadpack:<siteId>:<YYYY-MM>  that month, packed and compressed, once the month is over.
//
// A list is appended atomically in one command, so two submissions landing in the same second can
// never overwrite each other — which a read-modify-write of a compressed blob would allow. Once a
// month is closed it is rewritten once as a single compressed blob: a month of one site's leads
// compresses about nine-fold, because the field names, service names and email domains repeat.
// Measured at ~36 bytes a lead packed, against ~325 raw.
import { redis, P, packJSON, unpackJSON, jparse, newId, sha } from './_lib.js';

export const monthOf = (iso) => String(iso || '').slice(0, 7) || new Date().toISOString().slice(0, 7);
const listKey = (site, m) => P + 'lead:' + site + ':' + m;
const packKey = (site, m) => P + 'leadpack:' + site + ':' + m;
const sumKey = (site) => P + 'leadsum:' + site;

/** Months from `since` (or 24 months back) up to now, newest first. */
export function monthsBack(n = 24) {
  const out = []; const d = new Date();
  for (let i = 0; i < n; i++) { out.push(d.toISOString().slice(0, 7)); d.setUTCMonth(d.getUTCMonth() - 1); }
  return out;
}

/**
 * One submission, normalised.
 *
 * Only what we actually use is kept. Duda's own envelope — widget ids, field types, the email
 * subject and sender — is dropped: it is most of the bytes and none of the value, and Duda keeps
 * the original anyway if anyone ever needs it back.
 */
export function normalise(raw, src) {
  const fields = {};
  let name = '', email = '', phone = '';
  (raw.fields || []).forEach((f) => {
    const label = String(f.label || '').trim().slice(0, 60);
    const value = String(f.value == null ? '' : f.value).trim().slice(0, 2000);
    if (!label || !value) return;
    const l = label.toLowerCase();
    if (/^(first ?name|name|full ?name)$/.test(l)) name = (name ? name + ' ' : '') + value;
    else if (/^last ?name$/.test(l)) name = (name ? name + ' ' : '') + value;
    else if (/e-?mail/.test(l) && !email) email = value;
    else if (/phone|mobile|tel/.test(l) && !phone) phone = value;
    else fields[label] = value;
  });
  const at = raw.at && !isNaN(Date.parse(raw.at)) ? new Date(raw.at).toISOString() : new Date().toISOString();
  return {
    id: raw.id || newId(8),
    at,
    n: name.slice(0, 120), e: email.slice(0, 160), p: phone.slice(0, 40),
    f: fields,
    pg: String(raw.page || '').slice(0, 120) || '/',
    fm: String(raw.form || '').slice(0, 80),
    src: String(raw.source || '').slice(0, 80),
    // The fingerprint of the message text, so the same blast across different websites is one thing.
    h: sha(Object.values(fields).join(' ').toLowerCase().replace(/\s+/g, ' ').trim()).slice(0, 12),
    via: src || 'hook',
  };
}

/** Add submissions to a website, skipping any already stored. Returns how many were new. */
export async function addLeads(siteId, leads) {
  if (!leads.length) return 0;
  const byMonth = new Map();
  leads.forEach((l) => { const m = monthOf(l.at); if (!byMonth.has(m)) byMonth.set(m, []); byMonth.get(m).push(l); });
  let added = 0;
  for (const [m, rows] of byMonth) {
    // A backfill run twice must not double the history, so ids already in the month are skipped.
    const have = new Set((await readMonth(siteId, m)).map((x) => x.id));
    const fresh = rows.filter((r) => !have.has(r.id));
    if (!fresh.length) continue;
    const packed = await redis(['EXISTS', packKey(siteId, m)]).then(([e]) => !!Number(e));
    if (packed) {
      // The month was closed; rewrite it whole rather than leaving two halves to merge on every read.
      const all = (await readMonth(siteId, m)).concat(fresh).sort((a, b) => String(a.at).localeCompare(b.at));
      await redis(['SET', packKey(siteId, m), packJSON(all)]);
    } else {
      await redis(...fresh.map((r) => ['RPUSH', listKey(siteId, m), JSON.stringify(r)]));
    }
    added += fresh.length;
  }
  if (added) await bumpSummary(siteId);
  return added;
}

/** Everything stored for one website in one month, oldest first. */
export async function readMonth(siteId, m) {
  const [packed, rows] = await redis(['GET', packKey(siteId, m)], ['LRANGE', listKey(siteId, m), 0, -1]);
  const a = packed ? (unpackJSON(packed) || []) : [];
  const b = (rows || []).map((r) => jparse(r)).filter(Boolean);
  return a.concat(b);
}

/**
 * Close any month that is over: pack the list into one compressed blob and drop the list.
 * Cheap, idempotent, and runs on read — so no scheduled job has to exist for this to happen.
 */
export async function compactOldMonths(siteId) {
  const current = new Date().toISOString().slice(0, 7);
  const months = monthsBack(26).filter((m) => m < current);
  const exists = await redis(...months.map((m) => ['EXISTS', listKey(siteId, m)]));
  for (let i = 0; i < months.length; i++) {
    if (!Number(exists[i])) continue;
    const all = (await readMonth(siteId, months[i])).sort((a, b) => String(a.at).localeCompare(b.at));
    await redis(['SET', packKey(siteId, months[i]), packJSON(all)], ['DEL', listKey(siteId, months[i])]);
  }
}

/** Leads for a website over the last `months`, newest first. */
export async function readLeads(siteId, months = 12) {
  const out = [];
  for (const m of monthsBack(months)) out.push(...await readMonth(siteId, m));
  return out.sort((a, b) => String(b.at).localeCompare(a.at));
}

/**
 * The small counts the lists read.
 *
 * Totals and "last one" live in two hashes keyed by website, so the Audits list gets every site's
 * numbers in two commands instead of one per site. The richer breakdown (7/30/90 days) is worked
 * out only when somebody actually opens a website's leads, because it needs the leads themselves.
 */
const TOT = () => P + 'leadtot';
const LAST = () => P + 'leadlast';
export async function bumpSummary(siteId) {
  const leads = await readLeads(siteId, 13);
  const now = Date.now();
  const since = (d) => leads.filter((l) => now - Date.parse(l.at) < d * 86400000).length;
  const s = { total: leads.length, d7: since(7), d30: since(30), d90: since(90), last: leads[0] ? leads[0].at : '' };
  await redis(['SET', sumKey(siteId), JSON.stringify(s)], ['HSET', TOT(), siteId, String(leads.length)],
    ['HSET', LAST(), siteId, s.last || '']);
  return s;
}
export async function getSummary(siteId) {
  const [raw] = await redis(['GET', sumKey(siteId)]);
  return jparse(raw) || { total: 0, d7: 0, d30: 0, d90: 0, last: '' };
}
export async function getSummaries(siteIds) {
  if (!siteIds.length) return {};
  const [tot, last] = await redis(['HGETALL', TOT()], ['HGETALL', LAST()]);
  const t = pairs(tot); const l = pairs(last);
  const out = {};
  siteIds.forEach((id) => { out[id] = { total: Number(t[id] || 0), last: l[id] || '' }; });
  return out;
}
/** Upstash returns a hash as a flat array; this is the same shape the rest of the app uses. */
function pairs(arr) {
  const o = {};
  if (Array.isArray(arr)) { for (let i = 0; i < arr.length; i += 2) o[arr[i]] = arr[i + 1]; }
  else if (arr && typeof arr === 'object') Object.assign(o, arr);
  return o;
}
/** The commands that record one live submission — used by the webhook, which must not go slow. */
export function liveLeadCommands(siteId, lead) {
  return [
    ['RPUSH', listKey(siteId, monthOf(lead.at)), JSON.stringify(lead)],
    ['HINCRBY', TOT(), siteId, 1],
    ['HSET', LAST(), siteId, lead.at],
  ];
}

/** Counts by page, by form and by source — the three questions a lead list actually gets asked. */
export function groupLeads(leads) {
  const by = (pick) => {
    const m = new Map();
    leads.forEach((l) => { const k = pick(l) || '—'; m.set(k, (m.get(k) || 0) + 1); });
    return [...m.entries()].map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n).slice(0, 40);
  };
  return { pages: by((l) => l.pg), forms: by((l) => l.fm), sources: by((l) => l.src) };
}

/** Leads per month, oldest first — what the dashboard draws. */
export function monthlySeries(leads, months = 12) {
  const keys = monthsBack(months).reverse();
  const counts = Object.fromEntries(keys.map((k) => [k, 0]));
  leads.forEach((l) => { const m = monthOf(l.at); if (m in counts) counts[m]++; });
  return keys.map((k) => ({ m: k, n: counts[k] }));
}

/** Leads by day of week and by hour — when this trade actually gets contacted. */
export function whenSeries(leads) {
  const dow = Array(7).fill(0); const hour = Array(24).fill(0);
  leads.forEach((l) => { const d = new Date(l.at); if (!isNaN(d)) { dow[d.getUTCDay()]++; hour[d.getUTCHours()]++; } });
  return { dow, hour };
}
