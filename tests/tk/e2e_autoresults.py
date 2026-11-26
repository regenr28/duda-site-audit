"""The Auto audits page lists what the automatic checks found, apart from the Audits tab.
Usage: python3 -I e2e_autoresults.py <app> <tests>"""
import json, os, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT = 3998, 8078
ADMIN_TOK = 'tokadmin1234567890abcdef'
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-autoresults.log'), 'w'), text=True)
assert srv.stdout.readline().strip() == 'READY'
def redis(*cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
def get(path):
    req = urllib.request.Request(f'http://localhost:{APORT}{path}', headers={'Cookie': 'dsa_sess=' + ADMIN_TOK})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
errors = []
now = int(time.time() * 1000)
iss_a = [{'k': 'phone:5551112222', 'type': 'phone', 'value': '(555) 111-2222', 'sev': 'critical', 'label': 'Phone number of another business', 'ctx': 'Call (555) 111-2222 today', 'pages': ['/', '/contact']},
         {'k': 'email:x@other.com', 'type': 'email', 'value': 'x@other.com', 'sev': 'warning', 'label': 'Email not in Business Info', 'ctx': 'x@other.com', 'pages': ['/about'], 'verify': True},
         {'k': 'stock:2253101234', 'type': 'stock', 'value': 'shutterstock_2253101234.jpg', 'sev': 'critical', 'label': 'Editorial stock photo', 'ctx': 'shutterstock_2253101234.jpg', 'pages': ['/gallery'], 'stockId': '2253101234', 'how': 'name'}]
try:
    redis(['DEL', 'dsa:cwsum'],
          ['HSET', 'dsa:cwsum', 'aaa111', json.dumps({'at': now, 'n': 3, 'c': 2}), 'bbb222', json.dumps({'at': now, 'n': 0, 'c': 0}), 'ccc333', json.dumps({'at': now, 'err': 'could not be reached', 'n': 0})],
          ['SET', 'dsa:cw:aaa111', json.dumps({'name': 'Harbor Dental', 'domain': 'harbordental.example', 'at': now, 'pages': 12, 'issues': iss_a})],
          ['SET', 'dsa:cw:bbb222', json.dumps({'name': 'Clean Co', 'domain': 'clean.example', 'at': now, 'pages': 8, 'issues': []})])
    d = get('/api/watch?op=results')
    check(d['read'] == 3 and [x['id'] for x in d['sites']] == ['aaa111'], 'the results list only websites with something found (3 read)')
    check(len(d['sites'][0]['issues']) == 3 and d['sites'][0]['issues'][2]['stockId'] == '2253101234' and d['canRule'] is True, 'each finding comes with its details and the stock ID')
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(viewport={'width': 1440, 'height': 1000})
        ctx.add_cookies([{'name': 'dsa_sess', 'value': ADMIN_TOK, 'domain': 'localhost', 'path': '/'}])
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(f'http://localhost:{APORT}/#/'); pg.wait_for_selector('a[href="#/auto"]', timeout=30000)
        check(pg.is_visible('a[href="#/auto"]'), 'the left menu has an Auto audits item')
        pg.click('a[href="#/auto"]'); pg.wait_for_selector('.ar-site', timeout=15000)
        txt = pg.inner_text('#view')
        check('Harbor Dental' in txt and '(555) 111-2222' in txt and 'x@other.com' in txt, 'Business Info tab lists the website and its findings')
        check('shutterstock_2253101234' not in txt, 'editorial photos are not mixed into the Business Info tab')
        check('1 critical' in txt and 'Clean Co' not in txt, 'counts critical, and leaves out websites with nothing found')
        pg.select_option('#arSev', 'critical'); time.sleep(0.4)
        check('x@other.com' not in pg.inner_text('#view'), 'the severity filter works')
        pg.select_option('#arSev', '')
        pg.screenshot(path=os.path.join(OUT, 'autoresults-biz.png'))
        pg.click('a[href="#/auto/editorial"]'); pg.wait_for_selector('.ar-thumb', timeout=15000)
        t2 = pg.inner_text('#view')
        check('shutterstock_2253101234.jpg' in t2 and '(555) 111-2222' not in t2 and pg.is_visible('a[href*="shutterstock.com/image-photo/2253101234"]'), 'Editorial photos tab shows the photo, its file and the Shutterstock link')
        pg.screenshot(path=os.path.join(OUT, 'autoresults-ed.png'))
        pg.click('a[href="#/auto/bizinfo"]'); pg.wait_for_selector('[data-arok]', timeout=15000)
        pg.click('[data-arok][data-key="email:x@other.com"]'); time.sleep(1.5)
        left = [x['k'] for x in json.loads(redis(['GET', 'dsa:cw:aaa111'])[0])['issues']]
        check('email:x@other.com' not in left and 'x@other.com' not in pg.inner_text('#view'), 'Not a problem takes the finding off')
        pg.click('a[href="#/auto/seo"]'); time.sleep(0.5)
        check(pg.is_visible('a[href="#/live/seo"]'), 'SEO websites tab links to the SEO websites')
        pg.set_viewport_size({'width': 390, 'height': 900}); pg.click('a[href="#/auto/bizinfo"]') if pg.is_visible('a[href="#/auto/bizinfo"]') else pg.goto(f'http://localhost:{APORT}/#/auto/bizinfo'); time.sleep(0.8)
        sw = pg.evaluate('document.documentElement.scrollWidth')
        check(sw <= 392, f'no sideways scroll on a phone ({sw}px)')
        br.close()
finally:
    srv.terminate()
check(not errors, 'no page errors ' + '; '.join(errors[:3]))
print('ALL PASS' if ok else 'SOME FAILED'); sys.exit(0 if ok else 1)
