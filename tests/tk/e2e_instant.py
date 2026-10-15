"""Marking straight on the live page: no waiting, then the picture arrives on its own."""
import json, os, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk')
APORT, RPORT = 3998, 8078
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-inst.log'), 'w'), text=True)
assert srv.stdout.readline().strip() == 'READY'
def redis(*cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
errors = []
def frame_of(pg): return next(f for f in pg.frames if f.url and '/api/live' in f.url)
def scr(pg, el_sel):
    """Screen position of an element inside the live page."""
    fb = pg.locator('#mkFrame').bounding_box()
    z = pg.evaluate("() => new DOMMatrix(getComputedStyle(document.querySelector('#mkFrame')).transform).a")
    r = frame_of(pg).evaluate("(s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }", el_sel)
    return fb['x'] + (r[0] + min(30, r[2] / 2)) * z, fb['y'] + (r[1] + r[3] / 2) * z
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        ph = br.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        ph.add_cookies([{'name': 'dsa_sess', 'value': 'tokclient1234567890abcde', 'domain': 'localhost', 'path': '/'}])
        pg = ph.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(f'http://localhost:{APORT}/#/my/s1/mark')
        pg.wait_for_function("() => document.querySelector('#mkFrame') && document.querySelector('#mkFrame').src", timeout=15000)
        pg.frame_locator('#mkFrame').locator('#servBtn').wait_for(timeout=15000)
        pg.tap('[data-dev="mobile"]')
        pg.wait_for_function("() => document.querySelector('#mkFrame').style.width === '390px'")
        pg.frame_locator('#mkFrame').locator('#bookBtn').wait_for(timeout=15000); time.sleep(0.5)
        # open the pop-up in the live page
        frame_of(pg).evaluate("() => { document.querySelector('#bookBtn').scrollIntoView({ block: 'center' }); document.querySelector('#bookBtn').click(); }")
        time.sleep(0.4)
        pg.tap('[data-tool="highlight"]')
        check(pg.evaluate("() => document.querySelector('#mk').classList.contains('m-live')"), 'picking a tool keeps the live page — no freezing')
        x, y = scr(pg, '#modalTxt')
        t0 = time.time()
        pg.touchscreen.tap(x, y)
        pg.wait_for_selector('#mkCompose:not([hidden]) #mkText', timeout=5000)
        check(time.time() - t0 < 2, f'the comment box opens in {time.time() - t0:.2f}s')
        check('Pick a day' in pg.inner_text('.mk-c-q'), 'tapping the pop-up text highlights it: ' + pg.inner_text('.mk-c-q'))
        pg.screenshot(path=os.path.join(OUT, 'shot-inst-compose.png'))
        pg.fill('#mkText', 'Change the pop-up wording')
        t1 = time.time()
        pg.tap('[data-c="send"]')
        pg.wait_for_function("() => document.querySelector('#mkOv .mk-m.st-sent')", timeout=10000)
        check(time.time() - t1 < 3, f'sent and green in {time.time() - t1:.2f}s (no picture to wait for)')
        # the picture arrives on its own
        tid = None
        for _ in range(60):
            ids = redis(['LRANGE', 'dsa:tks', 0, 0])[0]
            if ids:
                tk = json.loads(redis(['GET', 'dsa:tk:' + ids[0]])[0]); tid = tk['id']
                if tk.get('img') and tk.get('cap'): break
            time.sleep(1)
        check(tk.get('img') and tk.get('cap'), f'the picture was added in the background ({time.time() - t1:.0f}s after sending)')
        img = json.loads(redis(['GET', 'dsa:tkimg:' + tid])[0])
        open(os.path.join(OUT, 'inst-crop.webp'), 'wb').write(__import__('base64').b64decode(img['data']))
        els = json.loads(__import__('zlib').decompress(__import__('base64').b64decode(redis(['GET', 'dsa:capmap:' + tk['cap']])[0][3:]), -15))
        modal = next((e for e in els if e['t'] == 'Pick a day that suits you.'), None)
        check(modal is not None, 'the pop-up is in the team\'s picture')
        # marks follow the page as it scrolls
        before = pg.evaluate("() => { const g = document.querySelector('#mkOv .mk-m.st-sent rect'); return g ? +g.getAttribute('y') : null; }")
        frame_of(pg).evaluate("() => scrollBy(0, 200)"); time.sleep(0.4)
        after = pg.evaluate("() => { const g = document.querySelector('#mkOv .mk-m.st-sent rect'); return g ? +g.getAttribute('y') : null; }")
        check(before is not None and after is not None and abs((before - after) - 200) < 6, f'the mark moves with the page when it scrolls ({before} → {after})')
        # two fingers scroll the page while a tool is on
        cdp = ph.new_cdp_session(pg)
        y0 = frame_of(pg).evaluate("() => scrollY")
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': 150, 'y': 500, 'id': 1}, {'x': 250, 'y': 500, 'id': 2}]})
        for k in range(1, 9): cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': 150, 'y': 500 - k * 25, 'id': 1}, {'x': 250, 'y': 500 - k * 25, 'id': 2}]})
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); time.sleep(0.5)
        y1 = frame_of(pg).evaluate("() => scrollY")
        check(y1 - y0 > 120, f'two fingers scroll the page while drawing is on ({y0} → {y1})')
        # the footer, after tapping a wide strip (the case that came out blank/shifted)
        pg.tap('[data-tool="move"]'); time.sleep(0.2)
        frame_of(pg).evaluate("() => { document.querySelector('#track').scrollIntoView({ block: 'center' }); }"); time.sleep(0.3)
        tx, ty = scr(pg, '#track'); pg.touchscreen.tap(tx, ty); time.sleep(0.3)
        frame_of(pg).evaluate("() => scrollTo(0, document.documentElement.scrollHeight)"); time.sleep(0.4)
        pg.tap('[data-tool="rect"]')
        fx, fy = scr(pg, '#foot')
        pg.touchscreen.tap(fx + 40, fy)
        pg.wait_for_selector('#mkCompose:not([hidden]) #mkText'); pg.fill('#mkText', 'Footer: update the year'); pg.tap('[data-c="send"]')
        pg.wait_for_function("() => document.querySelectorAll('#mkOv .mk-m.st-sent').length >= 2", timeout=10000)
        for _ in range(60):
            ids = redis(['LRANGE', 'dsa:tks', 0, 0])[0]; tk2 = json.loads(redis(['GET', 'dsa:tk:' + ids[0]])[0])
            if tk2.get('img') and tk2.get('cap') and tk2['id'] != tid: break
            time.sleep(1)
        check(tk2.get('img'), 'footer ticket got its picture')
        els2 = json.loads(__import__('zlib').decompress(__import__('base64').b64decode(redis(['GET', 'dsa:capmap:' + tk2['cap']])[0][3:]), -15))
        foot = next((e for e in els2 if e['t'].startswith('Footer text')), None)
        check(foot is not None and foot['r'][0] >= 0 and foot['r'][0] < 60, f'the footer picture is not shifted sideways (footer text at x={foot and foot["r"][0]})')
        img2 = json.loads(redis(['GET', 'dsa:tkimg:' + tk2['id']])[0])
        open(os.path.join(OUT, 'inst-crop-footer.webp'), 'wb').write(__import__('base64').b64decode(img2['data']))
        pg.screenshot(path=os.path.join(OUT, 'shot-inst-footer.png'))
        # drafts on the live page come back after reload
        pg.tap('[data-tool="ellipse"]'); pg.touchscreen.tap(200, 400)
        pg.wait_for_selector('#mkCompose:not([hidden])'); pg.fill('#mkText', 'draft circle'); pg.tap('[data-c="keep"]')
        pg.reload()
        pg.wait_for_function("() => document.querySelector('#mkFrame') && document.querySelector('#mkFrame').src", timeout=15000)
        pg.wait_for_function("() => document.querySelectorAll('#mkLayers .mk-row').length >= 3", timeout=20000)
        check(pg.evaluate("() => document.querySelectorAll('#mkLayers .mk-dot.st-draft').length") == 1, 'after reloading: 2 sent + the draft are listed for this page')
        print('page errors:', errors)
        check(not errors, 'no script errors')
        br.close()
except Exception:
    import traceback; traceback.print_exc(); ok = False
finally:
    srv.terminate()
    for pat in ['[f]ixsite.mjs', '[f]akeredis.mjs', '[d]ev-server.js']: subprocess.run(['pkill', '-f', pat])
print('ALL PASS' if ok else 'SOME FAILED')
