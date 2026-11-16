"""Why a website is "Queued": the scan strip says what the tab is busy with, a queued website can be taken
out of the line, and another member sees how far somebody else's scan has got. Usage: python3 -I e2e_queue.py <app> <tests>"""
import json, os, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT = 3998, 8078
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-queue.log'), 'w'), text=True)
assert srv.stdout.readline().strip() == 'READY'
def redis(*cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
ADMIN, MEMBER = 'tokadmin1234567890abcdef', 'tokmember1234567890abcde'
# A third website, so one has to wait (a tab scans two at a time).
redis(['SET', 'dsa:site:s3', json.dumps({'id': 's3', 'siteId': 'ccc333', 'host': 'ed.multiscreensite.com', 'businessName': 'Third Shop', 'findings': []})],
      ['HSET', 'dsa:index', 's3', json.dumps({'id': 's3', 'siteId': 'ccc333', 'businessName': 'Third Shop'})])
HELD = []   # page reads held back, so the two scans stay busy
META = lambda sid: {'host': 'ed.multiscreensite.com', 'siteId': sid, 'site': {'site_business_info': {'business_name': 'Shop'}}, 'content': {}, 'pages': [{'path': '/', 'title': 'Home'}], 'errors': []}
def route(r):
    p = r.request.url.split('?')[0]
    if p.endswith('/api/fetch'): HELD.append(r); return
    if p.endswith('/api/site'): return r.fulfill(status=200, content_type='application/json', body=json.dumps(META('x')))
    return r.continue_()
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
errors = []
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx = br.new_context(viewport={'width': 1440, 'height': 1000}); ctx.add_cookies([{'name': 'dsa_sess', 'value': ADMIN, 'domain': 'localhost', 'path': '/'}])
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('dialog', lambda d: d.accept())
        pg.route('**/api/fetch**', route); pg.route('**/api/site**', route)
        pg.goto(f'http://localhost:{APORT}/#/'); pg.wait_for_selector('#rescanAll', timeout=20000); time.sleep(1)
        pg.click('#rescanAll')
        for _ in range(40):
            time.sleep(0.5)
            if len(HELD) >= 2: break
        pg.goto(f'http://localhost:{APORT}/#/site/s3'); pg.wait_for_selector('#scanStrip', timeout=15000); time.sleep(0.8)
        strip = pg.inner_text('#scanStrip')
        print('  strip:', strip.replace(chr(10), ' | ')[:300], flush=True)
        check('Waiting its turn' in strip and '2 websites at a time' in strip and 'Buff & Beyond' in strip and 'Other Co' in strip, 'a queued website says why: the tab is busy with two other websites, named')
        check(pg.inner_text('.sh-meta').count('Queued') == 1 and 'Scanning now' not in pg.inner_text('.sh-meta'), 'the header says Queued, not Scanning now')
        pg.screenshot(path=os.path.join(OUT, 'queue-why.png'))
        pg.click('[data-cancelq="s3"]'); time.sleep(0.8)
        check(pg.locator('#scanStrip').count() == 0 and not pg.is_disabled('#sRescan'), 'Take it out of the line: the website is no longer queued and Rescan is back')
        # Another tab opens a website this tab is scanning (a member who can see it reads "<name> is scanning it in their browser"): they see who, and how far it has got.
        # (The heartbeat says it every 30 seconds; here it is sent once straight away.)
        cid = pg.evaluate("() => { const c = [...document.querySelectorAll('*')].length; return null; }")
        claims = pg.evaluate("async () => (await (await fetch('/api/store?op=list')).json()).claims")
        mycid = (claims.get('s1') or {}).get('cid')
        pg.evaluate("async (cid) => fetch('/api/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'scanClaim', ids: ['s1'], cid, state: 'scanning', p: { done: 7, total: 18, msg: '/about · Desktop' } }) })", mycid)
        ctx2 = br.new_context(viewport={'width': 1440, 'height': 1000}); ctx2.add_cookies([{'name': 'dsa_sess', 'value': ADMIN, 'domain': 'localhost', 'path': '/'}])
        pg2 = ctx2.new_page(); pg2.on('pageerror', lambda e: errors.append('member: ' + str(e)))
        pg2.goto(f'http://localhost:{APORT}/#/site/s1'); pg2.wait_for_selector('#scanStrip', timeout=20000); time.sleep(0.8)
        s2 = pg2.inner_text('#scanStrip')
        print('  member sees:', s2.replace(chr(10), ' | ')[:300], flush=True)
        check('Your other tab is scanning it:' in s2 and '7/18' in s2 and '/about' in s2, 'another tab (or member) sees who is scanning it and how far it has got')
        check('runs out by itself' in s2, 'and what happens if that tab was closed')
        pg2.screenshot(path=os.path.join(OUT, 'queue-other.png'))
        pg2.goto(f'http://localhost:{APORT}/#/'); pg2.wait_for_selector('table.grid', timeout=15000); time.sleep(0.8)
        row = pg2.inner_text('table.grid tbody tr:has-text("Buff & Beyond")')
        check('7/18' in row, 'the Audits list shows the other scan\'s progress too')
        for r in HELD:
            try: r.abort()
            except Exception: pass
        check(not errors, 'no script errors ' + ' | '.join(errors[:3]))
        br.close()
except Exception:
    import traceback; traceback.print_exc(); ok = False
finally:
    srv.terminate()
    for pat in ['[f]ixsite.mjs', '[f]akeredis.mjs', '[d]ev-server.js']: subprocess.run(['pkill', '-f', pat])
print('ALL PASS' if ok else 'SOME FAILED')
