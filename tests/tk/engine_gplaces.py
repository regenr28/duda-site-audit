"""Google Maps short links are followed (stand-in) and judged by the place they open.
Usage: python3 -I engine_gplaces.py <app> <tests>"""
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
      const body = '<div id="dmcontent"><h1>Ceramic Coating</h1><div id="t1"><h3><a href="https://maps.app.goo.gl/AAA">Cait Crowley</a></h3></div>'
        + '<p><a href="https://maps.app.goo.gl/BBB">Directions</a> <a href="https://maps.app.goo.gl/CCC">Map</a> <a href="https://maps.app.goo.gl/DDD">Bud James</a> <a href="https://maps.app.goo.gl/EEE">Andrew Daley</a></p></div>';
      const PAGES = { '/': '<html><head><title>Home</title></head><body>' + body + '</body></html>' };
      const truth = A.buildTruth({ site: { site_business_info: { business_name: 'Menard Premium Detailing' } }, content: {} }, null, null);
      const asked = [];
      const PL = {
        'https://maps.app.goo.gl/AAA': { finalUrl: 'https://www.google.com/maps/reviews/@40.22,-75.06,877m/data=!3m2!1e3!4b1!4m6!14m5!1m4!2m3!1sChdDSUhN!2m1!1s0x0:0x825f517be54d84b9', id: '0x0:0x825f517be54d84b9', name: 'Menard Premium Detailing - PPF Paint Protection Film', address: '125 Industrial Dr, Warminster, PA' },
        'https://maps.app.goo.gl/BBB': { finalUrl: 'https://www.google.com/maps/place/Shine+Pros/@1,2', id: '', name: 'Shine Pros' },
        'https://maps.app.goo.gl/CCC': { finalUrl: 'https://www.google.com/maps?cid=123', id: '0x1:0x2', name: '' },
        'https://maps.app.goo.gl/DDD': { finalUrl: 'https://www.google.com/maps/reviews/data=!1s0x0:0x825f517be54d84b9', id: '0x0:0x825f517be54d84b9', name: '' },
      };
      const res = await A.runScan({ siteId: 'abc', host: 'x', truth, pagesMeta: { '/': { path: '/', title: 'Home' } }, seedPaths: ['/'], maxPages: 5, devices: ['desktop'], concurrency: 1,
        fetchPage: async (path) => ({ status: PAGES[path] ? 200 : 404, html: PAGES[path] || '', url: 'https://x/site/abc' }),
        googlePlaces: async (urls) => { asked.push(...urls); return urls.filter((u) => PL[u]).map((u) => Object.assign({ url: u }, PL[u])); },
        checkUrls: async () => [], imageHashes: async () => ({}), saveImageHashes: async () => {} });
      return { f: res.findings.filter((f) => f.category === 'Social').map((f) => f.code + ' | ' + f.severity + ' | ' + f.found + ' | ' + f.message), asked, log: res.log.filter((l) => /short link/.test(l)) };
    }""")
    for x in r['f'] + r['log']: print('  ', x)
    f = r['f']
    check(len(r['asked']) == 5, 'every short link is followed, once')
    check(not any('/AAA' in x for x in f), 'a link to one of the business’s own Google reviews is fine (the place is the business)')
    check(not any('/DDD' in x for x in f), 'a link whose place Google did not name, but is the same place as another link to the business, is fine')
    check(any('/BBB' in x and x.startswith('GMB_OTHER_PLACE | warning') and 'Shine Pros' in x for x in f), 'a link that opens another business is a warning naming it')
    check(any('/CCC' in x and x.startswith('GMB_ID_ONLY | info') for x in f), 'a place that could not be named is only a note to open it')
    check(any('/EEE' in x and x.startswith('SOCIAL_GENERIC') for x in f), 'a short link that could not be followed is left as it was')
    check(r['log'], 'the scan notes say how many were followed')
    b.close()
print('ALL PASS' if ok else 'SOME FAILED'); sys.exit(0 if ok else 1)
