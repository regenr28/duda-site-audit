// Starts fake Redis + fake Duda preview + the app's dev server, seeds people and one website.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
export const RPORT = 8078, APORT = 3998, SPORT = 8093;
export const APP = process.argv[2], TESTS = process.argv[3];
export const ADMIN = 'reymark@8bitcreative.com', MEMBER = 'dev@8bitcreative.com', CLIENT = 'owner@buffandbeyond.com', CLIENT2 = 'other@elsewhere.com';
export const TOK = { [ADMIN]: 'tokadmin1234567890abcdef', [MEMBER]: 'tokmember1234567890abcde', [CLIENT]: 'tokclient1234567890abcde', [CLIENT2]: 'tokclient2234567890abcde' };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
export async function redis(...cmds) {
  const r = await fetch(`http://127.0.0.1:${RPORT}/pipeline`, { method: 'POST', body: JSON.stringify(cmds) });
  return (await r.json()).map((x) => x.result);
}
export const procs = [];
export async function start() {
  // FAKE_PG=1: the app runs on Supabase (a real local Postgres with supabase/setup.sql) instead of Upstash.
  if (process.env.FAKE_PG) procs.push(spawn('node', [TESTS + '/fakesupabase.mjs', String(RPORT), APP], { stdio: ['ignore', 'ignore', 'inherit'] }));
  else procs.push(spawn('node', [TESTS + '/fakeredis.mjs', String(RPORT)], { stdio: 'ignore' }));
  procs.push(spawn('node', [TESTS + '/tk/fixsite.mjs', String(SPORT)], { stdio: 'ignore' }));
  await new Promise((r) => setTimeout(r, process.env.FAKE_PG ? 2500 : 700));
  const users = [
    { email: ADMIN, name: 'Reymark R', role: 'admin', status: 'active' },
    { email: MEMBER, name: 'Dana Dev', role: 'member', status: 'active' },
    { email: CLIENT, name: 'Bob Owner', role: 'client', status: 'active', sites: ['s1'], company: 'Buff & Beyond' },
    { email: CLIENT2, name: 'Other Client', role: 'client', status: 'active', sites: ['s2'] },
  ];
  const cmds = [];
  users.forEach((u) => { cmds.push(['SADD', 'dsa:users', u.email], ['SET', 'dsa:user:' + u.email, JSON.stringify(Object.assign({ createdAt: '2026-01-01T00:00:00Z' }, u))], ['SET', 'dsa:sess:' + sha(TOK[u.email]), u.email]); });
  cmds.push(['SET', 'dsa:site:s1', JSON.stringify({ id: 's1', siteId: 'abc123', host: 'ed.multiscreensite.com', businessName: 'Buff & Beyond', truth: { domain: 'buffandbeyond.com' }, findings: [] })]);
  cmds.push(['SET', 'dsa:site:s2', JSON.stringify({ id: 's2', siteId: 'zzz999', host: 'ed.multiscreensite.com', businessName: 'Other Co', findings: [] })]);
  cmds.push(['HSET', 'dsa:index', 's1', JSON.stringify({ id: 's1', siteId: 'abc123', businessName: 'Buff & Beyond' }), 's2', JSON.stringify({ id: 's2', siteId: 'zzz999', businessName: 'Other Co' })]);
  await redis(...cmds);
  const db = process.env.FAKE_PG ? { SUPABASE_URL: `http://127.0.0.1:${RPORT}`, SUPABASE_SECRET_KEY: 'sb_secret_test' } : { KV_REST_API_URL: `http://127.0.0.1:${RPORT}`, KV_REST_API_TOKEN: 'x' };
  const env = Object.assign({}, process.env, db, { PORT: String(APORT), ADMIN_EMAILS: ADMIN, SUGGESTIONS_OWNER: ADMIN,
    CAPTURE_CHROME_PATH: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', CAPTURE_PREVIEW_ORIGIN: `http://127.0.0.1:${SPORT}` });
  const p = spawn('node', [APP + '/dev-server.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stderr.on('data', (d) => process.stderr.write('[app] ' + d));
  procs.push(p);
  await new Promise((r) => setTimeout(r, 1000));
}
export function stop() { procs.forEach((p) => { try { p.kill(); } catch (e) {} }); }
export async function call(as, method, path, body, headers = {}) {
  const r = await fetch(`http://localhost:${APORT}${path}`, { method, headers: Object.assign({ 'Content-Type': 'application/json', Cookie: 'dsa_sess=' + TOK[as] }, headers), body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, body: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()), ct };
}
