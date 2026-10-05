// Dropbox, read-only, through a shared folder link.
//
// The important choice here: everything goes through `shared_link`. A project manager pastes the
// same link they would paste into a chat, and we read it without the folder ever being in our own
// Dropbox and without anybody being invited to anything. That is what makes this usable on day one
// — the alternative, mirroring 700 client folders into one account, is not a thing anybody would do.
//
// Access is a short-lived token refreshed from a long-lived refresh token, so nothing stored here
// expires silently a few hours after it is set up. Scopes needed on the app: files.metadata.read
// and sharing.read. Nothing writes.
import { fetchWithTimeout, redis, P, jparse, now } from './_lib.js';

const AUTH = () => process.env.DROPBOX_AUTH_BASE || 'https://api.dropboxapi.com';
const API = () => process.env.DROPBOX_API_BASE || 'https://api.dropboxapi.com';
const CONTENT = () => process.env.DROPBOX_CONTENT_BASE || 'https://content.dropboxapi.com';

export const dropboxReady = () => !!(process.env.DROPBOX_APP_KEY && process.env.DROPBOX_APP_SECRET && process.env.DROPBOX_REFRESH_TOKEN);

/**
 * A usable access token.
 *
 * Cached in the store rather than in the instance, because serverless means many instances and
 * Dropbox counts token requests. Expiry is cut short by a minute so a token never dies mid-call.
 */
let memo = { token: '', until: 0 };
export async function accessToken() {
  if (!dropboxReady()) throw new Error('Dropbox is not connected yet. Please contact the app owner.');
  if (memo.token && Date.now() < memo.until) return memo.token;
  const [raw] = await redis(['GET', P + 'dropbox:tok']);
  const cached = jparse(raw);
  if (cached && cached.token && Date.now() < cached.until) { memo = cached; return cached.token; }

  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: process.env.DROPBOX_REFRESH_TOKEN });
  const basic = Buffer.from(`${process.env.DROPBOX_APP_KEY}:${process.env.DROPBOX_APP_SECRET}`).toString('base64');
  const r = await fetchWithTimeout(AUTH() + '/oauth2/token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + basic, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  }, 15000);
  const text = await r.text();
  if (!r.ok) throw new Error(`Dropbox would not give us access (${r.status}). The connection may need setting up again.`);
  const j = jparse(text) || {};
  if (!j.access_token) throw new Error('Dropbox did not return an access token.');
  const fresh = { token: j.access_token, until: Date.now() + Math.max(60, (Number(j.expires_in) || 14400) - 60) * 1000 };
  memo = fresh;
  await redis(['SET', P + 'dropbox:tok', JSON.stringify(fresh), 'PX', fresh.until - Date.now()]).catch(() => {});
  return fresh.token;
}

async function rpc(path, arg) {
  const token = await accessToken();
  const r = await fetchWithTimeout(API() + path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(arg),
  }, 25000);
  const text = await r.text();
  if (!r.ok) throw new Error(dropboxError(r.status, text));
  return jparse(text) || {};
}

/** Dropbox's errors are machine-shaped. Say what a person can do about them. */
function dropboxError(status, text) {
  const t = String(text || '');
  if (/shared_link_not_found|not_found/.test(t)) return 'That Dropbox link does not open anything. Check it has not been deleted, and that it is a folder link rather than a single file.';
  if (/shared_link_access_denied|access_denied/.test(t)) return 'That Dropbox folder is not open to the link. In Dropbox, set the link so that anyone with it can view.';
  if (/invalid_access_token|expired_access_token/.test(t)) return 'The Dropbox connection has stopped working and needs setting up again.';
  if (/missing_scope/.test(t)) return 'The Dropbox connection is missing a permission (it needs to read file names and shared links).';
  if (status === 429) return 'Dropbox is asking us to slow down. Try again in a minute.';
  return `Dropbox refused (${status}). ${t.slice(0, 120)}`;
}

/** Tidy a link people paste. Dropbox's own ?dl= flag changes what the link does, so it is dropped. */
export function cleanLink(url) {
  const s = String(url || '').trim();
  if (!s) return '';
  if (!/^https?:\/\/(www\.)?dropbox\.com\//i.test(s)) return '';
  try { const u = new URL(s); u.searchParams.delete('dl'); u.hash = ''; return u.toString(); } catch (e) { return ''; }
}

/**
 * Everything in a shared folder, including subfolders.
 *
 * Paged, because `list_folder` returns a cursor rather than everything, and a client folder with a
 * few hundred photos in it is ordinary. Capped so one enormous folder cannot stall a request.
 */
export async function listFolder(link, { max = 2000 } = {}) {
  const url = cleanLink(link);
  if (!url) throw new Error('That does not look like a Dropbox link.');
  const out = [];
  let res = await rpc('/2/files/list_folder', { path: '', shared_link: { url }, recursive: true, limit: 500 });
  const take = (r) => (r.entries || []).forEach((e) => {
    if (out.length >= max) return;
    out.push({
      kind: e['.tag'] === 'folder' ? 'folder' : 'file',
      name: String(e.name || ''),
      // The path INSIDE the shared folder, which is what get_shared_link_file wants back.
      path: String(e.path_lower || e.path_display || ''),
      size: Number(e.size || 0),
      modified: e.server_modified || e.client_modified || '',
    });
  });
  take(res);
  let guard = 0;
  while (res.has_more && out.length < max && guard++ < 20) {
    res = await rpc('/2/files/list_folder/continue', { cursor: res.cursor });
    take(res);
  }
  return out;
}

/** One file out of a shared folder, as bytes. Capped: a brief is never 50MB, and a PDF this big is a scan. */
export async function readFile(link, path, { maxBytes = 25 * 1024 * 1024 } = {}) {
  const url = cleanLink(link);
  if (!url) throw new Error('That does not look like a Dropbox link.');
  const token = await accessToken();
  const r = await fetchWithTimeout(CONTENT() + '/2/sharing/get_shared_link_file', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      // Dropbox takes the arguments in a header for content calls, and the header must be ASCII.
      'Dropbox-API-Arg': ascii(JSON.stringify({ url, path: path || undefined })),
    },
  }, 40000);
  if (!r.ok) throw new Error(dropboxError(r.status, await r.text().catch(() => '')));
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > maxBytes) throw new Error('That file is too large to read here.');
  return buf;
}

/** Non-ASCII in a header is rejected outright, so escape it the way Dropbox asks. */
const ascii = (s) => String(s).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

/** The files in a folder most likely to be the client's brief, best first. */
export function likelyBriefs(files) {
  const pdfs = files.filter((f) => f.kind === 'file' && /\.pdf$/i.test(f.name));
  const score = (f) => {
    const n = f.name.toLowerCase();
    let s = 0;
    if (/brief|intake|questionnaire|onboard|discovery|form|info|details|content/.test(n)) s += 5;
    if (/contact|business/.test(n)) s += 3;
    if (/invoice|receipt|contract|agreement|proposal|quote|nda/.test(n)) s -= 4;
    if (f.size > 40000 && f.size < 4000000) s += 1;    // a form, not a one-page cover or a photo book
    if ((f.path.match(/\//g) || []).length <= 2) s += 1; // near the top of the folder
    return s;
  };
  return pdfs.map((f) => Object.assign({ score: score(f) }, f)).sort((a, b) => b.score - a.score || a.size - b.size);
}

/** Remember what a project's folder held, so the screen does not re-ask Dropbox on every render. */
export async function cacheListing(projectId, data) {
  await redis(['SET', P + 'dbx:' + projectId, JSON.stringify(Object.assign({ at: now() }, data)), 'EX', 7 * 86400]).catch(() => {});
}
export async function cachedListing(projectId) {
  const [raw] = await redis(['GET', P + 'dbx:' + projectId]);
  return jparse(raw);
}
