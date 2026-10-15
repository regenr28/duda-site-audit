// A stand-in for Supabase's Data API in front of a REAL local Postgres, running the real setup.sql.
// node fakesupabase.mjs <port>   (env: PG_PORT=54329, APP=<app dir> for supabase/setup.sql)
//   POST /rest/v1/rpc/dsa_exec  {cmds:[…]}   → what Supabase answers (needs an apikey header)
//   POST /pipeline              [[…],…]      → the same commands, Upstash-style, so tests can seed/check
//   GET  /__count                            → commands run so far
// Each instance gets its own fresh database, named after its port.
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const port = Number(process.argv[2] || 8078);
const PG_PORT = Number(process.env.PG_PORT || 54329);
const DB = 'dsa_p' + port;
const APP = process.argv[3] || process.env.APP || new URL('..', import.meta.url).pathname;
const psql = (args) => execFileSync('psql', ['-h', '127.0.0.1', '-p', String(PG_PORT), '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
psql(['-d', 'postgres', '-c', `drop database if exists ${DB} with (force)`]);
psql(['-d', 'postgres', '-c', `create database ${DB}`]);
psql(['-d', DB, '-c', "do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; end if; end $$;"]);
psql(['-d', DB, '-f', path.join(APP, 'supabase/setup.sql')]);

/** A minimal Postgres client: simple-query protocol, trust auth, results as text. */
function connect() {
  const sock = net.connect(PG_PORT, '127.0.0.1');
  let buf = Buffer.alloc(0); const waiting = []; let cur = null; let ready;
  const readyP = new Promise((r) => { ready = r; });
  const params = Buffer.from('user\0postgres\0database\0' + DB + '\0\0');
  const start = Buffer.alloc(8); start.writeInt32BE(8 + params.length); start.writeInt32BE(196608, 4);
  sock.write(Buffer.concat([start, params]));
  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 5) {
      const type = String.fromCharCode(buf[0]); const len = buf.readInt32BE(1);
      if (buf.length < 1 + len) break;
      const body = buf.subarray(5, 1 + len); buf = buf.subarray(1 + len);
      if (type === 'Z') { if (cur) { const c = cur; cur = null; c.done(); } else ready(); next(); }
      else if (type === 'D' && cur) {
        const n = body.readInt16BE(0); let o = 2; const row = [];
        for (let i = 0; i < n; i++) { const l = body.readInt32BE(o); o += 4; if (l < 0) row.push(null); else { row.push(body.subarray(o, o + l).toString('utf8')); o += l; } }
        cur.rows.push(row);
      } else if (type === 'E' && cur) {
        let o = 0; const f = {};
        while (o < body.length && body[o] !== 0) { const k = String.fromCharCode(body[o]); const e = body.indexOf(0, o + 1); f[k] = body.subarray(o + 1, e).toString('utf8'); o = e + 1; }
        cur.error = f.M || 'error';
      }
    }
  });
  function next() {
    if (cur || !waiting.length) return;
    cur = waiting.shift();
    const q = Buffer.from(cur.sql + '\0'); const h = Buffer.alloc(5); h.write('Q'); h.writeInt32BE(4 + q.length, 1);
    sock.write(Buffer.concat([h, q]));
  }
  return {
    busy: () => waiting.length + (cur ? 1 : 0),
    query: (sql) => readyP.then(() => new Promise((resolve) => {
      const job = { sql, rows: [], error: null, done: () => resolve(job) };
      waiting.push(job); next();
    })),
  };
}
const pool = Array.from({ length: 6 }, connect);
const query = (sql) => pool.reduce((a, b) => (b.busy() < a.busy() ? b : a)).query(sql);

let count = 0;
async function exec(cmds) {
  count += cmds.length;
  const text = JSON.stringify(cmds);
  let tag; do { tag = '$j' + crypto.randomBytes(4).toString('hex') + '$'; } while (text.includes(tag));
  const r = await query(`select public.dsa_exec(${tag}${text}${tag}::jsonb)`);
  if (r.error) return { error: r.error };
  return { result: r.rows[0][0] };
}

http.createServer(async (req, res) => {
  let body = ''; for await (const ch of req) body += ch;
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/__count')) { res.end(JSON.stringify({ count, unknown: [] })); return; }
  if (req.url.startsWith('/rest/v1/rpc/dsa_exec')) {
    if (!req.headers.apikey) { res.statusCode = 401; res.end(JSON.stringify({ message: 'No API key found in request' })); return; }
    let cmds; try { cmds = JSON.parse(body).cmds; } catch (e) { res.statusCode = 400; res.end('{"message":"bad json"}'); return; }
    const r = await exec(cmds);
    if (r.error) { res.statusCode = 400; res.end(JSON.stringify({ code: 'P0001', message: r.error })); return; }
    res.end(r.result); return;
  }
  let cmds = JSON.parse(body || '[]');
  const single = !req.url.startsWith('/pipeline');
  if (single) cmds = [cmds];
  const r = await exec(cmds);
  if (r.error) { res.statusCode = 400; res.end(JSON.stringify({ error: r.error })); return; }
  res.end(single ? JSON.stringify(JSON.parse(r.result)[0]) : r.result);
}).listen(port, () => console.log('fake supabase on ' + port + ' (database ' + DB + ')'));
