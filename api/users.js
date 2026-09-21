// Team members = user accounts.
// GET  /api/users                       → { users, me }   (admins also see pending accounts)
// POST /api/users { op: approve | remove | role | resetPassword | profile, email, ... }
import crypto from 'node:crypto';
import { redis, P, readBody, requireUser, normEmail, getUser, putUser, publicUser, listUsers, hashPassword, sendEmail, emailShell, esc, appUrl, globalLog, notifyUser } from './_lib.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const me = await requireUser(req, res);
  if (!me) return;
  try {
    if (req.method === 'GET') {
      const all = await listUsers();
      const visible = me.role === 'admin' ? all : all.filter((u) => u.status === 'active');
      return res.status(200).json({ me: publicUser(me), users: visible.map(publicUser).sort((a, b) => a.name.localeCompare(b.name)) });
    }
    const b = readBody(req);
    if (b.op === 'profile') {
      const name = String(b.name || '').trim().slice(0, 60);
      if (!name) return res.status(400).json({ error: 'Name required' });
      me.name = name;
      // How long pop-up notifications stay on screen (seconds; 0 = until closed)
      if (b.notifySecs !== undefined) { const n = Number(b.notifySecs); if (Number.isFinite(n) && n >= 0 && n <= 600) me.notifySecs = Math.round(n); }
      await putUser(me);
      return res.status(200).json({ user: publicUser(me) });
    }
    if (me.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
    const target = await getUser(b.email);
    if (!target) return res.status(404).json({ error: 'User not found' });
    const email = normEmail(b.email);
    switch (b.op) {
      case 'approve':
        target.status = 'active'; target.approvedBy = me.email; target.approvedAt = new Date().toISOString(); await putUser(target);
        await globalLog(me, 'approve', `approved ${target.name} (${email})`);
        await sendEmail(email, 'Your Duda Site Auditor account is approved', emailShell('You\'re in!', `<p>${esc(me.name)} approved your account.</p><p><a href="${appUrl(req)}">Open Duda Site Auditor</a></p>`)).catch(() => {});
        break;
      case 'remove':
        if (email === me.email) return res.status(400).json({ error: "You can't remove yourself" });
        await redis(['DEL', P + 'user:' + email], ['SREM', P + 'users', email]);
        await globalLog(me, target.status === 'pending' ? 'reject' : 'remove', `${target.status === 'pending' ? 'rejected' : 'removed'} ${target.name} (${email})`);
        break;
      case 'role':
        if (email === me.email && b.role !== 'admin') {
          const admins = (await listUsers()).filter((u) => u.role === 'admin' && u.status === 'active');
          if (admins.length < 2) return res.status(400).json({ error: 'Make someone else an admin first' });
        }
        target.role = b.role === 'admin' ? 'admin' : 'member'; await putUser(target);
        await globalLog(me, 'role', `made ${target.name} ${target.role === 'admin' ? 'an admin' : 'a member'}`);
        break;
      case 'resetPassword': {
        const temp = crypto.randomBytes(6).toString('base64url');
        Object.assign(target, hashPassword(temp)); await putUser(target);
        await globalLog(me, 'reset', `reset the password for ${target.name}`);
        return res.status(200).json({ ok: true, tempPassword: temp });
      }
      default:
        return res.status(400).json({ error: 'Unknown op' });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
