"""Does each page match its address? Wrong service, wrong town, business-name slips, notes left in.
Modelled on what a client found on hhceramiccoatings.com. Usage: python3 -I e2e_pagefit.py <app> <tests>"""
import json, os, re, subprocess, sys, time, threading, urllib.request, urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT, AIPORT = 3998, 8078, 8112
SEEN = {'fit': [], 'calls': 0}
class AI(BaseHTTPRequestHandler):
    """A stand-in AI: answers the page-fit read from the prompt it is sent; everything else is fine."""
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get('content-length') or 0)) or b'{}')
        system = body.get('system') if isinstance(body.get('system'), str) else json.dumps(body.get('system'))
        user = ''.join(m['content'] if isinstance(m['content'], str) else ''.join(c.get('text', '') for c in m['content']) for m in body.get('messages', []))
        SEEN['calls'] += 1
        results = []
        if 'You review image ALT TEXT' in system:
            for m in re.finditer(r'^(\d+) \| ', user, re.M): results.append({'i': int(m.group(1)), 'verdict': 'describes_image', 'confidence': 0.9, 'reason': 'photo', 'suggestion': ''})
        elif 'is about what its ADDRESS' in system:
            for m in re.finditer(r'^=== \[(\d+)\] (\S+)\nAddress says: ([^\n]*)', user, re.M):
                SEEN['fit'].append((m.group(2), m.group(3)))
                if m.group(2) == '/locations/belton-tx/window-tint':
                    results.append({'i': int(m.group(1)), 'type': 'wrong_service', 'part': 'body', 'quote': 'keep your paint glossy for years', 'confidence': 0.9, 'reason': 'The copy describes ceramic coating, not window tint', 'suggestion': ''})
                if m.group(2) == '/locations/nolanville-tx/ceramic-coating':
                    results.append({'i': int(m.group(1)), 'type': 'wrong_service', 'part': 'h1', 'quote': 'Paint Protection Film Installation', 'confidence': 0.95, 'reason': 'H1 is about PPF', 'suggestion': 'Ceramic Coating'})
        out = json.dumps({'model': 'claude-haiku-4-5-20251001', 'content': [{'type': 'text', 'text': json.dumps({'results': results})}], 'usage': {'input_tokens': 900, 'output_tokens': 120}}).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(out)
    def log_message(self, *a): pass
threading.Thread(target=HTTPServer(('127.0.0.1', AIPORT), AI).serve_forever, daemon=True).start()
env = dict(os.environ, ANTHROPIC_API_KEY='sk-test', ANTHROPIC_API_BASE=f'http://127.0.0.1:{AIPORT}/v1', ANTHROPIC_MODEL='claude-haiku-4-5-20251001', AI_ORDER='anthropic')
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-pagefit.log'), 'w'), text=True, env=env)
assert srv.stdout.readline().strip() == 'READY'
TOK = 'tokadmin1234567890abcdef'; SITE = 'abc123'
def L(p): return '/site/' + SITE + ('' if p == '/' else p)
NAME = 'Harker Heights Ceramic Coatings'
PPF = '<p>Our paint protection film is a clear urethane layer that stops rock chips.</p><p>PPF keeps the hood and bumper like new. Our PPF installers use self-healing film.</p><p>Clear bra or full-body PPF, with a ten-year film warranty.</p><p>Ask about PPF for your Tesla.</p>'
CER = '<p>Ceramic coating bonds to your paint and keeps it glossy.</p><p>Our ceramic coating is hydrophobic, so water beads off.</p><p>Every ceramic coating package includes a decontamination wash.</p><p>Ceramic coating lasts for years.</p>'
PAGES = {
    '/': ('Harker Heights Ceramic Coatings | Ceramic Coating, PPF & Tint', '<h1>Harker Heights Ceramic Coatings</h1><p>Ceramic coating, PPF and window tint in Harker Heights, TX.</p>'),
    '/locations/nolanville-tx': ('Car Care in Nolanville, TX', '<h1>Serving Nolanville, TX</h1><p>Ceramic coating, PPF and window tint for Nolanville drivers.</p>'),
    '/locations/nolanville-tx/ceramic-coating': ('Expert Paint Protection Film Installation Nolanville, TX', f'<h1>{NAME} - Pro-Grade Paint Protection Film Installation for Nolanville, TX Drivers</h1>' + PPF),
    '/locations/nolanville-tx/paint-protection-film': ('Professional-Grade Ceramic Coating Nolanville, TX', f'<h1>{NAME} - Nolanville, TX\u2019s #1 Ceramic Coating Application Team</h1>' + CER),
    '/locations/temple-tx/paint-protection-film': ('Paint Protection Film in Temple, TX', f'<h1>HARKER HEIGHTS CERAMIC COATINGS - COPPERAS COVE, TX\u2019S TOP PROVIDER OF A PAINT PROTECTION FILM</h1><p>PPF for Temple drivers.</p><p>Paint protection film in Temple keeps your paint safe.</p>'),
    '/locations/copperas-cove-tx/ceramic-coating': ('Ceramic Coating in Copperas Cove, TX', '<h1>Ceramic Coating in Copperas Cove</h1>' + CER),
    '/locations/georgetown-tx/paint-protection-film': ('Paint Protection Film Georgetown, TX', '<h1>Harker Heights Ceramic Coating - Georgetown Paint Protection Film</h1><p>PPF in Georgetown, installed by Harker Heights Ceramic Coatings.</p>'),
    '/locations/belton-tx/window-tint': ('Window Tint in Belton, TX', '<h1>Window Tint in Belton</h1><p>Our team will keep your paint glossy for years in Belton.</p>'),
    '/fort-hood-window-tint-law': ('Fort Hood Window Tint Law', '<h1>Fort Hood Window Tint Law</h1><p>Window tint inspections on post are free for soldiers. [Matthew: confirm this is free before publishing.]</p><div class="dmButton"><span>Button</span></div>'),
    '/window-tint': ('Window Tint \u2502 Harker Heights \u2013 Ceramic\u200b Coatings', '<h1>Window Tint</h1><p>Window tint for every car. Tint that keeps the cabin cool.</p>'),
    '/paint-correction': ('Paint Correction | Harker Heights Ceramic Coatings', '<h1>Paint Correction</h1><p>Paint correction removes swirls \u2014 the kind a car wash leaves.</p>'),
    '/contrast-test': ('Get a Quote | Harker Heights Ceramic Coatings', '<h1>Get a Quote</h1><p>Contrast cases are on the preview server.</p>'),
    '/ceramic-coating': ('Ceramic Coating | Harker Heights Ceramic Coatings', '<h1>Ceramic Coating</h1>' + CER + '<p>Pair it with PPF on the front end.</p>'),
}
def page_html(path):
    nav = '<div id="hcontainer" class="dmHeader">' + ' '.join(f'<a href="{L(p)}">{p}</a>' for p in PAGES) + '</div>'
    if path not in PAGES: return {'status': 404, 'html': '<html><body data-page-alias="dmPageNotFound"></body></html>', 'url': ''}
    title, body = PAGES[path]
    return {'status': 200, 'html': f'<html><head><title>{title}</title></head><body>{nav}<div id="dmcontent">{body}</div></body></html>', 'url': f'https://ed.multiscreensite.com/site/{SITE}{path}'}
# Business Info carries both spellings, the way the real website's did: that must not hide the slip.
META = {'host': 'ed.multiscreensite.com', 'siteId': SITE, 'site': {'site_business_info': {'business_name': NAME}, 'site_domain': ''},
        'content': {'business_data': {'name': 'Harker Heights Ceramic Coating'}, 'location_data': {'phones': [{'phoneNumber': '(254) 555-0142'}], 'address': {'city': 'Harker Heights', 'region': 'TX', 'zip_code': '76548', 'street': '1 Main St'}}},
        'pages': [{'path': p, 'title': p, 'noIndex': False} for p in PAGES], 'errors': []}
def route(r):
    u = urllib.parse.urlparse(r.request.url); q = dict(urllib.parse.parse_qsl(u.query)); p = u.path
    if p == '/api/fetch': return r.fulfill(status=200, content_type='application/json', body=json.dumps(page_html(q.get('path'))))
    if p == '/api/site': return r.fulfill(status=200, content_type='application/json', body=json.dumps(META))
    if p in ('/api/social', '/api/check'): return r.fulfill(status=200, content_type='application/json', body='[]' if p == '/api/check' else '{}')
    if p == '/api/imghash': return r.fulfill(status=200, content_type='application/json', body=json.dumps({'hashes': {}}))
    return r.continue_()
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
errors = []
try:
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(viewport={'width': 1440, 'height': 1000})
        ctx.add_cookies([{'name': 'dsa_sess', 'value': TOK, 'domain': 'localhost', 'path': '/'}])
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('dialog', lambda d: d.accept())
        pg.route('**/api/**', route)
        pg.goto(f'http://localhost:{APORT}/#/site/s1'); pg.wait_for_selector('#sRescan', timeout=20000); time.sleep(1.5)
        pg.click('#sRescan')
        S = None
        for _ in range(150):
            time.sleep(1)
            S = pg.evaluate("async () => (await fetch('/api/store?op=site&id=s1')).json()")
            if (S.get('scan') or {}).get('state') in ('complete', 'failed'): break
        check((S.get('scan') or {}).get('state') == 'complete', 'the scan finished')
        F = S.get('findings') or []
        for f in F: print(f"   #{f.get('num')} {f['code']:<20} {f.get('severity'):<8} {f.get('path')} · {(f.get('found') or '')[:90]}")
        def has(code, path, sev=None, part=None):
            return [f for f in F if f['code'] == code and path in (f.get('pages') or [f.get('path')]) and (sev is None or f['severity'] == sev) and (part is None or part in f['message'])]
        n1 = '/locations/nolanville-tx/ceramic-coating'; n2 = '/locations/nolanville-tx/paint-protection-film'
        check(has('PAGE_TOPIC_MISMATCH', n1, 'critical', 'SEO title') and has('PAGE_TOPIC_MISMATCH', n1, 'critical', 'H1'), 'the Nolanville ceramic coating page about PPF: its SEO title and H1 are critical')
        check(has('PAGE_TOPIC_BODY', n1), '…and its copy, mostly about PPF, is raised too')
        check(has('PAGE_TOPIC_MISMATCH', n2, 'critical', 'SEO title') and has('PAGE_TOPIC_MISMATCH', n2, 'critical', 'H1'), 'the Nolanville PPF page about ceramic coating is critical')
        check(not any(f['code'].startswith('PAGE_TOPIC') for f in F if f.get('path') in ('/locations/nolanville-tx', '/', '/ceramic-coating', '/locations/copperas-cove-tx/ceramic-coating')), 'a town-only page, the home page and pages that match their address are left alone (the business name "Ceramic Coatings" is not a topic)')
        wc = has('PAGE_WRONG_CITY', '/locations/temple-tx/paint-protection-film', 'critical', 'H1')
        check(wc and 'Copperas Cove' in wc[0]['message'] and 'Temple' in wc[0]['message'], 'the Temple page whose H1 names Copperas Cove is critical: ' + (wc[0]['message'] if wc else 'none'))
        check(not any(f['code'].startswith('PAGE_WRONG_CITY') and 'Harker Heights' in f['message'] for f in F), 'the town inside the business name ("Harker Heights") is never read as a location claim')
        nv = [f for f in F if f['code'] == 'NAME_SPELLING' and 'Harker Heights Ceramic Coating' == f['found']]
        check(nv and nv[0]['severity'] == 'critical' and 'H1' in nv[0]['message'] and 'missing the final "s"' in nv[0]['message'], 'the Georgetown H1 "Harker Heights Ceramic Coating" is a critical name slip, even with both spellings in Business Info: ' + (nv[0]['message'] if nv else 'none'))
        ph = has('PLACEHOLDER', '/fort-hood-window-tint-law', 'critical')
        check(any('Matthew' in f['found'] for f in ph), 'the editor note "[Matthew: confirm this is free before publishing.]" is critical')
        check(any(f['found'] == 'Button' for f in ph), 'a Duda button left saying "Button" is critical')
        ai = has('AI_PAGE_TOPIC', '/locations/belton-tx/window-tint')
        check(ai and ai[0]['severity'] == 'warning' and ai[0].get('ai'), 'the AI catches a page the rules cannot match word for word (tint page describing a coating)')
        check(not has('AI_PAGE_TOPIC', n1) and any(f.get('ai') for f in has('PAGE_TOPIC_MISMATCH', n1)), 'when a rule already raised it, the AI\'s opinion joins that item instead of doubling it')
        sent = dict(SEEN['fit'])
        check(sent.get(n1, '').startswith('service = ceramic') and 'town = nolanville' in sent.get(n1, '') and 'town = nolanville' in sent.get('/locations/nolanville-tx', '') and 'none (location' in sent.get('/locations/nolanville-tx', ''), 'the AI is told what each address promises (service and town; town only for a location page)')
        fit = (S.get('scan') or {}).get('ai', {}).get('fit') or {}
        check(fit.get('pages', 0) >= 9, f'the scan notes count the pages read against their address ({fit.get("pages")})')
        pg.goto(f'http://localhost:{APORT}/#/site/s1'); pg.wait_for_selector('table.findings', timeout=15000); time.sleep(0.6)
        txt = pg.inner_text('#tabBody')
        check('against their address' in txt, 'the scan panel says the pages were read against their address')
        check('SEO Lengths' in pg.inner_text('body'), 'the Lengths tab is called "SEO Lengths"')
        pg.screenshot(path=os.path.join(OUT, 'pagefit.png'))
        calls = SEEN['calls']
        pg.click('#sRescan')
        for _ in range(150):
            time.sleep(1)
            S2 = pg.evaluate("async () => (await fetch('/api/store?op=site&id=s1')).json()")
            if (S2.get('scan') or {}).get('finishedAt') != (S.get('scan') or {}).get('finishedAt') and (S2.get('scan') or {}).get('state') == 'complete': break
        check(SEEN['calls'] == calls, f'a rescan asks the AI nothing new ({SEEN["calls"] - calls} new calls)')
        check(len([f for f in S2['findings'] if f['code'].startswith(('PAGE_', 'AI_PAGE_'))]) == len([f for f in F if f['code'].startswith(('PAGE_', 'AI_PAGE_'))]), '…and the page-fit items are still there')
        lk = [f for f in F if f['code'] == 'META_LOOKALIKE_CHAR']
        check(len(lk) == 1 and lk[0]['path'] == '/window-tint', 'look-alike characters in an SEO title are raised once, on that page only (a plain "|" title is fine)')
        if lk:
            m = lk[0]['message']; print('   ', m, '→', lk[0].get('expected'))
            check('box-drawing line "\u2502" (U+2502)' in m and 'en dash' in m and 'zero-width space' in m and 'keyboard pipe' in m, 'it names each character (box-drawing line, en dash used as a separator, zero-width space)')
            check(lk[0].get('expected') == 'Window Tint | Harker Heights | Ceramic Coatings', 'and gives the title with plain pipes and the invisible character removed: ' + repr(lk[0].get('expected')))
            check(lk[0]['severity'] == 'warning' and lk[0]['category'] == 'Meta / SEO', 'it is a Meta / SEO warning on Audit items')
        # ---- Colour contrast (measured on the preview server's /contrast-test page) ----
        ct = [f for f in F if f['code'].startswith('CONTRAST_')]
        for f in ct: print('   ', f['code'], f['severity'], f.get('devices'), '|', f['message'][:110], '|', (f.get('found') or '')[:50])
        sc = (S.get('scan') or {}).get('contrast') or {}
        check(sc.get('pages', 0) >= 1, f'the scan measured colour contrast with a real browser: {sc}')
        def ctr(code, word): return [f for f in ct if f['code'] == code and word in (f.get('message', '') + f.get('found', ''))]
        check(ctr('CONTRAST_PLACEHOLDER', 'First Name') and ctr('CONTRAST_PLACEHOLDER', 'Email'), 'pale placeholders in the gold form are raised (placeholder text needs 4.5:1)')
        check(ctr('CONTRAST_FIELD_TEXT', 'First Name'), 'what a visitor types into the gold form is measured too (the fields are typed into)')
        check(ctr('CONTRAST_FIELD_EDGE', 'First Name') and ctr('CONTRAST_FIELD_EDGE', 'Service Interested In'), 'field borders that barely show are raised (3:1), the textarea named by the words above it')
        check(ctr('CONTRAST_TEXT', 'light gray') and ctr('CONTRAST_TEXT', 'Book now'), 'light gray text and white-on-yellow button text are raised')
        check(ctr('CONTRAST_IMAGE', 'over a photo'), 'text in a wrapper with no background, over its parent\'s photo, is measured against the photo')
        check(ctr('CONTRAST_TEXT', 'sibling overlay'), 'text over an overlay that is a sibling (not a parent) is measured against what is really behind it')
        check(not any('dark text on white' in (f.get('found') or '') for f in ct) and not any('GET A QUOTE' in (f.get('found') or '') for f in ct), 'text that passes (dark on white, large white heading on gold) is not raised')
        g = ctr('CONTRAST_PLACEHOLDER', 'First Name')
        check(g and g[0].get('contrast', {}).get('need') == 4.5 and sorted(g[0].get('devices') or []) == ['desktop', 'mobile'], 'items carry both colours and the ratio, and are measured on desktop and mobile')
        sc_log = ' '.join((S.get('scan') or {}).get('log') or [])
        check('could not be measured' in sc_log, 'pages the browser could not open are said in the scan notes (and their contrast items are kept)')

        # ---- A third scan after a fix: the editor note is taken out ----
        t, b0 = PAGES['/fort-hood-window-tint-law']; PAGES['/fort-hood-window-tint-law'] = (t, b0.replace(' [Matthew: confirm this is free before publishing.]', ''))
        pg.goto(f'http://localhost:{APORT}/#/site/s1'); pg.wait_for_selector('#sRescan', timeout=20000); time.sleep(1); pg.click('#sRescan')
        for _ in range(200):
            time.sleep(1)
            S3 = pg.evaluate("async () => (await fetch('/api/store?op=site&id=s1')).json()")
            if (S3.get('scan') or {}).get('finishedAt') != (S2.get('scan') or {}).get('finishedAt') and (S3.get('scan') or {}).get('state') == 'complete': break

        # ---- Dashboard ----
        pg.goto(f'http://localhost:{APORT}/#/site/s1/dashboard'); pg.wait_for_selector('.db-tiles', timeout=20000); time.sleep(0.6)
        tiles = pg.inner_text('.db-tiles')
        check('Open items' in tiles and 'Critical open' in tiles and 'Scans on record' in tiles, 'the Dashboard tab shows the summary tiles')
        for _ in range(30):
            if pg.locator('.db-col').count() >= 3: break
            time.sleep(0.5)
        check(pg.locator('.db-col').count() == 3, f'the scan history has one column per scan ({pg.locator(".db-col").count()})')
        check(pg.locator('.db-seg-p').count() >= 2 and 'Critical' in pg.inner_text('.db-seg-keys'), 'open items are split by severity, each part named and counted')
        check(pg.locator('.db-hb').count() >= 3, 'open items by category and by page are drawn as bars')
        pg.hover('.db-col >> nth=0'); time.sleep(0.2)
        check(pg.is_visible('#dbTip') and 'Total' in pg.inner_text('#dbTip'), 'hovering a column shows its numbers')
        pg.click('#dbAdd'); pg.fill('#dbTool', 'Semrush'); pg.fill('#dbDate', '2026-11-01'); pg.fill('#dbC', '7'); pg.fill('#dbW', '40'); pg.fill('#dbI', '12'); pg.fill('#dbN', 'Site Audit, health 81%')
        pg.click('#dbForm button[type=submit]'); pg.wait_for_selector('.db-row-other', timeout=15000); time.sleep(0.6)
        row = pg.inner_text('.db-row-other')
        check('Semrush' in row and '59' in row and pg.locator('.db-col-other').count() == 1, 'another tool\'s result is added to the table and the chart (striped): ' + row.replace('\n', ' | '))
        check(pg.locator('.db-col').count() == 4 and pg.inner_text('.db-col >> nth=0').find('Semrush') >= 0, 'it sits in date order (Nov 1, before our scans)')
        pg.screenshot(path=os.path.join(OUT, 'dashboard.png'), full_page=True)
        pg.evaluate("document.documentElement.setAttribute('data-scheme','dark')"); time.sleep(0.3); pg.screenshot(path=os.path.join(OUT, 'dashboard-dark.png'), full_page=True); pg.evaluate("document.documentElement.removeAttribute('data-scheme')")
        pg.set_viewport_size({'width': 390, 'height': 844}); time.sleep(0.5); pg.screenshot(path=os.path.join(OUT, 'dashboard-phone.png'), full_page=True); pg.set_viewport_size({'width': 1440, 'height': 1000})
        with pg.expect_download() as dl: pg.click('#dbCsv')
        csv = open(dl.value.path()).read()
        check(csv.startswith('"Date","Tool","Critical"') and 'Semrush' in csv and csv.count('\n') == 4, 'the history downloads as CSV')
        pg.click('[data-dbrm]')
        try: pg.wait_for_function("() => !document.querySelector('.db-row-other')", timeout=10000); gone = True
        except Exception: gone = False
        check(gone, 'the typed-in result can be removed again')
        snaps = pg.evaluate("async () => (await (await fetch('/api/store?op=site&id=s1')).json()).scans || []")
        check(len(snaps) == 3 and all(x.get('rep') for x in snaps), 'every scan keeps a report of its items')
        # ---- Scan reports and comparisons ----
        check(pg.locator('[data-dbview]').count() == 3, 'each scan in the table has a View button')
        pg.click('[data-dbview] >> nth=0'); pg.wait_for_selector('#repList .rep-row', timeout=15000)
        first_n = pg.locator('#repList .rep-row').count()
        check(first_n >= 10 and 'Every item' in pg.inner_text('#repBody') and 'Matthew' in pg.inner_text('#repBody'), f'a past scan opens with its numbers, charts and every item it found ({first_n} shown)')
        pg.fill('#repQ', 'Matthew'); time.sleep(0.3)
        check(pg.locator('#repList .rep-row').count() == 1, 'the items can be searched')
        with pg.expect_download() as dl: pg.click('#repDl')
        doc = open(dl.value.path()).read()
        check(doc.startswith('<!doctype html>') and 'Scan report' in doc and 'db-seg' in doc and 'Matthew' in doc, 'one scan downloads as its own report (a web page with the charts and every item)')
        pg.select_option('#repWith', index=1); pg.click('#repCmp'); pg.wait_for_selector('#cmpBody .rep-tiles', timeout=15000); time.sleep(0.3)
        ctext = pg.inner_text('#cmpBody')
        check('Fixed (1)' in ctext and 'Matthew' in ctext.split('Fixed (1)')[1].split('New (')[0], 'comparing the first scan with the third shows the editor note as fixed')
        check('Still there' in ctext and 'Before and after' in ctext and 'By category' in ctext, 'with before/after bars, the categories and what is still there')
        pg.screenshot(path=os.path.join(OUT, 'compare.png'), full_page=True)
        with pg.expect_download() as dl: pg.click('#cmpDl')
        cdoc = open(dl.value.path()).read()
        check('Scan comparison' in cdoc and 'Fixed (1)' in cdoc and 'cmp-bars' in cdoc, 'the comparison downloads as a report too')
        pg.click('[data-close]'); time.sleep(0.3)
        pg.click('#dbFirstNow'); pg.wait_for_selector('#cmpBody .rep-tiles', timeout=15000)
        check('Today' in pg.inner_text('#cmpBody'), '"First scan vs today" compares the first scan with the audit as it is now')
        pg.click('[data-close]')
        check(len(snaps) == 3 and all(x.get('auto') and x['counts']['critical'] >= 1 and x.get('cats') for x in snaps), f'each scan is recorded with its counts and categories ({len(snaps)})')

        # ---- Demo mode: the same audit, nothing real on the screen ----
        REAL = ['Harker Heights Ceramic', 'HARKER HEIGHTS CERAMIC', 'Reymark', 'reymark@', '8bitcreative', '8bit Creative', '(254)', '254-555', 'Dana Dev', 'Buff & Beyond', 'Detailers Roadmap']
        def leaks(txt): return [w for w in REAL if w.lower() in txt.lower()]
        pg.goto(f'http://localhost:{APORT}/?demo=1#/site/s1'); pg.wait_for_selector('table.findings', timeout=20000); time.sleep(1.2)
        check(pg.is_visible('.demo-bar') and 'demo=1' not in pg.url, 'demo mode starts from ?demo=1, shows its bar, and tidies the address')
        txt = pg.inner_text('body')
        check(not leaks(txt), 'the audit page shows no real business name, person, phone or agency name: ' + ', '.join(leaks(txt)))
        html = pg.evaluate("() => [...document.querySelectorAll('[title],[href],[alt]')].map(e => (e.getAttribute('title')||'') + ' ' + (e.getAttribute('href')||'') + ' ' + (e.getAttribute('alt')||'')).join(' ')")
        check(not leaks(html), 'tooltips, links and alt text are swapped too: ' + ', '.join(leaks(html)))
        check(pg.evaluate("() => document.title").lower().find('harker') < 0, 'the browser tab title is swapped')
        pg.screenshot(path=os.path.join(OUT, 'demo-audit.png'))
        pg.goto(f'http://localhost:{APORT}/#/'); time.sleep(1.5)
        txt = pg.inner_text('body')
        check(pg.is_visible('.demo-bar') and not leaks(txt), 'it stays on across pages (Audits list) with nothing real showing: ' + ', '.join(leaks(txt)))
        pg.screenshot(path=os.path.join(OUT, 'demo-list.png'))
        pg.goto(f'http://localhost:{APORT}/#/site/s1'); pg.wait_for_selector('#sStatus', timeout=20000); time.sleep(0.8)
        before = pg.input_value('#sStatus')
        pg.select_option('#sStatus', 'In progress'); time.sleep(1.2)
        refused = 'view-only' in pg.inner_text('#toast')
        pg.reload(); pg.wait_for_selector('#sStatus', timeout=20000); time.sleep(0.8)
        after = pg.input_value('#sStatus')
        check(refused and before == after == 'Not started', f'it is view-only: changing the status is refused and nothing is saved ({before!r} → {after!r})')
        nv = pg.evaluate("() => [...document.querySelectorAll('table.findings tr')].map(r => r.innerText).find(t => t.includes('missing the final'))") or ''
        m = re.search(r'Found: (.+)\n+(?:.*Capture proof.*\n+)?Expected: (.+)', nv)
        check(m and m.group(2).strip() == m.group(1).strip() + 's', 'the name slip still reads as a slip with made-up names ("X" found, "Xs" expected): ' + (repr(m.groups()) if m else repr(nv[-200:])))
        pg.set_viewport_size({'width': 390, 'height': 844}); time.sleep(0.5); pg.screenshot(path=os.path.join(OUT, 'demo-phone.png')); pg.set_viewport_size({'width': 1440, 'height': 1000})
        pg.click('#demoExit'); pg.wait_for_selector('table.findings', timeout=20000); time.sleep(1)
        check(not pg.is_visible('.demo-bar') and 'Harker Heights Ceramic' in pg.inner_text('body'), 'Exit demo brings the real names back')
        check(not errors, 'no script errors ' + ' | '.join(errors[:3]))
        br.close()
except Exception:
    import traceback; traceback.print_exc(); ok = False
finally:
    srv.terminate()
    for pat in ['[f]ixsite.mjs', '[f]akeredis.mjs', '[d]ev-server.js']: subprocess.run(['pkill', '-f', pat])
print('ALL PASS' if ok else 'SOME FAILED')
