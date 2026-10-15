"""Change requests, end to end in a real browser: a client on a phone marks and sends; the team answers on a desktop."""
import json, os, subprocess, sys, time, urllib.request, urllib.parse
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk')
APORT, RPORT, SPORT = 3998, 8078, 8093
ADMIN, CLIENT = 'reymark@8bitcreative.com', 'owner@buffandbeyond.com'
TOK = {ADMIN: 'tokadmin1234567890abcdef', CLIENT: 'tokclient1234567890abcde'}
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv.log'), 'w'), text=True)
assert srv.stdout.readline().strip() == 'READY'
def redis(*cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
def fixture_fetch(r):
    u = urllib.parse.urlparse(r.request.url); q = dict(urllib.parse.parse_qsl(u.query))
    path = q.get('path', '/')
    html = urllib.request.urlopen(f"http://127.0.0.1:{SPORT}/site/{q['site']}{'' if path == '/' else path}?dm_device={q.get('device','desktop')}").read().decode()
    r.fulfill(status=200, content_type='application/json', body=json.dumps({'status': 200, 'html': html, 'url': ''}))
errors = []
def frame_of(pg): return next(f for f in pg.frames if f.url and '/api/live' in f.url)
def geo(pg):
    """Page pixel -> screen, for the live page (or a picture, when one is open)."""
    if pg.evaluate("() => document.querySelector('#mk').classList.contains('m-mark')"):
        return pg.evaluate("""() => { const w = document.querySelector('#mkWorld'); const m = new DOMMatrix(getComputedStyle(w).transform); const st = document.querySelector('#mkStage').getBoundingClientRect(); return {a: m.a, e: m.e, f: m.f, left: st.left, top: st.top, w: st.width, h: st.height}; }""")
    st = pg.locator('#mkStage').bounding_box(); fb = pg.locator('#mkFrame').bounding_box()
    z = pg.evaluate("() => new DOMMatrix(getComputedStyle(document.querySelector('#mkFrame')).transform).a")
    sx, sy = frame_of(pg).evaluate("() => [scrollX, scrollY]")
    return {'a': z, 'e': fb['x'] - st['x'] - sx * z, 'f': fb['y'] - st['y'] - sy * z, 'left': st['x'], 'top': st['y'], 'w': st['width'], 'h': st['height']}
def scr(pg, px, py):
    g = geo(pg); return (g['left'] + g['e'] + px * g['a'], g['top'] + g['f'] + py * g['a'])
def touch_drag(cdp, pts_from, pts_to, steps=10):
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y, 'id': i + 1} for i, (x, y) in enumerate(pts_from)]})
    for k in range(1, steps + 1):
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': a[0] + (b[0] - a[0]) * k / steps, 'y': a[1] + (b[1] - a[1]) * k / steps, 'id': i + 1} for i, (a, b) in enumerate(zip(pts_from, pts_to))]})
def touch_end(cdp): cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); time.sleep(0.5)
def freeze(pg, tool='rect'):
    """The live page is ready to mark (nothing is frozen any more)."""
    pg.wait_for_function("() => document.querySelector('#mkFrame') && document.querySelector('#mkFrame').src", timeout=10000)
    pg.frame_locator('#mkFrame').locator('h1').first.wait_for(timeout=20000)
    pg.wait_for_function("() => document.querySelector('#mk').classList.contains('m-live')", timeout=5000)
    time.sleep(0.6)
def drafts(pg):
    return json.loads(pg.evaluate("() => { for (const k of Object.keys(localStorage)) if (k.startsWith('dsa-mk:s1:')) return localStorage.getItem(k); return '[]'; }"))
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        # ---------------- the client, on a phone ----------------
        ph = br.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        ph.add_cookies([{'name': 'dsa_sess', 'value': TOK[CLIENT], 'domain': 'localhost', 'path': '/'}])
        pg = ph.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(f'http://localhost:{APORT}/#/my/s1/overview')
        pg.wait_for_selector('.cp-hero', timeout=15000)
        check(pg.is_visible('.cp-hero [data-sendticket]'), 'Overview shows Send a request')
        check(pg.is_visible('.cp-tabs'), 'phone: the bottom bar is there')
        mb = pg.evaluate("() => document.querySelector('.cp-hero [data-sendticket]').getBoundingClientRect().top")
        check(mb < 844, f'phone: Send a request is on the first screen (top {mb:.0f}px)')
        sw = pg.evaluate("() => document.documentElement.scrollWidth")
        check(sw <= 390, f'phone: nothing wider than the screen ({sw}px)')
        pg.screenshot(path=os.path.join(OUT, 'shot-phone-dash.png'))
        pg.tap('.cp-hero [data-sendticket]'); pg.wait_for_selector('[data-tkt="change"]')
        tips = pg.inner_text('.tk-choose')
        check('General question' in tips and 'not relate' in tips and 'change request for your website' in tips, 'chooser explains both options')
        pg.screenshot(path=os.path.join(OUT, 'shot-phone-chooser.png'))
        pg.tap('[data-tkt="change"]')
        freeze(pg)
        g = geo(pg)
        check(abs(g['a'] - 390 / 1920) < 0.01, f"desktop page fitted across the phone (scale {g['a']:.3f})")
        pg.screenshot(path=os.path.join(OUT, 'shot-phone-open.png'))
        hours = {'r': frame_of(pg).evaluate("() => { const r = document.querySelector('#txt2').getBoundingClientRect(); return [r.left + scrollX, r.top + scrollY, r.width, r.height]; }"), 't': 'We open at 9am every weekday.'}
        cdp = ph.new_cdp_session(pg)
        frame_of(pg).evaluate("() => scrollBy(0, 300)"); time.sleep(0.05)
        moving = pg.evaluate("() => document.querySelector('#mkStage').classList.contains('moving')")
        check(moving, 'marks fade while the page is being moved')
        before = geo(pg)['a']
        for _ in range(3): pg.tap('[data-z="+"]')
        after = geo(pg)['a']
        check(after > before * 2.5, f'zoom in ({before:.2f} -> {after:.2f})')
        frame_of(pg).evaluate("() => document.querySelector('#txt2').scrollIntoView({ block: 'center' })"); time.sleep(0.4)
        pg.evaluate("() => { window.__ev = []; document.addEventListener('click', e => window.__ev.push('click:' + (e.target.closest('button') || e.target).outerHTML.slice(0, 60)), true); document.addEventListener('touchstart', e => window.__ev.push('touchstart:' + e.target.tagName), true); }")
        pg.tap('[data-tool="highlight"]')
        x, y = scr(pg, hours['r'][0] + 40, hours['r'][1] + 9)
        print('   hours on screen at', round(x), round(y))
        pg.evaluate("() => { window.__ev = []; }")
        pg.touchscreen.tap(x, y)
        try: pg.wait_for_selector('#mkCompose:not([hidden]) #mkText', timeout=4000)
        except Exception:
            print(pg.evaluate("() => window.__ev")); pg.screenshot(path=os.path.join(OUT, 'dbg.png')); raise
        q = pg.inner_text('.mk-c-q')
        check('We open at 9am' in q, 'tapping the text highlights it and quotes it: ' + q)
        pg.fill('#mkText', 'Please change this to 8am')
        pg.screenshot(path=os.path.join(OUT, 'shot-phone-compose.png'))
        pg.tap('[data-c="send"]')
        pg.wait_for_function("() => document.querySelector('.mk-dot.st-sent')", timeout=20000)
        check(True, 'highlight sent; mark turned green')
        quota = pg.inner_text('#mkQuota')
        check('9 of 10' in quota, 'allowance shown: ' + quota)
        # an arrow, drawn by dragging
        pg.tap('[data-tool="arrow"]')
        g = geo(pg)
        ax, ay = g['left'] + 60, g['top'] + 120
        touch_drag(cdp, [(ax, ay)], [(ax + 150, ay + 100)], 8); touch_end(cdp)
        pg.wait_for_selector('#mkCompose:not([hidden]) #mkText')
        check('Arrow' in pg.inner_text('.mk-c-h'), 'drawing with the arrow tool makes an arrow')
        pg.fill('#mkText', 'Make this bigger')
        pg.tap('[data-c="keep"]')
        # a box by tapping, then drag it by its edge
        pg.tap('[data-tool="rect"]')
        bx, by = g['left'] + 220, g['top'] + 330
        pg.touchscreen.tap(bx, by)
        pg.wait_for_selector('#mkCompose:not([hidden])')
        pg.tap('[data-c="keep"]')
        d0 = [d for d in drafts(pg) if d['kind'] == 'rect'][0]['geo']
        touch_drag(cdp, [(bx - 79, by)], [(bx - 9, by + 70)], 7); touch_end(cdp)
        d1 = [d for d in drafts(pg) if d['kind'] == 'rect'][0]['geo']
        check(abs(d1['x'] - d0['x']) > 5 and abs(d1['y'] - d0['y']) > 5, f'a draft box can be dragged ({d0["x"]:.0f},{d0["y"]:.0f} -> {d1["x"]:.0f},{d1["y"]:.0f})')
        # the layers panel
        pg.tap('#mkGrip')
        pg.wait_for_selector('.mk-sheet.open .mk-row')
        rows = pg.locator('.mk-layers .mk-row').count()
        check(rows == 3, f'layers list all 3 marks, numbered ({rows})')
        pg.screenshot(path=os.path.join(OUT, 'shot-phone-layers.png'))
        pg.locator('.mk-layers .mk-row').nth(2).locator('[data-act="lock"]').tap()
        check(any(d.get('locked') for d in drafts(pg)), 'a mark can be locked')
        pg.check('#mkHideSent')
        try: pg.wait_for_function("() => document.querySelectorAll('#mkOv .mk-m.st-sent').length === 0", timeout=3000); hid = True
        except Exception: hid = False
        check(hid, 'Hide sent hides the green marks')
        pg.uncheck('#mkHideSent')
        # offline: the arrow fails, then goes by itself when the connection is back
        ph.set_offline(True)
        pg.locator('.mk-layers .mk-row').nth(1).tap()
        pg.wait_for_selector('#mkCompose:not([hidden]) [data-c="send"]')
        pg.tap('[data-c="send"]')
        pg.wait_for_function("() => document.querySelector('.mk-dot.st-failed')", timeout=15000)
        check(True, 'with no connection the request is kept and shown as not sent')
        ph.set_offline(False)
        pg.wait_for_function("() => document.querySelectorAll('.mk-layers .mk-dot.st-sent').length === 2", timeout=30000)
        check(True, 'connection back: it sends itself')
        n = redis(['GET', 'dsa:tk:seq'])[0]
        check(n == '2', f'exactly two requests on the server, no duplicate from the retry ({n})')
        # reload keeps the draft
        pg.reload(); freeze(pg)
        pg.wait_for_function("() => document.querySelectorAll('#mkOv .mk-m').length >= 3", timeout=15000)
        check(pg.evaluate("() => document.querySelectorAll('#mkOv .mk-m.st-draft').length") == 1, 'after reloading, the unsent box is still there')
        # phone view of the site
        pg.tap('[data-dev="mobile"]'); freeze(pg)
        pg.wait_for_function("() => document.querySelector('#mkFrame').style.width === '390px'", timeout=10000)
        check(abs(geo(pg)['a'] - 1) < 0.02, 'phone view of the site fills the phone at 100%')
        pg.screenshot(path=os.path.join(OUT, 'shot-phone-mobileview.png'))
        pg.tap('#mkClose')
        pg.wait_for_selector('.tk-card')
        try: pg.wait_for_function("() => document.querySelectorAll('.tk-card').length === 2", timeout=8000); two = True
        except Exception: two = False
        check(two, 'Requests page lists the 2 sent')
        pg.wait_for_function("() => [...document.querySelectorAll('.tk-card .tk-thumb img')].every(i => i.complete && i.naturalWidth > 300)", timeout=10000)
        check(True, 'each has its picture')
        # a general question, with a photo
        pg.tap('.cp-fab'); pg.wait_for_selector('[data-tkt="question"]'); pg.tap('[data-tkt="question"]')
        pg.wait_for_selector('#tqText')
        pg.fill('#tqText', 'When does my domain renew?')
        if not os.path.exists(os.path.join(OUT, 'prev-d0.png')):  # normally left by an earlier test; any picture will do
            pg.screenshot(path=os.path.join(OUT, 'prev-d0.png'))
        pg.set_input_files('#tqFile', os.path.join(OUT, 'prev-d0.png'))
        pg.wait_for_selector('#tqPrev img')
        pg.screenshot(path=os.path.join(OUT, 'shot-phone-question.png'))
        pg.tap('#tqSend')
        pg.wait_for_function("() => document.querySelectorAll('.tk-card').length === 3", timeout=15000)
        check('General question' in pg.inner_text('.tk-card >> nth=0'), 'question listed as a General question')
        pg.screenshot(path=os.path.join(OUT, 'shot-phone-list.png'), full_page=True)
        # ---------------- the team, on a desktop ----------------
        dk = br.new_context(viewport={'width': 1440, 'height': 950})
        dk.add_cookies([{'name': 'dsa_sess', 'value': TOK[ADMIN], 'domain': 'localhost', 'path': '/'}])
        tp = dk.new_page(); tp.on('pageerror', lambda e: errors.append('team: ' + str(e)))
        tp.route('**/api/fetch*', fixture_fetch)
        tp.goto(f'http://localhost:{APORT}/#/')
        tp.wait_for_selector('[data-nav="requests"]', timeout=15000)
        tp.wait_for_function("() => /3/.test(document.querySelector('[data-nav=\"requests\"]').textContent)", timeout=10000)
        check(True, 'top bar shows 3 new client tickets')
        tp.click('[data-nav="requests"]')
        tp.wait_for_selector('.tk-row')
        check(tp.locator('.tk-row').count() == 3, 'team list has all three')
        tp.locator('.tk-row', has_text='domain renew').click(); tp.wait_for_selector('.tk-detail')
        check('General question' in tp.inner_text('.tk-detail') and not tp.locator('#tkSee').count() and tp.locator('#tkImg img').count() == 1, 'question detail: no page tools, photo shown')
        tp.keyboard.press('Escape')
        tp.screenshot(path=os.path.join(OUT, 'shot-team-list.png'))
        tp.locator('.tk-row', has_text='8am').click()
        tp.wait_for_selector('.tk-detail')
        tp.wait_for_selector('.tk-d-check .tk-chk', timeout=15000)
        check('Not changed yet' in tp.inner_text('.tk-d-check'), 'the team sees the spot has not changed yet')
        tp.screenshot(path=os.path.join(OUT, 'shot-team-detail.png'))
        urllib.request.urlopen(f'http://127.0.0.1:{SPORT}/__version?v=2')
        tp.click('#tkReCheck'); tp.wait_for_function("() => /Changed since/.test(document.querySelector('.tk-d-check').textContent)", timeout=15000)
        check('8am' in tp.inner_text('.tk-d-check'), 'after the fix: Changed since, and shows the new text')
        tp.fill('#tkReply', 'Changed to 8am - thanks!')
        tp.select_option('#tkReplySt', 'done')
        tp.click('#tkReplyGo')
        tp.wait_for_function("() => document.querySelector('.modal .tk-pill.tk-done')", timeout=10000)
        check(True, 'team replies and marks it Done')
        for _ in range(60):
            ts = [json.loads(x) for x in redis(['MGET'] + ['dsa:tk:' + i for i in redis(['LRANGE', 'dsa:tks', 0, -1])[0]])[0]]
            if all(t.get('cap') for t in ts if t.get('type') != 'question'): break
            time.sleep(1)
        tp.keyboard.press('Escape'); tp.click('[data-tkg="all"]'); tp.locator('.tk-row', has_text='8am').click(); tp.wait_for_selector('#tkSee', timeout=10000)
        tp.click('#tkSee')
        tp.wait_for_selector('#mk.ro #mkWorld img[src]', timeout=20000)
        tp.wait_for_function("() => document.querySelectorAll('#mkOv .mk-m').length >= 1", timeout=10000)
        check(True, 'See it on the whole page: both marks on the picture')
        time.sleep(0.5)
        tp.screenshot(path=os.path.join(OUT, 'shot-team-page.png'))
        tp.keyboard.press('Escape'); tp.keyboard.press('Escape'); tp.keyboard.press('Escape')
        tp.wait_for_selector('#tkSet'); tp.click('#tkSet'); tp.wait_for_selector('#tsDaily')
        tp.click('#tsTest'); tp.wait_for_function("() => /Works|✗/.test(document.querySelector('#tsTestOut').textContent)", timeout=60000)
        check('Works' in tp.inner_text('#tsTestOut'), 'Test page pictures: ' + tp.inner_text('#tsTestOut'))
        tp.screenshot(path=os.path.join(OUT, 'shot-team-settings.png'))
        tp.fill('#tsDaily', '2'); tp.click('#tsSave'); time.sleep(0.6)
        # ---------------- back to the client ----------------
        pg.reload(); pg.wait_for_selector('.tk-card')
        txt = pg.inner_text('.tk-card.news') if pg.locator('.tk-card.news').count() else ''
        check('Changed to 8am' in txt and 'Done' in txt, 'client sees the reply and Done')
        pg.tap('.cp-fab'); pg.wait_for_selector('[data-tkt="change"]'); pg.tap('[data-tkt="change"]')
        pg.wait_for_selector('#mkFrame', state='attached', timeout=15000); time.sleep(0.3)
        if pg.evaluate("() => document.querySelector('#mkFrame').style.width") != '1920px': pg.tap('[data-dev="desktop"]')
        freeze(pg)
        check('limit reached' in pg.inner_text('#mkQuota'), 'with the limit lowered to 2 the client is told: ' + pg.inner_text('#mkQuota'))
        pg.tap('#mkGrip'); pg.wait_for_selector('.mk-sheet.open .mk-row')
        pg.locator('.mk-layers .mk-row', has=pg.locator('.mk-dot.st-draft')).first.tap(); pg.wait_for_selector('#mkCompose:not([hidden])')
        check(pg.is_disabled('[data-c="send"]') and 'draft' in pg.inner_text('#mkCompose'), 'Send is off; the mark waits as a draft')
        pg.screenshot(path=os.path.join(OUT, 'shot-phone-limit.png'))
        print('page errors:', errors)
        check(not errors, 'no script errors')
        br.close()
except Exception:
    import traceback; traceback.print_exc(); ok = False
finally:
    srv.terminate()
    for pat in ['[f]ixsite.mjs', '[f]akeredis.mjs', '[d]ev-server.js']: subprocess.run(['pkill', '-f', pat])
print('ALL PASS' if ok else 'SOME FAILED')
