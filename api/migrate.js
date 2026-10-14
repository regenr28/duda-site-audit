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
import { metered, redis, P, requireUser, readBody, jparse, fetchWithTimeout, OWNER_EMAIL, normEmail } from './_lib.js';

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

// What the records are, in the groups people think in, so the end of the move can show
// "form submissions: 4,210 in the old app, 4,210 here" rather than one big number.
const GROUPS = [
  ['Form submissions and contacts', /^(lead|ctv|formhit|ih)/],
  ['Auto audit results', /^cw/],
  ['Audits and audit items', /^(site|fstate|fnum|seq|index|act|scan|removed|fa|fixedchecks|bihist|pages|img|cap|thumb|psi|health|ai|anprov|sugg|helpq)/],
  ['Comments', /^(cmt|conv|watch|sitefeed)/],
  ['Client tickets', /^tk/],
  ['Projects', /^proj/],
  ['DR Websites, domains and trends', /^(duda|dom|pubev|livedom|dnsc|lastrun|stat)/],
  ['People, customers and settings', /^(user|roles|sess|seclog|notif|uact|gact|slack|edhost|hook|dropbox|dbx|usage|rl|presence|room|ver|pending|alert|alerted)/],
];
const groupOf = (key) => {
  const t = String(key).replace(/^[^:]*:/, '');
  for (const [name, re] of GROUPS) if (re.test(t)) return name;
  return 'Everything else';
};
const READ_AT_ONCE = 30;
/** Read one key in pieces (a very large collection), so no single answer is too big. */
async function readBig(key, type) {
  if (type === 'string') return (await from([['GET', key]]))[0];
  if (type === 'list') { const out = []; for (let i = 0; ; i += 1000) { const [part] = await from([['LRANGE', key, String(i), String(i + 999)]]); out.push(...(part || [])); if (!part || part.length < 1000) return out; } }
  const scanOp = type === 'hash' ? 'HSCAN' : type === 'set' ? 'SSCAN' : type === 'zset' ? 'ZSCAN' : '';
  if (!scanOp) return null;
  const out = []; let cur = '0';
  do { const [[next, part]] = await from([[scanOp, key, cur, 'COUNT', '500']]); out.push(...(part || [])); cur = String(next); } while (cur !== '0');
  if (type === 'zset') { const flat = []; for (let i = 0; i < out.length; i += 2) flat.push(out[i], out[i + 1]); return flat; }   // ZSCAN gives member, score like ZRANGE WITHSCORES
  return out;
}
const readCmd = (k, type) => (type === 'string' ? ['GET', k] : type === 'hash' ? ['HGETALL', k] : type === 'list' ? ['LRANGE', k, '0', '-1'] : type === 'set' ? ['SMEMBERS', k] : type === 'zset' ? ['ZRANGE', k, '0', '-1', 'WITHSCORES'] : ['TYPE', k]);

async function round(restart, budgetMs = 45000) {
  const t0 = Date.now();
  const [raw] = await redis(['GET', STATE]);
  let st = jparse(raw) || {};
  if (restart || !st.cursor || st.done) st = { cursor: '0', copied: 0, skipped: 0, failed: 0, startedAt: Date.now(), round: (st.round || 0) + 1, done: false, errors: [], groups: {} };
  st.groups = st.groups || {};
  if (!st.total) { const [n] = await from([['DBSIZE']]); st.total = Number(n) || 0; }
  const note = (key, field) => { const g = groupOf(key); (st.groups[g] = st.groups[g] || { from: 0, copied: 0, here: 0 })[field]++; };
  while (!st.copyDone && Date.now() - t0 < budgetMs) {
    const [[next, keys]] = await from([['SCAN', st.cursor, 'COUNT', '150']]);
    const list = (keys || []).filter((k) => !String(k).startsWith(STATE));
    if (list.length) {
      const meta = await from(list.flatMap((k) => [['TYPE', k], ['PTTL', k]]));
      // Read a few at a time; anything that does not come back in a group is read on its own, in pieces.
      const vals = new Array(list.length);
      for (let a = 0; a < list.length; a += READ_AT_ONCE) {
        const idx = list.slice(a, a + READ_AT_ONCE).map((k, n) => a + n);
        try { const got = await from(idx.map((i) => readCmd(list[i], meta[i * 2]))); idx.forEach((i, n) => { vals[i] = got[n]; }); }
        catch (e) { for (const i of idx) { try { vals[i] = await readBig(list[i], meta[i * 2]); } catch (e2) { vals[i] = undefined; } } }
      }
      let batch = []; let keysIn = []; let size = 0;
      // One request for many small records; a record that fails on its own is noted and skipped,
      // so one oversized record never stops the move.
      const fail = (key, why) => { st.failed++; if (st.errors.length < 20) st.errors.push(`${key}: ${String(why).slice(0, 120)}`); };
      const flush = async () => {
        if (!batch.length) return;
        try { await redis(...batch); keysIn.forEach((k) => { st.copied++; note(k.key, 'copied'); }); }
        catch (e) {
          for (const k of keysIn) {
            try { for (const c of chunks(k.cmds, 4)) await redis(...c); st.copied++; note(k.key, 'copied'); }
            catch (e2) { fail(k.key, e2.message || e2); }
          }
        }
        batch = []; keysIn = []; size = 0;
      };
      for (let i = 0; i < list.length; i++) {
        if (meta[i * 2] === 'none') { st.skipped++; continue; }             // gone since the scan (expired)
        note(list[i], 'from');
        if (vals[i] === undefined) { fail(list[i], 'could not be read from the old database'); continue; }
        const cmds = writeCmds(list[i], meta[i * 2], vals[i], meta[i * 2 + 1]);
        if (!cmds.length) { st.skipped++; continue; }
        const sz = JSON.stringify(cmds).length;
        if (size + sz > 600000) await flush();
        batch.push(...cmds); keysIn.push({ key: list[i], cmds }); size += sz;
      }
      await flush();
    }
    st.cursor = String(next);
    if (st.cursor === '0') { st.copyDone = Date.now(); break; }
  }
  // The check: count what is in THIS database now, group by group, and compare with the old one.
  if (st.copyDone && !st.done && Date.now() - t0 < budgetMs + 10000) {
    Object.values(st.groups).forEach((g) => { g.here = 0; });
    let cur = '0';
    do {
      const [[next, keys]] = await redis(['SCAN', cur, 'COUNT', '1000']);
      (keys || []).forEach((k) => { if (!String(k).startsWith(STATE)) { const g = groupOf(k); if (st.groups[g]) st.groups[g].here++; } });
      cur = String(next);
    } while (cur !== '0');
    const [hereN] = await redis(['DBSIZE']); st.here = Number(hereN) || 0;
    // Two counts inside records that matter most: audits listed, websites auto audited.
    const [a1, c1] = await from([['HLEN', P + 'index'], ['HLEN', P + 'cwsum']]);
    const [a2, c2] = await redis(['HLEN', P + 'index'], ['HLEN', P + 'cwsum']);
    st.checks = [['Audits in the Audits list', Number(a1) || 0, Number(a2) || 0], ['Websites with an auto audit result', Number(c1) || 0, Number(c2) || 0]];
    st.done = true; st.finishedAt = Date.now();
  }
  st.at = Date.now();
  await redis(['SET', STATE, JSON.stringify(st)]);
  return st;
}

async function handler(req, res) {
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
export default metered('migrate', handler);
