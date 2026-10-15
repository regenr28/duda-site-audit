// Unit test: every likely layout of Duda's dated / broken-down answers is read. node analytics_shapes.mjs <app>
import path from 'node:path'; import { pathToFileURL } from 'node:url';
process.env.KV_REST_API_URL = 'https://x.test'; process.env.KV_REST_API_TOKEN = 'x';
const { _test: { dated, dimRows, T, total } } = await import(pathToFileURL(path.join(path.resolve(process.argv[2]), 'api/analytics.js')).href);
let ok = true; const check = (c, l) => { console.log((c ? 'PASS ' : 'FAIL ') + l); ok = ok && !!c; };
const n = { VISITS: 10, VISITORS: 8, PAGE_VIEWS: 30 };
const shapes = {
  'rows with date + data': [{ date: '2026-09-01', data: n }, { date: '2026-09-02', data: n }],
  'rows with dimension.date + data': [{ dimension: { date: '2026-09-01' }, data: n }, { dimension: { date: '2026-09-02' }, data: n }],
  'rows with from/to + data': [{ from: '2026-09-01', to: '2026-09-01', data: n }, { from: '2026-09-02', to: '2026-09-02', data: n }],
  'rows flat with date': [Object.assign({ date: '2026-09-01' }, n), Object.assign({ date: '2026-09-02' }, n)],
  'object keyed by date': { '2026-09-01': n, '2026-09-02': n },
  'wrapped: values keyed by date': { site_name: 'x', values: { '2026-09-01': n, '2026-09-02': n } },
  'wrapped: results list': { results: [{ date: '2026-09-01', data: n }, { date: '2026-09-02', data: n }] },
  'rows with epoch ms': [{ date: Date.parse('2026-09-01T00:00:00Z'), data: n }, { date: Date.parse('2026-09-02T00:00:00Z'), data: n }],
  'rows with date_range': [{ date_range: { start: '2026-09-01', end: '2026-09-01' }, data: n }, { date_range: { start: '2026-09-02', end: '2026-09-02' }, data: n }],
  'object keyed by ISO time': { '2026-09-01T00:00:00Z': { data: n }, '2026-09-02T00:00:00Z': { data: n } },
  // The layout Duda actually sent (seen on the live app, 10 Oct 2026): a list of one row per date.
  'LIVE: object keyed by date, each a list': { '2026-09-01': [{ VISITORS: 8, VISITS: 10, PAGE_VIEWS: 30 }], '2026-09-02': [{ VISITORS: 8, VISITS: 10, PAGE_VIEWS: 30 }] },
  'LIVE: month keys': { '2026-09-01': [{ VISITORS: 4, VISITS: 5, PAGE_VIEWS: 15 }, { VISITORS: 4, VISITS: 5, PAGE_VIEWS: 15 }], '2026-09-02': [n] },
};
for (const [k, j] of Object.entries(shapes)) { const r = dated(j); check(r.length === 2 && r[0].d === '2026-09-01' && r[1].visits === 10 && r[1].views === 30, `daily: ${k} → ${JSON.stringify(r.map((x) => x.d + ':' + x.visits))}`); }
const geo = [{ data: { VISITORS: 50, PAGE_VIEWS: 150, VISITS: 100 }, dimension: { country: 'US', region: 'CA' } }, { data: { VISITORS: 50, PAGE_VIEWS: 150, VISITS: 100 }, dimension: { country: 'US', region: 'FL' } }, { data: { VISITS: 7 }, dimension: { country: 'Canada', region: 'Ontario' } }];
const g = dimRows(geo, (d) => d.country);
check(g.length === 3 && g[0].v === 100 && g.find((r) => r.k === 'Canada').v === 7, 'countries: Duda\'s documented layout (numbers under "data", lower-case keys)');
check(T({ VISITORS: 50, VISITS: 100, PAGE_VIEWS: 150 }).visits === 100 && total(geo).visits === 207, 'plain totals still read');
console.log(ok ? 'ALL PASS' : 'SOME FAILED');
