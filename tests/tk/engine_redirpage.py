"""A page that redirects (a Duda URL Redirect rule, or the page sends you on) is not audited; its target is.
Usage: python3 -I engine_redirpage.py <app> <tests>"""
import sys, os
from playwright.sync_api import sync_playwright
eng = open(os.path.join(sys.argv[1], 'public', 'engine.js')).read()
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(); pg.set_content('<html><body></body></html>'); pg.add_script_tag(content=eng)
    r = pg.evaluate("""async () => {
      const A = window.DudaAudit;
      const page = (t, d, h) => `<html><head><title>${t}</title><meta name="description" content="${d}"></head><body><div id="dmcontent"><h1>${h}</h1><p>Car care for every driver. [Mike: add prices]</p></div></body></html>`;
      const PAGES = {
        '/': page('Menard Premium Detailing', 'Detailing in Warminster, PA', 'Menard'),
        '/auto-painting-berks-county-pa': page('Auto Painting Berks County, PA', 'Menard Premium Detailing will help improve your vehicle in Warminster, PA!', 'Auto Painting in Warminster'),
        '/old-tint-reading-pa': page('Window Tint Reading, PA', 'Tint in Warminster', 'Window Tint in Warminster'),
        '/service/automotive-detailing': page('Automotive Detailing | Menard', 'Detailing', 'Automotive Detailing'),
        '/gated': page('Gated', 'Gated page', 'Gated page'),
      };
      const truth = A.buildTruth({ site: { site_business_info: { business_name: 'Menard Premium Detailing' } }, content: { location_data: { address: { city: 'Warminster', region: 'PA' } } } }, null, null);
      const pagesMeta = {}; Object.keys(PAGES).forEach((k) => { pagesMeta[k] = { path: k, title: k }; });
      const fetched = [];
      const res = await A.runScan({ siteId: 'abc', host: 'ed.x.com', truth, pagesMeta, seedPaths: ['/', '/auto-painting-berks-county-pa', '/old-tint-reading-pa', '/gated'], maxPages: 20, devices: ['desktop'], concurrency: 1,
        redirects: { rules: [{ source: '/auto-painting-berks-county-pa', target: '/service/automotive-detailing', code: 301 }], past: [], domain: '' },
        fetchPage: async (path) => { fetched.push(path); const base = 'https://ed.x.com/site/abc';
          if (path === '/old-tint-reading-pa') return { status: 200, html: PAGES['/service/automotive-detailing'], url: base + path, finalUrl: base + '/service/automotive-detailing' };
          if (path === '/gated') return { status: 200, html: PAGES[path], url: base + path, finalUrl: 'https://login.other.com/signin' };
          return { status: PAGES[path] ? 200 : 404, html: PAGES[path] || '', url: base + (path === '/' ? '' : path) }; },
        checkUrls: async () => [], imageHashes: async () => ({}), saveImageHashes: async () => {} });
      return { f: res.findings.map((f) => f.code + ' | ' + (f.pages || [f.path]).join(',')), fetched, pages: res.pages.map((p) => p.path + (p.redirectTo ? ' -> ' + p.redirectTo : '')) };
    }""")
    print('  fetched:', r['fetched']); print('  pages:', r['pages'])
    on = lambda path: [x for x in r['f'] if path in x.split(' | ')[1].split(',') and not x.startswith('REDIRECT_')]
    check('/auto-painting-berks-county-pa' not in r['fetched'], 'a page with a URL Redirect rule is not opened')
    check(not on('/auto-painting-berks-county-pa'), 'and nothing is reported on it (its old town is not a mistake)')
    check('/service/automotive-detailing' in r['fetched'], 'the page it redirects to is audited instead')
    check(not on('/old-tint-reading-pa'), 'a page that sends the browser on to another page is not reported as itself')
    check('/old-tint-reading-pa -> /service/automotive-detailing' in r['pages'], 'the scan keeps where each redirected page goes')
    check(on('/gated'), 'a page that ends on another website (a sign-in) is audited as usual, not treated as moved')
    b.close()
print('ALL PASS' if ok else 'SOME FAILED'); sys.exit(0 if ok else 1)
