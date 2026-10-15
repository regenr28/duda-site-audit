"""Customers (update 115): one profile with many websites, temporary passwords and the first sign-in,
View as customer, admin test profiles, the Customer line on a profile and the DR Websites filter.
Usage: python3 -I e2e_customers.py <app> <tests>"""
import json, os, subprocess, sys, time, urllib.request, zlib, base64
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT = 3998, 8078
ADMIN, MEMBER = 'tokadmin1234567890abcdef', 'tokmember1234567890abcde'
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-cu.log'), 'w'), text=True)
assert srv.stdout.readline().strip() == 'READY'
def redis(*cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
def pack(o):
    c = zlib.compressobj(9, zlib.DEFLATED, -15); return 'z1:' + base64.b64encode(c.compress(json.dumps(o).encode()) + c.flush()).decode()
def curl(path, tok, data=None, extra=()):
    a = ['curl', '-s', f'http://localhost:{APORT}{path}'] + (['-H', f'Cookie: dsa_sess={tok}'] if tok else []) + list(extra)
    if data is not None: a += ['-H', 'Content-Type: application/json', '-H', f'Origin: http://localhost:{APORT}', '-d', json.dumps(data)]
    return subprocess.run(a, capture_output=True, text=True).stdout
now = int(time.time() * 1000)
sites = [{'id': 'abc123', 'name': 'Buff & Beyond', 'domain': 'buffandbeyond.com', 'published': '2026-10-01T10:00:00Z', 'first': '2025-03-01T10:00:00Z', 'labels': []},
         {'id': 'new777', 'name': 'Boat Beautiful', 'domain': 'boatbeautiful.com', 'published': '2026-10-05T10:00:00Z', 'first': '2026-09-01T10:00:00Z', 'labels': []},
         {'id': 'free555', 'name': 'Shine Garage', 'domain': 'shinegarage.com', 'published': '2026-10-06T10:00:00Z', 'first': '2026-09-01T10:00:00Z', 'labels': []},
         {'id': 'lone999', 'name': 'Lone Star Tint', 'domain': 'lonestartint.com', 'published': '2026-10-06T10:00:00Z', 'first': '2026-09-01T10:00:00Z', 'labels': []}]
redis(['SET', 'dsa:dudasites', pack({'v': 2, 'at': now, 'count': 4, 'sites': sites, 'scope': 'published'})], ['SET', 'dsa:dudadrafts', pack({'v': 2, 'at': now, 'count': 0, 'sites': [], 'scope': 'unpublished'})],
      ['SET', 'dsa:thumb:abc123', json.dumps({'at': now, 'data': ''})], ['SET', 'dsa:thumb:new777', json.dumps({'at': now, 'data': ''})], ['SET', 'dsa:thumb:free555', json.dumps({'at': now, 'data': ''})])
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
errors = []
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx = br.new_context(viewport={'width': 1440, 'height': 1000})
        ctx.add_cookies([{'name': 'dsa_sess', 'value': ADMIN, 'domain': 'localhost', 'path': '/'}])
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: print('   console', m.text[:200]) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        pg.goto(f'http://localhost:{APORT}/#/customers'); pg.wait_for_selector('.cu-cards', timeout=20000); time.sleep(0.8)
        check('Customers' in pg.inner_text('#sideNav'), 'Customers is in the menu under Websites')
        t = pg.inner_text('#view')
        check('Bob Owner' in t and 'Buff & Beyond' in t and 'Other Client' in t, 'Customers lists every customer with their websites')
        pg.click('[data-cuf="admin"]'); time.sleep(0.3)
        check('Reymark' in pg.inner_text('.cu-cards') and 'Admin · test profile' in pg.inner_text('.cu-cards'), 'admins are listed as test profiles')
        pg.click('[data-cuf="all"]'); time.sleep(0.2)
        # ---- a new customer with two websites, one audited (s1) and one not (new777) ----
        pg.click('#cuNew'); pg.wait_for_selector('#ncName')
        pg.fill('#ncName', 'Carla Cruz'); pg.fill('#ncEmail', 'carla@cruzdetail.com'); pg.fill('#ncCo', 'Cruz Detail')
        pg.fill('#ncSites .cu-q', 'buff'); pg.wait_for_selector('#ncSites [data-cuadd]'); pg.click('#ncSites [data-cuadd]')
        pg.fill('#ncSites .cu-q', 'boat'); pg.wait_for_selector('#ncSites [data-cuadd]'); pg.click('#ncSites [data-cuadd]')
        check(pg.locator('#ncSites .cu-chosen .cu-chip').count() == 2, 'websites are found by search and added')
        pg.screenshot(path=os.path.join(OUT, 'cu-new.png'))
        pg.click('#ncSave'); pg.wait_for_selector('.cu-temp code', timeout=10000)
        temp = pg.inner_text('.cu-temp code').strip()
        msg = pg.input_value('.cu-msg')
        check(len(temp) >= 8 and temp in msg and 'carla@cruzdetail.com' in msg and 'choose your own password' in msg, 'a temporary password is shown once, with a message ready to send')
        pg.screenshot(path=os.path.join(OUT, 'cu-temp.png'))
        u = json.loads(redis(['GET', 'dsa:user:carla@cruzdetail.com'])[0])
        check(u['role'] == 'client' and u.get('mustChange') is True and sorted(u['sites']) == ['new777', 's1'], 'stored as a customer with both websites (audited by record, the other by its Duda id), password to be changed')
        pg.click('.modal [data-close]'); time.sleep(0.4)
        # the same email again is not a second customer
        pg.click('#cuNew'); pg.wait_for_selector('#ncName'); pg.fill('#ncName', 'Carla Cruz'); pg.fill('#ncEmail', 'carla@cruzdetail.com')
        pg.fill('#ncSites .cu-q', 'shine'); pg.wait_for_selector('#ncSites [data-cuadd]'); pg.click('#ncSites [data-cuadd]')
        pg.click('#ncSave'); pg.wait_for_selector('#ncAddTo', timeout=8000)
        check('already a customer' in pg.inner_text('#ncOut'), 'creating the same email again says they already exist')
        pg.click('#ncAddTo'); time.sleep(1)
        u = json.loads(redis(['GET', 'dsa:user:carla@cruzdetail.com'])[0])
        check(sorted(u['sites']) == ['free555', 'new777', 's1'] and u.get('mustChange') is True, '…and adds the website to their account instead (password untouched)')
        # ---- the website's profile shows its customer; DR Websites filters ----
        pg.goto(f'http://localhost:{APORT}/#/dr/new777'); pg.wait_for_selector('#pfOwner', timeout=15000); time.sleep(1)
        check('Carla Cruz' in pg.inner_text('#pfOwner') and 'not signed in yet' in pg.inner_text('#pfOwner'), 'a website that is not on Audits shows its customer too')
        pg.goto(f'http://localhost:{APORT}/#/live'); pg.wait_for_selector('#liveCust', timeout=15000); time.sleep(0.8)
        check('Carla Cruz' in pg.inner_text('.live-table'), 'DR Websites names each website\'s customer')
        pg.select_option('#liveCust', 'no'); time.sleep(0.4)
        rows = pg.inner_text('.live-table') if pg.locator('.live-table').count() else ''
        check('Buff' not in rows and 'Boat' not in rows and 'Shine' not in rows and 'Lone Star' in rows, 'filter: websites with no customer account')
        pg.select_option('#liveCust', 'yes'); time.sleep(0.4)
        rows = pg.inner_text('.live-table')
        check('Boat' in rows and 'Shine' in rows and 'Buff' in rows, 'filter: websites with a customer account')
        pg.screenshot(path=os.path.join(OUT, 'cu-live.png'))
        # ---- View as customer: all their websites ----
        pg.goto(f'http://localhost:{APORT}/#/customers'); pg.wait_for_selector('.cu-cards', timeout=15000); time.sleep(0.5)
        pg.click('.cu-card:has-text("Carla Cruz") [data-cuview]'); pg.wait_for_selector('.cp-hero', timeout=15000); time.sleep(0.6)
        bar = pg.inner_text('.cl-preview')
        check('Viewing as Carla Cruz' in bar and '3 websites' in bar, 'View as customer: ' + bar.replace('\n', ' ')[:120])
        opts = pg.locator('#cpSite option').all_inner_texts()
        check(len(opts) == 3 and any('Boat' in o for o in opts) and 'Cruz Detail' in pg.inner_text('.cp-brand'), 'their portal has a website picker with all three, branded with their company')
        pg.screenshot(path=os.path.join(OUT, 'cu-viewas.png'))
        pg.select_option('#cpSite', 'new777'); pg.wait_for_function("() => location.hash.startsWith('#/my/new777/')", timeout=8000); pg.wait_for_selector('.cp-hero', timeout=15000)
        check('Boat Beautiful' in pg.inner_text('.cp-hero'), 'switching website shows the other website')
        pg.click('#clExit'); pg.wait_for_function("() => location.hash === '#/customers'", timeout=8000)
        check(True, 'Back to the team view returns to Customers')
        # ---- View as client on a website with no customer: create one from the band ----
        pg.goto(f'http://localhost:{APORT}/#/dr/lone999'); pg.wait_for_selector('#pfView', timeout=15000); time.sleep(0.8)
        pg.click('#pfView'); pg.wait_for_selector('.cl-preview', timeout=15000); pg.wait_for_selector('#clMake', timeout=10000)
        check('No customer account yet' in pg.inner_text('.cl-preview'), 'previewing a website with no customer says so, with Create customer account')
        pg.click('#clMake'); pg.wait_for_selector('#ncName')
        check(pg.locator('#ncSites .cu-chosen .cu-chip').count() == 1, 'the new customer starts with this website already added')
        pg.click('.modal [data-close]'); time.sleep(0.3)
        pg.click('#clExit'); time.sleep(0.8)
        pg.goto(f'http://localhost:{APORT}/#/site/s2/profile'); pg.wait_for_selector('#pfView', timeout=15000); time.sleep(0.8)
        pg.click('#pfView'); pg.wait_for_selector('.cl-preview', timeout=15000); time.sleep(0.5)
        check('Viewing as Other Client' in pg.inner_text('.cl-preview'), 'View as client on a website with one customer opens that customer\'s portal')
        pg.click('#clExit'); time.sleep(0.6)
        # a website with two customers: View as client opens that customer's portal
        pg.goto(f'http://localhost:{APORT}/#/site/s1/profile'); pg.wait_for_selector('#pfView', timeout=15000); time.sleep(0.8)
        owners = pg.inner_text('#pfOwner')
        check('Bob Owner' in owners and 'Carla Cruz' in owners, 'a website shows every customer who has it')
        # ---- admin test profile ----
        pg.goto(f'http://localhost:{APORT}/#/customers'); pg.wait_for_selector('.cu-cards'); pg.click('[data-cuf="admin"]'); time.sleep(0.3)
        pg.click('.cu-card:has-text("Reymark") [data-cuopen]'); pg.wait_for_selector('#ocSites .cu-q')
        pg.fill('#ocSites .cu-q', 'shine'); pg.wait_for_selector('#ocSites [data-cuadd]'); pg.click('#ocSites [data-cuadd]')
        pg.fill('#ocSites .cu-q', 'buff'); pg.wait_for_selector('#ocSites [data-cuadd]'); pg.click('#ocSites [data-cuadd]')
        pg.click('#ocView'); pg.wait_for_selector('.cp-hero', timeout=15000); time.sleep(0.5)
        a = json.loads(redis(['GET', 'dsa:user:reymark@8bitcreative.com'])[0])
        check(sorted(a.get('testSites', [])) == ['free555', 's1'] and a['role'] == 'admin', 'an admin\'s test profile keeps its websites (and stays an admin)')
        check('test profile' in pg.inner_text('.cl-preview') and pg.locator('#cpSite option').count() == 2, 'View as customer on the test profile shows its two websites')
        pg.click('#clExit'); time.sleep(0.6)
        # ---- permissions ----
        r = curl('/api/users', MEMBER, {'op': 'clientSave', 'email': 'x@y.com', 'name': 'X', 'sites': ['s1']})
        check('does not include' in r, 'a member without "Give clients access" cannot create customers: ' + r[:80])
        r = curl('/api/users', MEMBER, {'op': 'clientTemp', 'email': 'carla@cruzdetail.com'})
        check('does not include' in r, '…or reset their password')
        r = curl('/api/users', ADMIN, {'op': 'testSites', 'email': 'owner@buffandbeyond.com', 'sites': ['s2']})
        check('admins only' in r, 'test profiles are for admins only')
        # ---- the customer's first sign-in ----
        cc = br.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        cp = cc.new_page(); cp.on('pageerror', lambda e: errors.append(str(e)))
        cp.goto(f'http://localhost:{APORT}/'); cp.wait_for_selector('#auEmail', timeout=15000)
        cp.fill('#auEmail', 'carla@cruzdetail.com'); cp.fill('#auPass', temp); cp.click('#auForm button[type=submit]')
        cp.wait_for_selector('#auPass2', timeout=10000)
        check('Choose your own password' in cp.inner_text('body'), 'the first sign-in asks them to choose their own password')
        cp.fill('#auPass', 'carla-new-pass-1'); cp.fill('#auPass2', 'carla-new-pass-1'); cp.click('#auForm button[type=submit]')
        cp.wait_for_selector('.cp-hero', timeout=15000); time.sleep(0.6)
        check(cp.locator('#cpSite option').count() == 3, 'then their portal opens with all three websites')
        u = json.loads(redis(['GET', 'dsa:user:carla@cruzdetail.com'])[0])
        check('mustChange' not in u, 'and the temporary password is gone')
        cp.screenshot(path=os.path.join(OUT, 'cu-first-signin-phone.png'))
        # a new temporary password replaces the old one
        r = json.loads(curl('/api/users', ADMIN, {'op': 'clientTemp', 'email': 'carla@cruzdetail.com'}))
        t2 = r.get('tempPassword', '')
        bad = curl('/api/auth', None, {'op': 'login', 'email': 'carla@cruzdetail.com', 'password': 'carla-new-pass-1'})
        good = curl('/api/auth', None, {'op': 'login', 'email': 'carla@cruzdetail.com', 'password': t2})
        check(t2 and 'error' in bad and 'mustChange' in good, 'New temporary password: the old one stops working, the new one asks for a change again')
        # the Customers page on a phone
        mc = br.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        mc.add_cookies([{'name': 'dsa_sess', 'value': ADMIN, 'domain': 'localhost', 'path': '/'}])
        mp = mc.new_page(); mp.on('pageerror', lambda e: errors.append(str(e)))
        mp.goto(f'http://localhost:{APORT}/#/customers'); mp.wait_for_selector('.cu-cards', timeout=15000); time.sleep(0.8)
        sw = mp.evaluate("() => document.documentElement.scrollWidth")
        check(sw <= 391, f'phone: Customers fits the screen ({sw}px)')
        mp.screenshot(path=os.path.join(OUT, 'cu-phone.png'), full_page=True)
        pg.goto(f'http://localhost:{APORT}/#/customers'); pg.wait_for_selector('.cu-cards'); time.sleep(0.5)
        pg.screenshot(path=os.path.join(OUT, 'cu-list.png'), full_page=True)
        check(not errors, 'no script errors ' + ' | '.join(errors[:3]))
except Exception as e:
    import traceback; traceback.print_exc(); ok = False
finally:
    srv.terminate()
print('ALL PASS' if ok else 'SOME FAILED')
sys.exit(0 if ok else 1)
