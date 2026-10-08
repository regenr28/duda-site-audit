// Domain health for live websites: does the address still show the website, will its security
// certificate and its registration last, and is it fast enough — and telling the admins the moment a
// domain that worked stops working.
//
// Checked from three places, all through checkAndStore(): the Live DR Sites page (domains not checked
// for a week, or the Check domains button), a once-a-day sweep of every live domain (see dudasites.js,
// op=sweep), and Duda's own webhook when it fails to issue a certificate.
import tls from 'node:tls';
import { redis, P, jparse, fetchWithTimeout, listUsers, notifyUser } from './_lib.js';

export const DOMS = P + 'domstat';      // hash: site id -> last check result

// ---------- domain health ----------
const norm = (h) => String(h || '').toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
const DUDA_MARK = /cdn-website\.com|multiscreensite\.com|dmRoot|dmBody|dudaone|data-page-alias/i;
const BAD_CONTENT = /\b(casino|slots?|poker|betting|sportsbook|judi|togel|gambl\w*|viagra|cialis|escort|porn\w*|crypto ?casino)\b|domain (is )?for sale|buy this domain|this domain (name )?(is|may be) for sale|parked (free|domain)|hugedomains|sedo\.com|dan\.com|afternic/i;
function textOf(html) { return String(html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 4000); }
async function basicCheck(domain) {
  const out = { domain, checkedAt: Date.now() };
  const hops = [];
  let url = (process.env.DOMAIN_CHECK_PROTOCOL || 'https') + '://' + domain + '/';
  let r = null, body = '';
  for (let i = 0; i < 6; i++) {
    try {
      r = await fetchWithTimeout(url, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SiteAuditor/1.0; domain health check)', Accept: 'text/html' } }, 9000);
    } catch (e) {
      const m = String((e && e.cause && (e.cause.code || e.cause.message)) || e.message || e);
      if (i === 0 && url.startsWith('https://') && /CERT|SSL|TLS|certificate|self.signed|ERR_TLS|UNABLE_TO_VERIFY|EPROTO/i.test(m)) { out.sslError = true; url = 'http://' + domain + '/'; continue; }
      if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(m)) return Object.assign(out, { status: 'dns', label: "Domain doesn't resolve (DNS)", detail: 'The domain has no working DNS record. It may have expired or its DNS was changed.' });
      if (/abort|timeout|ETIMEDOUT/i.test(m)) return Object.assign(out, { status: 'timeout', label: 'Not responding', detail: 'The domain did not respond within 9 seconds.' });
      if (/ECONNREFUSED|ECONNRESET/i.test(m)) return Object.assign(out, { status: 'down', label: 'Connection refused', detail: m.slice(0, 120) });
      return Object.assign(out, { status: 'error', label: 'Could not open', detail: m.slice(0, 160) });
    }
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      const next = new URL(r.headers.get('location'), url).href; hops.push(next); url = next; continue;
    }
    body = r.status < 400 ? (await r.text().catch(() => '')).slice(0, 300000) : '';
    // Meta-refresh or tiny script redirects (common with hijacked domains)
    const meta = body.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["'][^"']*url=([^"'>\s]+)/i);
    const js = body.length < 8000 && body.match(/(?:window\.|document\.)?location(?:\.href)?\s*=\s*["'](https?:\/\/[^"']+)["']/i);
    const target = (meta && meta[1]) || (js && js[1]);
    if (target && i < 5) { try { const next = new URL(target, url).href; if (norm(new URL(next).host) !== norm(new URL(url).host)) { hops.push(next); url = next; continue; } } catch (e) { /* ignore */ } }
    break;
  }
  const finalUrl = url; let finalHost = ''; try { finalHost = new URL(finalUrl).host; } catch (e) { /* ignore */ }
  Object.assign(out, { code: r ? r.status : 0, finalUrl: finalUrl.slice(0, 300), hops: hops.length });
  const title = ((body.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '').trim().slice(0, 140);
  if (title) out.title = title;
  const spam = BAD_CONTENT.test(title + ' ' + textOf(body));
  if (norm(finalHost) !== norm(domain)) return Object.assign(out, { status: spam ? 'hijacked' : 'redirect', label: `Redirects to ${norm(finalHost) || 'another site'}${spam ? ' (spam / gambling site)' : ''}`, detail: `Opening ${domain} ends up on ${finalUrl}${title ? ` ("${title}")` : ''}. Fix the domain before auditing.` });
  if (r && r.status === 404) return Object.assign(out, { status: 'http', label: '404 Not found', detail: 'The home page returns 404.' });
  if (r && r.status >= 500) return Object.assign(out, { status: 'http', label: `Server error ${r.status}`, detail: 'The server behind the domain returns an error.' });
  if (r && r.status >= 400) return Object.assign(out, { status: 'http', label: `Error ${r.status}`, detail: `The home page returns HTTP ${r.status}.` });
  const text = textOf(body);
  if (BAD_CONTENT.test(title + ' ' + text) && !DUDA_MARK.test(body)) return Object.assign(out, { status: 'hijacked', label: 'Shows unrelated content', detail: `The domain loads a page that isn't this website${title ? ` ("${title}")` : ''} and looks like spam, gambling or a parked domain.` });
  if (!DUDA_MARK.test(body)) return Object.assign(out, { status: 'notduda', label: 'Not pointing to this website', detail: `The domain loads, but not the Duda website${title ? ` ("${title}")` : ''}. Its DNS may point to another host.` });
  if (out.sslError) return Object.assign(out, { status: 'ssl', label: 'SSL certificate problem', detail: 'The site only works over http://, the security certificate is missing or invalid.' });
  return Object.assign(out, { status: 'ok', label: 'Working', detail: hops.length ? `Loads after ${hops.length} redirect(s) on the same domain.` : 'Loads normally.' });
}


// ---------- deeper checks: certificate, registration, speed ----------
/**
 * The security certificate the domain presents, read straight off the TLS handshake. Duda renews its
 * certificates by itself about a month before they run out, so one with two weeks or less left means
 * renewal is failing — almost always because the domain's DNS no longer points at Duda.
 */
function certInfo(host) {
  return new Promise((resolve) => {
    let done = false; let sock = null;
    const fin = (v) => { if (done) return; done = true; try { sock && sock.destroy(); } catch (e) { /* closed */ } resolve(v); };
    try {
      sock = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: 6000 }, () => {
        const c = sock.getPeerCertificate();
        if (!c || !c.valid_to) return fin(null);
        const until = Date.parse(c.valid_to);
        fin({ until, days: Math.floor((until - Date.now()) / 86400000), issuer: String((c.issuer && (c.issuer.O || c.issuer.CN)) || '').slice(0, 60), valid: !!sock.authorized });
      });
      sock.on('error', () => fin(null));
      sock.on('timeout', () => fin(null));
      setTimeout(() => fin(null), 7000);
    } catch (e) { fin(null); }
  });
}

// Second-level suffixes where the registered name has three parts (shop.co.uk, not co.uk).
const SLD = new Set(['co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'ac.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'org.nz', 'com.br', 'co.za', 'com.mx',
  'co.in', 'co.jp', 'com.sg', 'com.ph', 'com.my', 'co.id', 'com.tr', 'com.ar', 'com.co', 'co.il', 'com.hk', 'com.tw', 'com.cn', 'co.kr', 'qc.ca']);
export function registrable(host) {
  const p = norm(host).split('.').filter(Boolean);
  if (p.length <= 2) return p.join('.');
  return SLD.has(p.slice(-2).join('.')) ? p.slice(-3).join('.') : p.slice(-2).join('.');
}
/**
 * When the domain name itself has to be renewed, from the public registration record (RDAP — the
 * modern WHOIS). Read once a week; some country domains publish no date, and that is fine.
 */
async function rdapInfo(domain) {
  const name = registrable(domain);
  try {
    const r = await fetchWithTimeout('https://rdap.org/domain/' + encodeURIComponent(name), { headers: { Accept: 'application/rdap+json, application/json' } }, 8000);
    if (!r.ok) return { at: Date.now(), name, err: r.status === 404 ? 'no record' : 'unavailable' };
    const j = await r.json();
    const exp = (j.events || []).find((e) => /expiration/i.test(String(e.eventAction || '')));
    const ent = (j.entities || []).find((e) => (e.roles || []).includes('registrar'));
    let registrar = '';
    try { registrar = ((ent.vcardArray || [])[1] || []).find((v) => v[0] === 'fn')[3]; } catch (e) { /* no name given */ }
    return { at: Date.now(), name, expires: exp ? Date.parse(exp.eventDate) || 0 : 0, registrar: String(registrar || '').slice(0, 80) };
  } catch (e) { return { at: Date.now(), name, err: 'unavailable' }; }
}

const WEEK = 7 * 86400000;
const DAY = 86400000;
export const isProblem = (d) => !!d && !['ok', 'nodomain'].includes(d.status);

/** Everything about one domain, in one go. `prev` is the last result, so the weekly parts are reused. */
export async function checkDomain(domain, prev) {
  const t0 = Date.now();
  const wantReg = !(prev && prev.reg && prev.reg.at > Date.now() - WEEK && prev.reg.name === registrable(domain));
  const [out, ssl, reg] = await Promise.all([
    basicCheck(domain).then((o) => Object.assign(o, { ms: Date.now() - t0 })),
    certInfo(domain),
    wantReg ? rdapInfo(domain) : Promise.resolve(prev.reg),
  ]);
  if (ssl) out.ssl = ssl;
  if (reg) out.reg = reg;
  // Things that still work today but need somebody before they stop working.
  const warn = [];
  if (ssl && out.status === 'ok' && ssl.days <= 14) warn.push(ssl.days < 0 ? 'ssl-expired' : 'ssl-soon');
  if (reg && reg.expires) { const left = Math.floor((reg.expires - Date.now()) / DAY); if (left <= 30) warn.push(left < 0 ? 'reg-expired' : 'reg-soon'); }
  if (out.status === 'ok' && out.ms > 6000) warn.push('slow');
  if (warn.length) out.warn = warn;
  return out;
}

// ---------- running checks, and telling the admins ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pool(items, n, fn) {
  const q = items.slice(); const run = async () => { while (q.length) await fn(q.shift()); };
  await Promise.all(Array.from({ length: Math.min(n, q.length) }, run));
}
const daysLeft = (ms) => Math.floor((ms - Date.now()) / DAY);
const fmtDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Check these websites' domains, store the results, and tell the admins about anything that changed
 * for the worse.
 *
 * sites: [{ id, name, domain, first }] — first = when the website was first published (ms), so a
 * brand-new launch with a broken domain is reported too, without the very first sweep reporting
 * every problem that was already known.
 *
 * Nobody is told about a one-off blip: a domain that worked last time and fails now is checked a
 * second time a few seconds later, and only reported if it fails again.
 */
export async function checkAndStore(sites, { budgetMs = 0, concurrency = 10 } = {}) {
  if (!sites.length) return {};
  const ids = sites.map((x) => x.id);
  const [prevRaw] = await redis(['HMGET', DOMS, ...ids]);
  const prev = {}; ids.forEach((id, i) => { prev[id] = jparse(prevRaw && prevRaw[i]); });
  const out = {}; const started = Date.now();
  await pool(sites, concurrency, async (x) => {
    if (budgetMs && Date.now() - started > budgetMs) return;          // out of time: the rest wait for next time
    if (!x.domain) { out[x.id] = { status: 'nodomain', label: 'No custom domain', detail: 'This site is only on its Duda address.', checkedAt: Date.now() }; return; }
    const p = prev[x.id] && prev[x.id].domain === x.domain ? prev[x.id] : null;
    let r = await checkDomain(x.domain, p);
    if (isProblem(r) && p && p.status === 'ok') { await sleep(4000); r = await checkDomain(x.domain, r); }
    out[x.id] = r;
  });
  const now = Date.now();
  const alerts = [];
  sites.forEach((x) => {
    const n = out[x.id]; if (!n || n.status === 'nodomain') return;
    const p = prev[x.id] && prev[x.id].domain === n.domain ? prev[x.id] : null;
    n.al = Object.assign({}, p && p.al);
    const who = { id: x.id, name: x.name || n.domain, domain: n.domain };
    const isNew = !p && x.first && now - x.first < 14 * DAY;
    if (isProblem(n)) {
      n.downSince = (p && isProblem(p) && p.downSince) || now;
      if ((p && p.status === 'ok') || (isNew && !n.al.down)) { alerts.push(Object.assign({ kind: 'down', label: n.label, detail: n.detail }, who)); n.al.down = now; }
    } else if (n.status === 'ok' && n.al.down) {
      alerts.push(Object.assign({ kind: 'up', since: p && p.downSince }, who)); delete n.al.down;
    }
    if (n.ssl && n.status === 'ok' && n.ssl.days <= 14 && (!n.al.ssl || now - n.al.ssl > WEEK)) {
      alerts.push(Object.assign({ kind: 'ssl', days: n.ssl.days, until: n.ssl.until }, who)); n.al.ssl = now;
    }
    if (n.reg && n.reg.expires) {
      const left = daysLeft(n.reg.expires);
      const gap = left <= 7 ? 3 * DAY : 14 * DAY;
      if (left <= 30 && (!n.al.reg || now - n.al.reg > gap)) { alerts.push(Object.assign({ kind: 'reg', days: left, until: n.reg.expires, registrar: n.reg.registrar, regName: n.reg.name }, who)); n.al.reg = now; }
    }
    if (!Object.keys(n.al).length) delete n.al;
  });
  const flat = [].concat(...Object.entries(out).map(([k, v]) => [k, JSON.stringify(v)]));
  if (flat.length) await redis(['HSET', DOMS, ...flat]);
  if (alerts.length) await sendDomainAlerts(alerts).catch(() => {});
  return out;
}

/** The sentence an admin reads, for one alert. */
function alertLine(a) {
  if (a.kind === 'down') return `${a.domain} — ${a.label}`;
  if (a.kind === 'up') return `${a.domain} — working again${a.since ? ` (was down since ${fmtDay(a.since)})` : ''}`;
  if (a.kind === 'ssl') return `${a.domain} — security certificate ${a.days < 0 ? 'has expired' : `expires in ${a.days} day${a.days === 1 ? '' : 's'}`} (Duda normally renews it on its own; the DNS may no longer point at Duda)`;
  if (a.kind === 'reg') return `${a.regName || a.domain} — domain registration ${a.days < 0 ? 'has expired' : `expires in ${a.days} day${a.days === 1 ? '' : 's'}`} (${fmtDay(a.until)}${a.registrar ? `, ${a.registrar}` : ''}). The client renews it with their registrar.`;
  if (a.kind === 'cert') return `${a.domain} — Duda could not issue the security certificate. Visitors will see a "not secure" warning until it is fixed; check the domain's DNS records.`;
  return a.domain;
}
const KIND_OF = { down: 'domain-problem', cert: 'domain-problem', ssl: 'domain-expiring', reg: 'domain-expiring', up: 'domain-ok' };

/**
 * Every admin is told. More than three at once (the first daily check after a bad night, say) is one
 * message listing them, not a wall of separate ones.
 */
export async function sendDomainAlerts(alerts) {
  const admins = (await listUsers()).filter((u) => u.role === 'admin' && u.status === 'active');
  if (!admins.length) return;
  const msgs = [];
  if (alerts.length > 3) {
    const bad = alerts.filter((a) => a.kind !== 'up');
    const lines = alerts.slice(0, 12).map((a) => `${a.name} · ${alertLine(a)}`);
    if (alerts.length > 12) lines.push(`…and ${alerts.length - 12} more`);
    msgs.push({ kind: bad.length ? 'domain-problem' : 'domain-ok', by: '', byName: `${alerts.length} websites`, siteName: '', dudaSite: '',
      headline: `*Domain check* — ${bad.length} website${bad.length === 1 ? '' : 's'} need${bad.length === 1 ? 's' : ''} attention${bad.length < alerts.length ? `, ${alerts.length - bad.length} working again` : ''}`,
      count: bad.length || alerts.length, lines, text: lines.join('\n') });
  } else {
    alerts.forEach((a) => msgs.push({ kind: KIND_OF[a.kind] || 'domain-problem', by: '', byName: a.name, siteName: a.name, dudaSite: a.id, domain: a.domain,
      headline: `*${a.name}* — ${alertLine(a)}`, text: alertLine(a) }));
  }
  for (const m of msgs) await Promise.all(admins.map((u) => notifyUser(u.email, m).catch(() => {})));
}

/** Duda's CERTIFICATE_CREATED webhook said FAILED. */
export async function certificateFailed({ siteId, domains }) {
  const [rawW] = await redis(['HGET', P + 'watch', siteId]);
  const w = jparse(rawW) || {};
  await sendDomainAlerts([{ kind: 'cert', id: siteId, name: w.name || (domains || [])[0] || siteId, domain: (domains || []).join(', ') || w.domain || siteId }]);
}
