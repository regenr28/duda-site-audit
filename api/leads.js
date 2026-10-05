// Form submissions, for the TEAM. The client's own view is api/client.js — a different endpoint
// with a different authorisation check, deliberately not this one with a flag.
//
// GET  /api/leads?op=list&id=<siteId>[&months=12][&page=&form=&source=]
// GET  /api/leads?op=summary&ids=a,b,c      → the small counts the Audits list shows
// POST /api/leads { op: 'backfill', id, months }   (admins) → pull history from Duda
// POST /api/leads { op: 'census' }                 (admins) → count submissions per site, store nothing
import { redis, P, requireUser, readBody, fetchWithTimeout, jparse, globalLog, unpackJSON, can, denyUnless } from './_lib.js';
import { addLeads, normalise, readFields, readLeads, groupLeads, monthlySeries, whenSeries, getSummary, getSummaries, compactOldMonths, bumpSummary, tidySite } from './_leads.js';
import { takeLock, unlock, enqueue } from './_queue.js';

const DUDA = process.env.DUDA_API_BASE || 'https://api.duda.co/api';

async function duda(path) {
  const user = process.env.DUDA_API_USERNAME, pass = process.env.DUDA_API_PASSWORD;
  if (!user || !pass) throw new Error('Duda API access is not set up yet. Please contact the app owner.');
  const r = await fetchWithTimeout(DUDA + path, { headers: { Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'), Accept: 'application/json' } }, 25000);
  const text = await r.text();
  if (!r.ok) throw new Error(`Duda API ${r.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

/**
 * Duda's form submissions for one website, as rows we can store.
 *
 * Duda doesn't publish the response schema for this endpoint, so every field is read defensively
 * and anything missing simply stays empty rather than throwing the whole backfill away.
 */
export function fromDuda(rows) {
  return [].concat(rows || []).map((r) => {
    // Duda's history endpoint documents four fields — date, form_title, message, utm_campaign — with
    // the answers in `message`. Older shapes are still read; the row itself is the last resort.
    const msg = r.message;
    const fields = typeof msg === 'string' && msg.trim() ? [{ label: 'Message', value: msg.trim() }]
      : readFields((msg && typeof msg === 'object' ? msg : null) || r.data || r.fields || r.form_data || r.fieldsData || r.submission_data || r);
    const utm = r.utm_source || (r.utm && r.utm.source) || '';
    const med = r.utm_medium || (r.utm && r.utm.medium) || '';
    return normalise({
      id: r.id || r.uuid || r.submission_id,
      at: r.date || r.created_at || r.submission_date || r.time,
      fields,
      // Duda does not say which page in this endpoint. Left blank rather than guessed.
      page: r.page_name || r.pageName || r.page || '',
      form: r.form_title || r.form_name || r.formName || r.form || '',
      campaign: r.utm_campaign || (r.utm && r.utm.campaign) || '',
      source: [utm, med].filter(Boolean).join('/'),
    }, 'duda');
  }).filter((x) => x.n || x.e || x.p || Object.keys(x.f).length);
}

/** A month window of Duda's history for one site — bounded responses, resumable, no paging guesswork. */
export async function pullMonth(siteId, ym) {
  const from = ym + '-01';
  const d = new Date(ym + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1);
  const to = d.toISOString().slice(0, 10);
  const j = await duda(`/sites/multiscreen/get-forms/${encodeURIComponent(siteId)}?from=${from}&to=${to}`);
  return fromDuda(Array.isArray(j) ? j : (j.results || j.submissions || j.data || []));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const me = await requireUser(req, res);
  if (!me) return;
  try {
    if (req.method === 'GET') {
      const op = req.query.op || 'list';
      if (op === 'summary') {
        const ids = String(req.query.ids || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 400);
        return res.status(200).json({ summaries: await getSummaries(ids) });
      }
      const id = String(req.query.id || '');
      if (!id) return res.status(400).json({ error: 'Which website?' });
      const months = Math.min(Math.max(Number(req.query.months) || 12, 1), 24);
      let leads = await readLeads(id, months);
      const f = { page: req.query.page || '', form: req.query.form || '', source: req.query.source || '' };
      const all = leads;
      if (f.page) leads = leads.filter((l) => l.pg === f.page);
      if (f.form) leads = leads.filter((l) => l.fm === f.form);
      if (f.source) leads = leads.filter((l) => l.src === f.source);
      // Without leads.contacts a teammate sees that an enquiry arrived, from which page and which
      // source, but not the customer's name, email or phone. The redaction happens here, on the way
      // out — not in the page, where a template could forget.
      const full = await can(me, 'leads.contacts');
      const shape = (l) => (full ? l : Object.assign({}, l, { n: '', e: '', p: '', redacted: true }));
      return res.status(200).json({
        contacts: full,
        leads: leads.slice(0, 500).map(shape), shown: Math.min(leads.length, 500), matched: leads.length, total: all.length,
        groups: groupLeads(all), series: monthlySeries(all, months), when: whenSeries(all), summary: await getSummary(id),
      });
    }

    const b = readBody(req);
    if (await denyUnless(res, me, 'leads.import', 'Your role does not allow importing submission history.')) return;

    if (b.op === 'backfill') {
      const id = String(b.id || '');
      if (!id) return res.status(400).json({ error: 'Which website?' });
      const months = Math.min(Math.max(Number(b.months) || 12, 1), 24);
      const d = new Date(); const done = []; let added = 0; let seen = 0; const failed = [];
      // "Added" means new enquiries. A repair rewrites rows it already had, and counting those made
      // a second import of the same history announce itself as hundreds of new submissions.
      const before = Number((await getSummary(id).catch(() => ({}))).total || 0);
      for (let i = 0; i < months; i++) {
        const ym = d.toISOString().slice(0, 7);
        // Importing repairs as well as adds. Duda keeps the original of every submission, so asking
        // for the history again is the way anything we once read wrongly gets put right — a person's
        // own verdict on an enquiry is the one thing it leaves alone.
        try { const rows = await pullMonth(id, ym); seen += rows.length; added += await addLeads(id, rows, { repair: true }); done.push({ m: ym, n: rows.length }); }
        catch (e) { failed.push({ m: ym, error: String(e.message || e).slice(0, 160) }); }
        d.setUTCMonth(d.getUTCMonth() - 1);
        // Duda allows 300 form-submission calls a minute; one every 150ms stays well inside it.
        await new Promise((r2) => setTimeout(r2, 150));
      }
      await compactOldMonths(id);
      // Merge anything this import matched only by content, and clear pages we used to invent.
      const merged = await tidySite(id).catch(() => 0);
      const summary = await bumpSummary(id);
      added = Math.max(0, Number(summary.total || 0) - before);
      await globalLog(me, 'leads-backfill', `imported ${added} form submissions for ${id} (${months} months)`);
      return res.status(200).json({ added, merged, months: done, failed, summary });
    }

    /**
     * Pull submissions for a handful of websites at a time.
     *
     * The browser drives the loop across the whole list, a few sites per request, exactly the way a
     * scan queue works: nothing here can run long enough to be cut off, a failure costs one chunk
     * rather than the run, and closing the tab stops it cleanly instead of leaving a half-done job.
     */
    if (b.op === 'fetch') {
      const ids = [].concat(b.ids || []).map((x) => String(x).slice(0, 64)).filter(Boolean).slice(0, 25);
      if (!ids.length) return res.status(400).json({ error: 'Which websites?' });
      const months = Math.min(Math.max(Number(b.months) || 3, 1), 24);
      // The background queue asks Duda the same questions, so the two share one lock. Rather than a
      // status code, say what is happening and roughly how long it will be: the answer to "why can't
      // I press this" is almost never a number.
      if (!(await takeLock())) {
        return res.status(503).json({
          error: 'Form submissions are being fetched right now — the app does this a few websites at a time so it never overloads. Please try again in about 45 seconds.',
          busy: true, retryAfter: 45,
        });
      }
      const out = []; const failed = [];
      try {
      for (const siteId of ids) {
        const d = new Date(); let added = 0; let seen = 0; let err = '';
        for (let i = 0; i < months; i++) {
          const ym = d.toISOString().slice(0, 7);
          try { const rows = await pullMonth(siteId, ym); seen += rows.length; added += await addLeads(siteId, rows); }
          catch (e) { err = String(e.message || e).slice(0, 120); break; }
          d.setUTCMonth(d.getUTCMonth() - 1);
          // Duda allows 300 form-submission calls a minute; one every 150ms stays well inside it.
          await new Promise((r2) => setTimeout(r2, 150));
        }
        if (err) { failed.push({ id: siteId, error: err }); continue; }
        await compactOldMonths(siteId).catch(() => {});
        await tidySite(siteId).catch(() => 0);
        const summary = await bumpSummary(siteId);
        out.push({ id: siteId, seen, added, total: summary.total, last: summary.last });
      }
      } finally { await unlock(); }
      return res.status(200).json({ done: out, failed });
    }

    if (b.op === 'census') {
      // Counts only. Nothing is stored — this exists to answer "how many are there really?"
      const [idx] = await redis(['HGETALL', P + 'index']);
      const ids = Object.keys(idx || {}).slice(0, 900);
      const ym = new Date().toISOString().slice(0, 7);
      const out = []; const failed = [];
      for (const id of ids) {
        const site = unpackJSON(idx[id]) || jparse(idx[id]) || {};
        try { const rows = await pullMonth(site.siteId || id, ym); out.push({ id, name: site.businessName || '', n: rows.length }); }
        catch (e) { failed.push({ id, error: String(e.message || e).slice(0, 120) }); }
        await new Promise((r2) => setTimeout(r2, 150));
      }
      out.sort((a, b2) => b2.n - a.n);
      const total = out.reduce((a, x) => a + x.n, 0);
      return res.status(200).json({ month: ym, sites: out.length, total, mean: out.length ? +(total / out.length).toFixed(1) : 0, top: out.slice(0, 40), failed: failed.slice(0, 20) });
    }

    return res.status(400).json({ error: 'Unknown operation' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e).slice(0, 300) });
  }
}
