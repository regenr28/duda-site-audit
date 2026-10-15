import os, subprocess, sys, time
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]; OUT = os.path.join(TESTS, 'tk')
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
assert srv.stdout.readline().strip() == 'READY'
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        c = br.new_context(viewport={'width': 1440, 'height': 900}); c.add_cookies([{'name': 'dsa_sess', 'value': 'tokadmin1234567890abcdef', 'domain': 'localhost', 'path': '/'}])
        pg = c.new_page(); pg.goto('http://localhost:3998/'); pg.wait_for_selector('.hm-hello'); time.sleep(2.5)
        pg.screenshot(path=os.path.join(OUT, 'home-desk-light.png'))
        br.close()
finally:
    srv.terminate()
    for pat in ['[f]ixsite.mjs', '[f]akeredis.mjs', '[d]ev-server.js']: subprocess.run(['pkill', '-f', pat])
