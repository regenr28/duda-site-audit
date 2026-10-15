"""Menu, Home, light/dark and colour themes. Usage: python3 -I e2e_nav.py <app> <tests>"""
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
B = 'http://localhost:3998/'
def ctx(br, tok, w=1440, h=900):
    c = br.new_context(viewport={'width': w, 'height': h}); c.add_cookies([{'name': 'dsa_sess', 'value': tok, 'domain': 'localhost', 'path': '/'}])
    pg = c.new_page(); pg.on('pageerror', lambda e: errors.append(str(e))); return c, pg
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        # ---------- the sign-in screen still works (the page's own attributes must not clash with it) ----------
        c0 = br.new_context(viewport={'width': 390, 'height': 850}); p0 = c0.new_page(); p0.on('pageerror', lambda e: errors.append(str(e)))
        p0.goto(B); p0.wait_for_selector('#auEmail', timeout=15000)
        p0.fill('#auEmail', 'nobody@x.com'); p0.fill('#auPass', 'whateverpass1'); p0.click('#auForm button[type=submit]'); time.sleep(1.5)
        check(p0.locator('#auForm').count() == 1 and p0.inner_text('#auMsg').strip() != '', 'sign-in: a wrong password shows a message and keeps the form: ' + p0.inner_text('#auMsg')[:60])
        p0.click('[data-mode="signup"]'); time.sleep(0.5); check(p0.locator('#auName').count() == 1, 'sign-in: Create an account still switches the form')
        c0.close()
        # ---------- desktop, admin ----------
        c, pg = ctx(br, 'tokadmin1234567890abcdef')
        pg.goto(B); pg.wait_for_selector('.hm-hello', timeout=20000); time.sleep(1.2)
        check(pg.url.endswith('#/home'), 'opening the app with no address lands on Home: ' + pg.url)
        nav = pg.inner_text('#sideNav')
        for w in ['Home', 'Audits', 'Projects', 'DR Websites', 'Tickets', 'Duda comments', 'Lead analysis', 'Leaderboards', 'Trends', 'Settings', 'Help']:
            check(w in nav, f'menu has {w}')
        for g in ['WORK', 'WEBSITES', 'INSIGHTS']:
            check(g in nav.upper(), f'menu group {g}')
        check(pg.locator('#sideNav a.active').first.inner_text().strip().startswith('Home'), 'Home is highlighted on Home')
        check(pg.locator('#tabBar').is_hidden(), 'no bottom tab bar on a desktop')
        hm = pg.inner_text('#view')
        check('Needs attention' in hm and 'My work' in hm and 'Start something' in hm, 'Home sections: needs attention, my work, start something')
        check('Setup' in hm, 'admin sees the Setup list')
        check(pg.locator('#btnNew').count() == 1 and 'New' in pg.inner_text('#btnNew'), 'one + New button')
        check(pg.locator('#btnAdd').count() == 0 and pg.locator('#btnProj').count() == 0, 'the two old + buttons are gone')
        pg.click('#btnNew'); pg.wait_for_selector('#newMenu')
        check('New audit' in pg.inner_text('#newMenu') and 'New project' in pg.inner_text('#newMenu'), '+ New offers audit and project')
        pg.click('[data-new="project"]'); pg.wait_for_selector('#pjName', timeout=5000); check(True, 'New project opens its form')
        pg.keyboard.press('Escape'); pg.evaluate("document.querySelector('.modal-back [data-close]') && document.querySelector('.modal-back [data-close]').click()")
        # clicking through the menu
        pg.click('#sideNav a[data-nav="sites"]'); time.sleep(1)
        check(pg.url.endswith('#/'), 'Audits opens #/')
        check('Audits check a website' in pg.inner_text('#pageIntro'), 'Audits page explains itself and Projects')
        check(pg.locator('#sideNav a.active').first.inner_text().strip().startswith('Audits'), 'Audits highlighted')
        pg.click('#pageIntro .i-x'); check(pg.inner_text('#pageIntro').strip() == '', 'the tip can be hidden')
        pg.reload(); pg.wait_for_selector('#sideNav', timeout=15000); time.sleep(1); check(pg.inner_text('#pageIntro').strip() == '', 'a hidden tip stays hidden')
        check(pg.url.endswith('#/'), 'a reload on Audits stays on Audits (not bounced Home)')
        pg.click('#sideNav a[data-nav="ranks"]'); time.sleep(1.5)
        check(pg.locator('#sideNav a.active').first.inner_text().strip().startswith('Leaderboards'), 'Leaderboards highlighted for #/live/ranks')
        pg.click('#sideNav a[data-nav="trends"]'); time.sleep(1.5)
        check(pg.locator('#sideNav a.active').first.inner_text().strip().startswith('Trends'), 'Trends highlighted for #/live/trends')
        # collapse
        pg.click('#btnNav'); time.sleep(0.3); check(pg.locator('#sideNav').is_hidden(), 'the menu can be folded away')
        pg.reload(); pg.wait_for_selector('#btnNav', timeout=15000); time.sleep(0.8); check(pg.locator('#sideNav').is_hidden(), 'and stays folded')
        pg.click('#btnNav'); time.sleep(0.3); check(pg.locator('#sideNav').is_visible(), 'and opens again')
        # ---------- appearance ----------
        check(pg.evaluate("document.documentElement.dataset.scheme") in ('light', 'dark'), 'a scheme is set')
        pg.click('#btnLook'); pg.wait_for_selector('#lookPop')
        pg.click('#lookPop [data-look-mode="dark"]'); time.sleep(0.4)
        check(pg.evaluate("document.documentElement.dataset.scheme") == 'dark', 'Dark switches the app dark')
        bg = pg.evaluate("getComputedStyle(document.body).backgroundColor"); check(bg == 'rgb(15, 17, 21)', 'dark background applied ' + bg)
        pg.click('#lookPop [data-look-theme="violet"]'); time.sleep(0.4)
        acc = pg.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()"); check(acc == '#a78bfa', 'violet accent in dark: ' + acc)
        pg.screenshot(path=os.path.join(OUT, 'nav-dark-violet.png'))
        pg.click('#lookPop [data-look-mode="light"]'); time.sleep(0.3)
        acc = pg.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()"); check(acc == '#7c3aed', 'violet accent in light: ' + acc)
        pg.keyboard.press('Escape'); time.sleep(0.2)
        me = pg.evaluate("fetch('/api/auth?op=me').then(r=>r.json())")
        lk = (me.get('user') or {}).get('look') or {}
        check(lk.get('mode') == 'light' and lk.get('theme') == 'violet', f'saved on the account: {lk}')
        pg.goto(B + '#/settings/appearance'); pg.wait_for_selector('#lkStart', timeout=10000)
        check('Ocean' in pg.inner_text('#setBody') and 'Graphite' in pg.inner_text('#setBody'), 'Appearance page lists the themes')
        pg.select_option('#lkStart', 'audits'); time.sleep(0.6)
        pg.screenshot(path=os.path.join(OUT, 'nav-appearance.png'))
        # a new browser (no local memory) still gets the saved look and start page
        c2, pg2 = ctx(br, 'tokadmin1234567890abcdef')
        pg2.goto(B); pg2.wait_for_selector('#sideNav', timeout=20000); time.sleep(1.2)
        check(pg2.evaluate("document.documentElement.dataset.theme") == 'violet', 'another device gets the same theme')
        check(pg2.url.endswith('#/') or pg2.url == B, 'and opens on the chosen start page (Audits): ' + pg2.url)
        # reset for later runs
        pg.evaluate("fetch('/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'profile',name:'Admin',lookMode:'auto',lookTheme:'blue',startPage:'home'})})")
        c.close(); c2.close()
        # ---------- phone, member ----------
        c, mp = ctx(br, 'tokmember1234567890abcde', 390, 850)
        mp.goto(B); mp.wait_for_selector('.hm-hello', timeout=20000); time.sleep(1.2)
        check(mp.locator('#tabBar').is_visible(), 'phone: bottom tab bar shows')
        check(mp.locator('#sideNav').is_hidden(), 'phone: the menu is tucked away')
        check(mp.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), 'phone: Home has no sideways scroll')
        tb = mp.inner_text('#tabBar'); check('Home' in tb and 'Audits' in tb and 'More' in tb, 'phone: tab bar ' + tb.replace('\n', ' '))
        mp.screenshot(path=os.path.join(OUT, 'nav-phone-home.png'))
        mp.click('#btnNav'); time.sleep(0.4); check(mp.locator('#sideNav').is_visible(), 'phone: the burger opens the drawer')
        mp.screenshot(path=os.path.join(OUT, 'nav-phone-drawer.png'))
        mp.click('#sideNav a[data-nav="sites"]'); time.sleep(0.8)
        check(mp.locator('#sideNav').is_hidden(), 'phone: choosing a page closes the drawer')
        check(mp.locator('#tabBar a.active').first.inner_text().strip().startswith('Audits'), 'phone: tab bar follows the page')
        mp.click('#tbMore'); time.sleep(0.4); check(mp.locator('#sideNav').is_visible(), 'phone: More opens the drawer')
        mp.click('#navScrim', position={'x': 380, 'y': 400}); time.sleep(0.4); check(mp.locator('#sideNav').is_hidden(), 'phone: tapping outside closes it')
        check(mp.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), 'phone: Audits has no sideways scroll')
        mp.screenshot(path=os.path.join(OUT, 'nav-phone-audits.png'))
        c.close()
        check(not errors, 'no script errors ' + ' | '.join(errors[:3]))
        br.close()
finally:
    srv.terminate()
    for pat in ['[f]ixsite.mjs', '[f]akeredis.mjs', '[d]ev-server.js']: subprocess.run(['pkill', '-f', pat])
print('ALL PASS' if ok else 'SOME FAILED')
