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
import { redis, P, requireUser, readBody, unpackJSON, jparse, fetchWithTimeout, clientSites, viewingAsClient, globalLog } from './_lib.js';
import { readLeads, groupLeads, monthlySeries, whenSeries, getSummary, bumpSummary } from './_leads.js';

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
function clientSite(rec) {
  const t = rec.truth || {};
  return {
    id: rec.id,
    siteId: rec.siteId || rec.id,
    name: rec.businessName || rec.siteId || 'Your website',
    domain: (rec.host || t.domain || '').replace(/^https?:\/\//, ''),
    phone: (t.phones || [])[0] || '',
    email: (t.emails || [])[0] || '',
    address: ((t.addresses || [])[0] || {}).city || '',
  };
}

async function sitesFor(ids) {
  if (!ids.length) return [];
  const raws = await redis(...ids.map((id) => ['GET', P + 'site:' + id]));
  return raws.map((r) => unpackJSON(r)).filter(Boolean).map(clientSite);
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
        const [cmtRaw] = await redis(['LRANGE', P + 'cmt:' + id, 0, 199]);
        const open = (cmtRaw || []).map((x) => jparse(x)).filter((c) => c && !c.fromFalseAlarm).length;
        return res.status(200).json({ site: clientSite(rec), leads: sum, comments: open });
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
        // Only the conversation on their own website, and only what was said — never who on our
        // side marked what, never an audit item, never a false alarm report.
        const [rawC] = await redis(['LRANGE', P + 'cmt:' + id, 0, 199]);
        const items = (rawC || []).map((x) => jparse(x)).filter(Boolean)
          .filter((c) => !c.fromFalseAlarm && !c.internal && !c.target)
          .map((c) => ({ id: c.id, at: c.at, by: c.byName || 'Your team', text: String(c.text || '').slice(0, 4000), mine: c.by === me.email }));
        return res.status(200).json({ comments: items });
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
