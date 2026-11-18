"""A "Button" label hidden by the page's STYLESHEET (not inline) is not reported; a visible one still is.
Usage: python3 -I e2e_hiddenbtn.py <app> <tests>"""
import json, os, subprocess, sys, time, urllib.parse
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT = 3998
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-hiddenbtn.log'), 'w'), text=True)
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
        S = {}
        for _ in range(120):
            time.sleep(1)
            S = pg.evaluate("async () => (await (await fetch('/api/store?op=site&id=s1')).json())")
            if (S.get('scan') or {}).get('state') == 'complete': break
        btn = [f for f in S.get('findings') or [] if f['code'] == 'PLACEHOLDER' and f.get('found') == 'Button' and not f.get('gone')]
        print('  buttons:', [f.get('selector') for f in btn], flush=True)
        check(not any('gb1' in (f.get('selector') or '') for f in btn), 'a "Button" hidden by the stylesheet is not reported')
        check(any('vb1' in (f.get('selector') or '') for f in btn), 'a visible "Button" still is')
        check(any('"Button" label' in l for l in (S['scan'].get('log') or [])), 'the scan notes says why it was left out')
        check(not errors, 'no script errors ' + ' | '.join(errors[:3]))
        br.close()
except Exception:
    import traceback; traceback.print_exc(); ok = False
finally:
    srv.terminate()
    for pat in ['[f]ixsite.mjs', '[f]akeredis.mjs', '[d]ev-server.js']: subprocess.run(['pkill', '-f', pat])
print('ALL PASS' if ok else 'SOME FAILED')
