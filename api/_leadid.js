// What makes two stored enquiries the same enquiry.
//
// Duda's form-history endpoint returns four things per submission — date, form_title, message and
// utm_campaign — and no id and no page. The live webhook carries the page but may carry a different
// id, or none. So "the same submission" cannot be decided by id. It has to be decided by what the
// customer actually SAID, and when.
//
// Getting this wrong was expensive in both directions: every import used to mint a random id, so
// importing twice stored everything twice, and the live copy and the imported copy of the same
// enquiry never matched each other.
import { sha } from './_lib.js';

/** Envelope keys that are not answers somebody typed. Checked against the normalised label. */
// Underscored spellings are included because normLabel strips the underscore: Duda sends
// `page_name`, `site_name` and `form_title` on the row itself, and without these they are stored as
// if somebody had typed them into the form.
export const SKIP_KEY = /^(id|uuid|date|time|created|updated|submitted|page|pagename|pageurl|pagepath|url|form|formname|formtitle|formid|site|sitename|siteid|accountname|externalid|submissionid|leadid|ip|ipaddress|useragent|devicetype|referrer|recaptcha.*|utm.*|source|medium|campaign|subject|sender|recipient|type|widget.*)$/;

/** A label reduced to the part worth matching on: "First Name:*" and "first_name" are one thing. */
export const normLabel = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, '');

const tidy = (v) => String(v == null ? '' : v).toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * The fingerprint of what was said.
 *
 * Values only, never labels: the webhook and the history endpoint do not always label a field the
 * same way ("Phone" against "Phone Number:*"), but the customer's answers are the customer's
 * answers. Envelope fields are left out, so a stored `form_title` on one copy cannot make two
 * copies of one enquiry look different.
 */
export function leadSig(l) {
  const f = (l && (l.f || l.fields)) || {};
  const vals = Object.entries(f)
    .filter(([k]) => !SKIP_KEY.test(normLabel(k)))
    .map(([, v]) => tidy(v)).filter(Boolean).sort();
  const parts = [tidy(l && l.n), tidy(l && l.e), String((l && l.p) || '').replace(/\D/g, '').slice(-10)].concat(vals);
  return sha(parts.join('|')).slice(0, 16);
}

/**
 * An id for a submission Duda gave none to.
 *
 * Derived from the time and the content, so importing the same history twice produces the same ids
 * and the second import repairs rather than duplicates. Prefixed so a stored row can tell a stable
 * id from one of the random ones minted before this existed.
 */
export const stableId = (at, sig) => 's' + sha(String(at) + '|' + sig).slice(0, 15);
export const isStableId = (id) => /^s[0-9a-f]{15}$/.test(String(id || '').split(':').pop());

/** A page we actually know. "/" was what an unknown page used to be filled in with. */
export const realPage = (pg) => !!pg && pg !== '/' && pg !== '—';

/**
 * Two copies of one submission arrive within moments of each other: Duda's webhook stamps the
 * event time, and the history endpoint returns the same submission time. Half an hour is far more
 * than either needs and far less than a customer coming back to ask again.
 */
export const SAME_WINDOW_MS = 30 * 60 * 1000;

/**
 * Which copy of a duplicate to keep.
 *
 * The one that knows its page wins, because only a live delivery records the page and that cannot
 * be recovered later. Then a stable id, so the next import matches it. Then the earliest.
 */
function rank(r) {
  if (realPage(r.pg) && r.via === 'hook') return 0;
  if (realPage(r.pg)) return 1;
  if (isStableId(r.id)) return 2;
  return 3;
}

/**
 * Group copies of the same submission and decide what survives.
 *
 * Returns the rows to keep — each carrying the best of its copies: a known page, and a ruling a
 * person made — and the ids to drop. Nothing a person decided is ever lost to a merge.
 */
export function clusterDupes(rows) {
  const bySig = new Map();
  (rows || []).forEach((r) => {
    const s = r.sig || leadSig(r);
    if (!bySig.has(s)) bySig.set(s, []);
    bySig.get(s).push(Object.assign({}, r, { sig: s }));
  });
  const keep = []; const drop = [];
  for (const group of bySig.values()) {
    group.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    let cluster = [];
    const flush = () => {
      if (!cluster.length) return;
      const best = cluster.slice().sort((a, b) => rank(a) - rank(b) || String(a.at).localeCompare(String(b.at)))[0];
      const merged = Object.assign({}, best);
      if (!realPage(merged.pg)) {
        const known = cluster.find((x) => realPage(x.pg));
        merged.pg = known ? known.pg : '';
      }
      if (!merged.decidedBy) {
        const ruled = cluster.find((x) => x.decidedBy);
        if (ruled) Object.assign(merged, { verdict: ruled.verdict, why: ruled.why, decidedBy: ruled.decidedBy });
      }
      if (!merged.fm) { const named = cluster.find((x) => x.fm); if (named) merged.fm = named.fm; }
      keep.push(merged);
      cluster.filter((x) => x.id !== best.id).forEach((x) => drop.push({ id: x.id, into: best.id }));
      cluster = [];
    };
    for (const r of group) {
      const last = cluster[cluster.length - 1];
      if (last && Date.parse(r.at) - Date.parse(last.at) > SAME_WINDOW_MS) flush();
      cluster.push(r);
    }
    flush();
  }
  return { keep, drop };
}
