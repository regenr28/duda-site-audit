"""Form service choices, privacy / terms text (Termageddon loaded and on the page), and redirects.
Usage: python3 -I engine_forms_policy.py <app> <tests>"""
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
      const head = (t) => `<html><head><title>${t} | Apex Paradigm Detailing</title></head><body><div id="dmcontent"><h1>${t}</h1>`;
      const PAGES = {
        '/': head('Home') + '<p>Fleet and RV care.</p></div></body></html>',
        '/fleet-washing': head('Fleet Washing') + '<p>We wash fleets.</p></div></body></html>',
        '/graffiti-removal': head('Graffiti Removal') + '<p>We remove graffiti.</p></div></body></html>',
        '/ceramic-coating': head('Ceramic Coating') + '<p>Coatings.</p></div></body></html>',
        '/contact-us': head('Contact') + `<form id="qf"><input type="email" name="email"><label for="svc">Service Interested In</label><select id="svc"><option>Select one</option><option>Fleet Washing</option><option>Ceramic Coating</option><option>Other</option></select><textarea></textarea></form></div></body></html>`,
        '/terms-of-service': head('Terms of Service') + '<p>These Terms are governed by the laws of USA County, Indiana. Notices: [Company Address].</p></div></body></html>',
        '/privacy-policy': head('Privacy Policy') + `<div id="policy" data-policy-key="TjBKRmMySnVhRUpXVTB0Q05FRTlQUT09" data-extra="no-title=true&amp;table-style=accordion">Please wait while the policy is loaded.</div></div></body></html>`,
      };
      const POLICY = '<div><h2>Privacy</h2><p>This website is operated by Shine Pros LLC. Contact us at (574) 555-0190 or 2908 Kettering Dr, South Bend, IN 46635. Your Company Name.</p></div>';
      const truth = A.buildTruth({ site: { site_business_info: { business_name: 'Apex Paradigm Detailing' } }, content: { location_data: { phones: [{ phoneNumber: '(239) 555-0100' }], address: { streetAddress: '1 Main', city: 'Cape Coral', region: 'FL', postalCode: '33904' } } } }, null, null);
      const pagesMeta = {}; Object.keys(PAGES).forEach((k) => { pagesMeta[k] = { path: k, title: k === '/' ? 'Home' : PAGES[k].match(/<h1>([^<]+)/)[1] }; });
      const policyUrls = [];
      const res = await A.runScan({ siteId: 'abc', host: 'x', truth, pagesMeta, seedPaths: Object.keys(PAGES), maxPages: 20, devices: ['desktop'], concurrency: 2,
        fetchPage: async (path) => ({ status: PAGES[path] ? 200 : 404, html: PAGES[path] || '<html><body>404</body></html>', url: 'https://x/site/abc' + (path === '/' ? '' : path) }),
        fetchPolicy: async (url) => { policyUrls.push(url); return { status: 200, html: POLICY }; },
        redirects: { rules: [{ source: '/rv-and-semi', target: '/rv-semi', code: 301 }, { source: '/rv-semi', target: '/rv-detailing', code: 302 }, { source: '/old-fleet', target: '/fleet-washing', code: 302 }, { source: '/a', target: '/b', code: 301 }, { source: '/b', target: '/a', code: 301 }, { source: '/ceramic-coating', target: '/fleet-washing', code: 301 }],
          past: ['/auto-detailing', '/fleet-wash', '/fleet-washing'], domain: 'apex.com' },
        liveStatus: async (path) => (path === '/fleet-wash' || path === '/auto-detailing' || path === '/rv-and-semi' ? 404 : 200),
        checkUrls: async () => [], imageHashes: async () => ({}), saveImageHashes: async () => {} });
      return { f: res.findings.map((f) => f.code + ' | ' + f.path + ' | ' + (f.found || '') + ' | ' + (f.expected || '')), policyUrls };
    }""")
    for x in r['f']:
        if any(k in x for k in ('FORM_SERVICE', 'POLICY', 'REDIRECT', 'EMAIL_AUTO')): print('  ', x)
    f = r['f']
    has = lambda code, *words: any(x.startswith(code) and all(w in x for w in words) for x in f)
    check(has('FORM_SERVICE_MISSING', 'Graffiti Removal') and not any(x.startswith('FORM_SERVICE_MISSING') and 'Fleet Washing,' in x.split('|')[3] for x in f), 'the quote form\'s service choices leave out Graffiti Removal (it has a page), not Fleet Washing (offered)')
    check(r['policyUrls'] and 'app.termageddon.com/api/policy/TjBKRmMySnVhRUpXVTB0Q05FRTlQUT09?no-title=true&table-style=accordion' in r['policyUrls'][0], 'the Termageddon policy is read from its own address (not the "please wait" text)')
    check(has('POLICY_NAME', 'Shine Pros') and has('POLICY_CONTACT', '(574) 555-0190') and has('POLICY_ADDRESS', '46635') and has('POLICY_TEMPLATE', '/privacy-policy', 'Your Company Name'), 'the loaded policy: another business, a phone and a notice address not in Business Info, a template field')
    check(has('POLICY_TEMPLATE', '/terms-of-service', 'USA County') and has('POLICY_TEMPLATE', '/terms-of-service', '[Company Address]'), 'the terms page written on the page: "USA County" and [Company Address]')
    check(has('REDIRECT_CHAIN', '/rv-and-semi') and has('REDIRECT_LOOP', '/a') and has('REDIRECT_TEMPORARY', '/old-fleet') and has('REDIRECT_SHADOWS_PAGE', '/ceramic-coating'), 'redirects: chain, loop, temporary, over a page that still exists')
    check(has('REDIRECT_MISSING', '/fleet-wash', '/fleet-washing') and has('REDIRECT_MISSING', '/auto-detailing'), 'old pages that now give 404 need a redirect (closest page suggested)')
    check(not has('REDIRECT_MISSING', '| /fleet-washing |'), 'a page that still exists is not "missing"')
    b.close()
print('ALL PASS' if ok else 'SOME FAILED')
