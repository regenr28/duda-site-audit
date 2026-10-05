// Projects: the build, from the client's files to the client's comments.
//
// GET  ?op=list                  → every project this person may see
// GET  ?op=one&id=               → one project in full, with its trail
// GET  ?op=meta                  → the phases and fact fields, for the screen
// POST { op:'create' }           → start one (admins and project managers)
// POST { op:'scan' }             → read the Dropbox folder and find the briefs
// POST { op:'read', file }       → read one PDF and offer what it says
// POST { op:'facts' }            → agree the business details (or reset them)
// POST { op:'hand' }             → move it to the next phase, with an owner and a date
// POST { op:'members' }          → who is involved
// POST { op:'link' }             → attach the Duda website / audit
// POST { op:'say' }              → a line in the project's own channel
// POST { op:'remove' }           → delete it
import { requireUser, readBody, denyUnless, can, jparse, now, globalLog, redis, P, notifyUser } from './_lib.js';
import {
  PHASES, PHASE_KEYS, FACT_FIELDS, blankProject, getProject, saveProject, listProjects,
  removeProject, onProject, handOver, checkLate, phaseAt, nextPhase, historyEntry, summary,
} from './_project.js';
import { dropboxReady, cleanLink, listFolder, readFile, likelyBriefs, cacheListing, cachedListing } from './_dropbox.js';
import { readBrief } from './_pdf.js';

/** A project nobody may see is a 404, not a 403 — there is no reason to confirm it exists. */
async function mine(res, me, id) {
  const p = await getProject(String(id || ''));
  if (!p) { res.status(404).json({ error: 'That project is not here.' }); return null; }
  if (!(await can(me, 'project.viewall')) && !onProject(p, me.email)) {
    res.status(404).json({ error: 'That project is not here.' });
    return null;
  }
  return p;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const me = await requireUser(req, res);
  if (!me) return;
  try {
    if (req.method === 'GET') {
      const op = req.query.op || 'list';
      if (op === 'meta') {
        return res.status(200).json({ phases: PHASES, factFields: FACT_FIELDS, dropbox: dropboxReady() });
      }
      if (await denyUnless(res, me, 'project.view', 'Your role does not include projects.')) return;

      if (op === 'one') {
        const p = await mine(res, me, req.query.id);
        if (!p) return;
        const listing = p.dropbox ? await cachedListing(p.id).catch(() => null) : null;
        return res.status(200).json({ project: p, listing, phases: PHASES, factFields: FACT_FIELDS, dropbox: dropboxReady() });
      }

      // Deadlines are noticed when somebody looks, which in a team of six is often enough.
      checkLate(me).catch(() => {});
      const all = await listProjects();
      const seeAll = await can(me, 'project.viewall');
      const list = seeAll ? all : all.filter((s) => (s.members || []).includes(me.email) || s.assignee === me.email || s.createdBy === me.email);
      return res.status(200).json({ projects: list, phases: PHASES, dropbox: dropboxReady(), scoped: !seeAll });
    }

    const b = readBody(req);

    if (b.op === 'create') {
      if (await denyUnless(res, me, 'project.manage', 'Only admins and project managers can start a project.')) return;
      const p = blankProject(me);
      p.name = String(b.name || '').slice(0, 120).trim();
      p.client = String(b.client || '').slice(0, 120).trim();
      p.dropbox = cleanLink(b.dropbox);
      if (b.dropbox && !p.dropbox) return res.status(400).json({ error: 'That does not look like a Dropbox link.' });
      if (!p.name) return res.status(400).json({ error: 'Give the project a name.' });
      p.members = [...new Set([me.email].concat([].concat(b.members || []).map((x) => String(x).toLowerCase())))].slice(0, 30);
      p.assignee = String(b.assignee || me.email).toLowerCase();
      p.due = /^\d{4}-\d{2}-\d{2}$/.test(b.due || '') ? b.due : '';
      p.history = [historyEntry(me, 'created', { to: 'collect', toWho: p.assignee, due: p.due })];
      const s = await saveProject(p);
      await globalLog(me, 'project-add', `started the project ${p.name}`, { projectId: p.id }).catch(() => {});
      if (p.assignee && p.assignee !== me.email) {
        await notifyUser(p.assignee, { kind: 'project-assign', by: me.email, byName: me.name,
          text: `${me.name} started ${p.name} and gave it to you — Data collection${p.due ? `, due ${p.due}` : ''}`, link: `#/project/${p.id}` }).catch(() => {});
      }
      return res.status(200).json({ project: p, summary: s });
    }

    if (await denyUnless(res, me, 'project.view', 'Your role does not include projects.')) return;
    const p = await mine(res, me, b.id);
    if (!p) return;
    const mayEdit = await can(me, 'project.manage');

    switch (b.op) {
      // ---- Dropbox ----
      case 'scan': {
        if (!dropboxReady()) return res.status(400).json({ error: 'Dropbox is not connected yet. Please contact the app owner.' });
        if (!p.dropbox) return res.status(400).json({ error: 'This project has no Dropbox link yet.' });
        const files = await listFolder(p.dropbox);
        const briefs = likelyBriefs(files);
        const data = { files: files.slice(0, 400), count: files.length, briefs: briefs.slice(0, 10) };
        await cacheListing(p.id, data);
        p.history = (p.history || []).concat(historyEntry(me, 'scanned', { n: files.length })).slice(-200);
        await saveProject(p);
        return res.status(200).json(Object.assign({ at: now() }, data));
      }

      case 'read': {
        if (!dropboxReady()) return res.status(400).json({ error: 'Dropbox is not connected yet.' });
        if (!p.dropbox) return res.status(400).json({ error: 'This project has no Dropbox link yet.' });
        const path = String(b.file || '');
        if (!/\.pdf$/i.test(path)) return res.status(400).json({ error: 'Only PDFs can be read.' });
        const buf = await readFile(p.dropbox, path);
        const r = readBrief(buf);
        // Offered, never applied: a reference the whole audit is checked against is agreed by a
        // person, not decided by a parser.
        return res.status(200).json({ file: path, readable: r.readable, why: r.why, found: r.facts, text: r.text.slice(0, 4000) });
      }

      // ---- the agreed facts ----
      case 'facts': {
        if (!mayEdit && p.assignee !== me.email) return res.status(403).json({ error: 'Only whoever holds this project, or an admin, can change the details.' });
        if (b.reset) {
          p.facts = JSON.parse(JSON.stringify(p.factsFrom || {}));
          p.history = (p.history || []).concat(historyEntry(me, 'facts-reset')).slice(-200);
          await saveProject(p);
          return res.status(200).json({ project: p });
        }
        const facts = {};
        FACT_FIELDS.forEach(({ key }) => {
          const v = String((b.facts || {})[key] || '').trim().slice(0, 400);
          if (v) facts[key] = v;
        });
        // The first time facts are accepted from a file, remember what the file said. That is what
        // Reset goes back to — not "empty", which would be a different and less useful promise.
        if (b.from && !Object.keys(p.factsFrom || {}).length) {
          p.factsFrom = JSON.parse(JSON.stringify(facts));
          p.factsFile = String(b.from).slice(0, 300);
        }
        const changed = FACT_FIELDS.filter(({ key }) => (p.facts || {})[key] !== facts[key]).map((f) => f.label);
        p.facts = facts;
        p.history = (p.history || []).concat(historyEntry(me, 'facts', { fields: changed.slice(0, 8), file: b.from ? String(b.from).slice(0, 200) : '' })).slice(-200);
        await saveProject(p);
        return res.status(200).json({ project: p });
      }

      // ---- the workflow ----
      case 'hand': {
        const phase = String(b.phase || nextPhase(p.phase));
        if (!PHASE_KEYS.includes(phase)) return res.status(400).json({ error: 'That is not a phase.' });
        // Anybody holding the project can hand it on — that is what a handover is. Reassigning a
        // project you are not on is a manager's job.
        if (!mayEdit && p.assignee !== me.email) return res.status(403).json({ error: 'Only whoever holds this project, or an admin, can move it on.' });
        if (b.due && !/^\d{4}-\d{2}-\d{2}$/.test(b.due)) return res.status(400).json({ error: 'That date does not look right.' });
        await handOver(p, me, { phase, assignee: String(b.assignee || '').toLowerCase(), due: b.due || '', note: b.note });
        return res.status(200).json({ project: p, summary: summary(p) });
      }

      case 'members': {
        if (!mayEdit) return res.status(403).json({ error: 'Only admins and project managers can change who is involved.' });
        p.members = [...new Set([].concat(b.members || []).map((x) => String(x).toLowerCase()).filter(Boolean))].slice(0, 30);
        if (p.assignee && !p.members.includes(p.assignee)) p.members.push(p.assignee);
        p.history = (p.history || []).concat(historyEntry(me, 'members', { n: p.members.length })).slice(-200);
        await saveProject(p);
        return res.status(200).json({ project: p });
      }

      case 'link': {
        if (!mayEdit && p.assignee !== me.email) return res.status(403).json({ error: 'Only whoever holds this project, or an admin, can link the website.' });
        if (b.dropbox !== undefined) {
          const link = cleanLink(b.dropbox);
          if (b.dropbox && !link) return res.status(400).json({ error: 'That does not look like a Dropbox link.' });
          p.dropbox = link;
        }
        if (b.siteId !== undefined) p.siteId = String(b.siteId || '').slice(0, 64);
        if (b.auditId !== undefined) p.auditId = String(b.auditId || '').slice(0, 64);
        if (b.name) p.name = String(b.name).slice(0, 120);
        if (b.client !== undefined) p.client = String(b.client || '').slice(0, 120);
        p.history = (p.history || []).concat(historyEntry(me, 'linked', { siteId: p.siteId })).slice(-200);
        await saveProject(p);
        return res.status(200).json({ project: p });
      }

      // ---- the project's own channel ----
      case 'say': {
        const text = String(b.text || '').trim().slice(0, 2000);
        if (!text) return res.status(400).json({ error: 'Nothing to say.' });
        p.history = (p.history || []).concat(historyEntry(me, 'note', { note: text })).slice(-200);
        await saveProject(p);
        // Everyone involved hears it, except whoever said it.
        for (const email of (p.members || []).filter((x) => x && x !== me.email)) {
          await notifyUser(email, { kind: 'project-note', by: me.email, byName: me.name,
            text: `${me.name} on ${p.name || 'a project'}: ${text.slice(0, 120)}`, link: `#/project/${p.id}` }).catch(() => {});
        }
        return res.status(200).json({ project: p });
      }

      case 'remove': {
        if (!mayEdit) return res.status(403).json({ error: 'Only admins and project managers can delete a project.' });
        await removeProject(p.id);
        await globalLog(me, 'project-remove', `deleted the project ${p.name}`, { projectId: p.id }).catch(() => {});
        return res.status(200).json({ ok: true });
      }

      default:
        return res.status(400).json({ error: 'Unknown op' });
    }
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e).slice(0, 300) });
  }
}
