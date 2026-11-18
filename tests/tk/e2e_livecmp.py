"""Each audit item says whether the problem is in the editor (preview), on the live website, or both: after a scan
of a published website, the same pages are read on the live website. Usage: python3 -I e2e_livecmp.py <app> <tests>"""
import json, os, subprocess, sys, time, urllib.request, urllib.parse
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT = 3998, 8078
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-livecmp.log'), 'w'), text=True)
assert srv.stdout.readline().strip() == 'READY'
def redis(*cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
errors = []
PAGE = lambda extra: f'''<html><head><title>Home | Buff & Beyond</title><meta name="description" content="Detailing in town."></head><body><div id="dmcontent"><h1>Buff & Beyond</h1>
<p id="p1">Call us at <a href="tel:2145550100">(214) 555-0100</a>.</p><p id="p2">Our second shop: (469) 555-0199.</p>{extra}</div></body></html>'''
PREVIEW = PAGE('<p id="p3">Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>')   # the editor still has placeholder text
LIVE = PAGE('<p id="p3">We make cars shine.</p>')                                              # the live website is already fixed
META = {'host': 'ed.multiscreensite.com', 'siteId': 'abc123', 'site': {'site_business_info': {'business_name': 'Buff & Beyond', 'phones': [{'phoneNumber': '(214) 555-0100'}]}}, 'content': {'location_data': {'phones': [{'phoneNumber': '(214) 555-0100'}]}}, 'pages': [{'path': '/', 'title': 'Home'}], 'errors': []}
def site_route(r):
    u = r.request.url
    if 'light=1' in u: return r.fulfill(status=200, content_type='application/json', body=json.dumps({'siteId': 'abc123', 'domain': 'www.buffandbeyond.com', 'publishStatus': 'PUBLISHED', 'publishedAt': '2026-11-18T10:00:00Z'}))
    return r.fulfill(status=200, content_type='application/json', body=json.dumps(META))
def fetch_route(r):
    q = urllib.parse.parse_qs(urllib.parse.urlparse(r.request.url).query)
    html = LIVE if q.get('live') else PREVIEW
    return r.fulfill(status=200, content_type='application/json', body=json.dumps({'status': 200, 'html': html, 'url': 'https://x/site/abc123/'}))
try:
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(viewport={'width': 1440, 'height': 1000}); ctx.add_cookies([{'name': 'dsa_sess', 'value': 'tokadmin1234567890abcdef', 'domain': 'localhost', 'path': '/'}])
        ctx.route('**/api/site?*', site_route); ctx.route('**/api/fetch?*', fetch_route)
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('dialog', lambda d: d.accept())
        pg.goto(f'http://localhost:{APORT}/#/site/s1'); pg.wait_for_selector('#sRescan', timeout=20000); time.sleep(1)
        pg.click('#sRescan')
        S = {}
        for _ in range(120):
            time.sleep(1)
            S = pg.evaluate("async () => (await (await fetch('/api/store?op=site&id=s1')).json())")
            if (S.get('scan') or {}).get('state') == 'complete' and S.get('live'): break
        lv = S.get('live') or {}
        F = {f['id']: f for f in S.get('findings') or []}
        ph = next((f for f in F.values() if f.get('code') == 'PHONE_MISMATCH'), None)
        lo = next((f for f in F.values() if 'Lorem' in (f.get('found') or '')), None)
        for k, v in (lv.get('res') or {}).items():
            if k in F: print('  ', v, F[k]['code'], F[k].get('num'), (F[k].get('found') or '')[:50], F[k].get('selector'), flush=True)
        check(lv.get('domain') == 'www.buffandbeyond.com', 'after the scan, the same pages were read on the live website')
        check(ph and lv['res'].get(ph['id']) == 't', 'a phone number on the editor AND the live website is marked "there too"')
        check(lo and lv['res'].get(lo['id']) == 'o', 'placeholder text only in the editor (fixed on live) is marked "fine on live"')
        print('  placeholder item:', lo and lo.get('num'), lo and lo.get('code'), flush=True)
        pg.goto(f'http://localhost:{APORT}/#/site/s1/item/{lo["num"]}'); pg.reload(); pg.wait_for_selector('#drawer .pvl-row', timeout=15000); time.sleep(0.5)
        d = pg.inner_text('#drawer')
        print('  drawer:', pg.inner_text('#drawer .pvl-row'), '|', pg.inner_text('#drawer .pvl-say') if pg.locator('#drawer .pvl-say').count() else '', flush=True)
        check('✗ Preview' in d and '✓ Live' in d and 'Only in the editor' in d, 'the item says: in the editor, fine on the live website')
        pg.screenshot(path=os.path.join(OUT, 'livecmp-drawer.png'))
        pg.goto(f'http://localhost:{APORT}/#/site/s1'); pg.wait_for_selector('table.findings', timeout=15000); time.sleep(0.8)
        row = pg.inner_text(f'table.findings tr:has-text("Phone")').strip() if pg.locator('table.findings tr:has-text("Phone")').count() else pg.inner_text('table.findings tbody tr >> nth=0')
        check('✗ Preview' in row and '✗ Live' in row, 'the list shows both pills too (a problem in both places)')
        # An audit never compared with the live website: both pills still show, and the Live one can be checked by a click.
        pg.evaluate("async () => { const s = await (await fetch('/api/store?op=site&id=s1')).json(); return s; }")
        redis_key = 'dsa:site:s1'
        raw = redis(['GET', redis_key])[0]
        if raw and raw.startswith('{'):
            d = json.loads(raw); d.pop('live', None); redis(['SET', redis_key, json.dumps(d)])
        else:
            pg.evaluate("async () => fetch('/api/store', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({op:'saveLive', id:'s1', live:{domain:'www.buffandbeyond.com', res:{}}})})")
        pg.goto(f'http://localhost:{APORT}/#/site/s1/item/{lo["num"]}'); pg.reload(); pg.wait_for_selector('#drawer .pvl-row', timeout=15000); time.sleep(0.5)
        d = pg.inner_text('#drawer .pvl-row')
        print('  before check:', d, flush=True)
        check('Preview' in d and 'Live' in d and '? Live' in d, 'with no comparison yet, both pills show (Live: "? Live · check")')
        pg.click('#drawer [data-livecmp]')
        for _ in range(40):
            time.sleep(0.5)
            if '✓ Live' in pg.inner_text('#drawer .pvl-row'): break
        print('  after check:', pg.inner_text('#drawer .pvl-row'), flush=True)
        check('✓ Live' in pg.inner_text('#drawer .pvl-row'), 'clicking it reads that page on the live website and shows ✓ Live')
        check(not errors, 'no script errors ' + ' | '.join(errors[:3]))
        br.close()
except Exception:
    import traceback; traceback.print_exc(); ok = False
finally:
    srv.terminate()
    for pat in ['[f]ixsite.mjs', '[f]akeredis.mjs', '[d]ev-server.js']: subprocess.run(['pkill', '-f', pat])
print('ALL PASS' if ok else 'SOME FAILED')
