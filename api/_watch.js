// Live content watch: every published website, read like a visitor reads it, and checked against its
// Business Info for the details that cost us customers when they are wrong — another business's
// name, phone, email, address or social account (on a blog post, a footer, a map, anywhere).
//
// Why it is cheap enough to run on ~700 websites:
//   · A website's content only changes when it is published. So each website is read once, then
//     again only after Duda says it was published since (or a month later, in case Business Info
//     changed). The day-to-day work is "the handful published yesterday".
//   · It reads plain HTML (no browser), from the sitemap, a few pages at a time, inside a time budget.
//     A website too big for one run carries on where it stopped next time.
//   · Only the findings are stored (at most 25 per website, 5 pages each), never page content, so the
//     database cannot fill up with it.
//
// The rules are the audit's own: the reference is built with the audit engine's buildTruth(), names
// are matched with its matchesBusiness(), socials with its socialHandle(), and anything a team member
// approved for an audited website (its Business Info exceptions) is respected.
import crypto from 'node:crypto';
import { onSite } from './_meter.js';
import { redis, P, jparse, unpackJSON, packJSON, fetchWithTimeout, listUsers, notifyUser, appUrl, newId } from './_lib.js';
import '../public/engine.js';

const A = () => globalThis.DudaAudit;
const DUDA = () => process.env.DUDA_API_BASE || 'https://api.duda.co/api';
const PROTO = () => process.env.WATCH_PROTOCOL || 'https';
export const WKEY = (id) => P + 'cw:' + id;      // one website's latest result
export const WSUM = P + 'cwsum';                   // hash: duda id → { at, pub, n, c, pages, partial }
export const WOK = (id) => P + 'cwok:' + id;      // set: values a person said are fine for this website
const WPART = (id) => P + 'cwpart:' + id;       // a website stopped half way (the next run carries on)
const WPARTID = P + 'cwpartid';                  // …and which one, so it is finished first
const WLOCK = P + 'cwlock';
export const WDUE = P + 'cwdue';                 // how many websites are waiting (rides on the heartbeat)
export const WCFG = P + 'cwcfg';                 // { off: true } pauses everything
const WNEW = P + 'cwnew';                        // hash: duda id → new problems not yet in a daily report
const MAX_PAGES = 100;                               // per website
const BATCH = 4;                                     // pages read at once (gently: every website sits on the same Duda servers)
const BATCH_GAP_MS = 300;
const MAX_ISSUES = 25;
const RECHECK_DAYS = 30;
export const WWAIT = P + 'cwwait';                    // Duda asked us to slow down: nothing is read until this expires
const GAP_MS = 1500;                                  // at least this long per website, so Duda is never asked in bursts
const SUM_V = 3;
// What the checks themselves look for. A website whose result came from older rules, and that the newer rules
// would judge differently, is read again soon instead of waiting a month.
// 2: a "Service" in Google business data is not the business; home page without Local Business Schema.
// 3: their own data with a wrong name, several phones in one field, an email at their own domain.
const RULES_V = 3;                                      // summaries written by this version (older failures are retried)
// What the status panel shows, kept in small keys so watching it costs almost nothing.
const WNOW = P + 'cwnow';                             // the website being read right now { id, name, domain, i, n, at, by }
const WRECENT = P + 'cwrecent';                       // the last few websites finished (or not), newest first
const WSTAT = P + 'cwstat';                           // the counts and what is next, as of the end of the last run
const WLASTRUN = P + 'cwlastrun';                     // { at, by, done }
const WLASTOK = P + 'cwlastok';                       // a domain that opened fine a moment ago (to tell "blocked" from "this website is broken")
const WBACKOFF = P + 'cwbackoff';
const STAT_V = 1;                                     // the saved status's shape; a new shape is worked out afresh                     // how many waits in a row (each one longer)
// Why a website could not be read, in groups the status panel counts.
export const ERR_KIND = { nobi: 'No Business Info in Duda to compare with', open: 'The website did not open', gone: 'Duda no longer has this website', other: 'Something else' };
const DAY = 86400000;

async function duda(path) {
  const user = process.env.DUDA_API_USERNAME, pass = process.env.DUDA_API_PASSWORD;
  if (!user || !pass) throw new Error('Duda API access is not set up.');
  let r;
  try { r = await fetchWithTimeout(DUDA() + path, { headers: { Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'), Accept: 'application/json' } }, 15000); }
  catch (e) { const x = new Error('Duda did not answer'); x.status = 0; throw x; }
  if (!r.ok) {
    const x = new Error(`Duda answered ${r.status}`); x.status = r.status;
    x.retry = Number(r.headers.get('retry-after')) || 0;
    console.warn('[auto audit] Duda', r.status, path);
    throw x;
  }
  return r.json();
}

// ---------- reading a page ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', hellip: '…', reg: '®', trade: '™' };
const decode = (s) => String(s || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] !== undefined ? ENT[e.toLowerCase()] : m;
});
/** What a visitor reads, with the HTML taken away (scripts, styles and hidden templates dropped). */
export function textOf(html) {
  return decode(String(html)
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<template[\s\S]*?<\/template>|<!--[\s\S]*?-->/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|section|footer|header|td|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')).replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}
const attrs = (html, tag, attr) => [...String(html).matchAll(new RegExp(`<${tag}\\b[^>]*\\b${attr}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'gi'))].map((m) => decode(m[2] !== undefined ? m[2] : m[3]));
function jsonLd(html) {
  const out = [];
  for (const m of String(html).matchAll(/<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const walk = (o) => { if (!o || typeof o !== 'object') return; if (Array.isArray(o)) return o.forEach(walk); out.push(o); if (o['@graph']) walk(o['@graph']); }; walk(JSON.parse(m[1])); } catch (e) { /* not JSON */ }
  }
  return out;
}
// The JSON-LD that describes the business itself. A "Service" is one of the things they sell: its name is the
// service ("Paint Protection Film"), never the business. The business behind it, when given, is its provider.
const BIZ_TYPE = /(^|[/:])(LocalBusiness|Organization|Corporation|AutomotiveBusiness|Auto[A-Z][A-Za-z]*|MotorcycleDealer|MotorcycleRepair|GasStation|ProfessionalService|HomeAndConstructionBusiness|[A-Za-z]*Store|[A-Za-z]*Shop|[A-Za-z]*Contractor|[A-Za-z]*Business)$/;
const flat = (x) => String(x || '').toLowerCase().replace(/&amp;/g, '&').replace(/[^a-z0-9]+/g, ' ').trim();
const isBiz = (o) => !!o && typeof o === 'object' && [].concat(o['@type'] || []).some((t) => BIZ_TYPE.test(String(t)));
function bizSchema(html) {
  const out = [];
  jsonLd(html).forEach((o) => {
    if (isBiz(o)) out.push(o);
    [].concat(o.provider || []).forEach((p) => { if (isBiz(p) && !out.includes(p)) out.push(p); });
  });
  return out;
}
const SOCIAL = [['facebook', /(^|\.)(facebook\.com|fb\.com|fb\.me)$/i], ['instagram', /(^|\.)instagram\.com$/i], ['youtube', /(^|\.)(youtube\.com|youtu\.be)$/i], ['tiktok', /(^|\.)tiktok\.com$/i],
  ['twitter', /(^|\.)(twitter\.com|x\.com)$/i], ['linkedin', /(^|\.)linkedin\.com$/i], ['yelp', /(^|\.)yelp\.com$/i], ['pinterest', /(^|\.)pinterest\.com$/i]];
const netOf = (u) => { for (const [n, re] of SOCIAL) if (re.test(u.hostname)) return n; return ''; };
const STATES = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC';
const CITY_ZIP = new RegExp(`(\\d{1,6}\\s+[A-Z0-9][A-Za-z0-9.'#\\- ]{1,40}?,?\\s+)?\\b((?:[A-Z][a-z.']+[ -]){0,2}[A-Z][a-z.']+),\\s*(${STATES})\\.?,?\\s+(\\d{5})(?:-\\d{4})?\\b`, 'g');
const PHONE_TXT = /(?:\+?1[\s.-]?)?\(?\b([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-](\d{4})\b/g;
const EMAIL_TXT = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const IGNORE_EMAIL = /(@|\.)(example\.(com|org)|sentry\.io|wixpress\.com|duda\.co|multiscreensite\.com|dudamobile\.com|domain\.com|email\.com|yourdomain\.com)$|\.(png|jpe?g|gif|webp|svg|css|js)$/i;
const NOT_A_NAME = /powered|design|website|built|developed|created|marketing|privacy|terms|all rights|reserved|^\W*$/i;
const snip = (text, at, len) => String(text).slice(Math.max(0, at - 50), at + len + 60).replace(/\s+/g, ' ').trim().slice(0, 160);

/**
 * Everything on one page that does not match the website's Business Info.
 * Returns [{ type, value, sev, label, ctx }] — type is the audit's own: phone, email, name, social, address, schema.
 */
/**
 * The contact forms on a page, by name: Duda's form widget carries its title in a hidden
 * form_title field (and the visible .dmform-title heading), which is the name Duda's form history
 * uses. A form with no name still counts — it says the page has a form.
 */
export function formsOn(html) {
  const out = [];
  const names = [...String(html || '').matchAll(/<input\b[^>]*name=["'](?:form_title|dmformsubject)["'][^>]*>/gi)]
    .map((m) => (/value=["']([^"']*)["']/i.exec(m[0]) || [])[1] || '').map((s) => s.replace(/&amp;/g, '&').replace(/&#39;|&#x27;/g, "'").trim()).filter(Boolean);
  const titles = [...String(html || '').matchAll(/class=["'][^"']*\bdmform-title\b[^"']*["'][^>]*>([\s\S]{0,200}?)<\//gi)]
    .map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const forms = [...String(html || '').matchAll(/<form\b[\s\S]*?<\/form>/gi)].filter((m) => /<textarea|type=["']?email|name=["'][^"']*e-?mail/i.test(m[0])).length;
  [...new Set(names.concat(titles))].forEach((n) => out.push(n.slice(0, 80)));
  if (!out.length && forms) out.push('');
  return out;
}

export function checkPage(html, truth, path) {
  const A2 = A(); const out = [];
  const add = (type, value, sev, label, ctx, extra) => out.push(Object.assign({ type, value: String(value).slice(0, 160), sev, label, ctx: String(ctx || '').slice(0, 160), path }, extra || {}));
  // Probably theirs but not in Business Info: flagged all the same, for a person to confirm.
  const VERIFY = (what) => ({ verify: true, rec: `Check that this ${what} is theirs and in use (not a personal ${what === 'phone number' ? 'number' : 'address'}). If it is, add it to Business Info; if not, remove it from the website.` });
  const text = textOf(html);
  const phones = new Set(truth.phones || []);
  const emails = new Set((truth.emails || []).map((e) => e.toLowerCase()));
  const zips = new Set((truth.addresses || []).map((a) => String(a.zip || '').slice(0, 5)).filter(Boolean));
  const hrefs = attrs(html, 'a', 'href');
  // Phones: links first (a tap calls them), then numbers written in the text.
  const seenP = new Set();
  if (phones.size) {
    hrefs.filter((h) => /^tel:/i.test(h)).forEach((h) => {
      const d = A2.normPhone(h.replace(/^tel:/i, '')).slice(-10);
      if (d.length === 10 && !phones.has(d) && !seenP.has(d)) { seenP.add(d); add('phone', A2.fmtPhone(d), 'critical', 'Phone number that is not in Business Info (a tap calls it)', h); }
    });
    for (const m of text.matchAll(PHONE_TXT)) {
      const d = m[1] + m[2] + m[3];
      if (!phones.has(d) && !seenP.has(d)) { seenP.add(d); add('phone', A2.fmtPhone(d), 'critical', 'Phone number that is not in Business Info', snip(text, m.index, m[0].length)); }
    }
  }
  // Emails
  if (emails.size) {
    const seenE = new Set();
    // An address at the website's own domain is theirs, even when Business Info has another one: worth adding
    // to Business Info, never "another business".
    const own = String(truth.siteDomain || '').toLowerCase().replace(/^www\./, '');
    const isOwn = (e) => { const d = e.split('@')[1] || ''; return !!own && (d === own || d.endsWith('.' + own)); };
    const consider = (e, ctx, how) => {
      e = e.toLowerCase().replace(/^mailto:/, '').split('?')[0]; if (!/@/.test(e) || IGNORE_EMAIL.test(e) || emails.has(e) || seenE.has(e)) return; seenE.add(e);
      if (isOwn(e)) add('email', e, 'warning', 'Email on their own domain that is not in Business Info', ctx, VERIFY('email address'));
      else add('email', e, 'critical', how, ctx);
    };
    hrefs.filter((h) => /^mailto:/i.test(h)).forEach((h) => consider(h, h, 'Email address that is not in Business Info (a tap writes to it)'));
    for (const m of text.matchAll(EMAIL_TXT)) consider(m[0], snip(text, m.index, m[0].length), 'Email address that is not in Business Info');
  }
  // Social accounts: a link to a profile that is not one of theirs, or that looks like another business.
  const seenS = new Set();
  hrefs.forEach((h) => {
    let u; try { u = new URL(h); } catch (e) { return; }
    const net = netOf(u); if (!net || A2.isShareLink(u)) return;
    const handle = A2.socialHandle(net, u.href); if (!handle || seenS.has(net + handle)) return;
    seenS.add(net + handle);
    const mine = (truth.socials && truth.socials[net]) || [];
    const c = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (mine.some((x) => c(x) === c(handle))) return;
    if (truth.businessName && !A2.matchesBusiness(handle, truth)) add('social', u.href, mine.length ? 'critical' : 'warning', mine.length ? `${net[0].toUpperCase() + net.slice(1)} link to an account that is not theirs` : `${net[0].toUpperCase() + net.slice(1)} link that looks like another business`, handle);
  });
  // Addresses: "City, ST 12345" with a ZIP that is none of theirs — in the text, and on a map.
  if (zips.size) {
    const seenA = new Set();
    for (const m of text.matchAll(CITY_ZIP)) {
      const zip = m[4]; if (zips.has(zip) || seenA.has(zip)) continue;
      seenA.add(zip);
      const full = m[0].replace(/\s+/g, ' ').trim();
      add('address', full, m[1] ? 'critical' : 'warning', m[1] ? 'Street address that is not theirs' : 'A town and ZIP that are not theirs (check it is not just an area they serve)', snip(text, m.index, m[0].length));
    }
    attrs(html, 'iframe', 'src').filter((s) => /google\.[a-z.]+\/maps|maps\.google/i.test(s)).forEach((s) => {
      let q = ''; try { const u = new URL(s, 'https://x.invalid'); q = u.searchParams.get('q') || u.searchParams.get('query') || ''; } catch (e) { /* ignore */ }
      const zm = /\b(\d{5})\b/.exec(q);
      if (zm && !zips.has(zm[1]) && !seenA.has(zm[1])) { seenA.add(zm[1]); add('address', q, 'critical', 'Map showing an address that is not theirs', q); }
    });
  }
  // The business name: the copyright line, and the business data Google reads (JSON-LD).
  if (truth.businessName) {
    const cm = /(?:©|\(c\)|copyright)\s*(?:\d{4}\s*(?:[-–]\s*\d{2,4})?)?\s*(?:by\s+)?([^\n|•·]{3,70})/i.exec(text);
    if (cm) {
      const tail = cm[1].replace(/all rights reserved.*$/i, '').replace(/[.,\s]+$/, '').trim();
      if (/[a-z]{3}/i.test(tail) && !NOT_A_NAME.test(tail) && !A2.matchesBusiness(tail, truth)) add('name', tail, 'critical', 'Copyright line names a different business', cm[0].slice(0, 120));
    }
    // What the page calls itself: its title and headings. Business data named after the page is the
    // website's own data filled in wrongly, not another business.
    const heads = [...String(html).matchAll(/<(title|h1)[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => flat(textOf(m[2]))).filter((x) => x.length >= 6);
    const siteHost = String(truth.siteDomain || '').toLowerCase().replace(/^www\./, '');
    bizSchema(html).forEach((o) => {
      const t = [].concat(o['@type'] || []).join(' ');
      // One field can list several numbers ("+1-253-533-6776,+1-360-915-6218"): each is checked on its own.
      const tels = String(o.telephone || '').split(/[,;/|]|\bor\b/i).map((x) => A2.normPhone(x).slice(-10)).filter((d) => d.length === 10);
      const theirs = tels.filter((d) => phones.has(d));
      let host = ''; try { host = new URL(String(o.url || o['@id'] || ''), 'https://x.invalid').hostname.replace(/^www\./, ''); } catch (e) { /* no url */ }
      const named = flat(o.name || '');
      const ownData = theirs.length > 0 || (!!siteHost && host === siteHost) || (named.length >= 6 && heads.some((h) => h.includes(named) || named.includes(h)));
      if (o.name && !A2.matchesBusiness(String(o.name), truth)) {
        if (ownData) add('schema', String(o.name), 'warning', `This page's Google business data calls the business "${String(o.name).slice(0, 80)}" instead of "${truth.businessName}". It is their own data with the page's title as the name, not another business.`, t);
        else add('name', String(o.name), 'critical', 'Google business data (schema) names a different business', t);
      }
      if (phones.size) tels.filter((d) => !phones.has(d)).forEach((d) => {
        if (theirs.length) add('phone', A2.fmtPhone(d), 'warning', 'A second phone in Google business data, next to one of theirs, that is not in Business Info', String(o.telephone), VERIFY('phone number'));
        else add('phone', A2.fmtPhone(d), 'critical', 'Google business data (schema) has a phone that is not in Business Info', String(o.telephone));
      });
    });
  }
  // The home page is where Duda puts the Local Business Schema when it is turned on. Without it, Google
  // gets no business details from the website (and a page's only schema may be a "Service").
  if (path === '/' && !bizSchema(html).length) {
    add('schema', 'Local Business Schema not enabled', 'warning', 'Local Business Schema is not turned on: Google gets no business details (name, phone, address) from the website. Turn it on in Duda, in the site\u2019s Business Info.', '');
  }
  return out;
}

// ---------- one website ----------
/** The reference for one website: Duda's Business Info, minus anything struck out on its audit. */
export async function truthFor(dudaId, allow) {
  const [site, content] = await Promise.all([duda(`/sites/multiscreen/${encodeURIComponent(dudaId)}`), duda(`/sites/multiscreen/${encodeURIComponent(dudaId)}/content`).catch(() => null)]);
  const t = A().buildTruth({ site, content: content || {} });
  return A().truthWithout(t, allow);
}
async function pagesFor(domain) {
  const base = `${PROTO()}://${domain}`;
  const urls = [];
  const read = async (u, depth) => {
    if (urls.length >= MAX_PAGES || depth > 1) return;
    const r = await fetchWithTimeout(u, { headers: { 'User-Agent': UA, Accept: 'application/xml,text/xml' } }, 8000).catch(() => null);
    if (!r || !r.ok) return;
    const xml = (await r.text().catch(() => '')).slice(0, 2000000);
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decode(m[1]));
    if (/<sitemapindex/i.test(xml)) { for (const l of locs.slice(0, 4)) await read(l, depth + 1); return; }
    locs.forEach((l) => { try { const x = new URL(l); if (x.hostname.replace(/^www\./, '') === domain.replace(/^www\./, '').replace(/:\d+$/, '') || x.host === domain) urls.push(x.pathname + x.search); } catch (e) { /* skip */ } });
  };
  await read(base + '/sitemap.xml', 0);
  const list = [...new Set(['/'].concat(urls))].slice(0, MAX_PAGES);
  return list;
}
const bare = (h) => String(h || '').toLowerCase().replace(/^www\./, '').replace(/:\d+$/, '');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
/** Answers that mean "you are asking too fast" rather than "this website is broken". */
const SLOW_DOWN = new Set([403, 429, 503]);
/**
 * One page: { html } or { html: '', status, why } saying exactly what went wrong, including when
 * the domain sends the visitor to some other website.
 */
async function fetchPage(domain, path) {
  let r;
  try { r = await fetchWithTimeout(`${PROTO()}://${domain}${path}`, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' } }, 9000); }
  catch (e) { return { html: '', status: 0, why: e && e.name === 'AbortError' ? 'did not answer within 9 seconds' : 'could not be reached' }; }
  if (!r.ok) return { html: '', status: r.status, why: `answered ${r.status}` };
  if (!/html/i.test(r.headers.get('content-type') || 'text/html')) return { html: '', status: r.status, why: 'is not a web page' };
  try { if (r.url && bare(new URL(r.url).host) !== bare(domain)) return { html: '', status: r.status, why: `opens another website (${new URL(r.url).host})` }; } catch (e) { /* keep */ }
  return { html: (await r.text().catch(() => '')).slice(0, 800000), status: r.status };
}
/**
 * The identity of a finding, used to merge it across pages and to remember "not a problem".
 * An address is known by its ZIP, so saying a town is fine covers every page that mentions it.
 */
export function keyOf(f) {
  if (f.type === 'address') { const z = /(\d{5})(?!.*\d{5})/.exec(f.value); if (z) return 'address:' + z[1]; }
  return A().allowKey(f.type, f.value) || f.type + ':' + String(f.value).toLowerCase();
}
/** One finding per value, listing up to five pages it is on. */
function merge(found, okKeys) {
  const by = new Map();
  found.forEach((f) => {
    const key = keyOf(f);
    if (okKeys.has(key)) return;
    const g = by.get(key) || Object.assign({ k: key, pages: [], n: 0 }, f);
    g.n++; if (g.pages.length < 5 && !g.pages.includes(f.path)) g.pages.push(f.path);
    if (f.sev === 'critical') { g.sev = 'critical'; delete g.verify; delete g.rec; }
    by.set(key, g);
  });
  return [...by.values()].map(({ path, ...g }) => g).sort((a, b) => (a.sev === b.sev ? b.n - a.n : a.sev === 'critical' ? -1 : 1)).slice(0, MAX_ISSUES);
}

// ---------- the queue ----------
async function liveList() {
  const [raw] = await redis(['GET', P + 'dudasites']);
  const list = unpackJSON(raw);
  return ((list && list.sites) || []).filter((x) => x.domain).map((x) => ({ id: String(x.id), name: x.name || '', domain: x.domain, pub: x.published || '' }));
}
const parseSum = (raw) => { const o = {}; for (let i = 0; raw && i < raw.length; i += 2) o[raw[i]] = jparse(raw[i + 1]) || {}; return o; };
/**
 * Which websites need reading, most urgent first: published since their last check, never read,
 * then a month old. One that could not be read is tried again the next day, not a month later.
 */
export function dueOrder(sites, sums, at = Date.now()) {
  const rank = (x) => {
    const s = sums[x.id]; if (!s || !s.at) return 1;
    if (x.pub && Date.parse(x.pub) > (s.pubAt || 0)) return 0;
    // A failure recorded before Duda's "slow down" was understood is not a real answer: try again now.
    if (s.err && (s.v || 0) < SUM_V) return 1;
    // Corrected for one of the app's own mistakes, or flagged a business name under the old rules: read it
    // again with the new ones (that is also when a missing Local Business Schema gets noted).
    if (!s.err && (s.rv || 1) < RULES_V && (s.relook || (s.t && s.t.name))) return 1;
    if (s.err && at - s.at > DAY) return 1;
    if (at - s.at > RECHECK_DAYS * DAY) return 2;
    return 9;
  };
  return sites.map((x) => Object.assign({ r: rank(x) }, x)).filter((x) => x.r < 9).sort((a, b) => a.r - b.r || String(b.pub).localeCompare(String(a.pub)));
}
/** Which group a recorded failure belongs to (older ones only have the sentence). */
const errKind = (x) => x.ek || (/Business Info/i.test(x.err || '') && !/could not be read/i.test(x.err || '') ? 'nobi' : /no longer/i.test(x.err || '') ? 'gone' : /open|answered|reach|another website|web page/i.test(x.err || '') ? 'open' : 'other');
export async function watchStatus() {
  const [sites, [sumRaw, cfg, part, lock, waitRaw]] = await Promise.all([liveList(), redis(['HGETALL', WSUM], ['GET', WCFG], ['GET', WPARTID], ['GET', WLOCK], ['GET', WWAIT])]);
  const w = jparse(waitRaw) || {};
  const sums = parseSum(sumRaw);
  const due = dueOrder(sites, sums);
  const cfgv = jparse(cfg) || {};
  const on = !cfgv.off;
  const checked = sites.filter((x) => sums[x.id] && sums[x.id].at);
  const read = checked.filter((x) => !sums[x.id].err);
  const bad = checked.filter((x) => sums[x.id].err);
  const reasons = {}; bad.forEach((x) => { const k = errKind(sums[x.id]); reasons[k] = (reasons[k] || 0) + 1; });
  // Retried by themselves the next day: when the soonest of them comes round again.
  const retryAt = bad.length ? Math.min(...bad.map((x) => (sums[x.id].at || 0) + DAY)) : 0;
  const stat = { on, pausedBy: cfgv.by || '', pausedAt: cfgv.at || 0, total: sites.length, checked: read.length, pending: due.length,
    withIssues: read.filter((x) => sums[x.id].n).length, critical: read.filter((x) => sums[x.id].c).length,
    unreadable: bad.length, reasons, retryAt,
    next: due.slice(0, 3).map((x) => ({ id: x.id, name: x.name || '', domain: x.domain, why: x.r === 0 ? 'published again' : x.r === 1 ? (sums[x.id] && sums[x.id].err ? 'trying again' : 'not read yet') : 'monthly check' })),
    at: Date.now(), v: STAT_V };
  await redis(['SET', WDUE, on ? due.length : 0], ['SET', WSTAT, JSON.stringify(stat)]).catch(() => {});
  return Object.assign({}, stat, { running: !!lock, runningBy: lock || '',
    waitUntil: w.until > Date.now() ? w.until : 0, waitWhy: w.until > Date.now() ? w.why || '' : '', partial: part || '',
    sums: Object.fromEntries(checked.map((x) => [x.id, { n: sums[x.id].n || 0, c: sums[x.id].c || 0, at: sums[x.id].at, err: sums[x.id].err || '' }])) });
}
/**
 * The live status panel: what is happening right now, in one cheap read (no website lists).
 * Polled every few seconds by a browser showing DR Websites while the auto audit is busy.
 */
export async function watchLive() {
  const [now, stat, wait, recent, cfg, lock, last] = await redis(['GET', WNOW], ['GET', WSTAT], ['GET', WWAIT], ['LRANGE', WRECENT, 0, 7], ['GET', WCFG], ['GET', WLOCK], ['GET', WLASTRUN]);
  const w = jparse(wait) || {}; const c = jparse(cfg) || {};
  // No saved status yet (just deployed), or an old shape, or an hour old with nothing running:
  // work it out now. That also tells the open apps how many websites are waiting, which is what
  // starts the reading.
  let st = jparse(stat);
  if (!st || st.v !== STAT_V || (!lock && !now && Date.now() - (st.at || 0) > 3600000)) { const full = await watchStatus(); delete full.sums; st = full; }
  return { now: jparse(now), stat: st, wait: w.until > Date.now() ? w : null, recent: (recent || []).map((x) => jparse(x)).filter(Boolean),
    paused: c.off ? { by: c.by || '', at: c.at || 0 } : null, running: !!lock, runningBy: lock || '', lastRun: jparse(last), serverNow: Date.now() };
}
/** Forget every "could not be read", so all of them are tried again on the next run (admins). */
export async function retryFailed() {
  const [raw] = await redis(['HGETALL', WSUM]);
  const ids = []; for (let i = 0; raw && i < raw.length; i += 2) { const v = jparse(raw[i + 1]); if (v && v.err) ids.push(raw[i]); }
  if (ids.length) await redis(['HDEL', WSUM, ...ids], ['DEL', WWAIT], ['DEL', WBACKOFF]);
  await watchStatus();
  return ids.length;
}

/** dudaId → its audit record (for the exceptions people approved there). */
export async function auditMap() {
  const [raw] = await redis(['HGETALL', P + 'index']);
  const out = {}; for (let i = 0; raw && i < raw.length; i += 2) { const v = jparse(raw[i + 1]); if (v && v.siteId) out[String(v.siteId).toLowerCase()] = raw[i]; }
  return out;
}

/** The status panel's "reading now" line. A short expiry, so a run that died does not look alive. */
async function nowReading(s, i, n, by) {
  await redis(['SET', WNOW, JSON.stringify({ id: s.id, name: s.name || '', domain: s.domain, i, n, at: Date.now(), by: by || s._by || '' }), 'EX', 90]).catch(() => {});
}
/** Read one website (or carry on reading it). Returns { done:false } when the time ran out first. */
async function readSite(s, recId, timeLeft) {
  const [recRaw, okRaw, prevRaw, partRaw] = await redis(recId ? ['GET', P + 'site:' + recId] : ['GET', P + 'none'], ['SMEMBERS', WOK(s.id)], ['GET', WKEY(s.id)], ['GET', WPART(s.id)]);
  const rec = unpackJSON(recRaw) || {};
  const allow = rec.allow || [];
  // Exceptions approved on the website's audit, plus "not a problem" said here.
  const okKeys = new Set([...(okRaw || []), ...allow.filter((a) => a.mode !== 'deny').map((a) => a.key)]);
  const pubAt = Date.parse(s.pub) || 0;
  const skip = async (err, ek) => {
    console.warn('[auto audit] could not read', s.id, s.domain, '-', err);
    await redis(['HSET', WSUM, s.id, JSON.stringify({ v: SUM_V, at: Date.now(), pubAt, n: 0, c: 0, err, ek: ek || 'other' })], ['DEL', WPART(s.id)]);
    return { done: true, err, ek: ek || 'other' };
  };
  let truth;
  try { truth = await truthFor(s.id, allow); } catch (e) {
    if (e.status === 404) return skip('Duda no longer has this website', 'gone');
    if (e.status === 401 || e.status === 403) return { done: false, stop: 'Duda refused the app\'s API login (' + e.status + '). Check the Duda API access.' };
    // Too many requests, slow or down: that says nothing about the website. Nothing is recorded,
    // it stays first in the queue, and the whole check pauses until Duda is ready again.
    return { done: false, wait: Math.min(Math.max(e.retry || (e.status === 429 ? 120 : 60), 30), 900), why: e.message };
  }
  if (!truth.businessName && !(truth.phones || []).length && !(truth.emails || []).length) return skip('No Business Info in Duda to compare with', 'nobi');
  truth.siteDomain = s.domain;                       // their own domain: an email there is theirs
  let part = jparse(partRaw);
  if (part && part.pub !== s.pub) part = null;        // published again since: start over
  let i = part ? part.i : 0; let read = part ? part.read || 0 : 0; const found = part ? part.found : [];
  const forms = (part && part.forms) || {};
  const noteForms = (html, path) => { const f = formsOn(html); if (f.length && Object.keys(forms).length < 40) forms[path] = f; };
  let pages = part ? part.pages : null;
  if (!part) {
    // The home page first, on its own: if it does not open, nothing else will, and how it fails says
    // whether this website is broken or whether the servers want us to slow down.
    const home = await fetchPage(s.domain, '/');
    if (!home.html) {
      if (SLOW_DOWN.has(home.status) || home.status === 0) {
        const [okDomain] = await redis(['GET', WLASTOK]);
        const control = okDomain && okDomain !== s.domain ? await fetchPage(okDomain, '/') : { html: '' };
        // A website that opened a minute ago does not open either: it is us, not them. Wait.
        if (!control.html && okDomain) return { done: false, wait: true, why: `Websites stopped answering us (${home.why})` };
      }
      return skip(`The home page ${home.why}`, 'open');
    }
    await redis(['SET', WLASTOK, s.domain, 'EX', 6 * 3600]);
    read = 1; found.push(...checkPage(home.html, truth, '/')); noteForms(home.html, '/');
    pages = (await pagesFor(s.domain)).filter((p) => p !== '/');
    pages.unshift('/'); i = 1;
  }
  let lastNote = 0;
  while (i < pages.length && timeLeft() > 4000) {
    if (i - lastNote >= 20) { lastNote = i; await nowReading(s, i, pages.length); }
    const batch = pages.slice(i, i + BATCH);
    const got = await Promise.all(batch.map((p) => fetchPage(s.domain, p)));
    got.forEach((g, k) => { if (g.html) { read++; found.push(...checkPage(g.html, truth, batch[k])); noteForms(g.html, batch[k]); } });
    i += batch.length;
    if (found.length > 400) found.splice(400);
    // Most of a batch refused: the servers want a break. Keep what was read and carry on later.
    if (got.filter((g) => !g.html && (SLOW_DOWN.has(g.status) || g.status === 0)).length > batch.length / 2) {
      await redis(['SET', WPART(s.id), JSON.stringify({ pub: s.pub, pages, i, read, found, forms }), 'EX', 3 * DAY], ['SET', WPARTID, s.id, 'EX', 3 * DAY]);
      return { done: false, wait: true, why: `Websites stopped answering us (${(got.find((g) => !g.html) || {}).why || 'refused'})` };
    }
    if (i < pages.length) await new Promise((res) => setTimeout(res, BATCH_GAP_MS));
  }
  if (i < pages.length) {
    await redis(['SET', WPART(s.id), JSON.stringify({ pub: s.pub, pages, i, read, found, forms }), 'EX', 3 * DAY], ['SET', WPARTID, s.id, 'EX', 3 * DAY]);
    return { done: false };
  }
  const issues = merge(found, okKeys);
  const prev = jparse(prevRaw);
  const before = new Set(((prev && prev.issues) || []).map((x) => x.k));
  const fresh = issues.filter((x) => !before.has(x.k));
  const result = { at: Date.now(), pub: s.pub, domain: s.domain, name: s.name || truth.businessName, pages: read, issues, forms,
    ref: { name: truth.businessName, phones: truth.phones, emails: truth.emails, zips: (truth.addresses || []).map((a) => a.zip).filter(Boolean) } };
  // t: the serious ones by kind (phone, email, address, name, social): what the DR Websites column lists.
  const sum = { v: SUM_V, rv: RULES_V, at: result.at, pubAt, n: issues.length, c: issues.filter((x) => x.sev === 'critical').length, t: critTypes(issues), pages: read };
  const cmds = [['SET', WKEY(s.id), JSON.stringify(result)], ['HSET', WSUM, s.id, JSON.stringify(sum)], ['DEL', WPART(s.id)], ['DEL', WBACKOFF]];
  if (fresh.length) cmds.push(['HSET', WNEW, s.id, JSON.stringify({ name: result.name, domain: s.domain, n: fresh.length, c: fresh.filter((x) => x.sev === 'critical').length, t: critTypes(fresh), recId: recId || '', first: !prev })]);
  await redis(...cmds);
  // A website that had been read before and has just been published WITH a wrong detail is told
  // about now; everything else waits for the once-a-day report, so the first pass through 700
  // websites does not bury the admins.
  // A website on Audits gets what was found as audit items (and loses the ones fixed since).
  const [recheckRaw] = await redis(['HGET', WRECHECK, s.id]);
  const recheck = jparse(recheckRaw);
  if (recheck) {
    // Read again because the rules changed: what is no longer found was the app's mistake, so it is not
    // reported as fixed, and the waiting daily report only keeps what is still serious.
    const nw = issues.filter((x) => x.sev === 'critical');
    const cmds = [['HDEL', WRECHECK, s.id]];
    const [had] = await redis(['HGET', WNEW, s.id]);
    if (had) cmds.push(nw.length ? ['HSET', WNEW, s.id, JSON.stringify(Object.assign(jparse(had) || {}, { n: issues.length, c: nw.length, t: critTypes(issues) }))] : ['HDEL', WNEW, s.id]);
    await redis(...cmds);
  }
  if (recId) await syncAudit(recId, result, recheck ? { wrong: new Set(recheck.keys || []), why: recheck.why } : {}).catch(() => {});
  if (prev && !recheck && fresh.some((x) => x.sev === 'critical')) await alertNow(s, result.name, fresh, recId).catch(() => {});
  return { done: true, n: issues.length, c: sum.c, t: sum.t, pubAt, fresh: fresh.length, pages: read };
}

/**
 * Read as many websites as fit in the time budget. One run at a time (a lock), and a website too
 * big to finish carries on next run. `only` reads just that website now (Check now), beside any run.
 */
export async function runWatch({ budgetMs = 50000, only = '', by = 'auto' } = {}) {
  const started = Date.now();
  const timeLeft = () => budgetMs - (Date.now() - started);
  if (!process.env.DUDA_API_USERNAME || !process.env.DUDA_API_PASSWORD) return { error: 'Duda API access is not set up.', done: [] };
  const [cfgRaw, waitRaw] = await redis(['GET', WCFG], ['GET', WWAIT]);
  if (!only && (jparse(cfgRaw) || {}).off) return { off: true, done: [] };
  const waitTill = (jparse(waitRaw) || {}).until || 0;
  if (waitTill > Date.now()) return only ? { error: `The auto audit is taking a break (${(jparse(waitRaw) || {}).why || 'asked to slow down'}) until ${new Date(waitTill).toISOString().slice(11, 16)} UTC. Try again then.`, done: [] } : { wait: Math.ceil((waitTill - Date.now()) / 1000), problem: (jparse(waitRaw) || {}).why || '', done: [] };
  if (!only) await applyFixes(Math.min(20000, budgetMs / 3)).catch((e) => console.warn('[auto audit] fixes', e.message));
  const lockKey = only ? WLOCK + ':' + only : WLOCK;
  const [got] = await redis(['SET', lockKey, by, 'NX', 'EX', Math.ceil(budgetMs / 1000) + 40]);
  if (got !== 'OK') return { busy: true, done: [] };
  const done = []; let stopped = false; let wait = 0; let problem = '';
  try {
    const [sites, [sumRaw, partId], amap] = await Promise.all([liveList(), redis(['HGETALL', WSUM], ['GET', WPARTID]), auditMap()]);
    let queue = only ? sites.filter((x) => x.id === only) : dueOrder(sites, parseSum(sumRaw));
    if (!only && partId) { const p = queue.find((x) => x.id === partId); if (p) queue = [p].concat(queue.filter((x) => x !== p)); }
    for (const s of queue) {
      if (timeLeft() < 6000) break;
      const t0 = Date.now();
      s._by = by; await nowReading(s, 0, 0, by);
      onSite(s.id);
      const r = await readSite(s, amap[s.id.toLowerCase()], timeLeft).finally(() => onSite(''));
      if (r.wait || r.stop) {
        // Each wait in a row is longer: 5, 10, 20, 40, then 60 minutes. Duda's own "retry after" wins.
        const [n] = await redis(['INCR', WBACKOFF], ['EXPIRE', WBACKOFF, 6 * 3600]).then((x) => [Number(x[0]) || 1]);
        wait = typeof r.wait === 'number' ? r.wait : r.stop ? 900 : Math.min(300 * 2 ** Math.min(n - 1, 4), 3600);
        problem = r.stop || r.why || '';
        console.warn('[auto audit] waiting', wait, 's -', problem);
        await redis(['SET', WWAIT, JSON.stringify({ until: Date.now() + wait * 1000, why: problem, site: s.name || s.domain }), 'EX', wait],
          ['LPUSH', WRECENT, JSON.stringify({ at: Date.now(), id: s.id, name: s.name || '', domain: s.domain, wait: true, why: problem })], ['LTRIM', WRECENT, 0, 9]);
        break;
      }
      if (!r.done) { stopped = true; break; }
      done.push(Object.assign({ id: s.id }, r));
      await redis(['LPUSH', WRECENT, JSON.stringify({ at: Date.now(), id: s.id, name: s.name || '', domain: s.domain, n: r.n || 0, c: r.c || 0, err: r.err || '', pages: r.pages || 0 })], ['LTRIM', WRECENT, 0, 9]);
      const rest = GAP_MS - (Date.now() - t0);
      if (rest > 0 && timeLeft() > rest + 6000) await new Promise((res) => setTimeout(res, rest));
    }
    if (!stopped && partId && done.some((d) => d.id === partId)) await redis(['DEL', WPARTID]);
  } finally {
    await redis(['DEL', lockKey], ['DEL', WNOW], ['SET', WLASTRUN, JSON.stringify({ at: Date.now(), by, done: done.length, only: only || '' })]).catch(() => {});
  }
  const st = await watchStatus().catch(() => ({}));
  return Object.assign({ done, partial: stopped, pending: st.pending, checked: st.checked, total: st.total, unreadable: st.unreadable }, wait ? { wait, problem } : {});
}

/**
 * Corrections for the auto audit's own mistakes, applied once to what is already stored, so nobody has
 * to rescan or recheck anything by hand. Each one takes the wrong findings off every website's result
 * and the waiting daily report, closes the audit items they made as False alarm (saying it was the
 * app's mistake), and lines the website up to be read again with the corrected rules.
 */
const FIXES = [
  { id: 'svc-schema-1', why: 'a "Service" in Google business data names the service, not the business',
    wrong: (x) => x.type === 'name' && /^Google business data \(schema\) names/.test(x.label || '') && !String(x.ctx || '').split(/\s+/).some((t) => BIZ_TYPE.test(t)) },
];
const WFIX = (id) => P + 'cwfix:' + id;
// Findings that a re-read under the newer rules may judge differently. These websites are read again
// soon; whatever of these is gone after that read closes as the app's mistake rather than "fixed".
const RECHECK = { id: 'own-data-3', why: 'their own Google business data or email, read as another business\'s',
  pick: (x, r) => (x.sev === 'critical' && /^Google business data \(schema\)/.test(x.label || ''))
    || (x.type === 'email' && x.sev === 'critical' && !!r.domain && String(x.value).toLowerCase().split('@')[1] === String(r.domain).toLowerCase().replace(/^www\./, '')) };
const WRECHECK = P + 'cwrecheck';                    // hash: duda id → { keys, why } waiting for the re-read
export async function applyFixes(budgetMs = 20000) {
  const t0 = Date.now(); const report = [];
  for (const fix of FIXES) {
    const [state] = await redis(['GET', WFIX(fix.id)]);
    if (state === 'done') continue;
    const [got] = await redis(['SET', WFIX(fix.id) + ':run', '1', 'NX', 'EX', Math.ceil(budgetMs / 1000) + 30]);
    if (got !== 'OK') return { busy: true, report };
    try {
      const [sumRaw, newRaw] = await redis(['HGETALL', WSUM], ['HGETALL', WNEW]);
      const sums = parseSum(sumRaw); const news = parseSum(newRaw);
      const ids = Object.keys(sums).filter((id) => sums[id].t && sums[id].t.name && !sums[id]['fix_' + fix.id]);
      const amap = ids.length ? await auditMap() : {};
      let left = 0; let sites = 0; let items = 0;
      for (const id of ids) {
        if (Date.now() - t0 > budgetMs) { left++; continue; }
        const [raw] = await redis(['GET', WKEY(id)]);
        const result = jparse(raw); const sum = sums[id];
        sum['fix_' + fix.id] = 1;
        const bad = result ? (result.issues || []).filter(fix.wrong) : [];
        if (!bad.length) { await redis(['HSET', WSUM, id, JSON.stringify(sum)]); continue; }
        result.issues = result.issues.filter((x) => !fix.wrong(x));
        Object.assign(sum, { n: result.issues.length, c: result.issues.filter((x) => x.sev === 'critical').length, t: critTypes(result.issues), rv: 1, relook: 1 });
        const cmds = [['SET', WKEY(id), JSON.stringify(result)], ['HSET', WSUM, id, JSON.stringify(sum)]];
        // The waiting daily report must not announce them either.
        const nw = news[id];
        if (nw) {
          // Only what the report actually holds: at most its own business-name count (those are all critical).
          const drop = Math.min((nw.t && nw.t.name) || 0, bad.filter((x) => x.sev === 'critical').length);
          nw.n = Math.max(0, (nw.n || 0) - drop); nw.c = Math.max(0, (nw.c || 0) - drop);
          if (nw.t && nw.t.name) { nw.t.name -= drop; if (!nw.t.name) delete nw.t.name; }
          cmds.push(nw.n > 0 ? ['HSET', WNEW, id, JSON.stringify(nw)] : ['HDEL', WNEW, id]);
        }
        await redis(...cmds);
        sites++;
        const recId = amap[String(id).toLowerCase()];
        if (recId) { const r = await syncAudit(recId, result, { wrong: new Set(bad.map((x) => x.k)), why: fix.why }).catch(() => null); items += (r && r.fixed) || 0; }
      }
      if (!left) await redis(['SET', WFIX(fix.id), 'done']);
      report.push({ id: fix.id, sites, items, left });
      if (left) return { more: true, report };
    } finally { await redis(['DEL', WFIX(fix.id) + ':run']).catch(() => {}); }
  }
  // Line up the websites whose findings the newer rules may judge differently.
  const [rstate] = await redis(['GET', WFIX(RECHECK.id)]);
  if (rstate !== 'done' && Date.now() - t0 < budgetMs) {
    const [sumRaw] = await redis(['HGETALL', WSUM]);
    const sums = parseSum(sumRaw);
    const ids = Object.keys(sums).filter((id) => sums[id].c && (sums[id].rv || 1) < RULES_V);
    let lined = 0; let left = 0;
    for (let k = 0; k < ids.length; k += 25) {
      if (Date.now() - t0 > budgetMs) { left = ids.length - k; break; }
      const part = ids.slice(k, k + 25);
      const raws = await redis(...part.map((id) => ['GET', WKEY(id)]));
      const cmds = [];
      part.forEach((id, n) => {
        const r = jparse(raws[n]); if (!r) return;
        const keys = (r.issues || []).filter((x) => RECHECK.pick(x, r)).map((x) => x.k);
        if (!keys.length) return;
        cmds.push(['HSET', WRECHECK, id, JSON.stringify({ keys, why: RECHECK.why })], ['HSET', WSUM, id, JSON.stringify(Object.assign(sums[id], { relook: 1 }))]);
        lined++;
      });
      if (cmds.length) await redis(...cmds);
    }
    if (!left) await redis(['SET', WFIX(RECHECK.id), 'done']);
    report.push({ id: RECHECK.id, lined, left });
  }
  if (report.some((r) => r.sites)) await watchStatus().catch(() => {});
  return { report };
}

/** "This is fine for this website": remembered, and taken off its current list straight away. */
export async function markOk(id, key) {
  const [prevRaw, sumRaw] = await redis(['SADD', WOK(id), key], ['GET', WKEY(id)], ['HGET', WSUM, id]).then((r) => r.slice(1));
  const prev = jparse(prevRaw); if (!prev) return null;
  prev.issues = (prev.issues || []).filter((x) => x.k !== key);
  const sum = Object.assign(jparse(sumRaw) || {}, { n: prev.issues.length, c: prev.issues.filter((x) => x.sev === 'critical').length });
  sum.t = critTypes(prev.issues);
  await redis(['SET', WKEY(id), JSON.stringify(prev)], ['HSET', WSUM, id, JSON.stringify(sum)]);
  const recId = (await auditMap())[String(id).toLowerCase()];
  if (recId) await syncAudit(recId, prev, { ok: key }).catch(() => {});
  return prev;
}
/** Undo "not a problem" (it shows again from the next check). */
export async function unmarkOk(id, key) { await redis(['SREM', WOK(id), key]); }
export async function okList(id) { const [r] = await redis(['SMEMBERS', WOK(id)]); return r || []; }

/** How many serious findings of each kind: { phone: 2, email: 1 }. */
export function critTypes(list) {
  const t = {}; (list || []).forEach((x) => { if (x.sev === 'critical') t[x.type] = (t[x.type] || 0) + 1; }); return t;
}

// ---------- the audit items of a website that is on Audits ----------
const TYPE_WORD = { phone: 'Phone number', email: 'Email address', address: 'Address', name: 'Business name', social: 'Social account', schema: 'Schema' };
const liveId = (k) => 'live-' + crypto.createHash('sha1').update(String(k)).digest('hex').slice(0, 12);
const KEEP_GONE_MS = 45 * DAY;
const pairs = (arr, json) => { const o = {}; for (let i = 0; arr && i < arr.length; i += 2) o[arr[i]] = json ? jparse(arr[i + 1]) || {} : arr[i + 1]; return o; };
/**
 * Bring a website's auto-audit findings into its audit as items.
 *
 * They are the audit's own items from then on (numbered, assignable, with a status), marked as
 * found by the auto audit with the date and time. Every later read keeps them in step: a new
 * finding is added, one no longer on the live website closes itself as Done, and one that comes
 * back reopens. A rescan of the audit leaves them alone (it reads the Duda preview, not the live
 * website, so it cannot judge them). `opts.ok` is a finding just ruled "not a problem": it closes
 * as False alarm instead of Done.
 */
export async function syncAudit(recId, result, opts = {}) {
  if (!recId || !result) return null;
  const [raw, fnumRaw, seqRaw, fstRaw] = await redis(['GET', P + 'site:' + recId], ['HGETALL', P + 'fnum:' + recId], ['GET', P + 'seq:' + recId], ['HGETALL', P + 'fstate:' + recId]);
  const site = unpackJSON(raw); if (!site) return null;
  const nums = pairs(fnumRaw); const st = pairs(fstRaw, true);
  let seq = Number(seqRaw || 0);
  const at = new Date(result.at || Date.now()).toISOString(); const nowIso = new Date().toISOString();
  const old = new Map((site.findings || []).filter((f) => f.code === 'AUTO_LIVE').map((f) => [f.liveKey, f]));
  const others = (site.findings || []).filter((f) => f.code !== 'AUTO_LIVE');
  const numAdd = []; const stAdd = []; let added = 0, closed = 0, back = 0, fixed = 0;
  // The Local Business Schema note is not brought across: the audit's own scan already checks it on the home page.
  const live = (result.issues || []).filter((i) => i.type !== 'schema').map((i) => {
    const prev = old.get(i.k); old.delete(i.k);
    const id = prev ? prev.id : liveId(i.k);
    const pages = (i.pages || []).slice(0, 5);
    const f = { id, code: 'AUTO_LIVE', manual: true, liveKey: i.k, liveType: i.type,
      severity: i.sev === 'critical' ? 'critical' : 'warning', category: 'Auto audit (live website)',
      message: i.sev === 'critical' ? `${TYPE_WORD[i.type] || 'Detail'} that is not theirs: ${i.value}` : i.verify ? `Verify: ${i.value} (${i.label.charAt(0).toLowerCase() + i.label.slice(1)})` : `${String(i.label || '').split(':')[0]}: ${i.value}`, found: i.value,
      detail: i.label + (i.ctx && i.ctx !== i.value && !/^(tel|mailto):/i.test(i.ctx) && i.type !== 'social' ? `\n“${i.ctx}”` : '') + (i.rec ? `\nWhat to do: ${i.rec}` : ''),
      verify: !!i.verify,
      path: pages[0] || '/', pages, liveDomain: result.domain || '',
      autoLive: { at, pub: result.pub || '', first: prev && prev.autoLive ? prev.autoLive.first : at },
      by: '', byName: 'Auto audit', at: prev ? prev.at : at };
    if (!nums[id]) { seq++; nums[id] = String(seq); numAdd.push(id, String(seq)); added++; }
    const cur = st[id];
    if (cur && cur.status === 'done' && cur.auto === 'live-gone') { stAdd.push(id, JSON.stringify({ status: 'open', assignee: cur.assignee || '', updatedBy: '', updatedAt: nowIso, auto: 'live-back' })); back++; }
    return f;
  });
  const gone = [];
  old.forEach((f) => {
    const cur = st[f.id] || {};
    const goneAt = (f.autoLive && f.autoLive.gone) || at;
    if (Date.now() - Date.parse(goneAt) > KEEP_GONE_MS) return;         // long fixed: let it go
    gone.push(Object.assign({}, f, { autoLive: Object.assign({}, f.autoLive, { gone: goneAt }) }));
    if (cur.status === 'done' || cur.status === 'false') return;      // somebody already decided
    const ok = opts.ok && opts.ok === f.liveKey;
    const wrong = opts.wrong && opts.wrong.has(f.liveKey);
    stAdd.push(f.id, JSON.stringify(Object.assign({}, cur, { status: ok || wrong ? 'false' : 'done', updatedBy: opts.by || '', updatedAt: nowIso, auto: wrong ? 'app-fix' : ok ? 'live-ok' : 'live-gone' })));
    if (wrong) fixed++; else closed++;
  });
  site.findings = others.concat(live, gone);
  site.autoLive = { at, pub: result.pub || '', n: live.length, c: live.filter((f) => f.severity === 'critical').length };
  const cmds = [['SET', P + 'site:' + recId, packJSON(site)]];
  if (numAdd.length) cmds.push(['HSET', P + 'fnum:' + recId, ...numAdd], ['SET', P + 'seq:' + recId, String(seq)]);
  if (stAdd.length) cmds.push(['HSET', P + 'fstate:' + recId, ...stAdd]);
  if (added || closed || back || fixed) {
    const bits = [added && `added ${added} item${added === 1 ? '' : 's'}`, closed && `closed ${closed} no longer on the live website`, back && `reopened ${back} that came back`,
      fixed && `closed ${fixed} as False alarm: the auto audit's own mistake (${opts.why || 'fixed in the app'})`].filter(Boolean);
    const e = { id: newId(6), at: nowIso, by: '', byName: 'Auto audit', type: 'auto-audit', text: `auto audit of the live website: ${bits.join(', ')}` };
    cmds.push(['LPUSH', P + 'act:' + recId, JSON.stringify(e)], ['LTRIM', P + 'act:' + recId, 0, 299]);
  }
  await redis(...cmds);
  const { saveIndex } = await import('./store.js');
  await saveIndex(recId);
  return { added, closed, back, fixed };
}

// ---------- telling the admins ----------
async function admins() { return (await listUsers()).filter((u) => u.role === 'admin' && u.status === 'active'); }
const COUNT_WORD = { phone: ['phone number incorrect', 'phone numbers incorrect'], email: ['email address incorrect', 'email addresses incorrect'],
  address: ['address that is not theirs', 'addresses that are not theirs'], name: ['incorrect business name found', 'incorrect business names found'],
  social: ['social account that is not theirs', 'social accounts that are not theirs'] };
/**
 * One website in the alert, the way admins asked for it:
 *   *Business name* / Error found: / 5 phone numbers incorrect / 1 incorrect business name found / and 5 more! / link
 */
function siteBlock(x) {
  const types = Object.entries(x.t || {}).sort((a, b) => b[1] - a[1]);
  const shown = types.slice(0, 2);
  const more = (x.n || 0) - shown.reduce((a, [, v]) => a + v, 0);
  const rows = shown.map(([k, v]) => `${v} ${(COUNT_WORD[k] || ['problem', 'problems'])[v === 1 ? 0 : 1]}`);
  if (more > 0) rows.push(`and ${more} more!`);
  const base = appUrl();
  const href = !base ? '' : x.recId ? `${base}/#/site/${encodeURIComponent(x.recId)}/findings` : `${base}/#/dr/${encodeURIComponent(x.id)}/auto-audit`;
  const name = String(x.name || x.domain || x.id).replace(/[*_~<>]/g, '');
  return { rows, line: `${name}: ${rows.join(', ')}`,
    slack: `*${name}*\nError found:\n${rows.map((r) => (/^and \d+ more!$/.test(r) ? '_' + r + '_' : '• ' + r)).join('\n')}${href ? `\n<${href}|${x.recId ? 'Audit items' : 'Auto audit findings'}>` : ''}` };
}
async function sendCritical(items, kind) {
  const blocks = items.map(siteBlock);
  const m = { kind, urgent: true, by: '', byName: 'Auto audit', siteName: '', dudaSite: items.length === 1 ? items[0].id : '', count: items.length,
    headline: `🚨 *CRITICAL ERRORS FOUND!*${items.length > 1 ? ` (${items.length} websites)` : ''}`,
    sections: blocks.map((b) => b.slack), lines: blocks.map((b) => b.line), text: blocks.map((b) => b.line).join('\n') };
  await Promise.all((await admins()).map((u) => notifyUser(u.email, m).catch(() => {})));
}
async function alertNow(s, name, fresh, recId) {
  await sendCritical([{ id: s.id, name, domain: s.domain, n: fresh.length, t: critTypes(fresh), recId: recId || '' }], 'watch-issue');
}
/** Once a day: every website where new serious problems were found since the last report, in one message. */
export async function watchDigest() {
  const [raw] = await redis(['HGETALL', WNEW]);
  const items = []; for (let i = 0; raw && i < raw.length; i += 2) { const v = jparse(raw[i + 1]); if (v) items.push(Object.assign({ id: raw[i] }, v)); }
  await redis(['DEL', WNEW]);
  // Only the serious ones (contact details that are not theirs) are worth a message; a town and ZIP
  // to check waits on the website's profile.
  const crit = items.filter((x) => x.c).sort((a, b) => b.c - a.c || b.n - a.n);
  if (!crit.length) return 0;
  await sendCritical(crit, 'watch-digest');
  return crit.length;
}
