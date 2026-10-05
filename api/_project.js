// A project: a website build, from the client's files to the client's comments.
//
// This is NOT an audit. An audit is one scan of one website; a project is the whole build, and it
// outlives any number of audits. They are kept apart deliberately — the audit list stays a list of
// scans, and a project can exist before the website does.
//
// The spine is the phase. A project is always in exactly one, always has somebody holding it, and
// every move from one phase to the next is recorded with who handed it to whom and why. That trail
// is the thing a project manager actually wants on a Monday morning: not "where is it" but "who has
// had it, for how long, and who is late".
import { redis, P, jparse, packJSON, unpackJSON, newId, now, notifyUser, globalLog } from './_lib.js';

const KEY = (id) => P + 'proj:' + id;
const INDEX = () => P + 'projindex';

/**
 * The phases, in the order work really moves.
 *
 * `owner` is the role that normally holds it, used to suggest who to hand it to rather than to
 * enforce anything — a small team swaps hats, and a workflow that refuses to let a dev do QA on a
 * Friday afternoon is a workflow people work around.
 */
export const PHASES = [
  { key: 'collect', label: 'Data collection', owner: 'Project manager', desc: 'Files in, business details agreed.' },
  { key: 'design', label: 'Dev — design', owner: 'Dev', desc: 'Building the website.' },
  { key: 'precheck', label: 'Dev — pre-check', owner: 'Dev', desc: 'The developer audits their own work before handing it on.' },
  { key: 'qa', label: 'QA — design and audit', owner: 'QA', desc: 'Layout, design and a full audit.' },
  { key: 'revisions', label: 'Dev — revisions', owner: 'Dev', desc: 'Fixing what QA found.' },
  { key: 'approval', label: 'QA — approval', owner: 'QA', desc: 'Checking the fixes really landed.' },
  { key: 'cleanup-admin', label: 'Cleanup — admin', owner: 'Admin', desc: 'Final pass before it goes anywhere near the client.' },
  { key: 'cleanup', label: 'Cleanup', owner: 'Admin', desc: 'Last tidy-up.' },
  { key: 'domain', label: 'Domain access', owner: 'Admin', desc: 'Pointing the domain and checking it serves.' },
  { key: 'client', label: 'With the client', owner: 'Admin', desc: 'The client is reviewing and commenting.' },
  { key: 'jaguars', label: 'Jaguars', owner: 'Jaguars', desc: 'Ongoing: the team answering client comments.' },
  { key: 'done', label: 'Finished', owner: '', desc: 'Nothing outstanding.' },
];
export const PHASE_KEYS = PHASES.map((p) => p.key);
export const phaseAt = (key) => PHASES.find((p) => p.key === key) || PHASES[0];
export const phaseIndex = (key) => Math.max(0, PHASE_KEYS.indexOf(key));
/** What normally comes next. Nothing stops a project going backwards — revisions are the normal case. */
export const nextPhase = (key) => PHASE_KEYS[Math.min(PHASE_KEYS.length - 1, phaseIndex(key) + 1)];

/** The fields a website is built from, and what each one is for. */
export const FACT_FIELDS = [
  { key: 'businessName', label: 'Business name' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'address', label: 'Address' },
  { key: 'hours', label: 'Opening hours' },
  { key: 'website', label: 'Website' },
];

export const blankProject = (me) => ({
  id: newId(8),
  name: '',
  client: '',
  dropbox: '',
  siteId: '',            // the Duda website, once there is one
  auditId: '',           // the audit record, once one exists
  phase: 'collect',
  assignee: '',          // who holds it right now
  due: '',               // when this phase is due
  members: [me.email],   // everybody involved, for the project's own channel
  facts: {},             // the agreed business details
  factsFrom: {},         // what the PDF said, so Reset has something to go back to
  factsFile: '',         // which file in Dropbox they came from
  history: [],           // every handover
  lateNotified: '',      // the deadline we have already complained about
  createdBy: me.email, createdByName: me.name, createdAt: now(), updatedAt: now(),
});

/** One line in the trail. Everything that moves a project writes one of these. */
export const historyEntry = (me, what, extra) => Object.assign({
  at: now(), by: me.email, byName: me.name, what,
}, extra || {});

export async function getProject(id) {
  const [raw] = await redis(['GET', KEY(id)]);
  return unpackJSON(raw);
}

/**
 * Save, and keep the small summary the list reads.
 *
 * Same pattern the audits use: the list must never need 200 reads to draw itself, so a compact
 * summary per project lives in one hash and the full record is only read when somebody opens it.
 */
export async function saveProject(p) {
  p.updatedAt = now();
  await redis(['SET', KEY(p.id), packJSON(p)], ['HSET', INDEX(), p.id, JSON.stringify(summary(p))], ['INCR', P + 'ver:proj']);
  return summary(p);
}

export const summary = (p) => ({
  id: p.id, name: p.name, client: p.client, phase: p.phase, assignee: p.assignee, due: p.due,
  siteId: p.siteId || '', auditId: p.auditId || '', members: p.members || [],
  dropbox: !!p.dropbox, facts: Object.keys(p.facts || {}).length,
  createdAt: p.createdAt, updatedAt: p.updatedAt, createdBy: p.createdBy,
});

export async function listProjects() {
  const [raw] = await redis(['HGETALL', INDEX()]);
  const out = [];
  if (Array.isArray(raw)) { for (let i = 0; i < raw.length; i += 2) { const v = jparse(raw[i + 1]); if (v) out.push(v); } }
  else Object.values(raw || {}).forEach((v) => { const j = jparse(v); if (j) out.push(j); });
  return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function removeProject(id) {
  await redis(['DEL', KEY(id)], ['HDEL', INDEX(), id], ['INCR', P + 'ver:proj']);
}

/** Is this person involved at all? Used to scope the list for people without "see every project". */
export const onProject = (p, email) => (p.members || []).includes(email) || p.assignee === email || p.createdBy === email;

/**
 * Hand a project on.
 *
 * The handover is the unit of work here, so it is one function: the phase, who holds it, when it is
 * due, the note, the trail entry and the person being told all happen together or not at all. Half
 * a handover — a phase that moved without telling anybody — is the failure mode this exists to stop.
 */
export async function handOver(p, me, { phase, assignee, due, note }) {
  const from = p.phase;
  const fromWho = p.assignee;
  p.phase = PHASE_KEYS.includes(phase) ? phase : p.phase;
  p.assignee = assignee || '';
  p.due = due || '';
  p.lateNotified = '';                       // a new deadline deserves a fresh complaint
  if (p.assignee && !(p.members || []).includes(p.assignee)) p.members = (p.members || []).concat(p.assignee);
  p.history = (p.history || []).concat(historyEntry(me, 'phase', {
    from, to: p.phase, fromWho, toWho: p.assignee, due: p.due, note: String(note || '').slice(0, 500),
  })).slice(-200);
  await saveProject(p);

  if (p.assignee && p.assignee !== me.email) {
    await notifyUser(p.assignee, {
      kind: 'project-assign', by: me.email, byName: me.name,
      text: `${me.name} handed you ${p.name || 'a project'} — ${phaseAt(p.phase).label}${p.due ? `, due ${p.due}` : ''}`,
      link: `#/project/${p.id}`,
    }).catch(() => {});
  }
  await globalLog(me, 'project-phase', `moved ${p.name || p.id} to ${phaseAt(p.phase).label}${p.assignee ? ` (${p.assignee})` : ''}`, { projectId: p.id }).catch(() => {});
  return p;
}

/**
 * Projects past their deadline that nobody has been told about.
 *
 * Checked when somebody opens the list rather than on a timer: there is no scheduler here, and a
 * deadline that is noticed when a person next looks is noticed early enough to matter. Each project
 * is complained about once per deadline — `lateNotified` is what stops it nagging every refresh.
 */
export async function checkLate(me) {
  const all = await listProjects();
  const today = new Date().toISOString().slice(0, 10);
  const late = all.filter((s) => s.due && s.due < today && s.phase !== 'done');
  const told = [];
  for (const s of late.slice(0, 20)) {
    const p = await getProject(s.id);
    if (!p || p.lateNotified === p.due) continue;
    p.lateNotified = p.due;
    p.history = (p.history || []).concat({ at: now(), by: 'system', byName: 'Site Auditor', what: 'late', phase: p.phase, due: p.due }).slice(-200);
    await saveProject(p);
    const days = Math.round((Date.parse(today) - Date.parse(p.due)) / 86400000);
    const who = p.assignee || 'nobody';
    // The project manager is told, because the deadline is theirs. The person holding it is told
    // too — being late without knowing is the one thing worse than being late.
    const text = `${p.name || 'A project'} is ${days} day${days === 1 ? '' : 's'} past its date on ${phaseAt(p.phase).label} (with ${who})`;
    for (const email of [...new Set([p.createdBy, p.assignee].filter(Boolean))]) {
      await notifyUser(email, { kind: 'project-late', by: 'system', byName: 'Site Auditor', text, link: `#/project/${p.id}` }).catch(() => {});
    }
    told.push(p.id);
  }
  return told;
}
