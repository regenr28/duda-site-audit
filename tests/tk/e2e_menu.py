"""Activity and Suggestions live in the light-bulb menu. Usage: python3 -I e2e_menu.py <app> <tests>"""
import os, subprocess, sys, time
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]; OUT = os.path.join(TESTS, 'tk')
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
assert srv.stdout.readline().strip() == 'READY'
ok = True
def check(c, l):
    global ok
    print(('PASS ' if c else 'FAIL ') + l, flush=True); ok = ok and bool(c)
errors = []
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        for tok, who in [('tokadmin1234567890abcdef', 'admin'), ('tokmember1234567890abcde', 'member')]:
            c = br.new_context(viewport={'width': 1440, 'height': 900}); c.add_cookies([{'name': 'dsa_sess', 'value': tok, 'domain': 'localhost', 'path': '/'}])
            pg = c.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
            pg.goto('http://localhost:3998/#/sites'); pg.wait_for_selector('#btnMenu', timeout=20000); time.sleep(0.8)
            nav = pg.inner_text('#sideNav').split('Settings')[0]
            check('Activity' not in nav and 'uggestions' not in nav, f'{who}: the main menu has no Activity or Suggestions (they are under the light bulb): ' + nav.replace('\n', ' | '))
            pg.click('#btnMenu'); pg.wait_for_selector('#appMenu')
            m = pg.inner_text('#appMenu')
            if who == 'admin':
                check('Activity' in m and 'Suggestions & false alarms' in m, 'admin: the light-bulb menu has Activity and Suggestions & false alarms')
                pg.click('#appMenu a[href="#/activity"]'); time.sleep(1)
                check(pg.url.endswith('#/activity') and pg.locator('#appMenu').count() == 0, 'clicking Activity opens it and closes the menu')
                pg.screenshot(path=os.path.join(OUT, 'menu.png'))
            else:
                check('Activity' not in m and 'My suggestions' in m, 'member: My suggestions, and no Activity (not in their role)')
                pg.click('#appMenu a[href="#/suggestions"]'); time.sleep(1)
                check(pg.url.endswith('#/suggestions'), 'My suggestions opens')
        check(not errors, 'no script errors ' + ' | '.join(errors[:3]))
        br.close()
finally:
    srv.terminate()
    for pat in ['[f]ixsite.mjs', '[f]akeredis.mjs', '[d]ev-server.js']: subprocess.run(['pkill', '-f', pat])
print('ALL PASS' if ok else 'SOME FAILED')
