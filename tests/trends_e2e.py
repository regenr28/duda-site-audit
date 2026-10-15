"""End-to-end test of the Trends tab, publish history, domain sweep and alerts.
Usage: python3 -I trends_e2e.py <app dir> <tests dir>
"""
import hashlib, json, os, random, subprocess, sys, time, urllib.request
from datetime import datetime, timezone, timedelta
from playwright.sync_api import sync_playwright

APP, TESTS = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
RPORT, APORT, DPORT, WPORT = 8079, 3999, 8085, 8091
ME = 'reymark@8bitcreative.com'; TOKEN = 'testtoken1234567890abcdef'
DAY = 86400.0
NOW = time.time()
rnd = random.Random(7)

def iso(t): return datetime.fromtimestamp(t, timezone.utc).strftime('%Y-%m-%dT%H:%M:%S')
# ---- the fake account ----
published, unpublished = [], []
def mk(i, first, last, domain):
    created = first - rnd.uniform(5, 90) * DAY if first else NOW - rnd.uniform(5, 400) * DAY
    return {'site_name': f's{i:04d}', 'site_domain': domain, 'site_default_domain': f's{i:04d}.duda-sites.test', 'publish_status': 'PUBLISHED' if last else 'UNPUBLISHED',
            'first_published_date': iso(first) if first else None, 'last_published_date': iso(last) if last else None, 'creation_date': iso(created),
            'site_business_info': {'business_name': f'Detailer {i}'}, 'labels': []}
i = 0
for _ in range(320):           # live: launches grow over four years
    age = (rnd.random() ** 1.6) * 4 * 365 * DAY
    first = NOW - age - 3600; last = min(NOW - 600, first + rnd.uniform(0, age))
    dom = '' if rnd.random() < 0.15 else f'detailer{i}.example'
    published.append(mk(i, first, last, dom)); i += 1
for _ in range(40):            # was live, now unpublished
    age = rnd.uniform(60, 3 * 365) * DAY
    first = NOW - age; last = first + rnd.uniform(0, age - 50 * DAY)
    x = mk(i, first, last, f'gone{i}.example'); x['publish_status'] = 'UNPUBLISHED'; unpublished.append(x); i += 1
for _ in range(150):           # never published
    unpublished.append(mk(i, None, None, '')); i += 1
# Three live websites on real (loopback) addresses, for the daily check: one broken, two fine.
for k, host in enumerate(['127.0.0.2', '127.0.0.3', '127.0.0.4']):
    published[k]['site_domain'] = f'{host}:{WPORT}'
fx = {'published': published, 'unpublished': unpublished}
json.dump(fx, open(os.path.join(TESTS, 'fixture.json'), 'w'))

def redis(*cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
def rcount(): return json.loads(urllib.request.urlopen(f'http://127.0.0.1:{RPORT}/__count').read())['count']
def http(method, path, body=None, headers=None):
    req = urllib.request.Request(f'http://127.0.0.1:{APORT}{path}', data=json.dumps(body).encode() if body is not None else None, method=method, headers=dict({'Content-Type': 'application/json'}, **(headers or {})))
    try: r = urllib.request.urlopen(req, timeout=180); return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')

procs = []
procs.append(subprocess.Popen(['node', os.path.join(TESTS, 'fakeredis.mjs'), str(RPORT)], stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT))
procs.append(subprocess.Popen(['node', os.path.join(TESTS, 'fakeduda.mjs'), os.path.join(TESTS, 'fixture.json'), str(DPORT), str(WPORT)], stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT))
time.sleep(2.5 if os.environ.get('FAKE_PG') else 0.8)
redis(['SET', 'dsa:cwcfg', '{"off": true}'], ['SADD', 'dsa:users', ME],
      ['SET', 'dsa:user:' + ME, json.dumps({'email': ME, 'name': 'Reymark R', 'role': 'admin', 'status': 'active', 'createdAt': '2026-01-01T00:00:00Z'})],
      ['SET', 'dsa:sess:' + hashlib.sha256(TOKEN.encode()).hexdigest(), ME], ['SET', 'dsa:hookkey', 'k'])
env = dict(os.environ, KV_REST_API_URL=f'http://127.0.0.1:{RPORT}', KV_REST_API_TOKEN='x', PORT=str(APORT), ADMIN_EMAILS=ME, SUGGESTIONS_OWNER=ME,
           DUDA_API_BASE=f'http://127.0.0.1:{DPORT}/api', DUDA_API_USERNAME='u', DUDA_API_PASSWORD='p', DOMAIN_CHECK_PROTOCOL='http', TZ='UTC')
log = open(os.path.join(TESTS, 'server-trends.log'), 'w')
procs.append(subprocess.Popen(['node', os.path.join(APP, 'dev-server.js')], env=env, stdout=log, stderr=subprocess.STDOUT))
time.sleep(1.2)

# ---- domain checks already on file: mostly working, a few problems, some about to expire ----
live_dom = [s for s in published if s['site_domain']]
cmds = []
for k, s in enumerate(live_dom):
    if s['site_domain'].startswith('127.'):
        cmds.append(['HSET', 'dsa:domstat', s['site_name'], json.dumps({'domain': s['site_domain'], 'status': 'ok', 'label': 'Working', 'checkedAt': int((NOW - 3 * DAY) * 1000)})]); continue
    st = 'ok'; extra = {}
    if k % 37 == 5: st = 'dns'
    elif k % 41 == 7: st = 'redirect'
    elif k % 53 == 9: st = 'ssl'
    elif k % 61 == 3: st = 'timeout'
    if k % 29 == 4 and st == 'ok': extra['ssl'] = {'days': 9, 'until': int((NOW + 9 * DAY) * 1000), 'issuer': "Let's Encrypt"}
    if k % 31 == 6: extra['reg'] = {'at': int(NOW * 1000), 'name': s['site_domain'], 'expires': int((NOW + 18 * DAY) * 1000), 'registrar': 'GoDaddy.com, LLC'}
    cmds.append(['HSET', 'dsa:domstat', s['site_name'], json.dumps(dict({'domain': s['site_domain'], 'status': st, 'label': st, 'checkedAt': int(NOW * 1000)}, **extra))])
redis(*cmds)

# ---- what happened recently, delivered as Duda would ----
events = []
def ev(t, site, ts, data=None): events.append({'event_type': t, 'resource_data': {'site_name': site}, 'event_timestamp': int(ts * 1000), 'data': data or {}, 'source': {'type': 'EDITOR', 'account_name': 'x@8bitcreative.com'}})
for s in published:
    f = datetime.strptime(s['first_published_date'], '%Y-%m-%dT%H:%M:%S').replace(tzinfo=timezone.utc).timestamp()
    if NOW - f < 75 * DAY: ev('PUBLISH', s['site_name'], f, {'first_publish': True, 'republish': False})
rep_sites = rnd.sample([s for s in published], 120)
for s in rep_sites:
    for _ in range(rnd.randint(1, 4)): ev('PUBLISH', s['site_name'], NOW - rnd.uniform(1, 70) * DAY, {'first_publish': False, 'republish': True})
churn_recent = [s for s in unpublished if s['first_published_date']][:15]
for s in churn_recent: ev('UNPUBLISH', s['site_name'], NOW - rnd.uniform(2, 70) * DAY, int(NOW))
comeback = rnd.sample(published[10:], 5)
for s in comeback:
    ev('UNPUBLISH', s['site_name'], NOW - 50 * DAY, int(NOW)); ev('PUBLISH', s['site_name'], NOW - 30 * DAY, {'first_publish': False, 'republish': False})
events.sort(key=lambda e: e['event_timestamp'])
for k in range(0, len(events), 25):
    code, out = http('POST', '/api/hook?k=k', events[k:k + 25])
    assert code == 200, (code, out)
# Older history only the per-website feed kept (from before the Trends tab existed): ten publishes 100 days ago.
old_feed = published[40:50]
for s in old_feed:
    redis(['HSET', 'dsa:watch', s['site_name'], json.dumps({'id': s['site_name']})], ['RPUSH', 'dsa:sitefeed:' + s['site_name'], json.dumps({'type': 'PUBLISH', 'at': iso(NOW - 100 * DAY) + '.000Z', 'by': 'x'})])

# ---- the numbers the page should show (Last 12 months, custom domains only) ----
def ts(v): return datetime.strptime(v, '%Y-%m-%dT%H:%M:%S').replace(tzinfo=timezone.utc).timestamp() if v else None
nowd = datetime.fromtimestamp(NOW, timezone.utc)
m = nowd.month - 11; y = nowd.year
while m <= 0: m += 12; y -= 1
FROM = datetime(y, m, 1, tzinfo=timezone.utc).timestamp()   # the browser is pinned to UTC below
withdom = [s for s in published + unpublished if s['site_domain'] and s['first_published_date']]
exp = {
    'live': len([s for s in published if s['site_domain']]),
    'launched': len([s for s in withdom if ts(s['first_published_date']) >= FROM]),
    'unpub': len(set(s['site_name'] for s in churn_recent) | set(s['site_name'] for s in comeback if s['site_domain'])),
    'back': len([s for s in comeback if s['site_domain']]),
    'rep': len(set(s['site_name'] for s in rep_sites if s['site_domain']) | set(s['site_name'] for s in old_feed if s['site_domain'])),
}
exp['net'] = exp['launched'] + exp['back'] - exp['unpub']
print('expected:', exp)

ok = True
def check(cond, label):
    global ok
    print(('PASS ' if cond else 'FAIL ') + label); ok = ok and bool(cond)
def num(s): return int(''.join(ch for ch in s if ch.isdigit() or ch == '-') or 0)

try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx = br.new_context(timezone_id='UTC', viewport={'width': 1440, 'height': 1000})
        ctx.add_cookies([{'name': 'dsa_sess', 'value': TOKEN, 'domain': 'localhost', 'path': '/'}])
        pg = ctx.new_page(); errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'favicon' not in m.text else None)
        c0 = rcount()
        pg.goto(f'http://localhost:{APORT}/#/live/trends')
        pg.wait_for_selector('.tr-tiles', timeout=90000); pg.wait_for_timeout(1200)
        c1 = rcount()
        tiles = {pg.locator('.tr-tile').nth(k).locator('.tr-tile-l').inner_text(): pg.locator('.tr-tile').nth(k).locator('.tr-tile-v').inner_text() for k in range(pg.locator('.tr-tile').count())}
        print('   tiles:', tiles)
        check(num(tiles['Live now']) == exp['live'], f"Live now = {exp['live']}")
        check(num(tiles['Launched']) == exp['launched'], f"Launched in last 12 months = {exp['launched']}")
        check(num(tiles['Unpublished']) == exp['unpub'], f"Unpublished = {exp['unpub']}")
        check(num(tiles['Came back']) == exp['back'], f"Came back = {exp['back']}")
        check(num(tiles['Re-published']) == exp['rep'], f"Re-published (unique websites, incl. the old feed) = {exp['rep']}")
        check(num(tiles['Net change']) == exp['net'], f"Net change = {exp['net']}")
        check(pg.locator('#trMain svg .viz-line').count() >= 3 and pg.locator('#trBars svg .viz-bar').count() > 5, 'trend lines and comparison bars drawn')
        pg.screenshot(path=os.path.join(TESTS, 'tr-light.png'), full_page=True)
        # first visit copies the old feeds in once; the second costs only the reads
        pg.click('#trReload'); pg.wait_for_timeout(2500)
        c2 = rcount()
        print(f'   database commands: first open {c1 - c0} (includes the one-time copy and first pull), reload {c2 - c1}')
        check(c2 - c1 < 60, 'reopening the Trends tab costs only a handful of commands')

        # hover a point: the tooltip lists every series
        box = pg.locator('#trMain .viz-hit').bounding_box()
        pg.mouse.move(box['x'] + box['width'] - 30, box['y'] + 80); pg.wait_for_timeout(300)
        tip = pg.locator('#trMain .viz-tip').inner_text()
        check('Launched' in tip and 'Unpublished' in tip and 'Came back' in tip, 'hover tooltip lists all three series')
        # click a period → which websites
        pg.mouse.click(box['x'] + box['width'] - 30, box['y'] + 80); pg.wait_for_timeout(600)
        foc = pg.locator('#trFocus').inner_text()
        check('Launched' in foc and 'Re-published' in foc and 'Detailer' in foc, 'clicking a period lists the websites in it')
        pg.screenshot(path=os.path.join(TESTS, 'tr-focus.png'), full_page=True)
        # weekly / yearly / all time / custom / table
        pg.click('[data-tpre="30d"]'); pg.wait_for_timeout(500)
        check(pg.locator('#trGran').input_value() == 'week', 'Last 30 days switches to weekly')
        pg.click('[data-tpre="all"]'); pg.wait_for_timeout(500)
        pg.select_option('#trGran', 'year'); pg.wait_for_timeout(500)
        all_launched = num(pg.locator('.tr-tile').nth(1).locator('.tr-tile-v').inner_text())
        check(all_launched == len(withdom), f'All time, yearly: every launch counted ({len(withdom)})')
        pg.click('[data-tpre="custom"]'); pg.wait_for_timeout(400)
        pg.fill('#trFrom', (nowd - timedelta(days=60)).strftime('%Y-%m-%d')); pg.dispatch_event('#trFrom', 'change'); pg.wait_for_timeout(400)
        check(pg.locator('#trFrom').count() == 1 and pg.locator('#trMain svg').count() == 1, 'custom date range draws')
        pg.click('#trTable'); pg.wait_for_timeout(400)
        check(pg.locator('.tr-table tbody tr').count() > 0, 'table view shows every period')
        pg.click('#trTable'); pg.wait_for_timeout(300)
        pg.uncheck('#trCustom'); pg.wait_for_timeout(400)
        check(num(pg.locator('.tr-tile').nth(0).locator('.tr-tile-v').inner_text()) == len(published), 'unticking "custom domain only" counts every live website')
        pg.check('#trCustom'); pg.wait_for_timeout(300)
        # health bar → list
        pg.click('[data-tpre="12m"]'); pg.wait_for_timeout(400)
        pg.click('[data-hk="dns"]'); pg.wait_for_timeout(1500)
        check(pg.url.endswith('#/live') and pg.locator('#liveDom').input_value() == 'problem', 'domain health bar opens the list filtered to problems')
        pg.select_option('#liveDom', 'expiring'); pg.wait_for_timeout(800)
        rows = pg.locator('table.live-table tbody tr').count()
        check(rows > 0 and pg.locator('.dom-warn').count() >= rows, f'"Certificate or domain expiring" filter lists {rows} websites with their warning shown')
        pg.screenshot(path=os.path.join(TESTS, 'tr-list.png'), full_page=False)

        # ---- Leaderboards ----
        # two client comments and one team comment on one website, in Duda's conversation index
        b36 = lambda t: __import__('numpy').base_repr(int(t), 36).lower() if False else ''.join('0123456789abcdefghijklmnopqrstuvwxyz'[d] for d in (lambda n: [int(x) for x in __import__('numpy').base_repr(n, 36)] if False else None)(0) or []) 
        def to36(n):
            a = '0123456789abcdefghijklmnopqrstuvwxyz'; o = ''
            while n: o = a[n % 36] + o; n //= 36
            return o or '0'
        t1 = to36(int(NOW - 2 * DAY)); t2 = to36(int(NOW - DAY))
        redis(['HSET', 'dsa:convidx', 'c1', json.dumps({'s': published[5]['site_name'], 'n': 1, 'live': 3, 'tl': f'{t1}|owner@client.com,{t2}|owner@client.com,{t2}|{ME}'})])
        pg.goto(f'http://localhost:{APORT}/#/live/ranks'); pg.wait_for_selector('.rk-grid', timeout=60000); time.sleep(2.5)
        check('DR Websites' in pg.inner_text('#sideNav') and 'Live DR Sites' not in pg.inner_text('#sideNav'), 'the menu says DR Websites')
        check('Live DR Sites' in pg.inner_text('.tabs') and 'Leaderboards' in pg.inner_text('.tabs'), 'inside it: the Live DR Sites tab, and a new Leaderboards tab')
        pg.click('[data-rkp="30d"]'); time.sleep(2.5)
        rt = pg.inner_text('.rk-grid')
        check('Most updated' in rt and '🥇' in rt and 'Fastest launches' in rt, 'most updated and fastest launches ranked, with medals')
        cm = pg.locator('.rk-card', has_text='Most client comments').inner_text()
        print('   comments card:', cm.replace('\n', ' | '))
        check('Detailer 5' in cm and '2 | comments' in cm.replace('\n', ' | '), 'most client comments: counts the client\'s comments, not the team\'s')
        check('analysis database' in pg.locator('.rk-card', has_text='Most enquiries').inner_text(), 'enquiries say plainly what they need when the analysis database is not connected')
        pg.click('[data-rkp="custom"]'); time.sleep(0.4)
        check(pg.locator('#rkFrom').count() == 1, 'custom range has date pickers')
        pg.screenshot(path=os.path.join(TESTS, 'rk.png'), full_page=True)
        # ---- Domain monitoring cards ----
        pg.goto(f'http://localhost:{APORT}/#/live/trends'); pg.wait_for_selector('.dm-cards', timeout=60000); pg.wait_for_timeout(800)
        exp_n = len([1 for k, x in enumerate(live_dom) if not x['site_domain'].startswith('127.') and k % 31 == 6])
        cert_n = len([1 for k, x in enumerate(live_dom) if not x['site_domain'].startswith('127.') and k % 29 == 4 and not (k % 37 == 5 or k % 41 == 7 or k % 53 == 9 or k % 61 == 3)])
        card = lambda key: num(pg.locator(f'[data-dm="{key}"] .dm-v').inner_text())
        print('   cards:', {k: card(k) for k in ['exp', 'redir', 'down', 'unp', 'unk', 'cert']}, 'expected exp', exp_n, 'cert', cert_n)
        check(card('exp') == exp_n, f'"Domain expiring" card = {exp_n} (domain registrations ending within 60 days)')
        check(card('cert') == cert_n, f'"Certificate ending" card = {cert_n}, shown as information only')
        check('Info only' in pg.locator('[data-dm="cert"]').inner_text() and 'Right now' in pg.locator('[data-dm="exp"] .dm-f').inner_text(), 'certificate card is marked information-only; expiring card says it ignores the date range')
        check('Follows the date range' in pg.locator('[data-dm="down"] .dm-f').inner_text(), 'down / redirected / unpublished cards say they follow the date range')
        pg.click('[data-dm="exp"]'); pg.wait_for_timeout(500)
        check(pg.locator('.dm-list tbody tr').count() == exp_n and 'Expires' in pg.locator('.dm-list').inner_text(), 'clicking the card lists those websites with their expiry date')
        pg.screenshot(path=os.path.join(TESTS, 'tr-dm.png'), full_page=True)
        pg.click('[data-dm="exp"]'); pg.wait_for_timeout(300)
        check(pg.locator('.dm-list').count() == 0, 'clicking again closes the list')
        pg.click('[data-dm="cert"]'); pg.wait_for_timeout(400)
        check('Duda renews' in pg.locator('.dm-list').inner_text(), 'the certificate list says Duda handles it')
        health_txt = pg.locator('#view').inner_text()
        check('Security certificate problem' not in health_txt and 'Certificate or domain expiring' not in health_txt, 'SSL no longer appears as a problem anywhere on the page')
        # dark mode
        dctx = br.new_context(timezone_id='UTC', viewport={'width': 1440, 'height': 1000}, color_scheme='dark')
        dctx.add_cookies([{'name': 'dsa_sess', 'value': TOKEN, 'domain': 'localhost', 'path': '/'}])
        dp = dctx.new_page(); dp.goto(f'http://localhost:{APORT}/#/live/trends'); dp.wait_for_selector('.tr-tiles', timeout=60000); dp.wait_for_timeout(1200)
        dp.screenshot(path=os.path.join(TESTS, 'tr-dark.png'), full_page=True)
        # phone width
        mp = dctx.new_page(); mp.set_viewport_size({'width': 390, 'height': 850}); mp.goto(f'http://localhost:{APORT}/#/live/trends'); mp.wait_for_selector('.tr-tiles', timeout=60000); mp.wait_for_timeout(1000)
        sw = mp.evaluate('document.documentElement.scrollWidth')
        wide = mp.evaluate('''() => [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > 392 && getComputedStyle(e).position !== 'fixed').slice(0, 12).map(e => e.tagName + '.' + (e.className && e.className.baseVal === undefined ? e.className : '') + '#' + e.id + ' ' + Math.round(e.getBoundingClientRect().right))''')
        print('   too wide:', wide)
        mp.goto(f'http://localhost:{APORT}/#/live'); mp.wait_for_timeout(1500)
        print('   (Live DR Sites list page at phone width, before this change:', mp.evaluate('document.documentElement.scrollWidth'), 'px)')
        mp.goto(f'http://localhost:{APORT}/#/live/trends'); mp.wait_for_selector('.tr-tiles', timeout=60000); mp.wait_for_timeout(800)
        vw = mp.evaluate('''() => [...document.querySelectorAll('#view *')].filter(e => !e.closest('.tabs, .table-wrap') && e.getBoundingClientRect().right > 392).map(e => e.tagName + '.' + e.className).slice(0, 8)''')
        check(not vw, f'phone width: everything in the Trends page fits {vw}')
        mp.screenshot(path=os.path.join(TESTS, 'tr-phone.png'), full_page=True)

        # ---- the daily check: nobody signed in ----
        code, out = http('GET', '/api/dudasites?op=sweep')
        print('   sweep:', code, out)
        check(code == 200 and out.get('checked') == 3, 'daily sweep checked the 3 domains due (the rest were checked today)')
        code2, out2 = http('GET', '/api/dudasites?op=sweep')
        check(out2.get('skipped'), 'a second call within 20 hours does nothing')
        notes = [json.loads(x) for x in redis(['LRANGE', 'dsa:notif:' + ME, 0, 20])[0]]
        dn = [n for n in notes if n.get('kind', '').startswith('domain-')]
        for n in dn: print('   🔔', n.get('kind'), '|', n.get('headline'))
        one = [n for n in dn if n['kind'] == 'domain-problem']
        check(len(one) == 1 and one[0]['dudaSite'] == published[0]['site_name'] and '503' in one[0]['text'] and one[0].get('urgent'), 'admin told, urgently, about the one domain that stopped working')
        dg = [n for n in dn if n['kind'] == 'domain-digest']
        check(len(dg) == 1 and 'Daily domain report' in dg[0]['headline'], 'and sent one daily report of everything still open')
        check(not any('ertificate' in n.get('text', '') for n in dn if n['kind'] != 'domain-digest'), 'no alert mentions the security certificate')
        # click it from the bell: it opens Live DR Sites on that website
        pg.goto(f'http://localhost:{APORT}/#/sites'); pg.reload(); pg.wait_for_timeout(2500)
        pg.click('#btnBell'); pg.wait_for_timeout(600)
        link = pg.locator('a.np-item').filter(has_text='domain problem').first
        href = link.get_attribute('href'); link.click(); pg.wait_for_timeout(2500)
        check(href == '#/live/site/' + published[0]['site_name'] and pg.locator('table.live-table tbody tr').count() == 1, f'bell link {href} opens that one website on the list')
        pg.screenshot(path=os.path.join(TESTS, 'tr-alert-row.png'), full_page=False)
        check(not errors, 'no browser errors' + ('' if not errors else ': ' + ' | '.join(errors[:4])))
        br.close()
finally:
    for pr in procs: pr.terminate()
    log.close()
print('ALL PASSED' if ok else 'SOME FAILED')
