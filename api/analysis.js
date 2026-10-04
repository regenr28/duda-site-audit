// Lead analysis: what the enquiries say once there are enough of them to ask.
//
// GET  /api/analysis?op=overview                → is it connected, and how much is in it
// GET  /api/analysis?op=quiet                   → websites whose forms have gone quiet
// GET  /api/analysis?op=marketing&id=<siteId>   → which sources and pages produce work
// GET  /api/analysis?op=benchmarks              → what the busy websites do differently
// GET  /api/analysis?op=junk&id=<siteId>        → what was set aside, and why
// POST /api/analysis { op: 'migrate' }          → copy the key-value leads into SQL
// POST /api/analysis { op: 'verdict', id, verdict, teach… }  → a person disagreeing
// POST /api/analysis { op: 'judge', limit }     → ask the AI about what the rules could not settle
import { requireUser, readBody, redis, P, can, denyUnless, globalLog, jparse } from './_lib.js';
import { sqlReady, ensureSchema, rows, sql } from './_sql.js';
import { quietSites, marketingFor, benchmarks, leadsFor, setVerdict, unsureLeads, rejudge, addLeadsSql, rebuildDays } from './_leadsql.js';
import { readLeads } from './_leads.js';
import { JUDGE_SYSTEM, readJudgement } from './_judge.js';
import { askAI } from './ai.js';

const NOT_READY = { error: 'The analysis database is not connected yet. Enquiries are still being stored, and everything here will fill in once it is set up.' };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const me = await requireUser(req, res);
  if (!me) return;
  try {
    if (!(await can(me, 'leads.view'))) return res.status(403).json({ error: 'Your role does not allow seeing form submissions.' });

    if (req.method === 'GET') {
      const op = req.query.op || 'overview';
      if (!sqlReady()) return res.status(200).json({ ready: false, ...NOT_READY });
      const months = Math.min(Math.max(Number(req.query.months) || 12, 1), 36);

      if (op === 'overview') {
        await ensureSchema();
        const [tot] = await rows(`SELECT COUNT(*) AS total, COUNT(DISTINCT site) AS sites,
          SUM(CASE WHEN verdict = 'junk' THEN 1 ELSE 0 END) AS junk,
          SUM(CASE WHEN verdict = 'unsure' THEN 1 ELSE 0 END) AS unsure,
          MIN(at) AS oldest, MAX(at) AS newest FROM leads`);
        return res.status(200).json({ ready: true, ...tot });
      }
      if (op === 'quiet') {
        const list = await quietSites({ since: Math.min(Math.max(Number(req.query.since) || 21, 7), 120) });
        // Names come from the audit index, so the answer reads as websites rather than site ids.
        const [idx] = await redis(['HGETALL', P + 'index']);
        const byDuda = {};
        const flat = {};
        if (Array.isArray(idx)) { for (let i = 0; i < idx.length; i += 2) flat[idx[i]] = idx[i + 1]; }
        else if (idx && typeof idx === 'object') Object.assign(flat, idx);
        Object.values(flat).forEach((v) => { const s = typeof v === 'string' ? jparse(v) : v; if (s && s.siteId) byDuda[s.siteId] = s; });
        return res.status(200).json({ ready: true, sites: list.map((r) => Object.assign({}, r, {
          name: (byDuda[r.site] || {}).businessName || r.site,
          auditId: (byDuda[r.site] || {}).id || '',
        })) });
      }
      if (op === 'marketing') {
        const id = String(req.query.id || '');
        if (!id) return res.status(400).json({ error: 'Which website?' });
        return res.status(200).json({ ready: true, ...(await marketingFor(id, months)) });
      }
      if (op === 'benchmarks') return res.status(200).json({ ready: true, ...(await benchmarks({ months })) });
      if (op === 'junk') {
        const id = String(req.query.id || '');
        if (!id) return res.status(400).json({ error: 'Which website?' });
        const d = await leadsFor(id, { months, verdict: 'junk', limit: 200 });
        return res.status(200).json({ ready: true, leads: d.leads, counts: d.counts });
      }
      return res.status(400).json({ error: 'Unknown operation' });
    }

    const b = readBody(req);
    if (b.op === 'verdict') {
      if (await denyUnless(res, me, 'item.status', 'Your role does not allow changing an enquiry’s verdict.')) return;
      if (!sqlReady()) return res.status(400).json(NOT_READY);
      const v = b.verdict === 'junk' ? 'junk' : 'real';
      const out = await setVerdict(String(b.id || ''), v, me.name, {
        teachPhrase: b.teachPhrase, teachSender: !!b.teachSender, teachMessage: !!b.teachMessage,
      });
      if (!out) return res.status(404).json({ error: 'No such enquiry' });
      await globalLog(me, 'lead-verdict', `marked an enquiry on ${out.site} as ${v}`);
      return res.status(200).json({ ok: true });
    }
    if (b.op === 'rejudge') {
      if (await denyUnless(res, me, 'leads.import', 'Your role does not allow that.')) return;
      if (!sqlReady()) return res.status(400).json(NOT_READY);
      const n = await rejudge(String(b.id || ''));
      return res.status(200).json({ changed: n });
    }

    if (await denyUnless(res, me, 'leads.import', 'Your role does not allow importing or re-reading enquiries.')) return;
    if (!sqlReady()) return res.status(400).json(NOT_READY);

    /**
     * Copy what the key-value store holds into SQL, a few websites per request.
     *
     * The browser drives the loop, like every other long job here. Nothing is deleted on the way:
     * the old copy stays until somebody is satisfied the new one is right.
     */
    if (b.op === 'migrate') {
      const ids = [].concat(b.ids || []).map(String).filter(Boolean).slice(0, 10);
      if (!ids.length) return res.status(400).json({ error: 'Which websites?' });
      await ensureSchema();
      const done = []; const failed = [];
      for (const siteId of ids) {
        try {
          const leads = await readLeads(siteId, 36);
          const added = await addLeadsSql(siteId, leads);
          done.push({ id: siteId, found: leads.length, added });
        } catch (e) { failed.push({ id: siteId, error: String(e.message || e).slice(0, 140) }); }
      }
      return res.status(200).json({ done, failed });
    }

    /**
     * The AI, for the handful the rules could not settle.
     *
     * Asked in one batch, and never about anything a rule already decided — which is the whole
     * reason the rules come first. The same message sent to forty websites is one question, because
     * they share a fingerprint and the answer is written back to all of them.
     */
    if (b.op === 'judge') {
      const limit = Math.min(Math.max(Number(b.limit) || 20, 1), 60);
      const list = await unsureLeads(limit);
      if (!list.length) return res.status(200).json({ asked: 0, decided: 0, left: 0 });
      const numbered = list.map((r, i) => `${i + 1}. ${String(r.body || '').replace(/\s+/g, ' ').slice(0, 400)}`).join('\n');
      let parsed;
      try { parsed = await askAI(JUDGE_SYSTEM, `Sort each of these ${list.length} enquiries.\n\n${numbered}`); }
      catch (e) { return res.status(e.status === 429 ? 429 : 503).json({ error: String(e.message || e).slice(0, 200) }); }
      const stmts = []; let decided = 0;
      [].concat((parsed && parsed.results) || []).forEach((x) => {
        const lead = list[Number(x && x.i) - 1];
        if (!lead) return;
        const j = readJudgement(x.verdict, x.why);
        if (j.verdict === 'unsure') return;
        decided++;
        stmts.push(['UPDATE leads SET verdict = ?, why = ? WHERE id = ? AND decided_by IS NULL', j.verdict, 'AI: ' + j.why, lead.id]);
        // One answer covers every copy of the same message, wherever else it landed.
        if (lead.fp) stmts.push(["UPDATE leads SET verdict = ?, why = ? WHERE fp = ? AND verdict = 'unsure' AND decided_by IS NULL",
          j.verdict, 'AI: the same message was judged on another website', lead.fp]);
      });
      if (stmts.length) await sql(...stmts);
      const sites = [...new Set(list.map((r) => r.site))];
      for (const s of sites) await rebuildDays(s).catch(() => {});
      const [left] = await rows("SELECT COUNT(*) AS n FROM leads WHERE verdict = 'unsure'");
      await globalLog(me, 'lead-judge', `had ${decided} of ${list.length} unclear enquiries sorted`);
      return res.status(200).json({ asked: list.length, decided, left: left.n });
    }

    return res.status(400).json({ error: 'Unknown operation' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e).slice(0, 300) });
  }
}
