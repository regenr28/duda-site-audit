"""The scan line says what each job is and who started it: an AI check the app resumed by itself in an open tab is
"started automatically in …'s open tab", never "added by" that person; no "A website"; no "older version" guess.
Usage: python3 -I e2e_scanline_auto.py <app> <tests>"""
import json, os, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT = 3998, 8078
ADMIN_TOK, MEMBER_TOK = 'tokadmin1234567890abcdef', 'tokmember1234567890abcde'
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-scanline.log'), 'w'), text=True)
assert srv.stdout.readline().strip() == 'READY'
def redis(*cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
def api(body, tok):
    req = urllib.request.Request(f'http://localhost:{APORT}/api/store', data=json.dumps(body).encode(), method='POST', headers={'Cookie': 'dsa_sess=' + tok, 'Content-Type': 'application/json'})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
errors = []
try:
    # The member's open tab resumes an AI check by itself; the same tab is told why.
    r = api({'op': 'scanClaim', 'ids': ['s2'], 'cid': 'tab-member', 'state': 'scanning', 'k': 'ai', 'auto': True,
             'm': {'s2': {'why': 'AI credits came back: the paused AI check carries on by itself'}}, 'p': {'done': 0, 'total': 0, 'msg': 'Running the AI check'}}, MEMBER_TOK)
    c = json.loads(redis(['HGET', 'dsa:scanclaims', 's2'])[0])
    check(r['ok'] == ['s2'] and c.get('k') == 'ai' and c.get('auto') is True and 'AI credits' in c.get('why', ''), 'the claim keeps what it is (AI check), that the app started it, and why')
    # An audit nobody named yet, scanned by hand.
    redis(['SET', 'dsa:site:s9', json.dumps({'id': 's9', 'siteId': 'f00dcafe', 'host': 'ed.multiscreensite.com', 'findings': []})],
          ['HSET', 'dsa:index', 's9', json.dumps({'id': 's9', 'siteId': 'f00dcafe', 'businessName': ''})])
    api({'op': 'scanClaim', 'ids': ['s9'], 'cid': 'tab-member2', 'state': 'scanning', 'k': 'manual', 'm': {'s9': {'why': 'Rescan clicked'}}}, MEMBER_TOK)
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(viewport={'width': 1440, 'height': 1000})
        ctx.add_cookies([{'name': 'dsa_sess', 'value': ADMIN_TOK, 'domain': 'localhost', 'path': '/'}])
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(f'http://localhost:{APORT}/#/'); pg.wait_for_selector('#btnScans:not([hidden])', timeout=30000); time.sleep(0.5)
        pg.click('#btnScans'); time.sleep(1.2)
        txt = pg.inner_text('#modalRoot')
        print('   line:', txt.replace('\n', ' | ')[:900])
        check('Automatic · ✨ AI check' in txt and 'started automatically in Dana Dev’s open tab' in txt, 'the AI check is shown as automatic, running in that person’s open tab')
        check('added by Dana Dev' not in txt.split('Other Co')[1].split('Site f00dcafe')[0] if 'Other Co' in txt and 'Site f00dcafe' in txt else 'added by Dana Dev · Why: AI' not in txt, 'it never says that person added it')
        check('older version' not in txt and 'kind not known' not in txt, 'no guess about an older version of the app')
        check('A website' not in txt and 'Site f00dcafe' in txt, 'an audit without a business name shows its site id, not "A website"')
        check('By hand · Rescan' in txt and 'added by Dana Dev' in txt, 'a Rescan by a person still says who added it')
        pg.screenshot(path=os.path.join(OUT, 'scanline-auto.png'))
        br.close()
finally:
    srv.terminate()
check(not errors, 'no page errors ' + '; '.join(errors[:3]))
print('ALL PASS' if ok else 'SOME FAILED'); sys.exit(0 if ok else 1)
