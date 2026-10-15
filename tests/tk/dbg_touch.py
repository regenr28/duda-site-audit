import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
srv = subprocess.Popen(['node', os.path.join(TESTS, 'tk', 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
assert srv.stdout.readline().strip() == 'READY'
try:
  with sync_playwright() as p:
    br = p.chromium.launch()
    ph = br.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    ph.add_cookies([{'name': 'dsa_sess', 'value': 'tokclient1234567890abcde', 'domain': 'localhost', 'path': '/'}])
    pg = ph.new_page()
    pg.goto('http://localhost:3998/#/my/s1/mark')
    pg.wait_for_selector('#mkWorld img[src]', timeout=60000); time.sleep(1)
    pg.evaluate("() => { window.__ev = []; ['pointerdown','pointermove','pointerup','pointercancel'].forEach(t => document.addEventListener(t, e => window.__ev.push(t + ':' + e.pointerId + ':' + e.pointerType + ':' + (e.target.id||e.target.className||e.target.tagName)), true)); }")
    cdp = ph.new_cdp_session(pg)
    x, y = 150, 400
    print('transform0', pg.evaluate("() => document.querySelector('#mkWorld').style.transform"))
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x - 30, 'y': y, 'id': 1}, {'x': x + 30, 'y': y, 'id': 2}]})
    for k in range(1, 6): cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x - 30 - k * 20, 'y': y, 'id': 1}, {'x': x + 30 + k * 20, 'y': y, 'id': 2}]})
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    time.sleep(0.3)
    print(pg.evaluate("() => window.__ev"))
    print('transform', pg.evaluate("() => document.querySelector('#mkWorld').style.transform"))
    pg.tap('[data-tool="arrow"]')
    pg.evaluate("() => { window.__ev = []; }")
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': 60, 'y': 300, 'id': 1}]})
    for k in range(1, 6): cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': 60 + k * 20, 'y': 300 + k * 10, 'id': 1}]})
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    time.sleep(0.3)
    print(pg.evaluate("() => window.__ev"))
    print(pg.evaluate("() => document.querySelector('#mkCompose').hidden"))
finally:
    srv.terminate()
    for pat in ['[f]ixsite.mjs', '[f]akeredis.mjs', '[d]ev-server.js']: subprocess.run(['pkill', '-f', pat])
