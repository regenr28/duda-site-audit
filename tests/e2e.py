"""End-to-end test of bulk status + Recheck in a real browser.
Runs the app's own dev server against a fake database; Duda preview pages come from fixtures below.
Usage: python3 -I e2e.py <app dir> <tests dir>
"""
import hashlib, json, os, subprocess, sys, time, urllib.request, urllib.parse
from playwright.sync_api import sync_playwright

APP, TESTS = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
RPORT, APORT = 8079, 3999
ME = 'reymark@8bitcreative.com'
TOKEN = 'testtoken1234567890abcdef'
SITE_REF = 'f981a954'

def redis(*cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]

procs = []
procs.append(subprocess.Popen(['node', os.path.join(TESTS, 'fakeredis.mjs'), str(RPORT)], stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT))
time.sleep(2.5 if os.environ.get('FAKE_PG') else 0.8)
redis(['SADD', 'dsa:users', ME],
      ['SET', 'dsa:user:' + ME, json.dumps({'email': ME, 'name': 'Reymark R', 'role': 'admin', 'status': 'active', 'createdAt': '2026-01-01T00:00:00Z'})],
      ['SET', 'dsa:sess:' + hashlib.sha256(TOKEN.encode()).hexdigest(), ME])
env = dict(os.environ, KV_REST_API_URL=f'http://127.0.0.1:{RPORT}', KV_REST_API_TOKEN='x', PORT=str(APORT), ADMIN_EMAILS=ME, SUGGESTIONS_OWNER=ME)
log = open(os.path.join(TESTS, 'server.log'), 'w')
procs.append(subprocess.Popen(['node', os.path.join(APP, 'dev-server.js')], env=env, stdout=log, stderr=subprocess.STDOUT))
time.sleep(1.2)

# ---- fixture website: the phone on /contact can be "fixed" mid-test --------------------------------
fixed = {'contact': False}
def page_html(path, device):
    wrong = '(302) 999-1234'
    body = {
        '/': '<h1>Buff &amp; Beyond Detailing</h1><p>Call us on <a href="tel:3024217788">(302) 421-7788</a> or email <a href="mailto:hello@buffandbeyond.com">hello@buffandbeyond.com</a>.</p><a href="/contact">Contact</a> <a href="/about">About</a> <a href="/terms-of-service">Terms</a>',
        '/contact': '<h1>Contact Buff &amp; Beyond</h1><p class="ph">Phone: <a href="tel:%s">%s</a></p>' % (('3024217788', '(302) 421-7788') if fixed['contact'] else ('3028885555', '(302) 888-5555')),
        '/about': '<h1>About Buff &amp; Beyond</h1><p class="ph">Reach the shop on <a href="tel:3029991234">%s</a>.</p>' % wrong,
        '/terms-of-service': '<h1>Terms of service</h1><p>Questions about these terms: <a href="mailto:info@otherdetailer.com">info@otherdetailer.com</a></p>',
    }.get(path)
    if body is None:
        return {'status': 404, 'html': '<html><body data-page-alias="dmPageNotFound"></body></html>', 'url': ''}
    title = {'/': 'Home', '/contact': 'Contact', '/about': 'About', '/terms-of-service': 'Terms'}[path]
    html = f'<html><head><title>{title} | Buff &amp; Beyond</title><meta name="description" content="{title} page for Buff and Beyond detailing in Delaware."></head><body><div id="1666500107">{body}</div></body></html>'
    return {'status': 200, 'html': html, 'url': f'https://ed.test/site/{SITE_REF}{path}'}

DUDA_SITE = {'host': 'ed.test', 'siteId': SITE_REF,
             'site': {'site_business_info': {'business_name': 'Buff & Beyond'}, 'site_domain': ''},
             'content': {'location_data': {'phones': [{'phoneNumber': '(302) 421-7788'}], 'emails': [{'emailAddress': 'hello@buffandbeyond.com'}]}},
             'pages': [{'path': p, 'title': p, 'noIndex': False} for p in ['/', '/contact', '/about', '/terms-of-service']], 'errors': []}

fetched = []
def route(r):
    u = urllib.parse.urlparse(r.request.url); q = dict(urllib.parse.parse_qsl(u.query))
    p = u.path
    if p == '/api/fetch':
        fetched.append((q.get('path'), q.get('device')))
        return r.fulfill(status=200, content_type='application/json', body=json.dumps(page_html(q.get('path'), q.get('device'))))
    if p == '/api/site':
        return r.fulfill(status=200, content_type='application/json', body=json.dumps(DUDA_SITE))
    if p == '/api/ai' and r.request.method == 'GET':
        return r.fulfill(status=200, content_type='application/json', body=json.dumps({'enabled': False}))
    if p in ('/api/social', '/api/check'):
        return r.fulfill(status=200, content_type='application/json', body='[]' if p == '/api/check' else '{}')
    if p == '/api/imghash':
        return r.fulfill(status=200, content_type='application/json', body=json.dumps({'hashes': {}}))
    return r.continue_()

ok = True
def check(cond, label):
    global ok
    print(('PASS ' if cond else 'FAIL ') + label)
    ok = ok and bool(cond)

def site(pg, sid):
    return pg.evaluate("async (id) => (await fetch('/api/store?op=site&id=' + id)).json()", sid)

try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx = br.new_context(viewport={'width': 1500, 'height': 1000})
        ctx.add_cookies([{'name': 'dsa_sess', 'value': TOKEN, 'domain': 'localhost', 'path': '/'}])
        pg = ctx.new_page()
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('dialog', lambda d: d.accept())
        pg.route('**/api/**', route)
        pg.goto(f'http://localhost:{APORT}/')
        pg.wait_for_timeout(2500)
        made = pg.evaluate("""async () => (await fetch('/api/store', {method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({op: 'create', siteId: '%s', host: 'ed.test', editorUrl: 'https://ed.test/home/site/%s/home'})})).json()""" % (SITE_REF, SITE_REF))
        sid = made.get('id'); check(sid, 'website created')
        pg.goto(f'http://localhost:{APORT}/#/site/{sid}'); pg.wait_for_timeout(2000)
        pg.click('#sRescan')
        for _ in range(90):
            pg.wait_for_timeout(1000)
            s = site(pg, sid)
            if ((s.get('site') or s).get('scan') or {}).get('state') in ('complete', 'failed'): break
        s = site(pg, sid); S = s.get('site') or s
        check((S.get('scan') or {}).get('state') == 'complete', 'full scan completed')
        F = S.get('findings') or []
        for f in F: print(f"   #{f.get('num')} {f['code']:<22} {f.get('path')} · {f.get('found')}")
        phone_contact = next((f for f in F if f.get('path') == '/contact' and 'TEL' in f['code']), None)
        phone_about = next((f for f in F if f.get('path') == '/about' and 'TEL' in f['code']), None)
        email_terms = next((f for f in F if f.get('path') == '/terms-of-service' and 'MAILTO' in f['code']), None)
        check(phone_contact and phone_about and email_terms, 'scan raised the wrong phone on /contact and /about, and the wrong email on /terms-of-service')

        # ---- 1) single-item Recheck after fixing /contact in the "editor" ----
        pg.goto(f'http://localhost:{APORT}/#/site/{sid}/findings'); pg.wait_for_timeout(1500)
        fixed['contact'] = True; fetched.clear()
        pg.click(f'[data-recheck="{phone_contact["id"]}"]')
        for _ in range(40):
            pg.wait_for_timeout(500)
            if pg.locator('.toast').filter(has_text='Recheck').count(): break
        pg.wait_for_timeout(1200)
        pages_read = sorted(set(x[0] for x in fetched))
        print('   pages read by the recheck:', pages_read, f'({len(fetched)} fetches)')
        check(pages_read == ['/', '/contact'], 'recheck read only /contact (plus the home page), not the whole website')
        S = site(pg, sid); S = S.get('site') or S
        fc = next(f for f in S['findings'] if f['id'] == phone_contact['id'])
        check(fc.get('status') == 'done' and (fc.get('auto') or {}).get('why') == 'recheck-gone', 'fixed item closed as Done (recheck-gone)')
        fa = next(f for f in S['findings'] if f['id'] == phone_about['id'])
        check(fa.get('status') == 'open', 'unselected item on another page untouched')

        # ---- 2) tick two items: bulk bar + bulk Recheck (both still there) ----
        pg.goto(f'http://localhost:{APORT}/#/site/{sid}/findings'); pg.wait_for_timeout(1500)
        pg.check(f'[data-pick="{phone_about["id"]}"]'); pg.wait_for_timeout(300)
        pg.check(f'[data-pick="{email_terms["id"]}"]'); pg.wait_for_timeout(300)
        bar = pg.locator('#bulkBar')
        check(bar.count() == 1 and '2 selected' in bar.inner_text(), 'bulk bar shows "2 selected"')
        pg.screenshot(path=os.path.join(TESTS, 'shot-bulkbar.png'), full_page=False)
        fetched.clear()
        pg.click('#bulkRe')
        for _ in range(40):
            pg.wait_for_timeout(500)
            if pg.locator('.toast').filter(has_text='Recheck').count(): break
        toast = pg.locator('.toast').last.inner_text() if pg.locator('.toast').count() else ''
        print('   toast:', toast)
        pg.wait_for_timeout(1200)
        check(sorted(set(x[0] for x in fetched)) == ['/', '/about', '/terms-of-service'], 'bulk recheck read only the two items\' pages plus home')
        S = site(pg, sid); S = S.get('site') or S
        both = [next(f for f in S['findings'] if f['id'] == x['id']) for x in (phone_about, email_terms)]
        check(all(f.get('status') == 'open' and (f.get('recheck') or {}).get('r') == 'still' for f in both), 'both still there: left Open and marked "still"')
        pg.screenshot(path=os.path.join(TESTS, 'shot-after-recheck.png'), full_page=False)

        # ---- 3) bulk False alarm with one reason for both ----
        pg.goto(f'http://localhost:{APORT}/#/site/{sid}/findings'); pg.wait_for_timeout(1500)
        if pg.locator('#bulkBar').count() == 0:
            pg.check(f'[data-pick="{phone_about["id"]}"]'); pg.check(f'[data-pick="{email_terms["id"]}"]'); pg.wait_for_timeout(300)
        pg.select_option('#bulkSt', 'false'); pg.wait_for_timeout(600)
        check(pg.locator('#faReason').count() == 1, 'False alarm asks for the reason once')
        pg.fill('#faReason', 'Old test copy, not on the client site')
        if pg.locator('#faAllow').count(): pg.uncheck('#faAllow')
        pg.click('#faSave'); pg.wait_for_timeout(2500)
        S = site(pg, sid); S = S.get('site') or S
        both = [next(f for f in S['findings'] if f['id'] == x['id']) for x in (phone_about, email_terms)]
        check(all(f.get('status') == 'false' for f in both), 'both items now False alarm')
        cm = [c for c in (s.get('comments') if False else (site(pg, sid).get('comments') or [])) if 'Old test copy' in (c.get('text') or '')]
        check(len(cm) == 2, 'the one reason was posted on both items')
        check(pg.locator('#bulkBar').count() == 0, 'selection cleared once the items left the default list')

        # ---- 4) drawer has the Recheck button; a False alarm explains why it can't ----
        pg.goto(f'http://localhost:{APORT}/#/site/{sid}/item/{fc["num"]}'); pg.wait_for_timeout(1500)
        check(pg.locator('#drRecheck').count() == 1, 'item side panel shows "Recheck this item"')
        pg.screenshot(path=os.path.join(TESTS, 'shot-drawer.png'), full_page=False)
        # ---- 5) bell: a "comments waiting" notification opens that website's conversations ----
        iso = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() - 3 * 86400))
        redis(['HSET', 'dsa:watch', 'abc999', json.dumps({'id': 'abc999', 'name': 'Reflection Pro Services', 'firstSeen': iso, 'lastEvent': iso})],
              ['HSET', 'dsa:conv:abc999', 'cv1', json.dumps({'u': 'cv1', 'site': 'abc999', 'at': iso, 'num': 904, 'status': 'open', 'comments': [{'u': 'c1', 'text': 'attention Webdev', 'by': 'client@clientbiz.com', 'at': iso}], 'last': iso, 'lastBy': 'client@clientbiz.com', 'live': 1})],
              ['HSET', 'dsa:convidx', 'cv1', json.dumps({'s': 'abc999', 'n': 904, 'st': 'open', 'live': 1, 'la': iso, 'lb': 'client@clientbiz.com', 'tx': 'attention Webdev', 'tl': ''})],
              ['LPUSH', 'dsa:notif:' + ME, json.dumps({'id': 'nw1', 'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'kind': 'comment-waiting', 'by': '', 'byName': 'Reflection Pro Services', 'siteId': '', 'dudaSite': 'abc999', 'headline': 'Comments waiting', 'text': '#904 · 72h · desktop — attention Webdev', 'count': 1})])
        print('   stored notifs:', [json.loads(x).get('kind') for x in redis(['LRANGE', 'dsa:notif:' + ME, 0, 5])[0]])
        pg.goto(f'http://localhost:{APORT}/#/sites'); pg.reload(); pg.wait_for_timeout(3000)
        print('   api notifs:', [n.get('kind') for n in pg.evaluate("async () => (await (await fetch('/api/store?op=notifs')).json()).items")])
        print('   pulse notifs:', [n.get('kind') for n in (pg.evaluate("async () => (await (await fetch('/api/pulse', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({notifs: true})})).json())").get('notifs') or {}).get('items', [])])
        print('   api notifs again:', [n.get('kind') for n in pg.evaluate("async () => (await (await fetch('/api/store?op=notifs')).json()).items")])
        pg.click('#btnBell'); pg.wait_for_timeout(800)
        item = pg.locator('a.np-item').filter(has_text='Reflection Pro Services').first
        href = item.get_attribute('href') if item.count() else None
        print('   bell link:', href)
        print('   panel:', (pg.locator('.notif-panel').inner_text()[:300] if pg.locator('.notif-panel').count() else 'NO PANEL').replace('\n',' | '))
        print('   hrefs:', pg.eval_on_selector_all('a.np-item', 'els => els.map(e => e.getAttribute("href"))')[:5])
        check(href == '#/comments/abc999', 'comments-waiting notification links to that website')
        if item.count(): item.click()
        pg.wait_for_timeout(2500)
        body = pg.locator('#view').inner_text()
        check('Pick a website' not in body and 'attention Webdev' in body, "clicking it opens the website's conversations, not the empty list")
        pg.screenshot(path=os.path.join(TESTS, 'shot-notif.png'), full_page=False)

        # ---- 6) the selection bar stays in reach while scrolling a long list ----
        pg.set_viewport_size({'width': 1300, 'height': 520})
        pg.goto(f'http://localhost:{APORT}/#/site/{sid}/findings'); pg.wait_for_timeout(1500)
        pg.select_option('#ffst', 'all'); pg.wait_for_timeout(800)
        first = pg.locator('[data-pick]').first; first.check(); pg.wait_for_timeout(400)
        pg.evaluate('window.scrollTo(0, document.body.scrollHeight)'); pg.wait_for_timeout(400)
        y0 = pg.evaluate('window.scrollY')
        tb = pg.evaluate("document.querySelector('.topbar').getBoundingClientRect().bottom")
        bb = pg.evaluate("(() => { const r = document.querySelector('#bulkBar').getBoundingClientRect(); return [r.top, r.bottom]; })()")
        print(f'   scrolled to {y0}px · top bar ends at {tb:.0f}px · selection bar at {bb[0]:.0f}–{bb[1]:.0f}px')
        check(y0 > 200 and tb - 1 <= bb[0] <= tb + 20, 'selection bar sticks just below the top bar after scrolling down')
        last = pg.locator('[data-pick]').last; last.check(); pg.wait_for_timeout(500)
        y1 = pg.evaluate('window.scrollY')
        check(abs(y1 - y0) < 5 and '2 selected' in pg.locator('#bulkBar').inner_text(), 'ticking a row near the bottom keeps the scroll position')
        pg.screenshot(path=os.path.join(TESTS, 'shot-sticky.png'), full_page=False)
        check(not errors, 'no browser errors' + ('' if not errors else ': ' + '; '.join(errors[:3])))
        br.close()
finally:
    for pr in procs: pr.terminate()
    log.close()
print('ALL PASSED' if ok else 'SOME FAILED')
