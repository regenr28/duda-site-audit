"""The "client comments waiting" notice reads as a list: a summary, then each comment on its own line, quoted
and shortened, with hours over two days in days. Usage: python3 -I e2e_notifpop.py <app> <tests>"""
import json, os, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT = 3998, 8078
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-np.log'), 'w'), text=True)
assert srv.stdout.readline().strip() == 'READY'
def redis(*cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
ADMIN = 'tokadmin1234567890abcdef'
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
errors = []
LINES = ['1. *#2* · 855h · desktop — Info@thedetailist.net', '2. *#3* · 855h · desktop — I would prefer the service descriptions to be horizontal.',
         '3. *#4* · 855h · desktop — Revision: Because DETAILIST® specializes in paint correction, paint protection film, ceramic coatings, professional deta',
         '4. *#5* · 855h · desktop — Revision: PRECISION WORK TRUSTED BY OUR CLIENTS', '5. *#6* · 72h · desktop — DETAILIST® ADVANCED VEHICLE & SURFACE PROTECTION IN FERNDALE, WA', '…and 2 more']
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx = br.new_context(viewport={'width': 1440, 'height': 1000}); ctx.add_cookies([{'name': 'dsa_sess', 'value': ADMIN, 'domain': 'localhost', 'path': '/'}])
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(f'http://localhost:{APORT}/#/'); pg.wait_for_selector('table.grid', timeout=20000); time.sleep(2)
        me = pg.evaluate("async () => (await (await fetch('/api/auth?op=me')).json())")
        email = ((me or {}).get('user') or me or {}).get('email') or 'reymark@8bitcreative.com'
        n = {'id': 'npw1', 'at': '2026-11-17T00:37:00Z', 'kind': 'comment-waiting', 'by': '', 'byName': 'DETAILIST®', 'siteId': '', 'siteName': '',
             'count': 7, 'oldestHours': 855, 'lines': LINES, 'text': '\n'.join(LINES), 'dudaSite': 'abc123'}
        redis(['LPUSH', 'dsa:notif:' + email, json.dumps(n)])
        pg.goto(f'http://localhost:{APORT}/#/site/s1'); pg.wait_for_selector('.pop .wl', timeout=20000); time.sleep(0.5)
        pop = pg.locator('.pop:has(.wl)').first
        txt = pop.inner_text(); print('  pop:', txt.replace(chr(10), ' | '), flush=True)
        check('7 client comments waiting · oldest 36 days' in txt, 'a summary line: how many, and the oldest in days (not 855h)')
        check(pop.locator('.wl li').count() == 3 and '#2' in txt and 'waiting 36 days · Desktop' in txt, 'each comment on its own line with its number, how long and the device')
        check('“Info@thedetailist.net”' in txt and '*' not in txt and '—' not in txt, 'the comment is quoted, with no Slack stars or dashes')
        check('…and 4 more' in txt and 'Open the comments' in txt, 'the rest are counted, with a link to open them')
        pop.screenshot(path=os.path.join(OUT, 'notif-pop.png'))
        pg.click('#btnBell'); pg.wait_for_selector('.np-item .wl', timeout=10000); time.sleep(0.3)
        bell = pg.inner_text('.np-item:has(.wl)')
        check('oldest 36 days' in bell and '“Info@thedetailist.net”' in bell, 'the bell shows the same readable list')
        check(not errors, 'no script errors ' + ' | '.join(errors[:3]))
        br.close()
except Exception:
    import traceback; traceback.print_exc(); ok = False
finally:
    srv.terminate()
    for pat in ['[f]ixsite.mjs', '[f]akeredis.mjs', '[d]ev-server.js']: subprocess.run(['pkill', '-f', pat])
print('ALL PASS' if ok else 'SOME FAILED')
