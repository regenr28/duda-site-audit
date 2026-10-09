// Client change requests ("tickets"): what both /api/capture and /api/tickets share.
//
// A client opens a picture of one page of their website, marks something on it — a highlight, a
// box, a circle, an arrow, or just a tap on an element — writes what should change, and sends it.
// Every mark becomes one request, delivered to the team one by one.
//
// Storage (all under the usual prefix):
//   cap:<id>            a page picture: where it came from, its size, its slices      (expires)
//   capmap:<id>         where every element sits on that picture (packed)              (expires)
//   capimg:<id>:<n>     slice n of the picture, base64 WebP                            (expires)
//   capidx:<site>       hash  "<device>|<path>" → the latest picture of that page
//   tk:<id>             one request                      tkimg:<id>   its cropped picture
//   tks / tks:s:<site>  lists of request ids, newest first (whole team / one website)
//   tks:new             set of requests nobody has picked up yet (the badge in the top bar)
//   tkday:<email>:<day> how many a client has sent today          tkcfg  the settings
//
// Pictures expire on their own (two weeks), and are kept for two months once a request points at
// one, so the team can still see the whole page around a mark. The small cropped picture on each
// request is kept for good.
import { redis, P, hasRedis, currentUser, applyPreview, viewingAsClient, can, jparse, packJSON, unpackJSON, OWNER_EMAIL } from './_lib.js';

export const CAP_TTL = 14 * 86400;
export const KEEP_TTL = 60 * 86400;
export const TZ = process.env.TICKET_TZ || 'Asia/Manila';
export const STATUSES = {
  open: { label: 'Received', client: 'Received' },
  progress: { label: 'In progress', client: 'In progress' },
  clarify: { label: 'Waiting on client', client: 'Needs your reply' },
  hold: { label: 'On hold', client: 'On hold' },
  done: { label: 'Done', client: 'Done' },
  closed: { label: 'No change needed', client: 'Closed' },
};
export const KINDS = ['highlight', 'element', 'rect', 'ellipse', 'arrow', 'pin'];

/**
 * Who is calling: a client (or one of us previewing a client), or a team member.
 * Works for plain <img> requests too, which cannot carry the preview headers — those are answered
 * as the team member they come from.
 */
export async function who(req, res) {
  if (req.method !== 'GET' && req.headers.origin) {
    try { if (new URL(req.headers.origin).host !== (req.headers['x-forwarded-host'] || req.headers.host)) { res.status(403).json({ error: 'Bad origin' }); return null; } } catch (e) { /* ignore */ }
  }
  if (!hasRedis()) { res.status(500).json({ error: 'The database is not connected.' }); return null; }
  const u = await currentUser(req);
  if (!u) { res.status(401).json({ error: 'Please sign in' }); return null; }
  if (u.status === 'disabled') { res.status(403).json({ error: 'This account has been switched off.', disabled: true }); return null; }
  if (u.status !== 'active') { res.status(403).json({ error: 'Your account is waiting for approval', pending: true }); return null; }
  if (u.role === 'client') return { me: u, client: true, preview: false, sites: (u.sites || []).map(String) };
  await applyPreview(req, u);
  if (viewingAsClient(req)) {
    if (!(await can(u, 'client.viewas'))) { res.status(403).json({ error: 'Your role does not include View as client.' }); return null; }
    const s = String(req.headers['x-view-site'] || '').slice(0, 64);
    return { me: u, client: true, preview: true, sites: s ? [s] : [] };
  }
  const view = (await can(u, 'ticket.view')) || (await can(u, 'ticket.manage'));
  return { me: u, client: false, team: true, view, viewas: await can(u, 'client.viewas'), manage: await can(u, 'ticket.manage'),
    admin: u.previewPerms ? u.previewPerms.includes('*') : (u.role === 'admin' || u.email === OWNER_EMAIL) };
}
/** May this caller see things belonging to this website (audit record id)? */
export const mayseeSite = (w, site) => (w.client ? w.sites.includes(String(site)) : !!(w.view || w.viewas));

// ---------- settings ----------
export const DEFAULTS = { daily: 10, over: {}, notify: [], emailClients: true, freshHours: 6 };
export async function settings() {
  const [raw] = await redis(['GET', P + 'tkcfg']);
  return Object.assign({}, DEFAULTS, jparse(raw, {}) || {});
}
export async function saveSettings(cfg) {
  const clean = {
    daily: Math.max(1, Math.min(200, Math.round(Number(cfg.daily) || DEFAULTS.daily))),
    over: {}, notify: [].concat(cfg.notify || []).map((e) => String(e).toLowerCase().trim()).filter((e) => /@/.test(e)).slice(0, 50),
    emailClients: cfg.emailClients !== false,
    freshHours: Math.max(0, Math.min(72, Number(cfg.freshHours) >= 0 ? Number(cfg.freshHours) : DEFAULTS.freshHours)),
  };
  Object.entries(cfg.over || {}).forEach(([k, v]) => {
    const n = Number(v); if (/@/.test(k) && Number.isFinite(n) && n >= 0) clean.over[k.toLowerCase()] = Math.min(200, Math.round(n));
  });
  await redis(['SET', P + 'tkcfg', JSON.stringify(clean)]);
  return clean;
}

// ---------- the day, in the team's time zone ----------
export function today(tz = TZ, at = new Date()) {
  const parts = {};
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(at).forEach((p) => { parts[p.type] = p.value; });
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  const into = (+parts.hour) * 3600 + (+parts.minute) * 60 + (+parts.second);
  return { day, resetAt: new Date(at.getTime() - at.getMilliseconds() + (86400 - into) * 1000).toISOString() };
}
export const limitFor = (cfg, email) => (cfg.over && cfg.over[String(email).toLowerCase()] !== undefined ? cfg.over[String(email).toLowerCase()] : cfg.daily);
export async function quota(email, cfg) {
  cfg = cfg || await settings();
  const { day, resetAt } = today();
  const [used] = await redis(['GET', P + `tkday:${email}:${day}`]);
  const limit = limitFor(cfg, email);
  return { used: Number(used) || 0, limit, left: Math.max(0, limit - (Number(used) || 0)), resetAt, day };
}

// ---------- pictures of pages ----------
export const capKeys = (id, n) => [P + 'cap:' + id, P + 'capmap:' + id, ...Array.from({ length: n }, (_, i) => P + `capimg:${id}:${i}`)];
export async function getCap(id) {
  if (!/^[\w-]{6,40}$/.test(String(id || ''))) return null;
  const [raw] = await redis(['GET', P + 'cap:' + id]);
  return jparse(raw);
}
/** What the browser needs to draw a picture (never the element map, which is fetched separately). */
export const capPublic = (c) => c && ({ id: c.id, site: c.site, path: c.path, device: c.device, kind: c.kind, w: c.w, h: c.h, dsf: c.dsf,
  cut: !!c.cut, title: c.title || '', at: c.at, slices: (c.slices || []).map((s) => ({ y: s.y, h: s.h })), links: c.links || [], hasMap: !!c.hasMap });
export async function storeCap(meta, slicesData, els) {
  // One slice per request keeps each one well under the database's request size limit.
  for (let i = 0; i < slicesData.length; i++) await redis(['SET', P + `capimg:${meta.id}:${i}`, slicesData[i], 'EX', CAP_TTL]);
  const cmds = [['SET', P + 'cap:' + meta.id, JSON.stringify(meta), 'EX', CAP_TTL]];
  if (els) cmds.push(['SET', P + 'capmap:' + meta.id, packJSON(els), 'EX', CAP_TTL]);
  await redis(...cmds);
}
/** A request points at this picture: keep it for two months from now. */
export function keepCapCmds(cap) {
  return capKeys(cap.id, (cap.slices || []).length).map((k) => ['EXPIRE', k, KEEP_TTL]);
}
export async function capMap(id) {
  const [raw] = await redis(['GET', P + 'capmap:' + id]);
  return unpackJSON(raw) || [];
}

// ---------- requests ----------
export async function getTickets(ids) {
  if (!ids.length) return [];
  const [raws] = await redis(['MGET', ...ids.map((id) => P + 'tk:' + id)]);
  return (raws || []).map((r) => jparse(r)).filter(Boolean);
}
export async function listIds(site, n = 500) {
  const [ids] = await redis(['LRANGE', P + (site ? 'tks:s:' + site : 'tks'), 0, n - 1]);
  return ids || [];
}
export const putTicketCmd = (t) => ['SET', P + 'tk:' + t.id, JSON.stringify(t)];
export const newSetCmd = (t) => (t.status === 'open' ? ['SADD', P + 'tks:new', t.id] : ['SREM', P + 'tks:new', t.id]);

/** What a client is shown: never team notes, never who on our side did what beyond a first name. */
export function clientTicket(t, me) {
  return {
    id: t.id, num: t.num, type: t.type || 'change', at: t.at, path: t.path, device: t.device, kind: t.kind, geo: t.geo, cap: t.cap, capW: t.capW, capH: t.capH,
    text: t.text, el: t.el ? { s: t.el.s, t: t.el.t } : null, status: t.status, statusLabel: (STATUSES[t.status] || {}).client || t.status,
    mine: !!(me && t.by === me.email), byName: t.byName, unread: !!t.cu, updatedAt: t.updatedAt,
    replies: (t.replies || []).map((r) => ({ at: r.at, text: r.text, team: !!r.team, by: r.team ? (String(r.byName || 'Your team').split(/\s+/)[0]) : r.byName })),
    img: t.img ? `/api/tickets?op=img&id=${encodeURIComponent(t.id)}` : '',
  };
}
export function teamTicket(t) {
  return Object.assign({}, t, { statusLabel: (STATUSES[t.status] || {}).label || t.status, img: t.img ? `/api/tickets?op=img&id=${encodeURIComponent(t.id)}` : '' });
}
