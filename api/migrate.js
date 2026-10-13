// Moving the app to a new home: copy every record from the old database into this app's own.
//
// Set two environment variables on the NEW project, pointing at the OLD database (Upstash → the
// old database → REST API; the read-only token is enough and is the safer choice):
//   COPY_FROM_URL    the old database's REST URL (https://….upstash.io)
//   COPY_FROM_TOKEN  its REST token (read-only is fine)
// then the app owner opens Settings → 📦 Move data in, and presses the button. It copies in rounds
// of about 45 seconds and carries on where it stopped, so the page just keeps going until done.
// Running it again copies everything again (to pick up what changed since). The old database is
// only ever read. Remove both variables when finished.
//
// GET  /api/migrate              → { configured, state, source, target }
// POST /api/migrate { op:'run', restart }  → one round
import { redis, P, requireUser, readBody, jparse, fetchWithTimeout, OWNER_EMAIL, normEmail } from './_lib.js';

const STATE = P + 'migrate:state';
const FROM_URL = () => String(process.env.COPY_FROM_URL || '').replace(/\/+$/, '');
const FROM_TOKEN = () => String(process.env.COPY_FROM_TOKEN || '');
export const migrateConfigured = () => /^(https:\/\/|http:\/\/(127\.0\.0\.1|localhost)[:/])/.test(FROM_URL() + '/') && !!FROM_TOKEN();
const CHUNK = 500;                  // members per write command, so no single request gets too big

async function from(cmds) {
  const r = await fetchWithTimeout(FROM_URL() + '/pipeline', { method: 'POST', headers: { Authorization: 'Bearer ' + FROM_TOKEN(), 'Content-Type': 'application/json' }, body: JSON.stringify(cmds) }, 25000);
  if (!r.ok) throw new Error(`The old database answered ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return (await r.json()).map((x) => { if (x.error) throw new Error('Old database: ' + x.error); return x.result; });
}
/** Split into groups of at most `n` items (or pairs) and about 400 KB, so no single request is too big. */
const chunks = (arr, n, step = 1) => {
  const out = []; let cur = []; let size = 0;
  for (let i = 0; i < arr.length; i += step) {
    const part = arr.slice(i, i + step); const sz = part.reduce((a, v) => a + String(v).length + 8, 0);
    if (cur.length && (cur.length >= n || size + sz > 400000)) { out.push(cur); cur = []; size = 0; }
    cur.push(...part); size += sz;
  }
  if (cur.length) out.push(cur);
  return out;
};

/** The commands that recreate one key here, from what was read there. */
function writeCmds(key, type, val, pttl) {
  const cmds = [['DEL', key]];
  if (type === 'string') { if (val === null || val === undefined) return []; cmds.push(['SET', key, String(val)]); }
  else if (type === 'hash') { const flat = val || []; if (!flat.length) return []; chunks(flat, CHUNK * 2, 2).forEach((c) => cmds.push(['HSET', key, ...c])); }
  else if (type === 'list') { const items = val || []; if (!items.length) return []; chunks(items, CHUNK).forEach((c) => cmds.push(['RPUSH', key, ...c])); }
  else if (type === 'set') { const items = val || []; if (!items.length) return []; chunks(items, CHUNK).forEach((c) => cmds.push(['SADD', key, ...c])); }
  else if (type === 'zset') {
    const flat = val || []; if (!flat.length) return [];
    const pairs = []; for (let i = 0; i < flat.length; i += 2) pairs.push(String(flat[i + 1]), String(flat[i]));   // ZADD wants score, member
    chunks(pairs, CHUNK * 2, 2).forEach((c) => cmds.push(['ZADD', key, ...c]));
  } else return [];
  if (Number(pttl) > 0) cmds.push(['PEXPIRE', key, String(pttl)]);
  return cmds;
}

async function round(restart, budgetMs = 45000) {
  const t0 = Date.now();
  const [raw] = await redis(['GET', STATE]);
  let st = jparse(raw) || {};
  if (restart || !st.cursor || st.done) st = { cursor: '0', copied: 0, skipped: 0, startedAt: Date.now(), round: (st.round || 0) + 1, done: false, errors: [] };
  if (!st.total) { const [n] = await from([['DBSIZE']]); st.total = Number(n) || 0; }
  while (Date.now() - t0 < budgetMs) {
    const [[next, keys]] = await from([['SCAN', st.cursor, 'COUNT', '150']]);
    const list = (keys || []).filter((k) => !String(k).startsWith(STATE));
    if (list.length) {
      const meta = await from(list.flatMap((k) => [['TYPE', k], ['PTTL', k]]));
      const reads = list.map((k, i) => {
        const type = meta[i * 2];
        return type === 'string' ? ['GET', k] : type === 'hash' ? ['HGETALL', k] : type === 'list' ? ['LRANGE', k, '0', '-1'] : type === 'set' ? ['SMEMBERS', k] : type === 'zset' ? ['ZRANGE', k, '0', '-1', 'WITHSCORES'] : ['TYPE', k];
      });
      const vals = await from(reads);
      let batch = []; let keysIn = []; let size = 0;
      // One request for many small records; a record that fails on its own is noted and skipped,
      // so one oversized record never stops the move.
      const flush = async () => {
        if (!batch.length) return;
        try { await redis(...batch); st.copied += keysIn.length; }
        catch (e) {
          for (const k of keysIn) {
            try { await redis(...k.cmds); st.copied++; }
            catch (e2) { st.failed = (st.failed || 0) + 1; if ((st.errors || []).length < 20) (st.errors = st.errors || []).push(`${k.key}: ${String(e2.message || e2).slice(0, 120)}`); }
          }
        }
        batch = []; keysIn = []; size = 0;
      };
      for (let i = 0; i < list.length; i++) {
        const cmds = writeCmds(list[i], meta[i * 2], vals[i], meta[i * 2 + 1]);
        if (!cmds.length) { st.skipped++; continue; }
        const sz = JSON.stringify(cmds).length;
        if (size + sz > 600000) await flush();
        batch.push(...cmds); keysIn.push({ key: list[i], cmds }); size += sz;
      }
      await flush();
    }
    st.cursor = String(next);
    if (st.cursor === '0') { st.done = true; st.finishedAt = Date.now(); break; }
  }
  st.at = Date.now();
  if (st.done) { const [n] = await redis(['DBSIZE']); st.here = Number(n) || 0; }
  await redis(['SET', STATE, JSON.stringify(st)]);
  return st;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const me = await requireUser(req, res);
  if (!me) return;
  // Only the account that runs the app: this rewrites the whole database.
  if (normEmail(me.email) !== OWNER_EMAIL || me.previewPerms) return res.status(403).json({ error: 'Only the app owner can move data in.' });
  try {
    if (req.method === 'GET') {
      const [raw] = await redis(['GET', STATE]);
      return res.status(200).json({ configured: migrateConfigured(), from: migrateConfigured() ? FROM_URL().replace(/^https?:\/\//, '') : '', state: jparse(raw) });
    }
    const b = readBody(req);
    if (b.op !== 'run') return res.status(400).json({ error: 'Unknown op' });
    if (!migrateConfigured()) return res.status(400).json({ error: 'Add COPY_FROM_URL and COPY_FROM_TOKEN to this project in Vercel first (then redeploy).' });
    return res.status(200).json({ state: await round(!!b.restart) });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
