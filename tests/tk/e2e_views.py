"""Saved filters ("views"): tabs above the Audits list and DR Websites, built-in ones and anyone's own,
written as a query close to SQL (label = "SEO Customer" AND published < 7d). Usage: python3 -I e2e_views.py <app> <tests>"""
import json, os, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT = 3998, 8078
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-views.log'), 'w'), text=True)
assert srv.stdout.readline().strip() == 'READY'
def redis(*cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
def call(tok, method, path, body=None):
    req = urllib.request.Request(f'http://localhost:{APORT}{path}', data=json.dumps(body).encode() if body is not None else None, method=method, headers={'Content-Type': 'application/json', 'Cookie': 'dsa_sess=' + tok})
    try:
        r = urllib.request.urlopen(req); return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')
ADMIN, MEMBER = 'tokadmin1234567890abcdef', 'tokmember1234567890abcde'
iso = lambda h: time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() - h * 3600))
# Three published websites: two on Audits (s1 = abc123 labelled SEO Customer, s2 = zzz999), one not.
redis(['SET', 'dsa:dudadrafts', json.dumps({'v': 2, 'at': int(time.time() * 1000), 'count': 0, 'sites': []})])
redis(['SET', 'dsa:dudasites', json.dumps({'v': 2, 'count': 3, 'at': int(time.time() * 1000), 'sites': [
    {'id': 'abc123', 'name': 'Buff & Beyond', 'domain': 'buffandbeyond.com', 'published': iso(2), 'labels': ['SEO Customer', 'Style-Ivory']},
    {'id': 'zzz999', 'name': 'Other Co', 'domain': 'otherco.com', 'published': iso(240), 'labels': ['MFG - Autobahn Tint']},
    {'id': 'nnn777', 'name': 'Not Audited Detail', 'domain': 'notaudited.com', 'published': iso(30), 'labels': ['seo customer']}]})])
# s1 is assigned to the admin; s2 gets a comment from the admin (for "commented = me").
raw = redis(['GET', 'dsa:site:s1'])[0]; s1 = json.loads(raw); s1['assignee'] = 'reymark@8bitcreative.com'; redis(['SET', 'dsa:site:s1', json.dumps(s1)])
st, r = call(ADMIN, 'POST', '/api/store', {'op': 'comment', 'siteId': 's2', 'target': 'site', 'text': 'Checked the tint page'})
print('  comment:', st, str(r)[:120], flush=True)
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
errors = []
try:
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(viewport={'width': 1440, 'height': 1000})
        ctx.add_cookies([{'name': 'dsa_sess', 'value': ADMIN, 'domain': 'localhost', 'path': '/'}])
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('dialog', lambda d: d.accept())
        names = lambda: [x.strip() for x in pg.locator('table.grid tbody .site-name').all_inner_texts()]
        pg.goto(f'http://localhost:{APORT}/#/'); pg.wait_for_selector('.vtabs', timeout=20000); time.sleep(1.5)
        tabs = pg.inner_text('.vtabs')
        check(all(t in tabs for t in ['All', 'All open websites', 'Assigned to me', 'SEO Websites']) and '＋ New filter' in tabs, 'the Audits list has the built-in tabs: ' + tabs.replace(chr(10), ' '))
        pg.click('[data-vtab="seo"]'); time.sleep(0.6)
        n = names(); check(len(n) == 1 and n[0].startswith('Buff & Beyond'), f'SEO Websites shows only the website labelled SEO Customer: {n}')
        pg.click('[data-vtab="mine"]'); time.sleep(0.4)
        n = names(); check(len(n) == 1 and n[0].startswith('Buff & Beyond'), 'Assigned to me shows only my audit')
        pg.click('[data-vtab="all"]'); time.sleep(0.4)
        pg.select_option('#asort', 'name'); time.sleep(0.4)
        n = names(); check(len(n) == 2 and n[0].startswith('Buff') and n[1].startswith('Other'), 'the list sorts by name')
        pg.select_option('#asort', 'label'); time.sleep(0.4)
        n = names(); check(n[0].startswith('Other') and n[1].startswith('Buff'), 'the list sorts by label (MFG… before SEO…)')
        # ---- a filter of my own ----
        pg.click('[data-vnew]'); pg.wait_for_selector('#vfQ')
        res = lambda q: (pg.fill('#vfQ', q), pg.dispatch_event('#vfQ', 'input'), time.sleep(0.15), pg.inner_text('#vfRes'))[-1]
        tests = [
            ('commented = me', '1 of 2'), ('commented = "Reymark R"', '1 of 2'), ('assigned = nobody', '1 of 2'), ('assigned = me AND label contains seo', '1 of 2'),
            ('label = "seo customer" OR label contains autobahn', '2 of 2'), ('NOT label = "SEO Customer"', '1 of 2'), ('(name contains buff OR name contains other) AND published < 1d', '1 of 2'),
            ('published > 5d', '1 of 2'), ('added = empty', '2 of 2'), ('critical > 0', '0 of 2'), ('status != Complete', '2 of 2'), ('label = MFG - Autobahn Tint', '1 of 2'),
            ('republished = no', '2 of 2'), ('live = live', '2 of 2'), ('scanned = empty', '2 of 2'),
        ]
        for q, want in tests:
            got = res(q); check(want in got, f'query  {q}  →  {got.strip()}')
        bad = res('colour = red'); check('not something this list knows' in bad and pg.is_disabled('#vfSave'), 'an unknown field is explained, and the filter cannot be saved: ' + bad.strip()[:90])
        bad = res('published < soon'); check('not a date' in bad, 'a wrong date is explained: ' + bad.strip()[:80])
        # The helper adds a condition to the query.
        pg.fill('#vfQ', ''); pg.select_option('#vfF', 'label'); pg.select_option('#vfO', 'contains'); pg.fill('#vfV', 'SEO Customer'); pg.click('#vfAdd'); time.sleep(0.2)
        check(pg.input_value('#vfQ') == 'label contains "SEO Customer"' and '1 of 2' in pg.inner_text('#vfRes'), 'Add a condition writes it into the query: ' + pg.input_value('#vfQ'))
        pg.fill('#vfName', 'Commented by me'); pg.fill('#vfQ', 'commented = me'); pg.dispatch_event('#vfQ', 'input'); pg.check('#vfShare'); pg.select_option('#vfSort', 'name')
        pg.click('#vfSave'); time.sleep(1.0)
        check('Commented by me' in pg.inner_text('.vtabs') and 'Commented by me' in pg.inner_text('.vtab.on'), 'the new filter is a tab, and it is open')
        n = names(); check(len(n) == 1 and n[0].startswith('Other Co'), f'it shows the website I commented on: {n}')
        pg.screenshot(path=os.path.join(OUT, 'views-audits.png'))
        pg.reload(); pg.wait_for_selector('.vtabs', timeout=20000); time.sleep(1.5)
        check('Commented by me' in pg.inner_text('.vtab.on'), 'the open tab is remembered after a reload')
        # ---- the team: a shared filter shows for others; a private one does not; only the owner changes it ----
        st, mine = call(ADMIN, 'POST', '/api/store', {'op': 'viewSave', 'view': {'list': 'audits', 'name': 'Just mine', 'q': 'critical > 5'}})
        st, vs = call(MEMBER, 'GET', '/api/store?op=views')
        names_m = [v['name'] for v in vs.get('views', [])]
        check('Commented by me' in names_m and 'Just mine' not in names_m, f'another member sees the shared filter, not the private one: {names_m}')
        shared = [v for v in vs['views'] if v['name'] == 'Commented by me'][0]
        st, r = call(MEMBER, 'POST', '/api/store', {'op': 'viewSave', 'view': dict(shared, name='Hijacked')})
        st2, r2 = call(MEMBER, 'POST', '/api/store', {'op': 'viewRemove', 'id': shared['id']})
        check(st == 403 and st2 == 403, 'another member cannot change or delete it')
        # ---- DR Websites ----
        pg.goto(f'http://localhost:{APORT}/#/live'); pg.wait_for_selector('.live-table', timeout=20000); pg.wait_for_selector('.vtabs', timeout=10000); time.sleep(1)
        tabs = pg.inner_text('.vtabs')
        check('SEO Websites' in tabs and 'All' in tabs, 'DR Websites has tabs too: ' + tabs.replace(chr(10), ' '))
        pg.click('[data-vtab="seo"]'); time.sleep(0.6)
        rows = pg.locator('.live-table tbody tr').all_inner_texts()
        check(len(rows) == 2 and any('Buff & Beyond' in r for r in rows) and any('Not Audited Detail' in r for r in rows), f'SEO Websites lists both websites labelled SEO Customer (any capitals): {len(rows)}')
        pg.click('[data-vnew]'); pg.wait_for_selector('#vfQ')
        for q, want in [('audited = no', '1 of 3'), ('label = "SEO Customer" AND audited = no', '1 of 3'), ('published < 3d', '2 of 3'), ('published < 3d AND NOT label contains seo', '0 of 3'), ('name contains detail', '1 of 3'), ('commented = me', '1 of 3'), ('enquiries = 0', '3 of 3')]:
            got = res(q); check(want in got, f'DR query  {q}  →  {got.strip()}')
        pg.fill('#vfName', 'SEO not audited yet'); pg.fill('#vfQ', 'label = "SEO Customer" AND audited = no'); pg.dispatch_event('#vfQ', 'input'); pg.click('#vfSave'); time.sleep(1)
        rows = pg.locator('.live-table tbody tr').all_inner_texts()
        check(len(rows) == 1 and 'Not Audited Detail' in rows[0], 'a DR Websites filter of my own works')
        pg.select_option('#liveSort', 'label'); time.sleep(0.3)
        check(pg.locator('.live-table tbody tr').count() == 1, 'sorting keeps the filter')
        pg.screenshot(path=os.path.join(OUT, 'views-dr.png'))
        # Edit, then delete.
        pg.click('[data-vedit]'); pg.wait_for_selector('#vfDel'); pg.click('#vfDel'); time.sleep(1)
        check('SEO not audited yet' not in pg.inner_text('.vtabs') and 'All' in pg.inner_text('.vtab.on'), 'a filter can be deleted, and the list goes back to All')
        check(not errors, 'no script errors ' + ' | '.join(errors[:3]))
        br.close()
except Exception:
    import traceback; traceback.print_exc(); ok = False
finally:
    srv.terminate()
    for pat in ['[f]ixsite.mjs', '[f]akeredis.mjs', '[d]ev-server.js']: subprocess.run(['pkill', '-f', pat])
print('ALL PASS' if ok else 'SOME FAILED')
