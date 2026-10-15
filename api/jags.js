// The Jaguars board: fixing every audit, first in, first out.
//
// The queue is the live websites the auto audit found critical errors on, in the order the admins
// choose. A Jaguar does not pick: "Take next" gives them the top website (with the lock on, nothing
// else can be taken), it becomes an audit assigned to them, and it moves across the board:
//
//   Queue → In progress → (Needs review) → Complete
//
// Complete means everything is fixed — must-fix items, design polish and lengths — confirmed by a
// scan made after the last fix. A website with false alarms, questions or items on hold goes to
// Needs review instead, and someone allowed to approve looks at it first.
//
// GET  ?op=board                       → queue, cards, settings
// POST { op:'take', dudaId? }          → take the next website (or that one, when the lock is off)
// POST { op:'done', dudaId }           → finished: complete it, or send it for review
// POST { op:'approve', dudaId, note? } → approve a reviewed website            (jags.lead)
// POST { op:'sendback', dudaId, note } → back to In progress, with the reason   (jags.lead)
// POST { op:'reassign', dudaId, to, note } → hand the whole website to someone else, with the reason
// POST { op:'release', dudaId, note }  → put it back in the queue, with the reason
// POST { op:'settings', … }            → queue order, which websites, lock, limit (jags.lead)
// POST { op:'pin', dudaId, on }        → pin a website to the top of the queue  (jags.lead)
import { metered, requireUser, readBody, can, jparse, now, newId, redis, P, notifyUser, listUsers, unpackJSON, packJSON, savedEditorHost, globalLog } from './_lib.js';
import { saveIndex } from './store.js';

const CARDS = P + 'jag:cards';   // hash: Duda site id → card
const SET = P + 'jag:set';       // the admins' settings
const DEFAULTS = { order: 'oldest', scope: 'critical', lock: true, limit: 1, pins: [], peek: false };
const ORDERS = ['oldest', 'newest', 'most', 'least'];
const DAY = 86400000;

const flat = (x) => { const o = {}; if (Array.isArray(x)) { for (let i = 0; i < x.length; i += 2) o[x[i]] = x[i + 1]; } else Object.assign(o, x || {}); return o; };
const noteOf = (s) => String(s || '').trim().slice(0, 600);

async function settings() {
  const [raw] = await redis(['GET', SET]);
  return Object.assign({}, DEFAULTS, jparse(raw) || {});
}

/** Open work on an audit, from its summary: what is left, what is waiting on someone. */
function progress(sum) {
  const c = (sum && sum.counts) || {};
  const must = (c.critical || 0) + (c.outdated || 0) + (c.warning || 0) + (c.info || 0);
  const open = must + (c.po || 0) + (c.lo || 0);
  const total = (c.total || 0) + (c.pt || 0) + (c.lt || 0);
  return { crit: c.critical || 0, open, total, closed: (c.closed || 0) + (c.pc || 0) + (c.lc || 0), clar: c.clarification || 0, hold: c.hold || 0 };
}

/** Everything the board needs, in one round of reads. */
async function readAll() {
  const [sumRaw, ds, cardsRaw, setRaw, idx] = await redis(['HGETALL', P + 'cwsum'], ['GET', P + 'dudasites'], ['HGETALL', CARDS], ['GET', SET], ['HGETALL', P + 'index']);
  const sums = flat(sumRaw);
  const cards = {}; Object.entries(flat(cardsRaw)).forEach(([k, v]) => { const c = jparse(v); if (c) cards[k] = c; });
  const audits = {}; // Duda id → its audit (the most recently updated, if there are two)
  Object.values(flat(idx)).forEach((v) => {
    const s = typeof v === 'string' ? jparse(v) : v;
    if (!s || !s.siteId) return;
    const cur = audits[s.siteId];
    if (!cur || String(s.updatedAt || '') > String(cur.updatedAt || '')) audits[s.siteId] = s;
  });
  return { sums, sites: ((unpackJSON(ds) || {}).sites || []).filter((s) => s.published), cards, audits, set: Object.assign({}, DEFAULTS, jparse(setRaw) || {}) };
}

/** The queue, in the admins' order. Pinned websites first, in the order they were pinned. */
function buildQueue({ sums, sites, cards, audits, set }) {
  const rows = [];
  sites.forEach((s) => {
    const sum = jparse(sums[s.id]);
    if (!sum || sum.err || !(set.scope === 'any' ? sum.n > 0 : sum.c > 0)) return;
    const card = cards[s.id];
    let back = false;
    if (card && card.state === 'queued') return; // sent by an admin: added below
    if (card) {
      // A finished website comes back when the auto audit, reading it again since, still finds errors.
      if (card.state !== 'complete' || !(sum.at > Date.parse(card.doneAt || 0) + DAY)) return;
      back = true;
    }
    // Somebody is already working on it outside the board.
    const a = audits[s.id];
    if (!card && a && a.assignee && /^(In progress|Complete with query)$/.test(a.status || '')) return;
    rows.push({ dudaId: s.id, name: s.name || s.domain || s.id, domain: s.domain || '', launched: Date.parse(s.first || s.created || '') || 0,
      n: sum.n || 0, c: sum.c || 0, readAt: sum.at || 0, back, pinned: (set.pins || []).includes(s.id), auditId: a ? a.id : '' });
  });
  // Websites an admin sent to the queue from Audits, whatever the auto audit says about them.
  const listed = new Map(sites.map((x) => [String(x.id), x]));
  Object.values(cards).filter((c) => c.state === 'queued').forEach((c) => {
    const x = listed.get(String(c.dudaId)) || {};
    const sum = jparse(sums[c.dudaId]) || {};
    rows.push({ dudaId: c.dudaId, name: c.name || x.name || c.dudaId, domain: c.domain || x.domain || '', launched: Date.parse(x.first || x.created || '') || 0,
      n: sum.n || 0, c: sum.c || 0, readAt: sum.at || 0, back: false, sent: c.sentByName || 'an admin', pinned: (set.pins || []).includes(c.dudaId), auditId: c.auditId || '' });
  });
  const by = {
    oldest: (a, b) => (a.launched || 9e15) - (b.launched || 9e15),
    newest: (a, b) => b.launched - a.launched,
    most: (a, b) => b.n - a.n || b.c - a.c,
    least: (a, b) => a.n - b.n || a.c - b.c,
  }[set.order] || ((a, b) => a.launched - b.launched);
  const pins = set.pins || [];
  rows.sort((a, b) => (a.pinned || b.pinned ? (a.pinned ? pins.indexOf(a.dudaId) : 1e9) - (b.pinned ? pins.indexOf(b.dudaId) : 1e9) : 0) || by(a, b) || a.name.localeCompare(b.name));
  return rows;
}

async function saveCard(card) { await redis(['HSET', CARDS, card.dudaId, JSON.stringify(card)]); }
function addLog(card, me, what, note) {
  (card.log = card.log || []).push({ at: now(), by: me.email, byName: me.name, what, note: note || '' });
  card.log = card.log.slice(-60);
}
/** The same line in the audit's own Activity tab, so the website's history is in one place. */
async function siteLog(auditId, me, text, name) {
  if (!auditId) return;
  const e = { id: newId(6), at: now(), by: me.email, byName: me.name, type: 'jaguars', text };
  await redis(['LPUSH', P + 'act:' + auditId, JSON.stringify(e)], ['LTRIM', P + 'act:' + auditId, 0, 299],
    ['LPUSH', P + 'uact:' + me.email, JSON.stringify(Object.assign({ siteKey: auditId, siteName: name || '' }, e))], ['LTRIM', P + 'uact:' + me.email, 0, 299]);
}

/** Put the audit in this person's hands (making the audit first if the website has none). */
async function holdAudit(card, me, to, toName, status) {
  let id = card.auditId;
  if (!id) {
    const [idx] = await redis(['HGETALL', P + 'index']);
    const mine = Object.values(flat(idx)).map((v) => jparse(v)).filter((s) => s && s.siteId === card.dudaId)
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];
    if (mine) id = mine.id;
    else {
      let host = await savedEditorHost();
      if (!host) { const any = Object.values(flat(idx)).map((v) => jparse(v)).find((s) => s && s.host); host = (any && any.host) || process.env.DEFAULT_EDITOR_HOST || ''; }
      const site = { id: newId(8), siteId: card.dudaId, host, editorUrl: `https://${host}/home/site/${card.dudaId}/home`, businessName: '', assignee: to, status: status || 'In progress',
        addedBy: me.email, addedByName: me.name, createdAt: now(), updatedAt: now(), findings: [], scan: { state: 'queued' }, people: [...new Set([me.email, to])] };
      await redis(['SET', P + 'site:' + site.id, packJSON(site)]);
      try { // what the auto audit already found arrives as audit items, as when an audit is added by hand
        const w = await import('./_watch.js');
        const [cw] = await redis(['GET', w.WKEY(card.dudaId)]);
        const r = jparse(cw);
        if (r && (r.issues || []).length) await w.syncAudit(site.id, r);
      } catch (e) { /* the audit is made either way */ }
      await saveIndex(site.id);
      card.auditId = site.id;
      return site.id;
    }
  }
  const [raw] = await redis(['GET', P + 'site:' + id]);
  const site = unpackJSON(raw);
  if (!site) { card.auditId = ''; return holdAudit(card, me, to, toName, status); }
  site.assignee = to; if (status) site.status = status; site.updatedAt = now();
  site.people = [...new Set([...(site.people || []), to])];
  await redis(['SET', P + 'site:' + id, packJSON(site)]);
  await saveIndex(id);
  card.auditId = id;
  return id;
}
async function setStatus(auditId, status) {
  if (!auditId) return;
  const [raw] = await redis(['GET', P + 'site:' + auditId]);
  const site = unpackJSON(raw); if (!site) return;
  site.status = status; site.updatedAt = now();
  await redis(['SET', P + 'site:' + auditId, packJSON(site)]);
  await saveIndex(auditId);
}
async function approvers() {
  const all = (await listUsers()).filter((u) => u.status === 'active' && u.role !== 'client');
  const ok = await Promise.all(all.map((u) => can(u, 'jags.lead').catch(() => false)));
  return all.filter((u, i) => ok[i]);
}
const tell = (email, me, card, kind, text, extra = {}) => (email && email !== me.email
  ? notifyUser(email, Object.assign({ by: me.email, byName: me.name, kind, siteId: card.auditId || '', siteName: card.name, dudaSite: card.dudaId, text }, extra)).catch(() => {})
  : null);

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const me = await requireUser(req, res);
  if (!me) return;
  const lead = await can(me, 'jags.lead');
  const taker = lead || (await can(me, 'jags.take'));
  if (!taker) return res.status(403).json({ error: 'Your role does not include the Jaguars board.' });
  try {
    if (req.method === 'GET') {
      const all = await readAll();
      const queue = buildQueue(all);
      // A Jaguar sees which websites are waiting, not what is wrong with them: the issues show once
      // they have taken one and scanned it.
      const q = queue.slice(0, 60).map((r) => (lead ? r : { dudaId: r.dudaId, name: r.name, domain: r.domain, launched: r.launched, back: r.back, pinned: r.pinned, sent: r.sent }));
      const cutoff = Date.now() - 30 * DAY;
      const cards = Object.values(all.cards).filter((c) => c.state !== 'complete' || Date.parse(c.doneAt || 0) > cutoff).map((c) => {
        const a = c.auditId ? Object.values(all.audits).find((x) => x.id === c.auditId) : null;
        const scanned = !!(a && a.scan && a.scan.finishedAt);
        return Object.assign({}, c, { scanned, scannedAt: scanned ? a.scan.finishedAt : '', progress: scanned ? progress(a) : null, log: lead || c.by === me.email ? c.log : (c.log || []).slice(-8) });
      });
      return res.status(200).json({ lead, me: me.email, settings: all.set, queue: q, queueTotal: queue.length, cards,
        holding: cards.filter((c) => c.state === 'progress' && c.by === me.email).length });
    }

    const b = readBody(req);
    const set = await settings();
    if (b.op === 'settings') {
      if (!lead) return res.status(403).json({ error: 'Only someone who runs the Jaguars board can change this.' });
      const next = Object.assign({}, set);
      if (ORDERS.includes(b.order)) next.order = b.order;
      if (b.scope === 'critical' || b.scope === 'any') next.scope = b.scope;
      if (typeof b.lock === 'boolean') next.lock = b.lock;
      if (b.limit !== undefined) next.limit = Math.max(1, Math.min(10, Number(b.limit) || 1));
      if (typeof b.peek === 'boolean') next.peek = b.peek;
      await redis(['SET', SET, JSON.stringify(next)]);
      await globalLog(me, 'jaguars', 'changed the Jaguars queue settings', {});
      return res.status(200).json({ settings: next });
    }
    if (b.op === 'pin') {
      if (!lead) return res.status(403).json({ error: 'Only someone who runs the Jaguars board can pin.' });
      const id = String(b.dudaId || '');
      const pins = (set.pins || []).filter((x) => x !== id);
      if (b.on) pins.push(id);
      await redis(['SET', SET, JSON.stringify(Object.assign({}, set, { pins: pins.slice(-50) }))]);
      return res.status(200).json({ ok: true });
    }

    if (b.op === 'send') {
      // From Audits: an admin hands an audit (often half done) to the Jaguars — into the queue, or
      // straight to one of them. Whatever was already fixed stays fixed.
      if (!lead) return res.status(403).json({ error: 'Only someone who runs the Jaguars board can send audits to it.' });
      const [ix] = await redis(['HGET', P + 'index', String(b.auditId || '')]);
      const a = jparse(ix);
      if (!a || !a.siteId) return res.status(404).json({ error: 'That audit is not here.' });
      const [raw0] = await redis(['HGET', CARDS, a.siteId]);
      const old = jparse(raw0);
      if (old && ['progress', 'review'].includes(old.state)) return res.status(409).json({ error: `Already on the board: ${old.state === 'review' ? 'waiting for review' : 'with ' + old.byName}.` });
      const note = noteOf(b.note);
      const to = String(b.to || '').toLowerCase();
      const card = { dudaId: a.siteId, name: a.businessName || (old && old.name) || a.siteId, domain: (old && old.domain) || '', auditId: a.id,
        round: ((old && old.round) || 0) + (to ? 1 : 0), log: (old && old.log) || [], sentBy: me.email, sentByName: me.name };
      if (to) {
        const u = (await listUsers()).find((x) => x.email === to && x.status === 'active' && x.role !== 'client');
        if (!u) return res.status(400).json({ error: 'Pick someone on the team.' });
        Object.assign(card, { state: 'progress', by: u.email, byName: u.name, takenAt: now() });
        addLog(card, me, `sent it from Audits to ${u.name}`, note);
        await holdAudit(card, me, u.email, u.name, 'In progress');
        await saveCard(card);
        await siteLog(card.auditId, me, `sent this website to the Jaguars board, to ${u.name}${note ? ': ' + note : ''}`, card.name);
        await tell(u.email, me, card, 'jag-assign', `${me.name} gave you ${card.name} on the Jaguars board${note ? ': ' + note : ''}`);
        return res.status(200).json({ card });
      }
      Object.assign(card, { state: 'queued', by: '', byName: '', takenAt: '' });
      addLog(card, me, 'sent it from Audits to the queue', note);
      await saveCard(card);
      { // in the queue it is nobody's until a Jaguar takes it
        const [r0] = await redis(['GET', P + 'site:' + card.auditId]);
        const st = unpackJSON(r0);
        if (st) { st.assignee = ''; st.status = 'Not started'; st.updatedAt = now(); await redis(['SET', P + 'site:' + card.auditId, packJSON(st)]); await saveIndex(card.auditId); }
      }
      await siteLog(card.auditId, me, 'sent this website to the Jaguars queue' + (note ? ': ' + note : ''), card.name);
      return res.status(200).json({ card });
    }

    if (b.op === 'take') {
      const all = await readAll();
      const mineNow = Object.values(all.cards).filter((c) => c.state === 'progress' && c.by === me.email).length;
      if (!lead && mineNow >= set.limit) return res.status(409).json({ error: set.limit === 1 ? 'Finish the website you have first.' : `You already have ${mineNow} websites — finish one first.` });
      const queue = buildQueue(all);
      if (!queue.length) return res.status(404).json({ error: 'The queue is empty.' });
      let pick = queue[0];
      if (b.dudaId && b.dudaId !== pick.dudaId) {
        if (set.lock && !lead) return res.status(409).json({ error: 'First in, first out: take the website at the top of the queue.' });
        pick = queue.find((r) => r.dudaId === b.dudaId);
        if (!pick) return res.status(404).json({ error: 'That website is not in the queue any more.' });
      }
      const old = all.cards[pick.dudaId];
      const card = { dudaId: pick.dudaId, name: pick.name, domain: pick.domain, auditId: pick.auditId || (old && old.auditId) || '', state: 'progress', by: me.email, byName: me.name,
        takenAt: now(), contactErrors: pick.n, round: ((old && old.round) || 0) + 1, log: (old && old.log) || [] };
      // Two people pressing Take next at the same moment: only one gets it.
      const [got] = await redis(['SET', P + 'jag:taking:' + pick.dudaId, me.email, 'NX', 'EX', 20]);
      if (got !== 'OK') return res.status(409).json({ error: 'Someone took that website a moment ago. Try again.' });
      const [fresh] = await redis(['HGET', CARDS, pick.dudaId]);
      const f = jparse(fresh);
      if (f && !['complete', 'queued'].includes(f.state)) return res.status(409).json({ error: 'Someone took that website a moment ago. Try again.' });
      await holdAudit(card, me, me.email, me.name, 'In progress');
      addLog(card, me, pick.back ? 'took it from the queue again (the live website still has errors)' : 'took it from the queue');
      await saveCard(card);
      await siteLog(card.auditId, me, 'took this website from the Jaguars queue', card.name);
      return res.status(200).json({ card });
    }

    if (b.op === 'unpeek') {
      const auditId = String(b.auditId || '');
      const [raw2] = await redis(['GET', P + 'site:' + auditId]);
      const site = unpackJSON(raw2); if (!site) return res.status(404).json({ error: 'The audit is gone.' });
      const w = (site.watchers || []).find((x) => x.email === me.email && x.how === 'peek');
      if (!w) return res.status(404).json({ error: 'You are not watching this website.' });
      site.watchers = site.watchers.filter((x) => x !== w);
      await redis(['SET', P + 'site:' + auditId, packJSON(site)]);
      await siteLog(auditId, me, 'stopped watching this website', site.businessName || site.siteId);
      await saveIndex(auditId);
      return res.status(200).json({ ok: true });
    }

    const id = String(b.dudaId || '');
    const [raw] = await redis(['HGET', CARDS, id]);
    const card = jparse(raw);
    if (!card) return res.status(404).json({ error: 'That website is not on the board.' });
    const holder = card.by === me.email;

    if (b.op === 'hold') {
      // Stuck on something only somebody else can answer: the website waits in Needs review with
      // the reason, and the Jaguar is free to take the next one.
      if (!holder && !lead) return res.status(403).json({ error: 'Only the person holding this website can put it on hold.' });
      if (card.state !== 'progress') return res.status(409).json({ error: 'This website is not in progress.' });
      const note = noteOf(b.note);
      if (note.length < 3) return res.status(400).json({ error: 'Write why it is on hold (what needs clarifying).' });
      card.state = 'review'; card.hold = { note, at: now(), by: me.email, byName: me.name }; card.reasons = ['On hold: ' + note];
      addLog(card, me, 'put it on hold', note);
      await saveCard(card);
      await setStatus(card.auditId, 'On hold');
      await siteLog(card.auditId, me, 'put the Jaguars task on hold: ' + note, card.name);
      const who = await approvers();
      await Promise.all(who.map((u) => tell(u.email, me, card, 'jag-review', `${me.name} put ${card.name} on hold: ${note}`)));
      return res.status(200).json({ card });
    }
    if (b.op === 'resume') {
      if (!lead && !holder) return res.status(403).json({ error: 'Only an admin or the person who held it can resume it.' });
      if (card.state !== 'review' || !card.hold) return res.status(409).json({ error: 'This website is not on hold.' });
      const note = noteOf(b.note);
      card.state = 'progress'; card.reasons = []; card.hold = null;
      addLog(card, me, 'took it off hold', note);
      await saveCard(card);
      await setStatus(card.auditId, 'In progress');
      await siteLog(card.auditId, me, 'took the Jaguars task off hold' + (note ? ': ' + note : ''), card.name);
      await tell(card.by, me, card, 'jag-back', `${me.name} took ${card.name} off hold${note ? ': ' + note : ''}`);
      return res.status(200).json({ card });
    }
    if (b.op === 'peek') {
      // Look over a teammate's shoulder: read-only, on your Audits list until you stop watching.
      if (!lead && !set.peek) return res.status(403).json({ error: 'Peeking is switched off. An admin can turn it on in Tasks.' });
      if (!card.auditId) return res.status(409).json({ error: 'This website has no audit yet.' });
      if (holder) return res.status(400).json({ error: 'This one is yours already.' });
      const [raw2] = await redis(['GET', P + 'site:' + card.auditId]);
      const site = unpackJSON(raw2); if (!site) return res.status(404).json({ error: 'The audit is gone.' });
      const inAlready = [].concat(site.people || [], site.assignee || '', site.addedBy || '').includes(me.email) || (site.watchers || []).some((w) => w.email === me.email);
      if (!inAlready) {
        site.watchers = (site.watchers || []).concat({ email: me.email, name: me.name, how: 'peek', at: now() });
        await redis(['SET', P + 'site:' + card.auditId, packJSON(site)]);
        await siteLog(card.auditId, me, 'started watching this website (peeked from Tasks, read-only)', card.name);
        await saveIndex(card.auditId);
      }
      return res.status(200).json({ auditId: card.auditId });
    }
    if (b.op === 'done') {
      if (!holder && !lead) return res.status(403).json({ error: 'Only the person holding this website can finish it.' });
      if (card.state !== 'progress') return res.status(409).json({ error: 'This website is not in progress.' });
      const sum = await saveIndex(card.auditId);
      if (!sum) return res.status(404).json({ error: 'The audit for this website is gone.' });
      const scanAt = Date.parse((sum.scan && sum.scan.finishedAt) || 0);
      if (!scanAt || scanAt < Date.parse(card.takenAt)) return res.status(409).json({ error: 'Scan the website first.', need: 'scan' });
      const [fs] = await redis(['HGETALL', P + 'fstate:' + card.auditId]);
      const states = Object.values(flat(fs)).map((v) => jparse(v)).filter(Boolean);
      const lastFix = Math.max(0, ...states.filter((s) => s.status === 'done' && !s.auto).map((s) => Date.parse(s.updatedAt || 0) || 0));
      if (lastFix > scanAt) return res.status(409).json({ error: 'Rescan first: items were marked fixed after the last scan, and the rescan confirms the fixes are really on the website.', need: 'scan' });
      const p = progress(sum);
      const left = p.open - p.clar;
      if (left > 0) return res.status(409).json({ error: `${left} item${left === 1 ? ' is' : 's are'} still open. Everything has to be fixed, including Design polish and Lengths.`, need: 'fix' });
      const falseNow = states.filter((s) => s.status === 'false' && !s.auto && Date.parse(s.updatedAt || 0) >= Date.parse(card.takenAt)).length;
      const reasons = [];
      if (falseNow) reasons.push(`${falseNow} false alarm${falseNow === 1 ? '' : 's'}`);
      if (p.clar) reasons.push(`${p.clar} needing clarification`);
      if (p.hold) reasons.push(`${p.hold} on hold`);
      card.doneAt = now();
      if (reasons.length) {
        card.state = 'review'; card.reasons = reasons;
        addLog(card, me, 'finished and sent it for review: ' + reasons.join(', '), noteOf(b.note));
        await saveCard(card);
        await setStatus(card.auditId, 'Complete with query');
        await siteLog(card.auditId, me, 'finished the Jaguars task; sent for review (' + reasons.join(', ') + ')', card.name);
        const who = await approvers();
        await Promise.all(who.map((u) => tell(u.email, me, card, 'jag-review', `${me.name} finished ${card.name} and it needs your review: ${reasons.join(', ')}`)));
        return res.status(200).json({ card, review: true });
      }
      card.state = 'complete'; card.reasons = [];
      addLog(card, me, 'finished it: everything fixed and confirmed by a rescan', noteOf(b.note));
      await saveCard(card);
      await setStatus(card.auditId, 'Complete');
      await siteLog(card.auditId, me, 'finished the Jaguars task: everything fixed', card.name);
      return res.status(200).json({ card, review: false });
    }

    if (b.op === 'approve' || b.op === 'sendback') {
      if (!lead) return res.status(403).json({ error: 'Your role does not allow approving Jaguar audits.' });
      if (card.state !== 'review') return res.status(409).json({ error: 'This website is not waiting for review.' });
      if (b.op === 'approve' && card.hold) return res.status(409).json({ error: 'This website is on hold: take it off hold, hand it on, or put it back in the queue.' });
      const note = noteOf(b.note);
      if (b.op === 'sendback') {
        if (note.length < 3) return res.status(400).json({ error: 'Say what still needs doing.' });
        card.state = 'progress'; card.doneAt = ''; card.hold = null;
        addLog(card, me, 'sent it back', note);
        await saveCard(card);
        await setStatus(card.auditId, 'In progress');
        await siteLog(card.auditId, me, 'sent the Jaguars task back: ' + note, card.name);
        await tell(card.by, me, card, 'jag-back', `${me.name} sent ${card.name} back to you: ${note}`);
        return res.status(200).json({ card });
      }
      card.state = 'complete'; card.doneAt = now(); card.approvedBy = me.name;
      addLog(card, me, 'approved it', note);
      await saveCard(card);
      await setStatus(card.auditId, 'Complete');
      await siteLog(card.auditId, me, 'approved the Jaguars task' + (note ? ': ' + note : ''), card.name);
      await tell(card.by, me, card, 'jag-approved', `${me.name} approved your work on ${card.name}${note ? ': ' + note : ''}`);
      return res.status(200).json({ card });
    }

    if (b.op === 'reassign') {
      if (!holder && !lead) return res.status(403).json({ error: 'Only the person holding this website, or an admin, can hand it on.' });
      if (card.state === 'complete') return res.status(409).json({ error: 'This website is finished.' });
      const note = noteOf(b.note);
      if (note.length < 3) return res.status(400).json({ error: 'Write why you are handing the whole website on.' });
      const to = String(b.to || '').toLowerCase();
      const u = (await listUsers()).find((x) => x.email === to && x.status === 'active' && x.role !== 'client');
      if (!u) return res.status(400).json({ error: 'Pick someone on the team.' });
      if (u.email === card.by) return res.status(400).json({ error: 'They already have it.' });
      const from = card.byName;
      card.by = u.email; card.byName = u.name;
      if (card.state === 'review') { card.state = 'progress'; card.hold = null; card.reasons = []; }
      addLog(card, me, `handed it to ${u.name} (was ${from})`, note);
      await holdAudit(card, me, u.email, u.name, 'In progress');
      await saveCard(card);
      await siteLog(card.auditId, me, `handed the Jaguars task to ${u.name} (was ${from}): ${note}`, card.name);
      await tell(u.email, me, card, 'jag-assign', `${me.name} handed ${card.name} to you: ${note}`);
      return res.status(200).json({ card });
    }

    if (b.op === 'release') {
      if (!holder && !lead) return res.status(403).json({ error: 'Only the person holding this website, or an admin, can put it back.' });
      const note = noteOf(b.note);
      if (note.length < 3) return res.status(400).json({ error: 'Write why it goes back to the queue.' });
      // Its history stays in the audit's Activity tab; on the board it simply waits in the queue again.
      await redis(['HDEL', CARDS, id]);
      await setStatus(card.auditId, 'Not started');
      await siteLog(card.auditId, me, 'put the website back in the Jaguars queue: ' + note, card.name);
      if (card.by !== me.email) await tell(card.by, me, card, 'jag-assign', `${me.name} put ${card.name} back in the queue: ${note}`);
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'Unknown op' });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Something went wrong' });
  }
}

export default metered('jags', handler);
