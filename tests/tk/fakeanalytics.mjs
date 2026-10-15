// Fake Duda analytics + fake Google (token, GA4 Data API, Search Console). node fakeanalytics.mjs <port>
import http from 'node:http';
const port = Number(process.argv[2] || 8095);
const calls = { duda: 0, google: 0 };
const days = (from, to) => { const out = []; for (let t = Date.parse(from); t <= Date.parse(to); t += 86400000) out.push(new Date(t).toISOString().slice(0, 10)); return out; };
const v = (d, k) => 20 + (Number(d.slice(8, 10)) * 7 + k) % 40;
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    const send = (o, code = 200) => { res.statusCode = code; res.end(JSON.stringify(o)); };
    if (u.pathname === '/__calls') return send(calls);
    let m = u.pathname.match(/^\/api\/analytics\/site\/([^/]+)$/);
    if (m) {
      calls.duda++;
      if (m[1] === 'nostats') return send({ error: 'Not found' }, 404);
      const from = u.searchParams.get('from'), to = u.searchParams.get('to'), g = u.searchParams.get('dateGranularity'), dim = u.searchParams.get('dimension'), result = u.searchParams.get('result');
      if (result === 'activities') return send({ CLICK_TO_CALLS: 12, CLICK_TO_MAPS: 4, CLICK_TO_EMAILS: 3, FORM_SUBMITS: 9 });
      // The layouts Duda documents: numbers under "data", lower-case dimension keys.
      if (dim === 'system') return send([{ dimension: { browser: 'Chrome 10', os: 'Windows' }, data: { VISITORS: 374, VISITS: 391, PAGE_VIEWS: 895 } }, { dimension: { browser: 'Safari 17', os: 'iOS' }, data: { VISITORS: 300, VISITS: 320, PAGE_VIEWS: 600 } }, { dimension: { browser: 'Firefox Mobile', os: 'Android' }, data: { VISITORS: 29, VISITS: 32, PAGE_VIEWS: 60 } }]);
      if (dim === 'geo') return send([{ data: { VISITORS: 50, PAGE_VIEWS: 150, VISITS: 800 }, dimension: { country: 'US', region: 'DE' } }, { data: { VISITORS: 50, PAGE_VIEWS: 150, VISITS: 100 }, dimension: { country: 'US', region: 'OH' } }, { data: { VISITORS: 5, PAGE_VIEWS: 15, VISITS: 60 }, dimension: { country: 'Canada', region: 'Ontario' } }]);
      if (g === 'DAYS' && m[1] === 'oddshape') return send({ something: 'unexpected', n: 3 });
      if (g === 'DAYS') return send(days(from, to).map((d) => ({ date: d, data: { VISITS: v(d, 0), VISITORS: v(d, 0) - 8, PAGE_VIEWS: v(d, 0) * 3 } })));
      if (g === 'MONTHS') { const out = {}; for (let t = Date.parse(from); t <= Date.parse(to); t += 31 * 86400000) { const d = new Date(t).toISOString().slice(0, 7) + '-01'; out[d] = { VISITS: 600 + Number(d.slice(5, 7)) * 30, VISITORS: 500, PAGE_VIEWS: 1800 }; } return send(out); }
      const ds = days(from, to); return send({ VISITS: ds.reduce((s, d) => s + v(d, 0), 0), VISITORS: ds.reduce((s, d) => s + v(d, 0) - 8, 0), PAGE_VIEWS: ds.reduce((s, d) => s + v(d, 0) * 3, 0) });
    }
    if (u.pathname === '/slack/users.lookupByEmail') {
      const e = u.searchParams.get('email') || '';
      return send(/maria|reymark|dev@/.test(e) ? { ok: true, user: { id: 'U' + e.length, real_name: e.startsWith('maria') ? 'Maria Santos' : e, profile: { real_name: e.startsWith('maria') ? 'Maria Santos' : e } } } : { ok: false, error: 'users_not_found' });
    }
    if (u.pathname.startsWith('/slack/')) return send({ ok: true, channel: { id: 'D1' }, ts: '1' });
    if (u.pathname === '/psi') {
      calls.psi = (calls.psi || 0) + 1;
      const url = u.searchParams.get('url') || ''; const mobile = u.searchParams.get('strategy') === 'mobile';
      if (/broken/.test(url)) return send({ error: { message: 'Lighthouse returned error: FAILED_DOCUMENT_REQUEST' } }, 500);
      const cat = (score, refs) => ({ score, auditRefs: refs.map((id) => ({ id })) });
      const sc = mobile ? [0.42, 0.88, 0.96, 0.92] : [0.81, 0.9, 0.96, 0.92];
      return send({
        loadingExperience: mobile ? { metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 3100, category: 'AVERAGE' }, INTERACTION_TO_NEXT_PAINT: { percentile: 180, category: 'FAST' } } } : {},
        lighthouseResult: { finalUrl: url, categories: { performance: cat(sc[0], ['largest-contentful-paint', 'render-blocking-resources', 'uses-optimized-images']), accessibility: cat(sc[1], ['color-contrast', 'image-alt']), 'best-practices': cat(sc[2], ['errors-in-console']), seo: cat(sc[3], ['meta-description']) },
          audits: {
            'largest-contentful-paint': { numericValue: mobile ? 6200 : 1900, displayValue: mobile ? '6.2 s' : '1.9 s', score: mobile ? 0.1 : 0.8 },
            'first-contentful-paint': { numericValue: 2100, displayValue: '2.1 s', score: 0.7 }, 'total-blocking-time': { numericValue: 450, displayValue: '450 ms', score: 0.4 },
            'cumulative-layout-shift': { numericValue: 0.02, displayValue: '0.02', score: 1 }, 'speed-index': { numericValue: 4000, displayValue: '4.0 s', score: 0.6 },
            'render-blocking-resources': { title: 'Eliminate render-blocking resources', score: 0.3, details: { type: 'opportunity', overallSavingsMs: 1200 } },
            'uses-optimized-images': { title: 'Efficiently encode images', score: 0.5, details: { type: 'opportunity', overallSavingsMs: 800 } },
            'color-contrast': { title: 'Background and foreground colors do not have a sufficient contrast ratio.', score: 0, scoreDisplayMode: 'binary' },
            'image-alt': { title: 'Image elements have [alt] attributes', score: 1, scoreDisplayMode: 'binary' },
            'meta-description': { title: 'Document does not have a meta description', score: 0, scoreDisplayMode: 'binary' },
            'errors-in-console': { title: 'No browser errors logged', score: 1, scoreDisplayMode: 'binary' },
          } } });
    }
    if (u.pathname === '/token') { calls.google++; return /assertion=/.test(body) ? send({ access_token: 'tok123', expires_in: 3600 }) : send({ error: 'bad' }, 400); }
    if (req.headers.authorization !== 'Bearer tok123') return send({ error: { message: 'unauth' } }, 401);
    m = u.pathname.match(/^\/ga\/properties\/(\d+):batchRunReports$/);
    if (m) {
      calls.google++;
      if (m[1] === '999999') return send({ error: { message: 'User does not have sufficient permissions' } }, 403);
      const q = JSON.parse(body).requests;
      const reports = q.map((r) => {
        if (!r.dimensions) return { rows: [{ metricValues: [{ value: '420' }, { value: '310' }, { value: '1200' }, { value: '0.61' }] }] };
        const dn = r.dimensions[0].name;
        if (dn === 'date') return { rows: days(r.dateRanges[0].startDate, r.dateRanges[0].endDate).map((d) => ({ dimensionValues: [{ value: d.replace(/-/g, '') }], metricValues: [{ value: String(v(d, 3)) }, { value: String(v(d, 3) - 5) }] })) };
        if (dn === 'pagePath') return { rows: [['/', 800], ['/services', 300], ['/contact', 120]].map(([k, n]) => ({ dimensionValues: [{ value: k }], metricValues: [{ value: String(n) }] })) };
        return { rows: [['Organic Search', 250], ['Direct', 120], ['Paid Social', 50]].map(([k, n]) => ({ dimensionValues: [{ value: k }], metricValues: [{ value: String(n) }] })) };
      });
      return send({ reports });
    }
    m = u.pathname.match(/^\/gsc\/sites\/([^/]+)\/searchAnalytics\/query$/);
    if (m) {
      calls.google++;
      const q = JSON.parse(body);
      if (q.dimensions[0] === 'date') return send({ rows: days(q.startDate, q.endDate).map((d) => ({ keys: [d], clicks: v(d, 1) / 4, impressions: v(d, 1) * 10, position: 8.2 })) });
      return send({ rows: [['ceramic coating near me', 40, 900, 4.1], ['buff and beyond', 30, 120, 1.2]].map(([k, c, i, p]) => ({ keys: [k], clicks: c, impressions: i, position: p })) });
    }
    send({ error: 'nope' }, 404);
  });
}).listen(port, () => console.log('fake analytics on ' + port));
