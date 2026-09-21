// AI judgement for ambiguous content: image alt text and page text (business name + location).
// GET  /api/ai → { enabled, providers: [{ id, label, model, free, state, until, note, used, limit, resetsAt }], now }
// POST /api/ai { op: 'alt',  business, items: [{ i, alt, file, location, isLogo }] }  → { results: [{ i, verdict, confidence, reason, suggestion }], provider, model, providers }
// POST /api/ai { op: 'text', business, items: [{ i, text, location, page }] }         → { results: [{ i, type, quote, confidence, reason, suggestion }], provider, model, providers }
// When every model is busy or at its limit → 429 { allBusy: true, retryAt, providers }
//
// Several AI providers are chained. The first one that is available answers; when one hits a rate limit, a daily cap,
// or runs out of credits, it is parked until it resets (with a countdown in the app) and the next one takes over.
//   AI_GATEWAY_API_KEY  Vercel AI Gateway (paid credits; free tier covers only a few niche models)  AI_GATEWAY_MODEL (default anthropic/claude-haiku-4.5)
//   GEMINI_API_KEY      Google Gemini, free tier, no card. Daily quota resets at midnight Pacific.   GEMINI_MODEL (default gemini-2.5-flash)
//   GROQ_API_KEY        Groq, free tier, no card.                                                    GROQ_MODEL (default llama-3.3-70b-versatile)
//   OPENROUTER_API_KEY  OpenRouter ":free" models, no card (about 50 requests a day).                OPENROUTER_MODEL (default qwen/qwen3.8-27b:free)
//   ANTHROPIC_API_KEY   Anthropic API directly (paid).                                               ANTHROPIC_MODEL (default claude-haiku-4-5)
// Order: AI_ORDER (default "gateway,gemini,groq,openrouter,anthropic"). Only providers with a key take part.
// Our own daily request cap per provider: <GEMINI|GROQ|OPENROUTER|AI_GATEWAY|ANTHROPIC>_DAILY_LIMIT (0 = no cap).
// Results are cached for 60 days so rescans don't use any quota.
import { redis, P, readBody, requireUser, sha, fetchWithTimeout, jparse } from './_lib.js';

const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT || 5000); // items (alt texts + text blocks) per day, all users
const AGENCIES = (process.env.AGENCY_NAMES || 'Detailers Roadmap, 8bit Creative').split(',').map((s) => s.trim()).filter(Boolean);
const ALT_VERDICTS = ['describes_image', 'this_business', 'other_business', 'wrong_location', 'placeholder', 'unclear'];
const TEXT_TYPES = ['other_business', 'wrong_location', 'name_variant'];

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);
const CATALOG = {
  gateway: () => ({ label: 'Vercel AI Gateway', kind: 'openai', keyVar: 'AI_GATEWAY_API_KEY', limitVar: 'AI_GATEWAY_DAILY_LIMIT', defLimit: 0, free: false, tz: 'UTC',
    base: env('AI_GATEWAY_BASE', 'https://ai-gateway.vercel.sh/v1'), model: env('AI_GATEWAY_MODEL', env('AI_MODEL', 'anthropic/claude-haiku-4.5')) }),
  gemini: () => ({ label: 'Google Gemini', kind: 'gemini', keyVar: 'GEMINI_API_KEY', limitVar: 'GEMINI_DAILY_LIMIT', defLimit: 250, free: true, tz: 'America/Los_Angeles',
    base: env('GEMINI_API_BASE', 'https://generativelanguage.googleapis.com/v1beta'), model: env('GEMINI_MODEL', 'gemini-2.5-flash') }),
  groq: () => ({ label: 'Groq', kind: 'openai', keyVar: 'GROQ_API_KEY', limitVar: 'GROQ_DAILY_LIMIT', defLimit: 1000, free: true, tz: 'UTC',
    base: env('GROQ_API_BASE', 'https://api.groq.com/openai/v1'), model: env('GROQ_MODEL', 'llama-3.3-70b-versatile') }),
  openrouter: () => ({ label: 'OpenRouter (free)', kind: 'openai', keyVar: 'OPENROUTER_API_KEY', limitVar: 'OPENROUTER_DAILY_LIMIT', defLimit: 50, free: true, tz: 'UTC',
    base: env('OPENROUTER_API_BASE', 'https://openrouter.ai/api/v1'), model: env('OPENROUTER_MODEL', 'qwen/qwen3.8-27b:free') }),
  anthropic: () => ({ label: 'Anthropic', kind: 'anthropic', keyVar: 'ANTHROPIC_API_KEY', limitVar: 'ANTHROPIC_DAILY_LIMIT', defLimit: 0, free: false, tz: 'UTC',
    base: env('ANTHROPIC_API_BASE', 'https://api.anthropic.com/v1'), model: env('ANTHROPIC_MODEL', 'claude-haiku-4-5') }),
};
function providers() {
  const order = env('AI_ORDER', 'gateway,gemini,groq,openrouter,anthropic').split(',').map((s) => s.trim().toLowerCase()).filter((id) => CATALOG[id]);
  Object.keys(CATALOG).forEach((id) => { if (!order.includes(id)) order.push(id); });
  return [...new Set(order)].map((id) => Object.assign({ id }, CATALOG[id]())).filter((p) => process.env[p.keyVar])
    .map((p) => Object.assign(p, { key: process.env[p.keyVar], limit: Math.max(0, Number(env(p.limitVar, p.defLimit)) || 0) }));
}

// ---------- time helpers ----------
function tzParts(tz, d) {
  const o = {}; new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(d).forEach((x) => { o[x.type] = x.value; });
  return o;
}
const dayKey = (tz, now = new Date()) => { const o = tzParts(tz, now); return `${o.year}-${o.month}-${o.day}`; };
function nextMidnight(tz, now = new Date()) {
  const o = tzParts(tz, now);
  const offset = Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour, +o.minute, +o.second) - Math.floor(now.getTime() / 1000) * 1000;
  return Date.UTC(+o.year, +o.month - 1, +o.day + 1) - offset;
}
function parseDuration(v) {
  if (v === null || v === undefined || v === '') return 0;
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s) * 1000;
  let ms = 0; const re = /(\d+(?:\.\d+)?)\s*(ms|h|m|s)/gi; let m, hit = false;
  while ((m = re.exec(s))) { hit = true; const n = Number(m[1]); ms += m[2].toLowerCase() === 'h' ? n * 3600000 : m[2].toLowerCase() === 'm' ? n * 60000 : m[2].toLowerCase() === 'ms' ? n : n * 1000; }
  return hit ? ms : 0;
}

// ---------- provider state (shared by the whole team, in Redis) ----------
const stateKey = (id) => P + 'aiprov2:' + id;
const modelKey = (id) => P + 'aimodel:' + id;
const useKey = (p) => P + 'aiuse:' + p.id + ':' + dayKey(p.tz);
async function loadStatus(list) {
  if (!list.length) return [];
  const rows = await redis(...list.flatMap((p) => [['GET', stateKey(p.id)], ['GET', useKey(p)]]));
  const now = Date.now();
  return list.map((p, k) => {
    const st = jparse(rows[k * 2]) || {};
    const used = Number(rows[k * 2 + 1]) || 0;
    const resetsAt = nextMidnight(p.tz);
    let state = 'ready', until = 0, note = '';
    if (st.until && st.until > now) { state = st.reason || 'cooling'; until = st.until; note = st.note || ''; }
    if (state === 'ready' && p.limit && used >= p.limit) { state = 'limit'; until = resetsAt; note = `Reached this app's daily cap of ${p.limit} requests.`; }
    return { id: p.id, label: p.label, model: p.model, auto: !!p.auto, configured: p.configured || '', free: p.free, state, ready: state === 'ready', until, note, used, limit: p.limit, resetsAt };
  });
}
async function park(p, reason, until, note) {
  await redis(['SET', stateKey(p.id), JSON.stringify({ reason, until, note: String(note || '').slice(0, 300), at: Date.now() }), 'PX', Math.max(1000, until - Date.now() + 60000)]);
}

// Work out why a call failed and for how long the provider should rest
function classify(p, r, j) {
  const now = Date.now();
  const body = JSON.stringify(j || {}).slice(0, 3000);
  const low = body.toLowerCase();
  const msg = ((j && j.error && (j.error.message || j.error)) || (j && j.message) || '').toString().slice(0, 200);
  let retry = parseDuration(r.headers.get('retry-after'));
  const gRetry = low.match(/"retrydelay":"([^"]+)"/); if (!retry && gRetry) retry = parseDuration(gRetry[1]);
  const again = body.match(/try again in ([0-9hms.]+)/i); if (!retry && again) retry = parseDuration(again[1]);
  const resetHdr = Number(r.headers.get('x-ratelimit-reset'));
  if (!retry && resetHdr) retry = (resetHdr > 1e12 ? resetHdr : resetHdr * 1000) - now;
  if (r.status === 429) {
    const daily = /per ?day|perday|daily|requests per day|tokens per day|\brpd\b|\btpd\b|per-day/.test(low);
    if (daily) {
      const until = p.id === 'gemini' || !retry || retry < 60000 ? nextMidnight(p.tz) : now + retry;
      return { reason: 'limit', until, note: 'Daily free limit reached.' };
    }
    if (/credit|insufficient|balance|quota exceeded for this month/.test(low)) return { reason: 'credits', until: now + 12 * 3600000, note: 'Out of credits. Checking again later.' };
    return { reason: 'cooling', until: now + Math.min(Math.max(retry || 60000, 5000), 3600000), note: 'Per-minute rate limit. Resting briefly.' };
  }
  if (r.status === 402 || (r.status === 403 && /credit|fund|balance|billing|payment|free tier|not available on the free/.test(low)))
    return { reason: 'credits', until: now + 12 * 3600000, note: 'No credits for this model. Checking again later.' + (msg ? ' (' + msg + ')' : '') };
  if (r.status === 401 || r.status === 403) return { reason: 'error', until: now + 3600000, note: 'API key was rejected. Check the key in Vercel.' + (msg ? ' (' + msg + ')' : '') };
  if (r.status === 404 || ((r.status === 400 || r.status === 403) && /model/.test(low) && /not found|does not exist|no longer available|not available|not supported|decommission|deprecat|invalid model|unknown model/.test(low)))
    return { reason: 'error', model: true, until: now + 15 * 60000, note: `Model "${p.model}" isn't available and no replacement was found.` + (msg ? ' (' + msg + ')' : ''), raw: body };
  return { reason: 'cooling', until: now + 60000, note: `Error ${r.status}. Retrying in a minute.` + (msg ? ' (' + msg + ')' : '') };
}

async function callOnce(p, system, user) {
  let r, j = {}, text = '';
  try {
    if (p.kind === 'gemini') {
      r = await fetchWithTimeout(`${p.base}/models/${encodeURIComponent(p.model)}:generateContent`, {
        method: 'POST', headers: { 'x-goog-api-key': p.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { temperature: 0, maxOutputTokens: 8192, responseMimeType: 'application/json' } }),
      }, 40000);
      j = await r.json().catch(() => ({}));
      if (r.ok) text = ((((j.candidates || [])[0] || {}).content || {}).parts || []).map((x) => x.text || '').join('');
    } else if (p.kind === 'anthropic') {
      r = await fetchWithTimeout(`${p.base}/messages`, {
        method: 'POST', headers: { 'x-api-key': p.key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: p.model, max_tokens: 4000, temperature: 0, system, messages: [{ role: 'user', content: user }] }),
      }, 40000);
      j = await r.json().catch(() => ({}));
      if (r.ok) text = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    } else {
      const headers = { Authorization: `Bearer ${p.key}`, 'Content-Type': 'application/json' };
      if (p.id === 'openrouter') { if (process.env.APP_URL) headers['HTTP-Referer'] = process.env.APP_URL; headers['X-Title'] = 'Duda Site Auditor'; }
      r = await fetchWithTimeout(`${p.base}/chat/completions`, {
        method: 'POST', headers,
        body: JSON.stringify(Object.assign({ model: p.model, temperature: 0, max_tokens: 8000, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }, p.id === 'groq' && /gpt-oss/.test(p.model) ? { reasoning_effort: 'low' } : {})),
      }, 40000);
      j = await r.json().catch(() => ({}));
      if (r.ok) text = (((j.choices || [])[0] || {}).message || {}).content || '';
    }
  } catch (e) {
    return { fail: { reason: 'cooling', until: Date.now() + 60000, note: e.name === 'AbortError' ? 'Timed out. Retrying in a minute.' : 'Network error: ' + String(e.message || e).slice(0, 120) } };
  }
  if (!r.ok) return { fail: classify(p, r, j) };
  const m = String(text).replace(/<think>[\s\S]*?<\/think>/g, '').match(/\{[\s\S]*\}/);
  const parsed = m ? jparse(m[0], null) : null;
  if (!parsed) return { fail: { reason: 'cooling', until: Date.now() + 60000, note: 'Returned an answer that could not be read. Trying another model.' } };
  return { parsed };
}

// ---------- automatic model selection ----------
// Providers retire model names often. When a model is refused, list the provider's current models,
// pick the best free-friendly one, remember it for 7 days and carry on.
const BAD = /(embed|whisper|tts|audio|speech|image|imagen|veo|vision-only|guard|safeguard|orpheus|playai|distil|live|aqa|learnlm|robotics|computer-use|native-audio|transcri|moderation|rerank|compound|allam)/i;
const PREFS = [/gpt-oss-120b/i, /llama-4-maverick/i, /llama.*70b/i, /qwen.*(235b|32b|30b|27b)/i, /deepseek/i, /kimi/i, /glm/i, /llama-4-scout/i, /gemma.*(27b|31b)/i, /gpt-oss-20b/i, /mistral/i, /qwen/i, /gemma/i, /llama.*(8b|instant)/i, /llama/i];
function rankGemini(names) {
  const score = (n) => {
    const v = Number((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
    const tier = /flash-lite/.test(n) ? 2 : /flash/.test(n) ? 3 : /pro/.test(n) ? 1 : 0;
    const unstable = /preview|exp|experimental|\d{2}-\d{2}/.test(n) ? 0.5 : 0;
    const alias = /latest/.test(n) ? 0.2 : 0;
    return tier * 1000 + v * 10 - unstable - alias;
  };
  return names.filter((n) => /^gemini-/.test(n) && !BAD.test(n)).sort((a, b) => score(b) - score(a));
}
function rankGeneric(ids) {
  const ok = ids.filter((n) => !BAD.test(n));
  const idx = (n) => { const k = PREFS.findIndex((re) => re.test(n)); return k < 0 ? 99 : k; };
  return ok.sort((a, b) => idx(a) - idx(b));
}
async function listModels(p) {
  try {
    if (p.kind === 'gemini') {
      const r = await fetchWithTimeout(`${p.base}/models?pageSize=300`, { headers: { 'x-goog-api-key': p.key } }, 15000);
      const j = await r.json().catch(() => ({}));
      return (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => String(m.name || '').replace(/^models\//, ''));
    }
    const headers = p.kind === 'anthropic' ? { 'x-api-key': p.key, 'anthropic-version': '2023-06-01' } : { Authorization: `Bearer ${p.key}` };
    const r = await fetchWithTimeout(`${p.base}/models`, { headers }, 15000);
    const j = await r.json().catch(() => ({}));
    let ids = (j.data || j.models || []).filter((m) => m && m.active !== false).map((m) => m.id || m.name).filter(Boolean);
    if (p.id === 'openrouter') ids = ids.filter((x) => /:free$/.test(x));
    return ids;
  } catch (e) { return []; }
}
async function discoverModel(p, failed, errText) {
  const all = await listModels(p);
  if (!all.length) return null;
  const tried = new Set([].concat(failed || []));
  // The error message sometimes names the replacement ("use models/gemini-3.6-flash")
  const hint = (String(errText || '').match(/models\/([a-z0-9][\w.-]+)/i) || [])[1];
  if (hint && all.includes(hint) && !tried.has(hint)) return hint;
  const ranked = p.kind === 'gemini' ? rankGemini(all) : p.kind === 'anthropic' ? all.filter((n) => /haiku/.test(n)).sort().reverse() : rankGeneric(all);
  return ranked.find((m) => !tried.has(m)) || null;
}
async function applySavedModels(list) {
  if (!list.length) return list;
  const rows = await redis(...list.map((p) => ['GET', modelKey(p.id)]));
  list.forEach((p, k) => { const m = jparse(rows[k]); if (m && m.model && m.from === p.model) { p.configured = p.model; p.model = m.model; p.auto = true; } });
  return list;
}
async function callWithModelFix(p, system, user) {
  let out = await callOnce(p, system, user);
  const failed = [p.model];
  for (let n = 0; n < 3 && out.fail && out.fail.model; n++) {
    const next = await discoverModel(p, failed, out.fail.raw);
    if (!next) break;
    const from = p.configured || p.model;
    await redis(['SET', modelKey(p.id), JSON.stringify({ model: next, from, at: Date.now() }), 'EX', 7 * 86400]);
    p.configured = from; p.model = next; p.auto = true; failed.push(next);
    out = await callOnce(p, system, user);
  }
  return out;
}

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
/** Try each available provider in order. Parks the ones that fail and moves on. */
async function callChain(list, system, user) {
  const deadline = Date.now() + 90000;
  const tried = new Set();
  for (;;) {
    const status = await loadStatus(list);
    const ready = list.filter((p, k) => status[k].ready && !tried.has(p.id));
    if (!ready.length) {
      const waits = status.filter((s) => !s.ready).map((s) => s.until).filter(Boolean);
      const soon = waits.length ? Math.min(...waits) : Date.now() + 60000;
      // Only a short wait? Wait here and try again; otherwise tell the browser when to come back.
      if (soon - Date.now() <= 20000 && soon + 30000 < deadline) { await sleep(Math.max(500, soon - Date.now() + 300)); tried.clear(); continue; }
      const err = new Error('All AI models are busy or at their free limit.'); err.status = 429; err.allBusy = true; err.retryAt = soon; err.providers = status; throw err;
    }
    for (const p of ready) {
      tried.add(p.id);
      const out = await callWithModelFix(p, system, user);
      if (out.parsed) {
        const [used] = await redis(['INCR', useKey(p)]);
        if (used === 1) await redis(['EXPIRE', useKey(p), 3 * 86400]);
        return { parsed: out.parsed, p };
      }
      await park(p, out.fail.reason, out.fail.until, out.fail.note);
      if (Date.now() > deadline) break;
    }
    if (Date.now() > deadline) { const status2 = await loadStatus(list); const err = new Error('AI models did not answer in time.'); err.status = 429; err.allBusy = true; err.retryAt = Date.now() + 60000; err.providers = status2; throw err; }
  }
}

const CONTEXT = `The websites belong to car-care businesses: auto detailing, ceramic coating, paint protection film (PPF), window tint, wraps and similar. They are built from shared templates by the marketing agency ${AGENCIES.join(' / ')}, so a common, costly mistake is content left over from a PREVIOUS client: another shop's name or another city.
NOT other businesses: car makes/models (BMW, Tesla Model 3), product and film brands (Ceramic Pro, XPEL, SunTek, 3M, Llumar, Gtechniq, Gyeon, IGL, Meguiar's, Chemical Guys, Koch-Chemie), certifications and associations (IDA, IDA Certified Detailer), platforms (Google, Yelp, Facebook, Instagram), booking/payment tools (Urable, Square), the agency itself (${AGENCIES.join(', ')}), customer/reviewer names, dealerships named as places cars came from, and generic phrases.`;

const ALT_SYSTEM = `You review image ALT TEXT. ${CONTEXT}
Classify each alt text into exactly one verdict:
- "describes_image": describes the photo (cars, people, work being done, a building, a product). Fine even without the business name.
- "this_business": names or clearly refers to THIS business, including abbreviations, LLC/Co. variations, "<name> logo".
- "other_business": presents a DIFFERENT business as if it were this one (e.g. a logo alt with another shop's name, "at Smith's Detailing").
- "wrong_location": claims a city/state that conflicts with this business's location and service-area pages (only when clearly a location claim).
- "placeholder": template, stock or filler text ("stock photo", "placeholder", "image 12", "lorem ipsum", "your logo here").
- "unclear": cannot tell.
Be conservative: only use "other_business" or "wrong_location" when the text clearly names another business or place.
Respond with JSON only: {"results":[{"i":<number>,"verdict":"<verdict>","confidence":<0..1>,"reason":"<max 20 words>","suggestion":"<better alt text, only for other_business/wrong_location/placeholder, else empty>"}]}`;

const TEXT_SYSTEM = `You proofread WEBSITE TEXT for one business and report ONLY real problems about its business name and location. ${CONTEXT}
Report these problem types:
- "other_business": the text names a different business as if it were this one ("here at Smith's Detailing", "call Joe's Auto Spa today", "© 2023 Shine Pros LLC"). Usually leftover from a previous client.
- "wrong_location": the text says this business is in, or serves, a city/state that conflicts with its location. Its own city, nearby towns in the same metro/state, and places that have their own service-area page on this site are fine. Be conservative; mentions of where a customer or car came from are fine.
- "name_variant": this business's own name written in a clearly different way (different or missing words, e.g. "Upscale Detailing Co" vs "Upscale Detail Co."). Ignore capitalization, punctuation, "&" vs "and", and adding/removing LLC/Inc/Co.
Do not report spelling, grammar, style or anything else. Most blocks have no problem: return nothing for them.
Respond with JSON only: {"results":[{"i":<block number>,"type":"<type>","quote":"<the exact words from the block, max 15 words>","confidence":<0..1>,"reason":"<max 20 words>","suggestion":"<corrected wording>"}]}. Use {"results":[]} if there are no problems.`;

function businessHeader(b) {
  b = b || {};
  return `THIS BUSINESS
Name: ${b.name || 'unknown'}${b.names && b.names.length > 1 ? ` (also: ${b.names.slice(1).join(', ')})` : ''}
Location: ${[b.street, b.city, b.region, b.zip].filter(Boolean).join(', ') || 'unknown'}
Service-area / location pages on the site: ${(b.areaPages || []).slice(0, 40).join(', ') || 'none found'}
${b.foreignNames && b.foreignNames.length ? `Names already found on this site that belong to another business: ${b.foreignNames.slice(0, 10).join(', ')}\n` : ''}`;
}
const altPrompt = (b, items) => `${businessHeader(b)}
ALT TEXTS (i | where | logo? | alt text | image file)
${items.map((x) => `${x.i} | ${x.location || 'Body'} | ${x.isLogo ? 'logo' : '-'} | ${String(x.alt).replace(/\s+/g, ' ').slice(0, 300)} | ${String(x.file || '').slice(0, 80)}`).join('\n')}`;
const textPrompt = (b, items) => `${businessHeader(b)}
TEXT BLOCKS (each starts with [i] then where it appears)
${items.map((x) => `[${x.i}] (${x.location || 'Body'} · ${x.page || '/'}) ${String(x.text).replace(/\s+/g, ' ').slice(0, 1500)}`).join('\n')}`;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const me = await requireUser(req, res);
  if (!me) return;
  const list = await applySavedModels(providers()).catch(() => providers());
  if (req.method === 'POST' && readBody(req).op === 'test') {
    // Clear resting states and send a tiny request to each model (1 request each)
    const only = readBody(req).id;
    const out = [];
    for (const p of list.filter((x) => !only || x.id === only)) {
      await redis(['DEL', stateKey(p.id)]);
      const r = await callWithModelFix(p, 'You are a health check. Reply with JSON only.', 'Reply exactly {"ok":true}');
      if (r.parsed) { const [u] = await redis(['INCR', useKey(p)]); if (u === 1) await redis(['EXPIRE', useKey(p), 3 * 86400]); out.push({ id: p.id, ok: true, model: p.model }); }
      else { await park(p, r.fail.reason, r.fail.until, r.fail.note); out.push({ id: p.id, ok: false, note: r.fail.note }); }
    }
    return res.status(200).json({ tested: out, providers: await loadStatus(list), now: Date.now(), enabled: list.length > 0 });
  }
  if (req.method === 'GET') {
    const st = await loadStatus(list).catch(() => []);
    const first = st.find((x) => x.ready) || st[0];
    return res.status(200).json({ enabled: list.length > 0, providers: st, provider: first ? first.label : '', model: first ? first.model : '', free: list.length > 0 && list.every((p) => p.free), now: Date.now() });
  }
  if (!list.length) return res.status(400).json({ error: 'AI is not set up. Add a free GEMINI_API_KEY or GROQ_API_KEY in Vercel.' });
  try {
    let pvUsed = null;
    const b = readBody(req);
    if (!['alt', 'text'].includes(b.op)) return res.status(400).json({ error: 'Unknown op' });
    const business = b.business || {};
    const field = b.op === 'alt' ? 'alt' : 'text';
    const items = [].concat(b.items || []).slice(0, 60).filter((x) => x && typeof x[field] === 'string' && x[field].trim());
    if (!items.length) return res.status(200).json({ results: [] });

    // Cache per business + item, so the same alt text / paragraph is never paid for twice
    const keyOf = (x) => P + 'ai:' + b.op + ':' + sha([business.name, business.city, business.region, (business.areaPages || []).length, x[field], x.isLogo ? 1 : 0].join('|'));
    const cached = await redis(...items.map((x) => ['GET', keyOf(x)]));
    const results = []; const todo = [];
    items.forEach((x, k) => {
      const c = jparse(cached[k]);
      if (!c) return todo.push(x);
      if (b.op === 'alt') results.push(Object.assign({}, c, { i: x.i, cached: true }));
      else (c.issues || []).forEach((iss) => results.push(Object.assign({}, iss, { i: x.i, cached: true })));
      if (b.op === 'text') results.push({ i: x.i, cachedOnly: true });
    });

    if (todo.length) {
      const day = new Date().toISOString().slice(0, 10);
      const [used] = await redis(['INCRBY', P + 'ai:used:' + day, todo.length]);
      if (used === todo.length) await redis(['EXPIRE', P + 'ai:used:' + day, 172800]);
      if (used > DAILY_LIMIT) return res.status(429).json({ error: `Daily AI limit reached (${DAILY_LIMIT} items). Raise AI_DAILY_LIMIT in Vercel if needed.`, results });
      const { parsed, p: used_p } = await callChain(list, b.op === 'alt' ? ALT_SYSTEM : TEXT_SYSTEM, b.op === 'alt' ? altPrompt(business, todo) : textPrompt(business, todo));
      pvUsed = used_p;
      const clean = (parsed.results || []).filter((x) => x && Number.isFinite(Number(x.i)) && todo.some((t) => t.i === Number(x.i)));
      const cmds = [];
      if (b.op === 'alt') {
        clean.filter((x) => ALT_VERDICTS.includes(x.verdict)).forEach((x) => {
          const r = { i: Number(x.i), verdict: x.verdict, confidence: Math.max(0, Math.min(1, Number(x.confidence) || 0)), reason: String(x.reason || '').slice(0, 200), suggestion: String(x.suggestion || '').slice(0, 200) };
          results.push(r);
          const t = todo.find((y) => y.i === r.i);
          cmds.push(['SET', keyOf(t), JSON.stringify({ verdict: r.verdict, confidence: r.confidence, reason: r.reason, suggestion: r.suggestion }), 'EX', 5184000]);
        });
      } else {
        const byI = new Map(todo.map((t) => [t.i, []]));
        clean.filter((x) => TEXT_TYPES.includes(x.type)).forEach((x) => {
          const r = { i: Number(x.i), type: x.type, quote: String(x.quote || '').slice(0, 200), confidence: Math.max(0, Math.min(1, Number(x.confidence) || 0)), reason: String(x.reason || '').slice(0, 200), suggestion: String(x.suggestion || '').slice(0, 300) };
          results.push(r); byI.get(r.i).push(r);
        });
        // Cache every block, including the ones with no problems
        byI.forEach((issues, i) => { const t = todo.find((y) => y.i === i); cmds.push(['SET', keyOf(t), JSON.stringify({ issues: issues.map(({ i: _i, ...rest }) => rest) }), 'EX', 5184000]); });
      }
      if (cmds.length) await redis(...cmds);
    }
    return res.status(200).json({ results: results.filter((r) => !r.cachedOnly), cachedCount: items.length - todo.length,
      provider: pvUsed ? pvUsed.label : '', model: pvUsed ? pvUsed.model : '', providers: await loadStatus(list).catch(() => []), now: Date.now() });
  } catch (e) {
    if (e.allBusy) return res.status(429).json({ error: String(e.message), allBusy: true, retryAt: e.retryAt, providers: e.providers, now: Date.now() });
    return res.status(e.status === 429 ? 429 : 500).json({ error: String(e.message || e) });
  }
}
export const _test = { applySavedModels, classify, nextMidnight, parseDuration, callChain, providers, loadStatus, dayKey };
