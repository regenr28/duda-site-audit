"""Stage 3: analytics on the profile (Duda always; Google Analytics / Search Console when connected).
Usage: python3 -I e2e_analytics.py <app> <tests>"""
import json, os, subprocess, sys, time, urllib.request, zlib, base64
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT, FPORT = 3998, 8078, 8095
TOK = 'tokadmin1234567890abcdef'; MTOK = 'tokmember1234567890abcde'
key = subprocess.run(['node', '-e', "const c=require('crypto');const {privateKey}=c.generateKeyPairSync('rsa',{modulusLength:2048});process.stdout.write(privateKey.export({type:'pkcs8',format:'pem'}))"], capture_output=True, text=True).stdout
sa = json.dumps({'client_email': 'site-auditor@proj.iam.gserviceaccount.com', 'private_key': key})
fk = subprocess.Popen(['node', os.path.join(OUT, 'fakeanalytics.mjs'), str(FPORT)], stdout=subprocess.DEVNULL)
env = dict(os.environ, DUDA_API_BASE=f'http://127.0.0.1:{FPORT}/api', DUDA_API_USERNAME='u', DUDA_API_PASSWORD='p', GOOGLE_SERVICE_ACCOUNT=base64.b64encode(sa.encode()).decode(),
           GOOGLE_TOKEN_URL=f'http://127.0.0.1:{FPORT}/token', GA_DATA_BASE=f'http://127.0.0.1:{FPORT}/ga', GSC_BASE=f'http://127.0.0.1:{FPORT}/gsc')
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-an.log'), 'w'), text=True, env=env)
assert srv.stdout.readline().strip() == 'READY'
def redis(*cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
def calls(): return json.loads(urllib.request.urlopen(f'http://127.0.0.1:{FPORT}/__calls').read())
def pack(o):
    c = zlib.compressobj(9, zlib.DEFLATED, -15); return 'z1:' + base64.b64encode(c.compress(json.dumps(o).encode()) + c.flush()).decode()
now = int(time.time() * 1000)
redis(['SET', 'dsa:dudasites', pack({'v': 2, 'at': now, 'count': 1, 'sites': [{'id': 'abc123', 'name': 'Buff & Beyond', 'domain': 'buffandbeyond.com', 'published': '2026-10-01T10:00:00Z', 'first': '2025-03-01T10:00:00Z', 'labels': []}, {'id': 'new777', 'name': 'Boat Beautiful', 'domain': 'boatbeautiful.com', 'published': '2026-10-05T10:00:00Z', 'first': '2026-09-01T10:00:00Z', 'labels': []}], 'scope': 'published'})], ['SET', 'dsa:thumb:new777', json.dumps({'at': now, 'data': ''})],
      ['SET', 'dsa:dudadrafts', pack({'v': 2, 'at': now, 'count': 0, 'sites': [], 'scope': 'unpublished'})], ['SET', 'dsa:thumb:abc123', json.dumps({'at': now, 'data': ''})])
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
errors = []
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx = br.new_context(viewport={'width': 1440, 'height': 1000}, timezone_id='UTC')
        ctx.add_cookies([{'name': 'dsa_sess', 'value': TOK, 'domain': 'localhost', 'path': '/'}])
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(f'http://localhost:{APORT}/#/site/s1/profile/analytics'); pg.wait_for_selector('#pfAn .an-tiles', timeout=30000); time.sleep(0.8)
        txt = pg.inner_text('#pfAn')
        tiles = {pg.locator('#pfAn .an-tile').nth(k).locator('.an-l').inner_text(): pg.locator('#pfAn .an-tile').nth(k).locator('.an-v').inner_text() for k in range(pg.locator('#pfAn .an-tile').count())}
        print('   duda tiles:', tiles)
        check('Visits' in tiles and int(tiles['Visits'].replace(',', '')) > 0 and tiles.get('Form submits') == '9' and tiles.get('Click to call') == '12', 'Duda analytics shown automatically: visits, visitors, page views, form submissions, clicks')
        check('vs previous period' in txt, 'change against the previous period shown')
        check(pg.locator('#anDaily svg .viz-line').count() == 2 and pg.locator('#anMonths svg .viz-bar').count() >= 10, 'daily visits lines and 12-month bars drawn')
        check('Windows' in txt and 'Chrome' in txt and 'US' in txt and '900' in txt, 'operating systems, browsers and countries read from Duda\'s documented layout (regions of one country added up)')
        pg.click('.pf-tab[data-pftab="overview"]'); pg.wait_for_selector('.pf-cards', timeout=10000)
        vc = pg.locator('.pf-card', has_text='Visits').inner_text()
        check(tiles['Visits'] in vc and 'unique visitors' in vc, 'the Overview has a Visits card from the same figures: ' + vc.replace('\n', ' | '))
        pg.click('.pf-card a[data-pftab="analytics"]'); pg.wait_for_selector('#anDaily svg .viz-line', timeout=10000)
        check(pg.locator('#anDaily svg .viz-line').count() == 2, 'opening the Analytics tab draws its charts')
        c1 = calls()['duda']
        pg.reload(); pg.wait_for_selector('#pfAn .an-tiles', timeout=30000); time.sleep(0.5)
        check(calls()['duda'] == c1, f'opening it again asks Duda nothing (kept for 6 hours; {c1} calls the first time)')
        pg.click('[data-andays="365"]'); pg.wait_for_selector('#anDaily svg', timeout=20000); time.sleep(0.5)
        check('Visits per week' in pg.inner_text('#pfAn'), '12 months switches the line to weeks')
        pg.click('[data-andays="30"]'); time.sleep(0.5)
        pg.screenshot(path=os.path.join(OUT, 'an-duda.png'), full_page=True)
        # add Google Analytics: wrong property first (no access), then the right one
        pg.click('[data-antab="add"]'); time.sleep(0.3)
        check('site-auditor@proj.iam.gserviceaccount.com' in pg.inner_text('#pfAn'), 'admins are shown which Google account to give Viewer access to')
        pg.fill('[data-anconn="ga4"] input', '999999'); pg.click('[data-anconn="ga4"] button'); time.sleep(1.2)
        toast = pg.inner_text('body')
        check('as a Viewer' in toast and redis(['HGET', 'dsa:anprov', 'abc123'])[0] is None, 'a property the app cannot read is refused with what to do, and nothing is saved')
        pg.fill('[data-anconn="ga4"] input', 'properties/312345678'); pg.click('[data-anconn="ga4"] button')
        pg.wait_for_selector('#anGa svg .viz-line', timeout=20000); time.sleep(0.4)
        cfg = json.loads(redis(['HGET', 'dsa:anprov', 'abc123'])[0])
        check(cfg['ga4']['property'] == '312345678', 'GA4 connected and saved with its clean ID')
        gtxt = pg.inner_text('#pfAn')
        check('Sessions' in gtxt and '420' in gtxt and 'Organic Search' in gtxt and '/services' in gtxt and '61%' in gtxt, 'Google Analytics tab: sessions, users, engagement, top pages, channels')
        pg.screenshot(path=os.path.join(OUT, 'an-ga.png'), full_page=True)
        pg.click('[data-antab="add"]'); time.sleep(0.3)
        pg.fill('[data-anconn="gsc"] input', 'sc-domain:buffandbeyond.com'); pg.click('[data-anconn="gsc"] button')
        pg.wait_for_selector('#anSc svg .viz-line', timeout=20000); time.sleep(0.4)
        stxt = pg.inner_text('#pfAn')
        check('ceramic coating near me' in stxt and 'Search clicks' in stxt and 'three days behind' in stxt, 'Search Console tab: clicks, impressions and top queries')
        check(pg.locator('.an-tabs button').count() == 4, 'tabs: Duda, Google Analytics, Search Console, Add custom analytics')
        pg.screenshot(path=os.path.join(OUT, 'an-gsc.png'), full_page=True)
        # a website whose day-by-day answer can't be read: say so, show admins what came back
        redis(['SET', 'dsa:dudasites', pack({'v': 2, 'at': now, 'count': 3, 'sites': [{'id': 'abc123', 'name': 'Buff & Beyond', 'domain': 'buffandbeyond.com', 'published': '2026-10-01T10:00:00Z', 'first': '2025-03-01T10:00:00Z', 'labels': []}, {'id': 'new777', 'name': 'Boat Beautiful', 'domain': 'boatbeautiful.com', 'published': '2026-10-05T10:00:00Z', 'first': '2026-09-01T10:00:00Z', 'labels': []}, {'id': 'oddshape', 'name': 'Odd Co', 'domain': 'odd.com', 'published': '2026-10-05T10:00:00Z', 'first': '2026-09-01T10:00:00Z', 'labels': []}], 'scope': 'published'})], ['SET', 'dsa:thumb:oddshape', json.dumps({'at': now, 'data': ''})])
        pg.goto(f'http://localhost:{APORT}/#/dr/oddshape/analytics'); pg.wait_for_selector('#pfAn .an-tiles', timeout=30000); time.sleep(0.8)
        otxt = pg.inner_text('#pfAn')
        check('no day-by-day breakdown' in otxt and pg.locator('#anDaily').count() == 0, 'unreadable daily figures: a plain message instead of a flat line at zero')
        check(pg.locator('.an-diag').count() >= 1 and 'unexpected' in (pg.locator('.an-diag').first.text_content() or ''), 'admins can open what Duda actually sent')
        check('[analytics] Duda answer not fully read for oddshape' in open(os.path.join(OUT, 'srv-an.log')).read(), 'and it is written to the server log')
        # a member sees analytics but cannot connect
        mctx = br.new_context(viewport={'width': 390, 'height': 850}, timezone_id='UTC')
        mctx.add_cookies([{'name': 'dsa_sess', 'value': MTOK, 'domain': 'localhost', 'path': '/'}])
        mp = mctx.new_page(); mp.on('pageerror', lambda e: errors.append(str(e)))
        redis(['HSET', 'dsa:index', 's1', json.dumps({'id': 's1', 'siteId': 'abc123', 'businessName': 'Buff & Beyond', 'assignee': 'dev@8bitcreative.com'})], ['SET', 'dsa:site:s1', json.dumps({'id': 's1', 'siteId': 'abc123', 'host': 'ed.multiscreensite.com', 'businessName': 'Buff & Beyond', 'assignee': 'dev@8bitcreative.com', 'findings': []})])
        mp.goto(f'http://localhost:{APORT}/#/site/s1/profile/analytics'); mp.wait_for_selector('#pfAn .an-tiles', timeout=30000); time.sleep(1.0)
        check(mp.locator('[data-antab="add"]').count() == 0 and mp.locator('[data-antab="ga4"]').count() == 1 and mp.locator('#pfAn .an-tile').count() >= 3, 'a member sees the analytics tabs but not "Add custom analytics"')
        wide = mp.evaluate("() => [...document.querySelectorAll('#pfAn *')].filter(e => !e.closest('.an-tabs') && e.getBoundingClientRect().right > 392).map(e => e.tagName + '.' + e.className).slice(0, 6)")
        check(not wide, f'phone width: analytics fits {wide}')
        mp.screenshot(path=os.path.join(OUT, 'an-phone.png'), full_page=True)
        st = subprocess.run(['curl', '-s', '-X', 'POST', f'http://localhost:{APORT}/api/analytics', '-H', 'Content-Type: application/json', '-H', f'Cookie: dsa_sess={MTOK}', '-d', json.dumps({'op': 'disconnect', 'site': 'abc123', 'provider': 'ga4'})], capture_output=True, text=True).stdout
        check('does not include' in st, 'the server refuses a member who tries to change analytics')
        cl = subprocess.run(['curl', '-s', f'http://localhost:{APORT}/api/analytics?site=abc123', '-H', 'Cookie: dsa_sess=tokclient1234567890abcde'], capture_output=True, text=True).stdout
        check('Not available' in cl or 'Not found' in cl, 'clients cannot read analytics')
        check(not errors, 'no script errors ' + ' | '.join(errors[:3]))
        br.close()
except Exception:
    import traceback; traceback.print_exc(); ok = False
finally:
    srv.terminate(); fk.terminate()
    for pat in ['[f]ixsite.mjs', '[f]akeredis.mjs', '[d]ev-server.js', '[f]akeanalytics.mjs']: subprocess.run(['pkill', '-f', pat])
print('ALL PASS' if ok else 'SOME FAILED')
