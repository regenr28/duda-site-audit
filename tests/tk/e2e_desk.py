import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]; OUT = os.path.join(TESTS, 'tk')
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
assert srv.stdout.readline().strip() == 'READY'
ok = True
def check(c, l):
    global ok; print(('PASS ' if c else 'FAIL ') + l, flush=True); ok = ok and bool(c)
errs = []
try:
  with sync_playwright() as p:
    br = p.chromium.launch()
    for scheme in ['light', 'dark']:
        cx = br.new_context(viewport={'width': 1366, 'height': 820}, color_scheme=scheme)
        cx.add_cookies([{'name': 'dsa_sess', 'value': 'tokadmin1234567890abcdef', 'domain': 'localhost', 'path': '/'}])
        pg = cx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
        # an admin previewing as the client
        pg.goto('http://localhost:3998/#/site/s1/profile'); time.sleep(1.5)
        pg.evaluate("() => { }")
        pg.goto('http://localhost:3998/#/'); time.sleep(1)
        # use View as client through the app's state: open profile, click the button
        pg.goto('http://localhost:3998/#/site/s1/profile'); pg.wait_for_selector('#pfView', timeout=15000); pg.click('#pfView')
        pg.wait_for_selector('.cl-cta', timeout=15000)
        pg.click('.cl-cta [data-sendticket]'); pg.wait_for_selector('[data-tkt="change"]'); pg.click('[data-tkt="change"]')
        pg.wait_for_function("() => document.querySelector('#mkFrame') && document.querySelector('#mkFrame').src", timeout=10000)
        pg.frame_locator('#mkFrame').locator('h1').first.wait_for(timeout=20000)
        pg.click('[data-tool="ellipse"]'); time.sleep(0.6)
        check('Preview' in pg.inner_text('#mkQuota'), f'[{scheme}] previewing says nothing is sent: ' + pg.inner_text('#mkQuota'))
        pg.click('[data-tool="ellipse"]')
        st = pg.locator('#mkStage').bounding_box()
        pg.mouse.move(st['x'] + 300, st['y'] + 150); pg.mouse.down(); pg.mouse.move(st['x'] + 500, st['y'] + 260, steps=6); pg.mouse.up()
        pg.wait_for_selector('#mkCompose:not([hidden])')
        check(pg.is_disabled('[data-c="send"]'), f'[{scheme}] Send is off while previewing')
        pg.fill('#mkText', 'Circle this')
        pg.mouse.wheel(0, 600); time.sleep(0.3)
        pg.keyboard.down('Control'); pg.mouse.wheel(0, -300); pg.keyboard.up('Control'); time.sleep(0.4)
        pg.screenshot(path=os.path.join(OUT, f'shot-desk-{scheme}.png'))
        pg.keyboard.press('Escape'); pg.keyboard.press('Escape'); pg.keyboard.press('Escape'); time.sleep(0.3)
        check(not pg.locator('#mkRoot').count(), f'[{scheme}] Escape closes the marking screen')
        cx.close()
    check(not errs, 'no script errors ' + str(errs))
finally:
    srv.terminate()
    for pat in ['[f]ixsite.mjs', '[f]akeredis.mjs', '[d]ev-server.js']: subprocess.run(['pkill', '-f', pat])
print('ALL PASS' if ok else 'SOME FAILED')
