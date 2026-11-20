"""Duda's spare "Button" in a photo gallery (and one a page script hides) is not reported; a real one is.
The page is the fixture site's /ppf-vs-ceramic, read both as code and in a real browser.
Usage: python3 -I e2e_gallerybtn.py <app> <tests>"""
import json, os, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, SPORT = 3998, 8093
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-gallerybtn.log'), 'w'), text=True)
assert srv.stdout.readline().strip() == 'READY'
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
errors = []
PATH = '/ppf-vs-ceramic'
META = {'host': 'ed.multiscreensite.com', 'siteId': 'abc123', 'site': {'site_business_info': {'business_name': 'Buff & Beyond'}}, 'content': {}, 'pages': [{'path': PATH, 'title': 'PPF vs Ceramic'}], 'errors': []}
HTML = urllib.request.urlopen(f'http://127.0.0.1:{SPORT}/site/abc123{PATH}').read().decode()
def fetch_route(r):
    p = urllib.parse.parse_qs(urllib.parse.urlparse(r.request.url).query).get('path', ['/'])[0]
    if p != PATH: return r.fulfill(status=200, content_type='application/json', body=json.dumps({'status': 404, 'html': '<html><body data-page-alias="dmPageNotFound"></body></html>', 'url': ''}))
    return r.fulfill(status=200, content_type='application/json', body=json.dumps({'status': 200, 'html': HTML, 'url': f'https://ed.multiscreensite.com/site/abc123{PATH}'}))
import urllib.parse
try:
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(viewport={'width': 1440, 'height': 1000}); ctx.add_cookies([{'name': 'dsa_sess', 'value': 'tokadmin1234567890abcdef', 'domain': 'localhost', 'path': '/'}])
        ctx.route('**/api/site?*', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps({'siteId': 'abc123', 'publishStatus': 'NOT_PUBLISHED'} if 'light=1' in r.request.url else META)))
        ctx.route('**/api/fetch?*', fetch_route)
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(f'http://localhost:{APORT}/#/site/s1'); pg.wait_for_selector('#sRescan', timeout=20000); time.sleep(1)
        pg.click('#sRescan')
        S = {}
        for _ in range(180):
            time.sleep(1)
            S = pg.evaluate("async () => (await (await fetch('/api/store?op=site&id=s1')).json())")
            if (S.get('scan') or {}).get('state') in ('complete', 'failed'): break
        check((S.get('scan') or {}).get('state') == 'complete', 'the scan finished')
        btn = [f for f in S.get('findings') or [] if f['code'] == 'PLACEHOLDER' and f.get('found') == 'Button' and not f.get('gone')]
        sels = [f.get('selector') for f in btn]
        print('  buttons:', sels, flush=True)
        for l in (S['scan'].get('log') or []):
            if 'Button' in l: print('  log:', l)
        check(not any(x in ' '.join(sels) for x in ('1889388497', '1775854035', '1626888154', '1233015223')), 'the photo gallery\'s caption buttons with no link are not reported')
        check(not any('200' in (s or '') for s in sels), 'a "Button" the page\'s script hides once it has loaded is not reported (checked in a real browser)')
        check(any('300' in (s or '') for s in sels) and all(f['severity'] == 'critical' for f in btn), 'a "Button" visitors see is still critical')
        check(any('real browser' in l for l in (S['scan'].get('log') or [])), 'the scan notes say a label was left out after the real-browser check')
        check(not errors, 'no script errors ' + ' | '.join(errors[:3]))
        br.close()
except Exception:
    import traceback; traceback.print_exc(); ok = False
finally:
    srv.terminate()
print('ALL PASS' if ok else 'SOME FAILED'); sys.exit(0 if ok else 1)
