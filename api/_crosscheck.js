// Cross-checking a contact discrepancy against what the team already knows.
//
// When the audit says "this phone number is not in Business Info", the answer is often already
// written down somewhere: the client left a comment in the Duda editor saying "please use our new
// number", or somebody marked the same value a False alarm on another website last month. Both
// live in this app and neither was ever shown next to the item that needed them.
//
// So a contact item now carries what we already know about that value. Nothing is decided here —
// except one thing: an item nobody has touched yet, whose value a CLIENT has commented about, is
// moved to "For clarification", because there is a question outstanding and it should not sit in
// the default list looking like ordinary work.
import { redis, P, jparse, unescapeHtml, listUsers, slackRoster } from './_lib.js';
import { sideTest, dudaTypes } from './comments.js';

const CONTACT_CODES = /^(TEL_|PHONE_|MAILTO_|EMAIL_|SMS_|COPYRIGHT_NAME|TEXT_OTHER_BUSINESS|NAME_SPELLING|SCHEMA_(PHONE|EMAIL|NAME|ADDRESS)|MAP_(ADDRESS|OTHER_BUSINESS|LABEL_OLD)|ADDRESS_|SOCIAL_|AI_TEXT_(OTHER_BUSINESS|NAME_VARIANT))/;
const NAME_CODES = /^(COPYRIGHT_NAME|TEXT_OTHER_BUSINESS|NAME_SPELLING|SCHEMA_NAME|MAP_OTHER_BUSINESS|MAP_LABEL_OLD|AI_TEXT_(OTHER_BUSINESS|NAME_VARIANT))$/;
const ADDRESS_CODES = /^(SCHEMA_ADDRESS|MAP_ADDRESS|ADDRESS_)/;
const squash = (s) => String(s || '').toLowerCase().replace(/[’'`]s\b/g, '').replace(/\s*[&+]\s*/g, ' and ').replace(/[^a-z0-9]/g, '');
const MAX_PER_ITEM = 3;

/** The values worth searching for in a finding: phone digits, email addresses, quoted names. */
export function valuesOf(f) {
  const out = [];
  // What the item FOUND comes first and is marked as such: a comment mentioning the number on the
  // page is about that number, while one mentioning the official number is only related.
  const fromFound = (x) => String(f.found || '').replace(/[^\d]/g, '').includes(x) || String(f.found || '').toLowerCase().includes(x);
  // Names and addresses: the text that was found, squashed so "Buff & Beyond" and "buff and beyond"
  // are the same thing. Only for items about a name or an address.
  if (NAME_CODES.test(f.code || '')) {
    const n = squash(f.foreignName || f.found);
    if (n.length >= 5 && n.length <= 40) out.push({ kind: 'name', v: n, src: 'found' });
  }
  if (ADDRESS_CODES.test(f.code || '')) {
    const st = String(f.found || '').match(/\b(\d{2,6})\s+([A-Za-z][A-Za-z]+)/);
    if (st) out.push({ kind: 'street', v: st[1] + ' ' + st[2].toLowerCase(), src: 'found' });
  }
  const hay = [f.found, f.expected, f.snippet].filter(Boolean).join(' ');
  // A bounded pattern, not a greedy run of digits and punctuation: "(443) 736-2070 (302) 317-2793"
  // is two numbers, and a loose pattern swallows them into one and loses the first.
  (hay.match(/(?:\+?1[\s.-]?)?\(?[2-9]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g) || [])
    .forEach((x) => { const d = x.replace(/\D/g, '').slice(-10); if (d.length === 10 && !out.some((o) => o.v === d)) out.push({ kind: 'phone', v: d, src: fromFound(d) ? 'found' : 'other' }); });
  (hay.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).forEach((x) => { const e = x.toLowerCase(); if (!out.some((o) => o.v === e)) out.push({ kind: 'email', v: e, src: fromFound(e) ? 'found' : 'other' }); });
  return out.slice(0, 6);
}

/** Does this comment text mention the value, however it is punctuated? */
function mentions(text, val) {
  const t = String(text || '');
  if (val.kind === 'email') return t.toLowerCase().includes(val.v);
  if (val.kind === 'name') return squash(t).includes(val.v);
  if (val.kind === 'street') return t.toLowerCase().replace(/\s+/g, ' ').includes(val.v);
  const digits = t.replace(/[^\d]/g, '');
  return digits.includes(val.v);
}

/**
 * What the team already knows about the values in these findings.
 * Returns { byFinding: { <findingId>: { comments:[…], falseAlarms:[…] } } }.
 */
export async function crossCheck(findings, dudaSiteId) {
  const wanted = (findings || []).filter((f) => CONTACT_CODES.test(f.code || ''));
  if (!wanted.length) return { byFinding: {}, searched: 0 };

  const values = new Map();          // "phone:3023172793" → [findingId]
  wanted.forEach((f) => {
    valuesOf(f).forEach((v) => {
      const k = v.kind + ':' + v.v;
      (values.get(k) || values.set(k, { val: v, ids: [] }).get(k)).ids.push(f.id);
    });
  });
  if (!values.size) return { byFinding: {}, searched: 0 };
  let searched = 0;

  const out = {};
  const put = (id, key, row) => {
    const e = out[id] || (out[id] = { comments: [], falseAlarms: [] });
    if (e[key].length < MAX_PER_ITEM && !e[key].some((x) => x.ref === row.ref)) e[key].push(row);
  };

  // 1. Duda comments on this website that mention the value.
  if (dudaSiteId) {
    try {
      const [conv, over] = await redis(['HGETALL', P + 'conv:' + dudaSiteId], ['HGETALL', P + 'cmtwho']);
      const overrides = {};
      for (let i = 0; over && i < over.length; i += 2) overrides[over[i]] = over[i + 1];
      const threads = [];
      for (let i = 1; conv && i < conv.length; i += 2) { const c = jparse(conv[i]); if (c) threads.push(c); }
      const authors = [];
      threads.forEach((t) => (t.comments || []).forEach((c) => { if (c.by && !authors.includes(c.by)) authors.push(c.by); }));
      const isClient = sideTest(await listUsers(), overrides, await slackRoster(), await dudaTypes(authors, 6));
      threads.forEach((t) => {
        (t.comments || []).filter((c) => !c.deleted).forEach((c) => {
          searched++;
          const text = unescapeHtml(c.text || '');
          values.forEach(({ val, ids }) => {
            if (!mentions(text, val)) return;
            ids.forEach((id) => put(id, 'comments', {
              ref: t.u + ':' + (c.u || c.at), conv: t.u, num: t.num || 0, at: c.at, by: c.by || '',
              text: String(text).slice(0, 220), status: t.status || 'open', client: isClient(c.by) === 'client', fromFound: val.src === 'found',
            }));
          });
        });
      });
    } catch (e) { /* comments are a bonus, never a blocker */ }
  }

  // 2. The same value marked a False alarm before — here or on another website.
  try {
    const keys = [...values.keys()].map((k) => P + 'faval:' + k);
    if (keys.length) {
      const rows = await redis(...keys.map((k) => ['GET', k]));
      [...values.entries()].forEach(([, { ids }], i) => {
        const list = jparse(rows[i]) || [];
        list.forEach((r) => ids.forEach((id) => put(id, 'falseAlarms', Object.assign({ ref: r.key }, r))));
      });
    }
  } catch (e) { /* likewise */ }

  return { byFinding: out, searched };
}

/** Remember a value that was marked a False alarm, so the next audit can say so. */
export async function rememberFalseAlarm(rec) {
  const vals = valuesOf({ found: rec.found, expected: '', snippet: '' });
  if (!vals.length) return;
  const cmds = [];
  for (const v of vals) {
    const key = P + 'faval:' + v.kind + ':' + v.v;
    try {
      const [raw] = await redis(['GET', key]);
      const list = (jparse(raw) || []).filter((x) => x.key !== rec.key);
      list.unshift({ key: rec.key, siteName: rec.siteName, siteRef: rec.siteRef, path: rec.path, message: String(rec.message || '').slice(0, 140), reason: String(rec.reason || '').slice(0, 200), by: rec.markedByName || '', at: rec.markedAt || '' });
      cmds.push(['SET', key, JSON.stringify(list.slice(0, 8))]);
    } catch (e) { /* best effort */ }
  }
  if (cmds.length) { try { await redis(...cmds); } catch (e) { /* best effort */ } }
}

/** Forget one, when the False alarm is taken back. */
export async function forgetFalseAlarm(rec) {
  const vals = valuesOf({ found: rec.found, expected: '', snippet: '' });
  for (const v of vals) {
    const key = P + 'faval:' + v.kind + ':' + v.v;
    try {
      const [raw] = await redis(['GET', key]);
      const list = (jparse(raw) || []).filter((x) => x.key !== rec.key);
      await redis(list.length ? ['SET', key, JSON.stringify(list)] : ['DEL', key]);
    } catch (e) { /* best effort */ }
  }
}
