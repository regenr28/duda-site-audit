"""Tasks: the Jaguars board. First in, first out; everything fixed; review; hand on with a reason.
Usage: python3 -I e2e_jags.py <app> <tests>"""
import json, os, subprocess, sys, time, urllib.request, urllib.error, zlib, base64, hashlib
from datetime import datetime, timezone, timedelta
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT = 3998, 8078
ADMIN = 'tokadmin1234567890abcdef'
J1, J2 = 'tokjag1aaaaaaaaaaaaaaaaaa', 'tokjag2bbbbbbbbbbbbbbbbbb'
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-jags.log'), 'w'), text=True)
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
iso = lambda d: d.strftime('%Y-%m-%dT%H:%M:%S.000Z')
NOW = datetime.now(timezone.utc)
def unpack(raw):
    return json.loads(zlib.decompress(base64.b64decode(raw[3:]), -15)) if raw.startswith('z1:') else json.loads(raw)
for email, name, tok in [('jag1@8bitcreative.com', 'Jamie Jag', J1), ('jag2@8bitcreative.com', 'Kim Jag', J2)]:
    redis(['SADD', 'dsa:users', email], ['SET', 'dsa:user:' + email, json.dumps({'email': email, 'name': name, 'role': 'jaguar', 'status': 'active', 'createdAt': '2026-01-01T00:00:00Z'})],
          ['SET', 'dsa:sess:' + hashlib.sha256(tok.encode()).hexdigest(), email])
sites = [{'id': 'w1', 'name': 'Oldest Auto Spa', 'domain': 'oldest.com', 'published': '2026-09-01', 'first': '2019-03-01', 'created': '2019-01-01'},
         {'id': 'w2', 'name': 'Middle Detail Co', 'domain': 'middle.com', 'published': '2026-09-01', 'first': '2022-03-01', 'created': '2022-01-01'},
         {'id': 'w3', 'name': 'No Criticals Ltd', 'domain': 'fine.com', 'published': '2026-09-01', 'first': '2018-03-01', 'created': '2018-01-01'},
         {'id': 'w4', 'name': 'Newest Tint', 'domain': 'newest.com', 'published': '2026-09-01', 'first': '2025-03-01', 'created': '2025-01-01'}]
ms = int(time.time() * 1000)
redis(['SET', 'dsa:dudasites', json.dumps({'sites': sites})],
      ['HSET', 'dsa:cwsum', 'w1', json.dumps({'at': ms - 3600000, 'n': 3, 'c': 2}), 'w2', json.dumps({'at': ms, 'n': 9, 'c': 1}), 'w3', json.dumps({'at': ms, 'n': 2, 'c': 0}), 'w4', json.dumps({'at': ms, 'n': 1, 'c': 1})])

# --- a Jaguar sees the queue in order, without the issues
s, b = call(J1, '/api/jags?op=board')
check(s == 200 and [r['dudaId'] for r in b['queue']] == ['w1', 'w2', 'w4'], 'queue: critical websites only, oldest first', b)
check(all('n' not in r and 'c' not in r for r in b['queue']), 'a Jaguar does not see the errors before taking a website')
s, b = call(J1, '/api/jags', {'op': 'take', 'dudaId': 'w2'})
check(s == 409, 'first in, first out: the second website cannot be taken', b)
s, b = call(J1, '/api/jags', {'op': 'take'})
check(s == 200 and b['card']['dudaId'] == 'w1' and b['card']['auditId'], 'Take next gives the top website and makes its audit', b)
A = b['card']['auditId']
site = unpack(redis(['GET', 'dsa:site:' + A])[0])
check(site['assignee'] == 'jag1@8bitcreative.com' and site['status'] == 'In progress', 'the audit is assigned to the Jaguar, In progress')
s, b = call(J1, '/api/jags', {'op': 'take'})
check(s == 409, 'one website at a time', b)
s, b = call(J2, '/api/jags?op=board')
c = [x for x in b['cards'] if x['dudaId'] == 'w1']
check(c and c[0]['byName'] == 'Jamie Jag' and not c[0]['scanned'], 'everyone sees who holds it; no counts before the scan')
s, b = call(J2, '/api/store?op=one&id=' + A) if False else (0, 0)

# --- scanned: three items, one in each group
def F(i, code, sev, cat):
    return {'id': f'f{i}', 'num': i, 'code': code, 'severity': sev, 'category': cat, 'message': code, 'path': '/', 'pages': ['/'], 'location': 'Body', 'selector': f'#x{i}', 'visibleOn': ['desktop'], 'found': 'x'}
site['findings'] = [F(1, 'PHONE_MISMATCH', 'critical', 'Contact info'), F(2, 'FONT_OFF_SYSTEM', 'warning', 'Design'), F(3, 'META_DESC_LONG', 'info', 'Meta / SEO')]
redis(['SET', 'dsa:site:' + A, json.dumps(site)])
s, b = call(J1, '/api/store', {'op': 'scanState', 'id': A, 'scan': {'state': 'complete', 'finishedAt': iso(datetime.now(timezone.utc) + timedelta(seconds=2))}})
check(s == 200, 'scan saved', b)
s, b = call(J2, '/api/jags?op=board')
c = [x for x in b['cards'] if x['dudaId'] == 'w1'][0]
check(c['scanned'] and c['progress']['crit'] == 1 and c['progress']['open'] == 3, 'after the scan the whole team sees the counts', c.get('progress'))
s, b = call(J1, '/api/jags', {'op': 'done', 'dudaId': 'w1'})
check(s == 409 and '3 items' in b['error'], 'Done refused while items are open (polish and lengths included)', b)
st = lambda x, t: json.dumps({'status': x, 'updatedBy': 'jag1@8bitcreative.com', 'updatedAt': iso(t)})
later = datetime.now(timezone.utc) + timedelta(seconds=8)
redis(['HSET', 'dsa:fstate:' + A, 'f1', st('done', later), 'f2', st('done', later), 'f3', st('false', later)])
s, b = call(J1, '/api/jags', {'op': 'done', 'dudaId': 'w1'})
check(s == 409 and 'Rescan first' in b['error'], 'Done refused when items were fixed after the last scan', b)
call(J1, '/api/store', {'op': 'scanState', 'id': A, 'scan': {'state': 'complete', 'finishedAt': iso(later + timedelta(seconds=5))}})
s, b = call(J1, '/api/jags', {'op': 'done', 'dudaId': 'w1'})
check(s == 200 and b.get('review') and b['card']['state'] == 'review', 'a false alarm sends it to Needs review', b)
n = [json.loads(x) for x in redis(['LRANGE', 'dsa:notif:reymark@8bitcreative.com', 0, 9])[0]]
check(any(x['kind'] == 'jag-review' for x in n), 'the approver is told')
s, b = call(J1, '/api/jags', {'op': 'approve', 'dudaId': 'w1'})
check(s == 403, 'a Jaguar cannot approve their own work')
s, b = call(ADMIN, '/api/jags', {'op': 'sendback', 'dudaId': 'w1', 'note': ''})
check(s == 400, 'sending back needs a reason')
s, b = call(ADMIN, '/api/jags', {'op': 'approve', 'dudaId': 'w1', 'note': 'Checked the false alarm, fine'})
check(s == 200 and b['card']['state'] == 'complete', 'approved → Complete', b)
check(unpack(redis(['GET', 'dsa:site:' + A])[0])['status'] == 'Complete', 'the audit says Complete')
n = [json.loads(x) for x in redis(['LRANGE', 'dsa:notif:jag1@8bitcreative.com', 0, 9])[0]]
check(any(x['kind'] == 'jag-approved' for x in n), 'the Jaguar is told it was approved')
act = [json.loads(x)['text'] for x in redis(['LRANGE', 'dsa:act:' + A, 0, 20])[0]]
check(any('Jaguars queue' in t for t in act) and any('approved' in t for t in act), "the audit's Activity tab has the board's lines", act[:4])

# --- hand on needs a reason
s, b = call(J2, '/api/jags', {'op': 'take'})
check(s == 200 and b['card']['dudaId'] == 'w2', 'the next Jaguar gets the next website', b)
s, b = call(J2, '/api/jags', {'op': 'reassign', 'dudaId': 'w2', 'to': 'jag1@8bitcreative.com', 'note': ''})
check(s == 400, 'handing a whole website on needs a reason')
s, b = call(J2, '/api/jags', {'op': 'reassign', 'dudaId': 'w2', 'to': 'jag1@8bitcreative.com', 'note': 'Not sure about the address in the footer'})
check(s == 200 and b['card']['by'] == 'jag1@8bitcreative.com', 'handed on with a reason', b)
n = [json.loads(x) for x in redis(['LRANGE', 'dsa:notif:jag1@8bitcreative.com', 0, 9])[0]]
check(any(x['kind'] == 'jag-assign' and 'footer' in x['text'] for x in n), 'the new holder is told, with the reason')

# --- admin settings, pins, counts, back again
s, b = call(J1, '/api/jags', {'op': 'settings', 'order': 'most'})
check(s == 403, 'a Jaguar cannot change the queue')
call(ADMIN, '/api/jags', {'op': 'settings', 'order': 'newest', 'lock': False, 'limit': 2})
redis(['HSET', 'dsa:cwsum', 'w1', json.dumps({'at': ms + 3 * 86400000, 'n': 1, 'c': 1})])
s, b = call(ADMIN, '/api/jags?op=board')
q = b['queue']
check([r['dudaId'] for r in q] == ['w4', 'w1'] and 'n' in q[0], 'admins see the counts; newest first', [r['dudaId'] for r in q])
check(any(r['dudaId'] == 'w1' and r['back'] for r in q), 'a finished website whose live site still has errors comes back')
call(ADMIN, '/api/jags', {'op': 'pin', 'dudaId': 'w1', 'on': True})
s, b = call(ADMIN, '/api/jags?op=board')
check(b['queue'][0]['dudaId'] == 'w1', 'pinned goes to the top')

# --- an admin sends audits from Audits to the board
s, b = call(ADMIN, '/api/store', {'op': 'create', 'siteId': 'adm1abcd', 'host': 'ed.multiscreensite.com', 'editorUrl': 'https://ed.multiscreensite.com/home/site/adm1abcd/home', 'assignee': 'reymark@8bitcreative.com'})
check(s == 200, 'admin audit made', b); AUD1 = b['id']
s, b = call(ADMIN, '/api/store', {'op': 'create', 'siteId': 'adm2abcd', 'host': 'ed.multiscreensite.com', 'editorUrl': 'https://ed.multiscreensite.com/home/site/adm2abcd/home', 'assignee': 'reymark@8bitcreative.com'})
AUD2 = b['id']
s, b = call(J1, '/api/jags', {'op': 'send', 'auditId': AUD1})
check(s == 403, 'a Jaguar cannot send audits to the board')
s, b = call(ADMIN, '/api/jags', {'op': 'send', 'auditId': AUD1, 'to': 'jag2@8bitcreative.com', 'note': 'Half done, contact info is fixed'})
check(s == 200 and b['card']['state'] == 'progress' and b['card']['by'] == 'jag2@8bitcreative.com', 'sent straight to a Jaguar: In progress with their name', b)
check(unpack(redis(['GET', 'dsa:site:' + AUD1])[0])['assignee'] == 'jag2@8bitcreative.com', 'the audit is now theirs')
s, b = call(ADMIN, '/api/jags', {'op': 'send', 'auditId': AUD2, 'note': 'Next in line'})
check(s == 200 and b['card']['state'] == 'queued', 'sent to the queue', b)
s, b = call(ADMIN, '/api/jags', {'op': 'send', 'auditId': AUD1})
check(s == 409, 'cannot send a website that is already being fixed')
s, b = call(ADMIN, '/api/store?op=list')
fl = {x['id']: x.get('board') for x in b['sites']}
check(fl.get(AUD1) and fl[AUD1]['state'] == 'progress' and fl.get(AUD2) and fl[AUD2]['state'] == 'queued' and not fl.get(A), 'the Audits list knows which websites are on the board (finished ones are not)', fl)
s, b = call(ADMIN, '/api/jags?op=board')
check(any(r['dudaId'] == 'adm2abcd' and r.get('sent') for r in b['queue']), 'the queued audit is in the queue, marked as sent from Audits')
check(any(c['dudaId'] == 'adm1abcd' and c['state'] == 'progress' for c in b['cards']), 'the other is In progress on the board')
n = [json.loads(x) for x in redis(['LRANGE', 'dsa:notif:jag2@8bitcreative.com', 0, 9])[0]]
check(any(x['kind'] == 'jag-assign' and 'Half done' in x['text'] for x in n), 'the Jaguar is told, with the note')

# --- the screen
errs = []
with sync_playwright() as p:
    br = p.chromium.launch()
    for tok, tag in [(J1, 'jag'), (ADMIN, 'admin')]:
        for w, h, dev in [(1400, 900, 'desk'), (390, 844, 'phone')]:
            ctx = br.new_context(viewport={'width': w, 'height': h})
            ctx.add_cookies([{'name': 'dsa_sess', 'value': tok, 'url': f'http://localhost:{APORT}'}])
            pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.goto(f'http://localhost:{APORT}/#/tasks'); pg.wait_for_selector('.jg-board', timeout=20000); pg.wait_for_timeout(400)
            pg.screenshot(path=os.path.join(OUT, f'jags-{tag}-{dev}.png'), full_page=True)
            if dev == 'phone':
                check(pg.evaluate('document.documentElement.scrollWidth') <= w + 1, f'{tag} phone: the board fits')
            else:
                check(pg.locator('.sidenav a[href="#/tasks"], #sideNav a[href="#/tasks"]').count() >= 1, f'{tag}: Tasks is in the menu')
                if tag == 'admin':
                    pg.goto(f'http://localhost:{APORT}/#/'); pg.wait_for_selector('.page-head h1', timeout=20000); pg.wait_for_timeout(600)
                    txt = pg.inner_text('#view')
                    check('Jaguars board' in txt and 'adm1abcd' not in txt and 'adm2abcd' not in txt, 'Audits leaves out the websites on the board and says so')
                    pg.screenshot(path=os.path.join(OUT, 'jags-audits.png'))
                    pg.goto(f'http://localhost:{APORT}/#/site/' + A); pg.wait_for_selector('#sMore', timeout=20000)
                    pg.click('#sMore'); pg.click('#sJag'); pg.wait_for_selector('#sjTo')
                    check(pg.locator('#sjTo optgroup[label="Straight to a Jaguar"] option').count() == 2, 'Send to Jaguars lists the Jaguars first')
                    pg.screenshot(path=os.path.join(OUT, 'jags-send.png'))
                    pg.click('[data-close]')
                    pg.goto(f'http://localhost:{APORT}/#/tasks'); pg.wait_for_selector('.jg-board'); pg.wait_for_timeout(400)
                    check(pg.locator('#jgOrder').count() == 1 and 'contact-info errors' in pg.inner_text('.jg-basis'), 'admin: settings and the note on what the counts are')
                    pg.click('[data-jhand]'); pg.wait_for_selector('#jgWho')
                    check(pg.locator('#jgWho option[value="__queue"]').count() == 1, 'hand on can put it back in the queue')
                else:
                    check(pg.locator('#jgOrder').count() == 0, 'a Jaguar has no settings')
                    check('Criticals' not in pg.inner_text('.jg-board .pj-col:first-child'), 'a Jaguar sees no issues in the queue')
                    pg.goto(f'http://localhost:{APORT}/#/'); pg.wait_for_selector('.page-head h1', timeout=20000); pg.wait_for_timeout(600)
                    check('Yours on Tasks' in pg.inner_text('#view'), 'a Jaguar sees the website they hold on Audits (tagged Yours on Tasks)', pg.inner_text('#view')[:300])
                    pg.screenshot(path=os.path.join(OUT, 'jags-audits-mine.png'))
            ctx.close()
    br.close()
check(not errs, 'no script errors', errs[:3])
srv.terminate()
print('ALL PASS' if not fails else 'SOME FAILED: ' + ', '.join(fails))
