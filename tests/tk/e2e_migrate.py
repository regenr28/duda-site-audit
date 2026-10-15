"""Moving the app: copy everything from an old database into the new app's own (Settings → Move data in).
Usage: python3 -I e2e_migrate.py <app> <tests>"""
import json, os, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT, SPORT = 3998, 8078, 8099
src = subprocess.Popen(['node', os.path.join(TESTS, 'fakeredis.mjs'), str(SPORT)], stdout=subprocess.DEVNULL)
time.sleep(2.5 if os.environ.get('FAKE_PG') else 0.6)
def rq(port, *cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{port}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
# the OLD database: a bit of everything, including a big hash and a key that expires
big = []
for i in range(1200): big += [f'f{i}', json.dumps({'n': i, 'pad': 'x' * 200})]
rq(SPORT, ['SET', 'dsa:dudasites', 'z1:packedlistdata'], ['HSET', 'dsa:index', 'old1', json.dumps({'id': 'old1', 'siteId': 'olddd1', 'businessName': 'Old Shine'})],
   ['SET', 'dsa:site:old1', json.dumps({'id': 'old1', 'siteId': 'olddd1', 'businessName': 'Old Shine', 'findings': []})],
   ['RPUSH', 'dsa:act:old1', 'a', 'b', 'c'], ['SADD', 'dsa:cwok:olddd1', 'phone:1', 'phone:2'], ['HSET', 'dsa:bighash', *big],
   ['SET', 'dsa:temp', 'soon', 'EX', '3600'],
   # form submissions (the slow-to-fetch history) and auto audit results
   *[['SET', f'dsa:lead:olddd1:{i}', json.dumps({'id': i, 'email': f'c{i}@x.com'})] for i in range(40)],
   ['SET', 'dsa:leadpack:olddd1:2026-09', 'z1:packedleads'], ['HSET', 'dsa:leadsum', 'olddd1', json.dumps({'total': 40})],
   ['HSET', 'dsa:leadq:done', 'olddd1', '1', 'olddd2', '1'],
   *[['SET', f'dsa:cw:site{i}', json.dumps({'at': 1, 'issues': []})] for i in range(25)],
   ['HSET', 'dsa:cwsum', *sum([[f'site{i}', json.dumps({'at': 1, 'n': 0})] for i in range(25)], [])],
   ['RPUSH', 'dsa:longlist', *[f'item{i}' for i in range(2500)]],
   ['SADD', 'dsa:users', 'reymark@8bitcreative.com'], ['SET', 'dsa:user:reymark@8bitcreative.com', json.dumps({'email': 'reymark@8bitcreative.com', 'name': 'Reymark (old)', 'role': 'admin', 'status': 'active'})])
env = dict(os.environ, COPY_FROM_URL=f'http://127.0.0.1:{SPORT}', COPY_FROM_TOKEN='readonly')
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-mig.log'), 'w'), text=True, env=env)
assert srv.stdout.readline().strip() == 'READY'
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
def api(tok, method, path, body=None):
    req = urllib.request.Request(f'http://localhost:{APORT}{path}', data=json.dumps(body).encode() if body is not None else None, method=method,
                                 headers={'Content-Type': 'application/json', 'Cookie': 'dsa_sess=' + tok})
    try:
        r = urllib.request.urlopen(req, timeout=90); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')
try:
    st, r = api('tokmember1234567890abcde', 'POST', '/api/migrate', {'op': 'run'})
    check(st == 403, 'only the app owner can move data in')
    before_src = rq(SPORT, ['DBSIZE'])[0]
    with sync_playwright() as pw:
        br = pw.chromium.launch(); ctx = br.new_context(viewport={'width': 1280, 'height': 900})
        ctx.add_cookies([{'name': 'dsa_sess', 'value': 'tokadmin1234567890abcdef', 'domain': 'localhost', 'path': '/'}])
        errors = []; pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(f'http://localhost:{APORT}/#/settings/move'); pg.wait_for_selector('#mvRun', timeout=20000)
        check('Move data in' in pg.inner_text('.set-nav'), 'the owner sees Settings → Move data in while COPY_FROM_* is set')
        pg.on('dialog', lambda d: d.accept())
        pg.click('#mvRun'); pg.wait_for_function("() => /Done/.test(document.querySelector('#setBody').textContent)", timeout=60000); time.sleep(0.3)
        txt = pg.inner_text('#setBody')
        check('Done' in txt and 'Copy everything again' in txt, 'it copies and says done: ' + txt.replace('\n', ' | ')[:200])
        rows = {r.split('\t')[0]: r for r in pg.inner_text('.mv-check tbody').split('\n')}
        print('   check table:', ' | '.join(rows.values()))
        fs = rows.get('Form submissions and contacts', ''); au = rows.get('Auto audit results', ''); ws = rows.get('Websites with an auto audit result', '')
        check(fs.split('\t')[1] == '43' and 'all here' in fs, 'the check shows every form submission record arrived: ' + fs)
        check(au.split('\t')[1] == '27' and 'all here' in au, 'the check shows every auto audit record arrived: ' + au)
        check(ws.startswith('Websites with an auto audit result\t25\t25'), 'and every website\'s auto audit result: ' + ws)
        check('missing' not in pg.inner_text('.mv-check'), 'nothing is missing')
        pg.screenshot(path=os.path.join(OUT, 'move-data.png'), clip={'x': 0, 'y': 0, 'width': 1280, 'height': 520})
        check(not errors, 'no script errors ' + ' | '.join(errors[:2]))
        br.close()
    t = lambda *c: rq(RPORT, *c)
    check(t(['GET', 'dsa:dudasites'])[0] == 'z1:packedlistdata', 'strings copied')
    check(json.loads(t(['HGET', 'dsa:index', 'old1'])[0])['businessName'] == 'Old Shine' and t(['HLEN', 'dsa:index'])[0] == 1, 'hashes copied (a record with the same name is replaced by the old one, as the button warns)')
    check(t(['LRANGE', 'dsa:act:old1', 0, -1])[0] == ['a', 'b', 'c'], 'lists copied in order')
    check(sorted(t(['SMEMBERS', 'dsa:cwok:olddd1'])[0]) == ['phone:1', 'phone:2'], 'sets copied')
    check(t(['HLEN', 'dsa:bighash'])[0] == 1200, 'a big record is copied whole (1,200 fields)')
    check(t(['LLEN', 'dsa:longlist'])[0] == 2500 and t(['LRANGE', 'dsa:longlist', 2499, 2499])[0] == ['item2499'], 'a long list is copied whole and in order (2,500 items)')
    check(t(['GET', 'dsa:lead:olddd1:39'])[0] and t(['HGET', 'dsa:leadq:done', 'olddd2'])[0] == '1', 'form submissions and the record of which websites were already fetched both arrive, so nothing is fetched again')
    ttl = t(['PTTL', 'dsa:temp'])[0]
    check(0 < ttl <= 3600000, 'expiry times are kept')
    check(json.loads(t(['GET', 'dsa:user:reymark@8bitcreative.com'])[0])['name'] == 'Reymark (old)', 'people come across as they were')
    check(rq(SPORT, ['DBSIZE'])[0] == before_src and rq(SPORT, ['GET', 'dsa:migrate:state'])[0] is None, 'the old database is only read, never written')
    # running it again picks up changes made in the old app since
    rq(SPORT, ['HSET', 'dsa:index', 'old2', json.dumps({'id': 'old2', 'siteId': 'x2', 'businessName': 'Later Co'})])
    st, r = api('tokadmin1234567890abcdef', 'POST', '/api/migrate', {'op': 'run', 'restart': True})
    check(r['state']['done'] and t(['HGET', 'dsa:index', 'old2'])[0], 'copying again picks up what changed in the old app')
    st, r = api('tokadmin1234567890abcdef', 'GET', '/api/migrate')
    check(r['configured'] and r['state']['done'], 'status reads back')
finally:
    srv.terminate(); src.terminate()
print('ALL PASS' if ok else 'SOME FAILED')
