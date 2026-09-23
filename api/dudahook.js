// Switching the Duda connection on, from inside the app.
//
// Duda lets us register the webhook ourselves — no support ticket, no plan upgrade. This manages
// that subscription with Duda's own webhook methods, using the same API credentials the app
// already uses for everything else.
//
// GET  /api/dudahook?op=status                → our subscriptions, the events this account offers, and whether deliveries are arriving
// POST /api/dudahook { op: 'connect' }        → subscribe for the whole account
// POST /api/dudahook { op: 'active', id, on } → pause or resume one subscription
// POST /api/dudahook { op: 'remove', id }     → unsubscribe
//
// Admins only. The address we register carries a secret only the app knows, so nothing else can
// post pretend events at us.
import crypto from 'node:crypto';
import { redis, P, requireUser, readBody, jparse, fetchWithTimeout, appUrl, OWNER_EMAIL } from './_lib.js';

const DUDA = process.env.DUDA_API_BASE || 'https://api.duda.co/api';
const TAG = 'duda-site-auditor';          // so we can tell our own subscription from anyone else's

// What the app knows how to handle. Anything this account doesn't offer is quietly left out.
const WANT = [
  'NEW_CONVERSATION', 'NEW_COMMENT', 'CONVERSATION_UPDATED', 'COMMENT_EDITED', 'COMMENT_DELETED',
  'PUBLISH', 'UNPUBLISH', 'CONTACT_FORM_SENT_V2',
  'DOMAIN_UPDATED', 'CERTIFICATE_CREATED', 'SITE_CREATED', 'SITE_RESTORED', 'SITE_RESET', 'SITE_TEMPLATE_SWITCHED',
];

async function duda(path, method = 'GET', body) {
  const user = process.env.DUDA_API_USERNAME, pass = process.env.DUDA_API_PASSWORD;
  if (!user || !pass) throw new Error('Duda API access is not set up yet. Please contact the app owner.');
  const r = await fetchWithTimeout(DUDA + path, {
    method,
    headers: { Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'), Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }, 20000);
  const text = await r.text();
  if (!r.ok) throw new Error(`Duda said ${r.status}: ${text.slice(0, 300)}`);
  try { return text ? JSON.parse(text) : null; } catch (e) { return null; }
}

const listOf = (j) => (Array.isArray(j) ? j : (j && (j.results || j.webhooks || j.data)) || []);

/**
 * The secret that guards the listening address. The app invents one the first time it is needed and
 * keeps it, so nobody has to think about it. An owner who would rather choose it can set one, and
 * that takes precedence.
 */
async function hookKey(make) {
  if (process.env.DUDA_HOOK_KEY) return process.env.DUDA_HOOK_KEY;
  const [k] = await redis(['GET', P + 'hookkey']);
  if (k) return k;
  if (!make) return '';
  const made = crypto.randomBytes(24).toString('base64url');
  await redis(['SET', P + 'hookkey', made]);
  return made;
}
/** The address Duda should post to: ours, plus that secret. */
async function ourEndpoint(req, make) {
  const key = await hookKey(make);
  return key ? `${appUrl(req)}/api/hook?k=${encodeURIComponent(key)}` : '';
}
const mask = (url) => String(url || '').replace(/k=[^&]+/, 'k=••••••••');

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const me = await requireUser(req, res);
  if (!me) return;
  if (me.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  const isOwner = me.email === OWNER_EMAIL;

  try {
    const endpoint = await ourEndpoint(req, false);

    if (req.method === 'GET') {
      let hooks = [], types = [], apiError = '';
      try {
        const [q, t] = await Promise.all([
          duda('/sites/multiscreen/webhooks/query', 'POST', { limit: 100, offset: 0 }),
          duda('/sites/multiscreen/webhooks/event-types').catch(() => null),
        ]);
        hooks = listOf(q);
        types = (listOf(t) || []).map((x) => (typeof x === 'string' ? x : x && (x.name || x.event_type || x.type))).filter(Boolean);
      } catch (e) { apiError = String(e.message || e); }

      const [log] = await redis(['LRANGE', P + 'hooklog', 0, 9]);
      const recent = (log || []).map((x) => jparse(x)).filter(Boolean);
      const ours = hooks.filter((h) => h && (h.external_id === TAG || String(h.endpoint || '').includes('/api/hook')));

      return res.status(200).json({
        ready: true,      // the app can always make itself a secret when it connects
        endpoint: isOwner ? endpoint : mask(endpoint),
        // The full address carries the secret, so only the app owner is shown it in one piece.
        secretShown: isOwner,
        checked: !!process.env.DUDA_HOOK_SECRET,
        connected: ours.some((h) => h.active !== false),
        hooks: ours.map((h) => ({ id: h.id, active: h.active !== false, endpoint: mask(h.endpoint), events: h.event_types || [], scope: (h.resource && h.resource.type) || 'ACCOUNT' })),
        others: hooks.length - ours.length,
        eventTypes: types,
        supported: types.length ? WANT.filter((e) => types.includes(e)) : WANT,
        unsupported: types.length ? WANT.filter((e) => !types.includes(e)) : [],
        deliveries: recent.length,
        lastDelivery: recent[0] ? recent[0].at : '',
        apiError,
      });
    }

    const b = readBody(req);

    if (b.op === 'connect') {
      const address = await ourEndpoint(req, true);   // makes the secret if this is the first time
      if (!address) return res.status(500).json({ error: 'Could not prepare the listening address.' });
      let types = [];
      try {
        const t = await duda('/sites/multiscreen/webhooks/event-types');
        types = (listOf(t) || []).map((x) => (typeof x === 'string' ? x : x && (x.name || x.event_type || x.type))).filter(Boolean);
      } catch (e) { /* if the list can't be read, ask for what we know and let Duda refuse the rest */ }
      const events = types.length ? WANT.filter((e) => types.includes(e)) : WANT;
      if (!events.length) return res.status(400).json({ error: 'This Duda account does not offer any of the events the app uses.' });
      const made = await duda('/sites/multiscreen/webhooks', 'POST', {
        endpoint: address, event_types: events, resource_type: 'ACCOUNT', external_id: TAG,
      });
      return res.status(200).json({ ok: true, id: made && made.id, events });
    }

    if (b.op === 'active') {
      if (!b.id) return res.status(400).json({ error: 'id required' });
      await duda(`/sites/multiscreen/webhooks/${encodeURIComponent(b.id)}`, 'PUT', { active: !!b.on });
      return res.status(200).json({ ok: true });
    }

    if (b.op === 'remove') {
      if (!b.id) return res.status(400).json({ error: 'id required' });
      await duda(`/sites/multiscreen/webhooks/${encodeURIComponent(b.id)}`, 'DELETE');
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown op' });
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) });
  }
}
