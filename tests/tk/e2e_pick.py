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
site.update({'pages': [{'path': '/page-4', 'blog': True, 'title': 'A blog post'}], 'findings': F, 'scan': {'state': 'complete', 'finishedAt': '2026-11-16T10:00:00Z', 'startedAt': '2026-11-16T09:50:00Z', 'pages': 20}})
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
        # Duda says the website is published at www.buffandbeyond.com.
        ctx.route('**/api/site?light=1*', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps({'siteId': 'abc123', 'domain': 'www.buffandbeyond.com', 'publishStatus': 'PUBLISHED'})))
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(f'http://localhost:{APORT}/#/site/s1'); pg.wait_for_selector('table.findings [data-pick]', timeout=20000); time.sleep(1)
        # Opening the tab draws the first rows at once and the rest right after, in batches.
        pg.goto(f'http://localhost:{APORT}/#/site/s1/report'); pg.wait_for_selector('.tabs a.on', timeout=15000); time.sleep(0.5)
        tab_ms = pg.evaluate("""async () => { const t0 = performance.now(); location.hash = '#/site/s1'; await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return performance.now() - t0; }""")
        first = pg.locator('table.findings [data-pick]').count()
        print(f'  Audit items tab drawn in {tab_ms:.0f} ms with {first} rows first', flush=True)
        check(tab_ms < 400 and 0 < first < N, f'switching to Audit items is quick ({tab_ms:.0f} ms): the first {first} rows come first')
        for _ in range(40):
            time.sleep(0.25)
            if pg.locator('table.findings [data-pick]').count() >= N: break
        n = pg.locator('table.findings [data-pick]').count(); print('  rows:', n, flush=True)
        ms = pg.evaluate("""async () => { const t0 = performance.now(); const cbs = [...document.querySelectorAll('table.findings [data-pick]')].slice(0, 10);
          for (const cb of cbs) { cb.click(); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); } return performance.now() - t0; }""")
        print(f'  10 ticks took {ms:.0f} ms', flush=True)
        check(n == N, f'and all {N} rows follow by themselves ({n})')
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
        # Status in the item panel: lit up at once, saved behind it, and the page does not reload the website.
        pg.goto(f'http://localhost:{APORT}/#/site/s1/item/12'); pg.wait_for_selector('#drawer [data-set="done"]', timeout=15000); time.sleep(0.8)
        loads = []; pg.on('request', lambda r: loads.append(r.url) if 'op=site&' in r.url else None)
        ms = pg.evaluate("""async () => { const t0 = performance.now(); document.querySelector('#drawer [data-set="done"]').click();
          await new Promise((r) => requestAnimationFrame(r)); const on = document.querySelector('#drawer [data-set="done"]').classList.contains('on'); return on ? performance.now() - t0 : -1; }""")
        print(f'  Done lit up after {ms:.0f} ms', flush=True)
        check(0 <= ms < 150, f'clicking Done lights it up at once ({ms:.0f} ms)')
        time.sleep(1.5)
        reloaded = [u for u in loads if 'op=site&' in u]
        pass
        site3 = pg.evaluate("async () => (await (await fetch('/api/store?op=site&id=s1')).json())")
        check({f['id']: f['status'] for f in site3['findings']}['f11'] == 'done', 'and it is saved')
        check(not reloaded, 'without reloading the whole website afterwards: ' + str(reloaded[:2]))
        check('Reymark' in pg.inner_text('#drawer') and 'Done' in pg.inner_text('#drawer .sbtn.on'), 'the panel shows Done and who changed it')
        # A save that fails puts it back and says so.
        pg.route('**/api/store', lambda r: r.fulfill(status=500, content_type='application/json', body='{"error":"Database unavailable"}') if r.request.method == 'POST' and 'patchFinding' in (r.request.post_data or '') else r.continue_())
        pg.click('#drawer [data-set="hold"]'); time.sleep(1.5)
        check('Done' in pg.inner_text('#drawer .sbtn.on') and 'Save failed' in pg.inner_text('#toast'), 'a failed save goes back to Done and says it failed: ' + pg.inner_text('#toast')[:80])
        pg.unroute('**/api/store')
        # Show in editor: the first opens a tab, the next item reuses that same tab.
        ctx.route('https://ed.multiscreensite.com/**', lambda r: r.fulfill(status=200, content_type='text/html', body='<html><body>Duda editor ' + r.request.url + '</body></html>'))
        pg.goto(f'http://localhost:{APORT}/#/site/s1/item/2'); pg.wait_for_selector('#drawer [data-editat]', timeout=15000); time.sleep(0.5)
        with ctx.expect_page() as newp: pg.locator('#drawer [data-editat]').first.click()
        ed = newp.value; ed.wait_for_url('**/page-1', timeout=10000); time.sleep(0.5)
        u1 = ed.url
        pg.bring_to_front(); pg.goto(f'http://localhost:{APORT}/#/site/s1/item/5'); pg.wait_for_selector('#drawer [data-editat]', timeout=15000); time.sleep(0.5)
        pg.locator('#drawer [data-editat]').first.click()
        try: ed.wait_for_url('**/blog/page-4', timeout=10000)
        except Exception: pass
        time.sleep(0.5)
        print('  editor tabs:', [x.url for x in ctx.pages], flush=True)
        check(len(ctx.pages) == 2 and ed.url != u1 and '/page-4' in ed.url and '/page-1' in u1, 'Show in editor on the next item loads it in the same editor tab (no new tab)')
        check(ed.url.endswith('/home/site/abc123/blog/page-4') and u1.endswith('/home/site/abc123/page-1'), 'a blog post opens in the editor under /blog/<post>; a normal page does not: ' + ed.url)
        # Show on live: the page on the published website, at the element, in its own tab.
        ctx.route('https://www.buffandbeyond.com/**', lambda r: r.fulfill(status=200, content_type='text/html', body='<html><body>Live site</body></html>'))
        pg.bring_to_front(); pg.goto(f'http://localhost:{APORT}/#/site/s1/item/2'); pg.wait_for_selector('#drawer [data-liveat]', timeout=15000); time.sleep(0.5)
        with ctx.expect_page() as lp: pg.locator('#drawer [data-liveat]').first.click()
        lv = lp.value; lv.wait_for_load_state(); time.sleep(0.5)
        print('  live:', lv.url, flush=True)
        check(lv.url.startswith('https://www.buffandbeyond.com/page-1#dsa=') and 'x1' in lv.url, 'Show on live opens the page on the published website, with the element to outline: ' + lv.url[:90])
        lv.close()
        # And Show on preview does the same with its own tab.
        pg.locator('#drawer [data-prevat]').first.click(); time.sleep(1)
        n3 = len(ctx.pages)
        pg.goto(f'http://localhost:{APORT}/#/site/s1/item/2'); pg.wait_for_selector('#drawer [data-prevat]', timeout=15000); time.sleep(0.5)
        pg.locator('#drawer [data-prevat]').first.click(); time.sleep(1)
        check(n3 == 3 and len(ctx.pages) == 3, f'Show on preview reuses its own preview tab too ({len(ctx.pages)} tabs)')
        check(not errors, 'no script errors ' + ' | '.join(errors[:3]))
        br.close()
except Exception:
    import traceback; traceback.print_exc(); ok = False
finally:
    srv.terminate()
    for pat in ['[f]ixsite.mjs', '[f]akeredis.mjs', '[d]ev-server.js']: subprocess.run(['pkill', '-f', pat])
print('ALL PASS' if ok else 'SOME FAILED')
