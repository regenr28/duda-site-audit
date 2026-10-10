// Team members = user accounts.
// GET  /api/users                       → { users, me }   (admins also see pending accounts)
// POST /api/users { op: approve | remove | role | resetPassword | profile, email, ... }
import crypto from 'node:crypto';
import { redis, P, readBody, requireUser, normEmail, getUser, putUser, publicUser, listUsers, hashPassword, sendEmail, emailShell, esc, appUrl, globalLog, notifyUser, slackDM, slackLink, slackWho, OWNER_EMAIL, forgetUser, nameTaken, now, NOTIFY_KEYS, isEmail, COLORS, can, denyUnless, listRoles, getRole, saveRole, deleteRole, cleanPerms, PERMISSIONS, isTeamRole, effectivePerms, hasCustomAccess, bumpAccess, jparse, realName, secLog, readSecLog, slackLookup } from './_lib.js';

const TEMP_DAYS = 7;
const tempPassword = () => crypto.randomBytes(8).toString('base64url');
const isSuper = (me) => me.email === OWNER_EMAIL && !me.previewPerms;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const me = await requireUser(req, res);
  if (!me) return;
  try {
    if (req.method === 'GET') {
      // Clients are not team members: they never appear in Members, in @mentions, or as an assignee.
      const all = (await listUsers()).filter((u) => u.role !== 'client');
      const visible = me.role === 'admin' ? all : all.filter((u) => u.status === 'active' || u.status === 'disabled');
      // Members don't see who is an admin (avoids "why are they admin?" friction); admins see roles to manage them
      const shape = (u) => { const x = publicUser(u); if (me.role === 'admin') { if (!realName(u.name)) x.needsName = true; if (u.mustChange) { x.mustChange = true; x.tempExpires = u.tempExpires || ''; } } else delete x.mustChange; if (me.role !== 'admin' && u.email !== me.email) delete x.role; else if (u.email === OWNER_EMAIL) { if (me.email === OWNER_EMAIL) x.superAdmin = true; else x.locked = true; } return x; };
      return res.status(200).json({ me: publicUser(me), users: visible.map(shape).sort((a, b) => a.name.localeCompare(b.name)) });
    }
    const b = readBody(req);
    if (b.op === 'profile') {
      const name = String(b.name || '').trim().slice(0, 60);
      if (!name) return res.status(400).json({ error: 'Name required' });
      // A new name must be a real full name; a name that is not changing is left alone, so somebody
      // with an older one-word name can still save their other settings.
      if (name !== me.name && me.role !== 'client' && !realName(name)) return res.status(400).json({ error: 'Use your real full name: first and last name, no nicknames.' });
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
      // Which notifications this person has switched off, as "group:channel". Only the switches the
      // app actually offers are stored, so a stale or invented key can never quietly mute anything.
      if (Array.isArray(b.notifyOff)) me.notifyOff = [...new Set(b.notifyOff.map(String))].filter((k) => NOTIFY_KEYS.includes(k));
      // Which editor address this member opens: the white-label one or my.duda.co
      if (b.editorEnv !== undefined) me.editorEnv = b.editorEnv === 'duda' ? 'duda' : 'white';
      // Which "What's New" note this person has seen (so the light bulb stops glowing)
      if (b.newsSeen !== undefined) me.newsSeen = String(b.newsSeen || '').slice(0, 60);
      await putUser(me);
      return res.status(200).json({ user: publicUser(me) });
    }
    // ---------- security log ----------
    // Your own, always. Anybody else's: the Super Admin only — not even other admins.
    if (b.op === 'seclog') {
      const email = normEmail(b.email || me.email);
      if (email !== me.email && !isSuper(me)) return res.status(403).json({ error: 'You can only see your own security log.' });
      const u = await getUser(email);
      if (!u) return res.status(404).json({ error: 'User not found' });
      return res.status(200).json({ email, name: u.name, entries: await readSecLog(email) });
    }
    if (b.op === 'seclogAll') {
      if (!isSuper(me)) return res.status(403).json({ error: 'Only the Super Admin can see everyone\'s security log.' });
      const people = (await listUsers()).filter((u) => u.role !== 'client');
      const lists = people.length ? await redis(...people.map((u) => ['LRANGE', P + 'seclog:' + u.email, 0, 59])) : [];
      const entries = [];
      people.forEach((u, i) => (lists[i] || []).forEach((r) => { const e = jparse(r); if (e) entries.push(Object.assign(e, { email: u.email, name: u.name })); }));
      entries.sort((a, c) => String(c.at).localeCompare(String(a.at)));
      return res.status(200).json({ entries: entries.slice(0, 400) });
    }
    if (b.op === 'slackWho') {
      if (await denyUnless(res, me, 'duda.team', 'Your role does not allow that.')) return;
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

    // ---------- adding a member with a temporary password ----------
    if (b.op === 'slackCheck') {
      if (await denyUnless(res, me, 'members.manage', 'Your role does not allow adding members.')) return;
      const email = normEmail(b.email);
      if (!isEmail(email)) return res.status(400).json({ error: 'Enter a valid email address first.' });
      return res.status(200).json(await slackLookup(email));
    }
    if (b.op === 'create') {
      if (await denyUnless(res, me, 'members.manage', 'Your role does not allow adding members.')) return;
      const name = realName(b.name);
      if (!name) return res.status(400).json({ error: 'Enter their real full name: first and last name, no nicknames or usernames.' });
      const email = normEmail(b.email);
      if (!isEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
      if (await getUser(email)) return res.status(409).json({ error: 'There is already an account with this email.' });
      if (await nameTaken(name)) return res.status(409).json({ error: `Someone on the team is already called "${name}". Add a middle initial so mentions point to the right person.` });
      const roles = await listRoles();
      const role = roles.find((r) => r.id === String(b.role || '') && isTeamRole(r.id)) || roles.find((r) => r.id === 'member');
      if (role.id === 'admin' && !(await can(me, 'roles.manage')) && fresh.role !== 'admin') return res.status(403).json({ error: 'Only an admin can create another admin.' });
      const temp = tempPassword();
      const u = { email, name, role: role.id, status: 'active', ...hashPassword(temp), verified: true, mustChange: true,
        tempExpires: new Date(Date.now() + TEMP_DAYS * 86400000).toISOString(), color: COLORS[Math.floor(Math.random() * COLORS.length)],
        createdAt: now(), createdBy: me.email, approvedBy: me.email, approvedAt: now(), slackChecked: b.slack === true ? 'found' : b.slack === false ? 'missing' : undefined };
      if (role.id !== 'admin') {
        const base = new Set(role.perms || []); const wanted = Array.isArray(b.perms) ? new Set(cleanPerms(b.perms)) : null;
        if (wanted) { u.grant = [...wanted].filter((k) => !base.has(k)); u.revoke = [...base].filter((k) => k !== '*' && !wanted.has(k)); }
      }
      await putUser(u);
      await bumpAccess();
      await secLog(email, 'account-created', req, { by: me.email, byName: me.name, role: role.name });
      await globalLog(me, 'member-add', `added ${name} (${email}) as ${/^[aeiou]/i.test(role.name) ? 'an' : 'a'} ${role.name}, with a temporary password`);
      return res.status(200).json({ ok: true, tempPassword: temp, tempExpires: u.tempExpires, user: publicUser(u) });
    }
    if (b.op === 'rename') {
      if (await denyUnless(res, me, 'members.manage', 'Your role does not allow changing members.')) return;
      const t = await getUser(b.email);
      if (!t || t.role === 'client') return res.status(404).json({ error: 'No such team member' });
      if (normEmail(b.email) === OWNER_EMAIL && me.email !== OWNER_EMAIL) return res.status(403).json({ error: "You don't have permission to change this account." });
      const name = realName(b.name);
      if (!name) return res.status(400).json({ error: 'Enter their real full name: first and last name, no nicknames or usernames.' });
      if (name.toLowerCase() !== String(t.name || '').toLowerCase() && await nameTaken(name, t.email)) return res.status(409).json({ error: `Someone on the team is already called "${name}".` });
      if (name !== t.name) {
        t.nameHistory = (t.nameHistory || []).concat([{ from: t.name, to: name, at: now(), by: me.email }]).slice(-20);
        await globalLog(me, 'rename', `changed ${t.name}'s name to "${name}"`);
        t.name = name; await putUser(t); await bumpAccess();
        await secLog(t.email, 'renamed', req, { by: me.email, byName: me.name, to: name });
      }
      return res.status(200).json({ ok: true, user: publicUser(t) });
    }

    // ---------- one person's own exceptions ----------
    // Stored as the difference from their role, never a copy of it: change the role and everyone on
    // it moves, with only the deliberate exceptions left behind.
    if (b.op === 'access') {
      if (await denyUnless(res, me, 'members.manage', 'Your role does not allow changing what people can do.')) return;
      const email = normEmail(b.email);
      const u = await getUser(email);
      if (!u || u.role === 'client') return res.status(404).json({ error: 'No such team member' });
      if (u.role === 'admin') return res.status(400).json({ error: 'An Admin already has everything, so there is nothing to add or take away.' });
      const role = await getRole(u.role);
      const base = new Set(role.perms || []);
      const wanted = new Set(cleanPerms(b.perms));
      // Only the differences are kept, so the stored exceptions are exactly what the review shows.
      u.grant = [...wanted].filter((k) => !base.has(k));
      u.revoke = [...base].filter((k) => k !== '*' && !wanted.has(k));
      await putUser(u);
      await bumpAccess();
      await secLog(email, 'access-changed', req, { by: me.email, byName: me.name });
      await globalLog(me, 'access', (u.grant.length || u.revoke.length)
        ? `gave ${u.name} custom access (${u.grant.length} extra, ${u.revoke.length} removed)`
        : `put ${u.name} back on the plain ${role.name} role`);
      if (email !== me.email) {
        await notifyUser(email, { by: me.email, byName: me.name, kind: 'access',
          text: (u.grant.length || u.revoke.length) ? `Your access was changed — ${u.grant.length} extra, ${u.revoke.length} removed` : `You are back on the plain ${role.name} role` }).catch(() => {});
      }
      return res.status(200).json({ ok: true, grant: u.grant, revoke: u.revoke, perms: effectivePerms(role, u) });
    }
    // Who is in the middle of something right now, so nobody's access is pulled out from under them
    // without the person doing it knowing.
    if (b.op === 'busy') {
      const email = normEmail(b.email);
      const [pres] = await redis(['HGETALL', P + 'presence']);
      const map = {};
      if (Array.isArray(pres)) { for (let i = 0; i < pres.length; i += 2) map[pres[i]] = jparse(pres[i + 1]); }
      else if (pres && typeof pres === 'object') Object.entries(pres).forEach(([k, v]) => { map[k] = typeof v === 'string' ? jparse(v) : v; });
      const p2 = map[email];
      const fresh = p2 && Date.now() - Date.parse(p2.seen || 0) < 10 * 60000;
      return res.status(200).json({ online: !!fresh, where: fresh ? (p2.where || null) : null, name: p2 ? p2.name : '' });
    }

    // ---------- roles ----------
    if (b.op === 'roles') {
      const roles = await listRoles();
      const all = (await listUsers()).filter((u) => isTeamRole(u.role));
      const counts = {};
      all.forEach((u) => { counts[u.role] = (counts[u.role] || 0) + 1; });
      return res.status(200).json({ roles, counts, permissions: PERMISSIONS, canManage: await can(me, 'roles.manage') });
    }
    if ((b.op === 'roleSave' || b.op === 'roleDelete') && await denyUnless(res, me, 'roles.manage', 'Your role does not allow changing roles.')) return;
    if (b.op === 'roleSave') {
      const name = String(b.name || '').trim().slice(0, 40);
      if (!name) return res.status(400).json({ error: 'Give the role a name' });
      const roles = await listRoles();
      let id = String(b.id || '').trim().slice(0, 32);
      if (id === 'client' || /^client$/i.test(name)) return res.status(400).json({ error: 'That name is reserved for client sign-ins.' });
      const existing = id ? roles.find((r) => r.id === id) : null;
      if (id && !existing) return res.status(404).json({ error: 'No such role' });
      if (!id) {
        id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || ('role' + Date.now().toString(36));
        if (roles.some((r) => r.id === id)) return res.status(409).json({ error: `There is already a role called "${name}".` });
      }
      if (roles.some((r) => r.id !== id && r.name.toLowerCase() === name.toLowerCase())) return res.status(409).json({ error: `There is already a role called "${name}".` });
      // Admin is everything, always. It can be renamed, but its permissions are not up for debate:
      // an installation nobody can get back into is not a state anyone should be able to reach.
      const perms = id === 'admin' ? ['*'] : cleanPerms(b.perms);
      const role = { id, name, desc: String(b.desc || '').trim().slice(0, 160), perms, builtin: !!(existing && existing.builtin) };
      await saveRole(role);
      await bumpAccess();
      await globalLog(me, 'role', existing ? `changed the role "${name}"` : `created the role "${name}"`);
      return res.status(200).json({ role });
    }
    if (b.op === 'roleDelete') {
      const id = String(b.id || '');
      const roles = await listRoles();
      const role = roles.find((r) => r.id === id);
      if (!role) return res.status(404).json({ error: 'No such role' });
      if (role.builtin) return res.status(400).json({ error: `${role.name} is built in, so it can't be removed. You can rename it and change what it allows.` });
      const holders = (await listUsers()).filter((u) => u.role === id);
      // Nobody is left without a role, and nobody is quietly promoted. If people hold this role, the
      // person removing it has to say where they go — and is told how many that is before deciding.
      if (holders.length) {
        const dest = roles.find((r) => r.id === String(b.moveTo || '') && r.id !== id);
        if (!dest) {
          return res.status(409).json({ error: `${holders.length} ${holders.length === 1 ? 'person has' : 'people have'} this role. Choose what they become instead.`,
            needsMove: true, count: holders.length, names: holders.slice(0, 8).map((u) => u.name),
            choices: roles.filter((r) => r.id !== id).map((r) => ({ id: r.id, name: r.name })) });
        }
        for (const u of holders) { u.role = dest.id; await putUser(u); }
        await globalLog(me, 'role', `moved ${holders.length} ${holders.length === 1 ? 'person' : 'people'} from "${role.name}" to "${dest.name}"`);
      }
      await deleteRole(id);
      await bumpAccess();
      await globalLog(me, 'role', `removed the role "${role.name}"`);
      return res.status(200).json({ ok: true, moved: holders.length });
    }

    // ---------- client accounts ----------
    // A client is only ever created here, by an admin, with an explicit list of websites. Signing
    // up can never produce one, and a client account can never be given a team role by this path.
    if (b.op === 'clients') {
      const all = await listUsers();
      return res.status(200).json({ clients: all.filter((u) => u.role === 'client').map((u) => ({
        email: u.email, name: u.name, company: u.company || '', sites: u.sites || [], dudaAccount: u.dudaAccount || '',
        status: u.status, createdAt: u.createdAt, lastSeen: u.lastSeen || '' })).sort((a, c) => a.name.localeCompare(c.name)) });
    }
    if (b.op === 'clientSave') {
      const email = normEmail(b.email);
      if (!isEmail(email)) return res.status(400).json({ error: 'A valid email address is needed' });
      const name = String(b.name || '').trim().slice(0, 60) || email.split('@')[0];
      const sites = [...new Set([].concat(b.sites || []).map((x) => String(x).slice(0, 64)))].slice(0, 50);
      let u = await getUser(email);
      if (u && u.role !== 'client') return res.status(409).json({ error: `${u.name} is already on the team — a person can be one or the other, not both.` });
      const isNew = !u;
      u = u || { email, name, color: COLORS[Math.floor(Math.random() * COLORS.length)], createdAt: now() };
      u.name = name; u.role = 'client'; u.status = 'active';
      u.company = String(b.company || '').trim().slice(0, 80);
      u.dudaAccount = String(b.dudaAccount || '').trim().slice(0, 120);
      u.sites = sites;
      await putUser(u);
      await globalLog(me, 'client', `${isNew ? 'gave' : 'updated'} ${name} (${email}) access to ${sites.length} website${sites.length === 1 ? '' : 's'}`);
      if (isNew) {
        await sendEmail(email, 'Your website dashboard is ready', emailShell('Your website dashboard', `
          <p>Hi ${esc(name)}, you can now see your website's enquiries, comments and performance in one place.</p>
          <p>To set your password, open the link below and choose <b>Forgot password</b>.</p>
          <p><a href="${appUrl(req)}" style="display:inline-block;background:#2563eb;color:#fff;padding:9px 14px;border-radius:8px;text-decoration:none">Open your dashboard</a></p>`)).catch(() => {});
      }
      return res.status(200).json({ ok: true, isNew });
    }
    if (b.op === 'clientRemove') {
      const email = normEmail(b.email);
      const u = await getUser(email);
      if (!u || u.role !== 'client') return res.status(404).json({ error: 'No such client account' });
      await forgetUser(email);
      await globalLog(me, 'client', `removed the client account of ${u.name} (${email})`);
      return res.status(200).json({ ok: true });
    }

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
        await secLog(email, 'approved', req, { by: me.email, byName: me.name });
        await globalLog(me, 'approve', `approved ${target.name} (${email})`);
        await sendEmail(email, 'Your Duda Site Auditor account is approved', emailShell('You\'re in!', `<p>${esc(me.name)} approved your account.</p><p><a href="${appUrl(req)}">Open Duda Site Auditor</a></p>`)).catch(() => {});
        break;
      case 'remove':
        if (email === me.email) return res.status(400).json({ error: "You can't remove yourself" });
        await redis(['DEL', P + 'user:' + email], ['SREM', P + 'users', email]);
        await globalLog(me, target.status === 'pending' ? 'reject' : 'remove', `${target.status === 'pending' ? 'rejected' : 'removed'} ${target.name} (${email})`);
        break;
      case 'role':
        // The real rule is not "don't demote yourself", it is "never leave the app with no admin".
        if (target.role === 'admin' && String(b.role || '') !== 'admin') {
          const admins = (await listUsers()).filter((u) => u.role === 'admin' && u.status === 'active' && u.email !== email);
          if (!admins.length) return res.status(400).json({ error: 'Make someone else an Admin first — the app must always have one.' });
        }
        {
          // Any role the installation actually has, not just the two it shipped with.
          const roles = await listRoles();
          const picked = roles.find((r) => r.id === String(b.role || '')) || roles.find((r) => r.id === 'member');
          target.role = picked.id; await putUser(target); await bumpAccess();
          await secLog(email, 'role-changed', req, { by: me.email, byName: me.name, role: picked.name });
          await globalLog(me, 'role', `made ${target.name} ${/^[aeiou]/i.test(picked.name) ? 'an' : 'a'} ${picked.name}`);
        }
        break;
      case 'disable': case 'enable': {
        // Switching an account off keeps its history (who did what) instead of deleting it
        if (email === me.email) return res.status(400).json({ error: "You can't switch off your own account" });
        if (target.status === 'pending') return res.status(400).json({ error: 'Approve or reject this account first' });
        target.status = b.op === 'disable' ? 'disabled' : 'active';
        if (b.op === 'disable') { target.disabledAt = now(); target.disabledBy = me.email; } else { delete target.disabledAt; delete target.disabledBy; }
        await putUser(target);
        await secLog(email, b.op === 'disable' ? 'switched-off' : 'switched-on', req, { by: me.email, byName: me.name });
        await globalLog(me, b.op, `${b.op === 'disable' ? 'switched off' : 'switched on'} the account of ${target.name} (${email})`);
        break;
      }
      case 'resetPassword': {
        const temp = tempPassword();
        // A temporary password: they choose their own the first time they sign in with it.
        Object.assign(target, hashPassword(temp), { mustChange: true, tempExpires: new Date(Date.now() + TEMP_DAYS * 86400000).toISOString() });
        await putUser(target); await bumpAccess();
        await secLog(email, 'password-reset-by-admin', req, { by: me.email, byName: me.name });
        await globalLog(me, 'reset', `reset the password for ${target.name}`);
        return res.status(200).json({ ok: true, tempPassword: temp, tempExpires: target.tempExpires });
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
