// What a CLIENT sees. The only endpoint a client account is allowed to reach.
//
// This is deliberately not the team's endpoints with a flag. It assembles its own data from
// scratch, so nothing internal can leak by forgetting to hide it — a field that is never read
// cannot be sent. Audit items, false alarm reports, who marked what, team notes, other people's
// websites and anything about how the app is built are simply not gathered here.
//
// GET  /api/client?op=me                   → the websites this person may see
// GET  /api/client?op=site&id=             → one website's overview (status, health, enquiries)
// GET  /api/client?op=domain&id=           → their domain: does it work, renewal, DNS records, past outages
// GET  /api/client?op=analytics&id=&days=  → visitors (Duda, plus Google if connected), trimmed for clients
// GET  /api/client?op=health&id=           → Google Lighthouse scores of the live website
// GET  /api/client?op=leads&id=            → their form submissions (+ groups and charts)
// GET  /api/client?op=comments&id=         → the conversation on their website
// GET  /api/client?op=account              → their own account (name, email, phone, settings)
// GET  /api/client?op=seclog               → their own sign-ins and account changes
// POST /api/client { op:'access', id }     → a fresh Duda link, made at the moment of the click
// POST /api/client { op:'profile', … }     → change their own name, phone, emails, look
// POST /api/client { op:'healthRun', id }  → the weekly automatic check, if a week has passed
import dns from 'node:dns';
import { redis, P, requireUser, readBody, unpackJSON, jparse, fetchWithTimeout, clientSites, viewingAsClient, globalLog, listUsers, slackRoster, unescapeHtml,
  putUser, publicUser, readSecLog, emailEnabled, LOOK_THEMES } from './_lib.js';
import { DOMS, DOMEV, registrable } from './_domains.js';
import { siteAnalytics } from './analytics.js';
import { readHealth, runHealth } from './sitehealth.js';
import { sideTest, dudaTypes } from './comments.js';
import { siteRec } from './_tickets.js';
import { can } from './_lib.js';
import { readLeads, groupLeads, monthlySeries, whenSeries, getSummary, bumpSummary, contactsFrom, contactRulings, ruleContact } from './_leads.js';

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
/** This website's row on the cached Duda list of published websites, or null when not published. */
async function dudaRow(dudaId) {
  const [raw] = await redis(['GET', P + 'dudasites']);
  const list = unpackJSON(raw);
  const x = ((list && list.sites) || []).find((y) => String(y.id).toLowerCase() === String(dudaId).toLowerCase());
  return x ? { domain: x.domain || '', duda: x.defaultDomain || '', published: x.published || '', first: x.first || '' } : null;
}

// ---------- DNS: where the domain points, who runs it, who handles its email ----------
// Public facts anybody can look up; read once every six hours per domain.
const NS_NAMES = [[/cloudflare/, 'Cloudflare'], [/domaincontrol\.com/, 'GoDaddy'], [/registrar-servers\.com/, 'Namecheap'], [/squarespacedns|squarespace/, 'Squarespace'],
  [/googledomains|ns-cloud-|google\.com/, 'Google'], [/awsdns/, 'Amazon Route 53'], [/azure-dns/, 'Microsoft Azure'], [/wixdns/, 'Wix'], [/name-services\.com/, 'Enom'],
  [/hostgator/, 'HostGator'], [/bluehost/, 'Bluehost'], [/ui-dns|ionos/, 'IONOS'], [/worldnic|networksolutions/, 'Network Solutions'], [/dnsmadeeasy/, 'DNS Made Easy'],
  [/dreamhost/, 'DreamHost'], [/hover\.com/, 'Hover'], [/porkbun/, 'Porkbun'], [/siteground/, 'SiteGround'], [/dynect|dyn\.com/, 'Dyn'], [/nsone/, 'NS1']];
const MX_NAMES = [[/google\.com|googlemail/, 'Google Workspace (Gmail)'], [/outlook\.com|office365|protection\.outlook/, 'Microsoft 365 (Outlook)'], [/zoho/, 'Zoho Mail'],
  [/secureserver\.net/, 'GoDaddy email'], [/privateemail|registrar-servers/, 'Namecheap email'], [/mimecast/, 'Mimecast'], [/pphosted|proofpoint/, 'Proofpoint'],
  [/icloud/, 'iCloud Mail'], [/yahoodns/, 'Yahoo Mail'], [/titan\.email/, 'Titan Mail'], [/ionos|1and1/, 'IONOS email'], [/hostgator|websitewelcome/, 'HostGator email']];
const nameFor = (list, hosts) => { for (const h of hosts) for (const [re, n] of list) if (re.test(String(h).toLowerCase())) return n; return ''; };
async function lookupDns(domain) {
  const host = String(domain).toLowerCase().replace(/^www\./, '');
  const reg = registrable(host);
  const r = new dns.promises.Resolver({ timeout: 3000, tries: 1 });
  const safe = (p) => p.then((v) => v, () => []);
  const [a, aaaa, cname, wA, wC, ns, mx] = await Promise.all([safe(r.resolve4(host)), safe(r.resolve6(host)), safe(r.resolveCname(host)),
    safe(r.resolve4('www.' + host)), safe(r.resolveCname('www.' + host)), safe(r.resolveNs(reg)), safe(r.resolveMx(reg))]);
  const nsL = ns.map((x) => String(x).toLowerCase()).sort().slice(0, 6);
  const mxL = mx.sort((x, y) => x.priority - y.priority).slice(0, 5).map((m) => ({ host: String(m.exchange).toLowerCase(), pri: m.priority }));
  return {
    at: Date.now(), host, reg,
    records: [
      ...cname.slice(0, 1).map((v) => ({ type: 'CNAME', name: host, value: v })),
      ...a.slice(0, 4).map((v) => ({ type: 'A', name: host, value: v })),
      ...aaaa.slice(0, 2).map((v) => ({ type: 'AAAA', name: host, value: v })),
      ...wC.slice(0, 1).map((v) => ({ type: 'CNAME', name: 'www.' + host, value: v })),
      ...(wC.length ? [] : wA.slice(0, 4).map((v) => ({ type: 'A', name: 'www.' + host, value: v }))),
      ...nsL.map((v) => ({ type: 'NS', name: reg, value: v })),
      ...mxL.map((m) => ({ type: 'MX', name: reg, value: m.host, pri: m.pri })),
    ],
    dnsBy: nameFor(NS_NAMES, nsL), mailBy: mxL.length ? nameFor(MX_NAMES, mxL.map((m) => m.host)) || 'another provider' : '',
    resolves: !!(a.length || aaaa.length || cname.length),
  };
}
async function dnsFor(domain) {
  if (!domain) return null;
  const k = P + 'dnsc:' + String(domain).toLowerCase();
  const [raw] = await redis(['GET', k]);
  const hit = jparse(raw); if (hit) return hit;
  const d = await lookupDns(domain).catch(() => null);
  if (d) await redis(['SET', k, JSON.stringify(d), 'EX', 6 * 3600]).catch(() => {});
  return d;
}
/** The domain check, cut down to plain facts (no team wording, nobody's names). */
function domainFacts(d, domain) {
  if (!d || (domain && d.domain && d.domain !== domain)) return null;
  return {
    status: d.status, checkedAt: d.checkedAt || 0, ms: d.ms || 0, downSince: d.downSince || 0,
    reg: d.reg && !d.reg.err ? { expires: d.reg.expires || 0, registrar: d.reg.registrar || '', name: d.reg.name || '' } : null,
    ssl: d.ssl ? { days: d.ssl.days, issuer: d.ssl.issuer || '' } : null,
  };
}
/** Times the domain stopped working and came back, newest first, from the incident list. */
async function incidentsFor(dudaId) {
  const [rows] = await redis(['LRANGE', DOMEV, 0, 3999]);
  const out = []; const since = Date.now() - 365 * 86400000;
  (rows || []).forEach((r) => { const e = jparse(r); if (e && String(e[1]) === String(dudaId) && e[2] >= since) out.push({ kind: e[0] === 'D' ? 'down' : 'up', at: e[2], cls: e[3] || '' }); });
  return out.slice(0, 20);
}
const cleanRun = (r) => r && { at: r.at, url: r.url, mobile: r.mobile, desktop: r.desktop };

async function sitesFor(ids) {
  if (!ids.length) return [];
  const recs = await Promise.all(ids.map((id) => siteRec(id)));
  const live = await liveDomains().catch(() => ({}));
  return recs.filter(Boolean).map((r) => clientSite(r, live));
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
  // One of us looking at a client page needs "Profile: View as client" (admins always have it).
  if (me.role !== 'client' && viewingAsClient(req) && !(await can(me, 'client.viewas'))) return res.status(403).json({ error: 'Your role does not include View as client.' });
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
      // Their own account. One of us previewing sees an empty one: our own details are not theirs.
      if (op === 'account') {
        if (me.role !== 'client') return res.status(200).json({ preview: true, account: { name: '', email: '', company: '', phone: '', emailOff: false }, email: emailEnabled() });
        return res.status(200).json({ account: { name: me.name || '', email: me.email, company: me.company || '', phone: me.phone || '', emailOff: !!me.emailOff,
          passwordChangedAt: me.passwordChangedAt || '', look: publicUser(me).look }, email: emailEnabled() });
      }
      if (op === 'seclog') {
        if (me.role !== 'client') return res.status(200).json({ preview: true, entries: [] });
        return res.status(200).json({ entries: (await readSecLog(me.email)).slice(0, 40) });
      }

      const id = String(req.query.id || '');
      if (!guard(id)) return res.status(404).json({ error: 'Not found' });
      const rec = await siteRec(id);
      if (!rec) return res.status(404).json({ error: 'Not found' });
      const sid = rec.siteId || id;

      if (op === 'site') {
        // Counted fresh, so "last 30 days" is never a figure from weeks ago.
        const [sum, threads, row, [domRaw], H] = await Promise.all([bumpSummary(sid).catch(() => getSummary(sid)), readThreads(sid, me).catch(() => []), dudaRow(sid).catch(() => null),
          redis(['HGET', DOMS, sid]), readHealth(sid).catch(() => ({ runs: [] }))]);
        const site = clientSite(rec, await liveDomains().catch(() => ({})));
        const last = (H.runs || [])[0];
        return res.status(200).json({ site, leads: sum, comments: threads.filter((t) => t.status === 'open').length,
          live: row, domain: domainFacts(jparse(domRaw), (row && row.domain) || site.domain),
          health: last ? { at: last.at, mobile: (last.mobile || {}).scores || null, desktop: (last.desktop || {}).scores || null } : null, keyed: !!H.keyed });
      }

      if (op === 'domain') {
        const row = await dudaRow(sid).catch(() => null);
        const domain = (row && row.domain) || clientSite(rec, {}).domain;
        const [[domRaw], incidents, dnsInfo] = await Promise.all([redis(['HGET', DOMS, sid]), incidentsFor(sid).catch(() => []), dnsFor(domain)]);
        return res.status(200).json({ domain, duda: row ? row.duda : '', live: row, check: domainFacts(jparse(domRaw), domain), incidents, dns: dnsInfo });
      }

      if (op === 'analytics') {
        const days = [30, 90, 365].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
        const { data, cfg } = await siteAnalytics(sid, days, false);
        const d = data.duda ? Object.assign({}, data.duda) : null;
        if (d) { delete d.detail; delete d.diag; }
        // Google's own error wording can name our accounts; the client is told only that it is unavailable.
        const trim = (x) => (!x ? null : x.error ? { error: 'unavailable' } : x);
        return res.status(200).json({ at: data.at, days, range: data.range, duda: d, ga4: trim(data.ga4), gsc: trim(data.gsc), has: { ga4: !!cfg.ga4, gsc: !!cfg.gsc } });
      }

      if (op === 'health') {
        const [H, row] = await Promise.all([readHealth(sid), dudaRow(sid).catch(() => null)]);
        return res.status(200).json({ runs: (H.runs || []).slice(0, 8).map(cleanRun), running: !!H.running, keyed: !!H.keyed, published: !!row });
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
        const sid = rec.siteId || id;
        const [all, rulings] = await Promise.all([readLeads(sid, 24), contactRulings(sid)]);
        return res.status(200).json({ contacts: contactsFrom(all, rulings), from: all.length, canRule: true });
      }
      return res.status(400).json({ error: 'Unknown operation' });
    }

    const b = readBody(req);
    // Their own name, phone, emails and look. Nothing here can change what they may see.
    if (b.op === 'profile') {
      if (me.role !== 'client') return res.status(403).json({ error: 'Preview — nothing is saved while you are viewing as the client.', preview: true });
      if (b.name !== undefined) {
        const name = String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
        if (!name) return res.status(400).json({ error: 'Please enter your name.' });
        me.name = name;
      }
      if (b.phone !== undefined) {
        const phone = String(b.phone || '').trim().slice(0, 40);
        if (phone && !/^[\d+()\-.\s/x#ext]{5,40}$/i.test(phone)) return res.status(400).json({ error: 'That phone number has characters a phone number cannot have.' });
        me.phone = phone;
      }
      if (b.emailOff !== undefined) me.emailOff = !!b.emailOff;
      if (b.lookMode !== undefined) me.lookMode = ['light', 'dark'].includes(b.lookMode) ? b.lookMode : 'auto';
      if (b.lookTheme !== undefined && LOOK_THEMES.includes(b.lookTheme)) me.lookTheme = b.lookTheme;
      await putUser(me);
      return res.status(200).json({ account: { name: me.name, email: me.email, company: me.company || '', phone: me.phone || '', emailOff: !!me.emailOff }, user: publicUser(me) });
    }
    // The weekly automatic check of the live website, started by the client's page when it is due.
    if (b.op === 'healthRun') {
      const id = String(b.id || '');
      if (!guard(id)) return res.status(404).json({ error: 'Not found' });
      const rec = await siteRec(id);
      if (!rec) return res.status(404).json({ error: 'Not found' });
      const sid = rec.siteId || id;
      const H = await readHealth(sid);
      const last = (H.runs || [])[0];
      if (!H.keyed || H.running || (last && Date.now() - Date.parse(last.at) < 7 * 86400000)) return res.status(200).json({ runs: (H.runs || []).map(cleanRun), running: !!H.running, keyed: !!H.keyed, published: true });
      try {
        const r = await runHealth(sid, 'Weekly check', 'client:' + me.email);
        return res.status(200).json({ runs: (r.runs || []).map(cleanRun), running: !!r.running, keyed: true, published: true });
      } catch (e) { return res.status(200).json({ runs: (H.runs || []).map(cleanRun), keyed: true, published: e.status !== 400, error: 'The check could not run right now. It will try again later.' }); }
    }
    // The client can say a contact is or is not spam on their own website.
    if (b.op === 'contactVerdict') {
      const id = String(b.id || '');
      if (!guard(id)) return res.status(404).json({ error: 'Not found' });
      const rec = await siteRec(id);
      if (!rec) return res.status(404).json({ error: 'Not found' });
      await ruleContact(rec.siteId || id, b.key, b.verdict);
      return res.status(200).json({ ok: true });
    }
    if (b.op === 'access') {
      const id = String(b.id || '');
      if (!guard(id)) return res.status(404).json({ error: 'Not found' });
      const rec = await siteRec(id);
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
