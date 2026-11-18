"""A scan shows how long it has been running, and every scan's report says how long it took.
Usage: python3 -I e2e_took.py <app> <tests>"""
import json, os, subprocess, sys, time, urllib.parse
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT = 3998
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-took.log'), 'w'), text=True)
assert srv.stdout.readline().strip() == 'READY'
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
errors = []
PAGE = '''<html><head><title>Home | Buff & Beyond</title><style>.photoGallery .caption-button { visibility: hidden; }</style></head><body><div id="dmcontent"><h1>Buff & Beyond</h1>
<div class="photoGallery"><div class="caption-container"><a class="caption-button" id="gb1" href="#"><span class="text">Button</span></a></div></div>
<div id="cta"><a class="dmButtonLink" id="vb1" href="/contact"><span class="text">Button</span></a></div></div></body></html>'''
META = {'host': 'ed.multiscreensite.com', 'siteId': 'abc123', 'site': {'site_business_info': {'business_name': 'Buff & Beyond'}}, 'content': {}, 'pages': [{'path': '/', 'title': 'Home'}], 'errors': []}
def site_route(r):
    if 'light=1' in r.request.url: return r.fulfill(status=200, content_type='application/json', body=json.dumps({'siteId': 'abc123', 'publishStatus': 'NOT_PUBLISHED'}))
    return r.fulfill(status=200, content_type='application/json', body=json.dumps(META))
try:
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(viewport={'width': 1440, 'height': 1000}); ctx.add_cookies([{'name': 'dsa_sess', 'value': 'tokadmin1234567890abcdef', 'domain': 'localhost', 'path': '/'}])
        ctx.route('**/api/site?*', site_route)
        ctx.route('**/api/fetch?*', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps({'status': 200, 'html': PAGE, 'url': 'https://x/site/abc123/'})))
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(f'http://localhost:{APORT}/#/site/s1'); pg.wait_for_selector('#sRescan', timeout=20000); time.sleep(1)
        pg.click('#sRescan')
        clock = ''
        for _ in range(60):
            time.sleep(0.5)
            if pg.locator('[data-elapsed]').count(): time.sleep(2.2); clock = pg.inner_text('.scan-clock'); break
        print('  clock:', clock, flush=True)
        check('⏱' in clock and any(ch.isdigit() for ch in clock), 'while scanning, a timer shows how long the scan has been running')
        S = {}
        for _ in range(120):
            time.sleep(1)
            S = pg.evaluate("async () => (await (await fetch('/api/store?op=site&id=s1')).json())")
            if (S.get('scan') or {}).get('state') == 'complete': break
        time.sleep(1.5)
        last = (S.get('scans') or [{}])[-1]
        check(last.get('ms', 0) > 0, f"the scan history keeps how long it took ({last.get('ms')} ms)")
        pg.goto(f'http://localhost:{APORT}/#/site/s1'); pg.reload(); pg.wait_for_selector('table.findings', timeout=15000); time.sleep(0.6)
        check('took' in pg.inner_text('#tabBody'), 'the scan summary says how long it took')
        pg.goto(f'http://localhost:{APORT}/#/site/s1/report'); pg.wait_for_selector('.db-table', timeout=15000); time.sleep(0.6)
        hdr = pg.inner_text('table.db-table >> nth=-1')
        check('TOOK' in hdr.upper(), 'the scan history table has a Took column')
        pg.click('[data-dbview] >> nth=-1'); pg.wait_for_selector('.rep', timeout=15000); time.sleep(0.4)
        check('took' in pg.inner_text('.rep').lower(), 'and the scan report says how long it took')
        check(not errors, 'no script errors ' + ' | '.join(errors[:3]))
        br.close()
except Exception:
    import traceback; traceback.print_exc(); ok = False
finally:
    srv.terminate()
    for pat in ['[f]ixsite.mjs', '[f]akeredis.mjs', '[d]ev-server.js']: subprocess.run(['pkill', '-f', pat])
print('ALL PASS' if ok else 'SOME FAILED')
