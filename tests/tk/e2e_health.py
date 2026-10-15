"""Site health (Lighthouse), form submissions on the profile, View as client from any profile.
Usage: python3 -I e2e_health.py <app> <tests>"""
import json, os, subprocess, sys, time, urllib.request, zlib, base64
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT, FPORT = 3998, 8078, 8095
fk = subprocess.Popen(['node', os.path.join(OUT, 'fakeanalytics.mjs'), str(FPORT)], stdout=subprocess.DEVNULL)
env = dict(os.environ, PAGESPEED_API_KEY='testkey', PAGESPEED_BASE=f'http://127.0.0.1:{FPORT}/psi', DUDA_API_BASE=f'http://127.0.0.1:{FPORT}/api', DUDA_API_USERNAME='u', DUDA_API_PASSWORD='p')
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-h.log'), 'w'), text=True, env=env)
assert srv.stdout.readline().strip() == 'READY'
def redis(*cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
def calls(): return json.loads(urllib.request.urlopen(f'http://127.0.0.1:{FPORT}/__calls').read())
def pack(o):
    c = zlib.compressobj(9, zlib.DEFLATED, -15); return 'z1:' + base64.b64encode(c.compress(json.dumps(o).encode()) + c.flush()).decode()
now = int(time.time() * 1000)
sites = [{'id': 'abc123', 'name': 'Buff & Beyond', 'domain': 'buffandbeyond.com', 'published': '2026-10-01T10:00:00Z', 'first': '2025-03-01T10:00:00Z', 'labels': []},
         {'id': 'new777', 'name': 'Boat Beautiful', 'domain': 'broken.example', 'published': '2026-10-05T10:00:00Z', 'first': '2026-09-01T10:00:00Z', 'labels': []}]
redis(['SET', 'dsa:dudasites', pack({'v': 2, 'at': now, 'count': 2, 'sites': sites, 'scope': 'published'})], ['SET', 'dsa:dudadrafts', pack({'v': 2, 'at': now, 'count': 0, 'sites': [], 'scope': 'unpublished'})],
      ['SET', 'dsa:thumb:abc123', json.dumps({'at': now, 'data': ''})], ['SET', 'dsa:thumb:new777', json.dumps({'at': now, 'data': ''})])
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
errors = []
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx = br.new_context(viewport={'width': 1440, 'height': 1000})
        ctx.add_cookies([{'name': 'dsa_sess', 'value': 'tokadmin1234567890abcdef', 'domain': 'localhost', 'path': '/'}])
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(f'http://localhost:{APORT}/#/site/s1/profile'); pg.wait_for_selector('#pfMain .pf-top', timeout=20000)
        tabs = pg.inner_text('.tabs')
        check('Form submissions' not in tabs and 'Profile' in tabs, 'the audit page has no Form submissions tab any more: ' + tabs.replace('\n', ' | '))
        check(pg.locator('#pfLeads').count() == 1 and pg.locator('#pfLeadsBody').count() == 1, 'form submissions are on the profile (their own tab)')
        pg.wait_for_selector('.pf-cards .h-chip', timeout=30000); time.sleep(0.3)
        check('Site health' in pg.inner_text('.pf-cards') and pg.locator('.h-chip').count() == 4, 'a Site health card sits with the other cards')
        check(pg.locator('.pf-tab[data-pftab="health"] .pf-tab-n').count() == 1, 'the Site health tab shows the mobile performance score')
        pg.click('.pf-tab[data-pftab="health"]')
        pg.wait_for_selector('.h-gauges', timeout=30000); time.sleep(0.5)
        g = pg.inner_text('.h-gauges')
        check('42' in g and 'Poor' in g and '88' in g and 'Performance' in g and 'SEO' in g, 'first visit checks it automatically: mobile scores with words (42 Poor, 88…)')
        ht = pg.inner_text('#pfMain')
        check('Eliminate render-blocking resources' in ht and 'saves about 1.2s' in ht, 'biggest time savings listed')
        check('sufficient contrast' in ht and 'meta description' in ht and 'Image elements have' not in ht, 'failed checks listed, passed ones not')
        check('6.2 s' in ht and 'Real visitors' in ht, 'page speed numbers and real-visitor data')
        pg.click('[data-htab="desktop"]'); time.sleep(0.3)
        check('81' in pg.inner_text('.h-gauges'), 'Desktop tab shows the desktop scores')
        pg.screenshot(path=os.path.join(OUT, 'health.png'), full_page=True)
        n1 = calls().get('psi', 0)
        pg.reload(); pg.wait_for_selector('.h-gauges', timeout=20000); time.sleep(1)
        check(calls().get('psi', 0) == n1, 'opening it again does not check again (weekly, or Check now)')
        pg.click('#hRun'); pg.wait_for_function("() => document.querySelector('#hRun') && !document.querySelector('#hRun').disabled", timeout=30000); time.sleep(0.4)
        check(calls().get('psi', 0) == n1 + 2 and len(json.loads(redis(['GET', 'dsa:psi:abc123'])[0])['runs']) == 2, 'Check now runs mobile + desktop again and keeps the history')
        # leads link from old address
        pg.goto(f'http://localhost:{APORT}/#/site/s1/leads'); pg.wait_for_selector('#pfLeads', timeout=15000); time.sleep(0.6)
        check(pg.locator('.tabs a.on').inner_text().startswith('Profile'), 'old Form submissions links open the profile, at the list')
        # unaudited profile: broken website, and View as client
        pg.goto(f'http://localhost:{APORT}/#/dr/new777/health'); pg.wait_for_selector('.pf-nav', timeout=20000)
        pg.wait_for_function("() => /could not open|Not checked|Checking/.test(document.querySelector('#drProf').textContent)", timeout=30000); time.sleep(1.5)
        check('could not open the website' in pg.inner_text('#drProf'), 'a website Google can\'t open says so plainly')
        pg.click('.pf-tab[data-pftab="overview"]'); pg.wait_for_selector('.pf-top', timeout=10000)
        check(pg.locator('#pfView').count() == 1, 'View as client is on a profile that is not audited yet')
        dialogs = []; pg.on('dialog', lambda d: (dialogs.append(d.message), d.dismiss()))
        pg.click('#pfView'); pg.wait_for_function("() => location.hash.startsWith('#/my/')", timeout=20000); time.sleep(2)
        body = pg.inner_text('body')
        check(not dialogs and pg.url.endswith('#/my/new777/overview') and 'new777' not in json.dumps(redis(['HGETALL', 'dsa:index'])[0]), 'View as client opens straight away, without adding the website to Audits: ' + pg.url)
        check('Boat Beautiful' in body and 'Viewing as the client' in body and 'Not found' not in body, 'the client page shows the website from the Duda list')
        pg.goto(f'http://localhost:{APORT}/#/my/new777/comments'); time.sleep(1.5)
        check('No comments yet' in pg.inner_text('#clMain') or 'conversation' in pg.inner_text('#clMain'), 'its Comments page works too')
        r = subprocess.run(['curl', '-s', f'http://localhost:{APORT}/api/client?op=me', '-H', 'Cookie: dsa_sess=tokmember1234567890abcde', '-H', 'x-view-as-client: 1', '-H', 'x-view-site: new777'], capture_output=True, text=True).stdout
        check('View as client' in r, 'the server refuses a member without "Profile: View as client"')
        # the audit page header has View as client too
        pg2 = ctx.new_page(); pg2.goto(f'http://localhost:{APORT}/#/site/s1'); pg2.wait_for_selector('#sOpen', timeout=15000); pg2.click('#sOpen'); pg2.wait_for_selector('#sViewAs', timeout=15000)
        check(True, 'the audit page header has 👁 View as client')
        # a member, by default, does not
        mctx = br.new_context(viewport={'width': 1280, 'height': 900}); mctx.add_cookies([{'name': 'dsa_sess', 'value': 'tokmember1234567890abcde', 'domain': 'localhost', 'path': '/'}])
        redis(['HSET', 'dsa:index', 's1', json.dumps({'id': 's1', 'siteId': 'abc123', 'businessName': 'Buff & Beyond', 'assignee': 'dev@8bitcreative.com'})], ['SET', 'dsa:site:s1', json.dumps({'id': 's1', 'siteId': 'abc123', 'host': 'ed.multiscreensite.com', 'businessName': 'Buff & Beyond', 'assignee': 'dev@8bitcreative.com', 'findings': []})])
        mp = mctx.new_page(); mp.on('pageerror', lambda e: errors.append(str(e)))
        mp.goto(f'http://localhost:{APORT}/#/site/s1/profile'); mp.wait_for_selector('#pfMain .pf-top', timeout=20000); time.sleep(1)
        mp.click('#sOpen'); time.sleep(0.3)
        check(mp.locator('#pfView').count() == 0 and mp.locator('#sViewAs').count() == 0, 'a member does not get View as client unless their role or access includes it')
        check(not errors, 'no script errors ' + ' | '.join(errors[:3]))
        br.close()
except Exception:
    import traceback; traceback.print_exc(); ok = False
finally:
    srv.terminate(); fk.terminate()
    for pat in ['[f]ixsite.mjs', '[f]akeredis.mjs', '[d]ev-server.js', '[f]akeanalytics.mjs']: subprocess.run(['pkill', '-f', pat])
print('ALL PASS' if ok else 'SOME FAILED')
