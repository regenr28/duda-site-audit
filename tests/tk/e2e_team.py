"""Stage 4: gear → General settings, Team page, Add member (real name, Slack check, temp password),
forced password change, security log (own; everyone for the Super Admin only).
Usage: python3 -I e2e_team.py <app> <tests>"""
import json, os, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT, FPORT = 3998, 8078, 8095
ADMIN_TOK = 'tokadmin1234567890abcdef'; MTOK = 'tokmember1234567890abcde'
fk = subprocess.Popen(['node', os.path.join(OUT, 'fakeanalytics.mjs'), str(FPORT)], stdout=subprocess.DEVNULL)
env = dict(os.environ, SLACK_BOT_TOKEN='xoxb-test', SLACK_API_BASE=f'http://127.0.0.1:{FPORT}/slack')
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-team.log'), 'w'), text=True, env=env)
assert srv.stdout.readline().strip() == 'READY'
def redis(*cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
def call(tok, body, path='/api/users'):
    r = subprocess.run(['curl', '-s', '-X', 'POST', f'http://localhost:{APORT}{path}', '-H', 'Content-Type: application/json', '-H', f'Cookie: dsa_sess={tok}', '-d', json.dumps(body)], capture_output=True, text=True).stdout
    try: return json.loads(r)
    except Exception: return {'raw': r}
def login(email, pw):
    r = subprocess.run(['curl', '-s', '-i', '-X', 'POST', f'http://localhost:{APORT}/api/auth', '-H', 'Content-Type: application/json', '-H', 'User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Safari/604', '-d', json.dumps({'op': 'login', 'email': email, 'password': pw})], capture_output=True, text=True).stdout
    return r
# one teammate with a one-word name, like "Derek"
redis(['SADD', 'dsa:users', 'derek@8bitcreative.com'], ['SET', 'dsa:user:derek@8bitcreative.com', json.dumps({'email': 'derek@8bitcreative.com', 'name': 'Derek', 'role': 'member', 'status': 'active', 'createdAt': '2026-01-01T00:00:00Z'})])
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
errors = []
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx = br.new_context(viewport={'width': 1440, 'height': 1000})
        ctx.add_cookies([{'name': 'dsa_sess', 'value': ADMIN_TOK, 'domain': 'localhost', 'path': '/'}])
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(f'http://localhost:{APORT}/#/sites'); pg.wait_for_selector('#btnGear', timeout=20000)
        check(pg.locator('#btnMembers').count() == 0, 'the Members button is gone from the top bar; a gear is there instead')
        pg.click('#btnGear'); pg.wait_for_selector('#memList .member-row', timeout=15000)
        check(pg.url.endswith('#/settings') or pg.url.endswith('#/settings/team'), 'the gear opens General settings on Team members')
        nav = pg.inner_text('.set-nav')
        check(all(x in nav for x in ['Team members', 'Roles', 'Your notifications', 'Ticket settings', 'Domain monitoring', 'Integrations', 'Security log']), 'settings sections listed: ' + nav.replace('\n', ' | '))
        time.sleep(1)
        check('Needs full name' in pg.inner_text('#memList'), '"Derek" is flagged Needs full name')
        # fix Derek's name
        pg.once('dialog', lambda d: d.accept('Derek'))
        pg.click('[data-rename="derek@8bitcreative.com"]'); time.sleep(0.8)
        check(json.loads(redis(['GET', 'dsa:user:derek@8bitcreative.com'])[0])['name'] == 'Derek', 'a one-word name is refused')
        pg.once('dialog', lambda d: d.accept('Derek Wong'))
        pg.click('[data-rename="derek@8bitcreative.com"]'); time.sleep(1)
        check(json.loads(redis(['GET', 'dsa:user:derek@8bitcreative.com'])[0])['name'] == 'Derek Wong', 'fixed to a real full name')
        # add member
        pg.click('#memAdd'); pg.wait_for_selector('#amName')
        pg.fill('#amName', 'Maria'); time.sleep(0.2)
        check('first and last name' in pg.inner_text('#amNameMsg'), 'a single name is flagged while typing')
        pg.fill('#amName', 'Maria Santos'); pg.fill('#amEmail', 'maria@8bitcreative.com'); time.sleep(0.2)
        check(pg.locator('#amGo').is_disabled(), 'Create stays off until Slack has been checked')
        pg.click('#amSlack'); pg.wait_for_function("() => /Slack/.test(document.querySelector('#amSlackMsg').textContent)", timeout=10000)
        check('In Slack as Maria Santos' in pg.inner_text('#amSlackMsg') and not pg.locator('#amGo').is_disabled(), 'Check if Slack available finds her in Slack, then Create is allowed')
        pg.select_option('#amRole', 'member')
        pg.click('#amGo'); pg.wait_for_selector('.tp-pass', timeout=10000)
        temp = pg.inner_text('.tp-pass').strip()
        u = json.loads(redis(['GET', 'dsa:user:maria@8bitcreative.com'])[0])
        check(len(temp) >= 10 and u['mustChange'] and u['status'] == 'active' and u['role'] == 'member' and u['name'] == 'Maria Santos', f'account created with a temporary password ({len(temp)} characters), must change it, active, Member')
        pg.screenshot(path=os.path.join(OUT, 'team-temp.png'))
        pg.click('.modal footer .btn.primary'); time.sleep(0.5)
        check('Temporary password' in pg.inner_text('#memList'), 'the Team list shows she still has a temporary password')
        pg.screenshot(path=os.path.join(OUT, 'team-page.png'), full_page=True)
        # Maria signs in with it
        mctx = br.new_context(viewport={'width': 390, 'height': 850})
        mp = mctx.new_page(); mp.on('pageerror', lambda e: errors.append(str(e)))
        mp.goto(f'http://localhost:{APORT}/'); mp.wait_for_selector('#auEmail', timeout=15000)
        mp.fill('#auEmail', 'maria@8bitcreative.com'); mp.fill('#auPass', temp); mp.click('#auForm button[type=submit]')
        mp.wait_for_selector('#auPass2', timeout=10000)
        check('Choose your own password' in mp.inner_text('#view'), 'first sign-in goes straight to "Choose your own password"')
        ck = [c for c in mctx.cookies() if c['name'] == 'dsa_sess'][0]['value']
        r = subprocess.run(['curl', '-s', f'http://localhost:{APORT}/api/users', '-H', f'Cookie: dsa_sess={ck}'], capture_output=True, text=True).stdout
        check('mustChange' in r, 'until then the server refuses everything else')
        mp.fill('#auPass', 'short'); mp.fill('#auPass2', 'short'); mp.click('#auForm button[type=submit]'); time.sleep(0.5)
        mp.fill('#auPass', 'MariaPass2026!'); mp.fill('#auPass2', 'MariaPass2026!'); mp.click('#auForm button[type=submit]')
        mp.wait_for_selector('#btnGear', state='attached', timeout=15000)
        u = json.loads(redis(['GET', 'dsa:user:maria@8bitcreative.com'])[0])
        check(not u.get('mustChange'), 'after choosing a password she is in, and the temporary one is gone')
        mp.screenshot(path=os.path.join(OUT, 'team-maria.png'))
        r = login('maria@8bitcreative.com', temp)
        check('401' in r.split('\n')[0], 'the temporary password no longer works')
        for k in range(5): login('maria@8bitcreative.com', 'wrong' + str(k))
        notes = [json.loads(x) for x in redis(['LRANGE', 'dsa:notif:reymark@8bitcreative.com', 0, 20])[0]]
        check(any(n.get('kind') == 'security' and 'Maria Santos' in n.get('text', '') for n in notes), 'five wrong passwords: admins are told')
        # her own security log (from her profile's settings)
        mp.goto(f'http://localhost:{APORT}/#/settings/security'); mp.wait_for_selector('.sec-list', timeout=15000); time.sleep(0.5)
        st = mp.inner_text('.set-body')
        check(all(x in st for x in ['Account created', 'Signed in', 'Password changed', 'Wrong password']) and 'with temporary password' in st, 'her security log: created, signed in with the temporary password, changed it, wrong passwords')
        check('Safari on iPhone' in st, 'the device is shown in plain words')
        check(mp.locator('[data-secall]').count() == 0, 'she has no "Everyone" view')
        mp.screenshot(path=os.path.join(OUT, 'team-seclog-phone.png'), full_page=True)
        # another member can't read hers
        r = call(MTOK, {'op': 'seclog', 'email': 'maria@8bitcreative.com'})
        check('own security log' in json.dumps(r), 'a member opening someone else\'s security log is refused')
        r = call(MTOK, {'op': 'seclogAll'})
        check('Super Admin' in json.dumps(r), 'only the Super Admin can read everyone\'s')
        # member viewing Maria's profile: no security log button
        dctx = br.new_context(viewport={'width': 1280, 'height': 900}); dctx.add_cookies([{'name': 'dsa_sess', 'value': MTOK, 'domain': 'localhost', 'path': '/'}])
        dp = dctx.new_page(); dp.goto(f'http://localhost:{APORT}/#/settings/team'); dp.wait_for_selector('#memList .member-row', timeout=15000); time.sleep(0.8)
        dp.click('[data-who="maria@8bitcreative.com"]'); time.sleep(0.8)
        check(dp.locator('#maSec').count() == 0, 'a member opening Maria\'s profile sees no security log')
        dp.keyboard.press('Escape'); time.sleep(0.3)
        check(dp.locator('#memAdd').count() == 0 and dp.locator('[data-reset]').count() == 0, 'members see the team, without admin buttons')
        # super admin: everyone
        pg.goto(f'http://localhost:{APORT}/#/settings/security'); pg.wait_for_selector('[data-secall="1"]', timeout=15000)
        pg.click('[data-secall="1"]'); pg.wait_for_selector('#secWho', timeout=10000); time.sleep(0.4)
        ev = pg.inner_text('.set-body')
        check('Maria Santos' in ev and 'Derek Wong' in ev, 'the Super Admin sees everyone\'s security log, filterable by person')
        pg.select_option('#secWho', 'maria@8bitcreative.com'); time.sleep(0.3)
        check('Derek Wong' not in pg.inner_text('.sec-list'), 'filtered to one person')
        pg.screenshot(path=os.path.join(OUT, 'team-seclog-all.png'), full_page=True)
        # reset password → temporary again
        pg.goto(f'http://localhost:{APORT}/#/settings/team'); pg.wait_for_selector('[data-reset="maria@8bitcreative.com"]', timeout=15000)
        pg.once('dialog', lambda d: d.accept()); pg.click('[data-reset="maria@8bitcreative.com"]'); pg.wait_for_selector('.tp-pass', timeout=10000)
        check(json.loads(redis(['GET', 'dsa:user:maria@8bitcreative.com'])[0]).get('mustChange'), 'Reset password gives a new temporary one she must change')
        check(not errors, 'no script errors ' + ' | '.join(errors[:3]))
        br.close()
except Exception:
    import traceback; traceback.print_exc(); ok = False
finally:
    srv.terminate(); fk.terminate()
    for pat in ['[f]ixsite.mjs', '[f]akeredis.mjs', '[d]ev-server.js', '[f]akeanalytics.mjs']: subprocess.run(['pkill', '-f', pat])
print('ALL PASS' if ok else 'SOME FAILED')
