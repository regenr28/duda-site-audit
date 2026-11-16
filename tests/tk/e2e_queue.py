"""The team's one scan line, kept on the server: every open tab takes the next website from it, everybody sees
and drags the same order, and closing a tab in the middle of a scan hands it to another open tab. Usage: python3 -I e2e_queue.py <app> <tests>"""
import json, os, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT = 3998, 8078
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-queue.log'), 'w'), text=True)
assert srv.stdout.readline().strip() == 'READY'
def redis(*cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
ADMIN, MEMBER = 'tokadmin1234567890abcdef', 'tokmember1234567890abcde'
# A third website, so one has to wait (a tab scans two at a time).
for i, (sid, dud, nm) in enumerate([('s3', 'ccc333', 'Third Shop'), ('s4', 'ddd444', 'Fourth Shop'), ('s5', 'eee555', 'Fifth Garage'), ('s6', 'fff666', 'Sixth Wash'), ('s7', 'ggg777', 'Seventh Tint')]):
    redis(['SET', 'dsa:site:' + sid, json.dumps({'id': sid, 'siteId': dud, 'host': 'ed.multiscreensite.com', 'businessName': nm, 'findings': [], 'createdAt': f'2026-01-0{i + 1}T00:00:00Z'})],
          ['HSET', 'dsa:index', sid, json.dumps({'id': sid, 'siteId': dud, 'businessName': nm, 'createdAt': f'2026-01-0{i + 1}T00:00:00Z'})])
HELD = []   # page reads held back, so the scans stay busy
HELD2 = []
FREE = []   # once set, page reads fail straight away (the scans finish)
META = lambda sid: {'host': 'ed.multiscreensite.com', 'siteId': sid, 'site': {'site_business_info': {'business_name': 'Shop'}}, 'content': {}, 'pages': [{'path': '/', 'title': 'Home'}], 'errors': []}
def route(r, *rest, held=None):
    held = HELD if held is None else held
    p = r.request.url.split('?')[0]
    if p.endswith('/api/fetch'):
        if FREE and held is HELD2: return r.abort()
        held.append(r); return
    if p.endswith('/api/site'): return r.fulfill(status=200, content_type='application/json', body=json.dumps(META('x')))
    return r.continue_()
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
errors = []
def J(pg, url): return pg.evaluate("async (u) => (await fetch(u)).json()", url)
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx = br.new_context(viewport={'width': 1440, 'height': 1000}); ctx.add_cookies([{'name': 'dsa_sess', 'value': ADMIN, 'domain': 'localhost', 'path': '/'}])
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('dialog', lambda d: d.accept())
        pg.route('**/api/fetch**', route); pg.route('**/api/site**', route)
        pg.goto(f'http://localhost:{APORT}/#/'); pg.wait_for_selector('#rescanAll', timeout=20000); time.sleep(1)
        pg.click('#rescanAll')
        for _ in range(40):
            time.sleep(0.5)
            if len(HELD) >= 2: break
        time.sleep(1.5)
        L = J(pg, '/api/store?op=line')
        check(len(L['line']) == 5 and sum(1 for c in L['claims'].values() if c.get('item')) == 2, f"Rescan all puts the 7 websites in the server's line; this tab took 2 from the top ({len(L['line'])} waiting)")
        chip = pg.inner_text('#btnScans')
        check('2' in chip and '⏳ 5' in chip, 'the top bar shows 2 scanning and 5 waiting, on every page: ' + chip.replace(chr(10), ' '))
        pg.goto(f'http://localhost:{APORT}/#/'); pg.wait_for_selector('#scanBar', timeout=10000); time.sleep(0.5)
        bar = pg.inner_text('#scanBar')
        check('Scanning now (2)' in bar and 'this tab' in bar and "5 waiting in the team’s line" in bar, 'Audits says what is scanning, where, and what waits: ' + bar.replace(chr(10), ' ')[:180])
        pg.click('#scanBar [data-scanline]'); pg.wait_for_selector('#slBody .ln-row'); time.sleep(0.4)
        line = pg.inner_text('#slBody')
        order = pg.locator('#lnLine li a').all_inner_texts()
        print('  line:', order, flush=True)
        nums = pg.locator('#lnLine .ln-n').all_inner_texts()
        check(len(order) == 5 and nums == ['1', '2', '3', '4', '5'] and 'In line (5)' in line and pg.locator('#slBody .ln-n.now').count() == 2, 'the pop-up lists what is scanning (Now) and the one line, numbered')
        check('One line for the whole team' in line and 'Scanning for the line: this tab' in line, 'it says it is one line for the team, and which tabs are scanning for it')
        check('Reading Business Info' in line or 'Starting' in line, 'each scan says what it is doing')
        check('added by you' in line and 'Why: Rescan all shown (7)' in line and '👤 By hand · Rescan all' in line, 'each says who added it, why, and what kind')
        last = order[-1]
        pg.click('#lnLine li:last-child [data-lnfront]'); time.sleep(0.8)
        check(pg.locator('#lnLine li a').first.inner_text() == last and 'moved to 1 by Reymark R' in pg.inner_text('#lnLine'), f'Move to the front puts {last} first, and says who moved it')
        check(J(pg, '/api/store?op=line')['line'][0]['name'] == last, 'and the server keeps that order for everyone')
        third = pg.locator('#lnLine li a').nth(2).inner_text()
        pg.drag_and_drop('#lnLine li:nth-child(3)', '#lnLine li:nth-child(1)', target_position={'x': 40, 'y': 4}); time.sleep(1.2)
        check(pg.locator('#lnLine li a').first.inner_text() == third and J(pg, '/api/store?op=line')['line'][0]['name'] == third, f'dragging {third} to the top reorders the line, here and on the server')
        time.sleep(16)
        check(pg.locator('#lnLine li a').first.inner_text() == third, 'and the new order stays put (no snapping back)')
        # Take Buff & Beyond out, then Rescan it by hand: it goes ahead of the "Rescan all" ones.
        busy_ids = [k for k, c in J(pg, '/api/store?op=line')['claims'].items()]
        print('  scanning:', busy_ids, flush=True)
        pg.click('#slBody ol.ln-list li:has-text("Buff & Beyond") [data-cancelq]'); time.sleep(0.8)
        pg.click('[data-close]'); time.sleep(0.3)
        pg.click('table.grid tbody tr:has-text("Buff & Beyond") [data-rescan]'); time.sleep(2)
        pg.goto(f'http://localhost:{APORT}/#/site/s1'); pg.wait_for_selector('#scanStrip', timeout=15000); time.sleep(0.8)
        strip = pg.inner_text('#scanStrip')
        print('  strip:', strip.replace(chr(10), ' | ')[:300], flush=True)
        # Two websites somebody moved to the top stay there; the Rescan goes right after them, ahead of every other Rescan all.
        check('Number 3 of 5' in strip, 'a Rescan by hand goes ahead of Rescan all (after the two somebody moved to the top)')
        check("team’s scan line" in strip and 'Scanning now:' in strip, 'and the strip names what is scanning now')
        check(pg.inner_text('.sh-meta').count('Queued') == 0 or 'Scanning now' not in pg.inner_text('.sh-meta'), 'the header does not say Scanning now')
        check(pg.is_disabled('#sRescan') and 'number 3 of 5' in pg.inner_text('#sRescan'), 'Rescan says its place in the line instead')
        pg.screenshot(path=os.path.join(OUT, 'queue-why.png'))
        pg.goto(f'http://localhost:{APORT}/#/site/s3'); pg.wait_for_selector('#scanStrip', timeout=15000); time.sleep(0.5)
        if 'Number' in pg.inner_text('#scanStrip'):
            pg.click('[data-cancelq="s3"]'); time.sleep(1)
            check(pg.locator('#scanStrip').count() == 0 and not pg.is_disabled('#sRescan'), 'Take it out of the line: the website is no longer queued and Rescan is back')
        # A second tab (here the same person; a teammate works the same way) is another worker: it takes the next two.
        ctx2 = br.new_context(viewport={'width': 1440, 'height': 1000}); ctx2.add_cookies([{'name': 'dsa_sess', 'value': ADMIN, 'domain': 'localhost', 'path': '/'}])
        pg2 = ctx2.new_page(); pg2.on('pageerror', lambda e: errors.append('tab2: ' + str(e))); pg2.on('dialog', lambda d: d.accept())
        pg2.route('**/api/fetch**', lambda r, *a: route(r, held=HELD2)); pg2.route('**/api/site**', lambda r, *a: route(r, held=HELD2))
        pg2.goto(f'http://localhost:{APORT}/#/'); pg2.wait_for_selector('table.grid', timeout=20000)
        for _ in range(30):
            time.sleep(0.5)
            if len(HELD2) >= 2: break
        time.sleep(1)
        L = J(pg2, '/api/store?op=line')
        cids = {c['cid'] for c in L['claims'].values() if c.get('item')}
        check(len(cids) == 2 and len(L['claims']) == 4, f'the second tab took the next two from the line: 4 scanning in 2 tabs ({len(L["line"])} left)')
        pg2.click('#btnScans'); pg2.wait_for_selector('#slBody'); time.sleep(0.6)
        l2 = pg2.inner_text('#slBody')
        check('Scanning now (4)' in l2 and 'your other tab' in l2 and 'this tab' in l2, 'both tabs show the same line: 4 scanning, saying where each runs')
        pg2.screenshot(path=os.path.join(OUT, 'queue-line.png'))
        pg2.click('[data-close]')
        # Close the first tab in the middle of its two scans: they go straight back to the front of the line.
        pg.close(); time.sleep(1.5)
        L2 = J(pg2, '/api/store?op=line')
        back = [x for x in L2['line'] if x.get('back')]
        print('  after close:', [(x['name'], (x.get('back') or {}).get('why')) for x in L2['line']], flush=True)
        check(len(back) == 2 and L2['line'][0].get('back') and L2['line'][1].get('back') and len(L2['claims']) == 2, 'closing a tab mid-scan puts its 2 scans back at the front of the line at once')
        # The second tab finishes its own two, then takes the two that came back.
        backIds = [x['id'] for x in back]
        for r in HELD2[:]:
            try: r.abort()
            except Exception: pass
        HELD2.clear(); FREE.append(1)
        seen = {}
        for _ in range(60):
            time.sleep(0.5)
            L3 = J(pg2, '/api/store?op=line')
            for k, c in L3['claims'].items():
                if k in backIds: seen[k] = c
            if len(seen) == len(backIds): break
        check(len(seen) == 2 and all((c.get('item') or {}).get('back') for c in seen.values()), 'another open tab picks the stopped scans up and starts them again (and they say why)')
        pg2.wait_for_timeout(500)
        txt = pg2.evaluate("() => { const m = [...document.querySelectorAll('*')].length; return document.body.innerText; }")
        # A tab that crashed (no goodbye): its hold runs out and the scan goes back in line by itself.
        redis(['HSET', 'dsa:scanclaims', 's6x', json.dumps({'by': 'x@y', 'byName': 'Pat', 'cid': 'deadtab', 'state': 'scanning', 'until': 1000, 'k': 'bulk', 'item': {'k': 'bulk', 'why': 'Rescan all', 'name': 'Ghost Site', 'by': 'x@y', 'byName': 'Pat', 'at': '2026-11-16T00:00:00Z', 'o': 1}})])
        L4 = J(pg2, '/api/store?op=line')
        g = [x for x in L4['line'] if x['id'] == 's6x']
        check(g and g[0]['back']['why'] == 'stopped' and L4['line'][0]['id'] == 's6x', 'a scan whose tab stopped sending news goes back to the front of the line')
        pg2.evaluate("async () => fetch('/api/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'lineRemove', ids: ['s6x'] }) })")
        # A tab opened before this update keeps its own line: its websites move into the team's line.
        redis(['SET', 'dsa:site:s8', json.dumps({'id': 's8', 'siteId': 'hhh888', 'host': 'ed.multiscreensite.com', 'businessName': 'Old Tab Shop', 'findings': []})], ['HSET', 'dsa:index', 's8', json.dumps({'id': 's8', 'siteId': 'hhh888', 'businessName': 'Old Tab Shop'})])
        pg2.evaluate("async () => fetch('/api/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'scanClaim', ids: ['s8'], cid: 'oldtab123', state: 'queued' }) })")
        L5 = J(pg2, '/api/store?op=line')
        o = [x for x in L5['line'] if x['id'] == 's8']
        check(o and 'opened before an update' in o[0]['why'], "a website waiting in an older tab's own line is moved into the team's line, where it can be dragged")
        # Pause all auto audits: for everyone, until resumed.
        pg2.click('#btnScans'); pg2.wait_for_selector('#slBody'); time.sleep(0.5)
        time.sleep(1.5); sl = pg2.inner_text('#slBody'); print('  old:', sl.replace(chr(10), ' | ')[700:2500], flush=True)
        check('Old Tab Shop' in sl and 'older version' not in sl, 'it shows in the one line, not as a separate stuck tab')
        note = pg2.inner_text('#slBody .ln-auto')
        check('waiting for' in note and 'by the team' in note, 'auto audits wait by themselves while the team has scans going: ' + note.replace(chr(10), ' ')[:140])
        pg2.click('#slBody [data-autopause="1"]'); time.sleep(1)
        check('paused' in pg2.inner_text('#slBody .ln-auto') and 'Resume auto audits' in pg2.inner_text('#slBody .ln-auto'), 'Pause all auto audits: the line says who paused them, with Resume')
        ap = J(pg2, '/api/store?op=claims')['autoPause']
        check(ap and ap.get('on') and ap.get('byName') == 'Reymark R', 'the pause is kept for everyone (server)')
        pg2.click('#slBody [data-autopause="0"]'); time.sleep(1)
        check(not J(pg2, '/api/store?op=claims')['autoPause'], 'Resume turns them back on')
        pg2.click('[data-close]')
        for r in HELD2:
            try: r.abort()
            except Exception: pass
        # Time zone: everyone sees the app's dates in their own zone.
        st = pg2.evaluate("async () => (await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'profile', name: 'Reymark R', tz: 'America/Chicago' }) })).status")
        pg2.reload(); pg2.wait_for_selector('#btnMe', timeout=20000); time.sleep(1)
        shown = pg2.evaluate("() => new Date('2026-11-16T12:00:00Z').toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })")
        check(st == 200 and shown.startswith('6:00'), f'a time zone chosen in the account is used for every date in the app (noon UTC shows {shown} in Chicago)')
        pg2.click('#btnMe'); pg2.wait_for_selector('#meTz'); check(pg2.input_value('#meTz') == 'America/Chicago', 'the account shows the chosen time zone'); pg2.click('[data-close]')
        check(not errors, 'no script errors ' + ' | '.join(errors[:3]))
        br.close()
except Exception:
    import traceback; traceback.print_exc(); ok = False
finally:
    srv.terminate()
    for pat in ['[f]ixsite.mjs', '[f]akeredis.mjs', '[d]ev-server.js']: subprocess.run(['pkill', '-f', pat])
print('ALL PASS' if ok else 'SOME FAILED')
