// Unit test: a keyless 429 from Google says "needs a key"; a keyed 429 is retried once. node psi_key.mjs <app>
import http from 'node:http'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
process.env.KV_REST_API_URL = 'https://x.test'; process.env.KV_REST_API_TOKEN = 'x';
let hits = 0; let mode = '429';
const srv = http.createServer((req, res) => { hits++; if (mode === '429' || (mode === 'once' && hits === 1)) { res.writeHead(429, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Quota exceeded for quota metric Queries' } })); return; }
  res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ lighthouseResult: { categories: { performance: { score: 0.5, auditRefs: [] } }, audits: {} } })); });
await new Promise((r) => srv.listen(8097, r));
process.env.PAGESPEED_BASE = 'http://127.0.0.1:8097/psi';
const { _test: { lighthouse } } = await import(pathToFileURL(path.join(path.resolve(process.argv[2]), 'api/sitehealth.js')).href);
let ok = true; const check = (c, l) => { console.log((c ? 'PASS ' : 'FAIL ') + l); ok = ok && !!c; };
delete process.env.PAGESPEED_API_KEY;
try { await lighthouse('https://x.test/', 'mobile'); check(false, 'keyless 429 throws'); } catch (e) { check(e.needsKey && /own free Google key/.test(e.message), 'no key + 429: says the app needs its own key'); }
process.env.PAGESPEED_API_KEY = 'k'; mode = 'once'; hits = 0;
try { const r = await lighthouse('https://x.test/', 'mobile'); check(hits === 2 && r.scores.performance === 50, 'with a key, a 429 is retried once and then works'); } catch (e) { check(false, 'keyed retry: ' + e.message); }
srv.close(); console.log(ok ? 'ALL PASS' : 'SOME FAILED');
