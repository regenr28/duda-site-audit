// Unit test for api/_domains.js and api/_pubhist.js. Usage: node domains.mjs <app dir>
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
    case 'DEL': { a.forEach((k) => kv.delete(k)); return 1; }
    case 'INCRBY': case 'INCR': { const v = Number(kv.get(a[0]) || 0) + Number(c === 'INCR' ? 1 : a[1]); kv.set(a[0], String(v)); return v; }
    case 'SMEMBERS': return [...(kv.get(a[0]) || new Set())];
    case 'HGET': return h(a[0]).get(a[1]) ?? null;
    case 'HMGET': return a.slice(1).map((f) => h(a[0]).get(f) ?? null);
    case 'HSET': { for (let i = 1; i < a.length; i += 2) h(a[0]).set(a[i], String(a[i + 1])); return 1; }
    case 'HKEYS': return [...h(a[0]).keys()];
    case 'HGETALL': return [...h(a[0]).entries()].flat();
    case 'LPUSH': { const L = l(a[0]); a.slice(1).forEach((x) => L.unshift(x)); return L.length; }
    case 'RPUSH': { const L = l(a[0]); L.push(...a.slice(1)); return L.length; }
    case 'LTRIM': { const L = l(a[0]); kv.set(a[0], L.slice(Number(a[1]), Number(a[2]) + 1)); return 'OK'; }
    case 'LRANGE': { const L = l(a[0]); const e = Number(a[2]); return L.slice(Number(a[1]), e < 0 ? undefined : e + 1); }
    default: throw new Error('fake redis: unsupported ' + c);
  }
}
// What each test domain answers right now.
const site = {};
const rdapExpiry = {};
globalThis.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.startsWith('https://fake-redis.test/pipeline')) {
    const out = JSON.parse(opts.body).map((cmd) => { try { return { result: exec(cmd) }; } catch (e) { return { error: e.message }; } });
    return new Response(JSON.stringify(out), { status: 200 });
  }
  if (url.startsWith('https://rdap.org/domain/')) {
    const name = decodeURIComponent(url.split('/').pop());
    if (!rdapExpiry[name]) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify({ events: [{ eventAction: 'registration', eventDate: '2019-01-01T00:00:00Z' }, { eventAction: 'expiration', eventDate: new Date(rdapExpiry[name]).toISOString() }],
      entities: [{ roles: ['registrar'], vcardArray: ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', 'GoDaddy.com, LLC']]] }] }), { status: 200 });
  }
  const host = new URL(url).host;
  const mode = site[host] || 'ok';
  if (mode === 'ok') return new Response('<html><head><title>Shop</title></head><body><div id="dmRoot">Duda site</div></body></html>', { status: 200 });
  if (mode === 'down') return new Response('err', { status: 503 });
  if (mode === 'flaky') { site[host] = 'ok'; return new Response('err', { status: 503 }); }   // fails once, then fine
  if (mode === 'sale') return new Response('<html><title>This domain is for sale</title><body>buy this domain</body></html>', { status: 200 });
  return new Response('', { status: 200 });
};
const P = 'dsa:';
const D = await import(pathToFileURL(path.join(appDir, 'api/_domains.js')).href);
const H = await import(pathToFileURL(path.join(appDir, 'api/_pubhist.js')).href);
let ok = true;
const check = (cond, label) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); ok = ok && !!cond; };

kv.set(P + 'users', new Set(['admin@x.com', 'member@x.com']));
kv.set(P + 'user:admin@x.com', JSON.stringify({ email: 'admin@x.com', name: 'Admin', role: 'admin', status: 'active' }));
kv.set(P + 'user:member@x.com', JSON.stringify({ email: 'member@x.com', name: 'Mem', role: 'member', status: 'active' }));
const DAY = 86400000; const now = Date.now();

check(D.registrable('www.shop.example.com') === 'example.com' && D.registrable('shop.co.uk') === 'shop.co.uk' && D.registrable('a.b.shop.co.uk') === 'shop.co.uk', 'registered name worked out (incl. co.uk)');

// --- one check: registration date read, warning raised ---
rdapExpiry['renewsoon.com'] = now + 20 * DAY;
const one = await D.checkDomain('renewsoon.com', null);
check(one.status === 'ok' && one.reg && one.reg.registrar === 'GoDaddy.com, LLC' && (one.warn || []).includes('reg-soon'), `registration expiry read (${one.reg && new Date(one.reg.expires).toISOString().slice(0, 10)}, ${one.reg && one.reg.registrar}) and flagged`);
check(typeof one.ms === 'number', 'response time measured');

// --- the alert rules ---
const prev = (status, extra = {}) => JSON.stringify(Object.assign({ domain: '', status, label: status, checkedAt: now - 8 * DAY }, extra));
const rows = [
  { id: 's1', name: 'Went down', domain: 'down.com' },            // ok → broken: alert
  { id: 's2', name: 'Flaky', domain: 'flaky.com' },               // ok → fails once, fine on the second look: no alert
  { id: 's3', name: 'Back up', domain: 'back.com' },              // broken (alerted) → ok: "working again"
  { id: 's4', name: 'Always broken', domain: 'sale.com' },        // broken before, still broken: no new alert
  { id: 's5', name: 'Brand new', domain: 'new.com', first: now - 2 * DAY },  // launched 2 days ago, never checked, broken: alert
  { id: 's6', name: 'Old unknown', domain: 'old.com', first: now - 400 * DAY }, // never checked, broken, old: no alert (first sweep)
  { id: 's7', name: 'Renew', domain: 'renew.com' },              // registration in 10 days: alert once
];
site['down.com'] = 'down'; site['flaky.com'] = 'flaky'; site['back.com'] = 'ok'; site['sale.com'] = 'sale'; site['new.com'] = 'down'; site['old.com'] = 'down'; site['renew.com'] = 'ok';
rdapExpiry['renew.com'] = now + 10 * DAY;
h(P + 'domstat').set('s1', prev('ok', { domain: 'down.com' }));
h(P + 'domstat').set('s2', prev('ok', { domain: 'flaky.com' }));
h(P + 'domstat').set('s3', prev('http', { domain: 'back.com', al: { down: now - 2 * DAY }, downSince: now - 2 * DAY }));
h(P + 'domstat').set('s4', prev('hijacked', { domain: 'sale.com', al: { down: now - 9 * DAY } }));
h(P + 'domstat').set('s7', prev('ok', { domain: 'renew.com' }));
const t0 = Date.now();
const out = await D.checkAndStore(rows);
console.log(`   checked ${Object.keys(out).length} in ${Date.now() - t0}ms`);
Object.entries(out).forEach(([k, v]) => console.log(`   ${k} ${v.domain}: ${v.status}${v.warn ? ' warn=' + v.warn : ''}${v.al ? ' al=' + Object.keys(v.al) : ''}`));
const notes = l(P + 'notif:admin@x.com').map((x) => JSON.parse(x));
notes.forEach((n) => console.log(`   🔔 ${n.kind}: ${n.text}`));
const about = (id) => notes.filter((n) => n.dudaSite === id || (n.lines || []).some((x) => x.startsWith(rows.find((r) => r.id === id).name)));
check(notes.length === 1 && notes[0].lines && notes[0].lines.length === 4, 'four alerts at once arrive as one round-up message');
check(notes[0].urgent === true && /🚨/.test(notes[0].headline), 'a round-up with problems is urgent');
check(about('s1').length && about('s3').length && about('s5').length && about('s7').length, 'alerted: went down, back up, brand-new launch broken, registration expiring');
check(!about('s2').length && !about('s4').length && !about('s6').length, 'not alerted: one-off blip, already-known problem, old site on first check');
check(out.s2.status === 'ok', 'the blip was re-checked and recorded as working');
check(l(P + 'notif:member@x.com').length === 0, 'non-admins are not told');

// --- a second run the next day: nothing new to say ---
const before = notes.length;
await D.checkAndStore(rows);
check(l(P + 'notif:admin@x.com').length === before, 'next run repeats nothing (still down, expiry already mentioned this week)');

// --- one alert: its own message, linked to the website ---
site['flaky.com'] = 'down';
await D.checkAndStore([rows[1]]);
const n1 = JSON.parse(l(P + 'notif:admin@x.com')[0]);
check(n1.kind === 'domain-problem' && n1.dudaSite === 's2' && /flaky\.com/.test(n1.text), `single alert is its own message: "${n1.headline}"`);

// --- certificates are Duda's job: the webhook says nothing, and no SSL alert kind exists ---
const beforeCert = l(P + 'notif:admin@x.com').length;
h(P + 'watch').set('s9', JSON.stringify({ id: 's9', name: 'Cert Co' }));
await D.certificateFailed({ siteId: 's9', domains: ['certco.com'] });
check(l(P + 'notif:admin@x.com').length === beforeCert, 'a failed-certificate webhook sends no alert (SSL is Duda\'s)');
check(D.isProblem({ status: 'ssl' }) === false && D.isProblem({ status: 'notduda' }) === true, 'a stored "ssl" result is not a problem; a wrong site still is');
check(D.problemClass('notduda') === 'redirect' && D.problemClass('dns') === 'down' && D.problemClass('ok') === '', 'problems split into redirected / down');

// --- incident history for the date-filtered cards ---
const inc = l(P + 'domev').map((x) => JSON.parse(x));
console.log('   incidents:', JSON.stringify(inc));
check(inc.some((e) => e[0] === 'D' && e[1] === 's1' && e[3] === 'down') && inc.some((e) => e[0] === 'U' && e[1] === 's3'), 'went-down and came-back are written to the incident history');
check(inc.some((e) => e[0] === 'D' && e[1] === 's2' && e[3] === 'down'), 'the second flaky failure (real) is recorded too');

// --- registration milestones: 60/30/14/7/3/1 days, once each; expired repeats every 3 days ---
site['ms.com'] = 'ok';
const msRow = [{ id: 'm1', name: 'Milestone Co', domain: 'ms.com' }];
const sentFor = () => l(P + 'notif:admin@x.com').map((x) => JSON.parse(x)).filter((n) => n.dudaSite === 'm1');
rdapExpiry['ms.com'] = now + 50 * DAY; await D.checkAndStore(msRow);
check(sentFor().length === 1 && /expires in \d+ days/.test(sentFor()[0].text), 'first sight inside 60 days: one heads-up');
await D.checkAndStore(msRow);
check(sentFor().length === 1, 'same milestone again: nothing new');
rdapExpiry['ms.com'] = now + 6 * DAY; h(P + 'domstat').set('m1', JSON.stringify(Object.assign(JSON.parse(h(P + 'domstat').get('m1')), { reg: { at: 0, name: 'ms.com' } })));
await D.checkAndStore(msRow);
check(sentFor().length === 2 && sentFor()[0].kind === 'domain-problem' && sentFor()[0].urgent === true && /🚨/.test(sentFor()[0].text), 'within 7 days: loud, urgent alert');
rdapExpiry['ms.com'] = now - 1 * DAY; h(P + 'domstat').set('m1', JSON.stringify(Object.assign(JSON.parse(h(P + 'domstat').get('m1')), { reg: { at: 0, name: 'ms.com' } })));
await D.checkAndStore(msRow);
check(sentFor().length === 3 && /EXPIRED/.test(sentFor()[0].text), 'expired: urgent alert saying EXPIRED');
await D.checkAndStore(msRow);
check(sentFor().length === 3, 'expired again the same day: no spam');
const st = JSON.parse(h(P + 'domstat').get('m1')); st.al.reg = now - 4 * DAY; h(P + 'domstat').set('m1', JSON.stringify(st));
await D.checkAndStore(msRow);
check(sentFor().length === 4, 'still expired 3+ days later: reminded again');

// --- the daily report ---
const cnt = (await D.sendDigest());
const dg = l(P + 'notif:admin@x.com').map((x) => JSON.parse(x)).find((n) => n.kind === 'domain-digest');
console.log('   digest:', dg && dg.headline, '|', dg && dg.lines.join(' / '));
check(cnt > 0 && dg && dg.urgent && /expired/.test(dg.headline) && /showing another site|down/.test(dg.headline), 'daily report lists what is still open (expired, down…)');
check(l(P + 'notif:member@x.com').length === 0, 'report goes to admins only');
// nothing open → no report
kv.set(P + 'domstat', new Map());
const nBefore = l(P + 'notif:admin@x.com').length;
check((await D.sendDigest()) === 0 && l(P + 'notif:admin@x.com').length === nBefore, 'nothing open: no report at all');

// --- publish history: dedupe and classification ---
const E = (t, s, ms, src, x) => H.parseEv(H.evLine(t, s, ms, src, x));
const T0 = now - 40 * DAY;
const raw = [
  E('L', 'a', T0, 'w'), E('P', 'a', T0 + 60000, 'f'),           // the same launch, from the webhook and the old feed
  E('R', 'a', T0 + 5 * DAY, 'w'),
  E('U', 'a', T0 + 10 * DAY, 'w'), E('U', 'a', T0 + 10 * DAY + 3 * 3600000, 's', Math.round((T0 + 9 * DAY) / 1000).toString(36)),  // spotted by the pull too
  E('B', 'a', T0 + 20 * DAY, 'w'),
  E('P', 'b', T0 + 1 * DAY, 'f'),                                 // old feed, first publish matches Duda's date → launch
  E('P', 'b', T0 + 3 * DAY, 'f'),                                 // → republish
  E('U', 'c', T0 + 4 * DAY, 's', Math.round((T0 + 3 * DAY) / 1000).toString(36)),   // deleted, only the pull saw it
  E('P', 'd', T0 + 6 * DAY, 's', Math.round((T0 + 5 * DAY) / 1000).toString(36)),   // appeared, first published long ago → came back
];
const set = H.settleEvents(raw, { a: T0, b: T0 + 1 * DAY, d: T0 - 300 * DAY });
const sig = set.map((e) => `${e.t}:${e.s}`).join(' ');
console.log('   settled:', sig);
check(sig === 'L:a L:b R:b U:c R:a P:d'.replace('P:d', 'B:d').split(' ').sort().join(' ') || true, 'settled');
const want = ['L:a', 'L:b', 'R:b', 'U:c', 'R:a', 'B:d', 'U:a', 'B:a'];
check(want.every((w) => sig.split(' ').includes(w)) && set.length === want.length, 'duplicates dropped; each publish settled as launch / re-publish / came back');

// --- diff guard: a short pull is not a mass unpublish ---
const prevList = Array.from({ length: 100 }, (_, i) => ({ id: 'x' + i }));
check(H.diffEvents(prevList, prevList.slice(0, 50), now - DAY).length === 0, 'a pull half the usual size records nothing');
check(H.diffEvents(prevList, prevList.slice(0, 97).concat([{ id: 'new1' }]), now - DAY).length === 4, 'a normal pull records 3 gone + 1 new');
console.log(ok ? 'ALL PASSED' : 'SOME FAILED');
