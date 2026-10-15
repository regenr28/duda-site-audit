"""Must-fix first, design polish after: fonts and duplicate photos on their own tab and counted apart.
Usage: python3 -I e2e_polish.py <app> <tests>"""
import json, os, subprocess, sys, time, urllib.request, zlib, base64
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT = 3998, 8078
TOK = 'tokadmin1234567890abcdef'
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-polish.log'), 'w'), text=True)
assert srv.stdout.readline().strip() == 'READY'
def redis(*cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
def api(path):
    req = urllib.request.Request(f'http://localhost:{APORT}{path}', headers={'Cookie': 'dsa_sess=' + TOK})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())
def F(i, code, sev, cat, msg, path='/'):
    return {'id': f'f{i}', 'num': i, 'code': code, 'severity': sev, 'category': cat, 'message': msg, 'path': path, 'pages': [path], 'location': 'Body', 'selector': f'#x{i}', 'visibleOn': ['desktop', 'tablet', 'mobile'], 'found': 'x'}
finds = [F(1, 'PHONE_MISMATCH', 'critical', 'Contact info', 'Phone number does not match Business Info'),
         F(2, 'META_DESC_MISSING', 'warning', 'Meta / SEO', 'No meta description', '/about'),
         F(3, 'LINK_BROKEN_INTERNAL', 'critical', 'Links', 'Broken link', '/services'),
         F(4, 'FONT_OFF_SYSTEM', 'warning', 'Design', '3 headings in Arial, which is not one of the website\'s fonts'),
         F(5, 'FONT_OFF_SYSTEM', 'warning', 'Design', 'Button text in Arial', '/about'),
         F(6, 'FONT_NOT_LOADED', 'info', 'Design', '"Lato" is used but the website never loads it'),
         F(7, 'IMAGE_DUPLICATE', 'warning', 'Images / Alt', 'The same photo is used 3 times'),
         F(8, 'META_DESC_LONG', 'info', 'Meta / SEO', 'Meta description is 167 chars (Google shows ~155)', '/blog'),
         F(9, 'ALT_LONG', 'info', 'Images / Alt', 'Alt text is very long (197 chars)', '/gallery'),
         F(10, 'GMB_ID_ONLY', 'info', 'Social', 'Google Business/Maps schema sameAs uses a Google place ID, so it can\'t be checked automatically'),
         F(11, 'GMB_ID_ONLY', 'info', 'Social', 'Google Business/Maps link uses a Google place ID, so it can\'t be checked automatically', '/about')]
finds[9]['found'] = 'https://www.google.com/maps?cid=2474968619657613427'
finds[10]['found'] = 'https://www.google.com/maps?cid=999'
now = '2026-10-14T03:15:00Z'
site = {'id': 's1', 'siteId': 'abc123', 'host': 'ed.multiscreensite.com', 'businessName': 'Velvet Auto Care', 'truth': {'domain': 'buffandbeyond.com'}, 'findings': finds,
        'scan': {'state': 'complete', 'finishedAt': now, 'pages': 32, 'cv': 999}}
st = lambda s: json.dumps({'status': s, 'updatedBy': 'reymark@8bitcreative.com', 'updatedAt': now})
redis(['SET', 'dsa:site:s1', json.dumps(site)],
      ['HSET', 'dsa:fstate:s1', 'f1', st('done'), 'f2', st('done'), 'f3', st('false'), 'f10', st('done'), 'f11', st('done')],
      ['SET', 'dsa:presence:abc123', json.dumps({'at': 1, 'listings': [{'platform': 'google', 'found': True, 'source': 'places', 'url': 'https://maps.google.com/?cid=2474968619657613427', 'name': 'Velvet Auto Care', 'address': '1 Main St, Schaumburg, IL', 'placeId': 'ChIJabc1234567890', 'notes': []}], 'recs': []})],
      ['HSET', 'dsa:fnum:s1', *sum([[f['id'], str(f['num'])] for f in finds], [])],
      # an index entry written before must-fix and polish were counted apart
      ['HSET', 'dsa:index', 's1', json.dumps({'id': 's1', 'siteId': 'abc123', 'businessName': 'Velvet Auto Care', 'status': 'In progress', 'scan': {'state': 'complete', 'finishedAt': now}, 'counts': {'critical': 0, 'warning': 4, 'info': 1, 'closed': 3, 'total': 7}})])
def pack(o):
    c = zlib.compressobj(9, zlib.DEFLATED, -15); return 'z1:' + base64.b64encode(c.compress(json.dumps(o).encode()) + c.flush()).decode()
nowms = int(time.time() * 1000)
dsites = [{'id': f'd{i}', 'name': f'Site {i}', 'domain': f'site{i}.com', 'published': f'2026-{1 + i % 9:02d}-1{i % 9}T10:00:00Z', 'first': f'202{4 + i % 3}-0{1 + i % 9}-0{1 + i % 8}T10:00:00Z', 'labels': []} for i in range(60)]
dsites.append({'id': 'abc123', 'name': 'Velvet Auto Care', 'domain': 'buffandbeyond.com', 'published': '2026-10-01T10:00:00Z', 'first': '2025-03-01T10:00:00Z', 'labels': []})
redis(['SET', 'dsa:dudasites', pack({'v': 2, 'at': nowms, 'by': 'x', 'count': len(dsites), 'sites': dsites, 'scope': 'published'})],
      ['SET', 'dsa:dudadrafts', pack({'v': 2, 'at': nowms, 'by': 'x', 'count': 0, 'sites': [], 'scope': 'unpublished'})])
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
errors = []
try:
    lst = api('/api/store?op=list')
    c = {s['id']: s for s in lst['sites']}['s1']['counts']
    print('   counts:', c)
    check(c.get('total') == 5 and c.get('closed') == 5 and c.get('pt') == 4 and c.get('pc') == 0 and c.get('po') == 4, 'an old summary is brought up to date on the next load: must-fix 5/5, polish 0/4')
    check(c.get('lt') == 2 and c.get('lo') == 2 and c.get('lc') == 0, 'title, description and alt-text lengths are counted apart too (lengths 0/2)')
    check(c.get('warning') == 0 and c.get('info') == 0 and c.get('critical') == 0, 'severity counts are must-fix only (the 4 font/photo items are not "4 warning")')
    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx = br.new_context(viewport={'width': 1440, 'height': 1000})
        ctx.add_cookies([{'name': 'dsa_sess', 'value': TOK, 'domain': 'localhost', 'path': '/'}])
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(f'http://localhost:{APORT}/#/'); pg.wait_for_selector('table.grid', timeout=20000); time.sleep(0.6)
        row = pg.locator('tr[data-open="s1"]').inner_text()
        print('   row:', row.replace('\n', ' | '))
        check('5/5' in row and 'Must-fix done' in row and 'Polish 0/4' in row and 'Lengths 0/2' in row, 'the Closed column says 5/5 ✓ Must-fix done, with Polish 0/4 and Lengths 0/2 underneath')
        check('📏 2 length' in row, 'open issues: a "2 length" count')
        check('🎨 4 polish' in row and 'warning' not in row, 'open issues: a "4 polish" count instead of warnings')
        check(pg.locator('#statMust .n').inner_text() == '1', 'a Must-fix done count at the top')
        pg.select_option('#fmust', 'crit'); time.sleep(0.3)
        check(pg.locator('tr[data-open="s1"]').count() == 0, 'filter: critical still open hides it')
        pg.select_option('#fmust', 'done'); time.sleep(0.3)
        check(pg.locator('tr[data-open="s1"]').count() == 1, 'filter: must-fix done shows it')
        pg.screenshot(path=os.path.join(OUT, 'polish-list.png'))
        pg.click('tr[data-open="s1"] .polish-line'); pg.wait_for_selector('table.findings', timeout=15000); time.sleep(0.4)
        check(pg.url.endswith('#/site/s1/polish'), 'Polish 0/4 opens the Design polish tab: ' + pg.url)
        tabs = pg.inner_text('.tabs')
        print('   tabs:', tabs.replace('\n', ' | '))
        check('Design polish' in tabs and pg.locator('.tabs a.on').inner_text().startswith('🎨 Design polish'), 'the audit has a Design polish tab, open now')
        rows = pg.locator('table.findings tbody tr[data-item]').count()
        check(rows == 4 and 'Phone number' not in pg.inner_text('table.findings'), f'it lists the 4 font and photo items and nothing else ({rows})')
        head = pg.inner_text('.polish-head')
        check('come after' in head and '4 open' in head and '3' in head and 'duplicate photo' in head, 'it opens with what it is and how much is left: ' + head.replace('\n', ' | '))
        top_head = pg.evaluate("document.querySelector('.polish-head').getBoundingClientRect().top"); top_list = pg.evaluate("document.querySelector('table.findings').getBoundingClientRect().top")
        check(top_list - top_head < 400 and pg.locator('#tabBody .panel-pad .scan-badge, #tabBody #aiCredits').count() == 0, 'the list is straight under it, not under the scan details and Business Info')
        check(pg.locator('.polish-ref').count() == 1 and pg.evaluate("document.querySelector('.polish-ref').getBoundingClientRect().top") > top_list, 'the fonts and pictures reference sits under the list')
        pg.screenshot(path=os.path.join(OUT, 'polish-tab.png'))
        pg.evaluate('window.scrollTo(0, 99999)'); time.sleep(0.2)
        pg.click('.tabs a[href="#/site/s1"]'); pg.wait_for_selector('.grp-note', timeout=15000); time.sleep(0.3)
        check(pg.evaluate("document.querySelector('.tabs').getBoundingClientRect().top") >= 0, 'changing tab while scrolled down brings the tabs back into view')
        check('Every audit item that affects the business is closed' in pg.inner_text('.grp-note') and 'Design polish' in pg.inner_text('.grp-note') and 'Lengths' in pg.inner_text('.grp-note') and '6 open' in pg.inner_text('.grp-note'), 'Audit items: all closed, and points at Design polish and Lengths (6 open)')
        pg.select_option('#ffst', 'all'); time.sleep(0.3)
        check(pg.locator('table.findings tbody tr[data-item]').count() == 5, 'Audit items (All) lists the 5 must-fix items only')
        gb = pg.inner_text('table.findings')
        check('Google confirms' in gb and 'Not this business' in gb, 'a Google Maps link naming only an ID is checked against Google\'s own listing: the right one confirmed, the wrong one called out')
        pg.click('.tabs a[href="#/site/s1/length"]'); pg.wait_for_selector('.length-head', timeout=15000); time.sleep(0.3)
        check(pg.locator('table.findings tbody tr[data-item]').count() == 2 and 'Lengths' in pg.inner_text('.length-head') and '1</b> meta description' in pg.inner_html('.length-head'), 'the Lengths tab lists the 2 length items under its own header')
        check(pg.url.endswith('/length'), 'with its own address')
        pg.click('.tabs a[href="#/site/s1"]'); time.sleep(0.4); pg.select_option('#ffst', 'all'); time.sleep(0.3)
        pg.goto(f'http://localhost:{APORT}/#/site/s1/item/6'); pg.wait_for_selector('#drawer', timeout=15000); time.sleep(0.4)
        check(pg.locator('.tabs a.on').inner_text().startswith('🎨 Design polish'), 'opening #6 by its number lands on the Design polish tab')
        pg.keyboard.press('Escape'); time.sleep(0.5)
        if pg.locator('#drawer').count(): pg.click('#drawer [data-close], #drClose')
        time.sleep(0.4)
        check(pg.url.endswith('#/site/s1/polish'), 'closing it goes back to the Design polish tab: ' + pg.url)
        pg.goto(f'http://localhost:{APORT}/#/site/s1/profile'); pg.wait_for_selector('.pf-cards', timeout=20000); time.sleep(0.4)
        ac = pg.locator('.pf-card', has_text='critical').first.inner_text()
        check('4 design polish' in ac and 'last scan' in ac, 'the profile\'s Audit card shows the polish count and the last scan: ' + ac.replace('\n', ' | '))
        # Trends: the date range stays at the top
        pg.goto(f'http://localhost:{APORT}/#/live/trends'); pg.wait_for_selector('.tr-filters', timeout=20000); time.sleep(0.6)
        check(pg.evaluate("getComputedStyle(document.querySelector('.tr-filters')).position") == 'sticky', 'Trends: the date range is pinned while scrolling')
        h = pg.evaluate('document.documentElement.scrollHeight')
        if h > 1300:
            pg.evaluate('window.scrollTo(0, 900)'); time.sleep(0.3)
            top = pg.evaluate("document.querySelector('.tr-filters').getBoundingClientRect().top"); tb = pg.evaluate("document.querySelector('.topbar').offsetHeight")
            check(abs(top - tb) <= 2, f'…and stays under the top bar after scrolling ({top} vs {tb})')
        mp = ctx.new_page(); mp.set_viewport_size({'width': 390, 'height': 850}); mp.on('pageerror', lambda e: errors.append(str(e)))
        mp.goto(f'http://localhost:{APORT}/#/site/s1/polish'); mp.wait_for_selector('table.findings', timeout=20000); time.sleep(0.5)
        check(mp.evaluate('document.documentElement.scrollWidth') <= 392, 'phone: the audit page still fits')
        check(not errors, 'no script errors ' + ' | '.join(errors[:3]))
        br.close()
except Exception:
    import traceback; traceback.print_exc(); ok = False
finally:
    srv.terminate()
    for pat in ['[f]ixsite.mjs', '[f]akeredis.mjs', '[d]ev-server.js']: subprocess.run(['pkill', '-f', pat])
print('ALL PASS' if ok else 'SOME FAILED')
