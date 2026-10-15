"""The backup copy (APP_COPY=1): same data, but no messages and no automatic jobs.
Usage: python3 -I e2e_copy.py <app> <tests>"""
import json, os, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT = 3998, 8078
env = dict(os.environ, APP_COPY='1', SLACK_BOT_TOKEN='xoxb-test', RESEND_API_KEY='re_test', DUDA_API_USERNAME='u', DUDA_API_PASSWORD='p')
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-copy.log'), 'w'), text=True, env=env)
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
    redis(['HSET', 'dsa:leadq', 'abc123', '1'], ['SET', 'dsa:cwdue', '5'])
    st, c = api('GET', '/api/auth?op=config')
    check(c.get('copy') is True and c.get('slackDM') is False and c.get('emailEnabled') is False, 'the copy says it is the copy; Slack and email are off even with keys set')
    st, p = api('POST', '/api/pulse', {'lastActive': '2026-10-13T00:00:00Z'})
    check(p['lq']['pending'] == 0 and p['wq'] == 0, 'the heartbeat never asks the copy to catch up')
    st, r = api('GET', '/api/dudasites?op=sweep')
    check('skipped' in r, 'the daily domain check does not run on the copy')
    st, r = api('GET', '/api/watch?op=cron')
    check('skipped' in r, 'the daily auto audit does not run on the copy')
    st, r = api('POST', '/api/watch', {'op': 'drain'})
    check(r.get('copy') and r.get('off'), 'the auto audit does not read websites from the copy')
    st, r = api('POST', '/api/leadq', {'op': 'drain'})
    check(r.get('skipped') == 'copy', 'form submissions are not fetched from the copy')
    st, r = api('GET', '/api/store?op=list')
    check(st == 200, 'the data is all there')
    with sync_playwright() as pw:
        br = pw.chromium.launch(); ctx = br.new_context(viewport={'width': 1280, 'height': 800})
        ctx.add_cookies([{'name': 'dsa_sess', 'value': TOK, 'domain': 'localhost', 'path': '/'}])
        errors = []; pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(f'http://localhost:{APORT}/#/'); pg.wait_for_selector('#copyBar', timeout=20000); time.sleep(1)
        check('Quiet copy' in pg.inner_text('#copyBar') and pg.title().startswith('[Copy]'), 'every page says it is the backup copy')
        pg.screenshot(path=os.path.join(OUT, 'copy-bar.png'), clip={'x': 0, 'y': 0, 'width': 1280, 'height': 200})
        check(not errors, 'no script errors ' + ' | '.join(errors[:2]))
        br.close()
finally:
    srv.terminate()
print('ALL PASS' if ok else 'SOME FAILED')
