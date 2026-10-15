"""Sign-up: is this the email on our Slack? Checked as you type; the admins are warned if not.
Usage: python3 -I e2e_signup_slack.py <app> <tests>"""
import json, os, subprocess, sys, urllib.request, urllib.error
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT, FPORT = 3998, 8078, 8095
ADMIN_TOK = 'tokadmin1234567890abcdef'
fk = subprocess.Popen(['node', os.path.join(OUT, 'fakeanalytics.mjs'), str(FPORT)], stdout=subprocess.DEVNULL)
env = dict(os.environ, SLACK_BOT_TOKEN='xoxb-test', SLACK_API_BASE=f'http://127.0.0.1:{FPORT}/slack')
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-signup.log'), 'w'), text=True, env=env)
assert srv.stdout.readline().strip() == 'READY'
fails = []
def check(ok, what, extra=''):
    print(('PASS ' if ok else 'FAIL ') + what, extra if not ok else '')
    if not ok: fails.append(what)
def redis(*cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
def call(path, body=None, tok=None, ip='10.0.0.1'):
    h = {'Content-Type': 'application/json', 'x-forwarded-for': ip}
    if tok: h['Cookie'] = 'dsa_sess=' + tok
    req = urllib.request.Request(f'http://localhost:{APORT}{path}', data=json.dumps(body).encode() if body is not None else None, method='POST' if body is not None else 'GET', headers=h)
    try: return 200, json.loads(urllib.request.urlopen(req, timeout=30).read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')

s, r = call('/api/auth', {'op': 'slackcheck', 'email': 'maria@8bitcreative.com'})
check(r == {'configured': True, 'found': True}, 'an email on Slack is found (yes/no only, no name)', r)
s, r = call('/api/auth', {'op': 'slackcheck', 'email': 'stranger@gmail.com'})
check(r == {'configured': True, 'found': False}, 'an email not on Slack is not found', r)

errs = []
with sync_playwright() as p:
    br = p.chromium.launch()
    for w, h, dev in [(1300, 900, 'desk'), (390, 844, 'phone')]:
        ctx = br.new_context(viewport={'width': w, 'height': h}, color_scheme='dark')
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(f'http://localhost:{APORT}/'); pg.wait_for_selector('[data-mode="signup"]', timeout=20000)
        pg.click('[data-mode="signup"]'); pg.wait_for_selector('#auName')
        pg.fill('#auName', 'Sam Stranger'); pg.fill('#auEmail', 'stranger@gmail.com'); pg.click('#auPass')
        pg.wait_for_selector('#auSlack.warn', timeout=8000)
        check('not on our Slack' in pg.inner_text('#auSlack') and 'admins will be alerted' in pg.inner_text('#auSlack'), f'{dev}: the warning shows under the email')
        pg.screenshot(path=os.path.join(OUT, f'signup-slack-{dev}.png'))
        if dev == 'desk':
            pg.fill('#auEmail', 'maria@8bitcreative.com'); pg.click('#auPass')
            pg.wait_for_selector('#auSlack.ok', timeout=8000)
            check('Found on our Slack' in pg.inner_text('#auSlack'), 'a Slack email is confirmed')
            pg.fill('#auEmail', 'stranger@gmail.com'); pg.click('#auPass'); pg.wait_for_selector('#auSlack.warn', timeout=8000)
            pg.fill('#auPass', 'longpassword1'); pg.click('button[type=submit]')
            pg.wait_for_function("document.body.innerText.toLowerCase().includes('approv')", timeout=10000)
        else:
            check(pg.evaluate('document.documentElement.scrollWidth') <= w + 1, 'phone: the form fits')
        ctx.close()
    br.close()
check(not errs, 'no script errors', errs[:3])

u = json.loads(redis(['GET', 'dsa:user:stranger@gmail.com'])[0] or '{}')
check(u.get('status') != 'active' and u.get('slackMissing'), 'the account waits for approval, marked not on Slack', u.get('status'))
n = [json.loads(x) for x in redis(['LRANGE', 'dsa:notif:reymark@8bitcreative.com', 0, 9])[0]]
check(any(x['kind'] == 'signup' and 'not on our Slack' in x['text'] for x in n), 'the admins are alerted', [x.get('text') for x in n][:2])
s, r = call('/api/users', tok=ADMIN_TOK)
row = [x for x in r.get('users', []) if x['email'] == 'stranger@gmail.com']
check(row and row[0].get('slackMissing'), 'the Members approval list knows it')

# --- approving with a role, and the Slack message
s, r = call('/api/auth', {'op': 'signup', 'name': 'Maria Santos', 'email': 'maria@8bitcreative.com', 'password': 'longpassword1'}, ip='10.0.0.3')
check(s == 200 and r.get('pending'), 'a teammate signs up', r)
with sync_playwright() as p:
    br = p.chromium.launch(); ctx = br.new_context(viewport={'width': 1300, 'height': 900})
    ctx.add_cookies([{'name': 'dsa_sess', 'value': ADMIN_TOK, 'url': f'http://localhost:{APORT}'}])
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(f'http://localhost:{APORT}/#/settings/team'); pg.wait_for_selector('[data-aprole="maria@8bitcreative.com"]', timeout=20000)
    check(pg.locator('[data-aprole="maria@8bitcreative.com"] option[value="jaguar"]').count() == 1, 'the approval row offers the roles, Jaguar included')
    check(pg.locator('.member-row:has([data-aprole="stranger@gmail.com"]) .badge:has-text("Not on our Slack")').count() == 1, 'the stranger is marked Not on our Slack')
    pg.click('[data-approve="maria@8bitcreative.com"]'); pg.wait_for_timeout(500)
    check(redis(['GET', 'dsa:user:maria@8bitcreative.com'])[0] and json.loads(redis(['GET', 'dsa:user:maria@8bitcreative.com'])[0])['status'] != 'active', 'Approve without a role asks for one first')
    pg.select_option('[data-aprole="maria@8bitcreative.com"]', 'jaguar'); pg.screenshot(path=os.path.join(OUT, 'approve-role.png'))
    pg.click('[data-approve="maria@8bitcreative.com"]'); pg.wait_for_function("document.querySelector('#toast').textContent.includes('Approved')", timeout=8000)
    check('Jaguar' in pg.inner_text('#toast') and 'Slack' in pg.inner_text('#toast'), 'approved as Jaguar, told on Slack', pg.inner_text('#toast'))
    ctx.close(); br.close()
mu = json.loads(redis(['GET', 'dsa:user:maria@8bitcreative.com'])[0])
check(mu['status'] == 'active' and mu['role'] == 'jaguar', 'Maria is active with the Jaguar role')
for i in range(25): s, r = call('/api/auth', {'op': 'slackcheck', 'email': f'x{i}@gmail.com'}, ip='10.9.9.9')
check(r == {'configured': False}, 'one address can only ask so often', r)
s, r = call('/api/auth', {'op': 'slackcheck', 'email': 'maria@8bitcreative.com'}, ip='10.0.0.2')
check(r.get('found'), 'others are not affected')
srv.terminate(); fk.terminate()
print('ALL PASS' if not fails else 'SOME FAILED: ' + ', '.join(fails))
