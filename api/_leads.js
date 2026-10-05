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
import { sqlReady } from './_sql.js';
import { addLeadsSql, leadsFor, summariesFor, seriesFor, whenFor, fromRow } from './_leadsql.js';

// Where enquiries live.
//
// With the analysis database connected they are rows in SQL, because what the app asks of them —
// group by page, by source, by month, which forms have gone quiet, what the busy websites do
// differently — are queries. Without it they stay in the key-value store exactly as before, so an
// installation that has not set it up still works and nothing here has to be decided twice.
//
// This module is still the ONLY place that knows which it is. Everything else just asks for leads.
export const usingSql = () => sqlReady();

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
// Envelope keys that are not answers somebody typed. Checked against the normalised label.
// Includes the underscored spellings, because normLabel strips the underscore: Duda sends
// `page_name` and `site_name` on the row itself when there is no envelope, and without these they
// are stored as if somebody had typed them into the form.
const SKIP_KEY = /^(id|uuid|date|time|created|updated|submitted|page|pagename|pageurl|pagepath|url|form|formname|formid|site|sitename|siteid|accountname|externalid|submissionid|leadid|ip|ipaddress|useragent|devicetype|referrer|recaptcha.*|utm.*|source|medium|campaign|subject|sender|recipient|type|widget.*)$/;
const LABEL_KEYS = ['field_label', 'label', 'title', 'field_name', 'name', 'key'];
const VALUE_KEYS = ['field_value', 'value', 'values', 'text', 'answer', 'content'];
const labelIn = (o, fallback) => {
  for (const k of LABEL_KEYS) if (o && typeof o[k] === 'string' && o[k].trim()) return o[k].trim();
  return fallback || '';
};
const valueIn = (o) => {
  for (const k of VALUE_KEYS) if (o && o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
};

/**
 * Every answer in a submission, whatever shape it arrived in.
 *
 * Duda does not publish this schema and it is not one shape. A submission's answers have turned up
 * as a list of `{field_label, field_value}`, as a flat map of label to answer, and as a map of field
 * id to `{label, value}` — and a reader written for one of those turns the others into the string
 * "[object Object]", which is a stored enquiry nobody can read and that no rescan puts right.
 *
 * So this reads structure rather than a shape: unwrap anything that carries a value, expand
 * anything that does not, join lists, and never hand back an object. Depth is capped because a
 * payload is not to be trusted to be finite.
 */
export function readFields(raw, depth = 0, seen = new Set()) {
  const out = [];
  if (raw === null || raw === undefined || depth > 4) return out;
  if (typeof raw === 'object') { if (seen.has(raw)) return out; seen.add(raw); }

  const add = (label, v) => {
    if (v === null || v === undefined || v === '') return;
    if (Array.isArray(v)) {
      // A list of plain answers is one answer ("Ceramic Coating, Paint Correction"); a list of
      // objects is several fields that happen to be nested.
      if (v.every((x) => x === null || typeof x !== 'object')) {
        const joined = v.filter((x) => x !== null && x !== '').join(', ');
        if (joined) out.push({ label, value: joined });
      } else v.forEach((x) => add(label, x));
      return;
    }
    if (typeof v === 'object') {
      const inner = valueIn(v);
      if (inner !== undefined && (typeof inner !== 'object' || Array.isArray(inner))) {
        add(labelIn(v, label), inner);
        return;
      }
      // No value of its own: it is a group of fields. Keep the inner labels, not this one.
      readFields(v, depth + 1, seen).forEach((f) => out.push({ label: f.label || label, value: f.value }));
      return;
    }
    out.push({ label, value: v });
  };

  if (Array.isArray(raw)) { raw.forEach((x) => add(typeof x === 'object' && x ? labelIn(x, '') : '', x)); return out; }
  Object.entries(raw).forEach(([k, v]) => {
    if (SKIP_KEY.test(normLabel(k))) return;
    add(typeof v === 'object' && v && !Array.isArray(v) ? labelIn(v, k) : k, v);
  });
  return out;
}

/** A label reduced to the part worth matching on: "First Name:*" and "first_name" are one thing. */
const normLabel = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, '');

export function normalise(raw, src) {
  const fields = {};
  let name = '', last = '', email = '', phone = '';
  (raw.fields || []).forEach((f) => {
    const label = String(f.label || '').trim().slice(0, 60);
    // Belt and braces: if a value still arrives as an object, keep it as text rather than storing
    // the word "[object Object]" over the top of what somebody actually wrote.
    const value = (f.value !== null && typeof f.value === 'object' ? JSON.stringify(f.value) : String(f.value == null ? '' : f.value)).trim().slice(0, 2000);
    if (!label || !value || value === '[object Object]') return;
    // Match on the normalised label, so "First Name:*", "first_name" and "First Name" all land.
    const l = normLabel(label);
    // Bare "first"/"last" are included: a nested group writes its inner labels, so a submission can
    // arrive as {contact: {first, last}} and otherwise lands as "No name given" with the name
    // sitting in plain sight two lines below it.
    if (/^(firstname|first|givenname|name|fullname|yourname|contactname|customername)$/.test(l)) name = (name ? name + ' ' : '') + value;
    else if (/^(lastname|last|surname|familyname)$/.test(l)) last = value;
    else if (/e?mail/.test(l) && !email) email = value;
    else if (/(phone|mobile|tel|cell)/.test(l) && !phone) phone = value;
    else fields[label] = value;
  });
  if (last) name = (name ? name + ' ' : '') + last;
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
export async function addLeads(siteId, leads, opts = {}) {
  if (!leads.length) return 0;
  if (usingSql()) return addLeadsSql(siteId, leads, opts);
  const byMonth = new Map();
  leads.forEach((l) => { const m = monthOf(l.at); if (!byMonth.has(m)) byMonth.set(m, []); byMonth.get(m).push(l); });
  let added = 0;
  for (const [m, rows] of byMonth) {
    const existing = await readMonth(siteId, m);
    const have = new Set(existing.map((x) => x.id));
    const fresh = rows.filter((r) => !have.has(r.id));
    // Repair: an enquiry already stored is read again from Duda's own copy and rewritten. This is
    // what makes a parsing fix reach the history rather than only the enquiries that arrive next.
    if (opts.repair) {
      const byId = new Map(rows.map((r) => [r.id, r]));
      const merged = existing.map((old) => (byId.has(old.id) ? Object.assign({}, byId.get(old.id)) : old))
        .concat(fresh).sort((a, b) => String(a.at).localeCompare(b.at));
      const changed = merged.length !== existing.length
        || merged.some((r, i) => JSON.stringify(r) !== JSON.stringify(existing[i]));
      if (changed) {
        await redis(['DEL', listKey(siteId, m)], ['SET', packKey(siteId, m), packJSON(merged)]);
        added += fresh.length;
      }
      continue;
    }
    // A backfill run twice must not double the history, so ids already in the month are skipped.
    if (!fresh.length) continue;
    const packed = await redis(['EXISTS', packKey(siteId, m)]).then(([e]) => !!Number(e));
    if (packed) {
      // The month was closed; rewrite it whole rather than leaving two halves to merge on every read.
      const all = existing.concat(fresh).sort((a, b) => String(a.at).localeCompare(b.at));
      await redis(['SET', packKey(siteId, m), packJSON(all)]);
    } else {
      await redis(...fresh.map((r) => ['RPUSH', listKey(siteId, m), JSON.stringify(r)]));
    }
    added += fresh.length;
  }
  if (added || opts.repair) await bumpSummary(siteId);
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
/**
 * An enquiry stored before the reader understood its shape holds the literal words "[object
 * Object]" where the answer should be. Re-importing is what actually repairs it, but until somebody
 * does, nothing should show a customer that string as if it were what they typed — so it is hidden
 * on the way out, and `broken` is set so the team's own view can offer the repair.
 */
const UNREADABLE = /\[object [A-Za-z]+\]/;
export function hideUnreadable(l) {
  const f = {};
  let hid = 0;
  Object.entries(l.f || {}).forEach(([k, v]) => { if (UNREADABLE.test(String(v))) hid++; else f[k] = v; });
  // The body was built by joining the fields, so a bad field left its mark there too. Drop the
  // lines that carry it rather than the whole body: a submission is often part readable.
  const lines = String(l.b || '').split('\n').filter((x) => !UNREADABLE.test(x));
  const body = lines.join('\n').trim();
  if (!hid && body === l.b) return l;
  return Object.assign({}, l, { f, b: body, broken: true });
}

export async function readLeads(siteId, months = 12) {
  const raw = usingSql()
    ? (await leadsFor(siteId, { months, limit: 1000 })).leads
    : (await monthsBack(months).reduce(async (acc, m) => (await acc).concat(await readMonth(siteId, m)), Promise.resolve([])))
      .sort((a, b) => String(b.at).localeCompare(a.at));
  return raw.map(hideUnreadable);
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
  if (usingSql()) return (await summariesFor([siteId]))[siteId];
  const [raw] = await redis(['GET', sumKey(siteId)]);
  return jparse(raw) || { total: 0, d7: 0, d30: 0, d90: 0, last: '' };
}
export async function getSummaries(siteIds) {
  if (!siteIds.length) return {};
  if (usingSql()) return summariesFor(siteIds);
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
