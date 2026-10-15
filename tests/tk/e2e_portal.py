"""The client portal (update 114): overview with the website picture, analytics, website health
(domain, DNS records, outages, speed), enquiries, account, phone layout, safety, and per-client limits.
Usage: python3 -I e2e_portal.py <app> <tests>"""
import json, os, subprocess, sys, time, urllib.request, zlib, base64, re
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT, FPORT = 3998, 8078, 8095
ADMIN, CLIENT = 'tokadmin1234567890abcdef', 'tokclient1234567890abcde'
key = subprocess.run(['node', '-e', "const c=require('crypto');const {privateKey}=c.generateKeyPairSync('rsa',{modulusLength:2048});process.stdout.write(privateKey.export({type:'pkcs8',format:'pem'}))"], capture_output=True, text=True).stdout
sa = json.dumps({'client_email': 'site-auditor@proj.iam.gserviceaccount.com', 'private_key': key})
fk = subprocess.Popen(['node', os.path.join(OUT, 'fakeanalytics.mjs'), str(FPORT)], stdout=subprocess.DEVNULL)
env = dict(os.environ, DUDA_API_BASE=f'http://127.0.0.1:{FPORT}/api', DUDA_API_USERNAME='u', DUDA_API_PASSWORD='p', GOOGLE_SERVICE_ACCOUNT=base64.b64encode(sa.encode()).decode(),
           GOOGLE_TOKEN_URL=f'http://127.0.0.1:{FPORT}/token', GA_DATA_BASE=f'http://127.0.0.1:{FPORT}/ga', GSC_BASE=f'http://127.0.0.1:{FPORT}/gsc',
           PAGESPEED_API_KEY='testkey', PAGESPEED_BASE=f'http://127.0.0.1:{FPORT}/psi')
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-portal.log'), 'w'), text=True, env=env)
assert srv.stdout.readline().strip() == 'READY'
def redis(*cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
def pack(o):
    c = zlib.compressobj(9, zlib.DEFLATED, -15); return 'z1:' + base64.b64encode(c.compress(json.dumps(o).encode()) + c.flush()).decode()
def curl(path, tok, data=None, extra=()):
    a = ['curl', '-s', f'http://localhost:{APORT}{path}', '-H', f'Cookie: dsa_sess={tok}'] + list(extra)
    if data is not None: a += ['-H', 'Content-Type: application/json', '-H', f'Origin: http://localhost:{APORT}', '-d', json.dumps(data)]
    return subprocess.run(a, capture_output=True, text=True).stdout
print(subprocess.run(['node', os.path.join(OUT, 'seedleads.mjs'), APP], capture_output=True, text=True).stdout.strip())
now = int(time.time() * 1000); DAY = 86400000
png = base64.b64encode(open(os.path.join(OUT, 'prev-d0.png'), 'rb').read()).decode()
sites = [{'id': 'abc123', 'name': 'Buff & Beyond', 'domain': 'buffandbeyond.com', 'defaultDomain': 'buff.multiscreensite.com', 'published': '2026-10-01T10:00:00Z', 'first': '2025-03-01T10:00:00Z', 'labels': []},
         {'id': 'zzz999', 'name': 'Other Co', 'domain': 'other.example', 'published': '2026-10-01T10:00:00Z', 'first': '2025-03-01T10:00:00Z', 'labels': []}]
redis(['SET', 'dsa:dudasites', pack({'v': 2, 'at': now, 'count': 2, 'sites': sites, 'scope': 'published'})], ['SET', 'dsa:dudadrafts', pack({'v': 2, 'at': now, 'count': 0, 'sites': [], 'scope': 'unpublished'})],
      ['SET', 'dsa:thumb:abc123', json.dumps({'at': now, 'data': png})], ['SET', 'dsa:thumb:zzz999', json.dumps({'at': now, 'data': png})],
      ['HSET', 'dsa:domstat', 'abc123', json.dumps({'domain': 'buffandbeyond.com', 'status': 'ok', 'label': 'Working', 'detail': 'Fix the domain before auditing (TEAM WORDING)', 'checkedAt': now - 3600000, 'ms': 820,
        'ssl': {'days': 61, 'issuer': "Let's Encrypt", 'until': now + 61 * DAY}, 'reg': {'at': now, 'name': 'buffandbeyond.com', 'expires': now + 40 * DAY, 'registrar': 'GoDaddy.com, LLC'}, 'al': {'regm': 60}})],
      ['LPUSH', 'dsa:domev', json.dumps(['D', 'abc123', now - 20 * DAY, 'down']), json.dumps(['U', 'abc123', now - 20 * DAY + 3 * 3600000, '']), json.dumps(['D', 'zzz999', now - 5 * DAY, 'down'])],
      ['SET', 'dsa:dnsc:buffandbeyond.com', json.dumps({'at': now - 600000, 'host': 'buffandbeyond.com', 'reg': 'buffandbeyond.com', 'resolves': True, 'dnsBy': 'Cloudflare', 'mailBy': 'Google Workspace (Gmail)',
        'records': [{'type': 'A', 'name': 'buffandbeyond.com', 'value': '35.172.94.1'}, {'type': 'CNAME', 'name': 'www.buffandbeyond.com', 'value': 'buff.multiscreensite.com'},
                    {'type': 'NS', 'name': 'buffandbeyond.com', 'value': 'ada.ns.cloudflare.com'}, {'type': 'MX', 'name': 'buffandbeyond.com', 'value': 'aspmx.l.google.com', 'pri': 1}]})],
      ['HSET', 'dsa:anprov', 'abc123', json.dumps({'ga4': {'property': '123456789', 'by': 'reymark@8bitcreative.com', 'byName': 'Reymark Regencia'}, 'gsc': {'siteUrl': 'sc-domain:buffandbeyond.com', 'by': 'reymark@8bitcreative.com'}})])
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
errors = []
EMOJI = re.compile('[\U0001F300-\U0001FAFF☀-➿]')
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        # ---------------- the client, on a computer ----------------
        ctx = br.new_context(viewport={'width': 1440, 'height': 1000}, timezone_id='UTC')
        ctx.add_cookies([{'name': 'dsa_sess', 'value': CLIENT, 'domain': 'localhost', 'path': '/'}])
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: print('   console', m.text[:200]) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        pg.goto(f'http://localhost:{APORT}/#/my/s1/dashboard')
        pg.wait_for_function("() => location.hash === '#/my/s1/overview'", timeout=15000)
        check(True, 'an old address (dashboard) lands on the new Overview')
        pg.wait_for_selector('.cp-hero', timeout=15000)
        pg.wait_for_function("() => { const i = document.querySelector('.cp-shot img'); return i && i.complete && i.naturalWidth > 0; }", timeout=15000)
        check(True, 'the website\'s picture is shown on the Overview')
        hero = pg.inner_text('.cp-hero'); print('   hero:', hero.replace('\n', ' | ')[:400])
        check('Live and working' in hero and 'buffandbeyond.com' in hero, 'Overview says the website is live and working, with its domain')
        check('Domain renews by' in hero and 'GoDaddy' in hero and 'renew it before then' in hero, 'the domain renewal date and registrar are shown, with a reminder when it is under 60 days')
        check('Last published' in hero and 'Live since' in hero, 'when it was last published and launched')
        check('TEAM WORDING' not in pg.inner_text('body'), 'the team\'s own wording about the domain never reaches the client')
        pg.wait_for_function("() => { const t = [...document.querySelectorAll('.cp-tl')].find(x => /visits/i.test(x.textContent)); return t && !/…/.test(t.querySelector('.cl-t-v').innerText); }", timeout=20000)
        tiles = pg.text_content('.cl-tiles'); print('   tiles:', tiles.replace('\n', ' | '))
        check('Visits · 30 days' in tiles and 'Enquiries · 30 days' in tiles and 'Speed on mobile' in tiles and 'Open requests' in tiles, 'four headline tiles: visits, enquiries, speed, open requests')
        check(pg.locator('#cpOvChart svg').count() > 0, 'the last 30 days of visits are drawn')
        nav = pg.locator('.cp-nav .cp-link')
        labels = [nav.nth(i).inner_text().strip() for i in range(nav.count())]
        print('   menu:', labels)
        check(labels == ['Overview', 'Analytics', 'Website health', 'Enquiries', 'Requests', 'Comments', 'Edit website', 'Account'], 'the menu: Overview, Analytics, Website health, Enquiries, Requests, Comments, Edit website, Account')
        check(pg.locator('.cp-nav .cp-link svg').count() == 8 and not EMOJI.search(pg.inner_text('.cp-side')), 'every menu item has a line icon, and no emoji are left in the menu')
        check('Bob Owner' not in pg.inner_text('.cp-side') and 'Buff & Beyond' in pg.inner_text('.cp-brand'), 'the portal is branded with their company')
        pg.screenshot(path=os.path.join(OUT, 'portal-overview.png'), full_page=True)
        # ---- analytics ----
        pg.click('.cp-nav a[href$="/analytics"]'); pg.wait_for_selector('.an-tiles', timeout=20000); time.sleep(0.6)
        a = pg.inner_text('#clMain')
        check('Visits' in a and 'Visitors' in a and 'Page views' in a and 'Tapped to call' in a, 'Analytics: visits, visitors, page views and what visitors did')
        check(pg.locator('#cpAnDaily svg').count() > 0, 'visits per day are drawn')
        tabs = pg.inner_text('.an-tabs')
        check('Pages & sources' in tabs and 'Google search' in tabs, 'Google Analytics and Search Console appear as tabs when connected: ' + tabs.replace('\n', ' '))
        pg.click('[data-cptab="ga4"]'); time.sleep(0.5)
        g = pg.inner_text('#clMain')
        check('Most visited pages' in g and 'Organic' in g and 'Ads' in g, 'Pages & sources: the most visited pages, and organic vs ads')
        pg.click('[data-cptab="gsc"]'); time.sleep(0.5)
        s = pg.inner_text('#clMain')
        check('Average position' in s and 'Searches that found you' in s and '1 is the top of the first page' in s, 'Google search: the searches that found them and their average position, explained')
        body = pg.inner_text('body') + pg.content()
        check('iam.gserviceaccount.com' not in body and 'Reymark' not in body and '123456789' not in body, 'nothing about our Google account, who connected it, or the property id')
        pg.screenshot(path=os.path.join(OUT, 'portal-analytics.png'), full_page=True)
        pg.click('[data-cpdays="90"]'); pg.wait_for_function("() => document.querySelector('[data-cpdays=\"90\"]').classList.contains('active') && !!document.querySelector('.an-tiles')", timeout=20000)
        check(True, 'the range can be changed to 90 days')
        # ---- website health ----
        pg.click('.cp-nav a[href$="/health"]'); pg.wait_for_selector('.cp-dl', timeout=20000)
        pg.wait_for_selector('.h-gauges', timeout=30000); time.sleep(0.4)
        h = pg.inner_text('#clMain'); print('   health:', h.replace('\n', ' | ')[:500])
        check('Your domain' in h and 'Opens your website?' in h and 'Yes' in h and 'renewed automatically' in h, 'Website health: the domain works, and https renews by itself')
        check('DNS records' in h and 'Cloudflare' in h and 'Google Workspace' in h and 'aspmx.l.google.com' in h and 'Where email is delivered' in h, 'DNS records: where the website and email live, explained')
        check('ask your team before changing anything' in h, 'with a warning not to change them alone')
        check('Outages in the last 12 months' in h and 'back after 3 hours' in h, 'past outages listed, with how long they lasted')
        check('Speed' in h and 'Ready for Google' in h and 'Main content appears' in h, 'speed and quality scores from Google, in plain words (checked automatically on the first visit)')
        check(redis(['GET', 'dsa:psi:abc123'])[0] is not None and 'Weekly check' in redis(['GET', 'dsa:psi:abc123'])[0], 'the first check was stored as a Weekly check (nobody\'s name)')
        pg.screenshot(path=os.path.join(OUT, 'portal-health.png'), full_page=True)
        pg.reload(); pg.wait_for_selector('.h-gauges', timeout=20000); time.sleep(0.5)
        n1 = json.loads(urllib.request.urlopen(f'http://127.0.0.1:{FPORT}/__calls').read()).get('psi', 0)
        r = json.loads(curl('/api/client', CLIENT, {'op': 'healthRun', 'id': 's1'}))
        n2 = json.loads(urllib.request.urlopen(f'http://127.0.0.1:{FPORT}/__calls').read()).get('psi', 0)
        check(n1 == n2 and r.get('runs'), 'a client cannot make Google check again within the week')
        # ---- enquiries ----
        pg.click('.cp-nav a[href$="/enquiries"]'); pg.wait_for_selector('.cp-subtabs', timeout=15000); pg.wait_for_selector('#clEnq .cl-tiles', timeout=15000)
        check('Enquiries each month' in pg.inner_text('#clMain'), 'Enquiries opens on a summary with the monthly chart')
        pg.click('.cp-subtabs a:has-text("Form submissions")'); pg.wait_for_selector('.cl-leadlist', timeout=15000)
        check(pg.locator('.cl-lead').count() >= 4, 'Form submissions lists every enquiry')
        pg.click('.cp-subtabs a:has-text("People")'); pg.wait_for_selector('#clCt .ct-table', timeout=15000)
        check(pg.locator('#clCt .ct-row').count() == 2, 'People: the same two contacts, spam set aside')
        pg.goto(f'http://localhost:{APORT}/#/my/s1/contacts'); pg.wait_for_selector('#clCt .ct-table', timeout=15000)
        check(pg.url.endswith('/enquiries/people') and 'on' in pg.get_attribute('.cp-subtabs a:has-text("People")', 'class'), 'the old Contacts address opens People: ' + pg.url)
        # ---- account ----
        pg.click('.cp-nav a[href$="/account"]'); pg.wait_for_selector('#caForm', timeout=15000)
        vals = pg.evaluate("() => [...document.querySelectorAll('#caForm input')].map(i => i.value).join(' | ')")
        check('owner@buffandbeyond.com' in vals and 'Buff & Beyond' in vals and 'Bob Owner' in vals, 'Account shows their name, email and company: ' + vals)
        pg.fill('#caForm [name=phone]', '+1 (555) 010-2020'); pg.fill('#caForm [name=name]', 'Bob Owner Jr'); pg.click('#caForm button'); pg.wait_for_function("() => document.querySelector('#caOut').textContent === 'Saved'", timeout=8000)
        u = json.loads(redis(['GET', 'dsa:user:owner@buffandbeyond.com'])[0])
        check(u.get('phone') == '+1 (555) 010-2020' and u.get('name') == 'Bob Owner Jr', 'they can change their name and phone number')
        pg.uncheck('#caMail'); time.sleep(0.6)
        check(json.loads(redis(['GET', 'dsa:user:owner@buffandbeyond.com'])[0]).get('emailOff') is True, 'they can switch off emails about their requests')
        pg.check('#caMail'); time.sleep(0.6)
        pg.fill('#cpwForm [name=cur]', 'nope'); pg.fill('#cpwForm [name=pw]', 'newpassword1'); pg.fill('#cpwForm [name=pw2]', 'different99'); pg.click('#cpwForm button')
        check('not the same' in pg.inner_text('#cpwOut'), 'changing the password checks both new passwords match')
        pg.fill('#cpwForm [name=pw2]', 'newpassword1'); pg.click('#cpwForm button'); pg.wait_for_function("() => /correct/.test(document.querySelector('#cpwOut').textContent)", timeout=8000)
        check(True, 'and asks for the right current password: ' + pg.inner_text('#cpwOut'))
        check('Recent sign-ins' in pg.inner_text('#clMain') and pg.locator('#caLook [data-look-theme]').count() == 7, 'their own sign-in history and appearance are on Account')
        pg.click('#caLook [data-look-theme="teal"]'); time.sleep(0.6)
        check(json.loads(redis(['GET', 'dsa:user:owner@buffandbeyond.com'])[0]).get('lookTheme') == 'teal', 'a client\'s colour choice is saved to their account (it used to fail)')
        pg.screenshot(path=os.path.join(OUT, 'portal-account.png'), full_page=True)
        # ---- safety ----
        bad = curl('/api/client', CLIENT, {'op': 'profile', 'name': 'Bob', 'role': 'admin', 'sites': ['s1', 's2'], 'email': 'x@y.com', 'company': 'Hacked'})
        u = json.loads(redis(['GET', 'dsa:user:owner@buffandbeyond.com'])[0])
        check(u['role'] == 'client' and u['sites'] == ['s1'] and u['email'] == 'owner@buffandbeyond.com' and u.get('company') == 'Buff & Beyond', 'the profile save cannot change role, websites, email or company')
        redis(['SET', 'dsa:user:owner@buffandbeyond.com', json.dumps(dict(u, name='Bob Owner'))])
        for path in ['/api/client?op=site&id=s2', '/api/client?op=domain&id=s2', '/api/client?op=analytics&id=s2', '/api/client?op=health&id=s2']:
            check('Not found' in curl(path, CLIENT), f'another company\'s website is refused: {path}')
        check('Not found' in curl('/api/capture?op=thumb&id=s2', CLIENT) and 'Not found' in curl('/api/capture?op=thumb&site=zzz999', CLIENT), 'and so is its picture (by record id or by Duda id)')
        check('Not found' in curl('/api/client', CLIENT, {'op': 'healthRun', 'id': 's2'}), 'and its health check')
        d = curl('/api/client?op=domain&id=s1', CLIENT)
        check('zzz999' not in d and 'TEAM WORDING' not in d and '"al"' not in d, 'the domain answer holds only their own facts')
        # ---------------- the client, on a phone ----------------
        ph = br.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        ph.add_cookies([{'name': 'dsa_sess', 'value': CLIENT, 'domain': 'localhost', 'path': '/'}])
        mp = ph.new_page(); mp.on('pageerror', lambda e: errors.append(str(e)))
        mp.goto(f'http://localhost:{APORT}/#/my/s1/overview'); mp.wait_for_selector('.cp-hero', timeout=15000); time.sleep(1)
        tabs = [mp.locator('.cp-tab').nth(i).inner_text().strip() for i in range(mp.locator('.cp-tab').count())]
        check(tabs == ['Home', 'Analytics', 'Enquiries', 'Requests', 'More'] and mp.is_visible('.cp-tabs'), 'phone: a bottom bar with Home, Analytics, Enquiries, Requests and More: ' + str(tabs))
        check(not mp.is_visible('.cp-nav') and not mp.is_visible('.cp-fab'), 'phone: the side menu folds away; Overview uses its own Send a request button (no floating one covering it)')
        top = mp.evaluate("() => document.querySelector('.cp-hero [data-sendticket]').getBoundingClientRect().top")
        check(top < 844, f'phone: Send a request is on the first screen ({top:.0f}px)')
        mp.screenshot(path=os.path.join(OUT, 'portal-phone-overview.png'))
        mp.tap('#cpMore'); mp.wait_for_selector('.cp-more')
        more = mp.inner_text('.cp-more')
        check(all(w in more for w in ['Website health', 'Comments', 'Edit website', 'Account', 'Appearance', 'Sign out']), 'phone: More holds the rest, plus Appearance and Sign out')
        mp.screenshot(path=os.path.join(OUT, 'portal-phone-more.png'))
        mp.tap('.cp-more-i:has-text("Website health")'); mp.wait_for_selector('.cp-dl', timeout=15000); time.sleep(1)
        mp.screenshot(path=os.path.join(OUT, 'portal-phone-health.png'), full_page=True)
        for sec in ['overview', 'analytics', 'health', 'enquiries', 'enquiries/list', 'enquiries/people', 'requests', 'comments', 'edit', 'account']:
            mp.goto(f'http://localhost:{APORT}/#/my/s1/{sec}'); time.sleep(1.6)
            sw = mp.evaluate("() => document.documentElement.scrollWidth")
            check(sw <= 391, f'phone: {sec} fits the screen ({sw}px)')
        for scheme in ['dark']:
            mp.evaluate("() => { document.documentElement.dataset.scheme = 'dark'; }")
            mp.goto(f'http://localhost:{APORT}/#/my/s1/overview'); time.sleep(1.2)
            mp.screenshot(path=os.path.join(OUT, 'portal-phone-dark.png'))
        # ---------------- us, previewing ----------------
        tc = br.new_context(viewport={'width': 1440, 'height': 1000})
        tc.add_cookies([{'name': 'dsa_sess', 'value': ADMIN, 'domain': 'localhost', 'path': '/'}])
        tp = tc.new_page(); tp.on('pageerror', lambda e: errors.append(str(e)))
        tp.goto(f'http://localhost:{APORT}/#/site/s1/profile'); tp.wait_for_selector('#pfView', timeout=20000); tp.click('#pfView')
        tp.wait_for_selector('.cp-hero', timeout=15000)
        check(tp.url.endswith('#/my/s1/overview') and 'Viewing as Bob Owner' in tp.inner_text('.cl-preview'), 'View as client opens the new Overview (as the website\'s one customer)')
        tp.click('.cp-nav a[href$="/account"]'); tp.wait_for_selector('#caForm', timeout=15000)
        check('Preview' in tp.inner_text('#clMain') and tp.is_disabled('#caForm [name=name]') and 'reymark@' not in tp.inner_text('#clMain'), 'previewing, Account is read-only and shows none of our own details')
        pv = curl('/api/client', ADMIN, {'op': 'profile', 'name': 'X'}, ['-H', 'x-view-as-client: 1', '-H', 'x-view-site: s1'])
        check('Preview' in pv, 'and the server refuses to save anything while previewing')
        tp.click('#clExit'); tp.wait_for_function("() => location.hash === '#/customers'", timeout=10000)
        # ---------------- request limit for one client ----------------
        tp.goto(f'http://localhost:{APORT}/#/requests'); time.sleep(1.5)
        cfg = json.loads(curl('/api/tickets', ADMIN, {'op': 'settings', 'settings': {'daily': 10, 'over': {'owner@buffandbeyond.com': -1}}}))
        check(cfg['settings']['over'].get('owner@buffandbeyond.com') == -1, 'a client can be given No limit')
        q = json.loads(curl('/api/tickets?op=quota&site=s1', CLIENT))['quota']
        check(q.get('unlimited') is True and q.get('limit') is None, 'their quota then says unlimited')
        mp.goto(f'http://localhost:{APORT}/#/my/s1/requests'); mp.wait_for_selector('.cl-tk-bar', timeout=15000); time.sleep(0.5)
        check('No daily limit' in mp.inner_text('.cl-tk-bar'), 'and the client sees "No daily limit"')
        cfg = json.loads(curl('/api/tickets', ADMIN, {'op': 'settings', 'settings': {'daily': 10, 'over': {'owner@buffandbeyond.com': 500}}}))
        q = json.loads(curl('/api/tickets?op=quota&site=s1', CLIENT))['quota']
        check(cfg['settings']['over'].get('owner@buffandbeyond.com') == 500 and q['limit'] == 500, 'or any number in the hundreds (500 a day)')
        cfg = json.loads(curl('/api/tickets', ADMIN, {'op': 'settings', 'settings': {'daily': 99999, 'over': {'owner@buffandbeyond.com': 99999}}}))
        check(cfg['settings']['daily'] == 10000 and cfg['settings']['over']['owner@buffandbeyond.com'] == 10000, 'limits stop at 10,000')
        tp.evaluate("() => location.hash = '#/requests'"); time.sleep(1)
        b = tp.locator('button:has-text("settings"), button:has-text("Settings")')
        opened = False
        for i in range(b.count()):
            try:
                b.nth(i).click(timeout=2000); tp.wait_for_selector('#tsDaily', timeout=3000); opened = True; break
            except Exception: pass
        if opened:
            tp.select_option('#tsOvWho', 'other@elsewhere.com'); time.sleep(0.3)
            tp.check('[data-ovu="other@elsewhere.com"]'); time.sleep(0.2)
            check(tp.is_disabled('[data-ov="other@elsewhere.com"]'), 'settings: ticking No limit greys out the number')
            tp.screenshot(path=os.path.join(OUT, 'portal-limit-settings.png'))
            tp.click('#tsSave'); time.sleep(0.8)
            got = json.loads(redis(['GET', 'dsa:tkcfg'])[0])['over']
            check(got.get('other@elsewhere.com') == -1, 'and Save stores it as unlimited')
        else:
            check(False, 'could not open the request settings')
        curl('/api/tickets', ADMIN, {'op': 'settings', 'settings': {'daily': 10, 'over': {}}})
        # sign out from the menu (last: it ends this test login)
        pg.goto(f'http://localhost:{APORT}/#/my/s1/overview'); pg.wait_for_selector('#cpOut', timeout=15000)
        pg.click('#cpOut'); pg.wait_for_selector('body.auth-mode', timeout=10000)
        check(not pg.evaluate("() => document.body.classList.contains('client-mode')"), 'Sign out is in the menu and works')
        check(not errors, 'no script errors ' + ' | '.join(errors[:3]))
except Exception as e:
    import traceback; traceback.print_exc(); ok = False
finally:
    srv.terminate(); fk.terminate()
print('ALL PASS' if ok else 'SOME FAILED')
sys.exit(0 if ok else 1)
