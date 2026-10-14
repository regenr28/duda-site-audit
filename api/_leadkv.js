// Lead analysis on the app's own storage — no separate analysis database needed.
//
// Every website already keeps two small numbers: how many enquiries it has stored over the last
// year (leadtot) and when the newest one arrived (leadlast). That is enough to answer the question
// that is worth money — "which forms have gone quiet?" — for all 700 websites in three reads, and to
// show how enquiries are spread across the client base. The questions that need every message side
// by side (the same spam sent to many clients) still need the analysis database.
import { redis, P, jparse, unpackJSON, listUsers, notifyUser } from './_lib.js';

const DAY = 86400000;
function flat(x) {
  const o = {};
  if (Array.isArray(x)) { for (let i = 0; i < x.length; i += 2) o[x[i]] = x[i + 1]; } else Object.assign(o, x || {});
  return o;
}
/** Names, domains and audits for every website, published ones marked, in two reads. */
async function siteDirectory() {
  const [idx, ds, dom] = await redis(['HGETALL', P + 'index'], ['GET', P + 'dudasites'], ['HGETALL', P + 'domstat']);
  const out = new Map();
  const list = (unpackJSON(ds) || {}).sites || [];
  list.forEach((s) => out.set(String(s.id), { name: s.name || s.domain || s.id, domain: s.domain || '', published: !!s.published, auditId: '' }));
  Object.values(flat(idx)).forEach((v) => {
    const s = typeof v === 'string' ? jparse(v) : v;
    if (!s || !s.siteId) return;
    const e = out.get(String(s.siteId)) || { name: s.businessName || s.siteId, domain: '', published: false };
    e.auditId = s.id; if (s.businessName) e.name = s.businessName;
    out.set(String(s.siteId), e);
  });
  const d = flat(dom);
  out.forEach((e, id) => { const x = jparse(d[id]); if (x && x.status) e.dom = { status: x.status, label: x.label || x.status }; });
  return { sites: out, known: list.length > 0 };
}

/**
 * Websites whose forms have gone quiet.
 *
 * "Quiet" is measured against the website's own rhythm: a shop that gets ten enquiries a month and
 * has had none for three weeks is a broken form until proven otherwise; one that gets one a month
 * is not. The usual gap between enquiries is a year divided by the year's count; a website is quiet
 * when it has gone three of those gaps (and at least three weeks) without one. Only published
 * websites with at least `min` enquiries in the year are judged — too few is not a rhythm.
 */
export async function quietKV({ now = Date.now(), min = 6, limit = 100 } = {}) {
  const [tot, last] = await redis(['HGETALL', P + 'leadtot'], ['HGETALL', P + 'leadlast']);
  const T = flat(tot); const L = flat(last);
  const { sites, known } = await siteDirectory();
  const rows = [];
  Object.entries(T).forEach(([id, n]) => {
    const total = Number(n) || 0; const at = Date.parse(L[id] || '');
    if (total < min || !at) return;
    const e = sites.get(String(id));
    if (known && (!e || !e.published)) return; // switched off or gone from Duda: of course it is quiet
    const gap = 365 / total; const quiet = (now - at) / DAY;
    if (quiet <= Math.max(21, gap * 3)) return;
    rows.push({ site: id, name: (e && e.name) || id, domain: (e && e.domain) || '', auditId: (e && e.auditId) || '', dom: (e && e.dom) || null,
      total_real: total, per_month: Math.round((total / 12) * 10) / 10, months: 12, last_real: new Date(at).toISOString().slice(0, 10),
      quiet_days: Math.floor(quiet), missed: Math.max(1, Math.round(quiet / gap)) });
  });
  rows.sort((a, b) => b.missed - a.missed || b.quiet_days - a.quiet_days);
  const top = rows.slice(0, limit);
  // What the auto audit saw on the live website: is there still a contact form at all?
  if (top.length) {
    const cw = await redis(['MGET', ...top.map((r) => P + 'cw:' + r.site)]);
    (cw[0] || []).forEach((raw, k) => {
      const r = jparse(raw);
      if (r && r.forms && typeof r.forms === 'object') top[k].form = Object.keys(r.forms).length > 0;
      if (r && r.at) top[k].readAt = r.at;
    });
  }
  return top;
}

/** How enquiries are spread across the websites: who gets plenty, who gets none. */
export async function acrossKV({ now = Date.now() } = {}) {
  const [tot, last] = await redis(['HGETALL', P + 'leadtot'], ['HGETALL', P + 'leadlast']);
  const T = flat(tot); const L = flat(last);
  const { sites, known } = await siteDirectory();
  const ids = known ? [...sites.entries()].filter(([, e]) => e.published).map(([id]) => id) : Object.keys(T);
  const band = { none: 0, few: 0, some: 0, many: 0 };
  let total = 0, active30 = 0, silent90 = 0;
  const rows = ids.map((id) => {
    const n = Number(T[id] || 0); const at = Date.parse(L[id] || '') || 0;
    total += n;
    if (at && now - at < 30 * DAY) active30++;
    if (!at || now - at > 90 * DAY) silent90++;
    if (!n) band.none++; else if (n < 12) band.few++; else if (n < 60) band.some++; else band.many++;
    const e = sites.get(String(id)) || {};
    return { site: id, name: e.name || id, auditId: e.auditId || '', n, last: at ? new Date(at).toISOString().slice(0, 10) : '' };
  });
  rows.sort((a, b) => b.n - a.n);
  return { kv: true, overall: { sites: ids.length, withLeads: ids.length - band.none, total, active30, silent90 }, bands: band, top: rows.filter((r) => r.n).slice(0, 15) };
}

/**
 * Once a day: tell the admins about websites that have JUST gone quiet. A website is told about once
 * per silence: it is remembered with the date of its last enquiry, and only a new silence (after an
 * enquiry arrives and it goes quiet again) is reported again.
 */
export async function quietAlerts({ now = Date.now(), force = false } = {}) {
  const day = new Date(now).toISOString().slice(0, 10);
  if (!force) { const [first] = await redis(['SET', P + 'quietran:' + day, '1', 'NX', 'EX', 2 * 86400]); if (first !== 'OK') return { skipped: true }; }
  const list = await quietKV({ now, limit: 300 });
  const [seenRaw] = await redis(['HGETALL', P + 'quietseen']);
  const seen = flat(seenRaw);
  const fresh = list.filter((r) => seen[r.site] !== r.last_real);
  const keep = new Set(list.map((r) => r.site));
  const cmds = [];
  list.forEach((r) => { if (seen[r.site] !== r.last_real) cmds.push(['HSET', P + 'quietseen', r.site, r.last_real]); });
  Object.keys(seen).filter((id) => !keep.has(id)).forEach((id) => cmds.push(['HDEL', P + 'quietseen', id]));
  if (cmds.length) await redis(...cmds);
  // The very first run would report every quiet website at once; it only remembers them instead.
  if (!Object.keys(seen).length && !force) return { first: true, quiet: list.length };
  if (!fresh.length) return { quiet: list.length, fresh: 0 };
  const lines = fresh.slice(0, 12).map((r) => `${String(r.name).replace(/[*_~<>]/g, '')}: no enquiry for ${r.quiet_days} days (usually ${r.per_month} a month)${r.dom && r.dom.status !== 'ok' ? ` · domain: ${r.dom.label}` : ''}${r.form === false ? ' · no contact form found on the live website' : ''}`);
  if (fresh.length > 12) lines.push(`and ${fresh.length - 12} more`);
  const m = { kind: 'leads-quiet', by: '', byName: 'Lead analysis', count: fresh.length,
    headline: `📭 *Forms gone quiet*${fresh.length > 1 ? ` (${fresh.length} websites)` : ''}`,
    sections: [lines.map((l) => '• ' + l).join('\n')], lines, text: lines.join('\n') };
  const admins = (await listUsers()).filter((u) => u.role === 'admin' && u.status === 'active');
  await Promise.all(admins.map((u) => notifyUser(u.email, m).catch(() => {})));
  return { quiet: list.length, fresh: fresh.length };
}
