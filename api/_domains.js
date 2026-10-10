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
  // The security certificate is Duda's job (it issues and renews it by itself), so it is never reported as a problem here.
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
// 'ssl' only exists in results stored before certificates stopped counting as problems.
export const isProblem = (d) => !!d && !['ok', 'nodomain', 'ssl'].includes(d.status);
/** The kind of problem, for counting: the domain shows another site, or the site does not load at all. */
export const problemClass = (st) => (['redirect', 'hijacked', 'notduda'].includes(st) ? 'redirect' : ['dns', 'http', 'down', 'timeout', 'error'].includes(st) ? 'down' : '');
export const DOMEV = P + 'domev';       // list: domain incidents, newest first  ["D"|"U", site, at, class]
const MILESTONES = [60, 30, 14, 7, 3, 1];

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
  if (reg && reg.expires) { const left = Math.floor((reg.expires - Date.now()) / DAY); if (left <= 60) warn.push(left < 0 ? 'reg-expired' : 'reg-soon'); }
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
  const alerts = []; const events = [];
  sites.forEach((x) => {
    const n = out[x.id]; if (!n || n.status === 'nodomain') return;
    const p = prev[x.id] && prev[x.id].domain === n.domain ? prev[x.id] : null;
    n.al = Object.assign({}, p && p.al);
    const who = { id: x.id, name: x.name || n.domain, domain: n.domain };
    const isNew = !p && x.first && now - x.first < 14 * DAY;
    if (isProblem(n)) {
      n.downSince = (p && isProblem(p) && p.downSince) || now;
      if ((p && !isProblem(p)) || (isNew && !n.al.down)) {
        alerts.push(Object.assign({ kind: 'down', cls: problemClass(n.status), label: n.label, detail: n.detail }, who)); n.al.down = now;
        events.push(['D', x.id, now, problemClass(n.status)]);
      }
    } else if (n.al.down) {
      alerts.push(Object.assign({ kind: 'up', since: p && p.downSince }, who)); delete n.al.down;
      events.push(['U', x.id, now, '']);
    }
    // The domain name's own registration: the one date that ends the website if nobody acts.
    // Told at 60, 30, 14, 7, 3 and 1 days, then every three days while it stays expired.
    if (n.reg && n.reg.expires) {
      const left = daysLeft(n.reg.expires);
      const send = (extra) => { alerts.push(Object.assign({ kind: 'reg', days: left, until: n.reg.expires, registrar: n.reg.registrar, regName: n.reg.name }, extra, who)); n.al.reg = now; };
      if (left < 0) { if (n.al.regm !== 0 || !n.al.reg || now - n.al.reg > 3 * DAY) send({}); n.al.regm = 0; }   // the moment it expires, then every 3 days
      else {
        const hit = MILESTONES.filter((m) => left <= m).pop();            // the closest milestone passed
        if (hit !== undefined && (n.al.regm === undefined || hit < n.al.regm)) { send({}); n.al.regm = hit; }
        else if (left > 60) delete n.al.regm;                              // renewed: start over for next year
      }
    }
    if (!Object.keys(n.al).length) delete n.al;
  });
  const flat = [].concat(...Object.entries(out).map(([k, v]) => [k, JSON.stringify(v)]));
  if (flat.length) await redis(['HSET', DOMS, ...flat]);
  if (events.length) await redis(...events.map((e) => ['LPUSH', DOMEV, JSON.stringify(e)]), ['LTRIM', DOMEV, 0, 3999]);
  if (alerts.length) await sendDomainAlerts(alerts).catch(() => {});
  return out;
}

/** The sentence an admin reads, for one alert. */
function alertLine(a) {
  if (a.kind === 'down') return a.cls === 'redirect'
    ? `🚨 ${a.domain} no longer shows this website — ${a.label}. Visitors are being sent somewhere else.`
    : `🚨 ${a.domain} is DOWN — ${a.label}. Visitors cannot open the website.`;
  if (a.kind === 'up') return `✅ ${a.domain} is working again${a.since ? ` (was down since ${fmtDay(a.since)})` : ''}`;
  if (a.kind === 'reg') {
    const when = a.days < 0 ? `EXPIRED ${-a.days} day${a.days === -1 ? '' : 's'} ago (${fmtDay(a.until)})` : a.days === 0 ? 'expires TODAY' : `expires in ${a.days} day${a.days === 1 ? '' : 's'} (${fmtDay(a.until)})`;
    return `${a.days <= 7 ? '🚨' : '⚠️'} ${a.regName || a.domain} — domain registration ${when}${a.registrar ? `, ${a.registrar}` : ''}. If it lapses the website goes offline; the client renews it with their registrar.`;
  }
  return a.domain;
}
// Everything that needs somebody is "problem" (loud); a renewal still some weeks off is "expiring".
const KIND_OF = (a) => (a.kind === 'up' ? 'domain-ok' : a.kind === 'down' || (a.kind === 'reg' && a.days <= 7) ? 'domain-problem' : 'domain-expiring');

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
    msgs.push({ kind: bad.length ? 'domain-problem' : 'domain-ok', urgent: !!bad.length, by: '', byName: `${alerts.length} websites`, siteName: '', dudaSite: '',
      headline: `${bad.length ? '🚨 ' : ''}*Domain check* — ${bad.length} website${bad.length === 1 ? '' : 's'} need${bad.length === 1 ? 's' : ''} attention${bad.length < alerts.length ? `, ${alerts.length - bad.length} working again` : ''}`,
      count: bad.length || alerts.length, lines, text: lines.join('\n') });
  } else {
    alerts.forEach((a) => msgs.push({ kind: KIND_OF(a), urgent: a.kind === 'down' || (a.kind === 'reg' && a.days <= 7), by: '', byName: a.name, siteName: a.name, dudaSite: a.id, domain: a.domain,
      headline: `*${a.name}* — ${alertLine(a)}`, text: alertLine(a) }));
  }
  for (const m of msgs) await Promise.all(admins.map((u) => notifyUser(u.email, m).catch(() => {})));
}

/**
 * One morning message with everything still open: expired, expiring soon, redirected, down. Nothing
 * open means no message at all. The security certificate is not part of it (Duda handles that).
 */
export async function sendDigest() {
  const [all] = await redis(['HGETALL', DOMS]);
  const c = { expired: [], soon7: [], soon30: [], redirect: [], down: [] };
  for (let i = 0; all && i < all.length; i += 2) {
    const d = jparse(all[i + 1]); if (!d || d.status === 'nodomain') continue;
    const name = d.domain || all[i];
    if (isProblem(d)) c[problemClass(d.status) || 'down'].push(name);
    if (d.reg && d.reg.expires) { const left = daysLeft(d.reg.expires); if (left < 0) c.expired.push(name); else if (left <= 7) c.soon7.push(name); else if (left <= 30) c.soon30.push(name); }
  }
  const total = Object.values(c).reduce((n, a) => n + a.length, 0);
  if (!total) return 0;
  const part = (k, label) => (c[k].length ? `${c[k].length} ${label}` : '');
  const summary = [part('expired', 'expired'), part('soon7', 'expiring within 7 days'), part('soon30', 'expiring within 30 days'), part('redirect', 'showing another site'), part('down', 'down')].filter(Boolean).join(' · ');
  const lines = [];
  [['expired', 'Expired'], ['soon7', 'Expiring ≤ 7 days'], ['redirect', 'Showing another site'], ['down', 'Down'], ['soon30', 'Expiring ≤ 30 days']].forEach(([k, l]) => { if (c[k].length) lines.push(`${l}: ${c[k].slice(0, 6).join(', ')}${c[k].length > 6 ? ` …+${c[k].length - 6}` : ''}`); });
  const admins = (await listUsers()).filter((u) => u.role === 'admin' && u.status === 'active');
  const urgent = !!(c.expired.length || c.soon7.length || c.redirect.length || c.down.length);
  const m = { kind: 'domain-digest', urgent, by: '', byName: 'Daily domain report', siteName: '', dudaSite: '', count: total, lines,
    headline: `${urgent ? '🚨 ' : ''}*Daily domain report* — ${summary}`, text: lines.join('\n') };
  await Promise.all(admins.map((u) => notifyUser(u.email, m).catch(() => {})));
  return total;
}

/**
 * Duda's CERTIFICATE_CREATED webhook said FAILED. Certificates are Duda's job, so this is no longer
 * an alert on its own: a domain whose DNS is wrong is caught by the daily check as "not showing this
 * website", which is the thing somebody can act on.
 */
export async function certificateFailed() { return; }
