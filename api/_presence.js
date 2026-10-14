// Online presence: does what Google (the Business Profile), Facebook, Instagram, YouTube and Yelp show
// for a business match its Business Info, and is it written the same way everywhere?
//
// Business Info is the fact. Everything here is a note about the listings, never a correction of it.
//
// Where the details come from:
//  - Google Business Profile: Google's own Places data when GOOGLE_MAPS_API_KEY is set (exact).
//    Without it, the AI web search below.
//  - The rest: Claude with web search. Only details that appear WORD FOR WORD in a page Claude cites
//    are kept (the citation carries the source's own text, checked here, not trusted). Anything that
//    cannot be confirmed that way is reported as "couldn't confirm", never filled in or guessed.
import { redis, P, jparse, unpackJSON, fetchWithTimeout } from './_lib.js';
import { aiUsage, onSite } from './_meter.js';
import { truthFor, auditMap } from './_watch.js';
import { _test as ai } from './ai.js';

const A = () => globalThis.DudaAudit;
export const PKEY = (id) => P + 'presence:' + id;
export const PCFG = P + 'presencecfg';
const GBPKEY = (id) => P + 'gbp:' + id;
const DAY = 86400000;
export const PLATFORMS = { google: 'Google Business Profile', facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube', yelp: 'Yelp' };
const HOST = { facebook: /(^|\.)(facebook\.com|fb\.com)$/i, instagram: /(^|\.)instagram\.com$/i, youtube: /(^|\.)(youtube\.com|youtu\.be)$/i, yelp: /(^|\.)yelp\.[a-z.]+$/i,
  google: /(^|\.)(google\.[a-z.]+|g\.page|goo\.gl|maps\.app\.goo\.gl|business\.site)$/i };
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; } };
/** The website a listing links to, as a bare host: "www.Shop.com/", "https://shop.com", and Facebook's l.php?u= link all give "shop.com". */
export function siteHost(v) {
  let u = String(v || '').trim(); if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try {
    const x = new URL(u);
    const inner = /(^|\.)facebook\.com$/i.test(x.hostname) && x.searchParams.get('u');
    if (inner) return siteHost(inner);
    return x.hostname.replace(/^www\./, '').toLowerCase();
  } catch (e) { return ''; }
}
const digits = (s) => String(s || '').replace(/\D/g, '');
const ten = (s) => digits(s).slice(-10);
const flat = (s) => String(s || '').toLowerCase().replace(/&amp;/g, '&').replace(/[^a-z0-9]+/g, ' ').trim();
// Not preceded by a digit, so a ZIP right before the number ("18101 610-555-0100") is not read as a leading 1.
const PHONE_TXT = /(?<![\d-])(?:\+?1[\s.-]?)?\(?\b([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-](\d{4})\b/g;

export async function presenceCfg() { const [raw] = await redis(['GET', PCFG]); return Object.assign({ auto: false, perDay: 20, clientDefault: false }, jparse(raw) || {}); }

// ---------- what the website itself shows ----------
/** The way the website writes the business's phone number (its format), read from the home page. */
async function websiteFormats(domain, truth) {
  if (!domain) return {};
  try {
    const r = await fetchWithTimeout(`${process.env.WATCH_PROTOCOL || 'https'}://${domain}/`, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SiteAuditor)' } }, 9000);
    if (!r.ok) return {};
    const text = (await r.text()).slice(0, 600000).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
    const phones = {};
    for (const m of text.matchAll(PHONE_TXT)) { const d = m[1] + m[2] + m[3]; if ((truth.phones || []).includes(d) && !phones[d]) phones[d] = m[0].trim(); }
    return { phones };
  } catch (e) { return {}; }
}

// ---------- Google's own data (Places API) ----------
const PLACE_FIELDS = 'id,displayName,formattedAddress,nationalPhoneNumber,internationalPhoneNumber,websiteUri,googleMapsUri,businessStatus';
async function places(path, opts) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  const base = String(process.env.GOOGLE_PLACES_API_BASE || 'https://places.googleapis.com/v1').replace(/\/+$/, '');
  const r = await fetchWithTimeout(base + path, Object.assign({}, opts, { headers: Object.assign({ 'X-Goog-Api-Key': key, 'Content-Type': 'application/json' }, opts.headers || {}) }), 12000);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Google answered ${r.status}${j.error && j.error.message ? ': ' + String(j.error.message).slice(0, 120) : ''}`);
  return j;
}
/** Is this Google listing clearly theirs? Their website, one of their phones, or their street and ZIP. Never just a similar name. */
function placeIsTheirs(p, truth, domain) {
  const site = hostOf(p.websiteUri || '');
  if (site && domain && (site === domain || site.endsWith('.' + domain))) return 'its website is theirs';
  if ((truth.phones || []).includes(ten(p.nationalPhoneNumber || p.internationalPhoneNumber))) return 'its phone is theirs';
  const a = (truth.addresses || [])[0];
  const fa = String(p.formattedAddress || '').toLowerCase();
  if (a && a.zip && fa.includes(String(a.zip)) && a.street && fa.includes(String(a.street).toLowerCase().split(' ')[0])) return 'its street and ZIP are theirs';
  return '';
}
async function gbpFromPlaces(dudaId, truth, domain) {
  const [cached] = await redis(['GET', GBPKEY(dudaId)]);
  let p = null; let why = '';
  if (cached) {
    try { p = await places('/places/' + encodeURIComponent(cached), { method: 'GET', headers: { 'X-Goog-FieldMask': PLACE_FIELDS } }); why = placeIsTheirs(p, truth, domain); } catch (e) { p = null; }
  }
  if (!p || !why) {
    const a = (truth.addresses || [])[0] || {};
    const q = [truth.businessName, a.street, a.city, a.state || a.region, a.zip].filter(Boolean).join(', ');
    const j = await places('/places:searchText', { method: 'POST', headers: { 'X-Goog-FieldMask': PLACE_FIELDS.split(',').map((f) => 'places.' + f).join(',') }, body: JSON.stringify({ textQuery: q, maxResultCount: 5 }) });
    p = null; why = '';
    for (const c of j.places || []) { const w = placeIsTheirs(c, truth, domain); if (w) { p = c; why = w; break; } }
    if (p) await redis(['SET', GBPKEY(dudaId), p.id, 'EX', 180 * 86400]);
  }
  if (!p) return { platform: 'google', found: false, source: 'places', note: 'Google has no listing that is clearly theirs (none matched their website, phone, or street and ZIP).' };
  return { platform: 'google', found: true, source: 'places', why, url: p.googleMapsUri || '', name: (p.displayName && p.displayName.text) || '', phone: p.nationalPhoneNumber || '', address: p.formattedAddress || '',
    website: p.websiteUri || '', status: p.businessStatus || '' };
}

// ---------- the AI web search, with every detail checked against what it cites ----------
const SYSTEM = `You look up a local business's public listings with web search.
Rules:
- Report only details you can see in the search results, copied exactly as written there (keep the original spelling, capitals and phone format).
- Never guess, fill in, or "correct" anything. If a detail is not shown, leave it out.
- Only report a page if it clearly belongs to this business (same name and the same town, phone or website). If unsure, leave it out.
- For each detail you report, first write one short sentence that quotes it, so it is cited.
- Also report the website address each listing links to, exactly as shown.
- Finish with a JSON block: {"listings":[{"platform":"google|facebook|instagram|youtube|yelp","url":"...","name":"...","phone":"...","address":"...","email":"...","website":"..."}]}`;
async function anthropic() {
  const list = await ai.applySavedModels(ai.providers());
  return list.find((p) => p.id === 'anthropic') || null;
}
async function webSearchListings(truth, domain, wanted) {
  const p = await anthropic();
  if (!p) return { error: 'The AI web search needs the Claude (Anthropic) key, which is not set up.' };
  const a = (truth.addresses || [])[0] || {};
  const known = Object.entries(truth.socialLinks || {}).filter(([k]) => wanted.includes(k === 'google_my_business' ? 'google' : k)).map(([k, v]) => `${k}: ${[].concat(v).join(', ')}`).join('\n');
  const user = `Business: ${truth.businessName}
Address: ${[a.street, a.city, a.state || a.region, a.zip].filter(Boolean).join(', ') || '(unknown)'}
Phone: ${(truth.phones || []).map((x) => A().fmtPhone(x)).join(', ') || '(unknown)'}
Website: ${domain || '(unknown)'}
${known ? `Their profiles listed in their Business Info:\n${known}\n` : ''}
Find what these show for the business: ${wanted.map((w) => PLATFORMS[w]).join(', ')}. Report the page URL, the business name, phone, address, email and the website it links to, exactly as each one shows them.`;
  const model = process.env.PRESENCE_MODEL || p.model;
  const r = await fetchWithTimeout(`${p.base}/messages`, {
    method: 'POST', headers: { 'x-api-key': p.key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 2500, system: SYSTEM, messages: [{ role: 'user', content: user }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: Math.max(1, Math.min(6, Number(process.env.PRESENCE_MAX_SEARCHES) || wanted.length + 1)) }] }),
  }, 90000);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { error: `The AI web search did not work (${r.status}${j.error && j.error.message ? ': ' + String(j.error.message).slice(0, 140) : ''}).` };
  const u = j.usage || {};
  aiUsage('anthropic', j.model || model, (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), u.output_tokens || 0, (u.server_tool_use && u.server_tool_use.web_search_requests) || 0);
  // What the search really returned: result URLs and titles, and the sources' own words (citations).
  const results = []; const cites = []; let text = '';
  (j.content || []).forEach((b) => {
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) b.content.forEach((x) => { if (x.url) results.push({ url: x.url, title: x.title || '' }); });
    if (b.type === 'text') { text += b.text || ''; (b.citations || []).forEach((c) => { if (c.url && c.cited_text) cites.push({ url: c.url, title: c.title || '', text: c.cited_text }); }); }
  });
  const m = text.match(/\{[\s\S]*"listings"[\s\S]*\}/);
  const parsed = m ? jparse(m[0].replace(/```[a-z]*|```/g, ''), null) : null;
  return { listings: (parsed && parsed.listings) || [], results, cites, searches: (u.server_tool_use && u.server_tool_use.web_search_requests) || 0, model: j.model || model };
}
/** Keep a listing only as far as its sources show it: the page must be a search result on that platform, and each detail must be in the words of a page cited from that platform. */
export function verifyListing(l, ws) {
  const platform = String(l.platform || '').toLowerCase();
  if (!PLATFORMS[platform]) return null;
  const onPlatform = (u) => HOST[platform].test(hostOf(u));
  const sameUrl = (u) => { const a = String(u || '').replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase(); const b = String(l.url || '').replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase(); return a && b && (a === b || a.startsWith(b) || b.startsWith(a)); };
  const pageSeen = l.url && onPlatform(l.url) && (ws.results.some((x) => sameUrl(x.url)) || ws.cites.some((c) => sameUrl(c.url)));
  const texts = ws.cites.filter((c) => onPlatform(c.url)).map((c) => c.text).concat(ws.results.filter((x) => onPlatform(x.url)).map((x) => x.title));
  const said = (v) => texts.some((t) => String(t).includes(String(v).trim()));
  const out = { platform, found: false, source: 'websearch', url: pageSeen ? l.url : '', unconfirmed: [] };
  const keep = (k, v, ok) => { if (!v) return; if (ok) out[k] = String(v).trim(); else out.unconfirmed.push(k); };
  keep('name', l.name, said(l.name) || texts.some((t) => flat(t).includes(flat(l.name))));
  keep('phone', l.phone, ten(l.phone).length === 10 && texts.some((t) => digits(t).includes(ten(l.phone))) && said(l.phone));
  keep('address', l.address, said(l.address));
  keep('email', l.email, said(l.email));
  // The website it links to: shown on the cited page (as written, or its bare address).
  keep('website', l.website, siteHost(l.website) && (said(l.website) || texts.some((t) => String(t).toLowerCase().includes(siteHost(l.website)))));
  out.found = !!(out.url && (out.name || out.phone || out.address || out.email));
  out.sources = ws.cites.filter((c) => onPlatform(c.url)).slice(0, 4).map((c) => ({ url: c.url, text: c.text }));
  return out;
}

// ---------- comparing with Business Info ----------
function notesFor(x, truth, formats, domain) {
  const notes = [];
  const bi = truth.businessName || '';
  const nm = PLATFORMS[x.platform];
  if (x.name && bi) {
    if (!A().matchesBusiness(x.name, truth)) notes.push({ kind: 'name', level: 'check', text: `${nm} shows the name "${x.name}", but Business Info has "${bi}".` });
    else if (x.name.trim() !== bi.trim() && flat(x.name) !== flat(bi)) notes.push({ kind: 'name', level: 'format', text: `${nm} writes the name as "${x.name}"; Business Info has "${bi}". Same business, written differently.` });
  }
  if (x.phone) {
    const d = ten(x.phone);
    if (!(truth.phones || []).includes(d)) notes.push({ kind: 'phone', level: 'check', text: `${nm} shows the phone ${x.phone}, which is not in Business Info (${(truth.phones || []).map((p) => A().fmtPhone(p)).join(', ') || 'none'}).` });
    else {
      const site = (formats.phones || {})[d];
      if (site && x.phone.replace(/^\+?1[\s.-]?/, '').trim() !== site.replace(/^\+?1[\s.-]?/, '').trim()) notes.push({ kind: 'phone', level: 'format', text: `${nm} writes the phone as ${x.phone}; the website writes it as ${site}.` });
    }
  }
  if (x.address) {
    const a = (truth.addresses || [])[0];
    if (a && a.zip && !String(x.address).includes(String(a.zip))) notes.push({ kind: 'address', level: 'check', text: `${nm} shows the address "${x.address}", which does not match Business Info (${[a.street, a.city, a.zip].filter(Boolean).join(', ')}).` });
  }
  // The website the listing sends people to must be theirs (a subdomain of theirs is fine).
  if (x.website && domain) { const h = siteHost(x.website); if (h && h !== domain && !h.endsWith('.' + domain) && !domain.endsWith('.' + h)) notes.push({ kind: 'website', level: 'check', host: h, text: `${nm} links to ${h}, not to their website (${domain}).` }); }
  if (x.status && x.status !== 'OPERATIONAL') notes.push({ kind: 'status', level: 'check', text: `${nm} lists the business as ${String(x.status).toLowerCase().replace(/_/g, ' ')}.` });
  return notes;
}
/** The client-facing suggestions: friendly, short, and only from what was confirmed. */
const domainOf = (truth, listings) => listings._domain || truth.domain || 'your website';
function recsFor(listings, truth, formats) {
  const recs = [];
  const sitePhone = Object.values(formats.phones || {})[0] || ((truth.phones || [])[0] ? A().fmtPhone(truth.phones[0]) : '');
  listings.filter((x) => x.found).forEach((x) => {
    const nm = PLATFORMS[x.platform];
    (x.notes || []).forEach((n) => {
      if (n.kind === 'phone' && n.level === 'format') recs.push(`Your ${nm} shows your phone as ${x.phone}, while your website shows ${sitePhone}. Use the same format everywhere: it helps Google and customers recognise your business.`);
      else if (n.kind === 'phone') recs.push(`Your ${nm} shows ${x.phone} as your phone number. If your number is ${sitePhone}, update ${nm} so customers call the right number.`);
      else if (n.kind === 'name') recs.push(`Your ${nm} shows your business name as "${x.name}". Writing it exactly as "${truth.businessName}" everywhere makes your business easier to find.`);
      else if (n.kind === 'address') recs.push(`Your ${nm} address doesn't match the one on your website. Make sure both show your current address.`);
      else if (n.kind === 'website') recs.push(`Your ${nm} links to ${n.host}, not to your website. Change it to ${domainOf(truth, listings)} so visitors reach you.`);
    });
  });
  const has = (pl) => listings.some((x) => x.platform === pl && x.found);
  if (!has('google')) recs.push('We couldn\'t confirm a Google Business Profile for your business. A complete, verified profile is one of the best ways to be found on Google and Maps.');
  return [...new Set(recs)].slice(0, 8);
}

// ---------- one website ----------
export async function presenceCheck(dudaId, { by = '' } = {}) {
  const amap = await auditMap();
  const recId = amap[String(dudaId).toLowerCase()] || '';
  let allow = [];
  if (recId) { const [raw] = await redis(['GET', P + 'site:' + recId]); allow = (unpackJSON(raw) || {}).allow || []; }
  const [listRaw] = await redis(['GET', P + 'dudasites']);
  const site = (((unpackJSON(listRaw) || {}).sites) || []).find((x) => String(x.id) === String(dudaId)) || {};
  const truth = await truthFor(dudaId, allow);
  if (!truth.businessName && !(truth.phones || []).length) return { at: Date.now(), error: 'No Business Info in Duda to compare with.' };
  const domain = String(site.domain || truth.domain || '').toLowerCase().replace(/^www\./, '');
  const bare = domain.replace(/:\d+$/, '');          // compared without a port
  const formats = await websiteFormats(domain, truth);
  // Google and Facebook always; the others when Business Info lists them.
  const wanted = ['google', 'facebook'].concat(['instagram', 'youtube', 'yelp'].filter((k) => (truth.socialLinks || {})[k]));
  const listings = []; let ws = null; let gbpSource = '';
  if (process.env.GOOGLE_MAPS_API_KEY) {
    try { listings.push(await gbpFromPlaces(dudaId, truth, bare)); gbpSource = 'places'; }
    catch (e) { listings.push({ platform: 'google', found: false, source: 'places', note: String(e.message || e).slice(0, 160) }); gbpSource = 'places'; }
  }
  const viaSearch = wanted.filter((w) => !(w === 'google' && gbpSource));
  if (viaSearch.length) {
    ws = await webSearchListings(truth, bare, viaSearch);
    if (ws.error) viaSearch.forEach((w) => listings.push({ platform: w, found: false, source: 'websearch', note: ws.error }));
    else viaSearch.forEach((w) => {
      const cands = ws.listings.filter((l) => String(l.platform).toLowerCase() === w).map((l) => verifyListing(l, ws)).filter(Boolean);
      const best = cands.find((c) => c.found) || cands[0];
      listings.push(best && best.found ? best : { platform: w, found: false, source: 'websearch', note: cands.length ? 'Search results mentioned it, but nothing could be confirmed word for word from the pages, so nothing is reported.' : 'Not found in the search results. Nothing is assumed.' , unconfirmed: best ? best.unconfirmed : [] });
    });
  }
  listings.forEach((x) => { x.notes = x.found ? notesFor(x, truth, formats, bare) : []; });
  Object.defineProperty(listings, '_domain', { value: bare, enumerable: false });
  const result = { at: Date.now(), by, id: String(dudaId), name: truth.businessName, domain,
    reference: { name: truth.businessName, phones: (truth.phones || []).map((p) => A().fmtPhone(p)), websitePhone: Object.values(formats.phones || {})[0] || '', address: (truth.addresses || [])[0] || null },
    listings, recs: recsFor(listings, truth, formats), searches: ws ? ws.searches || 0 : 0, model: ws ? ws.model || '' : '', gbp: gbpSource || (viaSearch.includes('google') ? 'websearch' : '') };
  await redis(['SET', PKEY(dudaId), JSON.stringify(result)], ['HSET', P + 'presencesum', String(dudaId), JSON.stringify({ at: result.at, n: listings.filter((x) => x.found).length, c: listings.reduce((a, x) => a + (x.notes || []).filter((n) => n.level === 'check').length, 0), f: listings.reduce((a, x) => a + (x.notes || []).filter((n) => n.level === 'format').length, 0) })]);
  return result;
}

/** Automatic runs (only when switched on in Settings): the websites checked longest ago first. */
export const PDUE = P + 'presence:due';             // how many are still to do today (rides on the heartbeat)
export async function presenceAuto({ budgetMs = 40000, by = 'auto' } = {}) {
  const cfg = await presenceCfg();
  if (!cfg.auto) { await redis(['DEL', PDUE]); return { off: true }; }
  const [got] = await redis(['SET', P + 'presence:autolock', by, 'NX', 'EX', Math.ceil(budgetMs / 1000) + 30]);
  if (got !== 'OK') return { busy: true };
  try { return await presenceAutoRun(cfg, budgetMs, by); } finally { await redis(['DEL', P + 'presence:autolock']).catch(() => {}); }
}
async function presenceAutoRun(cfg, budgetMs, by) {
  const t0 = Date.now();
  const day = new Date().toISOString().slice(0, 10);
  const [countRaw, sumRaw, listRaw] = await redis(['GET', P + 'presence:day:' + day], ['HGETALL', P + 'presencesum'], ['GET', P + 'dudasites']);
  let done = Number(countRaw) || 0;
  if (done >= cfg.perDay) { await redis(['DEL', PDUE]); return { today: done, perDay: cfg.perDay, left: 0 }; }
  const sums = {}; for (let i = 0; sumRaw && i < sumRaw.length; i += 2) sums[sumRaw[i]] = jparse(sumRaw[i + 1]) || {};
  const due = (((unpackJSON(listRaw) || {}).sites) || []).filter((x) => x.domain && (!sums[x.id] || Date.now() - (sums[x.id].at || 0) > 30 * DAY))
    .sort((a, b) => ((sums[a.id] || {}).at || 0) - ((sums[b.id] || {}).at || 0));
  const out = [];
  for (const s of due) {
    if (done >= cfg.perDay || Date.now() - t0 > budgetMs - 25000) break;
    onSite(s.id);
    try { await presenceCheck(s.id, { by }); out.push(s.id); } catch (e) { out.push(s.id + ': ' + String(e.message || e).slice(0, 80)); }
    onSite('');
    done++;
    await redis(['SET', P + 'presence:day:' + day, String(done), 'EX', 2 * 86400]);
  }
  const left = Math.max(0, Math.min(cfg.perDay - done, due.length - out.length));
  await redis(left ? ['SET', PDUE, String(left), 'EX', 86400] : ['DEL', PDUE]);
  return { checked: out, today: done, perDay: cfg.perDay, left };
}
