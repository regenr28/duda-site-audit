// Local development server that mimics Vercel: serves /public and runs /api/*.js handlers.
// Usage: copy .env.example to .env.local, fill it in, then `npm run dev` → http://localhost:3000
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
for (const f of ['.env.local', '.env']) {
  const p = path.join(root, f);
  if (fs.existsSync(p)) fs.readFileSync(p, 'utf8').split('\n').forEach((l) => { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); });
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
const PORT = process.env.PORT || 3000;

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5).replace(/[^a-z0-9_-]/gi, '');
    const file = path.join(root, 'api', name + '.js');
    if (!fs.existsSync(file) || name.startsWith('_')) { res.writeHead(404); return res.end('Not found'); }
    let body = '';
    for await (const chunk of req) body += chunk;
    req.query = Object.fromEntries(url.searchParams);
    try { req.body = body ? JSON.parse(body) : {}; } catch (e) { req.body = body; }
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (o) => { if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); return res; };
    try { const mod = await import(pathToFileURL(file).href + '?t=' + Date.now()); await mod.default(req, res); }
    catch (e) { console.error(e); if (!res.headersSent) res.status(500).json({ error: String(e.message || e) }); }
    return;
  }
  let p = path.join(root, 'public', decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!p.startsWith(path.join(root, 'public')) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(root, 'public', 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(PORT, () => console.log(`Duda Site Auditor running at http://localhost:${PORT}`));
