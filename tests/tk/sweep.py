"""Every page on a phone and in dark mode: no sideways scroll, nothing cut off. Usage: python3 -I sweep.py <app> <tests>"""
import os, subprocess, sys, time, json
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]; OUT = os.path.join(TESTS, 'tk')
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
assert srv.stdout.readline().strip() == 'READY'
B = 'http://localhost:3998/'
PAGES = ['#/home', '#/', '#/projects', '#/live', '#/live/trends', '#/live/ranks', '#/requests', '#/comments', '#/analysis', '#/settings/team', '#/settings/appearance', '#/settings/security', '#/help', '#/about', '#/activity', '#/suggestions', '#/site/s1', '#/site/s1/profile', '#/site/s1/comments', '#/dr/abc123', '#/site/s1/profile/submissions', '#/site/s1/profile/contacts', '#/site/s1/profile/analytics', '#/site/s1/profile/presence', '#/dr/abc123/auto-audit']
CL = ['#/my/s1/overview', '#/my/s1/analytics', '#/my/s1/health', '#/my/s1/enquiries', '#/my/s1/enquiries/list', '#/my/s1/enquiries/people', '#/my/s1/requests', '#/my/s1/comments', '#/my/s1/edit', '#/my/s1/account']
bad = []; errors = []
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        for scheme in ['light', 'dark']:
            for (tok, pages, who) in [('tokadmin1234567890abcdef', PAGES, 'admin'), ('tokclient1234567890abcde', CL, 'client')]:
                c = br.new_context(viewport={'width': 390, 'height': 850}, color_scheme=scheme, has_touch=True, is_mobile=True)
                c.add_cookies([{'name': 'dsa_sess', 'value': tok, 'domain': 'localhost', 'path': '/'}])
                pg = c.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
                pg.goto(B + '#/home' if who == 'admin' else B + '#/my/s1/overview'); pg.wait_for_timeout(1800)
                for h in pages:
                    pg.goto(B + h); pg.wait_for_timeout(1300)
                    info = pg.evaluate("""() => { const w = innerWidth; const over = [];
                      document.querySelectorAll('body *').forEach((e) => { const r = e.getBoundingClientRect(); if (r.width && r.right > w + 2 && getComputedStyle(e).position !== 'fixed' && !e.closest('.sidenav, .tbl-wrap, .table-wrap, [style*="overflow"], .topnav, .cl-nav, .cp-tabs, .an-tabs, table, .tabs, .scroll-x')) over.push(e.tagName + '.' + String(e.className).slice(0, 30)); });
                      return { sw: document.documentElement.scrollWidth, w, over: over.slice(0, 4), scheme: document.documentElement.dataset.scheme }; }""")
                    flag = info['sw'] > info['w'] + 2
                    if flag: bad.append(f"{scheme} {who} {h}: scrollWidth {info['sw']} > {info['w']} {info['over']}")
                    if h in ('#/', '#/projects', '#/live', '#/settings/team', '#/my/s1/overview', '#/my/s1/health', '#/my/s1/account', '#/site/s1') or flag:
                        pg.screenshot(path=os.path.join(OUT, f"sw-{scheme}-{who}-{h.strip('#/').replace('/', '_') or 'audits'}.png"))
                c.close()
        br.close()
finally:
    srv.terminate()
    for pat in ['[f]ixsite.mjs', '[f]akeredis.mjs', '[d]ev-server.js']: subprocess.run(['pkill', '-f', pat])
print('\n'.join(bad) or 'no page scrolls sideways')
print('errors:', errors[:5])
