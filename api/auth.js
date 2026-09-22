// Authentication: email + password (with emailed verification code), Google sign-in, remember me, forgot password.
// GET  /api/auth?op=config | me
// POST /api/auth { op: signup | verify | resend | login | google | logout | forgot | reset }
import crypto from 'node:crypto';
import {
  redis, hasRedis, P, readBody, normEmail, isEmail, sha, now, hashPassword, checkPassword, getUser, putUser, publicUser,
  initialAccess, createSession, destroySession, currentUser, emailEnabled, sendEmail, emailShell, esc, COLORS, fetchWithTimeout, announceSignup, userChannel, OWNER_EMAIL , savedEditorHost } from './_lib.js';

const CODE_TTL = 15 * 60;
const code6 = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

async function limited(key, max, windowSec) {
  const [n] = await redis(['INCR', P + 'rl:' + key]);
  if (n === 1) await redis(['EXPIRE', P + 'rl:' + key, windowSec]);
  return n > max;
}
async function sendCode(kind, email, name) {
  const code = code6();
  await redis(['SET', P + kind + ':' + email, JSON.stringify({ h: sha(code), tries: 0 }), 'EX', CODE_TTL]);
  const title = kind === 'reset' ? 'Reset your password' : 'Verify your email';
  const lead = kind === 'reset' ? 'Use this code to set a new password:' : `Hi ${esc(name || '')}, use this code to finish creating your account:`;
  await sendEmail(email, `${code} is your Duda Site Auditor code`, emailShell(title, `<p>${lead}</p>
    <div style="font-size:32px;font-weight:700;letter-spacing:8px;background:#f1f3f6;border-radius:10px;padding:16px;text-align:center">${code}</div>
    <p style="color:#5d6572">This code expires in 15 minutes.</p>`));
}
async function checkCode(kind, email, code) {
  const key = P + kind + ':' + email;
  const [raw] = await redis(['GET', key]);
  const rec = raw ? JSON.parse(raw) : null;
  if (!rec) return 'The code has expired. Request a new one.';
  if (rec.tries >= 5) return 'Too many wrong attempts. Request a new code.';
  if (rec.h !== sha(String(code || '').trim())) {
    rec.tries++; await redis(['SET', key, JSON.stringify(rec), 'KEEPTTL']);
    return 'That code is not correct.';
  }
  await redis(['DEL', key]);
  return null;
}
async function finishLogin(res, user, remember) {
  await createSession(res, user.email, !!remember);
  return res.status(200).json({ user: publicUser(user) });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!hasRedis()) return res.status(500).json({ error: 'The database is not connected. Please contact the app owner.' });
  try {
    if (req.method === 'GET') {
      if (req.query.op === 'config') return res.status(200).json({ googleClientId: process.env.GOOGLE_CLIENT_ID || '', emailEnabled: emailEnabled(), realtime: !!(process.env.ABLY_API_KEY && process.env.ABLY_API_KEY.includes(':')), realtimePrefix: (process.env.STORE_PREFIX || 'dsa').replace(/[^\w-]/g, ''), slackDM: /^xox[bp]-/.test(process.env.SLACK_BOT_TOKEN || ''), editorHost: await savedEditorHost() });
      const u = await currentUser(req);
      return res.status(200).json({ user: publicUser(u), rtChannel: u ? userChannel(u.email) : '', ...(u && u.email === OWNER_EMAIL ? { superAdmin: true } : {}) });
    }
    if (req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== (req.headers['x-forwarded-host'] || req.headers.host)) return res.status(403).json({ error: 'Bad origin' }); } catch (e) { /* ignore */ }
    }
    const b = readBody(req);
    const email = normEmail(b.email);
    switch (b.op) {
      case 'signup': {
        const name = String(b.name || '').trim().slice(0, 60);
        if (!name) return res.status(400).json({ error: 'Please enter your name' });
        if (!isEmail(email)) return res.status(400).json({ error: 'Please enter a valid email' });
        if (String(b.password || '').length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
        if (await getUser(email)) return res.status(409).json({ error: 'An account with this email already exists. Sign in instead, or use "Forgot password".' });
        if (await limited('signup:' + email, 5, 3600)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
        const { salt, hash } = hashPassword(b.password);
        if (!emailEnabled()) {
          // No email service configured: create the account right away (admin approval still applies)
          const access = await initialAccess(email);
          const user = await putUser({ email, name, salt, hash, color: COLORS[Math.floor(Math.random() * COLORS.length)], ...access, createdAt: now() });
          await announceSignup(user, req);
          if (user.status !== 'active') return res.status(200).json({ pending: true, message: 'Account created. Status: Admin for Approval. The admins have been notified.' });
          return finishLogin(res, user, b.remember);
        }
        await redis(['SET', P + 'pending:' + email, JSON.stringify({ name, salt, hash }), 'EX', CODE_TTL]);
        await sendCode('verify', email, name);
        return res.status(200).json({ needCode: true, message: `We sent a 6-digit code to ${email}.` });
      }
      case 'resend': {
        if (await limited('resend:' + email, 5, 3600)) return res.status(429).json({ error: 'Too many codes requested. Try again later.' });
        const kind = b.kind === 'reset' ? 'reset' : 'verify';
        if (kind === 'verify') {
          const [raw] = await redis(['GET', P + 'pending:' + email]);
          if (!raw) return res.status(400).json({ error: 'Sign-up expired. Please sign up again.' });
          await redis(['EXPIRE', P + 'pending:' + email, CODE_TTL]);
          await sendCode('verify', email, JSON.parse(raw).name);
        } else if (await getUser(email)) await sendCode('reset', email);
        return res.status(200).json({ ok: true, message: 'A new code is on its way.' });
      }
      case 'verify': {
        const err = await checkCode('verify', email, b.code);
        if (err) return res.status(400).json({ error: err });
        const [raw] = await redis(['GET', P + 'pending:' + email]);
        if (!raw) return res.status(400).json({ error: 'Sign-up expired. Please sign up again.' });
        if (await getUser(email)) return res.status(409).json({ error: 'An account with this email already exists.' });
        const pend = JSON.parse(raw);
        const access = await initialAccess(email);
        const user = await putUser({ email, name: pend.name, salt: pend.salt, hash: pend.hash, color: COLORS[Math.floor(Math.random() * COLORS.length)], ...access, verified: true, createdAt: now() });
        await redis(['DEL', P + 'pending:' + email]);
        await announceSignup(user, req);
        if (user.status !== 'active') return res.status(200).json({ pending: true, message: 'Email verified. Status: Admin for Approval. The admins have been notified.' });
        return finishLogin(res, user, b.remember);
      }
      case 'login': {
        if (await limited('login:' + email, 10, 900)) return res.status(429).json({ error: 'Too many attempts. Wait 15 minutes and try again.' });
        const user = await getUser(email);
        if (!user || !checkPassword(b.password, user.salt, user.hash)) {
          return res.status(401).json({ error: user && user.google && !user.hash ? 'This account uses Google sign-in. Click "Sign in with Google", or use "Forgot password" to set a password.' : 'Wrong email or password' });
        }
        if (user.status !== 'active') return res.status(403).json({ pending: true, error: 'Your account status is "Admin for Approval". You can sign in once an admin approves it.' });
        await redis(['DEL', P + 'rl:login:' + email]);
        return finishLogin(res, user, b.remember);
      }
      case 'google': {
        const cid = process.env.GOOGLE_CLIENT_ID;
        if (!cid) return res.status(400).json({ error: 'Google sign-in is not configured' });
        const r = await fetchWithTimeout('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(b.credential || ''), {}, 8000);
        const info = await r.json();
        if (!r.ok || info.aud !== cid || !['accounts.google.com', 'https://accounts.google.com'].includes(info.iss) || String(info.email_verified) !== 'true') {
          return res.status(401).json({ error: 'Google sign-in failed. Please try again.' });
        }
        const gEmail = normEmail(info.email);
        let user = await getUser(gEmail);
        if (!user) {
          // Same email = same account, so Google and manual sign-in never create duplicates
          const access = await initialAccess(gEmail);
          user = await putUser({ email: gEmail, name: info.name || gEmail.split('@')[0], google: true, verified: true, color: COLORS[Math.floor(Math.random() * COLORS.length)], ...access, createdAt: now() });
          await announceSignup(user, req);
        } else if (!user.google) { user.google = true; await putUser(user); }
        if (user.status !== 'active') return res.status(403).json({ pending: true, error: 'Your account status is "Admin for Approval". You can sign in once an admin approves it.' });
        return finishLogin(res, user, b.remember);
      }
      case 'logout':
        await destroySession(req, res);
        return res.status(200).json({ ok: true });
      case 'forgot': {
        if (!emailEnabled()) return res.status(400).json({ error: 'Email is not set up for this app. Ask an admin to reset your password from Members.' });
        if (await limited('forgot:' + email, 5, 3600)) return res.status(429).json({ error: 'Too many requests. Try again later.' });
        if (await getUser(email)) await sendCode('reset', email);
        // Same answer either way so nobody can probe which emails have accounts
        return res.status(200).json({ needCode: true, message: `If ${email} has an account, we sent it a 6-digit code.` });
      }
      case 'reset': {
        if (String(b.password || '').length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
        const err = await checkCode('reset', email, b.code);
        if (err) return res.status(400).json({ error: err });
        const user = await getUser(email);
        if (!user) return res.status(400).json({ error: 'Account not found' });
        Object.assign(user, hashPassword(b.password), { verified: true });
        await putUser(user);
        if (user.status !== 'active') return res.status(200).json({ pending: true, message: 'Password updated. Your account still needs admin approval.' });
        return finishLogin(res, user, b.remember);
      }
      default:
        return res.status(400).json({ error: 'Unknown op' });
    }
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
