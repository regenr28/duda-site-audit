"""Items never double: an AI-check resume that sends the auto audit's and hand-written items back does not add
copies, and a website already saved with copies shows each item once. Usage: python3 -I e2e_dupe.py <app> <tests>"""
import json, os, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT = 3998, 8078
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-dupe.log'), 'w'), text=True)
assert srv.stdout.readline().strip() == 'READY'
def redis(*cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
live = {'id': 'live-abc', 'code': 'AUTO_LIVE', 'manual': True, 'liveKey': 'phone:2393009985', 'severity': 'critical', 'category': 'Auto audit (live website)', 'message': 'Phone number that is not theirs: (239) 300-9985', 'found': '(239) 300-9985', 'path': '/', 'pages': ['/']}
hand = {'id': 'hand-1', 'code': 'MANUAL', 'manual': True, 'severity': 'warning', 'category': 'Content', 'message': 'Logo is blurry', 'path': '/', 'by': 'x', 'byName': 'QA'}
scan = {'id': 'scan-1', 'code': 'PLACEHOLDER', 'severity': 'warning', 'category': 'Content', 'message': 'Placeholder', 'path': '/', 'selector': 'p'}
pend = {'id': 'pend-1', 'code': 'AI_PENDING_TEXT', 'severity': 'info', 'category': 'AI', 'message': 'AI check pending', 'path': '/', 'aiPending': {'items': []}}
site = json.loads(redis(['GET', 'dsa:site:s1'])[0])
site.update({'findings': [scan, pend, hand] + [live] * 64, 'scan': {'state': 'complete', 'finishedAt': '2026-11-16T10:00:00Z', 'pages': 1}})
redis(['SET', 'dsa:site:s1', json.dumps(site)])
try:
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(); ctx.add_cookies([{'name': 'dsa_sess', 'value': 'tokadmin1234567890abcdef', 'domain': 'localhost', 'path': '/'}])
        pg = ctx.new_page(); pg.goto(f'http://localhost:{APORT}/#/'); pg.wait_for_selector('table.grid', timeout=20000)
        S = pg.evaluate("async () => (await (await fetch('/api/store?op=site&id=s1')).json())")
        ids = [f['id'] for f in S['findings']]
        check(ids.count('live-abc') == 1 and len(ids) == 4, f'a website saved with 64 copies of an item shows it once ({len(ids)} items)')
        # What an "AI check resumed" used to send back: every item, including the hand-written and auto-audit ones.
        sent = [dict(f) for f in S['findings'] if f['code'] != 'AI_PENDING_TEXT']
        for _ in range(3):
            pg.evaluate("async (f) => fetch('/api/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'saveScan', mode: 'aiResume', id: 's1', result: { findings: f, scan: { state: 'complete', pages: 1 } } }) })", sent)
        S2 = pg.evaluate("async () => (await (await fetch('/api/store?op=site&id=s1')).json())")
        ids2 = [f['id'] for f in S2['findings']]
        print('  after 3 saves:', ids2, flush=True)
        check(ids2.count('live-abc') == 1 and ids2.count('hand-1') == 1 and ids2.count('scan-1') == 1, 'three resumed AI checks later, each item is still there once')
        raw = redis(['GET', 'dsa:site:s1'])[0]
        check(len(json.loads(raw)['findings'] if raw.startswith('{') else []) < 10 or not raw.startswith('{'), 'the stored record was tidied too')
        br.close()
except Exception:
    import traceback; traceback.print_exc(); ok = False
finally:
    srv.terminate()
    for pat in ['[f]ixsite.mjs', '[f]akeredis.mjs', '[d]ev-server.js']: subprocess.run(['pkill', '-f', pat])
print('ALL PASS' if ok else 'SOME FAILED')
