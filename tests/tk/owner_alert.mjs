// Technical problems reach the app owner only: a direct Slack message (never the team channel), also when
// they switched Slack messages off. An AI key that is rejected sends one, once. Usage: node owner_alert.mjs <app> <tests>
import { spawn } from 'node:child_process';
import http from 'node:http';
const A = process.argv[2], T = process.argv[3];
const RP = 8111, SP = 8112;
const OWNER = 'owner-test@example.com';
let fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const posts = [], hooks = [];
const slack = http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/api/users.lookupByEmail')) return res.end(JSON.stringify(req.url.includes(encodeURIComponent(OWNER)) ? { ok: true, user: { id: 'UOWNER' } } : { ok: false, error: 'users_not_found' }));
    if (req.url.startsWith('/api/chat.postMessage')) { posts.push(JSON.parse(b)); return res.end(JSON.stringify({ ok: true })); }
    if (req.url.startsWith('/hook')) { hooks.push(b); return res.end('ok'); }
    res.end('{}');
  });
}).listen(SP);
const rp = spawn('node', [T + '/fakeredis.mjs', String(RP)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));
const redis = async (...cmds) => (await (await fetch(`http://127.0.0.1:${RP}/pipeline`, { method: 'POST', body: JSON.stringify(cmds) })).json()).map((x) => x.result);
Object.assign(process.env, { KV_REST_API_URL: `http://127.0.0.1:${RP}`, KV_REST_API_TOKEN: 'x', SUGGESTIONS_OWNER: OWNER, SLACK_BOT_TOKEN: 'xoxb-test', SLACK_API_BASE: `http://127.0.0.1:${SP}/api`,
  SLACK_WEBHOOK_URL: `http://127.0.0.1:${SP}/hook`, APP_URL: 'https://audits.example.com', OPENAI_API_KEY: 'sk-test' });
// The owner turned Slack messages off for everyday notifications: technical alerts still come.
await redis(['SADD', 'dsa:users', OWNER], ['SET', 'dsa:user:' + OWNER, JSON.stringify({ email: OWNER, name: 'Owner', role: 'admin', status: 'active', slackDM: false })]);
try {
  const Q = await import(A + '/api/_queue.js');
  const r = await Q.alertOwner('test-kind', 'The main database is 90% full.');
  ok(r.slack === true, 'alertOwner sends a Slack message: ' + JSON.stringify(r));
  ok(posts.length === 1 && posts[0].channel === 'UOWNER', 'as a direct message to the owner only');
  ok(hooks.length === 0, 'and nothing goes to the team channel');
  ok(/90% full/.test(JSON.stringify(posts[0].blocks)) && /#\/health/.test(JSON.stringify(posts[0].blocks)), 'it says what happened and links to System health');
  await Q.alertOwner('test-kind', 'Again');
  ok(posts.length === 1, 'the same problem is not sent again straight away');
  // An AI key rejected by its company: one Slack DM saying which key to replace.
  const ai = await import(A + '/api/ai.js');
  const p = ai._test.providers().find((x) => x.id === 'openai');
  const f = ai._test.classify(p, { status: 401, headers: new Headers() }, { error: { message: 'Your API key has expired.' } });
  ok(f.reason === 'error' && /rejected/.test(f.note), 'an expired key is read as a key problem');
  posts.length = 0;
  await ai._test.park(p, f.reason, f.until, f.note);
  await ai._test.park(p, f.reason, f.until, f.note);
  const t = JSON.stringify(posts[0] || {});
  ok(posts.length === 1 && posts[0].channel === 'UOWNER', 'a rejected AI key sends the owner one Slack DM (not one per failure)');
  ok(/Rigel/.test(t) && /OPENAI_API_KEY/.test(t) && /expired/.test(t) && /redeploy/.test(t), 'naming the AI, the key to replace in Vercel and the reason');
  posts.length = 0;
  await ai._test.park(p, 'limit', Date.now() + 3600000, 'Daily free limit reached.');
  ok(posts.length === 0, 'a daily limit (fixes itself) sends nothing');
} catch (e) { console.log('FAIL', e.stack); fail++; }
rp.kill(); slack.close();
console.log(fail ? 'SOME FAILED' : 'ALL PASS');
process.exit(fail ? 1 : 0);
