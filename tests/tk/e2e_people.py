"""People picker (photos, grouped by role, search) and profile photos.
Usage: python3 -I e2e_people.py <app> <tests>"""
import json, os, subprocess, sys, urllib.request, hashlib, zlib, base64
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT = 3998, 8078
ADMIN = 'tokadmin1234567890abcdef'
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-people.log'), 'w'), text=True)
assert srv.stdout.readline().strip() == 'READY'
fails = []
def check(ok, what, extra=''):
    print(('PASS ' if ok else 'FAIL ') + what, extra if not ok else '')
    if not ok: fails.append(what)
def redis(*cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
def unpack(raw): return json.loads(zlib.decompress(base64.b64decode(raw[3:]), -15)) if raw.startswith('z1:') else json.loads(raw)
for email, name, role in [('jamie@8bitcreative.com', 'Jamie Jag', 'jaguar'), ('kim@8bitcreative.com', 'Kim Jag', 'jaguar'), ('nick1@8bitcreative.com', 'Nick Clement', 'member'), ('nick2@gmail.com', 'Nick Clement', 'member')]:
    redis(['SADD', 'dsa:users', email], ['SET', 'dsa:user:' + email, json.dumps({'email': email, 'name': name, 'role': role, 'status': 'active', 'createdAt': '2026-01-01T00:00:00Z'})])
F = lambda i: {'id': f'f{i}', 'num': i, 'code': 'TEL_MISMATCH', 'severity': 'critical', 'category': 'Contact info', 'message': 'Phone differs', 'path': '/', 'pages': ['/'], 'location': 'Body', 'selector': f'#x{i}', 'visibleOn': ['desktop'], 'found': '555'}
site = {'id': 's1', 'siteId': 'abc123', 'host': 'ed.multiscreensite.com', 'businessName': 'PGC Wrap', 'assignee': 'reymark@8bitcreative.com', 'findings': [F(1), F(2)], 'scan': {'state': 'complete', 'finishedAt': '2026-10-15T04:03:00Z'}}
redis(['SET', 'dsa:site:s1', json.dumps(site)], ['HSET', 'dsa:fnum:s1', 'f1', '1', 'f2', '2'])
errs = []
with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={'width': 1300, 'height': 900}, color_scheme='dark'); ctx.add_cookies([{'name': 'dsa_sess', 'value': ADMIN, 'url': f'http://localhost:{APORT}'}])
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
    # a profile photo, from Your account
    pg.goto(f'http://localhost:{APORT}/#/site/s1'); pg.wait_for_selector('.sh-who .pp-btn', timeout=20000)
    pg.click('#btnMe'); pg.wait_for_selector('#mePhoto')
    pg.screenshot(path=os.path.join(OUT, 'people-me.png'))
    pg.set_input_files('#mePhotoIn', os.path.join(OUT, 'head-desk-dark.png') if os.path.exists(os.path.join(OUT, 'head-desk-dark.png')) else os.path.join(OUT, 'jags-admin-desk.png'))
    pg.wait_for_selector('#meAv img.av-img', timeout=10000)
    u = json.loads(redis(['GET', 'dsa:user:reymark@8bitcreative.com'])[0])
    check(u.get('photo', '').startswith('data:image/jpeg') and len(u['photo']) < 45000, 'a photo is saved, shrunk to a few KB', len(u.get('photo', '')))
    check('Change photo' in pg.inner_text('.modal') and pg.locator('#mePhotoOff').count() == 1, 'the account offers Change and Remove')
    pg.click('[data-close]'); pg.wait_for_timeout(300)
    check(pg.locator('#btnMe img.av-img').count() == 1, 'the photo shows in the top bar')
    # the picker on the audit header
    pg.goto(f'http://localhost:{APORT}/#/site/s1'); pg.wait_for_selector('.sh-who .pp-btn', timeout=20000)
    check(pg.locator('#sAssign').is_hidden() and 'Reymark R' in pg.inner_text('.sh-who .pp-btn') and pg.locator('.sh-who .pp-btn img.av-img').count() == 1, 'the owner shows as a photo and name, not a plain dropdown', (pg.locator('#sAssign').is_hidden(), pg.inner_text('.sh-who .pp-btn'), pg.locator('.sh-who .pp-btn img.av-img').count(), pg.locator('.sh-who .pp-btn').count()))
    pg.click('.sh-who .pp-btn'); pg.wait_for_selector('.pp-pop')
    heads = [x.strip() for x in pg.locator('.pp-gh').all_inner_texts()]
    check(heads[:3] == ['ADMINS', 'JAGUARS', 'MEMBERS'] or heads[:3] == ['Admins', 'Jaguars', 'Members'], 'grouped: Admins, Jaguars, Members', heads)
    check(pg.locator('.pp-item[data-v=""]').count() == 1 and pg.locator('.pp-list > .pp-item').first.get_attribute('data-v') == '', 'Unassigned comes first')
    t = pg.inner_text('.pp-pop')
    check('nick1@8bitcreative.com' in t and 'nick2@gmail.com' in t, 'two people with the same name are told apart by their email')
    check(pg.locator('.pp-item.on[data-v="reymark@8bitcreative.com"] img.av-img').count() == 1, 'the current one is marked, with their photo')
    pg.screenshot(path=os.path.join(OUT, 'people-picker.png'))
    pg.fill('.pp-q', 'jam')
    check(pg.locator('.pp-item:visible').count() == 1 and pg.locator('.pp-group:visible').count() == 1, 'search narrows the list')
    pg.keyboard.press('Enter'); pg.wait_for_timeout(800)
    s = unpack(redis(['GET', 'dsa:site:s1'])[0])
    check(s.get('assignee') == 'jamie@8bitcreative.com', 'picking someone assigns the audit (the old save still runs)', s.get('assignee'))
    pg.wait_for_selector('.sh-who .pp-btn'); check('Jamie Jag' in pg.inner_text('.sh-who .pp-btn'), 'the button shows the new owner')
    # item rows and the item panel use it too
    check(pg.locator('td .pp-btn').count() >= 2, 'item rows use the picker')
    pg.goto(f'http://localhost:{APORT}/#/site/s1/item/1'); pg.wait_for_selector('#drWho + .pp-btn', timeout=20000)
    pg.click('#drWho + .pp-btn'); pg.wait_for_selector('.pp-pop'); pg.click('.pp-item[data-v="kim@8bitcreative.com"]'); pg.wait_for_timeout(800)
    st = json.loads((redis(['HGET', 'dsa:fstate:s1', 'f1'])[0]) or '{}')
    check(st.get('assignee') == 'kim@8bitcreative.com', 'assigning an item from its panel works', st)
    pg.keyboard.press('Escape')
    ctx.close()
    # phone
    ctx = br.new_context(viewport={'width': 390, 'height': 844}); ctx.add_cookies([{'name': 'dsa_sess', 'value': ADMIN, 'url': f'http://localhost:{APORT}'}])
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(f'http://localhost:{APORT}/#/site/s1'); pg.wait_for_selector('.sh-who .pp-btn', timeout=20000)
    pg.click('.sh-who .pp-btn'); pg.wait_for_selector('.pp-pop')
    bb = pg.locator('.pp-pop').bounding_box()
    check(bb['x'] >= 0 and bb['x'] + bb['width'] <= 391 and pg.evaluate('document.documentElement.scrollWidth') <= 391, 'phone: the picker fits the screen')
    pg.screenshot(path=os.path.join(OUT, 'people-phone.png'))
    ctx.close(); br.close()
check(not errs, 'no script errors', errs[:3])
srv.terminate()
print('ALL PASS' if not fails else 'SOME FAILED: ' + ', '.join(fails))
