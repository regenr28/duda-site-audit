"""Jaguars: on hold (take the next one), peeking read-only, and being brought in by an assignment or a mention.
Usage: python3 -I e2e_jags2.py <app> <tests>"""
import json, os, subprocess, sys, time, urllib.request, urllib.error, zlib, base64, hashlib
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT = 3998, 8078
ADMIN = 'tokadmin1234567890abcdef'
J1, J2 = 'tokjag1aaaaaaaaaaaaaaaaaa', 'tokjag2bbbbbbbbbbbbbbbbbb'
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-jags2.log'), 'w'), text=True)
assert srv.stdout.readline().strip() == 'READY'
fails = []
def check(ok, what, extra=''):
    print(('PASS ' if ok else 'FAIL ') + what, extra if not ok else '')
    if not ok: fails.append(what)
def redis(*cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
def call(tok, path, body=None):
    req = urllib.request.Request(f'http://localhost:{APORT}{path}', data=json.dumps(body).encode() if body is not None else None, method='POST' if body is not None else 'GET',
                                 headers={'Cookie': 'dsa_sess=' + tok, 'Content-Type': 'application/json'})
    try: return 200, json.loads(urllib.request.urlopen(req, timeout=60).read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')
def unpack(raw): return json.loads(zlib.decompress(base64.b64decode(raw[3:]), -15)) if raw.startswith('z1:') else json.loads(raw)
for email, name, tok in [('jag1@8bitcreative.com', 'Jamie Jag', J1), ('jag2@8bitcreative.com', 'Kim Jag', J2)]:
    redis(['SADD', 'dsa:users', email], ['SET', 'dsa:user:' + email, json.dumps({'email': email, 'name': name, 'role': 'jaguar', 'status': 'active', 'createdAt': '2026-01-01T00:00:00Z'})],
          ['SET', 'dsa:sess:' + hashlib.sha256(tok.encode()).hexdigest(), email])
ms = int(time.time() * 1000)
redis(['SET', 'dsa:dudasites', json.dumps({'sites': [{'id': 'w1', 'name': 'Fuerst Electric', 'domain': 'fuerst.com', 'published': '2026-09-01', 'first': '2019-01-01'}, {'id': 'w2', 'name': 'Second Site', 'domain': 'second.com', 'published': '2026-09-01', 'first': '2020-01-01'}]})],
      ['HSET', 'dsa:cwsum', 'w1', json.dumps({'at': ms, 'n': 2, 'c': 1}), 'w2', json.dumps({'at': ms, 'n': 3, 'c': 2})])

s, b = call(J1, '/api/jags', {'op': 'take'}); A1 = b['card']['auditId']
site = unpack(redis(['GET', 'dsa:site:' + A1])[0])
site['findings'] = [{'id': 'f1', 'num': 1, 'code': 'TEL_MISMATCH', 'severity': 'critical', 'category': 'Contact info', 'message': 'Phone differs', 'path': '/', 'pages': ['/'], 'location': 'Body', 'selector': '#x', 'visibleOn': ['desktop'], 'found': '555'}]
redis(['SET', 'dsa:site:' + A1, json.dumps(site)], ['HSET', 'dsa:fnum:' + A1, 'f1', '1'])
call(J1, '/api/store', {'op': 'scanState', 'id': A1, 'scan': {'state': 'complete'}})

# --- on hold
s, b = call(J1, '/api/store', {'op': 'patchSite', 'id': A1, 'changes': {'status': 'On hold'}})
check(s == 403, 'a Jaguar still cannot set the status directly (the board does)')
s, b = call(J1, '/api/jags', {'op': 'hold', 'dudaId': 'w1', 'note': ''})
check(s == 400, 'on hold needs a note')
s, b = call(J1, '/api/jags', {'op': 'hold', 'dudaId': 'w1', 'note': 'Waiting for the client to confirm the phone'})
check(s == 200 and b['card']['state'] == 'review' and b['card']['hold']['note'].startswith('Waiting'), 'on hold → Needs review, with the note', b)
check(unpack(redis(['GET', 'dsa:site:' + A1])[0])['status'] == 'On hold', 'the audit says On hold')
n = [json.loads(x) for x in redis(['LRANGE', 'dsa:notif:reymark@8bitcreative.com', 0, 5])[0]]
check(any(x['kind'] == 'jag-review' and 'on hold' in x['text'] for x in n), 'the admins are told')
s, b = call(J1, '/api/jags', {'op': 'take'})
check(s == 200 and b['card']['dudaId'] == 'w2', 'with one on hold, the Jaguar can take the next website', b)
s, b = call(ADMIN, '/api/jags', {'op': 'approve', 'dudaId': 'w1'})
check(s == 409, 'a website on hold is not approved by mistake')
s, b = call(ADMIN, '/api/jags', {'op': 'resume', 'dudaId': 'w1', 'note': 'Client confirmed'})
check(s == 200 and b['card']['state'] == 'progress' and not b['card'].get('hold'), 'an admin takes it off hold: back to the same Jaguar, In progress', b)

# --- peeking
s, b = call(J2, '/api/jags', {'op': 'peek', 'dudaId': 'w1'})
check(s == 403, 'peeking is off unless the admins turn it on')
call(ADMIN, '/api/jags', {'op': 'settings', 'peek': True})
s, b = call(J2, '/api/jags', {'op': 'peek', 'dudaId': 'w1'})
check(s == 200 and b['auditId'] == A1, 'with peeking on, a Jaguar can peek at a teammate\'s website', b)
s, b = call(J2, '/api/store?op=site&id=' + A1)
check(s == 200, 'the peeker can open it')
s, b = call(J2, '/api/store?op=list')
row = [x for x in b['sites'] if x['id'] == A1]
check(row and any(w['e'] == 'jag2@8bitcreative.com' and w['h'] == 'peek' for w in row[0]['watch']), 'it is on the peeker\'s Audits list, marked as watching')
s, b = call(J2, '/api/store', {'op': 'patchFinding', 'siteId': A1, 'findingIds': ['f1'], 'changes': {'status': 'done'}})
check(s == 403 and 'watching' in b['error'], 'read-only: the peeker cannot change items', b)
s, b = call(J2, '/api/store', {'op': 'comment', 'siteId': A1, 'target': 'site', 'text': 'Looks like the footer phone too'})
check(s == 200, 'but can comment')
act = [json.loads(x)['text'] for x in redis(['LRANGE', 'dsa:act:' + A1, 0, 20])[0]]
check(any('started watching' in t for t in act), 'the Activity log says they started watching')

# --- brought in by an assignment or a mention
s, b = call(J1, '/api/store', {'op': 'patchFinding', 'siteId': A1, 'findingIds': ['f1'], 'changes': {'assignee': 'jag2@8bitcreative.com'}})
site = unpack(redis(['GET', 'dsa:site:' + A1])[0])
check(s == 200 and 'jag2@8bitcreative.com' in site['people'], 'assigning an item brings that person into the website')
s, b = call(J2, '/api/store', {'op': 'patchFinding', 'siteId': A1, 'findingIds': ['f1'], 'changes': {'status': 'done'}})
check(s == 200, 'once given work on it, they can change it (no longer read-only)', b)
s, b = call(J1, '/api/store', {'op': 'comment', 'siteId': A1, 'target': 'site', 'text': '@Dana Dev can you check this?', 'mentions': ['dev@8bitcreative.com']})
site = unpack(redis(['GET', 'dsa:site:' + A1])[0])
check('dev@8bitcreative.com' in site['people'] and any(w['email'] == 'dev@8bitcreative.com' and w['how'] == 'mentioned' for w in site['watchers']), 'mentioning someone brings them in too')
act = [json.loads(x)['text'] for x in redis(['LRANGE', 'dsa:act:' + A1, 0, 30])[0]]
check(any('brought Kim Jag' in t and 'assigned' in t for t in act) and any('brought Dana Dev' in t and 'mentioned' in t for t in act), 'both are in the Activity log', act[:6])

# a second peek, to see the screen and to stop watching
s, b = call(J2, '/api/jags', {'op': 'peek', 'dudaId': 'w2'})
A2 = b.get('auditId')
errs = []
with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={'width': 1300, 'height': 900}); ctx.add_cookies([{'name': 'dsa_sess', 'value': J1, 'url': f'http://localhost:{APORT}'}])
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(f'http://localhost:{APORT}/#/site/' + A1); pg.wait_for_selector('.sh-who', timeout=20000); pg.wait_for_timeout(500)
    check(pg.locator('#sStatus').count() == 0 and pg.locator('.sh-who .ro-pill').count() == 1 and pg.locator('#sHold').count() == 1, 'Jaguar: status is shown, not a dropdown that fails; ⏸ Put on hold is there')
    check('2 watching' in pg.inner_text('.sh-meta') or 'watching' in pg.inner_text('.sh-meta'), 'the header says who is watching', pg.inner_text('.sh-meta'))
    pg.screenshot(path=os.path.join(OUT, 'jags2-holder.png'))
    pg.goto(f'http://localhost:{APORT}/#/tasks'); pg.wait_for_selector('.jg-board', timeout=20000)
    check(pg.locator('[data-jhold]').count() >= 1, 'Tasks: ⏸ On hold on my card')
    ctx.close()
    ctx = br.new_context(viewport={'width': 1300, 'height': 900}); ctx.add_cookies([{'name': 'dsa_sess', 'value': J2, 'url': f'http://localhost:{APORT}'}])
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(f'http://localhost:{APORT}/#/tasks'); pg.wait_for_selector('.jg-board', timeout=20000)
    check(pg.locator('[data-jpeek]').count() >= 1, 'Tasks: 👁 Peek on teammates\' cards when the admins allow it')
    pg.goto(f'http://localhost:{APORT}/#/'); pg.wait_for_selector('.page-head h1', timeout=20000); pg.wait_for_timeout(600)
    check('Watching' in pg.inner_text('#view'), 'the peeked website is on their Audits, tagged Watching')
    pg.goto(f'http://localhost:{APORT}/#/site/' + A2); pg.wait_for_selector('.ro-note', timeout=20000)
    check(pg.evaluate("document.body.classList.contains('ro-site')"), 'the audit opens read-only, with a Stop watching button')
    pg.screenshot(path=os.path.join(OUT, 'jags2-peek.png'))
    pg.click('#sUnpeek'); pg.wait_for_timeout(1200)
    site2 = unpack(redis(['GET', 'dsa:site:' + A2])[0])
    check(not any(w['email'] == 'jag2@8bitcreative.com' for w in site2.get('watchers', [])), 'Stop watching takes them off')
    act = [json.loads(x)['text'] for x in redis(['LRANGE', 'dsa:act:' + A2, 0, 10])[0]]
    check(any('stopped watching' in t for t in act), 'and is logged')
    check(not pg.evaluate("document.body.classList.contains('ro-site')"), 'read-only mode ends when leaving')
    ctx.close(); br.close()
check(not errs, 'no script errors', errs[:3])
srv.terminate()
print('ALL PASS' if not fails else 'SOME FAILED: ' + ', '.join(fails))
