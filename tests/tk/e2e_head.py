"""The audit header: Owner and Status, Open ▾, ⋯ More, Rescan — and nothing wrapping.
Usage: python3 -I e2e_head.py <app> <tests>"""
import json, os, subprocess, sys, urllib.request
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT = 3998, 8078
ADMIN = 'tokadmin1234567890abcdef'
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-head.log'), 'w'), text=True)
assert srv.stdout.readline().strip() == 'READY'
fails = []
def check(ok, what, extra=''):
    print(('PASS ' if ok else 'FAIL ') + what, extra if not ok else '')
    if not ok: fails.append(what)
def redis(*cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
finds = [{'id': 'f1', 'num': 1, 'code': 'TEL_MISMATCH', 'severity': 'critical', 'category': 'Contact info', 'message': 'Phone differs', 'path': '/', 'pages': ['/'], 'location': 'Body', 'selector': '#x', 'visibleOn': ['desktop'], 'found': '555'}]
site = {'id': 's1', 'siteId': 'abc123', 'host': 'ed.multiscreensite.com', 'businessName': 'PGC Wrap', 'findings': finds, 'addedByName': 'Reymark R',
        'backups': [{'name': 'R8RR_b4_audit', 'at': '2026-10-14T04:03:00Z', 'byName': 'Reymark R', 'ok': True}],
        'scan': {'state': 'complete', 'finishedAt': '2026-10-15T04:03:00Z', 'by': 'reymark@8bitcreative.com', 'pages': 32, 'ai': {'checked': 81, 'cached': 81, 'flagged': 0, 'text': {'blocks': 387, 'skipped': 503, 'flagged': 2}, 'proof': {'blocks': 1019, 'of': 1019, 'flagged': 17}, 'links': {'checked': 118, 'of': 284, 'flagged': 4}}}}
redis(['SET', 'dsa:site:s1', json.dumps(site)], ['HSET', 'dsa:fnum:s1', 'f1', '1'])
errs = []
with sync_playwright() as p:
    br = p.chromium.launch()
    for w, h, dev in [(1400, 900, 'desk'), (1100, 800, 'narrow'), (390, 844, 'phone')]:
        for scheme in (['dark', 'light'] if dev == 'desk' else ['dark']):
            ctx = br.new_context(viewport={'width': w, 'height': h}, color_scheme=scheme); ctx.add_cookies([{'name': 'dsa_sess', 'value': ADMIN, 'url': f'http://localhost:{APORT}'}])
            pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.goto(f'http://localhost:{APORT}/#/site/s1'); pg.wait_for_selector('#sRescan', timeout=20000); pg.wait_for_timeout(500)
            tag = f'{dev}-{scheme}'
            if dev != 'phone':
                top = lambda sel: pg.locator(sel).bounding_box()['y']
                check(abs(top('#sRescan') - top('#sOpen')) < 4 and abs(top('#sRescan') - top('#sAssign')) < 6, f'{tag}: owner, status, Open, ⋯ and Rescan sit on one row')
            check(pg.locator('.site-head .btn').count() <= 3, f'{tag}: three buttons in the header (Open, ⋯, Rescan)', pg.locator('.site-head .btn').count())
            meta = pg.inner_text('.sh-meta')
            check('abc123' in meta and 'Scanned' in meta and 'Backed up' in meta and 'Added by Reymark R' in meta, f'{tag}: one quiet line of facts under the title', meta)
            pg.screenshot(path=os.path.join(OUT, f'head-{tag}.png'))
            if dev == 'desk' and scheme == 'dark':
                pg.click('#sOpen'); pg.wait_for_selector('#popMenu')
                t = pg.inner_text('#popMenu')
                check('Editor' in t and 'Draft preview' in t and 'View as client' in t, 'Open ▾ lists the editor, previews and View as client', t)
                pg.screenshot(path=os.path.join(OUT, 'head-open.png'))
                pg.keyboard.press('Escape'); check(pg.locator('#popMenu').count() == 0, 'Escape closes the menu')
                pg.click('#sMore'); pg.wait_for_selector('#popMenu')
                t = pg.inner_text('#popMenu')
                check(all(x in t for x in ['Summary', 'Export CSV', 'Back up now', 'Audit exceptions', 'Send to Jaguars']), '⋯ lists summary, export, backup, exceptions and Jaguars', t)
                pg.screenshot(path=os.path.join(OUT, 'head-more.png'))
                pg.click('#sSum'); pg.wait_for_selector('.modal', timeout=8000)
                check(pg.locator('#popMenu').count() == 0, 'choosing an item closes the menu and runs it')
                pg.keyboard.press('Escape')
                check('Proofread 1019 blocks' in pg.inner_text('.scan-more summary') and 'AI reviewed' not in pg.inner_text('#tabBody'), 'the AI summary is one line; the details are folded away')
                check(not pg.locator('.ref-details').get_attribute('open') is not None, 'Reference data starts closed')
                pg.click('.ref-details summary'); pg.reload(); pg.wait_for_selector('.ref-details', timeout=20000)
                check(pg.locator('.ref-details').get_attribute('open') is not None, 'and stays open once opened')
            if dev == 'phone':
                check(pg.evaluate('document.documentElement.scrollWidth') <= w + 1, 'phone: fits')
            ctx.close()
    br.close()
check(not errs, 'no script errors', errs[:3])
srv.terminate()
print('ALL PASS' if not fails else 'SOME FAILED: ' + ', '.join(fails))
