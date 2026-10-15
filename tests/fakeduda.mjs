// Fake Duda API + fake customer websites. node fakeduda.mjs <fixture.json> <dudaPort> <webPort>
import http from 'node:http';
import fs from 'node:fs';
const fx = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const dudaPort = Number(process.argv[3] || 8085); const webPort = Number(process.argv[4] || 8091);
let listCalls = 0;
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  res.setHeader('Content-Type', 'application/json');
  if (u.pathname === '/__calls') return res.end(JSON.stringify({ listCalls }));
  if (u.pathname === '/api/sites/multiscreen') {
    listCalls++;
    const st = u.searchParams.get('publish_status');
    const all = st === 'PUBLISHED' ? fx.published : fx.unpublished;
    const off = Number(u.searchParams.get('offset') || 0); const lim = Number(u.searchParams.get('limit') || 100);
    return res.end(JSON.stringify({ results: all.slice(off, off + lim), total_responses: all.length }));
  }
  const m = u.pathname.match(/^\/api\/sites\/multiscreen\/([^/]+)$/);
  if (m) { const x = fx.published.concat(fx.unpublished).find((s) => s.site_name === m[1]); if (x) return res.end(JSON.stringify(x)); }
  res.statusCode = 404; res.end('{}');
}).listen(dudaPort, () => console.log('fake duda on ' + dudaPort));
// Customer websites on loopback addresses: 127.0.0.2 is broken, everything else is a working Duda site.
http.createServer((req, res) => {
  const host = String(req.headers.host || '');
  if (host.startsWith('127.0.0.2')) { res.statusCode = 503; return res.end('down'); }
  res.setHeader('Content-Type', 'text/html'); res.end('<html><head><title>Detailing</title></head><body><div id="dmRoot">ok</div></body></html>');
}).listen(webPort, '0.0.0.0', () => console.log('fake websites on ' + webPort));
