// Shared helpers for the Vercel serverless functions (Node 18+, zero dependencies).
import crypto from 'node:crypto';
import zlib from 'node:zlib';

export const UA_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
export const P = process.env.STORE_PREFIX || 'dsa:';

// ---------- Redis (Upstash REST) ----------
// Accepts default names or names with a custom prefix added by the Vercel integration (e.g. dr_site_audit_KV_REST_API_URL)
const findEnv = (suffixes) => {
  for (const s of suffixes) if (process.env[s]) return process.env[s];
  const key = Object.keys(process.env).find((k) => suffixes.some((s) => k.endsWith('_' + s)));
  return key ? process.env[key] : undefined;
};
const R_URL = findEnv(['KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL']);
const R_TOKEN = findEnv(['KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN']);
export const hasRedis = () => !!(R_URL && R_TOKEN);

/**
 * How many commands this month, counted by the app itself.
 *
 * The allowance is the thing most likely to run out quietly, and the provider's own figure is not
 * readable from here. So every pipeline carries one extra command that adds its own size to a
 * monthly counter — including that extra command, so the number is the truth rather than an
 * undercount. It costs about a quarter more commands to know exactly where we stand, which is a
 * trade worth making for the one number that can stop the app writing.
 */
const usageKey = () => P + 'usage:cmd:' + new Date().toISOString().slice(0, 7);
let counting = true;

export async function redis(...cmds) {
  if (!hasRedis()) throw new Error('The database is not connected. Please contact the app owner.');
  if (counting && cmds.length && !String(cmds[0][1] || '').startsWith(P + 'usage:')) {
    cmds = cmds.concat([['INCRBY', usageKey(), String(cmds.length + 1)]]);
  }
  const r = await fetch(`${R_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${R_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error(`Redis ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const out = await r.json();
  const mapped = out.map((x) => { if (x.error) throw new Error(x.error); return x.result; });
  // The counter rode along on the end; the caller asked for what came before it.
  return counting && mapped.length === cmds.length && cmds[cmds.length - 1][0] === 'INCRBY'
    && String(cmds[cmds.length - 1][1] || '').startsWith(P + 'usage:') ? mapped.slice(0, -1) : mapped;
}
/** Count without counting the counting — used by the health page when it reads its own figures. */
export async function redisRaw(...cmds) {
  counting = false;
  try { return await redis(...cmds); } finally { counting = true; }
}
export const jparse = (s, d = null) => { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } };

// ---------- misc ----------
export const normEmail = (e) => String(e || '').trim().toLowerCase();
export const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
export const newId = (n = 12) => crypto.randomBytes(n).toString('base64url');
export const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
/**
 * An opaque id for the version of the app that is live.
 *
 * The scan itself runs in the browser tab, so a tab that has been open since before an update is
 * still running the OLD checks — which looks exactly like "I rescanned and the item is still there".
 * The app compares this against the id it started with and tells the person to reload.
 * Hashed, so nothing about how or where this is hosted leaks into the page.
 */
export const buildId = () => sha(process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || process.env.BUILD_ID || process.env.npm_package_version || 'dev').slice(0, 12);
export const now = () => new Date().toISOString();

/**
 * Duda's comment text arrives HTML-escaped (&quot;, &#39;, &amp;). We escape again when drawing, so
 * without this the reader sees the raw entity. Decoded once, on the way in.
 */
export function unescapeHtml(str) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '\u2013', mdash: '\u2014', hellip: '\u2026', rsquo: '\u2019', lsquo: '\u2018', ldquo: '\u201c', rdquo: '\u201d' };
  return String(str == null ? '' : str).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    const v = named[code.toLowerCase()];
    return v === undefined ? m : v;
  });
}

export function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; }
}
export async function fetchWithTimeout(url, opts = {}, ms = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctl.signal }); } finally { clearTimeout(t); }
}
/** Remembers the agency's white-label editor address, learned from Duda (preview/editor URLs). */
export async function learnEditorHost(url) {
  try {
    const h = new URL(String(url)).hostname.toLowerCase();
    if (!allowedHost(h) || /^my\.duda\.co$/.test(h)) return;
    const [cur] = await redis(['GET', P + 'edhost']);
    if (cur !== h) await redis(['SET', P + 'edhost', h]);
  } catch (e) { /* ignore */ }
}
export async function savedEditorHost() {
  const env = String(process.env.DUDA_EDITOR_HOST || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (env) return env;
  const [h] = await redis(['GET', P + 'edhost']);
  return h || '';
}
export function allowedHost(host) {
  if (!host || !/^[a-z0-9.-]+$/i.test(host)) return false;
  const list = (process.env.ALLOWED_EDITOR_HOSTS || 'responsivesiteeditor.com,duda.co,dudamobile.com,multiscreensite.com,dudaone.com')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  host = host.toLowerCase();
  return list.some((h) => host === h || host.endsWith('.' + h));
}
export function parseEditorLink(input) {
  input = String(input || '').trim();
  let host = process.env.DEFAULT_EDITOR_HOST || '';
  let siteId = '';
  try {
    const u = new URL(input);
    host = u.hostname;
    const m = u.pathname.match(/\/(?:site|preview|editor\/direct|editor)\/([A-Za-z0-9_-]{4,})/);
    siteId = m ? m[1] : '';
  } catch (e) {
    if (/^[A-Za-z0-9_-]{4,}$/.test(input)) siteId = input;
  }
  return { host, siteId };
}
let lastBase = '';
export function appUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  if (!req) return lastBase;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  lastBase = `https://${host}`;
  return lastBase;
}

// ---------- passwords ----------
export function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return { salt, hash };
}
export function checkPassword(pw, salt, hash) {
  if (!salt || !hash) return false;
  const h = crypto.scryptSync(String(pw), salt, 64);
  const b = Buffer.from(hash, 'hex');
  return b.length === h.length && crypto.timingSafeEqual(h, b);
}

// ---------- users ----------
export const COLORS = ['#2563eb', '#16a34a', '#db2777', '#ea580c', '#7c3aed', '#0891b2', '#ca8a04', '#dc2626', '#4f46e5', '#059669'];
export async function getUser(email) {
  const [raw] = await redis(['GET', P + 'user:' + normEmail(email)]);
  return ownerFix(jparse(raw));
}
/** The Super Admin is always an active admin, whatever the stored record says. */
function ownerFix(u) {
  if (u && u.email === OWNER_EMAIL) { u.role = 'admin'; u.status = 'active'; }
  return u;
}
export async function putUser(u) {
  await redis(['SET', P + 'user:' + u.email, JSON.stringify(u)], ['SADD', P + 'users', u.email]);
  // Saving a person is the one moment their cached session is certainly out of date, so drop it
  // here rather than expecting every caller to remember.
  forgetUser(u.email);
  return u;
}
/** Display names must be unique so @mentions and "who did this" are never ambiguous. */
export async function nameTaken(name, exceptEmail) {
  const want = String(name || '').trim().toLowerCase();
  if (!want) return false;
  const all = await listUsers();
  return all.some((u) => u.email !== exceptEmail && String(u.name || '').trim().toLowerCase() === want && u.status !== 'rejected');
}
/**
 * A comment as it should be READ, not as it is stored. Mentions are written `@[Name|email]` so a
 * rename never breaks them, but nobody wants to see that in a Slack message or on the bell.
 * `@[Admins|*admins]` is the group token and reads as @Admins.
 */
export const plainMentions = (text) => String(text == null ? '' : text)
  .replace(/@\[([^\]\n|]{1,60})(?:\|[^\]\n]{1,80})?\]/g, '@$1');

export const publicUser = (u) => u && ({ id: u.email, email: u.email, name: u.name, color: u.color, role: u.role, status: u.status, google: !!u.google, createdAt: u.createdAt, notifySecs: u.notifySecs === undefined ? 8 : u.notifySecs, slackDM: u.slackDM !== false, newsSeen: u.newsSeen || '', nameHistory: (u.nameHistory || []).slice(-10), editorEnv: u.editorEnv === 'duda' ? 'duda' : 'white',
  notifyOff: Array.isArray(u.notifyOff) ? u.notifyOff : [],
  // Client accounts: which websites they were granted, and the company they belong to.
  sites: u.role === 'client' ? (u.sites || []).map(String) : undefined, clientId: u.clientId || undefined, company: u.company || undefined,
  grant: (u.grant || []).length ? u.grant : undefined, revoke: (u.revoke || []).length ? u.revoke : undefined, custom: hasCustomAccess(u) || undefined });
export async function listUsers() {
  const [emails] = await redis(['SMEMBERS', P + 'users']);
  if (!emails || !emails.length) return [];
  const raws = await redis(...emails.map((e) => ['GET', P + 'user:' + e]));
  return raws.map((r) => ownerFix(jparse(r))).filter(Boolean);
}
/** Decide role/status for a brand-new account. */
export async function initialAccess(email) {
  const admins = (process.env.ADMIN_EMAILS || '').split(',').map(normEmail).filter(Boolean);
  const domains = (process.env.ALLOWED_EMAIL_DOMAINS || '').split(',').map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
  const [count] = await redis(['SCARD', P + 'users']);
  if (admins.includes(email) || !count) return { role: 'admin', status: 'active' };
  if (domains.includes(email.split('@')[1])) return { role: 'member', status: 'active' };
  return { role: 'member', status: 'pending' };
}

// ---------- sessions ----------
const COOKIE = 'dsa_sess';
const cache = new Map(); // token -> { user, exp } (per warm function instance)
export async function createSession(res, email, remember) {
  const token = newId(24);
  const ttl = remember ? 60 * 60 * 24 * 30 : 60 * 60 * 12;
  await redis(['SET', P + 'sess:' + sha(token), email, 'EX', ttl]);
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax'];
  if (remember) parts.push(`Max-Age=${ttl}`);
  res.setHeader('Set-Cookie', parts.join('; '));
}
export function getToken(req) {
  const m = String(req.headers.cookie || '').match(/(?:^|;\s*)dsa_sess=([^;]+)/);
  return m ? m[1] : '';
}
export async function destroySession(req, res) {
  const t = getToken(req);
  if (t) { cache.delete(t); await redis(['DEL', P + 'sess:' + sha(t)]); }
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}
/**
 * The access version, cached for a few seconds per server instance.
 *
 * Session records are cached for three minutes to save two reads on nearly every request — fine for
 * a name, far too long for what somebody is allowed to do. So the cached session is checked against
 * this number, which costs one small read every five seconds rather than one per request. An admin
 * taking somebody's access away takes effect within seconds, everywhere, not after three minutes.
 */
let avCache = { v: null, at: 0 };
async function currentAccessVersion() {
  if (avCache.v !== null && Date.now() - avCache.at < 5000) return avCache.v;
  const [v] = await redis(['GET', P + 'ver:access']);
  avCache = { v: String(v || 0), at: Date.now() };
  return avCache.v;
}
export async function currentUser(req) {
  const t = getToken(req);
  if (!t) return null;
  const av = await currentAccessVersion();
  const c = cache.get(t);
  // A COPY every time. Handlers add things to this object for the life of one request — a preview,
  // most of all — and the cache is shared by every later request on this instance. Handing out the
  // cached object itself meant one request's preview quietly became everybody's.
  if (c && c.exp > Date.now() && c.av === av) return Object.assign({}, c.user);
  const [email] = await redis(['GET', P + 'sess:' + sha(t)]);
  if (!email) return null;
  const user = await getUser(email);
  // Cached for 3 minutes per server instance, and dropped the moment anybody's access changes.
  if (user) cache.set(t, { user, exp: Date.now() + 180000, av });
  return user ? Object.assign({}, user) : user;
}
/** Drop cached sessions for someone whose role or account just changed (this server instance). */
export function forgetUser(email) { for (const [k, v] of cache) if (v.user && v.user.email === email) cache.delete(k); }
/** Require a signed-in, approved user. Sends 401/403 and returns null otherwise. */
/**
 * Who is calling, and may they.
 *
 * Clients are rejected by DEFAULT. Every endpoint written before clients existed assumes everyone
 * signed in is one of us, so the safe default is that a client account cannot reach any of them —
 * an endpoint has to ask for `{ client: true }` on purpose. The client's own endpoints are the only
 * ones that do, and each of them re-checks which websites that person was actually granted.
 */
export async function requireUser(req, res, { admin = false, client = false } = {}) {
  if (req.method !== 'GET' && req.headers.origin) {
    try { if (new URL(req.headers.origin).host !== (req.headers['x-forwarded-host'] || req.headers.host)) { res.status(403).json({ error: 'Bad origin' }); return null; } } catch (e) { /* ignore */ }
  }
  if (!hasRedis()) { res.status(500).json({ error: 'The database is not connected. Please contact the app owner.' }); return null; }
  const u = await currentUser(req);
  appUrl(req); // remember the app address for links in Slack messages
  if (!u) { res.status(401).json({ error: 'Please sign in' }); return null; }
  if (u.status === 'disabled') { res.status(403).json({ error: 'This account has been switched off by an admin.', disabled: true }); return null; }
  if (u.status !== 'active') { res.status(403).json({ error: 'Your account is waiting for admin approval', pending: true }); return null; }
  if (u.role === 'client' && !client) { res.status(403).json({ error: 'Not available on this account' }); return null; }
  await applyPreview(req, u);
  // Every answer carries the access version, so an open browser notices a change on its next action
  // rather than waiting for the heartbeat. The heartbeat still covers somebody sitting idle.
  try { res.setHeader('X-Access-Ver', await currentAccessVersion()); } catch (e) { /* header only */ }
  if (client && u.role !== 'client' && !viewingAsClient(req)) { res.status(403).json({ error: 'Client accounts only' }); return null; }
  if (admin && (u.previewPerms ? !u.previewPerms.includes('*') : u.role !== 'admin')) { res.status(403).json({ error: 'Admins only' }); return null; }
  return u;
}
/** An admin checking what a client sees sends this header; it grants no data by itself. */
export const viewingAsClient = (req) => String(req.headers['x-view-as-client'] || '') === '1';
/**
 * The websites this caller may see through the client endpoints.
 *
 * A client's access is an explicit list on their own account — never inferred from a shared
 * company, a domain or anything else. A team member previewing gets the one website they asked
 * for, so "View as client" can never show more than a real client would.
 */
export function clientSites(user, req) {
  if (user.role === 'client') return (user.sites || []).map(String);
  if (viewingAsClient(req)) { const s = String(req.headers['x-view-site'] || '').slice(0, 64); return s ? [s] : []; }
  return [];
}

// ---------- email (Resend) ----------
export const emailEnabled = () => !!process.env.RESEND_API_KEY;
export async function sendEmail(to, subject, html) {
  if (!emailEnabled()) return { skipped: true };
  const r = await fetchWithTimeout((process.env.RESEND_API_BASE || 'https://api.resend.com') + '/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM || 'Duda Site Auditor <onboarding@resend.dev>', to: [to], subject, html }),
  }, 10000);
  if (!r.ok) throw new Error('Email could not be sent: ' + (await r.text()).slice(0, 200));
  return { sent: true };
}
export const emailShell = (title, body) => `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#16181d">
  <div style="font-weight:700;font-size:16px;margin-bottom:16px">✓ Duda Site Auditor</div>
  <h2 style="font-size:18px;margin:0 0 12px">${title}</h2>${body}
  <p style="color:#8a919c;font-size:12px;margin-top:24px">If you didn't expect this email, you can ignore it.</p></div>`;
export const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Slack (Incoming Webhook) ----------
export const slackEnabled = () => !!process.env.SLACK_WEBHOOK_URL;
export async function slack(text) {
  if (!slackEnabled()) return { skipped: true };
  try {
    const r = await fetchWithTimeout(process.env.SLACK_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }, 8000);
    return { sent: r.ok };
  } catch (e) { return { sent: false, error: e.message }; }
}

// ---------- what each person wants to be told about ----------
/**
 * Every notification the app sends, gathered into the handful of groups a person actually thinks in,
 * with the ways it can reach them.
 *
 * This table is the single source of truth: the settings screen is rendered from it, and every
 * place that sends anything asks `wants()` before sending. A new notification kind that isn't
 * listed here is always delivered — silence should never be the accident of a forgotten entry.
 *
 * Channels: bell (the list in the app), popup (the on-screen card / desktop alert, decided in the
 * browser), slack (a direct message), email. A group only lists the channels it really uses, so
 * nobody is offered an email switch for something that has never sent an email.
 */
export const NOTIFY_GROUPS = [
  { key: 'mentions', label: 'Mentions and replies', kinds: ['mention', 'reply'], channels: ['bell', 'popup', 'slack', 'email'], locked: ['bell'],
    desc: 'Someone types @your name in a comment, or replies to one of yours.',
    lockNote: 'Always reaches your bell, so nothing addressed to you can go unseen.' },
  { key: 'assigned', label: 'Work assigned to you', kinds: ['assign', 'site-assign', 'site-unassign', 'site-reopen'], channels: ['bell', 'popup', 'slack'],
    desc: 'An audit item or a whole website is given to you, taken off you, or reopened.' },
  { key: 'comments', label: 'Duda comments waiting', kinds: ['comment-waiting'], channels: ['bell', 'popup', 'slack'],
    desc: 'Clients have left comments in Duda that nobody has answered yet.' },
  { key: 'scans', label: 'Scans finishing', kinds: ['scan-done', 'rescan-done'], channels: ['bell', 'popup', 'slack'],
    desc: 'A scan you started has finished, or a website you completed was rescanned.' },
  { key: 'falsealarms', label: 'False alarm reports', kinds: ['false-alarm', 'fa-status', 'fa-note'], channels: ['bell', 'popup', 'slack', 'email'],
    desc: 'Somebody reports an audit item as a false alarm, or answers a report you made.' },
  { key: 'suggestions', label: 'Feature suggestions', kinds: ['suggestion', 'suggestion-status', 'suggestion-comment'], channels: ['bell', 'popup', 'slack', 'email'],
    desc: 'A suggestion is sent, answered, or commented on.' },
  { key: 'admin', label: 'Accounts and admin', kinds: ['signup', 'site-removed'], channels: ['bell', 'popup', 'slack', 'email'], admin: true,
    desc: 'Someone signs up and needs approving, or an audit is removed from the list.' },
  // Only ever sent to the account that runs the app, and always to the bell: an allowance quietly
  // running out is the one thing that must not be missable.
  { key: 'system', label: 'System health', kinds: ['system'], channels: ['bell', 'popup', 'slack', 'email'], admin: true,
    locked: ['bell'],
    desc: 'Something is running out, or something that should be arriving has stopped.',
    lockNote: 'Always reaches your bell. Only the account that runs the app is sent these.' },
];
const GROUP_OF = {};
NOTIFY_GROUPS.forEach((g) => g.kinds.forEach((k) => { GROUP_OF[k] = g; }));
/** Every switch that may legitimately be turned off, as "group:channel". */
export const NOTIFY_KEYS = NOTIFY_GROUPS.flatMap((g) => g.channels.filter((c) => !(g.locked || []).includes(c)).map((c) => g.key + ':' + c));
/**
 * Does this person want this kind of notification on this channel?
 *
 * Off switches are stored, not on ones, so everything is on by default and a group added later
 * starts out reaching everybody rather than silently reaching nobody.
 */
export function wants(user, kind, channel) {
  if (kind === 'test') return true;                       // a test must always arrive, or it tests nothing
  const g = GROUP_OF[kind];
  if (!g) return true;                                    // unlisted kind: deliver it
  if ((g.locked || []).includes(channel)) return true;
  if (channel === 'slack' && user && user.slackDM === false) return false;  // the master Slack switch
  return !(user && Array.isArray(user.notifyOff) && user.notifyOff.includes(g.key + ':' + channel));
}

// ---------- in-app notifications + global (admin) activity log ----------
export async function notifyUser(email, n) {
  const item = { id: newId(6), at: now(), ...n };
  // Read once and decide every channel from it, rather than each sender asking again.
  const u = await getUser(email).catch(() => null);
  if (wants(u, n.kind, 'bell')) {
    await redis(['LPUSH', P + 'notif:' + email, JSON.stringify(item)], ['LTRIM', P + 'notif:' + email, 0, 99]);
    // Nudge that person's open app right away (no database involved), so desktop notifications are instant
    await ablyPublish(userChannel(email), 'notif', { id: item.id });
  }
  // …and a direct message from the "Site Auditor" Slack bot, if their app email is also their Slack email
  if (wants(u, n.kind, 'slack')) await slackDM(email, item, u);
}
/** Would an email of this kind reach this person? Senders call this before building the message. */
export async function wantsEmail(email, kind) {
  const u = await getUser(email).catch(() => null);
  return wants(u, kind, 'email');
}

// ---------- Slack direct messages ----------
// Needs SLACK_BOT_TOKEN (xoxb-…) with the scopes chat:write, users:read, users:read.email.
// The Slack user is found by email (the email they registered with); cached so Slack is asked only once a month.
const KIND = { mention: 'mentioned you', reply: 'replied to your comment', assign: 'assigned you an audit item', signup: 'created an account and needs approval',
  suggestion: 'sent a feature suggestion', 'suggestion-status': 'updated your suggestion', 'suggestion-comment': 'commented on a suggestion', 'false-alarm': 'marked an audit item as False alarm', 'fa-status': 'answered your false alarm report', 'fa-note': 'wrote on a false alarm report', 'scan-done': 'finished the scan', 'rescan-done': 'rescanned a website you completed',
  'site-assign': 'assigned a website to you', 'site-unassign': 'took a website off you', 'site-reopen': 'reopened a website you completed', 'site-removed': 'removed an audit from the Audits list',
  'comment-waiting': 'has client comments waiting for an answer',
  access: 'changed what you can do',
  test: 'sent you a test message' };
export const slackBotEnabled = () => /^xox[bp]-/.test(process.env.SLACK_BOT_TOKEN || '');
async function slackApi(method, body) {
  const r = await fetchWithTimeout(`${process.env.SLACK_API_BASE || 'https://slack.com/api'}/${method}`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + process.env.SLACK_BOT_TOKEN, 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body),
  }, 6000);
  return r.json().catch(() => ({ ok: false, error: 'bad_response' }));
}
async function slackUserId(email) {
  const key = P + 'slackid:' + normEmail(email);
  const [cached] = await redis(['GET', key]);
  if (cached) return cached === '-' ? '' : cached;
  const r = await fetchWithTimeout(`${process.env.SLACK_API_BASE || 'https://slack.com/api'}/users.lookupByEmail?email=${encodeURIComponent(email)}`, { headers: { Authorization: 'Bearer ' + process.env.SLACK_BOT_TOKEN } }, 6000)
    .then((x) => x.json()).catch(() => ({ ok: false }));
  const id = r.ok && r.user && !r.user.deleted ? r.user.id : '';
  if (r.ok || r.error === 'users_not_found') await redis(['SET', key, id || '-', 'EX', id ? 30 * 86400 : 86400]);
  return id;
}
/**
 * Everyone in the Slack workspace, with their email.
 *
 * The app has to decide whether a Duda comment came from us or from the client, and it was guessing
 * from email domains — which fails the moment a teammate comments from a personal address. Slack
 * already holds the real answer: if they are in the workspace, they are one of us.
 *
 * Guests are deliberately kept separate. A client invited into a shared channel is a Slack member
 * too, and counting them as team would silence exactly the comments this is meant to catch.
 *
 * Needs the bot scopes users:read and users:read.email.
 */
export async function slackMembers() {
  if (!slackBotEnabled()) return { ok: false, error: 'not_configured' };
  const team = []; const guests = [];
  let cursor = '';
  for (let page = 0; page < 8; page++) {
    const r = await slackApi('users.list', Object.assign({ limit: 200 }, cursor ? { cursor } : {}));
    if (!r.ok) return { ok: false, error: r.error || 'slack_error' };
    (r.members || []).forEach((u) => {
      if (u.deleted || u.is_bot || u.id === 'USLACKBOT') return;
      const email = normEmail((u.profile && u.profile.email) || '');
      if (!email) return;                                   // no email visible: nothing we can match on
      const row = { email, name: (u.profile && (u.profile.real_name || u.profile.display_name)) || u.name || email, id: u.id };
      if (u.is_restricted || u.is_ultra_restricted) guests.push(row); else team.push(row);
    });
    cursor = (r.response_metadata && r.response_metadata.next_cursor) || '';
    if (!cursor) break;
  }
  return { ok: true, team, guests };
}

/** The saved Slack roster: who counts as one of us when a Duda comment arrives. */
export async function slackRoster() {
  try { const [raw] = await redis(['GET', P + 'slackroster']); return jparse(raw) || null; } catch (e) { return null; }
}

/** Slack workspace id + member id for a teammate, so the app can open a Slack DM with them. Cached (no Slack call on repeat). */
export async function slackLink(email) {
  if (!slackBotEnabled()) return { ok: false, reason: 'not_configured' };
  const id = await slackUserId(email);
  if (!id) return { ok: false, reason: 'not_in_slack' };
  let [team] = await redis(['GET', P + 'slackteam']);
  if (!team) {
    const r = await slackApi('auth.test', {});
    team = r.ok ? r.team_id : '';
    if (team) await redis(['SET', P + 'slackteam', team, 'EX', 30 * 86400]);
  }
  if (!team) return { ok: false, reason: 'no_team' };
  return { ok: true, team, id };
}
/** Which teammates can be reached on Slack (admin view): matches each app email to a Slack account. */
export async function slackWho(emails) {
  if (!slackBotEnabled()) return null;
  const out = {};
  for (const e of emails.slice(0, 60)) { try { out[e] = !!(await slackUserId(e)); } catch (x) { out[e] = null; } }
  return out;
}
function notifLink(n) {
  const base = appUrl();
  if (!base) return '';
  if (n.kind === 'signup') return base + '/#/?members=1';
  if (n.kind === 'false-alarm') return base + '/#/suggestions/false-alarms' + (n.faKey ? '/' + encodeURIComponent(n.faKey) : '');
  if (/^fa-/.test(n.kind)) return n.siteId && n.findingNum ? `${base}/#/site/${encodeURIComponent(n.siteId)}/item/${n.findingNum}` : base + '/#/suggestions/false-alarms';
  if (/^suggestion/.test(n.kind || '')) return base + '/#/suggestions';
  if (n.kind === 'comment-waiting' && n.dudaSite) return `${base}/#/comments/${encodeURIComponent(n.dudaSite)}`;
  if (n.siteId) return `${base}/#/site/${n.siteId}${n.findingNum ? '/item/' + n.findingNum : '/comments'}`;
  return base;
}
/** Sends a Slack DM for an app notification. Returns { sent, reason }. Never throws. */
export async function slackDM(email, n, known) {
  if (!slackBotEnabled()) return { sent: false, reason: 'not_configured' };
  try {
    const user = known || await getUser(email);
    if (user && user.slackDM === false && n.kind !== 'test') return { sent: false, reason: 'turned_off' };
    const id = await slackUserId(email);
    if (!id) return { sent: false, reason: 'not_in_slack' };
    // A message about your own scan should not read as though somebody else sent it.
    const who = n.self ? `*Your ${n.kind === 'rescan-done' ? 'rescan' : 'scan'} finished*` : `*${n.byName || 'Someone'}* ${KIND[n.kind] || 'sent you an update'}`;
    const head = n.headline || `${who}${n.siteName ? ` on *${n.siteName}*` : ''}${n.findingNum ? ` · item #${n.findingNum}` : ''}`;
    const link = notifLink(n);
    // A digest arrives as lines, and lines have to stay lines: a list of five overdue comments
    // squashed onto one row is the thing this was built to stop.
    const body = Array.isArray(n.lines) && n.lines.length
      ? '\n' + n.lines.slice(0, 12).map((l) => String(l).slice(0, 200)).join('\n')
      : (n.text ? `\n> ${String(n.text).replace(/\n+/g, ' ').slice(0, 400)}` : '');
    const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: head + body } }];
    const buttons = [];
    if (link) buttons.push({ type: 'button', text: { type: 'plain_text', text: 'Open in Site Auditor' }, url: link });
    if (n.editorUrl) buttons.push({ type: 'button', text: { type: 'plain_text', text: 'Open in Duda editor' }, url: n.editorUrl });
    if (buttons.length) blocks.push({ type: 'actions', elements: buttons });
    const r = await slackApi('chat.postMessage', { channel: id, text: head.replace(/\*/g, '') + (n.text ? ': ' + String(n.text).replace(/\n+/g, ' ').slice(0, 200) : ''), blocks, unfurl_links: false });
    return { sent: !!r.ok, reason: r.ok ? '' : r.error };
  } catch (e) { return { sent: false, reason: 'error' }; }
}

// ---------- realtime (Ably) ----------
export const RT_PREFIX = (process.env.STORE_PREFIX || 'dsa').replace(/[^\w-]/g, '');
/** One channel every signed-in browser listens on, so a new Duda comment shows up at once. */
export const commentsChannel = () => `${RT_PREFIX}-site:comments`;
export const userChannel = (email) => `${RT_PREFIX}-user:${sha(normEmail(email)).slice(0, 16)}`;
export async function ablyPublish(channel, name, data) {
  const key = process.env.ABLY_API_KEY;
  if (!key || !key.includes(':')) return false;
  try {
    const r = await fetchWithTimeout(`${process.env.ABLY_REST_BASE || 'https://rest.ably.io'}/channels/${encodeURIComponent(channel)}/messages`, {
      method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(key).toString('base64'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, data }),
    }, 4000);
    return r.ok;
  } catch (e) { return false; }
}
export async function globalLog(actor, type, text, extra = {}) {
  const e = { id: newId(6), at: now(), by: actor ? actor.email : '', byName: actor ? actor.name : 'System', type, text, ...extra };
  await redis(['LPUSH', P + 'gact', JSON.stringify(e)], ['LTRIM', P + 'gact', 0, 999]);
}
export const OWNER_EMAIL = normEmail(process.env.SUGGESTIONS_OWNER || 'regencia.reymark28@gmail.com');

/** A new account needs approval: tell every admin (email + in-app) and post to Slack. */
export async function announceSignup(user, req) {
  await globalLog(user, 'signup', user.status === 'active' ? 'created an account (auto-approved)' : 'created an account and is waiting for approval');
  if (user.status === 'active') return;
  const link = appUrl(req) + '/#/?members=1';
  const admins = (await listUsers()).filter((u) => u.role === 'admin' && u.status === 'active');
  for (const a of admins) {
    await notifyUser(a.email, { by: user.email, byName: user.name, kind: 'signup', text: `${user.name} (${user.email}) is waiting for approval` }).catch(() => {});
    if (!wants(a, 'signup', 'email')) continue;
    await sendEmail(a.email, `New account waiting for approval: ${user.name}`, emailShell('Someone wants to join Duda Site Auditor', `
      <p><b>${esc(user.name)}</b> (${esc(user.email)}) just created an account${user.google ? ' with Google' : ''}.</p>
      <p><a href="${link}" style="display:inline-block;background:#2563eb;color:#fff;padding:9px 14px;border-radius:8px;text-decoration:none">Review in Members</a></p>`)).catch(() => {});
  }
  await slack(`:wave: *${user.name}* (${user.email}) created a Duda Site Auditor account and is waiting for admin approval. <${link}|Review in Members>`);
}


// ---------- roles and what they may do ----------
/**
 * Everything a role can be allowed to do.
 *
 * This table is the single source of truth: the Roles screen is drawn from it and every gate in the
 * app asks `can()` against it. Adding a feature means adding its line here and using the key —
 * nothing else needs to know roles exist.
 *
 * Deliberately NOT listed: anything only the app owner may do. Those stay hard-coded against the
 * owner's address and never appear as a switch, because a switch on a screen tells everybody the
 * capability exists. What services the app uses behind the scenes is the obvious example.
 */
export const PERMISSIONS = [
  { group: 'Websites', items: [
    { key: 'site.viewall', label: 'See every website', desc: 'Without this, somebody sees only the websites they have been assigned or added themselves \u2014 and keeps seeing one after it moves on to the next person.' },
    { key: 'site.add', label: 'Add websites to Audits', desc: 'Paste an editor link and start an audit.' },
    { key: 'site.scan', label: 'Run and rescan scans', desc: 'Start a scan on any website, including Rescan all shown.' },
    { key: 'site.manage', label: 'Change a website’s status and owner', desc: 'Set the status, assign it to somebody, reopen a completed one.' },
    { key: 'site.remove', label: 'Remove a website from Audits', desc: 'Anyone can always remove a website they added themselves.' },
    { key: 'site.bi', label: 'Add or exclude Business Info values', desc: 'Mark a value correct for a website, or strike one out of the reference.' },
  ] },
  { group: 'Live DR Sites', items: [
    { key: 'live.view', label: 'See Live DR Sites', desc: 'The list of every website in the Duda account. Without this the page is not in the top bar at all.' },
    { key: 'live.pull', label: 'Pull the list from Duda', desc: 'Fetch the websites again rather than using what was last pulled.' },
    { key: 'live.domains', label: 'Check domains', desc: 'Open every live domain to see it still shows the right website.' },
    { key: 'live.audit', label: 'See the audit column and start audits from there', desc: 'The Audit column and the "Audit this website" button. Usually QA rather than everybody.' },
  ] },
  { group: 'Audit items', items: [
    { key: 'item.status', label: 'Change audit item statuses', desc: 'Done, On hold, For clarification, False alarm.' },
    { key: 'item.assign', label: 'Assign audit items to people', desc: '' },
    { key: 'fa.manage', label: 'Answer false alarm reports', desc: 'Set a report to Checking, Audit adjusted, True false alarm or Won’t change, and write back to the reporter.' },
    { key: 'fa.seeall', label: 'See everybody’s false alarm reports', desc: 'Without this, a person sees only the ones they reported themselves.' },
  ] },
  { group: 'Form submissions', items: [
    { key: 'leads.view', label: 'See form submissions', desc: 'The enquiries that came in through a website’s forms.' },
    { key: 'leads.contacts', label: 'See enquirers’ contact details', desc: 'Without this, an enquiry shows when it arrived, which page and which source — but not the customer’s name, email or phone.' },
    { key: 'leads.import', label: 'Import submission history', desc: 'Pull a website’s past enquiries in from Duda.' },
  ] },
  { group: 'Clients', items: [
    { key: 'client.manage', label: 'Give clients access to a website', desc: 'Create a client sign-in and choose which websites it can see.' },
    { key: 'client.viewas', label: 'Use View as client', desc: 'Check what a client sees on a website.' },
  ] },
  { group: 'Comments', items: [
    { key: 'comment.delete', label: 'Delete anybody’s comment', desc: 'Everyone can always delete their own.' },
    { key: 'duda.setup', label: 'Set up the Duda connection', desc: 'Connect, disconnect and check what is arriving.' },
    { key: 'duda.team', label: 'Decide who counts as the team', desc: 'Used to tell a client’s comment from one of ours.' },
  ] },
  { group: 'People', items: [
    { key: 'members.approve', label: 'Approve new accounts', desc: 'Let somebody who signed up in.' },
    { key: 'members.manage', label: 'Manage accounts', desc: 'Change somebody’s role, switch an account off, reset a password.' },
    { key: 'roles.manage', label: 'Create and change roles', desc: 'This screen. Give it out carefully — anyone with it can grant themselves anything else.' },
  ] },
  { group: 'The app', items: [
    { key: 'activity.view', label: 'See the activity log', desc: 'Everything everybody has done, across all websites.' },
    { key: 'app.maintenance', label: 'Run database clean-up', desc: 'Compress old records and trim long logs.' },
    { key: 'app.adminnotes', label: 'See admin pages of the Guide', desc: 'The sections and release notes written for whoever runs the app.' },
  ] },
];
export const PERM_KEYS = PERMISSIONS.flatMap((g) => g.items.map((i) => i.key));
const PERM_SET = new Set(PERM_KEYS);

/** The roles every installation starts with. Admin is everything and cannot be edited or removed. */
export const BUILTIN_ROLES = [
  { id: 'admin', name: 'Admin', perms: ['*'], builtin: true, locked: true,
    desc: 'Everything. At least one account must always have this.' },
  { id: 'member', name: 'Member', builtin: true,
    desc: 'The everyday role: audit websites, talk about them, report a false alarm.',
    perms: ['site.scan', 'site.manage', 'site.remove', 'site.bi', 'item.status', 'item.assign', 'leads.view', 'leads.contacts', 'client.viewas'] },
];
/** The client role is not a team role and never appears on the Roles screen. */
export const isTeamRole = (id) => id !== 'client';

export async function listRoles() {
  const [raw] = await redis(['HGETALL', P + 'roles']);
  const stored = {};
  if (Array.isArray(raw)) { for (let i = 0; i < raw.length; i += 2) stored[raw[i]] = jparse(raw[i + 1]); }
  else if (raw && typeof raw === 'object') Object.entries(raw).forEach(([k, v]) => { stored[k] = typeof v === 'string' ? jparse(v) : v; });
  // A built-in that has been edited (renamed, or its permissions changed) is kept as stored; one
  // that has never been touched falls back to the shipped definition, so a new installation works
  // with nothing written at all.
  const out = BUILTIN_ROLES.map((b) => Object.assign({}, b, stored[b.id] || {}, { id: b.id, builtin: true, locked: b.locked }));
  Object.values(stored).forEach((r) => { if (r && r.id && !BUILTIN_ROLES.some((b) => b.id === r.id)) out.push(Object.assign({ perms: [] }, r, { builtin: false })); });
  // Admin is always everything, whatever anybody managed to store.
  out.forEach((r) => { if (r.id === 'admin') { r.perms = ['*']; r.locked = true; } });
  return out;
}
export async function getRole(id) {
  const all = await listRoles();
  return all.find((r) => r.id === String(id || '')) || all.find((r) => r.id === 'member');
}
export async function saveRole(role) {
  await redis(['HSET', P + 'roles', role.id, JSON.stringify(role)]);
  return role;
}
export async function deleteRole(id) { await redis(['HDEL', P + 'roles', id]); }
/** Only keys the app actually offers are stored, so a stale or invented one can never grant anything. */
export const cleanPerms = (list) => [...new Set([].concat(list || []).map(String))].filter((k) => PERM_SET.has(k));

/**
 * Everything one person may do: their role, plus anything granted to them alone, minus anything
 * taken off them alone.
 *
 * Custom access is stored as the DIFFERENCE from the role, never as a copy of it. So when the role
 * changes, everybody on it moves with it and only the deliberate exceptions stay behind — and the
 * exceptions are exactly what the Members screen can show an admin, because they are what is stored.
 */
export function effectivePerms(role, user) {
  if (!user || user.role === 'client') return [];
  if (user.email === OWNER_EMAIL || user.role === 'admin') return ['*'];
  const base = new Set((role && role.perms) || []);
  cleanPerms(user.grant).forEach((k) => base.add(k));
  cleanPerms(user.revoke).forEach((k) => base.delete(k));
  return [...base];
}
/** Does this person have anything that is not simply their role? */
export const hasCustomAccess = (user) => !!(user && user.role !== 'admin' && user.role !== 'client'
  && ((user.grant || []).length || (user.revoke || []).length));

/**
 * May this person do this?
 *
 * The owner and the admin role are everything, by definition. Everyone else is their role's list
 * with their own exceptions applied. A client account is never allowed anything here — its own
 * endpoint is the only thing it reaches.
 */
export function canWith(role, user, perm) {
  if (!user || user.status !== 'active') return false;
  if (user.role === 'client') return false;
  // While previewing, the preview decides — including for an admin. A preview that quietly kept
  // your own powers would show you a screen nobody else can actually use.
  if (user.previewPerms) return user.previewPerms.includes('*') || user.previewPerms.includes(perm);
  if (user.email === OWNER_EMAIL || user.role === 'admin') return true;
  const perms = effectivePerms(role, user);
  return perms.includes('*') || perms.includes(perm);
}
/** The same thing when the role has not been loaded yet. */
export async function can(user, perm) {
  if (!user || user.status !== 'active' || user.role === 'client') return false;
  if (user.previewPerms) return user.previewPerms.includes('*') || user.previewPerms.includes(perm);
  if (user.email === OWNER_EMAIL || user.role === 'admin') return true;
  return canWith(await getRole(user.role), user, perm);
}
/**
 * Looking at the app as somebody else would see it.
 *
 * Only for people who manage accounts, and it only ever takes powers AWAY: the preview's permission
 * list replaces the viewer's own, so an admin previewing a Dev is refused exactly what a Dev is
 * refused. Nothing about who they are changes — their name is still on anything they do.
 */
export async function applyPreview(req, user) {
  // Belt and braces with the copy above: a request that is not a preview never carries one.
  delete user.previewPerms; delete user.previewOf;
  const asRole = String(req.headers['x-view-as-role'] || '').slice(0, 32);
  const asUser = normEmail(String(req.headers['x-view-as-user'] || '').slice(0, 160));
  if (!asRole && !asUser) return user;
  if (!(user.email === OWNER_EMAIL || user.role === 'admin')) return user;
  if (asUser) {
    const other = await getUser(asUser);
    if (!other || other.role === 'client') return user;
    user.previewPerms = other.role === 'admin' ? ['*'] : effectivePerms(await getRole(other.role), other);
    user.previewOf = { email: other.email, name: other.name, role: other.role, custom: hasCustomAccess(other) };
    return user;
  }
  const role = await getRole(asRole);
  if (!role || role.id !== asRole) return user;
  user.previewPerms = role.perms.includes('*') ? ['*'] : role.perms.slice();
  user.previewOf = { roleId: role.id, roleName: role.name };
  return user;
}
/**
 * A number that changes whenever anybody's access could have changed.
 *
 * It rides along on the heartbeat every open browser already sends, so a person whose role was just
 * edited finds out within a beat rather than the next time they happen to reload.
 */
export async function bumpAccess() { await redis(['INCR', P + 'ver:access']); }
export async function accessVersion() { const [v] = await redis(['GET', P + 'ver:access']); return String(v || 0); }
/** Refuse the request unless they may. Returns true when it has already answered. */
export async function denyUnless(res, user, perm, what) {
  if (await can(user, perm)) return false;
  res.status(403).json({ error: what || 'Your role does not allow that.' });
  return true;
}

// ---------- compact storage ----------
// Large records (website audits) are stored deflate-compressed: typically 5-8x smaller than plain JSON.
export function packJSON(obj) { return 'z1:' + zlib.deflateRawSync(Buffer.from(JSON.stringify(obj)), { level: 9 }).toString('base64'); }
export function unpackJSON(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string' && raw.startsWith('z1:')) { try { return JSON.parse(zlib.inflateRawSync(Buffer.from(raw.slice(3), 'base64')).toString()); } catch (e) { return null; } }
  return jparse(raw);
}
