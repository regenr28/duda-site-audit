// Business Info history.
//
// Business Info is not a fact, it is a fact AS OF A DATE. A client changes their phone number and
// everything the app knew yesterday quietly becomes wrong: a number still on the website stops
// being "some number we don't recognise" and becomes "the old one, still up". The app could not
// tell those apart, because it only ever kept the latest answer.
//
// So every scan compares what Duda says now against what it said last time, and any change is
// written down with its date. Two things fall out of that:
//   · a value the website still shows that USED TO BE official is reported as out of date, with
//     the date it changed and the current value to replace it with;
//   · an approval ("this address is correct for this website") whose value has since become the
//     official one is redundant, and retires itself.
//
// Keyed on the DUDA site id, not the audit id, so the history survives an audit being removed from
// the list and added again months later — which is exactly when it is worth having.
import { redis, P, now, jparse } from './_lib.js';

const KEEP = 40;                       // snapshots per website; a change is rare, this is years
export const biKey = (dudaSiteId) => P + 'bihist:' + dudaSiteId;

const lower = (x) => String(x == null ? '' : x).trim().toLowerCase();
export const addrLine = (a) => (typeof a === 'string' ? a : [a && a.street, a && a.city, a && a.region, a && a.zip].filter(Boolean).join(', ')).trim();

/** The comparable shape of a Business Info record: just the values people put on a website. */
export function biShape(truth) {
  const t = truth || {};
  return {
    names: [...new Set((t.names || []).map((x) => String(x).trim()).filter(Boolean))],
    phones: [...new Set((t.phones || []).map(lower).filter(Boolean))],
    emails: [...new Set((t.emails || []).map(lower).filter(Boolean))],
    addresses: [...new Set((t.addresses || []).map(addrLine).filter(Boolean))],
    domain: lower(t.domain),
  };
}

export const BI_FIELDS = [
  { key: 'names', one: 'business name', many: 'business names' },
  { key: 'phones', one: 'phone number', many: 'phone numbers' },
  { key: 'emails', one: 'email address', many: 'email addresses' },
  { key: 'addresses', one: 'address', many: 'addresses' },
  { key: 'domain', one: 'domain', many: 'domain' },
];

/** What changed between two Business Info records. Empty when nothing did. */
export function biDiff(before, after) {
  const out = [];
  BI_FIELDS.forEach(({ key }) => {
    const a = key === 'domain' ? [before && before[key]].filter(Boolean) : ((before && before[key]) || []);
    const b = key === 'domain' ? [after && after[key]].filter(Boolean) : ((after && after[key]) || []);
    const same = (x, y) => (key === 'names' ? lower(x) === lower(y) : x === y);
    const added = b.filter((x) => !a.some((y) => same(x, y)));
    const removed = a.filter((x) => !b.some((y) => same(x, y)));
    if (added.length || removed.length) out.push({ field: key, added, removed });
  });
  return out;
}

/** Every snapshot we have for a website, newest first. */
export async function biHistory(dudaSiteId) {
  if (!dudaSiteId) return [];
  try {
    const [rows] = await redis(['LRANGE', biKey(dudaSiteId), 0, KEEP - 1]);
    return (rows || []).map((x) => jparse(x)).filter(Boolean);
  } catch (e) { return []; }
}

/**
 * Write a snapshot if Business Info has changed since the last one. The first scan records a
 * baseline (no changes) so the history has a beginning to measure from.
 * Returns what changed, so the caller can act on it in the same breath.
 */
export async function biRecord(dudaSiteId, truth, who) {
  if (!dudaSiteId || !truth) return { changes: [], first: false, at: '' };
  const shape = biShape(truth);
  if (!shape.names.length && !shape.phones.length && !shape.emails.length) return { changes: [], first: false, at: '' };
  const hist = await biHistory(dudaSiteId);
  const last = hist[0];
  const changes = last ? biDiff(last.t, shape) : [];
  if (last && !changes.length) return { changes: [], first: false, at: last.at };
  const at = now();
  const entry = { at, by: (who && who.email) || '', byName: (who && who.name) || '', first: !last, changes, t: shape };
  try { await redis(['LPUSH', biKey(dudaSiteId), JSON.stringify(entry)], ['LTRIM', biKey(dudaSiteId), 0, KEEP - 1]); } catch (e) { /* history is best effort */ }
  return { changes, first: !last, at };
}

/**
 * Values this website USED to publish and no longer does, with the date they stopped being
 * official. A value that came back later is not retired — it is current again.
 */
export function retiredFrom(history, currentShape) {
  const cur = currentShape || (history[0] && history[0].t) || {};
  const out = { names: [], phones: [], emails: [], addresses: [] };
  const isCurrent = (field, v) => {
    const list = (cur[field] || []);
    return field === 'names' ? list.some((x) => lower(x) === lower(v)) : list.includes(v);
  };
  // Newest first, so the first time a value is seen leaving is the date that counts.
  history.forEach((entry) => {
    (entry.changes || []).forEach((c) => {
      if (!out[c.field]) return;
      (c.removed || []).forEach((v) => {
        if (!v || isCurrent(c.field, v)) return;
        if (out[c.field].some((x) => x.value === v)) return;
        out[c.field].push({ value: v, since: entry.at });
      });
    });
  });
  return out;
}

/** Is this value one of the website's current Business Info values? */
export function isCurrentValue(shape, type, value) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return false;
  if (type === 'phone') return (shape.phones || []).includes(v.replace(/\D/g, '').slice(-10));
  if (type === 'email') return (shape.emails || []).includes(lower(v));
  if (type === 'name') return (shape.names || []).some((x) => lower(x) === lower(v));
  return false;
}

// ---------- values the website still shows but Duda no longer carries ----------
//
// Done here, on the save, rather than in the browser during the scan: the scan runs BEFORE the new
// Business Info is recorded, so a browser could only ever judge against the previous answer and
// would report a change one rescan late. Rewriting the finding afterwards also keeps its identity —
// the item holds on to its number, its comments and whatever status someone gave it, and simply
// changes what it says about itself.
const OUTDATED_KIND = {
  PHONE_MISMATCH: 'phones', TEL_MISMATCH: 'phones', TEL_TEXT_MISMATCH: 'phones', SMS_MISMATCH: 'phones', SCHEMA_PHONE: 'phones',
  EMAIL_MISMATCH: 'emails', MAILTO_MISMATCH: 'emails', MAILTO_TEXT_MISMATCH: 'emails', SCHEMA_EMAIL: 'emails',
  COPYRIGHT_NAME: 'names', SCHEMA_NAME: 'names', TEXT_OTHER_BUSINESS: 'names', ALT_LOGO_NAME: 'names',
  SCHEMA_ADDRESS: 'addresses', MAP_ADDRESS: 'addresses',
};
const OUTDATED_LABEL = { phones: 'phone number', emails: 'email address', names: 'business name', addresses: 'address' };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Written out plainly rather than by locale: everyone on the team reads the same sentence.
const when = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

function retiredHit(f, retired) {
  const list = (retired && retired[OUTDATED_KIND[f.code]]) || [];
  if (!list.length) return null;
  const hay = [f.found, f.snippet].filter(Boolean).join(' ');
  if (OUTDATED_KIND[f.code] === 'phones') {
    const digits = (hay.match(/\d[\d\s().+-]{8,}\d/g) || []).map((x) => x.replace(/\D/g, '').slice(-10));
    return list.find((r) => digits.includes(String(r.value).replace(/\D/g, '').slice(-10))) || null;
  }
  const low = hay.toLowerCase();
  return list.find((r) => r.value && low.includes(String(r.value).toLowerCase())) || null;
}

/** Rewrites contact findings that name a value this website used to publish. Returns how many. */
export function markOutdated(findings, retired) {
  if (!retired || !findings) return 0;
  let n = 0;
  findings.forEach((f) => {
    if (!OUTDATED_KIND[f.code] || f.severity === 'info') return;
    const hit = retiredHit(f, retired);
    if (!hit) return;
    const label = OUTDATED_LABEL[OUTDATED_KIND[f.code]] || 'detail';
    f.severity = 'outdated';
    f.wasOfficial = { value: hit.value, since: hit.since };
    f.message = `Still using the old ${label} — Business Info was changed${hit.since ? ' on ' + when(hit.since) : ''}`;
    n++;
  });
  return n;
}
