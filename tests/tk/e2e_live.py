"""Live browsing: the client browses their site, opens a menu and a pop-up, taps a tool, and the
frozen picture shows exactly that. Usage: python3 -I e2e_live.py <app> <tests>"""
import json, os, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk')
APORT, RPORT = 3998, 8078
TOK = {'client': 'tokclient1234567890abcde', 'admin': 'tokadmin1234567890abcdef'}
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-live.log'), 'w'), text=True)
assert srv.stdout.readline().strip() == 'READY'
def redis(*cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
errors = []
GEO = """() => { const w = document.querySelector('#mkWorld'); const m = new DOMMatrix(getComputedStyle(w).transform); const st = document.querySelector('#mkStage').getBoundingClientRect(); return {a: m.a, e: m.e, f: m.f, left: st.left, top: st.top, w: st.width, h: st.height}; }"""
def scr(pg, px, py):
    g = pg.evaluate(GEO); return (g['left'] + g['e'] + px * g['a'], g['top'] + g['f'] + py * g['a'])
def live_frame(pg):
    pg.wait_for_function("() => document.querySelector('#mkFrame') && document.querySelector('#mkFrame').src", timeout=10000)
    return pg.frame_locator('#mkFrame')
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        # ---------------- client on a phone ----------------
        ph = br.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        ph.add_cookies([{'name': 'dsa_sess', 'value': TOK['client'], 'domain': 'localhost', 'path': '/'}])
        pg = ph.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(f'http://localhost:{APORT}/#/my/s1/requests')
        pg.wait_for_selector('.cp-fab', timeout=15000)
        t0 = time.time()
        pg.tap('.cp-fab'); pg.wait_for_selector('[data-tkt="change"]'); pg.tap('[data-tkt="change"]')
        fr = live_frame(pg)
        fr.locator('#servBtn').wait_for(timeout=15000)
        pg.wait_for_function("() => document.querySelector('#mkMsg').hidden || !document.querySelector('#mkMsg').textContent", timeout=10000)
        check(time.time() - t0 < 5, f'the live website shows in {time.time() - t0:.1f}s (no picture taken first)')
        check(pg.is_visible('#mkFrame') and not pg.is_visible('#mkWorld img'), 'live mode: the website, not a picture')
        fw = pg.evaluate("() => document.querySelector('#mkFrame').style.width")
        check(fw == '1920px', 'desktop view is a real 1920px page, scaled to the phone: ' + fw)
        # locked down
        frame = next(f for f in pg.frames if f.url and '/api/live' in f.url)
        origin = frame.evaluate("() => self.origin")
        check(origin == 'null', 'the website runs with no origin of its own: ' + origin)
        before = redis(['GET', 'dsa:tk:seq'])[0]
        frame.evaluate("() => fetch('/api/tickets', { method: 'POST', body: JSON.stringify({ op: 'create', type: 'question', site: 's1', cid: 'evil-attempt-123', text: 'x' }), headers: { 'Content-Type': 'text/plain' } }).catch(() => 0)")
        time.sleep(0.6)
        check(redis(['GET', 'dsa:tk:seq'])[0] == before, 'a script on the website cannot send anything as the client')
        check(frame.evaluate("() => { try { localStorage.setItem('a', '1'); return localStorage.getItem('a') === '1'; } catch (e) { return false; } }"), "the website's own scripts still get working storage")
        # navigate inside the website
        fr.locator('header a', has_text='About').click()
        pg.wait_for_function("() => /path=%2Fabout/.test(document.querySelector('#mkFrame').src)", timeout=10000)
        fr.locator('h1', has_text='About our shop').wait_for(timeout=15000)
        time.sleep(0.4)
        check(pg.eval_on_selector('#mkPage', 'e => e.value') == '/about', 'clicking a menu link opens that page; the page picker follows')
        pg.select_option('#mkPage', '/')
        fr.locator('h1', has_text='Shine like new').wait_for(timeout=15000)
        print('page errors:', errors)
        check(not errors, 'no script errors')
        br.close()
except Exception:
    import traceback; traceback.print_exc(); ok = False
finally:
    srv.terminate()
    for pat in ['[f]ixsite.mjs', '[f]akeredis.mjs', '[d]ev-server.js']: subprocess.run(['pkill', '-f', pat])
print('ALL PASS' if ok else 'SOME FAILED')
