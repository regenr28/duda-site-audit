// POST /api/pulse { lastActive: ISO }  — heartbeat sent every ~90s while the app is open.
// Returns who is online (presence) + this user's notifications in one round trip.
import { redis, P, readBody, requireUser, jparse, now } from './_lib.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const me = await requireUser(req, res);
  if (!me) return;
  try {
    const b = readBody(req);
    let active = b.lastActive && !isNaN(Date.parse(b.lastActive)) ? new Date(Math.min(Date.parse(b.lastActive), Date.now())).toISOString() : now();
    const [, pres, list, seen] = await redis(
      ['HSET', P + 'presence', me.email, JSON.stringify({ seen: now(), active })],
      ['HGETALL', P + 'presence'],
      ['LRANGE', P + 'notif:' + me.email, 0, 49],
      ['GET', P + 'notifseen:' + me.email],
    );
    const presence = {};
    for (let i = 0; pres && i < pres.length; i += 2) presence[pres[i]] = jparse(pres[i + 1], {});
    const items = (list || []).map((x) => jparse(x)).filter(Boolean);
    return res.status(200).json({ presence, serverTime: now(), notifs: { items, unread: items.filter((n) => !seen || n.at > seen).length } });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
