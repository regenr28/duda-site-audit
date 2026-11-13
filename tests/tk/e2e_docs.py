"""vs Docs: a copy document (.docx) checked against the website, and scanning chosen pages only.
A made-up shop (Buff & Beyond) whose document asks for 5 pages; the website is missing one, a page
has lost a paragraph and a button, and two "Get a Quote" buttons go to different places.
Usage: python3 -I e2e_docs.py <app> <tests>"""
import io, json, os, re, subprocess, sys, time, threading, urllib.parse, zipfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT, AIPORT = 3998, 8078, 8113
SEEN = {'read': 0, 'match': 0}

# ---- a Word document, built the way the copywriters write them ----
def para(t, bold=False, num=False):
    t = t.replace('&', '&amp;').replace('<', '&lt;')
    return f'<w:p>{"<w:pPr><w:numPr><w:ilvl w:val=\"0\"/><w:numId w:val=\"1\"/></w:numPr></w:pPr>" if num else ""}<w:r>{"<w:rPr><w:b/></w:rPr>" if bold else ""}<w:t xml:space="preserve">{t}</w:t></w:r></w:p>'
def cell(lines): return '<w:tc>' + ''.join(para(x) for x in lines) + '</w:tc>'
def docx(body_xml):
    doc = f'<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>{body_xml}</w:body></w:document>'
    b = io.BytesIO()
    with zipfile.ZipFile(b, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
        z.writestr('word/document.xml', doc)
        z.writestr('word/_rels/document.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>')
    return b.getvalue()
INTRO_PPF = 'Our paint protection film stops rock chips, scratches and bug stains before they reach your paint, and it heals itself in the sun.'
LOST_PPF = 'Every film we install carries a ten year warranty against yellowing, cracking and peeling, backed by the manufacturer.'
body = ('<w:tbl><w:tr>' + cell(['Client Information']) + cell(['Client: Bob Owner', 'Detailing Business Name: Buff & Beyond']) + '</w:tr>'
        '<w:tr>' + cell(['Client Contact']) + cell(['Client Email: owner@buffandbeyond.com', 'Business Phone: (302) 555-0199', 'Client Address: 9 Old Road, Dover, DE 19901']) + '</w:tr>'
        '<w:tr>' + cell(['Website Preferences']) + cell(['Secondary color: #00FFD9']) + '</w:tr></w:tbl>'
        + para('Website Pages To Include:') + ''.join(para(x, num=True) for x in ['HOME PAGE', 'PAINT PROTECTION FILM', 'WINDOW TINTING', 'BRENTWOOD, TN CERAMIC COATING & PPF', 'CONTACT US'])
        + para('HOME PAGE', True) + para('TITLE: Auto Detailing in Dover | Buff & Beyond') + para('META DESCRIPTION: Detailing, tint and PPF in Dover. Call now!')
        + para('Shine Like New in Dover', True) + para('We bring every car back to showroom condition with careful hand work and the best products.') + para('BUTTON> VIEW OUR SERVICES BUTTON> CALL (xxx) xxx-xxxx')
        + para('PAINT PROTECTION FILM', True) + para('TITLE: Paint Protection Film Experts | Buff & Beyond') + para('META DESCRIPTION: Clear film that stops chips. Call now!')
        + para('Invisible Armor for Your Paint', True) + para(INTRO_PPF) + para('BUTTON> GET A QUOTE') + para(LOST_PPF) + para('BUTTON> BOOK NOW') + para('DEVELOPER>>> ADD XPEL LOGO HERE')
        + para('WINDOW TINT', True) + para('TITLE: Window Tinting Services | Buff & Beyond') + para('META DESCRIPTION: Cooler cabin, less glare. Call now!')
        + para('Stay Cool on Every Drive', True) + para('Our ceramic window film blocks the heat and the glare without making your windows too dark to see out of.') + para('BUTTON> GET A QUOTE')
        + para('BRENTWOOD, TN CERAMIC COATING & PPF', True) + para('TITLE: PPF & Ceramic Coating Brentwood, TN | Buff & Beyond') + para('META DESCRIPTION: Brentwood ceramic coating. Call now!')
        + para('Protection for Brentwood Drivers', True) + para('Drivers in Brentwood trust us with ceramic coating and paint protection film for their daily drivers and weekend cars.')
        + para('CONTACT US', True) + para('TITLE: Contact Us | Buff & Beyond') + para('META DESCRIPTION: Call or write to Buff & Beyond today.')
        + para('Get in Touch', True) + para('Tell us about your car and what you would like done, and we will reply within one business day.') + para('BUTTON> CALL (xxx) xxx-xxxx')
        + para('GLOBAL FOOTER', True) + para('Buff & Beyond, detailing in Dover since 2010.'))
DOC = docx(body)

class AI(BaseHTTPRequestHandler):
    """A stand-in AI: names the document's pages and matches them to the website's, from the prompt."""
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get('content-length') or 0)) or b'{}')
        system = body.get('system') if isinstance(body.get('system'), str) else json.dumps(body.get('system'))
        user = ''.join(m['content'] if isinstance(m['content'], str) else ''.join(c.get('text', '') for c in m['content']) for m in body.get('messages', []))
        out = {'results': []}
        if 'outline of a copy document' in system:
            SEEN['read'] += 1
            names = {'HOME PAGE': 'Home', 'PAINT PROTECTION FILM': 'Paint Protection Film', 'Window Tinting Services': 'Window Tinting', 'WINDOW TINT': 'Window Tinting', 'BRENTWOOD, TN CERAMIC COATING & PPF': 'Brentwood, TN Ceramic Coating & PPF', 'CONTACT US': 'Contact Us'}
            out = {'pages': [{'i': int(m.group(1)), 'name': names.get(m.group(2), m.group(2)), 'kind': 'page', 'note': ''} for m in re.finditer(r'^\[(\d+)\] name="([^"]*)"', user, re.M)],
                   'client': {'business': 'Buff & Beyond', 'email': 'owner@buffandbeyond.com', 'phone': '(302) 555-0199', 'address': '9 Old Road, Dover, DE 19901', 'colors': ['#00FFD9']}}
        elif 'match the pages a copy document asks for' in system:
            SEEN['match'] += 1
            m2 = []
            for m in re.finditer(r'^(\d+) \| ([^|]*) \|', user, re.M):
                n = m.group(2).lower()
                path = '/window-tint' if 'tint' in n else '/gloss-ppf' if 'paint protection' in n else ''
                m2.append({'i': int(m.group(1)), 'path': path, 'confidence': 0.9 if path else 0.2, 'reason': 'renamed page' if path else 'no page for Brentwood'})
            out = {'matches': m2}
        elif 'You review image ALT TEXT' in system:
            out = {'results': [{'i': int(m.group(1)), 'verdict': 'describes_image', 'confidence': 0.9, 'reason': 'x', 'suggestion': ''} for m in re.finditer(r'^(\d+) \| ', user, re.M)]}
        data = json.dumps({'model': 'claude-haiku-4-5-20251001', 'content': [{'type': 'text', 'text': json.dumps(out)}], 'usage': {'input_tokens': 500, 'output_tokens': 100}}).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(data)
    def log_message(self, *a): pass
threading.Thread(target=HTTPServer(('127.0.0.1', AIPORT), AI).serve_forever, daemon=True).start()
env = dict(os.environ, ANTHROPIC_API_KEY='sk-test', ANTHROPIC_API_BASE=f'http://127.0.0.1:{AIPORT}/v1', ANTHROPIC_MODEL='claude-haiku-4-5-20251001', AI_ORDER='anthropic')
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-docs.log'), 'w'), text=True, env=env)
assert srv.stdout.readline().strip() == 'READY'
TOK = 'tokadmin1234567890abcdef'; SITE = 'abc123'
def L(p): return '/site/' + SITE + ('' if p == '/' else p)
BTN = lambda text, to: f'<a class="dmButtonLink" href="{L(to) if to.startswith("/") else to}">{text}</a>'
PAGES = {
    '/': ('Auto Detailing in Dover | Buff & Beyond', '<h1>Shine Like New in Dover</h1><p>We bring every car back to showroom condition with careful hand work and the best products.</p>' + BTN('View our services', '/gloss-ppf') + BTN('Call (302) 421-7788', 'tel:3024217788')),
    # Renamed page; one paragraph and the Book Now button were left out; two Get a Quote buttons go to different places.
    '/gloss-ppf': ('Paint Protection Film Experts | Buff & Beyond', '<h1>Invisible Armor for Your Paint</h1><p>' + INTRO_PPF + '</p>' + BTN('Get a quote', '/contact-us') + '<p>Ask about our packages.</p>' + BTN('Get a Quote', '/window-tint')),
    '/window-tint': ('Window Tint | Buff & Beyond', '<h1>Stay Cool on Every Drive</h1><p>Our ceramic window film blocks the heat and the glare without making your windows too dark to see out of.</p>' + BTN('Get a quote', '/contact-us')),
    '/contact-us': ('Contact Us | Buff & Beyond', '<h1>Get in Touch</h1><p>Tell us about your car and what you would like done, and we will reply within one business day.</p>' + BTN('Call now', 'tel:3024217788')),
    '/blog/tint-laws': ('Tint laws | Buff & Beyond', '<h1>Tint laws</h1><p>What the law says.</p>'),
}
def page_html(path):
    nav = '<div id="hcontainer" class="dmHeader">' + ' '.join(f'<a href="{L(p)}">{p}</a>' for p in PAGES) + '</div>'
    if path not in PAGES: return {'status': 404, 'html': '<html><body data-page-alias="dmPageNotFound"></body></html>', 'url': ''}
    t, b = PAGES[path]
    desc = {'/': 'Detailing, tint and PPF in Dover. Call now!', '/gloss-ppf': 'Clear film that stops chips. Call now!'}.get(path, 'Something else.')
    return {'status': 200, 'html': f'<html><head><title>{t}</title><meta name="description" content="{desc}"></head><body>{nav}<div id="dmcontent">{b}</div></body></html>', 'url': f'https://ed.multiscreensite.com/site/{SITE}{path}'}
META = {'host': 'ed.multiscreensite.com', 'siteId': SITE, 'site': {'site_business_info': {'business_name': 'Buff & Beyond', 'phone_number': '(302) 421-7788', 'email': 'hello@buffandbeyond.com'}, 'site_domain': ''},
        'content': {'location_data': {'phones': [{'phoneNumber': '(302) 421-7788'}], 'emails': [{'emailAddress': 'hello@buffandbeyond.com'}], 'address': {'street': '9 Old Road', 'city': 'Dover', 'region': 'DE', 'zip_code': '19901'}}},
        'pages': [{'path': p, 'title': p, 'noIndex': False} for p in PAGES], 'errors': []}
FETCHED = []
SLOW = [0]
LIVE = [False]; LIVEF = []
def route(r):
    u = urllib.parse.urlparse(r.request.url); q = dict(urllib.parse.parse_qsl(u.query)); p = u.path
    if p == '/api/fetch' and SLOW[0]: time.sleep(SLOW[0])
    if p == '/api/fetch' and q.get('live'): LIVEF.append((q.get('domain'), q.get('path')))
    if p == '/api/fetch': FETCHED.append(q.get('path')); return r.fulfill(status=200, content_type='application/json', body=json.dumps(page_html(q.get('path'))))
    if p == '/api/site' and q.get('light') and LIVE[0]: return r.fulfill(status=200, content_type='application/json', body=json.dumps({'siteId': SITE, 'domain': 'buffandbeyond.com', 'publishStatus': 'PUBLISHED', 'publishedAt': '2026-11-01T10:00:00Z'}))
    if p == '/api/site': return r.fulfill(status=200, content_type='application/json', body=json.dumps(META))
    if p in ('/api/social', '/api/check'): return r.fulfill(status=200, content_type='application/json', body='[]' if p == '/api/check' else '{}')
    if p == '/api/imghash': return r.fulfill(status=200, content_type='application/json', body=json.dumps({'hashes': {}}))
    if p == '/api/capture': return r.fulfill(status=200, content_type='application/json', body=json.dumps({'items': [], 'measured': 0, 'errors': []}))
    return r.continue_()
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
def wait_scan(pg, before):
    for _ in range(150):
        time.sleep(1)
        S = pg.evaluate("async () => (await fetch('/api/store?op=site&id=s1')).json()")
        if (S.get('scan') or {}).get('state') == 'complete' and (S.get('scan') or {}).get('finishedAt') != before: return S
    return S
errors = []
try:
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
        ctx.add_cookies([{'name': 'dsa_sess', 'value': TOK, 'domain': 'localhost', 'path': '/'}])
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('dialog', lambda d: d.accept())
        pg.route('**/api/**', route)
        pg.goto(f'http://localhost:{APORT}/#/site/s1'); pg.wait_for_selector('#sRescan', timeout=20000); time.sleep(1.2)
        pg.click('#sRescan'); S = wait_scan(pg, None)
        check((S.get('scan') or {}).get('state') == 'complete', 'the website was scanned once, so its pages are known')
        # ---- the document ----
        pg.goto(f'http://localhost:{APORT}/#/site/s1/docs'); pg.wait_for_selector('.dc-top', timeout=15000)
        check('vs Docs' in pg.inner_text('.res-tabs'), 'the audit has a vs Docs tab')
        pg.set_input_files('#dcFile', files=[{'name': 'Website Writing - Buff & Beyond.docx', 'mimeType': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'buffer': DOC}])
        pg.wait_for_selector('.dc-plan li', timeout=20000); time.sleep(0.5)
        plan = pg.inner_text('.dc-plan')
        check(pg.locator('.dc-plan li').count() == 5 and 'Window Tinting' in plan and 'Brentwood' in plan, 'the document is read into its 5 pages, named by the AI ("Window Tinting", not the writer\'s "Window Tinting Services"): ' + plan.replace('\n', ' | ')[:300])
        check(SEEN['read'] == 1 and 'buttons' in plan, 'the AI read the outline once; each page lists its buttons and copy')
        with pg.expect_download() as dl: pg.click('text=⬇ Download the document')
        check(open(dl.value.path(), 'rb').read() == DOC, 'the document itself can be downloaded again, unchanged')
        FETCHED.clear()
        pg.click('#dcRun'); pg.wait_for_selector('.dc-row', timeout=40000); time.sleep(0.6)
        rows = pg.inner_text('.dc-doc')
        check('Missing pages' in rows and re.search(r'Brentwood[^\n]*\n?[^\n]*not on the website', rows), 'the Brentwood page the document asks for is reported as missing from the website')
        check('/gloss-ppf' in rows and '/window-tint' in rows, 'renamed pages are found by the AI (Paint Protection Film → /gloss-ppf, Window Tinting → /window-tint)')
        check(set(x for x in FETCHED if x) <= {'/', '/gloss-ppf', '/window-tint', '/contact-us'}, f'only the matched pages are read for the check: {sorted(set(x for x in FETCHED if x))}')
        ppf = pg.locator('.dc-row', has=pg.locator('summary', has_text='/gloss-ppf')); ppf.locator('summary').click(); time.sleep(0.2)
        pt = ppf.inner_text()
        check('ten year warranty' in pt and 'Not on the website' in pt, 'a paragraph of the document that is not on the page is listed')
        check('Missing button: BOOK NOW' in pt, 'a button the document asks for that is not on the page is listed')
        check('go to different places' in pt and '/contact-us' in pt and '/window-tint' in pt, '"Get a Quote" buttons going to two different pages are flagged')
        home = pg.locator('.dc-row', has=pg.locator('summary', has_text='Home')); home.locator('summary').click(); time.sleep(0.2)
        check('✓ SEO title' in home.inner_text() and '✓ Meta description' in home.inner_text(), 'a matching SEO title and description are confirmed')
        tint = pg.locator('.dc-row', has=pg.locator('summary', has_text='Window Tinting')); tint.locator('summary').click(); time.sleep(0.2)
        check('≠ SEO title' in tint.inner_text() and 'Window Tinting Services' in tint.inner_text(), 'a different SEO title shows both versions')
        cl = pg.inner_text('.dc-doc')
        check(re.search(r'Phone\s+\(302\) 555-0199\s+\(302\) 421-7788\s+≠ different', cl) and re.search(r'Email\s+owner@buffandbeyond.com\s+hello@buffandbeyond.com\s+≠ different', cl), 'client details that changed since the document (phone, email) are flagged against Business Info')
        check(re.search(r'Address[^\n]*✓ same', cl), 'and what is still the same is confirmed')
        pg.screenshot(path=os.path.join(OUT, 'docs.png'), full_page=True)
        with pg.expect_download() as dl: pg.click('#dcDl')
        rep = open(dl.value.path()).read()
        check('vs the document' in rep and 'Missing' in rep and 'BOOK NOW' in rep, 'the check downloads as a report')
        # ---- scanning chosen pages only ----
        before = pg.evaluate("async () => (await (await fetch('/api/store?op=site&id=s1')).json())")
        n_before = len([f for f in before['findings'] if not f.get('gone')])
        FETCHED.clear()
        pg.click('#dcScan'); S2 = wait_scan(pg, (before.get('scan') or {}).get('finishedAt'))
        time.sleep(2); S2 = pg.evaluate("async () => (await fetch('/api/store?op=site&id=s1')).json()")
        got = set(x for x in FETCHED if x)
        check('/blog/tint-laws' not in got and got <= {'/', '/gloss-ppf', '/window-tint', '/contact-us'}, f'"Audit these pages" scans only the document\'s pages: {sorted(got)}')
        check(len(S2.get('pages') or []) >= 5, 'the website\'s page list is kept whole after scanning a few pages')
        check((S2.get('scans') or [])[-1].get('partial'), 'the scan history marks it as a scan of chosen pages')
        check('chosen page' in ' '.join((S2.get('scan') or {}).get('log') or []), 'the scan notes say which pages were scanned')
        pg.goto(f'http://localhost:{APORT}/#/site/s1'); pg.wait_for_selector('#sMore', timeout=15000); time.sleep(0.6)
        pg.click('#sMore'); pg.click('text=Scan chosen pages'); pg.wait_for_selector('#spList .sp-row')
        check(pg.locator('#spList .sp-row').count() >= 5, 'Scan chosen pages lists the website\'s pages to pick from')
        pg.click('[data-close]')
        # ---- drag and drop: several files at once, a non-Word file refused ----
        pg.goto(f'http://localhost:{APORT}/#/site/s1/docs'); pg.wait_for_selector('#dcDrop', timeout=15000); time.sleep(0.4)
        n0 = pg.locator('.dc-tabs a').count()
        b64 = __import__('base64').b64encode(DOC).decode()
        pg.evaluate("""(b64) => { const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); const dt = new DataTransfer();
          dt.items.add(new File([bin], 'PPF Page - Buff & Beyond.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
          dt.items.add(new File([bin], 'Tint Page - Buff & Beyond.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
          dt.items.add(new File(['hello'], 'notes.txt', { type: 'text/plain' }));
          const zone = document.querySelector('#dcDrop'); zone.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true }));
          const over = zone.classList.contains('over');
          zone.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true })); return over; }""", b64)
        refused = pg.inner_text('#dcDrop')
        for _ in range(30):
            time.sleep(1)
            if pg.locator('.dc-tabs a').count() >= n0 + 2: break
        check(pg.locator('.dc-tabs a').count() == n0 + 2, f'dropping two Word documents adds both ({n0} → {pg.locator(".dc-tabs a").count()} tabs)')
        time.sleep(1); refused = pg.inner_text('#dcDrop') if pg.locator('#dcDrop').count() else refused
        check('notes.txt' in refused and '.docx' in refused, 'a file that is not a Word document is refused with a message: ' + refused[:120])
        pg.screenshot(path=os.path.join(OUT, 'docs-drop.png'))
        # ---- the audit's tabs: Audit results grouped, Audit Report, the scan's progress on every tab ----
        pg.goto(f'http://localhost:{APORT}/#/site/s1/docs'); pg.wait_for_selector('.res-tabs', timeout=15000); time.sleep(0.4)
        top = pg.inner_text('.tabs'); sub = pg.inner_text('.res-tabs')
        pg.screenshot(path=os.path.join(OUT, 'res-tabs.png'))
        check('Audit Report' in top and 'Audit results' in top and 'Dashboard' not in top and 'Design polish' not in top, 'the main tabs: Profile, Audit Report, Audit results, Comments, Activity log: ' + top.replace(chr(10), ' ')[:120])
        check(all(x in sub for x in ['Audit items', 'Design polish', 'SEO Lengths', 'vs Docs', 'Audit exceptions']) and pg.locator('.res-tabs .pf-tab.on').inner_text().strip().startswith('📄'), 'Audit results has its own row of tabs, with vs Docs picked')
        pg.goto(f'http://localhost:{APORT}/#/site/s1/report'); pg.wait_for_selector('.tabs a.on', timeout=15000); time.sleep(0.6)
        check('Audit Report' in pg.inner_text('.tabs a.on') and pg.locator('.res-tabs').count() == 0, 'the Audit Report address opens the Audit Report tab, without the results row')
        SLOW[0] = 0.4
        pg.click('#sRescan'); time.sleep(0.3)
        pg.goto(f'http://localhost:{APORT}/#/site/s1/profile')
        pg.wait_for_selector('#scanStrip .progress', timeout=15000); time.sleep(0.3)
        check(pg.locator('#scanStrip .progress').count() == 1 and 'Keep this browser tab open' in pg.inner_text('#scanStrip'), 'the scan\'s progress shows at the top of the Profile tab')
        pg.screenshot(path=os.path.join(OUT, 'scan-strip-profile.png'))
        pg.goto(f'http://localhost:{APORT}/#/site/s1'); pg.wait_for_selector('#scanStrip', timeout=10000); time.sleep(0.3)
        check(pg.locator('.progress i[id^="pg-"]').count() == 1, 'on Audit items the progress shows once (at the top), not twice')
        pg.goto(f'http://localhost:{APORT}/#/'); time.sleep(1.0)
        check(pg.locator('[id^="pb-"]').count() >= 1, 'the Audits list shows the scan on the website\'s row')
        pg.goto(f'http://localhost:{APORT}/#/site/s1/report'); pg.wait_for_selector('#scanStrip', timeout=10000)
        pg.reload(); pg.wait_for_selector('#scanStrip', timeout=15000)
        for _ in range(20):
            if 'started again' in pg.inner_text('#toast'): break
            time.sleep(0.3)
        check('started again' in pg.inner_text('#toast'), 'a reload in the middle of a scan starts it again by itself: ' + pg.inner_text('#toast')[:100])
        SLOW[0] = 0
        S3 = wait_scan(pg, (S2.get('scan') or {}).get('finishedAt'))
        check((S3.get('scan') or {}).get('state') == 'complete', 'the restarted scan finishes')
        for _ in range(40):
            if pg.locator('#scanStrip').count() == 0: break
            time.sleep(0.5)
        check(pg.locator('#scanStrip').count() == 0, 'the progress goes away when the scan is done' + ('' if not pg.locator('#scanStrip').count() else ': ' + pg.inner_text('#scanStrip')[:160]))
        # ---- a published website: the document is checked against the LIVE website ----
        LIVE[0] = True
        WT0 = PAGES['/window-tint']; PAGES['/window-tint'] = (WT0[0], WT0[1].replace('blocks the heat and the glare without', 'blocks heat and glare all summer without'))
        pg.goto(f'http://localhost:{APORT}/#/site/s1/docs'); pg.wait_for_selector('#dcRun', timeout=15000); time.sleep(0.4)
        check(pg.locator('#dcSrc').count() == 1, 'there is a choice: the live website or the draft')
        pg.click('#dcRun')
        for _ in range(60):
            time.sleep(1)
            if 'live website' in (pg.inner_text('.db-tiles') if pg.locator('.db-tiles').count() else ''): break
        tiles = pg.inner_text('.db-tiles') if pg.locator('.db-tiles').count() else ''
        check(LIVEF and all(d == 'buffandbeyond.com' for d, _ in LIVEF), f'a published website is read on its live domain ({len(LIVEF)} live pages read)')
        check('live website' in tiles and 'buffandbeyond.com' in tiles, 'the check says it was done on the live website: ' + tiles.replace(chr(10), ' ')[-120:])
        check('https://buffandbeyond.com/' in (pg.get_attribute('.dc-row a.dc-path', 'href') or ''), 'the page links open the live website')
        # ---- copy, block by block (the live check above) ----
        pg.click('details.dc-row[data-dcp="/gloss-ppf"] summary'); time.sleep(0.4)
        ppf = 'details.dc-row[data-dcp="/gloss-ppf"] '
        kinds = pg.evaluate(f"""() => [...document.querySelectorAll('{ppf}.dcc-row')].map(r => [...r.classList].find(c => c.startsWith('dcc-') && c !== 'dcc-row') + '|' + r.querySelector('.dcc-site').innerText.slice(0, 30) + '|' + r.querySelector('.dcc-doc').innerText.slice(0, 30))""")
        print('  rows:', kinds, flush=True)
        ks = [k.split('|')[0] for k in kinds]
        check(ks[:2] == ['dcc-same', 'dcc-same'], 'the website page is read top to bottom: its heading and first paragraph are the same as the document')
        check(any(k.startswith('dcc-extra|Ask about our packages') for k in kinds), 'a paragraph that is not in the document is shown as "Not in the document"')
        mi = [i for i, k in enumerate(ks) if k == 'dcc-missing']
        check(len(mi) == 1 and 'Every film we install' in kinds[mi[0]] and mi[0] == 2, 'the paragraph the website left out is shown as missing, in its place (after the paragraph before it in the document)')
        pg.click('details.dc-row[data-dcp="/window-tint"] summary'); time.sleep(0.3)
        ch = pg.locator('details.dc-row[data-dcp="/window-tint"] .dcc-changed')
        check(ch.count() == 1 and ch.locator('ins').count() >= 1 and ch.locator('del').count() >= 1, 'a reworded paragraph is "Changed", with the added words and the left-out words marked')
        pg.screenshot(path=os.path.join(OUT, 'docs-copy.png'), full_page=True)
        pg.check(ppf + '[data-dcc-only]'); time.sleep(0.6)
        check(pg.locator('details.dc-row[data-dcp="/gloss-ppf"]').get_attribute('open') is not None and pg.locator('details.dc-row[data-dcp="/gloss-ppf"] .dcc-same').count() == 0 and pg.locator('details.dc-row[data-dcp="/gloss-ppf"] .dcc-missing').count() == 1, '"Only differences" hides the blocks that are the same, and the open pages stay open')
        pg.uncheck(ppf + '[data-dcc-only]'); time.sleep(0.4)
        PAGES['/window-tint'] = WT0
        n_live = len(LIVEF)
        pg.select_option('#dcSrc', 'draft'); pg.click('#dcRun')
        for _ in range(60):
            time.sleep(1)
            if 'on the draft' in (pg.inner_text('.db-tiles') if pg.locator('.db-tiles').count() else ''): break
        check('on the draft' in pg.inner_text('.db-tiles') and len(LIVEF) == n_live, 'picking "the draft in Duda" reads the draft instead')
        LIVE[0] = False
        check(not errors, 'no script errors ' + ' | '.join(errors[:3]))
        br.close()
except Exception:
    import traceback; traceback.print_exc(); ok = False
finally:
    srv.terminate()
    for pat in ['[f]ixsite.mjs', '[f]akeredis.mjs', '[d]ev-server.js']: subprocess.run(['pkill', '-f', pat])
print('ALL PASS' if ok else 'SOME FAILED')
