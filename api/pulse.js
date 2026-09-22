// POST /api/pulse { lastActive: ISO }  — heartbeat sent every ~90s while the app is open.
// Returns who is online (presence) + this user's notifications in one round trip.
import { redis, P, readBody, requireUser, jparse, now } from './_lib.js';

// Which website / audit item this person has open right now (shown in Team status)
function where(w) {
  if (!w || typeof w !== 'object' || !w.siteKey) return null;
  return { siteKey: String(w.siteKey).slice(0, 40), name: String(w.name || '').slice(0, 120), item: Number(w.item) || null, tab: String(w.tab || '').slice(0, 20) };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const me = await requireUser(req, res);
  if (!me) return;
  try {
    const b = readBody(req);
    let active = b.lastActive && !isNaN(Date.parse(b.lastActive)) ? new Date(Math.min(Date.parse(b.lastActive), Date.now())).toISOString() : now();
    // Notifications are only read when the browser asks (first load, bell opened, a realtime nudge, or every few beats)
    const wantNotifs = b.notifs !== false;
    const cmds = [['HSET', P + 'presence', me.email, JSON.stringify({ seen: now(), active, name: me.name, where: where(b.where) })], ['HGETALL', P + 'presence']];
    if (wantNotifs) cmds.push(['LRANGE', P + 'notif:' + me.email, 0, 49], ['GET', P + 'notifseen:' + me.email]);
    const [, pres, list, seen] = await redis(...cmds);
    const presence = {};
    for (let i = 0; pres && i < pres.length; i += 2) presence[pres[i]] = jparse(pres[i + 1], {});
    const items = (list || []).map((x) => jparse(x)).filter(Boolean);
    return res.status(200).json({ presence, serverTime: now(), notifs: wantNotifs ? { items, unread: items.filter((n) => !seen || n.at > seen).length } : null });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
