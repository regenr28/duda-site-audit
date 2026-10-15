"""Stage 2: one profile layout from Audits and from Live DR Sites, with a real thumbnail.
Usage: python3 -I e2e_profile.py <app> <tests>"""
import json, os, subprocess, sys, time, urllib.request, zlib, base64
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT = 3998, 8078
TOK = 'tokadmin1234567890abcdef'
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-prof.log'), 'w'), text=True)
assert srv.stdout.readline().strip() == 'READY'
def redis(*cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
def pack(o):
    c = zlib.compressobj(9, zlib.DEFLATED, -15); return 'z1:' + base64.b64encode(c.compress(json.dumps(o).encode()) + c.flush()).decode()
now = int(time.time() * 1000)
sites = [{'id': 'abc123', 'name': 'Buff & Beyond', 'domain': 'buffandbeyond.com', 'defaultDomain': 'abc123.duda.test', 'published': '2026-10-01T10:00:00Z', 'first': '2025-03-01T10:00:00Z', 'created': '2025-02-01T10:00:00Z', 'labels': ['Style-Ivory']},
         {'id': 'new777', 'name': 'Boat Beautiful', 'domain': 'boatbeautiful.com', 'defaultDomain': 'new777.duda.test', 'published': '2026-10-05T10:00:00Z', 'first': '2026-09-01T10:00:00Z', 'created': '2026-08-01T10:00:00Z', 'labels': []}]
redis(['SET', 'dsa:dudasites', pack({'v': 2, 'at': now, 'by': 'x', 'count': 2, 'sites': sites, 'scope': 'published'})],
      ['SET', 'dsa:dudadrafts', pack({'v': 2, 'at': now, 'by': 'x', 'count': 0, 'sites': [], 'scope': 'unpublished'})],
      ['HSET', 'dsa:domstat', 'abc123', json.dumps({'domain': 'buffandbeyond.com', 'status': 'ok', 'label': 'Working', 'checkedAt': now, 'ms': 900, 'ssl': {'days': 10, 'issuer': 'LE'}, 'reg': {'name': 'buffandbeyond.com', 'expires': now + 5 * 86400000, 'registrar': 'GoDaddy'}}),
              'new777', json.dumps({'domain': 'boatbeautiful.com', 'status': 'notduda', 'label': 'Not pointing to this website', 'detail': 'The domain loads, but not the Duda website.', 'checkedAt': now})])
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
errors = []
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx = br.new_context(viewport={'width': 1440, 'height': 1000})
        ctx.add_cookies([{'name': 'dsa_sess', 'value': TOK, 'domain': 'localhost', 'path': '/'}])
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        # audited website, from Live DR Sites → Profile
        pg.goto(f'http://localhost:{APORT}/#/dr/abc123'); pg.wait_for_selector('.pf-top', timeout=20000)
        time.sleep(0.5)
        check(pg.url.endswith('#/site/s1/profile'), 'Live DR Profile of an audited website opens its Profile tab (not the form list): ' + pg.url)
        t0 = time.time()
        pg.wait_for_selector('.pf-shot img', timeout=60000)
        pg.wait_for_function("() => { const i = document.querySelector('.pf-shot img'); return i && i.complete && i.naturalWidth > 0; }", timeout=20000)
        nw = pg.evaluate("document.querySelector('.pf-shot img').naturalWidth")
        check(nw == 480, f'thumbnail taken and shown ({nw}px wide, {time.time() - t0:.1f}s)')
        raw = redis(['GET', 'dsa:thumb:abc123'])[0]
        kb = len(json.loads(raw)['data']) * 0.75 / 1024
        check(kb < 60, f'thumbnail is small: {kb:.0f} KB stored')
        txt = pg.inner_text('.pf')
        check('Domain health' in txt and 'Working' in txt and 'expires' not in txt.lower() or 'renews by' in txt, 'domain health card with registration date')
        check('Duda renews it' in txt, 'certificate shown as information only')
        check(pg.locator('.pf-facts li.bad').count() == 1, 'registration within 7 days is shown in red')
        check('Client tickets' in txt and 'Audit' in txt and 'Form submissions' in txt and 'Comments' in txt, 'audit, forms, comments and tickets cards')
        check('Style-Ivory' in txt and 'launched' in txt, 'labels and launch date from Duda')
        cards_a = pg.eval_on_selector_all('.pf-card .pf-card-h', 'es => es.map(e => e.firstChild.textContent.trim())')
        pg.screenshot(path=os.path.join(OUT, 'prof-audited.png'), full_page=True)
        # second open: no new picture taken
        n0 = redis(['GET', 'dsa:thumb:abc123'])[0]
        pg.goto(f'http://localhost:{APORT}/#/sites'); time.sleep(0.5); pg.goto(f'http://localhost:{APORT}/#/site/s1/profile'); pg.reload(); pg.wait_for_selector('.pf-shot img', timeout=20000); time.sleep(1)
        check(redis(['GET', 'dsa:thumb:abc123'])[0] == n0, 'opening it again reuses the picture (taken again only after a publish or a week)')
        # not audited
        pg.goto(f'http://localhost:{APORT}/#/dr/new777'); pg.wait_for_selector('.pf-top', timeout=20000)
        pg.wait_for_function("() => document.querySelector('.pf-shot img') || /No picture yet/.test(document.querySelector('.pf-shot').textContent)", timeout=60000); time.sleep(0.5)
        check('No picture yet' in pg.inner_text('.pf-shot') or pg.locator('.pf-shot img').count() == 1, 'a page the picture can not be taken of says so instead of spinning forever')
        txt2 = pg.inner_text('#view')
        cards_b = pg.eval_on_selector_all('.pf-card .pf-card-h', 'es => es.map(e => e.firstChild.textContent.trim())')
        print('   cards audited:', cards_a, '| not audited:', cards_b)
        check(cards_b[:3] == cards_a[:3], 'same layout: Domain health, Audit, Form submissions in the same places')
        check('Not pointing to this website' in txt2 and 'Not audited yet' in txt2 and pg.locator('#pfAudit').count() == 1, 'not-audited profile shows the domain problem and an Audit button')
        pg.screenshot(path=os.path.join(OUT, 'prof-dr.png'), full_page=True)
        # ---- tabs: one part of the profile at a time ----
        tabs = pg.eval_on_selector_all('.pf-tab', 'es => es.map(e => e.dataset.pftab)')
        print('   tabs:', tabs)
        check(tabs == ['overview', 'auto-audit', 'presence', 'health', 'analytics', 'contacts', 'submissions'], 'the profile is split into tabs: Overview … Contacts, Form submissions')
        check(pg.locator('.pf-tab.on').get_attribute('data-pftab') == 'overview' and pg.locator('#pfLeadsBody').is_hidden() and pg.locator('#pfContactsBody').is_hidden() and pg.locator('#pfWatch').count() == 0 and pg.locator('#pfAn').count() == 0,
              'it opens on Overview: the cards, not every section and list stacked under each other')
        h_over = pg.evaluate('document.documentElement.scrollHeight')
        pg.click('.pf-tab[data-pftab="submissions"]'); pg.wait_for_selector('#pfLeadsBody:visible', timeout=10000); time.sleep(0.4)
        check(pg.url.endswith('#/dr/new777/submissions') and pg.locator('.pf-top').count() == 0 and pg.locator('#pfLeads').is_visible(), 'Form submissions tab shows only the submissions, and the address follows: ' + pg.url)
        pg.click('.pf-tab[data-pftab="auto-audit"]'); pg.wait_for_selector('#pfWatch', timeout=10000); time.sleep(0.3)
        check(pg.locator('#pfLeadsBody').is_hidden() and pg.url.endswith('/auto-audit'), 'switching tab hides the previous one')
        pg.reload(); pg.wait_for_selector('#pfWatch', timeout=20000); time.sleep(0.3)
        check(pg.locator('.pf-tab.on').get_attribute('data-pftab') == 'auto-audit', 'a reload (or a shared link) opens the same tab')
        pg.click('.pf-tab[data-pftab="overview"]'); pg.wait_for_selector('.pf-cards', timeout=10000)
        pg.click('.pf-card a[data-pftab="presence"]'); pg.wait_for_selector('#pfPresence', timeout=10000)
        check(pg.locator('.pf-tab.on').get_attribute('data-pftab') == 'presence', 'a card\'s "open →" opens its tab')
        pg.focus('.pf-tab.on'); pg.keyboard.press('ArrowRight'); time.sleep(0.3)
        check(pg.locator('.pf-tab.on').get_attribute('data-pftab') == 'health', 'arrow keys move between tabs')
        check(h_over < 1400, f'the Overview fits about one screen ({h_over}px tall)')
        pg.goto(f'http://localhost:{APORT}/#/site/s1/leads'); pg.wait_for_selector('#pfLeadsBody:visible', timeout=20000)
        check(pg.locator('.pf-tab.on').get_attribute('data-pftab') == 'submissions', 'old links to an audit\'s form submissions open that tab')
        pg.goto(f'http://localhost:{APORT}/#/dr/abc123/auto-audit'); pg.wait_for_selector('#pfWatch', timeout=20000); time.sleep(0.3)
        check(pg.url.endswith('#/site/s1/profile/auto-audit'), 'an audited website\'s DR link keeps the tab: ' + pg.url)
        pg.evaluate('window.scrollTo(0, 400)'); time.sleep(0.2)
        top = pg.evaluate("document.querySelector('.pf-nav').getBoundingClientRect().top"); tb = pg.evaluate("document.querySelector('.topbar').offsetHeight")
        check(abs(top - tb) <= 2 or pg.evaluate('document.documentElement.scrollHeight') < 1400, f'the tab bar stays in view while scrolling ({top} vs top bar {tb})')
        pg.goto(f'http://localhost:{APORT}/#/site/s1/profile'); pg.wait_for_selector('.pf-cards', timeout=20000); time.sleep(0.5)
        pg.screenshot(path=os.path.join(OUT, 'prof-tabs.png'))
        # phone
        mp = ctx.new_page(); mp.set_viewport_size({'width': 390, 'height': 850}); mp.goto(f'http://localhost:{APORT}/#/site/s1/profile'); mp.wait_for_selector('.pf-shot img', timeout=30000); time.sleep(0.6)
        wide = mp.evaluate("() => [...document.querySelectorAll('.pf *')].filter(e => !e.closest('.pf-nav') && e.getBoundingClientRect().right > 392).map(e => e.tagName + '.' + e.className).slice(0, 6)")
        check(not wide, f'phone width: profile fits {wide}')
        mp.evaluate('window.scrollTo(0, 900)'); time.sleep(0.2)
        check(abs(mp.evaluate("document.querySelector('.pf-nav').getBoundingClientRect().top") - mp.evaluate("document.querySelector('.topbar').offsetHeight")) <= 2, 'phone: the tab bar stays under the top bar while scrolling')
        mp.evaluate('window.scrollTo(0, 0)')
        check(mp.evaluate('document.documentElement.scrollWidth') <= 392 and mp.evaluate("document.querySelector('.pf-nav').scrollWidth > document.querySelector('.pf-nav').clientWidth"), 'phone: the tabs scroll sideways inside their bar, the page does not')
        mp.screenshot(path=os.path.join(OUT, 'prof-phone.png'), full_page=True)
        mp.click('.pf-tab[data-pftab="submissions"]'); time.sleep(0.4)
        check(mp.evaluate("(() => { const b = document.querySelector('.pf-tab.on').getBoundingClientRect(); return b.left >= 0 && b.right <= 392; })()"), 'phone: the chosen tab is scrolled into view')
        check(not errors, 'no script errors ' + ' | '.join(errors[:3]))
        br.close()
except Exception:
    import traceback; traceback.print_exc(); ok = False
finally:
    srv.terminate()
    for pat in ['[f]ixsite.mjs', '[f]akeredis.mjs', '[d]ev-server.js']: subprocess.run(['pkill', '-f', pat])
print('ALL PASS' if ok else 'SOME FAILED')
