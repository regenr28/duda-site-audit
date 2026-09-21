// Live "who is on this website" signals without touching the database.
// Uses Ably (free: 200 concurrent connections, 6M messages/month, no card) when ABLY_API_KEY is set.
// GET /api/realtime → an Ably TokenRequest for this signed-in member (their browser then talks to Ably directly).
// Without ABLY_API_KEY the app falls back to the regular heartbeat (slower, but no extra database traffic).
import crypto from 'node:crypto';
import { requireUser } from './_lib.js';

export function tokenRequest(apiKey, clientId, capability, ttlMs = 60 * 60 * 1000, now = Date.now(), nonce = crypto.randomBytes(16).toString('hex')) {
  const [keyName, secret] = String(apiKey).split(':');
  const cap = JSON.stringify(capability);
  const req = { keyName, ttl: ttlMs, capability: cap, clientId, timestamp: now, nonce };
  const signText = [keyName, ttlMs, cap, clientId, now, nonce].join('\n') + '\n';
  req.mac = crypto.createHmac('sha256', secret).update(signText).digest('base64');
  return req;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const me = await requireUser(req, res);
  if (!me) return;
  const key = process.env.ABLY_API_KEY;
  if (!key || !key.includes(':')) return res.status(200).json({ enabled: false });
  // Members may only join website presence channels, nothing else
  const prefix = (process.env.STORE_PREFIX || 'dsa').replace(/[^\w-]/g, '');
  return res.status(200).json(tokenRequest(key, me.email, { [`${prefix}-site:*`]: ['presence', 'subscribe'] }));
}
