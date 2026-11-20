"""A web page's own schema parts are not the business (SpamKill names itself as a WebPage's provider), and the
word "copyright" in a sentence is not a copyright line. Usage: python3 -I engine_vendor.py <app> <tests>"""
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
      const html = `<html><head><title>Contact | Menard Premium Detailing</title>
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage","name":"Page with SpamKill Protected Form","provider":{"@type":"Organization","name":"SpamKill","url":"https://spamkill.co"}}</script>
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Service","name":"Ceramic Coating","provider":{"@type":"AutoRepair","name":"Glossy Garage LLC"}}</script>
      </head><body><div id="dmcontent"><h1>Contact</h1><p>If you believe any material on this Website infringes your copyright, please contact us and include:</p>
      <form><input type="email" placeholder="name@email.com"><input type="tel" placeholder="(555) 555-5555"><textarea placeholder="Write to info@glossygarage.com"></textarea><textarea name="msg"></textarea></form></div></body></html>`;
      const truth = A.buildTruth({ site: { site_business_info: { business_name: 'Menard Premium Detailing' } }, content: { location_data: { emails: [{ emailAddress: 'jon@menardpremiumdetailing.com' }], phones: [{ phoneNumber: '(833) 263-6273' }] } } }, null, null);
      const res = await A.runScan({ siteId: 'abc', host: 'x', truth, pagesMeta: {}, seedPaths: ['/contact'], maxPages: 2, devices: ['desktop'], concurrency: 1,
        fetchPage: async () => ({ status: 200, html, url: 'https://x/site/abc/contact' }), checkUrls: async () => [], imageHashes: async () => ({}), saveImageHashes: async () => {} });
      return res.findings.map((f) => f.code + ' ' + (f.found || '')).concat(res.pages.filter((p) => p.forms).map((p) => 'FORMS ' + p.path));
    }""")
    print('  ', r)
    check(not any('SpamKill' in x for x in r), 'a vendor named as a web page\'s provider is not another business')
    check(not any(x.startswith('COPYRIGHT') for x in r), 'the word "copyright" in a sentence is not a copyright line')
    check(any('Glossy Garage' in x for x in r), 'a Service\'s provider naming another business still is')
    check(not any(('name@email.com' in x or '555' in x) and not x.startswith('FORM_') for x in r), 'a format hint in a form field ("name@email.com", "(555) 555-5555") is not contact details')
    check(any('info@glossygarage.com' in x for x in r), 'a real email in a placeholder still is')
    check('FORMS /contact' in r, 'pages with a form are known (their contrast is measured first)')
    b.close()
print('ALL PASS' if ok else 'SOME FAILED')
