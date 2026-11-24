"""The client report: a PDF with each finding written up (page, what is there, what to change), fixed items, coverage.
Usage: python3 -I e2e_clientpdf.py <app> <tests>"""
import json, os, re, subprocess, sys, time, threading, urllib.request, urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT, AIPORT = 3998, 8078, 8112
SEEN = {'fit': [], 'calls': 0, 'report': [], 'rprompt': ''}
class AI(BaseHTTPRequestHandler):
    """A stand-in AI: answers the page-fit read from the prompt it is sent; everything else is fine."""
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get('content-length') or 0)) or b'{}')
        system = body.get('system') if isinstance(body.get('system'), str) else json.dumps(body.get('system'))
        user = ''.join(m['content'] if isinstance(m['content'], str) else ''.join(c.get('text', '') for c in m['content']) for m in body.get('messages', []))
        SEEN['calls'] += 1
        results = []
        if 'WHAT WE FIXED' in system:
            SEEN['fixed'] = SEEN.get('fixed', 0) + 1; SEEN['fprompt'] = SEEN.get('fprompt', '') + user
            for m in re.finditer(r'^=== key (\S+)\nPage: ([^\n]*)', user, re.M):
                results.append({'k': m.group(1), 'title': f'Removed the note left for the writer on {m.group(2).split(" · ")[0]}', 'impact': 'Visitors now read a finished page instead of an internal note.', 'area': 'visitors'})
        elif 'WEBSITE AUDIT REPORT' in system:
            SEEN['rprompt'] += user
            for m in re.finditer(r'^=== key (\S+)\nPage: ([^\n]*)', user, re.M):
                SEEN['report'].append(m.group(1))
                pg, url = (m.group(2).split(' · ') + [''])[:2]
                results.append({'k': m.group(1), 'title': f'Confirm the target area of the {pg} page', 'current': f'The page at {url} has a title naming another town. The business is based at 1 Main St, Harker Heights, TX.', 'recommendation': 'Confirm which area this page should target, then make the title and heading agree.', 'priority': 'now'})
        elif 'You review image ALT TEXT' in system:
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
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-clientpdf.log'), 'w'), text=True, env=env)
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
def scan(pg, before=None):
    pg.click('#sRescan')
    for _ in range(180):
        time.sleep(1)
        S = pg.evaluate("async () => (await fetch('/api/store?op=site&id=s1')).json()")
        sc = S.get('scan') or {}
        if sc.get('state') in ('complete', 'failed') and sc.get('finishedAt') != before: return S
    return S
try:
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
        ctx.add_cookies([{'name': 'dsa_sess', 'value': TOK, 'domain': 'localhost', 'path': '/'}])
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('dialog', lambda d: d.accept())
        pg.route('**/api/**', route)
        pg.goto(f'http://localhost:{APORT}/#/site/s1'); pg.wait_for_selector('#sRescan', timeout=20000); time.sleep(1.5)
        S1 = scan(pg)
        # A note with a screenshot on the editor-note item (it is fixed by the second scan).
        mat = next(f for f in S1['findings'] if f['code'] == 'PLACEHOLDER' and 'Matthew' in (f.get('found') or ''))
        PNG = 'iVBORw0KGgoAAAANSUhEUgAAAHgAAAA8CAIAAAAiz+n/AAAAhUlEQVR4nO3QAQkAIBDAQIN9f4xlC4V5sADj1p7Rhdbzg08CDboVaNCtQINuBRp0K9CgW4EG3Qo06FagQbcCDboVaNCtQINuBRp0K9CgW4EG3Qo06FagQbcCDboVaNCtQINuBRp0K9CgW4EG3Qo06FagQbcCDboVaNCtQINuBRp0K9CgWx0RPyoOIgXUmAAAAABJRU5ErkJggg=='
        pg.evaluate("async (a) => { const up = await (await fetch('/api/img', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: a[1], type: 'image/png' }) })).json(); await fetch('/api/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'comment', siteId: 's1', target: a[0], text: 'Client confirmed the soldier inspections are free; note removed.', images: [up.url] }) }); }", [mat['id'], PNG])
        # The editor note is taken out: the second scan finds it fixed.
        PAGES['/fort-hood-window-tint-law'] = ('Fort Hood Window Tint Law', '<h1>Fort Hood Window Tint Law</h1><p>Window tint inspections on post are free for soldiers.</p>')
        S2 = scan(pg, (S1.get('scan') or {}).get('finishedAt'))
        check((S2.get('scan') or {}).get('state') == 'complete', 'two scans finished')
        F = [f for f in S2['findings'] if not f.get('gone')]
        fa = next(f for f in F if f['code'] == 'AI_PAGE_TOPIC'); cl = next(f for f in F if f['code'].startswith('PAGE_TOPIC'))
        pg.evaluate("async (a) => { const st = (b) => fetch('/api/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); await st({ op: 'patchFinding', siteId: 's1', findingIds: [a[0]], changes: { status: 'false' } }); await st({ op: 'patchFinding', siteId: 's1', findingIds: [a[1]], changes: { status: 'clarification', asked: '' } }); }", [fa['id'], cl['id']])
        FA_FOUND = 'keep your paint glossy'
        pg.goto(f'http://localhost:{APORT}/#/site/s1/report'); pg.reload(); pg.wait_for_selector('#dbPdf', timeout=15000); time.sleep(0.8)
        print('   rows:', pg.locator('[data-dbview]').count(), pg.locator('.db-row-acts').count(), pg.evaluate("() => document.querySelector('.db-table tbody') && document.querySelector('.db-table tbody').innerHTML.slice(0, 600)"))
        print('   scans:', [(x.get('at'), bool(x.get('rep'))) for x in (S2.get('scans') or [])])
        check(pg.locator('[data-dbpdf]').count() >= 2, 'every saved scan has its own 📄 PDF')
        pg.click('#dbPdf'); pg.wait_for_selector('#rmGo', timeout=15000); time.sleep(1)
        win = pg.inner_text('.rm')
        print('   window:', ' | '.join(win.split('\n')[:16]))
        check('Findings report' in win and 'Website health report' in win, 'one window offers both reports')
        check(pg.is_checked('[data-rml=clar]') and pg.is_checked('[data-rml=contrast]') and pg.is_disabled('.rm-l.off input'), 'For clarification and colour contrast are left out by default; false alarms always are')
        check(re.search(r'Readability / colour contrast.*?\d+ items?', win, re.S), 'each leave-out choice says how many items it removes')
        with pg.expect_download(timeout=180000) as dl: pg.click('#rmGo')
        path = dl.value.path(); name = dl.value.suggested_filename
        data = open(path, 'rb').read()
        print('   file:', name, len(data), 'bytes', flush=True)
        check(name.endswith('.pdf') and data[:5] == b'%PDF-', 'the client report downloads as a PDF: ' + name)
        out = os.path.join(OUT, 'clientpdf.pdf'); open(out, 'wb').write(data)
        txt = subprocess.run(['pdftotext', '-layout', out, '-'], capture_output=True, text=True).stdout
        check('Updated website audit' in txt and 'Harker Heights Ceramic Coating' in txt, 'the cover names the business and says it is an updated audit (there is an earlier scan)')
        check('Review coverage' in txt and 'Fix first' in txt and 'How to use this report' in txt, 'the cover has the coverage table, what to fix first, and how to use the report')
        check('Confirm the target area of' in txt and 'Current:' in txt and 'Recommendation:' in txt, 'findings are written up: a title, what is there now, and the recommendation')
        check('B01' in txt or 'C01' in txt, 'findings are numbered by section (B01, C01…)')
        check('Completed corrections' in txt and 'Matthew' in txt, 'the editor note taken out between the scans is listed as corrected')
        check('Pages included in this review' in txt and 'Verification limits' in txt, 'it lists the pages reviewed and what was not checked')
        check('/ ' in txt and 'WEBSITE AUDIT' in txt, 'each page has the header band and page numbers')
        rp = SEEN['rprompt']
        check('SEO title' in rp and 'Main heading (H1)' in rp and 'Harker Heights' in rp and 'https://' not in rp.split('Website:')[0][:0] , 'the AI is given the page\'s SEO title, its H1 and the business\'s address')
        check('locations/temple-tx/paint-protection-film' in rp, 'the AI is given each finding\'s page address')
        check(not any(x in txt for x in ('PAGE_WRONG_CITY', 'selector', '[id=')), 'no check codes or selectors in the client report')
        check('pages, listed below' in txt and 'What is there now' in txt, 'the same kind of finding on several pages is one finding with a table of the pages')
        heads = re.findall(r'^\s*[A-Z]\d\d\s+(.+?)\s+(?:FIX NOW|FIX SOON|WHEN CONVENIENT)', txt, re.M)
        print('   findings:', len(heads), heads[:12])
        check(len(heads) == len(set(heads)) or len(heads) < 12, 'findings are not the same write-up repeated page after page')
        check('N pages' not in SEEN['rprompt'] and re.search(r'Page: \d+ pages', SEEN['rprompt']), 'the AI is asked for one write-up covering the pages')
        uris = data.count(b'/URI')
        check(uris >= 10, f'the page addresses in the PDF are clickable links ({uris})')
        subprocess.run(['pdftoppm', '-r', '60', '-png', '-f', '1', '-l', '3', out, os.path.join(OUT, 'clientpdf')])
        check(FA_FOUND not in txt and FA_FOUND not in SEEN['rprompt'], 'an item marked False alarm is not in the report (nor sent to the AI)')
        check('Hard-to-read pieces' not in txt, 'colour contrast is left out (the default)')
        n = len(SEEN['report'])
        with pg.expect_download(timeout=180000) as dl2: pg.click('#rmGo')
        check(len(SEEN['report']) == n, 'making it again asks the AI nothing new (the write-ups are remembered)')
        # ---- Progress report ----
        pg.check('[name=rmType][value=progress]'); time.sleep(0.4)
        check(pg.is_visible('#rmSince') and pg.locator('#rmSince option').count() >= 2, 'the progress report asks since which scan to count fixes')
        pg.select_option('#rmSince', index=0); time.sleep(0.3)
        print('   sum:', pg.inner_text('#rmSum'))
        check(re.search(r'cover \d+ fix', pg.inner_text('#rmSum')), 'it says how many fixes and open items it will cover')
        check(pg.is_visible('#rmTodo') and pg.is_checked('#rmTodo') and pg.is_checked('#rmNotes'), 'the progress report offers "what is still to do" and "the team\u2019s notes and screenshots", both on')
        pg.uncheck('#rmTodo'); time.sleep(0.3)
        check('completed work only' in pg.inner_text('#rmSum'), 'unticking "still to do" makes a report of the completed work only')
        with pg.expect_download(timeout=180000) as dl3: pg.click('#rmGo')
        d3 = open(dl3.value.path(), 'rb').read(); n3 = dl3.value.suggested_filename
        check(n3.startswith('website-health-') and d3[:5] == b'%PDF-', 'the progress report downloads as a PDF: ' + n3)
        out3 = os.path.join(OUT, 'progresspdf.pdf'); open(out3, 'wb').write(d3)
        t3 = subprocess.run(['pdftotext', '-layout', out3, '-'], capture_output=True, text=True).stdout
        check('Website health report' in t3 and 'What we fixed for you' in t3 and 'What we fixed' in t3 and 'Open on' not in t3, 'it has the health cover and what was fixed, and no "still to do" section')
        flat = ' '.join(t3.split())
        check(re.search(r'Your website is (in good shape|nearly there)', flat), 'the cover gives the owner a plain verdict')
        check('What we checked, and what it is for' in flat and 'Customers reach you, not an old number' in flat and ('All good' in flat or 'to finish' in flat), 'it lists what was checked, what each check is for, and whether each is all good')
        check('Do you need to do anything?' in flat, 'and tells the owner whether they need to do anything')
        check(not re.search(r'\bcritical\b|WCAG|schema|robots', flat, re.I), 'no severity words or technical terms for the owner')
        check('Client confirmed the soldier inspections are free' in ' '.join(t3.split()) and 'note from' in t3.lower(), 'the team\u2019s note on a fixed item is in the report')
        check(subprocess.run(['pdfimages', '-list', out3], capture_output=True, text=True).stdout.count('image') >= 1, 'with the screenshot attached to it')
        check('Removed the note left for the writer' in t3 and 'Visitors now read a finished page' in t3, 'each fix says what was done and why it matters')
        check('Matthew' in SEEN.get('fprompt', '') or 'Matthew' in t3, 'the fix is written from what was there before (the editor note)')
        check(FA_FOUND not in t3, 'the false alarm is not in the progress report either')
        subprocess.run(['pdftoppm', '-r', '60', '-png', '-f', '1', '-l', '2', out3, os.path.join(OUT, 'progresspdf')])
        br.close()
finally:
    srv.terminate()
check(not errors, 'no page errors ' + '; '.join(errors[:3]))
print('ALL PASS' if ok else 'SOME FAILED'); sys.exit(0 if ok else 1)
