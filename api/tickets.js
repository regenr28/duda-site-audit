// Client change requests.
//
// Clients (and the team previewing as a client):
//   GET  ?op=mine&site=          their website's requests + today's allowance
//   GET  ?op=quota&site=         today's allowance, and how many requests have news for them
//   POST { op:'create', … }      send one marked-up request (each mark is its own request)
//   POST { op:'creply', id, text }   answer the team on a request
//   POST { op:'seen', site }     they have looked at the updates
// Both (the cropped picture of a request):
//   GET  ?op=img&id=
// The team:
//   GET  ?op=list[&site=]        newest 500      GET ?op=get&id=      GET ?op=count
//   POST { op:'status', ids, status }   { op:'reply', id, text }   { op:'note', id, text }
//   POST { op:'assign', ids, email }    { op:'checked', id, result, now }   { op:'opened', id }
//   GET/POST ?op=settings        admins: daily allowance, who is told, emails to clients
import { redis, P, newId, now, unpackJSON, listUsers, listRoles, canWith, notifyUser, globalLog, sendEmail, emailEnabled, emailShell,
  esc, appUrl, readBody, normEmail } from './_lib.js';
import { who, mayseeSite, settings, saveSettings, quota, today, getCap, keepCapCmds, getTickets, listIds, putTicketCmd, newSetCmd,
  clientTicket, teamTicket, STATUSES, KINDS, TZ, cleanPath, cleanReplay, siteRec as tkSiteRec } from './_tickets.js';
import { DEVICES } from './_devices.js';

const MAX_CROP = 1.6 * 1024 * 1024;
const num = (v) => Number.isFinite(Number(v)) ? Math.round(Number(v) * 10) / 10 : null;

// The website's record, or (for one not on Audits) what the Duda list says about it.
const siteRec = (id) => tkSiteRec(id);
/** Who on the team hears about a new request: the chosen list, or everyone who may answer them. */
async function recipients(cfg) {
  const [users, roles] = await Promise.all([listUsers(), listRoles()]);
  const active = users.filter((u) => u.status === 'active' && u.role !== 'client');
  if ((cfg.notify || []).length) return active.filter((u) => cfg.notify.includes(normEmail(u.email))).map((u) => u.email);
  const roleOf = (id) => roles.find((r) => r.id === id) || roles.find((r) => r.id === 'member');
  return active.filter((u) => canWith(roleOf(u.role), u, 'ticket.manage')).map((u) => u.email);
}
function cleanGeo(kind, g, cap) {
  if (!g || typeof g !== 'object') return null;
  const W = cap.w, H = cap.h;
  const cx = (v, m) => Math.max(-50, Math.min(m + 50, v));
  if (kind === 'arrow') {
    const o = { x1: num(g.x1), y1: num(g.y1), x2: num(g.x2), y2: num(g.y2) };
    if (Object.values(o).some((v) => v === null)) return null;
    return { x1: cx(o.x1, W), y1: cx(o.y1, H), x2: cx(o.x2, W), y2: cx(o.y2, H) };
  }
  const o = { x: num(g.x), y: num(g.y), w: num(g.w), h: num(g.h) };
  if (Object.values(o).some((v) => v === null) || o.w < 0 || o.h < 0) return null;
  return { x: cx(o.x, W), y: cx(o.y, H), w: Math.min(o.w, W + 100), h: Math.min(o.h, H + 100) };
}
function editorLink(t) {
  if (!t.host || !t.dudaSite) return '';
  const page = !t.path || t.path === '/' ? 'home' : t.path.replace(/^\/+/, '');
  return `https://${t.host}/home/site/${t.dudaSite}/${page}`;
}
async function emailClient(cfg, t, subject, line) {
  if (!cfg.emailClients || !emailEnabled() || !t.by) return;
  const link = `${appUrl()}/#/my/${encodeURIComponent(t.site)}/requests`;
  const body = `<p>${line}</p>
    <div style="border:1px solid #e3e5ea;border-radius:10px;padding:12px 14px;margin:14px 0;color:#444"><b>Ticket #${t.num}</b> · ${esc(t.path || '/')}<br>${esc(String(t.text || '').slice(0, 300))}</div>
    <p><a href="${esc(link)}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">See your tickets</a></p>`;
  await sendEmail(t.by, subject, emailShell(subject, body)).catch(() => {});
}
const DEVICE_WORD = { desktop: 'desktop', tablet: 'tablet', mobile: 'phone' };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const w = await who(req, res);
  if (!w) return;
  appUrl(req);
  const b = req.method === 'GET' ? {} : (readBody(req) || {});
  const op = String((req.method === 'GET' ? req.query.op : b.op) || '');
  try {
    // ---------------- the cropped picture: client or team ----------------
    if (op === 'img') {
      const id = String(req.query.id || '');
      if (!/^[\w-]{6,40}$/.test(id)) return res.status(400).end();
      const [raw, img] = await redis(['GET', P + 'tk:' + id], ['GET', P + 'tkimg:' + id]);
      const t = raw ? JSON.parse(raw) : null;
      if (!t || !mayseeSite(w, t.site) || !img) return res.status(404).end();
      const { type, data } = JSON.parse(img);
      res.setHeader('Content-Type', type);
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      return res.status(200).end(Buffer.from(data, 'base64'));
    }

    // ---------------- the client's side ----------------
    if (w.client) {
      const site = String((req.method === 'GET' ? req.query.site : b.site) || '');
      if (op === 'quota' || op === 'mine') {
        if (!mayseeSite(w, site)) return res.status(404).json({ error: 'Not found' });
        const q = await quota(w.me.email);
        const all = await getTickets(await listIds(site, 300));
        if (op === 'quota') return res.status(200).json({ quota: q, preview: w.preview, unread: all.filter((t) => t.cu).length, total: all.length });
        return res.status(200).json({ tickets: all.map((t) => clientTicket(t, w.me)), quota: q, preview: w.preview, statuses: Object.fromEntries(Object.entries(STATUSES).map(([k, v]) => [k, v.client])) });
      }
      if (op === 'seen') {
        if (!mayseeSite(w, site)) return res.status(404).json({ error: 'Not found' });
        if (w.preview) return res.status(200).json({ ok: true });
        const all = (await getTickets(await listIds(site, 300))).filter((t) => t.cu);
        all.forEach((t) => { t.cu = false; });
        if (all.length) await redis(...all.map(putTicketCmd));
        return res.status(200).json({ ok: true, cleared: all.length });
      }
      if (op === 'create') {
        if (!mayseeSite(w, site)) return res.status(404).json({ error: 'Not found' });
        if (w.preview) return res.status(403).json({ error: 'Sending is switched off while you are previewing as the client — nothing reaches the team from here.', preview: true });
        const cid = String(b.cid || '');
        if (!/^[\w-]{8,48}$/.test(cid)) return res.status(400).json({ error: 'Something went wrong preparing this request. Please try again.' });
        // The same request sent twice (a retry after the signal dropped) is one request.
        const [claim] = await redis(['SET', P + 'tkcid:' + cid, 'pending', 'NX', 'EX', 259200]);
        if (!claim) {
          const [had] = await redis(['GET', P + 'tkcid:' + cid]);
          if (had && had !== 'pending') { const [t] = await getTickets([had]); if (t) return res.status(200).json({ ticket: clientTicket(t, w.me), again: true, quota: await quota(w.me.email) }); }
          return res.status(409).json({ error: 'Still sending — one moment.', retry: true });
        }
        const fail = async (code, body) => { await redis(['DEL', P + 'tkcid:' + cid]).catch(() => {}); return res.status(code).json(body); };
        // Two kinds of ticket: a general question (just words, maybe a photo), or a website change
        // marked on a picture of the page.
        const isQ = b.type === 'question';
        // Marked on the live website: there is no picture yet — it is taken right after, without the client waiting.
        const isLive = !isQ && !!b.live;
        let cap = null, kind = 'question', geo = null, livePage = null;
        if (isLive) {
          const device = DEVICES[b.device] ? b.device : 'desktop';
          const path = cleanPath(b.path);
          if (!path) return fail(400, { error: 'That page address is not valid.' });
          livePage = { path, device, w: DEVICES[device].w, h: Math.max(DEVICES[device].h, Math.min(16000, Math.round(Number(b.docH) || 0))) };
          kind = KINDS.includes(b.kind) ? b.kind : null;
          geo = kind && cleanGeo(kind, b.geo, livePage);
          if (!geo) return fail(400, { error: 'That mark could not be read. Please draw it again.' });
        } else if (!isQ) {
          cap = await getCap(b.cap);
          if (!cap || cap.site !== site) return fail(400, { error: 'This page picture has expired. Please open the page again and re-mark it.', expired: true });
          kind = KINDS.includes(b.kind) ? b.kind : null;
          geo = kind && cleanGeo(kind, b.geo, cap);
          if (!geo) return fail(400, { error: 'That mark could not be read. Please draw it again.' });
        }
        const text = String(b.text || '').trim().slice(0, 2000);
        if (!text) return fail(400, { error: isQ ? 'Please write your question.' : 'Please write what you would like changed.' });
        const crop = b.crop && typeof b.crop.data === 'string' && /^image\/(webp|jpeg|png)$/.test(b.crop.type || '') ? b.crop : null;
        if (crop && Buffer.byteLength(crop.data, 'base64') > MAX_CROP) return fail(413, { error: 'The picture of this mark is too large. Please zoom in a little and try again.' });
        const el = b.el && typeof b.el === 'object' ? { s: String(b.el.s || '').slice(0, 600), t: String(b.el.t || '').slice(0, 500), k: String(b.el.k || '').slice(0, 10),
          r: Array.isArray(b.el.r) ? b.el.r.slice(0, 4).map((v) => num(v) || 0) : null } : null;

        const cfg = await settings();
        const { day } = today();
        const dayKey = P + `tkday:${w.me.email}:${day}`;
        const [used] = await redis(['INCR', dayKey], ['EXPIRE', dayKey, 172800]);
        const limit = cfg.over && cfg.over[w.me.email] !== undefined ? cfg.over[w.me.email] : cfg.daily;
        if (used > limit) {
          await redis(['DECR', dayKey]);
          return fail(429, { error: limit ? `You have sent ${limit} ticket${limit === 1 ? '' : 's'} today, which is your daily limit.` : 'Sending tickets is paused on your account. Please contact your account manager.',
            limited: true, quota: await quota(w.me.email, cfg) });
        }
        const rec = await siteRec(site);
        const [seq] = await redis(['INCR', P + 'tk:seq']);
        const t = {
          id: newId(9), num: seq, site, type: isQ ? 'question' : 'change', live: isLive, replay: isLive ? cleanReplay(b.replay) : null,
          dudaSite: cap ? cap.dudaSite : (rec && rec.siteId) || site, host: cap ? cap.host : (rec && rec.host) || '',
          siteName: (rec && rec.businessName) || (rec && rec.siteId) || site,
          by: w.me.email, byName: w.me.name || w.me.email, at: now(), updatedAt: now(),
          cap: cap ? cap.id : '', capKind: cap ? cap.kind : '', capW: cap ? cap.w : livePage ? livePage.w : 0, capH: cap ? cap.h : livePage ? livePage.h : 0,
          path: cap ? cap.path : livePage ? livePage.path : '', device: cap ? cap.device : livePage ? livePage.device : '', kind, geo, text, el: isQ ? null : el,
          sel: String(b.sel || '').slice(0, 1000), status: 'open', replies: [], notes: [], history: [], assignee: '', img: !!crop, tu: true, cu: false,
          ua: String(req.headers['user-agent'] || '').slice(0, 160),
        };
        const cmds = [putTicketCmd(t), ['LPUSH', P + 'tks', t.id], ['LTRIM', P + 'tks', 0, 4999], ['LPUSH', P + 'tks:s:' + site, t.id], ['LTRIM', P + 'tks:s:' + site, 0, 1999],
          newSetCmd(t), ['SET', P + 'tkcid:' + cid, t.id, 'EX', 259200], ...(cap ? keepCapCmds(cap) : [])];
        if (crop) cmds.push(['SET', P + 'tkimg:' + t.id, JSON.stringify({ type: crop.type, data: crop.data })]);
        await redis(...cmds);
        // Told one by one, as they arrive.
        const to = await recipients(cfg).catch(() => []);
        const where = isQ ? 'general question' : `${t.path === '/' ? 'home page' : t.path} · ${DEVICE_WORD[t.device] || t.device}`;
        await Promise.all(to.map((email) => notifyUser(email, { kind: 'ticket-new', by: t.by, byName: t.byName, siteId: site, siteName: t.siteName, ticketId: t.id, ticketNum: t.num, ticketType: t.type,
          text: t.text.slice(0, 300), headline: `*${t.byName}* sent ${isQ ? 'a question' : 'a website change'} *#${t.num}* on *${t.siteName}* (${where})`, editorUrl: isQ ? '' : editorLink(t) }).catch(() => {})));
        await globalLog({ email: t.by, name: t.byName }, 'ticket-new', `sent ${isQ ? 'question' : 'change request'} #${t.num} on ${t.siteName}`, { siteId: site }).catch(() => {});
        return res.status(200).json({ ticket: clientTicket(t, w.me), quota: await quota(w.me.email, cfg) });
      }
      if (op === 'creply') {
        const [t] = await getTickets([String(b.id || '')]);
        if (!t || !mayseeSite(w, t.site)) return res.status(404).json({ error: 'Not found' });
        if (w.preview) return res.status(403).json({ error: 'Sending is switched off while you are previewing as the client.' });
        const text = String(b.text || '').trim().slice(0, 2000);
        if (!text) return res.status(400).json({ error: 'Please write a reply.' });
        t.replies = (t.replies || []).concat({ at: now(), by: w.me.email, byName: w.me.name || w.me.email, text, team: false }).slice(-100);
        const from = t.status;
        if (['clarify', 'done', 'closed'].includes(t.status)) { t.status = 'open'; t.history = (t.history || []).concat({ at: now(), by: w.me.email, byName: w.me.name, from, to: 'open', why: 'client replied' }); }
        t.tu = true; t.updatedAt = now();
        await redis(putTicketCmd(t), newSetCmd(t));
        const cfg = await settings();
        const to = t.assignee ? [t.assignee] : await recipients(cfg).catch(() => []);
        await Promise.all(to.map((email) => notifyUser(email, { kind: 'ticket-reply', by: w.me.email, byName: w.me.name, siteId: t.site, siteName: t.siteName, ticketId: t.id, ticketNum: t.num,
          text: text.slice(0, 300), headline: `*${w.me.name || w.me.email}* replied on ticket *#${t.num}* (${t.siteName})` }).catch(() => {})));
        return res.status(200).json({ ticket: clientTicket(t, w.me) });
      }
      return res.status(400).json({ error: 'Unknown operation' });
    }

    // ---------------- the team's side ----------------
    if (op === 'settings') {
      if (!w.admin) return res.status(403).json({ error: 'Admins only' });
      if (req.method === 'POST') {
        const cfg = await saveSettings(b.settings || {});
        await globalLog({ email: w.me.email, name: w.me.name }, 'ticket-settings', 'changed the change-request settings', {}).catch(() => {});
        return res.status(200).json({ settings: cfg });
      }
      const users = await listUsers();
      return res.status(200).json({ settings: await settings(), tz: TZ, email: emailEnabled(),
        clients: users.filter((u) => u.role === 'client').map((u) => ({ email: u.email, name: u.name, sites: (u.sites || []).length })),
        team: users.filter((u) => u.role !== 'client' && u.status === 'active').map((u) => ({ email: u.email, name: u.name })) });
    }
    if (!w.view) return res.status(403).json({ error: 'Your role does not include client change requests.' });
    if (op === 'count') {
      const [n] = await redis(['SCARD', P + 'tks:new']);
      return res.status(200).json({ new: Number(n) || 0 });
    }
    if (op === 'list') {
      const site = String(req.query.site || '');
      const all = await getTickets(await listIds(site || '', 500));
      return res.status(200).json({ tickets: all.map(teamTicket), statuses: Object.fromEntries(Object.entries(STATUSES).map(([k, v]) => [k, v.label])) });
    }
    if (op === 'get') {
      const [t] = await getTickets([String(req.query.id || '')]);
      if (!t) return res.status(404).json({ error: 'That request was not found.' });
      return res.status(200).json({ ticket: teamTicket(t) });
    }
    if (req.method !== 'POST') return res.status(400).json({ error: 'Unknown operation' });
    if (op === 'opened') {
      const [t] = await getTickets([String(b.id || '')]);
      if (t && t.tu) { t.tu = false; await redis(putTicketCmd(t)); }
      return res.status(200).json({ ok: true });
    }
    if (op === 'checked') {
      const [t] = await getTickets([String(b.id || '')]);
      if (!t) return res.status(404).json({ error: 'Not found' });
      const result = ['same', 'changed', 'gone', 'unknown'].includes(b.result) ? b.result : 'unknown';
      t.check = { at: now(), by: w.me.email, byName: w.me.name, result, now: String(b.now || '').slice(0, 400) };
      await redis(putTicketCmd(t));
      return res.status(200).json({ ticket: teamTicket(t) });
    }
    if (!w.manage) return res.status(403).json({ error: 'Your role can see change requests but not update them.' });
    const cfg = await settings();
    if (op === 'status') {
      const status = String(b.status || '');
      if (!STATUSES[status]) return res.status(400).json({ error: 'Unknown status' });
      const ids = [].concat(b.ids || []).map(String).slice(0, 200);
      const list = await getTickets(ids);
      const changed = list.filter((t) => t.status !== status);
      changed.forEach((t) => {
        t.history = (t.history || []).concat({ at: now(), by: w.me.email, byName: w.me.name, from: t.status, to: status }).slice(-60);
        t.status = status; t.updatedAt = now(); t.cu = true; t.tu = false;
      });
      if (changed.length) await redis(...changed.flatMap((t) => [putTicketCmd(t), newSetCmd(t)]));
      const word = { done: 'is done', clarify: 'needs a quick answer from you', closed: 'was closed', progress: 'is being worked on', hold: 'is on hold' }[status];
      if (word) await Promise.all(changed.map((t) => emailClient(cfg, t, `Your ticket #${t.num} ${word}`, `Your ticket on <b>${esc(t.siteName)}</b> ${word}.`)));
      await globalLog({ email: w.me.email, name: w.me.name }, 'ticket-status', `set ${changed.length} change request${changed.length === 1 ? '' : 's'} to ${STATUSES[status].label}`, {}).catch(() => {});
      return res.status(200).json({ tickets: list.map(teamTicket) });
    }
    if (op === 'reply' || op === 'note') {
      const [t] = await getTickets([String(b.id || '')]);
      if (!t) return res.status(404).json({ error: 'Not found' });
      const text = String(b.text || '').trim().slice(0, 4000);
      if (!text) return res.status(400).json({ error: 'Please write something first.' });
      const entry = { at: now(), by: w.me.email, byName: w.me.name, text, team: true };
      if (op === 'reply') {
        t.replies = (t.replies || []).concat(entry).slice(-100); t.cu = true; t.tu = false;
        if (b.status && STATUSES[b.status] && b.status !== t.status) { t.history = (t.history || []).concat({ at: now(), by: w.me.email, byName: w.me.name, from: t.status, to: b.status }); t.status = b.status; }
      } else t.notes = (t.notes || []).concat(entry).slice(-100);
      t.updatedAt = now();
      await redis(putTicketCmd(t), newSetCmd(t));
      if (op === 'reply') await emailClient(cfg, t, `A reply on your ticket #${t.num}`, `${esc(w.me.name || 'Your team')} replied: “${esc(text.slice(0, 400))}”`);
      return res.status(200).json({ ticket: teamTicket(t) });
    }
    if (op === 'assign') {
      const email = normEmail(b.email || '');
      const ids = [].concat(b.ids || []).map(String).slice(0, 200);
      const list = await getTickets(ids);
      list.forEach((t) => { t.assignee = email; t.updatedAt = now(); t.history = (t.history || []).concat({ at: now(), by: w.me.email, byName: w.me.name, assign: email }); });
      if (list.length) await redis(...list.map(putTicketCmd));
      if (email && email !== w.me.email && list.length) {
        const t = list[0];
        await notifyUser(email, { kind: 'ticket-assign', by: w.me.email, byName: w.me.name, siteId: t.site, siteName: t.siteName, ticketId: list.length === 1 ? t.id : '', ticketNum: t.num,
          headline: list.length === 1 ? `*${w.me.name}* gave you ticket *#${t.num}* (${t.siteName})` : `*${w.me.name}* gave you ${list.length} change requests`, text: list.length === 1 ? t.text.slice(0, 200) : '' }).catch(() => {});
      }
      return res.status(200).json({ tickets: list.map(teamTicket) });
    }
    return res.status(400).json({ error: 'Unknown operation' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e).slice(0, 300) });
  }
}
