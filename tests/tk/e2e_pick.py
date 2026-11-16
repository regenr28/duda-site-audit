"""Ticking audit items is instant (only the row, the select-all box and the bar change), and the bar still
works. Usage: python3 -I e2e_pick.py <app> <tests>"""
import json, os, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT = 3998, 8078
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-pick.log'), 'w'), text=True)
assert srv.stdout.readline().strip() == 'READY'
def redis(*cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
ADMIN = 'tokadmin1234567890abcdef'
N = 400
F = [{'id': f'f{i}', 'num': i + 1, 'code': 'PLACEHOLDER', 'severity': 'warning' if i % 3 else 'critical', 'category': 'Content', 'message': f'Item number {i + 1} on the page',
      'found': f'text {i}', 'path': f'/page-{i % 20}', 'device': 'desktop', 'devices': ['desktop'], 'visibleOn': ['desktop'], 'selector': f'[id="x{i}"]', 'location': 'Body', 'status': 'open', 'visible': True} for i in range(N)]
site = json.loads(redis(['GET', 'dsa:site:s1'])[0])
site.update({'findings': F, 'scan': {'state': 'complete', 'finishedAt': '2026-11-16T10:00:00Z', 'startedAt': '2026-11-16T09:50:00Z', 'pages': 20}})
redis(['SET', 'dsa:site:s1', json.dumps(site)])
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
errors = []
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx = br.new_context(viewport={'width': 1440, 'height': 1000}); ctx.add_cookies([{'name': 'dsa_sess', 'value': ADMIN, 'domain': 'localhost', 'path': '/'}])
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(f'http://localhost:{APORT}/#/site/s1'); pg.wait_for_selector('table.findings [data-pick]', timeout=20000); time.sleep(1)
        n = pg.locator('table.findings [data-pick]').count(); print('  rows:', n, flush=True)
        ms = pg.evaluate("""async () => { const t0 = performance.now(); const cbs = [...document.querySelectorAll('table.findings [data-pick]')].slice(0, 10);
          for (const cb of cbs) { cb.click(); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); } return performance.now() - t0; }""")
        print(f'  10 ticks took {ms:.0f} ms', flush=True)
        check(ms < 1500, f'ticking 10 items is quick ({ms:.0f} ms for all 10)')
        check('10 selected' in pg.inner_text('#bulkBar') and pg.locator('tr.picked').count() == 10, 'the bar says 10 selected and the 10 rows are marked')
        pg.locator('table.findings [data-pick]').nth(0).click(); time.sleep(0.2)
        check('9 selected' in pg.inner_text('#bulkBar'), 'unticking one updates the bar')
        pg.select_option('#bulkSt', 'hold'); time.sleep(2)
        site2 = pg.evaluate("async () => (await (await fetch('/api/store?op=site&id=s1')).json())")
        byid = {f['id']: f['status'] for f in site2['findings']}
        st = [byid[f'f{i}'] for i in range(10)]
        print('  statuses:', st, flush=True)
        check(st[0] == 'open' and st[1:10] == ['hold'] * 9, 'Set status on the bar changes exactly the 9 ticked items')
        pg.wait_for_selector('#pickAll'); time.sleep(0.5); n2 = pg.locator('table.findings [data-pick]').count()
        pg.click('#pickAll'); time.sleep(0.3)
        check(f'{n2} selected' in pg.inner_text('#bulkBar'), f'select all ticks every item shown ({n2})')
        pg.click('#bulkClear'); time.sleep(0.3)
        check(pg.locator('#bulkBar.bulkbar').count() == 0 and pg.locator('tr.picked').count() == 0 and not pg.is_checked('#pickAll'), 'Clear selection empties it')
        check(not errors, 'no script errors ' + ' | '.join(errors[:3]))
        br.close()
except Exception:
    import traceback; traceback.print_exc(); ok = False
finally:
    srv.terminate()
    for pat in ['[f]ixsite.mjs', '[f]akeredis.mjs', '[d]ev-server.js']: subprocess.run(['pkill', '-f', pat])
print('ALL PASS' if ok else 'SOME FAILED')
