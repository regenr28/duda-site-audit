"""The audit list shows when each item's status last changed (and by whom, or by a rescan), and can sort by it.
Usage: python3 -I e2e_stwhen.py <app> <tests>"""
import json, os, subprocess, sys, urllib.request, urllib.error
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT = 3998, 8078
ADMIN, MEMBER = 'tokadmin1234567890abcdef', 'tokmember1234567890abcde'
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-stwhen.log'), 'w'), text=True)
assert srv.stdout.readline().strip() == 'READY'
fails = []
def check(ok, what, extra=''):
    print(('PASS ' if ok else 'FAIL ') + what, extra if not ok else '', flush=True)
    if not ok: fails.append(what)
def redis(*cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
def call(tok, path, body=None):
    req = urllib.request.Request(f'http://localhost:{APORT}{path}', data=json.dumps(body).encode() if body is not None else None, method='POST' if body is not None else 'GET',
                                 headers={'Cookie': 'dsa_sess=' + tok, 'Content-Type': 'application/json'})
    try: return 200, json.loads(urllib.request.urlopen(req, timeout=60).read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')
def F(i): return {'id': f'f{i}', 'num': i, 'code': 'TEXT_SPELLING', 'severity': 'warning', 'category': 'Content', 'message': 'Spelling mistake', 'path': '/', 'pages': ['/'], 'location': 'Body', 'selector': f'#x{i}', 'visibleOn': ['desktop'], 'found': 'teh'}
finds = [F(1), F(2), F(3), F(4)]
site = {'id': 's1', 'siteId': 'abc123', 'host': 'ed.multiscreensite.com', 'businessName': 'Velvet Auto Care', 'pages': [{'path': '/', 'title': 'Home'}], 'findings': finds, 'scan': {'state': 'complete', 'finishedAt': '2026-11-20T03:15:00Z', 'pages': 1}}
redis(['SET', 'dsa:site:s1', json.dumps(site)], ['HSET', 'dsa:fnum:s1', 'f1', '1', 'f2', '2', 'f3', '3', 'f4', '4'])

import time
from playwright.sync_api import sync_playwright
errors = []
try:
    s, me = call(ADMIN, '/api/auth?op=me'); adm = (me.get('me') or me.get('user') or me).get('email', '')
    # f4: closed by a rescan long ago (the record the rescan writes, with the old stamp copied along).
    redis(['HSET', 'dsa:fstate:s1', 'f4', json.dumps({'status': 'done', 'assignee': '', 'updatedBy': adm, 'updatedAt': '2026-11-20T09:05:00Z', 'auto': 'rescan-gone', 'stAt': '2026-11-01T10:00:00Z', 'stFor': 'open'})])
    call(ADMIN, '/api/store', {'op': 'patchFinding', 'siteId': 's1', 'findingIds': ['f1'], 'changes': {'status': 'done'}})
    time.sleep(1.2)
    call(ADMIN, '/api/store', {'op': 'patchFinding', 'siteId': 's1', 'findingIds': ['f2'], 'changes': {'status': 'false'}})
    st1 = json.loads(redis(['HGET', 'dsa:fstate:s1', 'f1'])[0])
    time.sleep(1.2)
    call(ADMIN, '/api/store', {'op': 'patchFinding', 'siteId': 's1', 'findingIds': ['f1'], 'changes': {'assignee': ''}})
    st1b = json.loads(redis(['HGET', 'dsa:fstate:s1', 'f1'])[0])
    check(st1.get('stAt') and st1.get('stFor') == 'done' and st1.get('stBy') == adm, 'changing the status stamps when, by whom, and for which status')
    check(st1b.get('stAt') == st1.get('stAt') and st1b.get('updatedAt') != st1.get('updatedAt'), 'changing only the assignee does not move the status time')
    s, site = call(ADMIN, '/api/store?op=site&id=s1')
    fx = {f['id']: f for f in site['findings']}
    check(fx['f4'].get('stAt') == '2026-11-20T09:05:00Z', 'an item closed by a rescan shows the rescan\'s time, not an older copied stamp')
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(viewport={'width': 1440, 'height': 1000})
        ctx.add_cookies([{'name': 'dsa_sess', 'value': ADMIN, 'domain': 'localhost', 'path': '/'}])
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(f'http://localhost:{APORT}/#/site/s1'); pg.wait_for_selector('#ffst', timeout=30000); time.sleep(0.6)
        pg.select_option('#ffst', 'all'); time.sleep(0.6)
        rows = pg.evaluate("() => [...document.querySelectorAll('#itemRows > tr')].map(r => [r.querySelector('td:nth-child(2)') && r.querySelector('td:nth-child(2)').innerText.split('\\n')[0], (r.querySelector('.st-when') || {}).innerText || ''])")
        print('   rows:', rows)
        R = {r[0]: r[1] for r in rows}
        check('Nov 27' in (R.get('#1') or '') and '\n' in (R.get('#1') or ''), 'a Done item shows the date and time, and who, under its status')
        check('fixed on rescan' in (R.get('#4') or '') and 'Nov 20' in (R.get('#4') or ''), 'an item closed by a rescan says "fixed on rescan" and when')
        check(not R.get('#3'), 'an item nobody has changed shows no date')
        pg.select_option('#ffsort', 'changed'); time.sleep(0.6)
        order = pg.evaluate("() => [...document.querySelectorAll('#itemRows > tr')].map(r => r.querySelector('td:nth-child(2)').innerText.split('\\n')[0])")
        print('   sorted:', order)
        check(order[:3] == ['#2', '#1', '#4'], 'Sort: last status change first puts the newest change on top')
        tip = pg.get_attribute('#itemRows .st-when', 'title') or ''
        check('on ' in tip, 'hovering shows the full date')
        pg.locator('table.findings').screenshot(path=os.path.join(OUT, 'stwhen.png'))
        br.close()
finally:
    srv.terminate()
check(not errors, 'no page errors ' + '; '.join(errors[:3]))
print('ALL PASS' if not fails else 'SOME FAILED'); sys.exit(1 if fails else 0)
