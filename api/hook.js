// Duda webhook receiver — the app's ear on the Duda account.
//
// POST /api/hook?k=<DUDA_HOOK_KEY>
//
// Duda sends these for the WHOLE account, for every website in it, published or not. Nothing is
// switched on per website: a site that has never been added to the Audits list still arrives here,
// which is the point — client comments usually happen on drafts, before a site is published.
//
// Setting it up: an admin clicks Connect on the Duda comments page. The app makes its own secret,
// registers this address with Duda for the whole account, and that is the whole job — nothing to
// set by hand and nothing to request from Duda. (DUDA_HOOK_KEY overrides the made-up secret if the
// owner prefers to choose it; DUDA_HOOK_SECRET turns on Duda's signature checking where the account
// has that feature.)
//
// Events we ask for:
//   NEW_CONVERSATION, NEW_COMMENT, CONVERSATION_UPDATED, COMMENT_EDITED, COMMENT_DELETED
//   PUBLISH, UNPUBLISH, CONTACT_FORM_SENT_V2
//   DOMAIN_UPDATED, CERTIFICATE_CREATED, SITE_CREATED, SITE_RESTORED, SITE_RESET, SITE_TEMPLATE_SWITCHED
//
// Nothing here answers slowly: Duda retries anything that doesn't return quickly, so the handler
// writes what it was told and gets out. Names, page paths and who-is-who are worked out when
// somebody actually looks at the Comments page.
import crypto from 'node:crypto';
import { redis, P, now, newId, jparse, ablyPublish, commentsChannel, unescapeHtml } from './_lib.js';
import { enqueue } from './_queue.js';
import { normalise, readFields, liveLeadAdd, addLeads, usingSql } from './_leads.js';
import { evLine, evCmds } from './_pubhist.js';
import { certificateFailed } from './_domains.js';

const MAX_COMMENTS = 60;      // per conversation, oldest dropped

// The secret that has to be in the address. The app makes one for itself the first time it is
// connected, so there is nothing to set up by hand; an owner who prefers to set it themselves can,
// and that wins. Cached briefly because every delivery reads it.
let keyCache = { v: '', at: 0 };
async function hookKey() {
  if (process.env.DUDA_HOOK_KEY) return process.env.DUDA_HOOK_KEY;
  if (keyCache.v && Date.now() - keyCache.at < 60000) return keyCache.v;
  try { const [k] = await redis(['GET', P + 'hookkey']); keyCache = { v: k || '', at: Date.now() }; return k || ''; }
  catch (e) { return keyCache.v; }
}
const LOG_KEEP = 300;         // recent deliveries, for the owner's troubleshooting page

/** The exact bytes Duda sent, which is what the signature is over. */
async function rawBody(req) {
  if (typeof req.rawBody === 'string') return req.rawBody;
  if (req.readableEnded || req.complete) return null;
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    return Buffer.concat(chunks).toString('utf8');
  } catch (e) { return null; }
}

/** Duda's HMAC: base64( sha256( timestamp + "." + body, base64decode(secret) ) ) */
function signatureOk(secret, timestamp, body, given) {
  try {
    const mac = crypto.createHmac('sha256', Buffer.from(secret, 'base64')).update(`${timestamp}.${body}`).digest();
    const mine = Buffer.from(mac.toString('base64'));
    const theirs = Buffer.from(String(given || ''));
    return mine.length === theirs.length && crypto.timingSafeEqual(mine, theirs);
  } catch (e) { return false; }
}

const str = (x) => (x == null ? '' : String(x));
const iso = (ms) => (ms ? new Date(Number(ms)).toISOString() : now());

/**
 * Every site we hear about gets a watch record, whether or not it is in the Audits list.
 * It holds no name yet — that is filled in from Duda the first time somebody opens the page.
 */
function watchPatch(prev, siteId, at, changes) {
  const w = prev || { id: siteId, name: '', firstSeen: at, needName: true };
  w.lastEvent = at;
  return Object.assign(w, changes);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const key = await hookKey();
  // Not connected yet, or the wrong secret: behave as though the address does not exist.
  if (!key || str(req.query && req.query.k) !== key) { res.status(404).json({ error: 'Not found' }); return; }
  if (req.method === 'GET') { res.status(200).json({ ok: true, listening: true }); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST' }); return; }

  const body = await rawBody(req);
  let payload = null;
  if (body) { payload = jparse(body); } else if (req.body && typeof req.body === 'object') { payload = req.body; }
  if (!payload) { res.status(200).json({ ok: true, ignored: 'unreadable' }); return; }

  // Signature, when Duda has given us a secret for it (their managed-account feature).
  const secret = process.env.DUDA_HOOK_SECRET || '';
  let verified = null;
  if (secret) {
    const ts = str(req.headers['x-duda-signature-timestamp']);
    const sig = str(req.headers['x-duda-signature']);
    if (body == null) verified = 'unchecked';     // body already consumed upstream: record it, flag it
    else if (signatureOk(secret, ts, body, sig)) verified = 'ok';
    else { res.status(401).json({ error: 'Bad signature' }); return; }
  }

  const events = Array.isArray(payload) ? payload : [payload];
  const cmds = [];
  let touched = 0;
  let sawComment = false;
  const queued = [];   // websites that just went live and want their form history
  const liveSql = [];  // live enquiries bound for the analysis database
  const historyLines = []; // publish history for the Trends tab
  const certFails = [];    // security certificates Duda could not issue

  for (const ev of events) {
    const type = str(ev.event_type).toUpperCase();
    const siteId = str(ev.resource_data && ev.resource_data.site_name);
    if (!siteId) continue;
    const at = iso(ev.event_timestamp);
    const by = str(ev.source && ev.source.account_name).toLowerCase();
    const d = ev.data || {};
    touched++;

    // ---- comments -------------------------------------------------------
    if (/^(NEW_CONVERSATION|NEW_COMMENT|CONVERSATION_UPDATED|COMMENT_EDITED|COMMENT_DELETED)$/.test(type)) {
      const cu = str(d.conversation_uuid);
      if (!cu) continue;
      sawComment = true;
      const ctx = d.conversation_context || {};
      const [rawConv] = await redis(['HGET', P + 'conv:' + siteId, cu]);
      // A thread we meet for the first time through a REPLY started before we were listening, so we
      // will never have its opening comment, its page or its number. Say so rather than showing the
      // tail as though it were the whole conversation.
      const conv = jparse(rawConv) || { u: cu, site: siteId, at, comments: [], partial: type !== 'NEW_CONVERSATION' };
      if (ctx.page_uuid) conv.page = str(ctx.page_uuid);
      if (ctx.device) conv.device = str(ctx.device);
      if (ctx.conversation_number) conv.num = Number(ctx.conversation_number) || conv.num;
      if (d.conversation_properties && d.conversation_properties.status) conv.status = str(d.conversation_properties.status).toLowerCase();

      const cm = d.comment || {};
      const cid = str(cm.uuid);
      if (type === 'COMMENT_DELETED') {
        conv.comments = (conv.comments || []).map((c) => (c.u === cid ? Object.assign(c, { deleted: true, text: '' }) : c));
      } else if (type === 'COMMENT_EDITED') {
        conv.comments = (conv.comments || []).map((c) => (c.u === cid ? Object.assign(c, { text: unescapeHtml(cm.text), edited: at }) : c));
      } else if (cid || cm.text) {
        const seen = (conv.comments || []).some((c) => c.u && c.u === cid);
        if (!seen) conv.comments = [...(conv.comments || []), { u: cid || newId(6), text: unescapeHtml(cm.text), by, at }].slice(-MAX_COMMENTS);
      }
      // Who spoke last decides whether anyone still owes the client an answer — and a comment that
      // has been deleted, or that never carried any words, is not somebody speaking. A conversation
      // with nothing left in it is empty: it must not be counted, shown, or alerted about.
      const live = (conv.comments || []).filter((c) => !c.deleted && String(c.text || '').trim());
      const tail = live[live.length - 1];
      // Deleting the last comment must not look like fresh activity, so the clock stays where the
      // last real comment left it.
      conv.last = tail ? tail.at : (conv.at || at);
      conv.lastBy = tail ? tail.by : '';
      conv.live = live.length;
      conv.updatedAt = at;
      if (!conv.status) conv.status = 'open';

      cmds.push(['HSET', P + 'conv:' + siteId, cu, JSON.stringify(conv)]);
      // A small index row per conversation, so one read answers "what is waiting, across every site".
      // A short tail of "when, and who from", so the lists can count the individual comments somebody
      // hasn't seen and say how many came from the client and how many from us. Kept tiny on purpose:
      // the last few only, seconds in base 36, because this index is read whole on every page load.
      const tl = live.slice(-10).map((c) => Math.floor(Date.parse(c.at || conv.last) / 1000).toString(36) + '|' + String(c.by || '').slice(0, 60)).join(',');
      cmds.push(['HSET', P + 'convidx', cu, JSON.stringify({
        s: siteId, n: conv.num || 0, d: conv.device || '', st: conv.status, pt: conv.partial ? 1 : 0,
        live: live.length, tl,
        la: conv.last, lb: conv.lastBy || '', tx: unescapeHtml(tail && tail.text).slice(0, 160),
      })]);
      const [rawW] = await redis(['HGET', P + 'watch', siteId]);
      cmds.push(['HSET', P + 'watch', siteId, JSON.stringify(watchPatch(jparse(rawW), siteId, at, { lastComment: at }))]);
      // Everyone who has ever commented, in one place. Duda has no endpoint that lists the people in
      // an account, but it will answer about any one of them — so the list of who to ask about is
      // built here, from whoever actually turns up.
      if (by) cmds.push(['HSET', P + 'cmtauthors', by, at]);
      continue;
    }

    // ---- everything else: remembered against the site ---------------------
    const [rawW] = await redis(['HGET', P + 'watch', siteId]);
    const patch = {};
    if (type === 'PUBLISH') {
      patch.published = at;
      // The moment a website goes live it may have a form that has been collecting since before we
      // ever saw it. Queueing here is what makes "audited before it launched" and "live for a year"
      // end up in the same place: the history is waiting by the time anyone looks.
      queued.push(siteId);
    }
    if (type === 'UNPUBLISH') patch.published = '';
    if (type === 'SITE_CREATED') patch.created = at;
    cmds.push(['HSET', P + 'watch', siteId, JSON.stringify(watchPatch(jparse(rawW), siteId, at, patch))]);

    // The publish history behind the Trends tab. Duda's own flags say what kind of publish this was:
    // first_publish = a launch, republish = an update to a live website, neither = live again after
    // being unpublished.
    const ms = Date.parse(at);
    if (type === 'PUBLISH') {
      const kind = d.first_publish === true ? 'L' : d.republish === true ? 'R' : (d.first_publish === false && d.republish === false) ? 'B' : 'P';
      historyLines.push([ms, evLine(kind, siteId, ms, 'w')]);
    }
    if (type === 'UNPUBLISH') historyLines.push([ms, evLine('U', siteId, ms, 'w')]);
    if (type === 'DOMAIN_UPDATED') {
      historyLines.push([ms, evLine('D', siteId, ms, 'w', str(d.domain))]);
      // A new address deserves a fresh look, rather than waiting a week for the next check.
      cmds.push(['HDEL', P + 'domstat', siteId]);
    }
    // Duda tried to issue the website's security certificate and could not: visitors are about to
    // see a browser warning. Admins are told straight away (after the delivery is answered).
    if (type === 'CERTIFICATE_CREATED' && str(d.deployment_status).toUpperCase() === 'FAILED') {
      certFails.push({ siteId, domains: [].concat(d.domains || []).map(str).filter(Boolean).slice(0, 5), at });
    }

    if (type === 'CONTACT_FORM_SENT_V2') {
      // Proof that a form really submitted — one of the QA checklist items.
      const f = d.form_data || d || {};
      cmds.push(['HSET', P + 'formhit:' + siteId, str(f.form_name || f.formName || 'form'), JSON.stringify({ at, page: str(f.page || f.url || '') })]);
      // …and the submission itself. Duda keeps the original, so anything we fail to read here is
      // recoverable by a backfill — which is why this never throws the delivery away.
      try {
        const fd = f.fieldsData || f.fields_data || f.fields || f.data || d.fieldsData || [];
        const lead = normalise({
          id: str(f.id || f.uuid || d.id || ''), at,
          fields: readFields(fd),
          page: str(f.pageName || f.page_name || f.page || d.pageName || ''),
          form: str(f.form_name || f.formName || ''),
          source: [str(f.utm_source || d.utm_source || ''), str(f.utm_medium || d.utm_medium || '')].filter(Boolean).join('/'),
        }, 'hook');
        if (lead.n || lead.e || lead.p || Object.keys(lead.f).length) {
          // With the analysis database connected, that is where every page reads enquiries from. A live
          // enquiry written only to the old store would arrive and never be seen.
          if (usingSql()) liveSql.push([siteId, lead]);
          else cmds.push(...await liveLeadAdd(siteId, lead));
        }
      } catch (e) { /* a malformed payload must never cost us the rest of the delivery */ }
    }
    cmds.push(['LPUSH', P + 'sitefeed:' + siteId, JSON.stringify({ type, at, by })], ['LTRIM', P + 'sitefeed:' + siteId, 0, 99]);
  }

  // Queued outside the command batch on purpose: enqueue reads what is already waiting, and a
  // webhook delivery must never fail because a background nicety did.
  if (queued.length) await enqueue(queued, 'published').catch(() => {});
  for (const [site, lead] of liveSql) await addLeads(site, [lead]).catch(() => {});

  if (touched) {
    cmds.push(...evCmds(historyLines));
    cmds.push(['LPUSH', P + 'hooklog', JSON.stringify({ at: now(), n: touched, types: events.map((e) => str(e.event_type)).slice(0, 8), verified })],
      ['LTRIM', P + 'hooklog', 0, LOG_KEEP - 1]);
    // Only a comment event moves the comment version. Every open tab reloads the whole comment list
    // when this number changes, so bumping it for publishes and form submissions too made each of
    // those cost a full reload in every open browser.
    if (sawComment) cmds.push(['INCR', P + 'ver:cmt']);
    try { await redis(...cmds); } catch (e) { res.status(500).json({ error: 'store' }); return; }
    // Nudge every open browser so a comment appears in a second rather than on the next heartbeat.
    if (sawComment) { try { await ablyPublish(commentsChannel(), 'cmt', { at: now() }); } catch (e) { /* the heartbeat still catches it */ } }
  }
  for (const f of certFails) await certificateFailed(f).catch(() => {});
  res.status(200).json({ ok: true, handled: touched });
}
