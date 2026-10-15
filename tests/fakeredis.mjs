// A tiny Upstash-REST-compatible fake for local end-to-end tests. node fakeredis.mjs <port>
import http from 'node:http';
// FAKE_PG=1: the same commands answered by the real Postgres setup instead (see fakesupabase.mjs).
if (process.env.FAKE_PG) { await import('./fakesupabase.mjs'); await new Promise(() => {}); }
const kv = new Map();
const exp = new Map();
const h = (k) => { if (!(kv.get(k) instanceof Map)) kv.set(k, new Map()); return kv.get(k); };
const l = (k) => { if (!Array.isArray(kv.get(k))) kv.set(k, []); return kv.get(k); };
const s = (k) => { if (!(kv.get(k) instanceof Set)) kv.set(k, new Set()); return kv.get(k); };
const live = (k) => { const e = exp.get(k); if (e && e < Date.now()) { kv.delete(k); exp.delete(k); } return kv.has(k); };
let count = 0; const unknown = new Set();
function exec([c, ...a]) {
  c = String(c).toUpperCase(); count++;
  if (a[0] !== undefined) live(a[0]);
  switch (c) {
    case 'GET': return typeof kv.get(a[0]) === 'string' ? kv.get(a[0]) : null;
    case 'MGET': return a.map((k) => (live(k) && typeof kv.get(k) === 'string' ? kv.get(k) : null));
    case 'SET': {
      if (a.includes('NX') && kv.has(a[0])) return null;
      kv.set(a[0], String(a[1])); exp.delete(a[0]);
      const px = a.indexOf('PX'); const ex = a.indexOf('EX');
      if (px > 0) exp.set(a[0], Date.now() + Number(a[px + 1])); if (ex > 0) exp.set(a[0], Date.now() + 1000 * Number(a[ex + 1]));
      return 'OK';
    }
    case 'SETEX': kv.set(a[0], String(a[2])); exp.set(a[0], Date.now() + 1000 * Number(a[1])); return 'OK';
    case 'DEL': { let n = 0; a.forEach((k) => { if (kv.delete(k)) n++; }); return n; }
    case 'EXISTS': return a.filter((k) => live(k)).length;
    case 'EXPIRE': if (kv.has(a[0])) exp.set(a[0], Date.now() + 1000 * Number(a[1])); return 1;
    case 'PEXPIRE': if (kv.has(a[0])) exp.set(a[0], Date.now() + Number(a[1])); return 1;
    case 'TTL': return exp.has(a[0]) ? Math.round((exp.get(a[0]) - Date.now()) / 1000) : -1;
    case 'PTTL': return exp.has(a[0]) ? exp.get(a[0]) - Date.now() : -1;
    case 'INCR': case 'INCRBY': { const v = Number(kv.get(a[0]) || 0) + Number(c === 'INCR' ? 1 : a[1]); kv.set(a[0], String(v)); return v; }
    case 'DECR': { const v = Number(kv.get(a[0]) || 0) - 1; kv.set(a[0], String(v)); return v; }
    case 'SMEMBERS': return [...s(a[0])];
    case 'SADD': { let n = 0; a.slice(1).forEach((x) => { if (!s(a[0]).has(x)) { s(a[0]).add(x); n++; } }); return n; }
    case 'SREM': { a.slice(1).forEach((x) => s(a[0]).delete(x)); return 1; }
    case 'SISMEMBER': return s(a[0]).has(a[1]) ? 1 : 0;
    case 'SCARD': return s(a[0]).size;
    case 'HGET': return h(a[0]).get(a[1]) ?? null;
    case 'HMGET': return a.slice(1).map((f) => h(a[0]).get(f) ?? null);
    case 'HSET': case 'HMSET': { const m = h(a[0]); let n = 0; for (let i = 1; i < a.length; i += 2) { if (!m.has(a[i])) n++; m.set(a[i], String(a[i + 1])); } return n; }
    case 'HSETNX': { const m = h(a[0]); if (m.has(a[1])) return 0; m.set(a[1], String(a[2])); return 1; }
    case 'HINCRBY': { const m = h(a[0]); const v = Number(m.get(a[1]) || 0) + Number(a[2]); m.set(a[1], String(v)); return v; }
    case 'HDEL': { let n = 0; a.slice(1).forEach((f) => { if (h(a[0]).delete(f)) n++; }); return n; }
    case 'HLEN': return h(a[0]).size;
    case 'HKEYS': return [...h(a[0]).keys()];
    case 'HEXISTS': return h(a[0]).has(a[1]) ? 1 : 0;
    case 'HGETALL': return [...h(a[0]).entries()].flat();
    case 'LPUSH': { const L = l(a[0]); a.slice(1).forEach((x) => L.unshift(x)); return L.length; }
    case 'RPUSH': { const L = l(a[0]); L.push(...a.slice(1)); return L.length; }
    case 'LTRIM': { const L = l(a[0]); const e = Number(a[2]); kv.set(a[0], L.slice(Number(a[1]), e < 0 ? L.length + e + 1 : e + 1)); return 'OK'; }
    case 'LRANGE': { const L = l(a[0]); const e = Number(a[2]); return L.slice(Number(a[1]), e < 0 ? L.length + e + 1 : e + 1); }
    case 'LLEN': return l(a[0]).length;
    case 'LREM': { const L = l(a[0]); kv.set(a[0], L.filter((x) => x !== a[2])); return 1; }
    case 'DBSIZE': return kv.size;
    case 'TYPE': { const v = kv.get(a[0]); return v === undefined ? 'none' : typeof v === 'string' ? 'string' : v instanceof Map ? 'hash' : v instanceof Set ? 'set' : Array.isArray(v) ? 'list' : 'none'; }
    case 'SCAN': return ['0', [...kv.keys()].filter((k) => { const m = a.indexOf('MATCH'); if (m < 0) return true; const re = new RegExp('^' + a[m + 1].replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'); return re.test(k); })];
    default: unknown.add(c); throw new Error('fake redis: unsupported ' + c);
  }
}
const port = Number(process.argv[2] || 8079);
http.createServer(async (req, res) => {
  let body = ''; for await (const ch of req) body += ch;
  if (req.url.startsWith('/__count')) { res.end(JSON.stringify({ count, unknown: [...unknown] })); return; }
  let cmds = JSON.parse(body || '[]');
  if (!req.url.startsWith('/pipeline')) cmds = [cmds];
  const out = cmds.map((cmd) => { try { return { result: exec(cmd) }; } catch (e) { return { error: e.message }; } });
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(req.url.startsWith('/pipeline') ? out : out[0]));
}).listen(port, () => console.log('fake redis on ' + port));
