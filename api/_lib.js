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

export async function redis(...cmds) {
  if (!hasRedis()) throw new Error('Upstash Redis is not connected to this Vercel project.');
  const r = await fetch(`${R_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${R_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error(`Redis ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const out = await r.json();
  return out.map((x) => { if (x.error) throw new Error(x.error); return x.result; });
}
export const jparse = (s, d = null) => { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } };

// ---------- misc ----------
export const normEmail = (e) => String(e || '').trim().toLowerCase();
export const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
export const newId = (n = 12) => crypto.randomBytes(n).toString('base64url');
export const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const now = () => new Date().toISOString();

export function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; }
}
export async function fetchWithTimeout(url, opts = {}, ms = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctl.signal }); } finally { clearTimeout(t); }
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
export function appUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `https://${host}`;
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
  return jparse(raw);
}
export async function putUser(u) {
  await redis(['SET', P + 'user:' + u.email, JSON.stringify(u)], ['SADD', P + 'users', u.email]);
  return u;
}
export const publicUser = (u) => u && ({ id: u.email, email: u.email, name: u.name, color: u.color, role: u.role, status: u.status, google: !!u.google, createdAt: u.createdAt, notifySecs: u.notifySecs === undefined ? 8 : u.notifySecs });
export async function listUsers() {
  const [emails] = await redis(['SMEMBERS', P + 'users']);
  if (!emails || !emails.length) return [];
  const raws = await redis(...emails.map((e) => ['GET', P + 'user:' + e]));
  return raws.map((r) => jparse(r)).filter(Boolean);
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
export async function currentUser(req) {
  const t = getToken(req);
  if (!t) return null;
  const c = cache.get(t);
  if (c && c.exp > Date.now()) return c.user;
  const [email] = await redis(['GET', P + 'sess:' + sha(t)]);
  if (!email) return null;
  const user = await getUser(email);
  // Cached for 3 minutes per server instance: saves two database reads on almost every request
  if (user) cache.set(t, { user, exp: Date.now() + 180000 });
  return user;
}
/** Require a signed-in, approved user. Sends 401/403 and returns null otherwise. */
export async function requireUser(req, res, { admin = false } = {}) {
  if (req.method !== 'GET' && req.headers.origin) {
    try { if (new URL(req.headers.origin).host !== (req.headers['x-forwarded-host'] || req.headers.host)) { res.status(403).json({ error: 'Bad origin' }); return null; } } catch (e) { /* ignore */ }
  }
  if (!hasRedis()) { res.status(500).json({ error: 'Upstash Redis is not connected to this Vercel project.' }); return null; }
  const u = await currentUser(req);
  if (!u) { res.status(401).json({ error: 'Please sign in' }); return null; }
  if (u.status !== 'active') { res.status(403).json({ error: 'Your account is waiting for admin approval', pending: true }); return null; }
  if (admin && u.role !== 'admin') { res.status(403).json({ error: 'Admins only' }); return null; }
  return u;
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

// ---------- in-app notifications + global (admin) activity log ----------
export async function notifyUser(email, n) {
  await redis(['LPUSH', P + 'notif:' + email, JSON.stringify({ id: newId(6), at: now(), ...n })], ['LTRIM', P + 'notif:' + email, 0, 99]);
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
    await sendEmail(a.email, `New account waiting for approval: ${user.name}`, emailShell('Someone wants to join Duda Site Auditor', `
      <p><b>${esc(user.name)}</b> (${esc(user.email)}) just created an account${user.google ? ' with Google' : ''}.</p>
      <p><a href="${link}" style="display:inline-block;background:#2563eb;color:#fff;padding:9px 14px;border-radius:8px;text-decoration:none">Review in Members</a></p>`)).catch(() => {});
  }
  await slack(`:wave: *${user.name}* (${user.email}) created a Duda Site Auditor account and is waiting for admin approval. <${link}|Review in Members>`);
}

// ---------- compact storage ----------
// Large records (website audits) are stored deflate-compressed: typically 5-8x smaller than plain JSON.
export function packJSON(obj) { return 'z1:' + zlib.deflateRawSync(Buffer.from(JSON.stringify(obj)), { level: 9 }).toString('base64'); }
export function unpackJSON(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string' && raw.startsWith('z1:')) { try { return JSON.parse(zlib.inflateRawSync(Buffer.from(raw.slice(3), 'base64')).toString()); } catch (e) { return null; } }
  return jparse(raw);
}
