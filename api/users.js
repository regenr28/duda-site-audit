// Team members = user accounts.
// GET  /api/users                       → { users, me }   (admins also see pending accounts)
// POST /api/users { op: approve | remove | role | resetPassword | profile, email, ... }
import crypto from 'node:crypto';
import { redis, P, readBody, requireUser, normEmail, getUser, putUser, publicUser, listUsers, hashPassword, sendEmail, emailShell, esc, appUrl, globalLog, notifyUser, slackDM, slackLink, slackWho, OWNER_EMAIL, forgetUser, nameTaken, now } from './_lib.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const me = await requireUser(req, res);
  if (!me) return;
  try {
    if (req.method === 'GET') {
      const all = await listUsers();
      const visible = me.role === 'admin' ? all : all.filter((u) => u.status === 'active' || u.status === 'disabled');
      // Members don't see who is an admin (avoids "why are they admin?" friction); admins see roles to manage them
      const shape = (u) => { const x = publicUser(u); if (me.role !== 'admin' && u.email !== me.email) delete x.role; else if (u.email === OWNER_EMAIL) { if (me.email === OWNER_EMAIL) x.superAdmin = true; else x.locked = true; } return x; };
      return res.status(200).json({ me: publicUser(me), users: visible.map(shape).sort((a, b) => a.name.localeCompare(b.name)) });
    }
    const b = readBody(req);
    if (b.op === 'profile') {
      const name = String(b.name || '').trim().slice(0, 60);
      if (!name) return res.status(400).json({ error: 'Name required' });
      if (name.toLowerCase() !== String(me.name || '').toLowerCase() && await nameTaken(name, me.email)) {
        return res.status(409).json({ error: `Someone on the team already uses the name "${name}". Please add a surname or an initial so mentions point to the right person.` });
      }
      if (name !== me.name) {
        // Renames are recorded so older mentions and activity can still be traced
        me.nameHistory = (me.nameHistory || []).concat([{ from: me.name, to: name, at: now() }]).slice(-20);
        await globalLog({ email: me.email, name }, 'rename', `changed their display name from "${me.name}" to "${name}"`);
      }
      me.name = name;
      // How long pop-up notifications stay on screen (seconds; 0 = until closed)
      if (b.notifySecs !== undefined) { const n = Number(b.notifySecs); if (Number.isFinite(n) && n >= 0 && n <= 600) me.notifySecs = Math.round(n); }
      if (b.slackDM !== undefined) me.slackDM = !!b.slackDM;
      // Which editor address this member opens: the white-label one or my.duda.co
      if (b.editorEnv !== undefined) me.editorEnv = b.editorEnv === 'duda' ? 'duda' : 'white';
      // Which "What's New" note this person has seen (so the light bulb stops glowing)
      if (b.newsSeen !== undefined) me.newsSeen = String(b.newsSeen || '').slice(0, 60);
      await putUser(me);
      return res.status(200).json({ user: publicUser(me) });
    }
    if (b.op === 'slackWho') {
      if (me.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
      const all = await listUsers();
      return res.status(200).json({ who: await slackWho(all.filter((u) => u.status === 'active').map((u) => u.email)) });
    }
    if (b.op === 'slackLink') {
      // Opens a Slack DM with a teammate (clicking their name in the app)
      const r = await slackLink(String(b.email || ''));
      const why = { not_configured: 'Slack is not set up yet.', not_in_slack: "This teammate's app email isn't used in Slack." };
      return res.status(200).json(r.ok ? { ok: true, app: `slack://user?team=${r.team}&id=${r.id}`, web: `https://app.slack.com/client/${r.team}/${r.id}` } : { ok: false, message: why[r.reason] || "Couldn't reach Slack right now." });
    }
    if (b.op === 'slackTest') {
      const r = await slackDM(me.email, { kind: 'test', byName: 'Site Auditor', text: 'Slack messages are working. You will get updates here when someone mentions you, replies, or assigns you an audit item.' });
      const why = { not_configured: 'Slack messages are not set up yet. Please contact the app owner.', not_in_slack: `No Slack account uses ${me.email}. Register in the app with the same email you use in Slack.`, missing_scope: 'The Slack connection is missing a permission. Please contact the app owner.', invalid_auth: 'The Slack connection is not valid. Please contact the app owner.' };
      return res.status(200).json({ sent: r.sent, message: r.sent ? 'Sent! Check your Slack.' : why[r.reason] || `Slack said: ${r.reason}` });
    }
    // Admin actions always check the latest role (not the short session cache), so a just-demoted admin can't act
    const fresh = me.role === 'admin' ? await getUser(me.email) : null;
    if (!fresh || fresh.role !== 'admin' || fresh.status !== 'active') return res.status(403).json({ error: 'Admins only' });
    const target = await getUser(b.email);
    if (!target) return res.status(404).json({ error: 'User not found' });
    const email = normEmail(b.email);
    // The owner's account can only be managed by the owner (others just see a normal admin they can't change)
    if (email === OWNER_EMAIL && ['remove', 'role', 'resetPassword', 'disable'].includes(b.op)) {
      if (me.email !== OWNER_EMAIL) return res.status(403).json({ error: "You don't have permission to change this account." });
      if (b.op === 'remove' || b.op === 'disable') return res.status(400).json({ error: "You can't remove or switch off yourself" });
      if (b.op === 'role' && b.role !== 'admin') return res.status(400).json({ error: 'The Super Admin always stays an admin.' });
    }
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
      case 'disable': case 'enable': {
        // Switching an account off keeps its history (who did what) instead of deleting it
        if (email === me.email) return res.status(400).json({ error: "You can't switch off your own account" });
        if (target.status === 'pending') return res.status(400).json({ error: 'Approve or reject this account first' });
        target.status = b.op === 'disable' ? 'disabled' : 'active';
        if (b.op === 'disable') { target.disabledAt = now(); target.disabledBy = me.email; } else { delete target.disabledAt; delete target.disabledBy; }
        await putUser(target);
        await globalLog(me, b.op, `${b.op === 'disable' ? 'switched off' : 'switched on'} the account of ${target.name} (${email})`);
        break;
      }
      case 'resetPassword': {
        const temp = crypto.randomBytes(6).toString('base64url');
        Object.assign(target, hashPassword(temp)); await putUser(target);
        await globalLog(me, 'reset', `reset the password for ${target.name}`);
        return res.status(200).json({ ok: true, tempPassword: temp });
      }
      default:
        return res.status(400).json({ error: 'Unknown op' });
    }
    forgetUser(email);
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
