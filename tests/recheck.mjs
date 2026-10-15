// Server test for op=recheck. Usage: node recheck.mjs <app dir>
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const appDir = path.resolve(process.argv[2]);
process.env.KV_REST_API_URL = 'https://fake-redis.test';
process.env.KV_REST_API_TOKEN = 'x';

const kv = new Map();
const h = (k) => { if (!(kv.get(k) instanceof Map)) kv.set(k, new Map()); return kv.get(k); };
const l = (k) => { if (!Array.isArray(kv.get(k))) kv.set(k, []); return kv.get(k); };
function exec([c, ...a]) {
  c = c.toUpperCase();
  switch (c) {
    case 'GET': return typeof kv.get(a[0]) === 'string' ? kv.get(a[0]) : null;
    case 'MGET': return a.map((k) => (typeof kv.get(k) === 'string' ? kv.get(k) : null));
    case 'SET': { if (a.includes('NX') && kv.has(a[0])) return null; kv.set(a[0], String(a[1])); return 'OK'; }
    case 'DEL': { let n = 0; a.forEach((k) => { if (kv.delete(k)) n++; }); return n; }
    case 'EXISTS': return a.filter((k) => kv.has(k)).length;
    case 'INCR': case 'INCRBY': { const v = Number(kv.get(a[0]) || 0) + Number(c === 'INCR' ? 1 : a[1]); kv.set(a[0], String(v)); return v; }
    case 'SMEMBERS': return [...(kv.get(a[0]) || new Set())];
    case 'SADD': { const s = kv.get(a[0]) || new Set(); a.slice(1).forEach((x) => s.add(x)); kv.set(a[0], s); return 1; }
    case 'SCARD': return (kv.get(a[0]) || new Set()).size;
    case 'HGET': return h(a[0]).get(a[1]) ?? null;
    case 'HMGET': return a.slice(1).map((f) => h(a[0]).get(f) ?? null);
    case 'HSET': { const m = h(a[0]); for (let i = 1; i < a.length; i += 2) m.set(a[i], String(a[i + 1])); return 1; }
    case 'HINCRBY': { const m = h(a[0]); const v = Number(m.get(a[1]) || 0) + Number(a[2]); m.set(a[1], String(v)); return v; }
    case 'HDEL': { a.slice(1).forEach((f) => h(a[0]).delete(f)); return 1; }
    case 'HLEN': return h(a[0]).size;
    case 'HGETALL': return [...h(a[0]).entries()].flat();
    case 'LPUSH': { const L = l(a[0]); a.slice(1).forEach((x) => L.unshift(x)); return L.length; }
    case 'RPUSH': { const L = l(a[0]); L.push(...a.slice(1)); return L.length; }
    case 'LTRIM': { const L = l(a[0]); kv.set(a[0], L.slice(Number(a[1]), Number(a[2]) + 1)); return 'OK'; }
    case 'LRANGE': { const L = l(a[0]); const e = Number(a[2]); return L.slice(Number(a[1]), e < 0 ? undefined : e + 1); }
    case 'EXPIRE': case 'PEXPIRE': return 1;
    default: throw new Error('fake redis: unsupported ' + c);
  }
}
globalThis.fetch = async (url, opts = {}) => {
  if (String(url).startsWith('https://fake-redis.test/pipeline')) {
    const out = JSON.parse(opts.body).map((cmd) => { try { return { result: exec(cmd) }; } catch (e) { return { error: e.message }; } });
    return new Response(JSON.stringify(out), { status: 200 });
  }
  return new Response('{}', { status: 404 });
};

const P = 'dsa:';
const lib = await import(pathToFileURL(path.join(appDir, 'api/_lib.js')).href);
const store = (await import(pathToFileURL(path.join(appDir, 'api/store.js')).href)).default;

const me = 'reymark@8bitcreative.com', other = 'cler@8bitcreative.com';
kv.set(P + 'users', new Set([me, other]));
kv.set(P + 'user:' + me, JSON.stringify({ email: me, name: 'Reymark', role: 'admin', status: 'active' }));
kv.set(P + 'user:' + other, JSON.stringify({ email: other, name: 'Cler', role: 'member', status: 'active' }));
let cookie = '';
await lib.createSession({ setHeader: (k, v) => { cookie = String(v).split(';')[0]; } }, me, false);

const SITE = 'abc123';
const F = (id, extra = {}) => Object.assign({ id, code: 'AI_TEXT_NAME_VARIANT', message: 'AI: business name is written differently', found: '"A BUFF & BEYOND"', path: '/terms-of-service', selector: 'p > span#' + id, severity: 'warning', category: 'Business name', location: 'Body' }, extra);
kv.set(P + 'site:' + SITE, lib.packJSON({ id: SITE, siteId: SITE, businessName: 'Buff & Beyond', findings: [
  F('a'), F('b'), F('c'), F('d'), F('e', { manual: true, code: 'MANUAL' }), F('f', { code: 'AI_PENDING_TEXT' }),
] }));
h(P + 'fnum:' + SITE); ['a', 'b', 'c', 'd', 'e', 'f'].forEach((id, i) => h(P + 'fnum:' + SITE).set(id, String(141 + i)));
h(P + 'fstate:' + SITE).set('b', JSON.stringify({ status: 'done', assignee: '', updatedBy: other, updatedAt: '2026-10-07T00:00:00Z' }));
h(P + 'fstate:' + SITE).set('c', JSON.stringify({ status: 'false', assignee: '', updatedBy: other }));

const call = async (method, body, query = {}) => {
  let code = 0, out = null;
  const res = { status(c) { code = c; return this; }, json(o) { out = o; return this; }, setHeader() {}, end() {} };
  await store({ method, headers: { cookie, host: 'app.test' }, body, query }, res);
  return { code, out };
};
const r = await call('POST', { op: 'recheck', siteId: SITE, results: { a: 'gone', b: 'still', c: 'gone', d: 'still', e: 'gone', f: 'gone', zz: 'gone' } });
console.log('HTTP', r.code, 'summary:', JSON.stringify(r.out && r.out.recheck), r.out && r.out.error ? 'ERROR ' + r.out.error : '');
const st = Object.fromEntries([...h(P + 'fstate:' + SITE).entries()].map(([k, v]) => [k, JSON.parse(v)]));
for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) {
  const s = st[id] || {};
  console.log(` ${id}: status=${s.status || '(none)'} auto=${s.auto || '-'} rc=${s.rc ? s.rc.r : '-'}${s.autoRef ? ' autoRef=' + s.autoRef : ''}`);
}
const notif = l(P + 'notif:' + other).map((x) => JSON.parse(x));
console.log('notified Cler:', notif.length, notif[0] ? '— ' + notif[0].text : '');
const site = await call('GET', null, { op: 'site', id: SITE });
const fa = (site.out.findings || site.out.site?.findings || []).find((x) => x.id === 'a');
console.log('loaded item a carries recheck:', JSON.stringify(fa && fa.recheck && { r: fa.recheck.r, by: fa.recheck.by }), 'auto:', fa && fa.auto && fa.auto.why);
const logs = l(P + 'act:' + SITE).map((x) => JSON.parse(x).text);
console.log('activity log:', logs);
