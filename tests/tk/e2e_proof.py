"""Proof pictures: critical items are pictured after a scan (cropped, red box, dated), any item can be
pictured by hand, an item marked False alarm is pictured, and downloaded reports carry the pictures.
Pages come from the fixture preview server and are pictured by a real Chrome. Usage: python3 -I e2e_proof.py <app> <tests>"""
import base64, json, os, re, subprocess, sys, time, urllib.parse, urllib.request
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, SPORT = 3998, 8093
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-proof.log'), 'w'), text=True)
assert srv.stdout.readline().strip() == 'READY'
TOK = 'tokadmin1234567890abcdef'; SITE = 'abc123'
def page_html(path):
    # The same HTML the preview server gives Chrome, so the items' selectors find the same elements.
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{SPORT}/site/{SITE}{"" if path == "/" else path}?dm_device=desktop') as r: html = r.read().decode()
        return {'status': 200, 'html': html, 'url': f'https://ed.multiscreensite.com/site/{SITE}{path}'}
    except Exception: return {'status': 404, 'html': '<html><body data-page-alias="dmPageNotFound"></body></html>', 'url': ''}
# Business Info has a different phone, so the header's call link is a critical item.
META = {'host': 'ed.multiscreensite.com', 'siteId': SITE, 'site': {'site_business_info': {'business_name': 'Buff & Beyond'}, 'site_domain': ''},
        'content': {'location_data': {'phones': [{'phoneNumber': '(302) 555-0100'}]}}, 'pages': [{'path': p, 'title': p, 'noIndex': False} for p in ['/', '/about']], 'errors': []}
def route(r):
    u = urllib.parse.urlparse(r.request.url); q = dict(urllib.parse.parse_qsl(u.query)); p = u.path
    if p == '/api/fetch': return r.fulfill(status=200, content_type='application/json', body=json.dumps(page_html(q.get('path'))))
    if p == '/api/site': return r.fulfill(status=200, content_type='application/json', body=json.dumps(META))
    if p in ('/api/social', '/api/check'): return r.fulfill(status=200, content_type='application/json', body='[]' if p == '/api/check' else '{}')
    if p == '/api/imghash': return r.fulfill(status=200, content_type='application/json', body=json.dumps({'hashes': {}}))
    if p == '/api/ai': return r.fulfill(status=400, content_type='application/json', body=json.dumps({'error': 'AI is not set up yet.'}))
    if p == '/api/capture' and r.request.method == 'POST' and json.loads(r.request.post_data or '{}').get('op') == 'contrast':
        return r.fulfill(status=200, content_type='application/json', body=json.dumps({'items': [], 'measured': 0, 'errors': []}))
    return r.continue_()
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
site = lambda pg: pg.evaluate("async () => (await fetch('/api/store?op=site&id=s1')).json()")
errors = []
try:
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
        ctx.add_cookies([{'name': 'dsa_sess', 'value': TOK, 'domain': 'localhost', 'path': '/'}])
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('dialog', lambda d: d.accept())
        pg.route('**/api/**', route)
        pg.goto(f'http://localhost:{APORT}/#/site/s1'); pg.wait_for_selector('#sRescan', timeout=20000); time.sleep(1)
        pg.click('#sRescan')
        S = None
        for _ in range(240):
            time.sleep(1)
            S = site(pg)
            if (S.get('scan') or {}).get('state') == 'complete' and not pg.evaluate("() => !!document.querySelector('.scan-progress, .progress-bar')") and any(f.get('proof') for f in S['findings']): break
        time.sleep(2); S = site(pg)
        crit = [f for f in S['findings'] if f['severity'] == 'critical' and not f.get('gone')]
        for f in S['findings']: print('   ', f['code'], f['severity'], f.get('selector'), bool(f.get('proof')))
        tel = [f for f in crit if f['code'].startswith('TEL_')]
        check(tel and tel[0].get('proof', {}).get('img'), 'after the scan, the critical call-link item has a proof picture')
        pr = (tel or [{}])[0].get('proof') or {}
        check(pr.get('device') == 'desktop' and pr.get('path') == '/' and 'tel:3024217788' in pr.get('code', '') and pr.get('at'), 'the proof is dated, says the page and device, and keeps the element\'s code')
        img = pg.evaluate(f"async () => {{ const r = await fetch('/api/capture?op=proofImg&site=s1&f={tel[0]['id'] if tel else 'x'}'); const b = await r.arrayBuffer(); return [r.status, r.headers.get('content-type'), b.byteLength]; }}")
        check(img[0] == 200 and img[1] == 'image/webp' and 1000 < img[2] < 150000, f'the picture is a small cropped image ({img[2]} bytes)')
        check(all(not f.get('proof') for f in S['findings'] if f['severity'] != 'critical'), 'only critical items are pictured automatically')
        pg.goto(f'http://localhost:{APORT}/#/site/s1'); pg.wait_for_selector('table.findings', timeout=15000); time.sleep(0.6)
        check(pg.locator('.proof-th img').count() >= 1 and '📸 Proof' in pg.inner_text('table.findings'), 'the item shows its proof thumbnail and date')
        pg.click('.proof-th >> nth=0'); time.sleep(0.4)
        check(pg.locator('.lightbox img').count() == 1, 'clicking it opens the full picture')
        pg.keyboard.press('Escape'); time.sleep(0.2)
        # By hand: a warning item.
        cap = pg.locator('[data-proofcap]')
        n0 = len([f for f in site(pg)['findings'] if f.get('proof')])
        check(cap.count() >= 1, 'items without a picture offer "📸 Capture proof"')
        if cap.count():
            cap.nth(0).click()
            for _ in range(60):
                time.sleep(1)
                if len([f for f in site(pg)['findings'] if f.get('proof')]) > n0: break
            check(len([f for f in site(pg)['findings'] if f.get('proof')]) > n0, 'Capture proof takes the picture by hand')
        # Marked False alarm: pictured first.
        S = site(pg)
        pg.goto(f'http://localhost:{APORT}/#/site/s1'); pg.wait_for_selector('table.findings', timeout=15000); time.sleep(0.6)
        ids = pg.evaluate("() => [...document.querySelectorAll('select[data-fst]')].map(x => x.dataset.fst)")
        target = next((f for f in S['findings'] if f['id'] in ids and not f.get('proof') and f.get('selector') and f['selector'] != '(page)' and not f.get('gone')), None)
        check(target, 'there is an item without a picture to mark False alarm')
        if target:
            pg.select_option(f'select[data-fst="{target["id"]}"]', 'false'); time.sleep(0.6)
            if pg.locator('#faSkip').count(): pg.click('#faSkip')
            for _ in range(60):
                time.sleep(1)
                f2 = next((f for f in site(pg)['findings'] if f['id'] == target['id']), {})
                if f2.get('proof'): break
            check(f2.get('status') == 'false' and f2.get('proof') and f2['proof'].get('why') == 'false', 'an item marked False alarm is pictured, so the picture is there if it turns out to be real')
        # The downloaded report carries the pictures.
        pg.goto(f'http://localhost:{APORT}/#/site/s1/dashboard'); pg.wait_for_selector('.db-table', timeout=15000); time.sleep(0.5)
        pg.click('#dbNow'); pg.wait_for_selector('#repDl', timeout=15000)
        with pg.expect_download() as dl: pg.click('#repDl')
        doc = open(dl.value.path()).read()
        check('data:image/webp;base64,' in doc and '📸 Proof' in doc, 'the downloaded report includes the proof pictures')
        check(not errors, 'no script errors ' + ' | '.join(errors[:3]))
        br.close()
except Exception:
    import traceback; traceback.print_exc(); ok = False
finally:
    srv.terminate()
    for pat in ['[f]ixsite.mjs', '[f]akeredis.mjs', '[d]ev-server.js']: subprocess.run(['pkill', '-f', pat])
print('ALL PASS' if ok else 'SOME FAILED')
