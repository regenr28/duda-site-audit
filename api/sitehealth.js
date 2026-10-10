// Site health for one live website: Google's Lighthouse scores (Performance, Accessibility, Best
// practices, SEO), the page-speed numbers behind them, and what to fix first — on mobile and desktop.
//
// GET  /api/sitehealth?site=<duda id>          → the latest checks (and the ones before, for the trend)
// POST /api/sitehealth { op:'run', site }       → check it now (about a minute; one at a time per site)
//
// Lighthouse runs on Google's side through the PageSpeed Insights API, so nothing heavy runs here.
// It works without a key at a low shared limit; PAGESPEED_API_KEY (a free Google API key) lifts it.
// Only published websites can be checked: Google has to be able to open the page like a visitor.
import { redis, P, requireUser, readBody, jparse, can, fetchWithTimeout, unpackJSON } from './_lib.js';

const KEEP = 8;
const key = (id) => P + 'psi:' + id;
const okId = (id) => /^[A-Za-z0-9_-]{4,64}$/.test(String(id || ''));
const CATS = ['performance', 'accessibility', 'best-practices', 'seo'];
const VITALS = [
  ['largest-contentful-paint', 'lcp'], ['cumulative-layout-shift', 'cls'], ['total-blocking-time', 'tbt'],
  ['first-contentful-paint', 'fcp'], ['speed-index', 'si'],
];

/** The live address of a website, from the Duda list: its own domain, else its Duda address. */
async function liveUrl(id) {
  const [raw] = await redis(['GET', P + 'dudasites']);
  const list = unpackJSON(raw);
  const x = ((list && list.sites) || []).find((s) => String(s.id).toLowerCase() === String(id).toLowerCase());
  if (!x) return null;
  const host = x.domain || x.defaultDomain;
  return host ? `https://${host}/` : null;
}

/** One Lighthouse run, cut down to what the page shows (a full report is several megabytes). */
async function lighthouse(url, strategy) {
  const base = process.env.PAGESPEED_BASE || 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
  const q = new URLSearchParams({ url, strategy });
  CATS.forEach((c) => q.append('category', c.toUpperCase().replace('-', '_')));
  if (process.env.PAGESPEED_API_KEY) q.set('key', process.env.PAGESPEED_API_KEY);
  const r = await fetchWithTimeout(`${base}?${q}`, { headers: { Accept: 'application/json' } }, 100000);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (j.error && j.error.message) || `HTTP ${r.status}`;
    throw new Error(r.status === 429 ? 'Google is limiting how many checks can run right now. Try again in a few minutes.' : /FAILED_DOCUMENT_REQUEST|ERRORED_DOCUMENT_REQUEST|NO_FCP|DNS/i.test(msg) ? 'Google could not open the website (it may be down or blocking checks).' : 'The check could not run: ' + msg.slice(0, 160));
  }
  const lh = j.lighthouseResult || {};
  const audits = lh.audits || {};
  const scores = {}; CATS.forEach((c) => { const s = lh.categories && lh.categories[c]; scores[c] = s && s.score !== null && s.score !== undefined ? Math.round(s.score * 100) : null; });
  const vitals = {}; VITALS.forEach(([a, k]) => { const x = audits[a]; if (x && x.numericValue !== undefined) vitals[k] = { v: x.numericValue, txt: x.displayValue || '', score: x.score }; });
  // Real visitors' experience (Chrome's field data), when Google has enough of it for this page.
  const field = {}; const m = (j.loadingExperience && j.loadingExperience.metrics) || {};
  [['LARGEST_CONTENTFUL_PAINT_MS', 'lcp'], ['INTERACTION_TO_NEXT_PAINT', 'inp'], ['CUMULATIVE_LAYOUT_SHIFT_SCORE', 'cls']].forEach(([a, k]) => { if (m[a]) field[k] = { p: m[a].percentile, cat: m[a].category }; });
  // What to fix first: the biggest time savings, then the checks that failed, per category.
  const refs = {}; CATS.forEach((c) => ((lh.categories && lh.categories[c] && lh.categories[c].auditRefs) || []).forEach((r2) => { if (!refs[r2.id]) refs[r2.id] = c; }));
  const opps = Object.entries(audits).filter(([, a]) => a.details && a.details.type === 'opportunity' && (a.details.overallSavingsMs || 0) > 100)
    .map(([id, a]) => ({ id, t: a.title, ms: Math.round(a.details.overallSavingsMs) })).sort((a, b) => b.ms - a.ms).slice(0, 6);
  const fails = Object.entries(audits).filter(([id, a]) => refs[id] && refs[id] !== 'performance' && a.score !== null && a.score < 0.9 && a.scoreDisplayMode === 'binary')
    .map(([id, a]) => ({ id, t: a.title, c: refs[id] })).slice(0, 12);
  return { scores, vitals, field, opps, fails, final: String(lh.finalDisplayedUrl || lh.finalUrl || url).slice(0, 300) };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const me = await requireUser(req, res);
  if (!me) return;
  if (!(await can(me, 'analytics.view')) && !(await can(me, 'analytics.manage'))) return res.status(403).json({ error: 'Your role does not include website health.' });
  try {
    const id = String((req.method === 'GET' ? req.query.site : (readBody(req) || {}).site) || '');
    if (!okId(id)) return res.status(400).json({ error: 'Unknown website' });
    const [raw, lock] = await redis(['GET', key(id)], ['GET', key(id) + ':run']);
    const data = jparse(raw) || { runs: [] };
    if (req.method === 'GET') return res.status(200).json(Object.assign(data, { running: !!lock, keyed: !!process.env.PAGESPEED_API_KEY }));
    const b = readBody(req) || {};
    if (b.op !== 'run') return res.status(400).json({ error: 'Unknown op' });
    const url = await liveUrl(id);
    if (!url) return res.status(400).json({ error: 'This website is not published, so there is nothing live for Google to check yet.' });
    const [got] = await redis(['SET', key(id) + ':run', me.email, 'NX', 'EX', 180]);
    if (got !== 'OK') return res.status(200).json(Object.assign(data, { running: true }));
    try {
      const [mob, desk] = await Promise.allSettled([lighthouse(url, 'mobile'), lighthouse(url, 'desktop')]);
      if (mob.status === 'rejected' && desk.status === 'rejected') throw mob.reason;
      const run = { at: new Date().toISOString(), url, by: me.name, mobile: mob.status === 'fulfilled' ? mob.value : { error: String(mob.reason.message) }, desktop: desk.status === 'fulfilled' ? desk.value : { error: String(desk.reason.message) } };
      data.runs = [run].concat(data.runs || []).slice(0, KEEP);
      // History keeps only the scores of older runs; the details of the latest are what matter.
      data.runs = data.runs.map((r2, i) => (i === 0 ? r2 : { at: r2.at, url: r2.url, by: r2.by, mobile: { scores: (r2.mobile || {}).scores }, desktop: { scores: (r2.desktop || {}).scores } }));
      await redis(['SET', key(id), JSON.stringify(data)], ['DEL', key(id) + ':run']);
      return res.status(200).json(Object.assign(data, { running: false }));
    } catch (e) {
      await redis(['DEL', key(id) + ':run']).catch(() => {});
      return res.status(502).json({ error: String(e.message || e) });
    }
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
