// Command-count check for the comment-list fixes. Usage: node cost.mjs <app dir>
// Fakes the Upstash REST pipeline in memory and counts every command, the way Upstash bills.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const appDir = path.resolve(process.argv[2]);
process.env.KV_REST_API_URL = 'https://fake-redis.test';
process.env.KV_REST_API_TOKEN = 'x';

const kv = new Map();
let count = 0;
const byCmd = {};
const h = (k) => { if (!kv.has(k)) kv.set(k, new Map()); return kv.get(k); };
const l = (k) => { if (!kv.has(k)) kv.set(k, []); return kv.get(k); };
function exec([c, ...a]) {
  c = c.toUpperCase(); count++; byCmd[c] = (byCmd[c] || 0) + 1;
  switch (c) {
    case 'GET': return kv.has(a[0]) && typeof kv.get(a[0]) === 'string' ? kv.get(a[0]) : null;
    case 'MGET': return a.map((k) => (typeof kv.get(k) === 'string' ? kv.get(k) : null));
    case 'SET': { if (a.includes('NX') && kv.has(a[0])) return null; kv.set(a[0], String(a[1])); return 'OK'; }
    case 'DEL': { let n = 0; a.forEach((k) => { if (kv.delete(k)) n++; }); return n; }
    case 'EXISTS': return a.filter((k) => kv.has(k)).length;
    case 'INCR': { const v = Number(kv.get(a[0]) || 0) + 1; kv.set(a[0], String(v)); return v; }
    case 'INCRBY': { const v = Number(kv.get(a[0]) || 0) + Number(a[1]); kv.set(a[0], String(v)); return v; }
    case 'SMEMBERS': return [...(kv.get(a[0]) || new Set())];
    case 'SADD': { const s = kv.get(a[0]) || new Set(); a.slice(1).forEach((x) => s.add(x)); kv.set(a[0], s); return 1; }
    case 'HGET': return h(a[0]).get(a[1]) ?? null;
    case 'HMGET': return a.slice(1).map((f) => h(a[0]).get(f) ?? null);
    case 'HSET': { const m = h(a[0]); for (let i = 1; i < a.length; i += 2) m.set(a[i], String(a[i + 1])); return 1; }
    case 'HDEL': { a.slice(1).forEach((f) => h(a[0]).delete(f)); return 1; }
    case 'HLEN': return h(a[0]).size;
    case 'HGETALL': return [...h(a[0]).entries()].flat();
    case 'HKEYS': return [...h(a[0]).keys()];
    case 'LPUSH': { const L = l(a[0]); a.slice(1).forEach((x) => L.unshift(x)); return L.length; }
    case 'RPUSH': { const L = l(a[0]); L.push(...a.slice(1)); return L.length; }
    case 'LTRIM': { const L = l(a[0]); kv.set(a[0], L.slice(Number(a[1]), Number(a[2]) + 1)); return 'OK'; }
    case 'LRANGE': { const L = l(a[0]); const e = Number(a[2]); return L.slice(Number(a[1]), e < 0 ? undefined : e + 1); }
    case 'EXPIRE': case 'PEXPIRE': return 1;
    default: throw new Error('fake redis: unsupported ' + c);
  }
}
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.startsWith('https://fake-redis.test/pipeline')) {
    const cmds = JSON.parse(opts.body);
    const out = cmds.map((cmd) => { try { return { result: exec(cmd) }; } catch (e) { return { error: e.message }; } });
    return new Response(JSON.stringify(out), { status: 200 });
  }
  // Anything else (Duda, Slack, Ably) is "not found": the test is about the database.
  return new Response('{}', { status: 404 });
};

const P = 'dsa:';
// Realistic shape: 15 members, 150 distinct comment authors (all already cached), 700 watched sites,
// 1,500 conversations whose tails name those authors.
const users = Array.from({ length: 15 }, (_, i) => `member${i}@8bitcreative.com`);
kv.set(P + 'users', new Set(users));
users.forEach((e, i) => kv.set(P + 'user:' + e, JSON.stringify({ email: e, name: 'M' + i, role: i ? 'member' : 'admin', status: 'active' })));
const authors = Array.from({ length: 150 }, (_, i) => `author${i}@client${i}.com`);
authors.forEach((e, i) => kv.set(P + 'dudaacct:' + e, i % 3 ? 'CUSTOMER' : '-'));

const lib = await import(pathToFileURL(path.join(appDir, 'api/_lib.js')).href);
const cm = await import(pathToFileURL(path.join(appDir, 'api/comments.js')).href);

const measure = async (label, fn) => { const c0 = count; const r = await fn(); console.log(`${label}: ${count - c0} commands`); return r; };

const u = await measure('listUsers()', () => lib.listUsers());
const t = await measure('dudaTypes(150 cached authors)', () => cm.dudaTypes(authors));
console.log('  users returned:', u.length, '| types returned:', Object.keys(t).length,
  '| sample:', t[authors[1]], JSON.stringify(t[authors[0]]));
// Correctness fingerprint, compared between the old and new code by the caller.
console.log('FINGERPRINT', JSON.stringify({ u: u.map((x) => x.email).sort(), t }).length,
  Object.entries(t).filter(([, v]) => v === 'CUSTOMER').length);

// Webhook: a PUBLISH and a form submission must not move ver:cmt; a comment must.
kv.set(P + 'hookkey', 'k');
const hook = (await import(pathToFileURL(path.join(appDir, 'api/hook.js')).href)).default;
const call = async (events) => {
  const res = { code: 0, status(c) { this.code = c; return this; }, json() { return this; }, setHeader() {} };
  const req = { method: 'POST', query: { k: 'k' }, headers: {}, body: events, text: async () => JSON.stringify(events) };
  await hook(req, res);
  return res.code;
};
const ver = () => kv.get(P + 'ver:cmt') || '0';
const v0 = ver();
const c1 = await call([{ event_type: 'PUBLISH', resource_data: { site_name: 'abc123' }, event_timestamp: Date.now() }]);
const v1 = ver();
const c2 = await call([{ event_type: 'NEW_COMMENT', resource_data: { site_name: 'abc123' }, event_timestamp: Date.now(),
  data: { conversation_uuid: 'cv1', comment: { uuid: 'c1', text: 'hello' } } }]);
const v2 = ver();
console.log(`hook PUBLISH -> HTTP ${c1}, ver:cmt ${v0} -> ${v1} | hook NEW_COMMENT -> HTTP ${c2}, ver:cmt ${v1} -> ${v2}`);
