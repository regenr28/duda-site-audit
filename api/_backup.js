// A backup of the website in Duda, taken before an audit starts changing things.
//
// Duda keeps the backup with the website (Site History in the editor), so restoring is Duda's own
// button and nothing here has to be trusted with the content. Names follow the team's convention:
//   R8<initials>_b4_audit_<YYYYMMDD>_<HHMM>    e.g. R8RR_b4_audit_20261007_0930
// Duda allows 50 manual backups per website and no spaces in the name.
import { fetchWithTimeout } from './_lib.js';

const DUDA = process.env.DUDA_API_BASE || 'https://api.duda.co/api';

/** "Reymark Regencia" → "RR", "Ana" → "A", nothing usable → "X". */
export function initialsOf(name, email) {
  const words = String(name || '').replace(/[^A-Za-z\s-]/g, ' ').split(/[\s-]+/).filter(Boolean);
  let ini = words.map((w) => w[0]).join('').toUpperCase().slice(0, 4);
  if (!ini) ini = String(email || '').replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase();
  return ini || 'X';
}

/** The person's local time as YYYYMMDD_HHMM when the browser sent one, otherwise UTC. */
export function stampOf(stamp) {
  if (/^\d{8}_\d{4}$/.test(String(stamp || ''))) return String(stamp);
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}_${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

export const backupName = (me, stamp) => `R8${initialsOf(me && me.name, me && me.email)}_b4_audit_${stampOf(stamp)}`;

/** Ask Duda for the backup. Resolves { ok, name } or { ok:false, error } — never throws. */
export async function createBackup(dudaSiteId, me, stamp, taken) {
  let name = backupName(me, stamp);
  for (let n = 2; taken && taken.has(name) && n < 30; n++) name = backupName(me, stamp) + '_' + n;
  const user = process.env.DUDA_API_USERNAME, pass = process.env.DUDA_API_PASSWORD;
  if (!user || !pass) return { ok: false, name, error: 'The Duda connection is not set up yet. Ask the app owner.' };
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(String(dudaSiteId || ''))) return { ok: false, name, error: 'This audit has no Duda website ID.' };
  try {
    const r = await fetchWithTimeout(`${DUDA}/sites/multiscreen/backups/${encodeURIComponent(dudaSiteId)}/create`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'), Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }, 25000);
    const text = await r.text();
    if (r.ok) return { ok: true, name };
    let msg = text.slice(0, 240);
    try { const j = JSON.parse(text); msg = j.message || j.error_code || msg; } catch (e) { /* plain text */ }
    // The most likely refusal, said in words someone can act on.
    if (r.status === 400 && /limit|maximum|exceed|50/i.test(msg)) msg = 'Duda keeps at most 50 manual backups per website and this one is full. Delete old ones in the editor (Site History) and try again.';
    else if (r.status === 401 || r.status === 403) msg = 'Duda refused the request (no permission to back up this website).';
    return { ok: false, name, error: `Duda said ${r.status}: ${msg}` };
  } catch (e) {
    return { ok: false, name, error: 'Duda did not answer in time. The backup may still have been made; check Site History in the editor.' };
  }
}
