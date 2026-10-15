"""The auto audit's own mistakes are corrected on what is already stored: no rescan, no recheck.
A "Service" schema taken for another business name: its finding goes, its audit item closes as False alarm
(the app's mistake), the daily report forgets it, the website is lined up for a re-read; a real finding stays.
Usage: python3 -I e2e_fix.py <app> <tests>"""
import json, os, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT = 3998, 8078
env = dict(os.environ, DUDA_API_USERNAME='u', DUDA_API_PASSWORD='p')
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-fix.log'), 'w'), text=True, env=env)
assert srv.stdout.readline().strip() == 'READY'
TOK = 'tokadmin1234567890abcdef'
def api(method, path, body=None):
    req = urllib.request.Request(f'http://localhost:{APORT}{path}', data=json.dumps(body).encode() if body is not None else None, method=method,
                                 headers={'Content-Type': 'application/json', 'Cookie': 'dsa_sess=' + TOK})
    try:
        r = urllib.request.urlopen(req, timeout=60); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')
def redis(*cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
try:
    svc = {'k': 'name:mobile car detailing', 'type': 'name', 'value': 'Mobile Car Detailing in Kansas City, MO', 'sev': 'critical', 'label': 'Google business data (schema) names a different business', 'ctx': 'Service', 'pages': ['/mobile-detailing'], 'n': 1}
    real = {'k': 'name:joes auto spa', 'type': 'name', 'value': "Joe's Auto Spa", 'sev': 'critical', 'label': 'Copyright line names a different business', 'ctx': "© 2024 Joe's Auto Spa", 'pages': ['/'], 'n': 1}
    lbiz = {'k': 'name:other shine llc', 'type': 'name', 'value': 'Other Shine LLC', 'sev': 'critical', 'label': 'Google business data (schema) names a different business', 'ctx': 'LocalBusiness', 'pages': ['/'], 'n': 1}
    result = {'at': int(time.time() * 1000), 'pub': '2026-10-01T00:00:00Z', 'domain': 'buffandbeyond.com', 'name': 'Buff & Beyond', 'pages': 3, 'issues': [svc, real, lbiz]}
    item = lambda iid, i: {'id': iid, 'code': 'AUTO_LIVE', 'manual': True, 'liveKey': i['k'], 'liveType': 'name', 'severity': 'critical', 'category': 'Auto audit (live website)',
                           'message': 'Business name that is not theirs: ' + i['value'], 'found': i['value'], 'detail': i['label'], 'path': i['pages'][0], 'pages': i['pages'],
                           'autoLive': {'at': '2026-10-13T00:00:00Z', 'pub': '', 'first': '2026-10-13T00:00:00Z'}, 'by': '', 'byName': 'Auto audit', 'at': '2026-10-13T00:00:00Z'}
    site = {'id': 's1', 'siteId': 'abc123', 'host': 'ed.multiscreensite.com', 'businessName': 'Buff & Beyond', 'findings': [item('live-svc', svc), item('live-real', real), item('live-lb', lbiz)]}
    redis(['SET', 'dsa:cw:abc123', json.dumps(result)],
          ['HSET', 'dsa:cwsum', 'abc123', json.dumps({'v': 3, 'at': result['at'], 'pubAt': 1, 'n': 3, 'c': 3, 't': {'name': 3}, 'pages': 3}),
           'zzz999', json.dumps({'v': 3, 'at': result['at'], 'pubAt': 1, 'n': 1, 'c': 1, 't': {'phone': 1}, 'pages': 2})],
          ['HSET', 'dsa:cwnew', 'abc123', json.dumps({'name': 'Buff & Beyond', 'n': 3, 'c': 3, 't': {'name': 3}, 'recId': 's1'})],
          ['SET', 'dsa:site:s1', json.dumps(site)], ['HSET', 'dsa:fnum:s1', 'live-svc', '1', 'live-real', '2', 'live-lb', '3'], ['SET', 'dsa:seq:s1', '3'],
          ['HSET', 'dsa:fstate:s1', 'live-svc', json.dumps({'status': 'open', 'assignee': 'dev@8bitcreative.com'}), 'live-real', json.dumps({'status': 'open'}), 'live-lb', json.dumps({'status': 'open'})],
          ['SET', 'dsa:cwcfg', json.dumps({'off': True})])
    st, live = api('GET', '/api/watch?op=live')
    check(st == 200, 'the status panel answers')
    r = json.loads(redis(['GET', 'dsa:cw:abc123'])[0])
    check([x['k'] for x in r['issues']] == ['name:joes auto spa', 'name:other shine llc'], 'the "Service" finding is gone from the result; the real ones stay: ' + ','.join(x['k'] for x in r['issues']))
    sm = json.loads(redis(['HGET', 'dsa:cwsum', 'abc123'])[0])
    check(sm['n'] == 2 and sm['c'] == 2 and sm['t'] == {'name': 2} and sm.get('relook'), 'the DR Websites counts are corrected and the website is lined up for a re-read: ' + json.dumps(sm))
    nw = json.loads(redis(['HGET', 'dsa:cwnew', 'abc123'])[0])
    check(nw['n'] == 2 and nw['t'] == {'name': 2}, 'the waiting daily report no longer counts it: ' + json.dumps(nw))
    fs = {k: json.loads(v) for k, v in zip(*[iter(redis(['HGETALL', 'dsa:fstate:s1'])[0])] * 2)}
    check(fs['live-svc']['status'] == 'false' and fs['live-svc']['auto'] == 'app-fix' and fs['live-svc'].get('assignee') == 'dev@8bitcreative.com', 'its audit item closed itself as False alarm, marked as the app\'s mistake (assignee kept)')
    check(fs['live-real']['status'] == 'open' and fs['live-lb']['status'] == 'open', 'the real business-name items stay open')
    acts = [json.loads(a) for a in redis(['LRANGE', 'dsa:act:s1', 0, 5])[0]]
    check(any('own mistake' in a.get('text', '') for a in acts), 'the activity log says why: ' + (acts[0]['text'] if acts else ''))
    check(redis(['GET', 'dsa:cwfix:svc-schema-1'])[0] == 'done', 'the correction is recorded as done')
    other = json.loads(redis(['HGET', 'dsa:cwsum', 'zzz999'])[0])
    check(not other.get('relook') and other['t'] == {'phone': 1}, 'websites without the mistake are untouched')
    # Running again changes nothing.
    redis(['HSET', 'dsa:fstate:s1', 'live-real', json.dumps({'status': 'done'})])
    api('GET', '/api/watch?op=live')
    fs2 = {k: json.loads(v) for k, v in zip(*[iter(redis(['HGETALL', 'dsa:fstate:s1'])[0])] * 2)}
    check(fs2['live-real']['status'] == 'done' and len([a for a in redis(['LRANGE', 'dsa:act:s1', 0, 20])[0] if 'own mistake' in a]) == 1, 'it runs once')
    with sync_playwright() as pw:
        br = pw.chromium.launch(); ctx = br.new_context(viewport={'width': 1280, 'height': 900})
        ctx.add_cookies([{'name': 'dsa_sess', 'value': TOK, 'domain': 'localhost', 'path': '/'}])
        pg = ctx.new_page(); errors = []; pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(f'http://localhost:{APORT}/#/site/s1/item/1'); pg.wait_for_selector('text=got this one wrong', timeout=20000); time.sleep(0.8)
        t = pg.inner_text('body')
        check('the auto audit got this one wrong' in t, 'the item says the app got it wrong')
        pg.screenshot(path=os.path.join(OUT, 'fix-item.png'))
        check(not errors, 'no script errors ' + ' | '.join(errors[:2]))
        br.close()
finally:
    srv.terminate()
print('ALL PASS' if ok else 'SOME FAILED')
