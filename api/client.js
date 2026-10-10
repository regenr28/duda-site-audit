// What a CLIENT sees. The only endpoint a client account is allowed to reach.
//
// This is deliberately not the team's endpoints with a flag. It assembles its own data from
// scratch, so nothing internal can leak by forgetting to hide it — a field that is never read
// cannot be sent. Audit items, false alarm reports, who marked what, team notes, other people's
// websites and anything about how the app is built are simply not gathered here.
//
// GET  /api/client?op=me                   → the websites this person may see
// GET  /api/client?op=site&id=             → one website's overview
// GET  /api/client?op=leads&id=            → their form submissions (+ groups and charts)
// GET  /api/client?op=comments&id=         → the conversation on their website
// POST /api/client { op:'access', id }     → a fresh Duda link, made at the moment of the click
import { redis, P, requireUser, readBody, unpackJSON, jparse, fetchWithTimeout, clientSites, viewingAsClient, globalLog, listUsers, slackRoster, unescapeHtml } from './_lib.js';
import { sideTest, dudaTypes } from './comments.js';
import { readLeads, groupLeads, monthlySeries, whenSeries, getSummary, bumpSummary, contactsFrom } from './_leads.js';

const DUDA = process.env.DUDA_API_BASE || 'https://api.duda.co/api';

async function duda(path) {
  const user = process.env.DUDA_API_USERNAME, pass = process.env.DUDA_API_PASSWORD;
  if (!user || !pass) throw new Error('Website access is not set up yet. Please ask your account manager.');
  const r = await fetchWithTimeout(DUDA + path, { headers: { Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'), Accept: 'application/json' } }, 15000);
  const t = await r.text();
  if (!r.ok) throw new Error(`Could not open your website right now (${r.status}).`);
  return JSON.parse(t);
}

/** One website, cut down to what belongs to the client. Nothing else from the record is read. */
function clientSite(rec, live) {
  const t = rec.truth || {};
  return {
    id: rec.id,
    siteId: rec.siteId || rec.id,
    name: rec.businessName || rec.siteId || 'Your website',
    // The website's own address. (rec.host is the editor's address, which is ours, not theirs.)
    domain: String(t.domain || (live && live[String(rec.siteId || '').toLowerCase()]) || '').replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
    phone: (t.phones || [])[0] || '',
    email: (t.emails || [])[0] || '',
    address: ((t.addresses || [])[0] || {}).city || '',
  };
}

/** Live addresses from the cached Duda list: site id → its domain (or Duda address). */
async function liveDomains() {
  const [raw] = await redis(['GET', P + 'dudasites']);
  const list = unpackJSON(raw); const out = {};
  ((list && list.sites) || []).forEach((x) => { const d = x.domain || x.defaultDomain; if (d) out[String(x.id).toLowerCase()] = d; });
  return out;
}
async function sitesFor(ids) {
  if (!ids.length) return [];
  const raws = await redis(...ids.map((id) => ['GET', P + 'site:' + id]));
  const live = await liveDomains().catch(() => ({}));
  return raws.map((r) => unpackJSON(r)).filter(Boolean).map((r) => clientSite(r, live));
}
/**
 * The client's conversations with us: the comments left in the Duda editor on their website, which
 * they take part in themselves. Never the team's own Comments tab (that is the team talking among
 * itself), and never a thread only the team ever wrote in (a note the team left itself).
 */
async function readThreads(dudaSiteId, me) {
  const [conv, over, pg] = await redis(['HGETALL', P + 'conv:' + dudaSiteId], ['HGETALL', P + 'cmtwho'], ['HGETALL', P + 'pages:' + dudaSiteId]);
  const map = (arr) => { const o = {}; for (let i = 0; arr && i < arr.length; i += 2) o[arr[i]] = arr[i + 1]; return o; };
  const threads = Object.values(map(conv)).map((v) => jparse(v)).filter(Boolean);
  const pages = map(pg);
  const authors = [...new Set(threads.flatMap((t) => (t.comments || []).map((c) => c.by)).filter(Boolean))];
  const isClient = sideTest(await listUsers(), map(over), await slackRoster().catch(() => null), await dudaTypes(authors, 0));
  return threads.map((t) => {
    const live = (t.comments || []).filter((c) => !c.deleted && String(c.text || '').trim());
    if (!live.length || live.every((c) => isClient(c.by) !== 'client')) return null;
    return {
      num: t.num || 0, status: t.status === 'resolved' ? 'resolved' : 'open', page: pages[t.page] || '', device: t.device || '',
      lastAt: live[live.length - 1].at || t.last || t.at,
      comments: live.map((c) => { const client = isClient(c.by) === 'client'; return { at: c.at, text: unescapeHtml(c.text).slice(0, 4000), team: !client, mine: !!(me && c.by && String(c.by).toLowerCase() === String(me.email || '').toLowerCase()) }; }),
    };
  }).filter(Boolean).sort((x, y) => String(y.lastAt).localeCompare(String(x.lastAt)));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const me = await requireUser(req, res, { client: true });
  if (!me) return;
  // Every request re-reads the grant. It is never taken from the page, a parameter or a session.
  const allowed = clientSites(me, req);
  const guard = (id) => allowed.includes(String(id));

  try {
    if (req.method === 'GET') {
      const op = req.query.op || 'me';
      if (op === 'me') {
        const sites = await sitesFor(allowed);
        // Previewing shows the CLIENT's heading, not the name of whoever on our side is looking —
        // otherwise the check tells you how the page looks to you rather than to them.
        const who = viewingAsClient(req) && me.role !== 'client'
          ? { name: '', email: '', company: (sites[0] && sites[0].name) || '' }
          : { name: me.name, email: me.email, company: me.company || '' };
        return res.status(200).json({ me: who, sites });
      }
      const id = String(req.query.id || '');
      if (!guard(id)) return res.status(404).json({ error: 'Not found' });
      const [raw] = await redis(['GET', P + 'site:' + id]);
      const rec = unpackJSON(raw);
      if (!rec) return res.status(404).json({ error: 'Not found' });

      if (op === 'site') {
        const sum = await getSummary(rec.siteId || id);
        const open = (await readThreads(rec.siteId || id, me).catch(() => [])).filter((t) => t.status === 'open').length;
        return res.status(200).json({ site: clientSite(rec, await liveDomains().catch(() => ({}))), leads: sum, comments: open });
      }

      if (op === 'leads') {
        const months = Math.min(Math.max(Number(req.query.months) || 12, 1), 24);
        const all = await readLeads(rec.siteId || id, months);
        let rows = all;
        if (req.query.page) rows = rows.filter((l) => l.pg === req.query.page);
        if (req.query.form) rows = rows.filter((l) => l.fm === req.query.form);
        if (req.query.source) rows = rows.filter((l) => l.src === req.query.source);
        await bumpSummary(rec.siteId || id).catch(() => {});
        return res.status(200).json({
          leads: rows.slice(0, 500), matched: rows.length, total: all.length,
          groups: groupLeads(all), series: monthlySeries(all, months), when: whenSeries(all),
        });
      }

      if (op === 'comments') {
        return res.status(200).json({ threads: await readThreads(rec.siteId || id, me) });
      }
      if (op === 'contacts') {
        // Their own enquirers, made into contacts from the submissions: the client already sees each
        // submission in full, so this shows them nothing new, only grouped by person.
        const all = await readLeads(rec.siteId || id, 24);
        return res.status(200).json({ contacts: contactsFrom(all), from: all.length });
      }
      return res.status(400).json({ error: 'Unknown operation' });
    }

    const b = readBody(req);
    if (b.op === 'access') {
      const id = String(b.id || '');
      if (!guard(id)) return res.status(404).json({ error: 'Not found' });
      const [raw] = await redis(['GET', P + 'site:' + id]);
      const rec = unpackJSON(raw);
      if (!rec) return res.status(404).json({ error: 'Not found' });
      const account = me.dudaAccount || me.email;
      // Duda's SSO token lasts two minutes, so this is made now, used now, and never stored.
      const j = await duda(`/accounts/sso/${encodeURIComponent(account)}/link?site_name=${encodeURIComponent(rec.siteId || id)}&target=EDITOR`);
      const url = j && (j.url || j.sso_link || j.link);
      if (!url) return res.status(502).json({ error: 'Could not open your website right now. Please try again.' });
      await globalLog({ email: me.email, name: me.name }, 'client-access', `opened their website ${rec.businessName || id}`, { siteId: id });
      return res.status(200).json({ url });
    }
    return res.status(400).json({ error: 'Unknown operation' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e).slice(0, 200) });
  }
}
