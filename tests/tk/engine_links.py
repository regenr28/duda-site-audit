"""Links: a relative address ("/", "/contact") is never "a Duda editor/preview domain"; a full editor address still is.
Usage: python3 -I engine_links.py <app> <tests>"""
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
      const nav = '<div class="dmHeader"><a href="/">Home</a><a href="/contact">Contact</a><a href="/service/paint-protection-film">PPF</a><a href="/contact#quickform">Quote</a></div>';
      const PAGES = {
        '/': '<html><head><title>Home</title></head><body>' + nav + '<div id="dmcontent"><h1>Menard</h1><a href="/site/abc/contact">Contact us</a></div></body></html>',
        '/contact': '<html><head><title>Contact</title></head><body>' + nav + '<div id="dmcontent"><h1>Contact</h1></div></body></html>',
        '/service/paint-protection-film': '<html><head><title>PPF</title></head><body>' + nav + '<div id="dmcontent"><h1>PPF</h1><a href="https://abc.multiscreensite.com/contact">Old</a><a href="https://ed.multiscreensite.com/site/abc/contact">Preview link</a></div></body></html>',
        '/service/vehicle-detailing': '<html><head><title>Detailing</title></head><body>' + nav + '<div id="dmcontent"><h1>Detailing</h1></div></body></html>',
      };
      const truth = A.buildTruth({ site: { site_business_info: { business_name: 'Menard' } }, content: {} }, null, null);
      const pagesMeta = {}; Object.keys(PAGES).forEach((k) => { pagesMeta[k] = { path: k, title: k }; });
      const res = await A.runScan({ siteId: 'abc', host: 'ed.multiscreensite.com', truth, pagesMeta, seedPaths: Object.keys(PAGES), maxPages: 20, devices: ['desktop'], concurrency: 2,
        fetchPage: async (path) => ({ status: PAGES[path] ? 200 : 404, html: PAGES[path] || '<html><body>404</body></html>', url: 'https://ed.multiscreensite.com/site/abc' + (path === '/' ? '' : path) }),
        checkUrls: async () => [], imageHashes: async () => ({}), saveImageHashes: async () => {} });
      return res.findings.filter((f) => /^LINK_/.test(f.code)).map((f) => f.code + ' | ' + f.path + ' | ' + (f.found || ''));
    }""")
    for x in r: print('  ', x)
    ed = [x for x in r if x.startswith('LINK_EDITOR_URL')]
    check(not any(x.split(' | ')[2] in ('/', '/contact', '/service/paint-protection-film', '/contact#quickform') for x in ed), 'relative links ("/", "/contact", "/contact#quickform") are not editor links')
    check(any('abc.multiscreensite.com/contact' in x for x in ed), 'a full address on an editor domain still is')
    check(not any(x.startswith('LINK_BROKEN_INTERNAL') and x.split(' | ')[2] in ('/', '/contact') for x in r), 'relative links to real pages are not broken')
    b.close()
print('ALL PASS' if ok else 'SOME FAILED'); sys.exit(0 if ok else 1)
