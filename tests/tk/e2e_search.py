"""Stage 5: the search. Usage: python3 -I e2e_search.py <app> <tests>"""
import json, os, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT = 3998
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-sx.log'), 'w'), text=True)
assert srv.stdout.readline().strip() == 'READY'
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
errors = []
def ask(pg, q):
    pg.fill('#sxInput', q); time.sleep(0.35)
    return pg.inner_text('#sxList')
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx = br.new_context(viewport={'width': 1440, 'height': 1000})
        ctx.add_cookies([{'name': 'dsa_sess', 'value': 'tokadmin1234567890abcdef', 'domain': 'localhost', 'path': '/'}])
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(f'http://localhost:{APORT}/#/sites'); pg.wait_for_selector('#btnSearch', timeout=20000); time.sleep(1)
        pg.keyboard.press('/'); pg.wait_for_selector('#sxInput', timeout=5000)
        check(pg.locator('#sx').count() == 1, 'pressing / opens the search')
        empty = pg.inner_text('#sxList')
        check('jump to' in empty.lower() and 'try asking' in empty.lower(), 'empty search suggests pages and example questions')
        pg.wait_for_function("() => !/Loading Help/.test(document.querySelector('#sxList').textContent)", timeout=10000); time.sleep(0.6)
        t = ask(pg, 'buff')
        check('Buff & Beyond' in t and 'websites' in t.lower(), 'a website is found by part of its name')
        pg.keyboard.press('Enter'); time.sleep(0.8)
        check(pg.url.endswith('#/site/s1/profile') and pg.locator('#sx').count() == 0, 'Enter opens its profile and closes the search')
        pg.keyboard.press('Control+k'); pg.wait_for_selector('#sxInput', timeout=5000)
        check(True, 'Ctrl+K opens it too')
        t = ask(pg, 'what is a false alarm?')
        first_group = pg.locator('.sx-gh').first.inner_text()
        print('   false alarm →', t[:400].replace('\n', ' | '))
        check(first_group.lower().startswith('answers') and 'false alarm' in t.lower(), 'a question puts Answers from Help first, about false alarms')
        check(pg.locator('.sx-snip mark').count() > 0, 'matching words are highlighted in the answer')
        t = ask(pg, 'what is the process after dev')
        print('   process after dev →', t[:500].replace('\n', ' | '))
        check('Projects' in t and ('QA' in t or 'Dev' in t), '"what is the process after dev" finds the project phases')
        t = ask(pg, 'domains expiring')
        check('Domains expiring or expired' in t and 'Filter' in t, 'a filter is suggested for "domains expiring"')
        pg.locator('.sx-row', has_text='Domains expiring or expired').first.click(); time.sleep(1.5)
        check(pg.url.endswith('#/live/trends'), 'choosing the filter opens Domain monitoring (Trends)')
        pg.keyboard.press('/'); pg.wait_for_selector('#sxInput')
        t = ask(pg, 'dana')
        check('Dana Dev' in t and 'people' in t.lower(), 'people are found by name')
        t = ask(pg, 'invite someone')
        check('Add member' in t, '"invite someone" suggests Add member (synonyms)')
        t = ask(pg, 'ssl')
        check('Certificate' in t or 'certificate' in t, '"ssl" finds certificate topics')
        t = ask(pg, 'zzqxw')
        check('Nothing matched' in t, 'no match says so and offers Help')
        pg.keyboard.press('Escape'); time.sleep(0.2)
        check(pg.locator('#sx').count() == 0, 'Esc closes it')
        pg.screenshot(path=os.path.join(OUT, 'sx-after.png'))
        pg.keyboard.press('/'); ask(pg, 'what is a false alarm?'); pg.screenshot(path=os.path.join(OUT, 'sx-answer.png'))
        pg.keyboard.press('Escape')
        # a member: no admin-only pages
        mctx = br.new_context(viewport={'width': 390, 'height': 850})
        mctx.add_cookies([{'name': 'dsa_sess', 'value': 'tokmember1234567890abcde', 'domain': 'localhost', 'path': '/'}])
        mp = mctx.new_page(); mp.on('pageerror', lambda e: errors.append(str(e)))
        mp.goto(f'http://localhost:{APORT}/#/sites'); mp.wait_for_selector('#btnSearch', timeout=20000); time.sleep(0.8)
        mp.click('#btnSearch'); mp.wait_for_selector('#sxInput')
        mp.fill('#sxInput', 'roles'); time.sleep(0.6)
        t = mp.inner_text('#sxList')
        check('🧩Roles' not in t.replace('\n', '') and 'Add member' not in t, 'a member is not offered admin pages or actions')
        box = mp.locator('.sx').bounding_box()
        check(box['width'] >= 385, 'on a phone the search fills the screen')
        mp.screenshot(path=os.path.join(OUT, 'sx-phone.png'))
        check(not errors, 'no script errors ' + ' | '.join(errors[:3]))
        br.close()
except Exception:
    import traceback; traceback.print_exc(); ok = False
finally:
    srv.terminate()
    for pat in ['[f]ixsite.mjs', '[f]akeredis.mjs', '[d]ev-server.js']: subprocess.run(['pkill', '-f', pat])
print('ALL PASS' if ok else 'SOME FAILED')
