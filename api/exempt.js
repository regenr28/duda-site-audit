// Exceptions: pages (and values) where some checks don't apply.
//
// Two kinds, both applied to audits and to the auto audit of the live websites:
//   · Exception sets (admins, Settings → Exceptions): a name ("XPEL Landing Page"), pages on ANY
//     website (an exact path or a wildcard: /xpel-*, *ppf*), what not to check there, and values
//     (the manufacturer's phone, email, Facebook…) that are fine anywhere on any website.
//   · Page exceptions for one website (anyone on the team, from its audit): pages and what not to
//     check there.
// Audit items an exception covers are shown as Exempt (closed), never deleted: removing the
// exception brings them back. Every change is written to the audit's Activity tab (one website) or
// the app's activity log (sets), and each exception keeps its own history.
//
// GET  ?op=list&site=<duda id>             → groups, sets, this website's exceptions
// POST { op:'siteSave', site, rule }        → add or change a page exception for one website
// POST { op:'siteRemove', site, id }
// POST { op:'globalSave', set }             → add or change an exception set (exempt.global)
// POST { op:'globalRemove', id }
// POST { op:'preview', set, remove? }      → before saving or removing a set: what changes on which audit
import { metered, requireUser, readBody, can, jparse, now, newId, redis, P, globalLog, unpackJSON } from './_lib.js';
import { saveIndex } from './store.js';
import '../public/engine.js';

const A = () => globalThis.DudaAudit;
const GKEY = P + 'exsets';
const SKEY = (id) => P + 'exsite:' + id;
const VALUE_TYPES = ['phone', 'email', 'address', 'city', 'state', 'name', 'social'];
const TYPE_WORD = { phone: 'phone', email: 'email', address: 'address', city: 'city', state: 'state', name: 'business name', social: 'social link' };
const groupLabel = (k) => ((A().EXEMPT_GROUPS.find((g) => g.k === k) || {}).label || k).toLowerCase();
const skipWords = (skip) => (skip || []).map(groupLabel).join(', ') || 'nothing';

function cleanRule(b, kind) {
  const groups = A().EXEMPT_GROUPS.map((g) => g.k);
  const raw = Array.isArray(b.pages) ? b.pages : String(b.pages || '').split(/[\n,]+/);
  const scope = kind === 'site' && b.scope === 'all' ? 'all' : 'pages';
  let pages = [...new Set(raw.map((p) => A().exemptPath(p)).filter((p) => p && p.length <= 200))].slice(0, 30);
  let skip = [...new Set((b.skip || []).filter((k) => groups.includes(k)))];
  let values = (b.values || []).map((v) => ({ type: VALUE_TYPES.includes(v && v.type) ? v.type : '', value: String((v && v.value) || '').trim().slice(0, 200) }))
    .filter((v, i, all) => v.type && v.value && all.findIndex((x) => x.type === v.type && x.value.toLowerCase() === v.value.toLowerCase()) === i).slice(0, 80);
  // One website: either the whole website (values that are fine anywhere on it) or some pages (and
  // what not to check there). A set may have both.
  if (kind === 'site') { if (scope === 'all') { pages = []; skip = []; } else values = []; }
  return { scope, name: String(b.name || '').trim().slice(0, 80), pages, skip, values, note: String(b.note || '').trim().slice(0, 300) };
}
/** What it covers, in words, for the history and the activity log. */
function describe(r) {
  const bits = [];
  if (r.pages.length) bits.push(`pages ${r.pages.join(', ')} (not checking ${skipWords(r.skip)})`);
  if (r.values.length) bits.push(`${r.scope === 'all' ? 'anywhere on the website: ' : 'fine anywhere: '}${r.values.slice(0, 6).map((v) => `${TYPE_WORD[v.type]} ${v.value}`).join(', ')}${r.values.length > 6 ? ` and ${r.values.length - 6} more` : ''}`);
  return bits.join('; ');
}
async function readGlobal() { const [raw] = await redis(['GET', GKEY]); const g = jparse(raw) || {}; return { v: g.v || 0, sets: g.sets || [] }; }
async function readSite(id) { const [raw] = await redis(['GET', SKEY(id)]); return jparse(raw) || []; }
/** Every audit of one Duda website (normally one). */
async function auditsOf(dudaId) {
  const [idx] = await redis(['HGETALL', P + 'index']);
  const out = [];
  for (let i = 0; idx && i < idx.length; i += 2) { const s = jparse(idx[i + 1]); if (s && s.siteId === dudaId) out.push(s.id); }
  return out;
}
async function auditLog(ids, me, text) {
  const e = (id) => JSON.stringify({ id: newId(6), at: now(), by: me.email, byName: me.name, type: 'exempt', text });
  if (ids.length) await redis(...ids.flatMap((id) => [['LPUSH', P + 'act:' + id, e(id)], ['LTRIM', P + 'act:' + id, 0, 299]]));
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const me = await requireUser(req, res);
  if (!me) return;
  try {
    const canGlobal = await can(me, 'exempt.global');
    if (req.method === 'GET') {
      const site = String(req.query.site || '');
      const g = await readGlobal();
      return res.status(200).json({ groups: A().EXEMPT_GROUPS, global: g.sets, site: site ? await readSite(site) : [], canGlobal });
    }
    const b = readBody(req);

    if (b.op === 'siteSave' || b.op === 'siteRemove') {
      const site = String(b.site || '');
      if (!/^[A-Za-z0-9_-]{4,}$/.test(site)) return res.status(400).json({ error: 'Bad website' });
      const list = await readSite(site);
      const ids = await auditsOf(site);
      if (b.op === 'siteRemove') {
        const x = list.find((r) => r.id === b.id);
        if (!x) return res.status(404).json({ error: 'That exception is gone already.' });
        await redis(['SET', SKEY(site), JSON.stringify(list.filter((r) => r.id !== b.id))]);
        await auditLog(ids, me, `removed the exception (${describe(Object.assign({ values: [], pages: [] }, x))}): checked normally again`);
        await Promise.all(ids.map((id) => saveIndex(id).catch(() => null)));
        return res.status(200).json({ ok: true });
      }
      const r = cleanRule(b.rule || {}, 'site');
      if (r.scope === 'all' && !r.values.length) return res.status(400).json({ error: 'Add at least one value (a phone, email, address, city…).' });
      if (r.scope === 'pages' && !r.pages.length) return res.status(400).json({ error: 'Add the page address (or a pattern like /xpel-*).' });
      if (r.scope === 'pages' && !r.skip.length) return res.status(400).json({ error: 'Tick at least one thing not to check.' });
      if (r.note.length < 3) return res.status(400).json({ error: 'Write the reason for the exception.' });
      const old = b.rule && b.rule.id ? list.find((x) => x.id === b.rule.id) : null;
      const rule = Object.assign(old || { id: newId(8), by: me.email, byName: me.name, at: now(), history: [] }, r, { kind: 'site' });
      if (old) Object.assign(rule, { updatedBy: me.email, updatedByName: me.name, updatedAt: now() });
      const what = (old ? 'changed' : 'added') + ' an audit exception: ' + describe(rule) + (rule.note ? ` · reason: "${rule.note}"` : '');
      rule.history = (rule.history || []).concat({ at: now(), by: me.email, byName: me.name, what }).slice(-30);
      await redis(['SET', SKEY(site), JSON.stringify(old ? list.map((x) => (x.id === old.id ? rule : x)) : list.concat(rule).slice(-50))]);
      await auditLog(ids, me, what);
      await Promise.all(ids.map((id) => saveIndex(id).catch(() => null)));
      return res.status(200).json({ rule });
    }

    if (b.op === 'preview') {
      // Before a set is saved or removed: every audit, how many of its items would become Exempt and
      // how many would come back. Read in chunks; only items nobody has closed by hand count.
      if (!canGlobal) return res.status(403).json({ error: 'Only admins can change exception sets.' });
      const g = await readGlobal();
      const draft = b.remove ? null : Object.assign(cleanRule(b.set || {}, 'global'), { id: (b.set && b.set.id) || '_draft', kind: 'global' });
      const others = g.sets.filter((x) => x.id !== ((b.set && b.set.id) || b.id));
      const before = g.sets, after = draft ? others.concat(draft) : others;
      const [idx] = await redis(['HGETALL', P + 'index']);
      const audits = [];
      for (let i = 0; idx && i < idx.length; i += 2) { const x = jparse(idx[i + 1]); if (x && x.id && x.siteId) audits.push(x); }
      const rows = [];
      for (let i = 0; i < audits.length; i += 30) {
        const chunk = audits.slice(i, i + 30);
        const got = await redis(...chunk.flatMap((a) => [['GET', P + 'site:' + a.id], ['HGETALL', P + 'fstate:' + a.id], ['GET', SKEY(a.siteId)], ['HGETALL', P + 'fnum:' + a.id]]));
        chunk.forEach((a, k) => {
          const site = unpackJSON(got[k * 4]); if (!site) return;
          const st = {}; const fs = got[k * 4 + 1] || [];
          for (let j = 0; j < fs.length; j += 2) st[fs[j]] = jparse(fs[j + 1]) || {};
          const own = jparse(got[k * 4 + 2]) || [];
          const nums = {}; const fn2 = got[k * 4 + 3] || [];
          for (let j = 0; j < fn2.length; j += 2) nums[fn2[j]] = Number(fn2[j + 1]);
          (site.findings || []).forEach((f) => { if (nums[f.id]) f.num = nums[f.id]; });
          let gain = 0, back = 0; const items = [];
          (site.findings || []).forEach((f) => {
            const status = (st[f.id] && st[f.id].status) || (f.done ? 'done' : 'open');
            if (status !== 'open') return;
            const was = !!A().exemptRuleFor(f, own.concat(before)), will = !!A().exemptRuleFor(f, own.concat(after));
            const ch = !was && will ? 'gain' : was && !will ? 'back' : '';
            if (!ch) return;
            if (ch === 'gain') gain++; else back++;
            if (items.length < 40) items.push({ ch, id: f.id, num: f.num || null, message: String(f.message || f.code).slice(0, 160), path: f.path || '', found: String(f.found || '').slice(0, 90) });
          });
          if (gain || back) rows.push({ id: a.id, name: a.businessName || a.siteId, siteId: a.siteId, status: a.status || '', assignee: a.assignee || '', gain, back, items });
        });
      }
      const done = (x) => x.status === 'Complete';
      rows.sort((x, y) => (done(x) - done(y)) || (y.gain + y.back) - (x.gain + x.back));
      return res.status(200).json({ rows, audits: audits.length, gain: rows.reduce((n, r) => n + r.gain, 0), back: rows.reduce((n, r) => n + r.back, 0) });
    }

    if (b.op === 'globalSave' || b.op === 'globalRemove') {
      if (!canGlobal) return res.status(403).json({ error: 'Only admins can change exception sets.' });
      const g = await readGlobal();
      if (b.op === 'globalRemove') {
        const x = g.sets.find((s) => s.id === b.id);
        if (!x) return res.status(404).json({ error: 'That exception set is gone already.' });
        await redis(['SET', GKEY, JSON.stringify({ v: g.v + 1, sets: g.sets.filter((s) => s.id !== b.id) })], ['INCR', P + 'ver:index']);
        await globalLog(me, 'exempt', `removed the exception set "${x.name}": its pages and values are checked normally again on every website`);
        return res.status(200).json({ ok: true });
      }
      const r = cleanRule(b.set || {}, 'global');
      if (!r.name) return res.status(400).json({ error: 'Give the set a name, e.g. "XPEL Landing Page".' });
      if (r.note.length < 3) return res.status(400).json({ error: 'Write the reason for the exception set.' });
      if (!r.pages.length && !r.values.length) return res.status(400).json({ error: 'Add at least one page or one value.' });
      if (r.pages.length && !r.skip.length) return res.status(400).json({ error: 'Tick at least one thing not to check on those pages.' });
      const old = b.set && b.set.id ? g.sets.find((x) => x.id === b.set.id) : null;
      const set = Object.assign(old || { id: newId(8), by: me.email, byName: me.name, at: now(), history: [] }, r, { kind: 'global' });
      if (old) Object.assign(set, { updatedBy: me.email, updatedByName: me.name, updatedAt: now() });
      const what = `${old ? 'changed' : 'added'} the exception set "${set.name}": ${describe(set)}`;
      set.history = (set.history || []).concat({ at: now(), by: me.email, byName: me.name, what }).slice(-30);
      await redis(['SET', GKEY, JSON.stringify({ v: g.v + 1, sets: old ? g.sets.map((x) => (x.id === old.id ? set : x)) : g.sets.concat(set).slice(-100) })], ['INCR', P + 'ver:index']);
      await globalLog(me, 'exempt', what);
      return res.status(200).json({ set });
    }
    return res.status(400).json({ error: 'Unknown op' });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Something went wrong' });
  }
}

export default metered('exempt', handler);
