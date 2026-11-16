"""The AI business-name check sees each piece of text with its whole paragraph: "our team at" + the link
"86 Auto Lab" is not another business. Also: YouTube video links are not accounts. Usage: python3 -I engine_textai.py <app> <tests>"""
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
      const html = `<html><head><title>Water spots | 86 Auto Lab</title></head><body><div id="dmcontent"><h1>Water spots</h1>
      <p style="line-height: 1.5;"><span style="display: initial;"><span style="display: initial;">If you're dealing with stubborn water spots in Franklin, TN, or you want to get ahead of the problem with a fresh ceramic coating, our team at</span>
</span><a href="https://www.86autolab.com/" target="_blank"><strong>86 Auto Lab</strong></a><span style="display: initial;">&nbsp;is here to help. We'll assess whether your spots are surface-level or etched and recommend the right fix.</span></p>
      <p>Come see the crew here at Shine Pros Detailing LLC today.</p></div></body></html>`;
      const truth = A.buildTruth({ site: { site_business_info: { business_name: '86 Auto Lab' } }, content: {} }, null, null);
      const res = await A.runScan({ siteId: 'abc', host: 'x', truth, pagesMeta: {}, seedPaths: ['/'], maxPages: 1, devices: ['desktop'], concurrency: 1,
        fetchPage: async () => ({ status: 200, html, url: 'https://x/site/abc' }), checkUrls: async () => [], imageHashes: async () => ({}), saveImageHashes: async () => {} });
      const i = res.texts.findIndex((t) => /our team at$/.test(t.text));
      const j = res.texts.findIndex((t) => /Shine Pros/.test(t.text));
      const blk = res.texts[i];
      const issues = [{ i, type: 'other_business', quote: 'our team at', confidence: 0.85, reason: 'Sentence fragment ends abruptly; business name missing', suggestion: 'our team at 86 Auto Lab' },
                      { i: j, type: 'other_business', quote: 'Shine Pros Detailing LLC', confidence: 0.9, reason: 'another shop', suggestion: '86 Auto Lab' }];
      const out = A.applyTextIssues([], res.texts, issues, truth);
      return { para: blk && blk.para, found: out.map((f) => f.code + ' ' + f.found) };
    }""")
    check('our team at 86 Auto Lab is here to help' in (r['para'] or ''), 'a piece of text cut where a link starts carries its whole paragraph')
    check(r['found'] == ['AI_TEXT_OTHER_BUSINESS "Shine Pros Detailing LLC"'], 'the AI saying "our team at" names another business is dropped; a real other business is kept: ' + str(r['found']))
    v = pg.evaluate("""async () => {
      const A = window.DudaAudit;
      const html = `<html><head><title>Home | 86 Auto Lab</title></head><body><div id="dmcontent"><h1>86 Auto Lab</h1><p>Hello there friends.</p>
        <a href="https://www.youtube.com/watch?v=vlQsGNZ5t2Q">Watch our video</a> <a href="https://www.youtube.com/@someoneelse">Other channel</a></div></body></html>`;
      const truth = A.buildTruth({ site: { site_business_info: { business_name: '86 Auto Lab' } }, content: { location_data: { social_accounts: { youtube: '@86AutoLabNashville' } } } }, null, null);
      const res = await A.runScan({ siteId: 'abc', host: 'x', truth, pagesMeta: {}, seedPaths: ['/'], maxPages: 1, devices: ['desktop'], concurrency: 1,
        fetchPage: async () => ({ status: 200, html, url: 'https://x/site/abc' }), checkUrls: async () => [], imageHashes: async () => ({}), saveImageHashes: async () => {} });
      return res.findings.filter((f) => f.category === 'Social').map((f) => f.code + ' ' + f.found);
    }""")
    check(v == ['SOCIAL_OTHER_BUSINESS https://www.youtube.com/@someoneelse'], 'a YouTube video link is not judged as an account; a link to another channel still is: ' + str(v))
    m = pg.evaluate("""async () => {
      const A = window.DudaAudit;
      const emb = (label) => `<iframe src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3231.6!2d-86.87!3d35.90!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x88643071a625fb8d%3A0xb65fed8c464b2d5!2s${encodeURIComponent(label)}!5e0!3m2!1sen!2sus!4v1760556978778!5m2!1sen!2sus"></iframe>`;
      const html = `<html><head><title>Home | 86 Auto Lab</title></head><body><div id="dmcontent"><h1>86 Auto Lab</h1><p>Hello there friends.</p></div>
        <div id="fcontainer">${emb('86 Auto Lab Franklin : PPF Paint Protection Film | Ceramic Coating | Window Tint | Color Change Wrap')}</div>
        <div>${emb('4821 Elm Ridge Rd, Plano, TX 75023')}</div></body></html>`;
      const truth = A.buildTruth({ site: { site_business_info: { business_name: '86 Auto Lab' } }, content: { location_data: { address: { streetAddress: '1552 Columbia Avenue', city: 'Franklin', region: 'TN', postalCode: '37064' } } } }, null, null);
      const res = await A.runScan({ siteId: 'abc', host: 'x', truth, pagesMeta: {}, seedPaths: ['/'], maxPages: 1, devices: ['desktop'], concurrency: 1,
        fetchPage: async () => ({ status: 200, html, url: 'https://x/site/abc' }), checkUrls: async () => [], imageHashes: async () => ({}), saveImageHashes: async () => {} });
      return { streets: truth.addresses.map((a) => a.street), maps: res.findings.filter((f) => /^MAP_/.test(f.code)).map((f) => f.code + ' ' + f.found) };
    }""")
    print('  map findings:', m, flush=True)
    check(not any('86 Auto Lab Franklin' in x for x in m['maps']), 'a map labelled with the business name that starts with a number ("86 Auto Lab Franklin…") is not "a different address"')
    check(any('4821 Elm Ridge' in x for x in m['maps']) or not m['streets'], 'a map showing another street address is still flagged')
    g = pg.evaluate("""async () => {
      const A = window.DudaAudit;
      const cap = (n) => `<li class="photoGalleryThumbs" id="li${n}"><div class="image-container"><a><img alt="PPF installation in Brentwood" src="https://irp.cdn-website.com/x/p${n}.png"></a></div>
        <div class="caption-container" style="display:none" id="cc${n}"><span class="caption-inner"><h3 class="caption-title"></h3><div class="caption-text"></div>
        <a class="caption-button dmWidget clearfix"><span class="iconBg"><span class="icon hasFontIcon icon-star"></span></span><span class="text" id="t${n}">Button</span></a></span></div></li>`;
      const html = `<html><head><title>PPF | 86 Auto Lab</title></head><body><div id="dmcontent"><h1>Understanding paint protection film</h1><p>Vehicles face a variety of risks on the road.</p>
        <div class="dmPhotoGallery newPhotoGallery dmPhotoGalleryResp" id="1419817667"><ul class="dmPhotoGalleryHolder clearfix gallery" id="1314957297">${cap(1)}${cap(2)}</ul></div>
        <a class="dmButtonLink dmWidget" href="/contact"><span class="text" id="vis1">Button</span></a>
        <div style="display:none"><h3 id="hid2">Heading</h3></div></div></body></html>`;
      const truth = A.buildTruth({ site: { site_business_info: { business_name: '86 Auto Lab' } }, content: {} }, null, null);
      const res = await A.runScan({ siteId: 'abc', host: 'x', truth, pagesMeta: {}, seedPaths: ['/'], maxPages: 1, devices: ['desktop'], concurrency: 1,
        fetchPage: async () => ({ status: 200, html, url: 'https://x/site/abc' }), checkUrls: async () => [], imageHashes: async () => ({}), saveImageHashes: async () => {} });
      return res.findings.filter((f) => /default label/.test(f.message)).map((f) => f.selector);
    }""")
    print('  default labels:', g, flush=True)
    check(len(g) == 2 and any('vis1' in x for x in g) and any('hid2' in x for x in g), 'a "Button" hidden with display:none (a gallery caption switched off) is not reported; a visible "Button" and a hidden "Heading" still are')
    b.close()
print('ALL PASS' if ok else 'SOME FAILED')
