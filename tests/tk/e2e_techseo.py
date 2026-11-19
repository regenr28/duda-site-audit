"""Technical SEO (schema, robots.txt, sitemap.xml, llms.txt), automation emails, the NAP tab, and
"Apply check updates" (only the changed checks, nothing else re-run). Usage: python3 -I e2e_techseo.py <app> <tests>"""
import json, os, subprocess, sys, time, urllib.request, urllib.parse, zlib, base64
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT = 3998, 8078
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-techseo.log'), 'w'), text=True)
assert srv.stdout.readline().strip() == 'READY'
def redis(*cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
def unpack(raw):
    if raw and raw.startswith('z1:'): return json.loads(zlib.decompress(base64.b64decode(raw[3:]), -15))
    return json.loads(raw)
def pack(o):
    c = zlib.compressobj(9, zlib.DEFLATED, -15); return 'z1:' + base64.b64encode(c.compress(json.dumps(o).encode()) + c.flush()).decode()
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
errors = []
SCHEMA = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"LocalBusiness","name":"Buff & Beyond Auto Detailing","telephone":"(214) 555-0100"}</script><script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage",}</script>'
HOME = f'''<html><head><title>Home | Buff & Beyond Auto Detailing</title><meta name="description" content="Detailing in town."><link rel="icon" href="/f.ico">{SCHEMA}</head><body><div id="dmcontent"><h1>Buff & Beyond Auto Detailing</h1>
<p id="p1">Call us at <a href="tel:2145550100">(214) 555-0100</a>.</p><p id="p2">Write to <a href="mailto:iyzbheq0@robot.zapier.com">iyzbheq0@robot.zapier.com</a></p></div></body></html>'''
ABOUT = '''<html><head><title>About | Buff & Beyond Auto Detailing</title><meta name="description" content="About the detailers in town, ceramic coating and more."></head><body><div id="dmcontent"><h1>About us</h1><p id="a1">Lorem ipsum dolor sit amet.</p></div></body></html>'''
FILES = {'/robots.txt': (200, 'User-agent: *\nDisallow: /\n'), '/sitemap.xml': (404, '<html>not found</html>'),
         '/llms.txt': (200, '# Buff & Beyond Auto Detailing\n\n> Detailing.\n\nCall (469) 555-0199 or iyzbheq0@robot.zapier.com\n')}
META = {'host': 'ed.multiscreensite.com', 'siteId': 'abc123', 'site': {'site_business_info': {'business_name': 'Buff & Beyond Auto Detailing', 'phones': [{'phoneNumber': '(214) 555-0100'}], 'emails': [{'emailAddress': 'iyzbheq0@robot.zapier.com'}, {'emailAddress': 'info@buffandbeyond.com'}]}},
        'content': {'location_data': {'phones': [{'phoneNumber': '(214) 555-0100'}], 'emails': [{'emailAddress': 'iyzbheq0@robot.zapier.com'}, {'emailAddress': 'info@buffandbeyond.com'}], 'address': {'streetAddress': '4211 S Natches Ct', 'city': 'Englewood', 'region': 'CO', 'postalCode': '80110'}}},
        'pages': [{'path': '/', 'title': 'Home'}, {'path': '/about', 'title': 'About'}], 'errors': []}
calls = {'ai': 0, 'capture': 0, 'check': 0, 'fetch': []}
def site_route(r):
    if 'light=1' in r.request.url: return r.fulfill(status=200, content_type='application/json', body=json.dumps({'siteId': 'abc123', 'domain': 'www.buffandbeyond.com', 'publishStatus': 'PUBLISHED', 'publishedAt': '2026-11-18T10:00:00Z'}))
    return r.fulfill(status=200, content_type='application/json', body=json.dumps(META))
def fetch_route(r):
    q = urllib.parse.parse_qs(urllib.parse.urlparse(r.request.url).query); path = q.get('path', ['/'])[0]
    calls['fetch'].append(('live:' if q.get('live') else '') + path)
    if path in FILES: st, body = FILES[path]; return r.fulfill(status=200, content_type='application/json', body=json.dumps({'status': st, 'html': body, 'url': 'x'}))
    return r.fulfill(status=200, content_type='application/json', body=json.dumps({'status': 200, 'html': ABOUT if path == '/about' else HOME, 'url': 'https://x/site/abc123' + path}))
def count(k):
    def h(r, *rest): calls[k] += 1; return r.continue_()
    return h
def site(pg): return pg.evaluate("async () => (await (await fetch('/api/store?op=site&id=s1')).json())")
try:
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(viewport={'width': 1440, 'height': 1000}); ctx.add_cookies([{'name': 'dsa_sess', 'value': 'tokadmin1234567890abcdef', 'domain': 'localhost', 'path': '/'}])
        ctx.route('**/api/site?*', site_route); ctx.route('**/api/fetch?*', fetch_route)
        PRES = {'result': {'at': 1795000000000, 'reference': {}, 'listings': [
            {'platform': 'instagram', 'found': True, 'source': 'search', 'url': 'https://instagram.com/denver.auto.shield', 'name': 'Buff & Beyond Auto Detailing', 'address': '', 'phone': ''},
            {'platform': 'facebook', 'found': True, 'source': 'search', 'url': 'https://facebook.com/x', 'name': 'Buff & Beyond Auto Detailing', 'address': '4211 S Natches Court Suite D, Englewood, Colorado 80110', 'phone': '(214) 555-0100'}]}, 'maps': False, 'cfg': {}}
        ctx.route('**/api/watch?op=presence*', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(PRES)))
        ctx.route('**/api/ai*', count('ai')); ctx.route('**/api/capture*', count('capture')); ctx.route('**/api/check*', count('check'))
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('dialog', lambda d: d.accept())
        pg.goto(f'http://localhost:{APORT}/#/site/s1'); pg.wait_for_selector('#sRescan', timeout=20000); time.sleep(1)
        pg.click('#sRescan')
        S = {}
        for _ in range(150):
            time.sleep(1); S = site(pg)
            if (S.get('scan') or {}).get('state') == 'complete' and S.get('live'): break
        F = [f for f in S.get('findings') or [] if not f.get('gone')]
        codes = {f['code'] for f in F}
        print('  codes:', sorted(codes), flush=True)
        check('ROBOTS_BLOCKS_ALL' in codes and 'SITEMAP_MISSING' in codes, 'robots.txt blocking every search engine and a missing sitemap are reported')
        check('LLMS_PHONE' in codes, 'llms.txt with a phone that is not in Business Info is reported')
        auto = [f for f in F if f['code'] == 'EMAIL_AUTOMATION']
        check(len(auto) >= 2 and all(f['severity'] == 'critical' for f in auto), f'the Zapier address is critical where it is shown (page and llms.txt): {len(auto)}')
        check(not any(f['code'] in ('EMAIL_MISMATCH', 'MAILTO_MISMATCH') and 'zapier' in (f.get('found') or '') for f in F), 'and it is not reported as "not in Business Info" too')
        check('SCHEMA_INVALID_JSON' in codes and 'SCHEMA_REQUIRED' in codes and 'SCHEMA_TYPE_GENERIC' in codes, 'schema: invalid JSON, missing address, and a plain LocalBusiness for an auto shop')
        check((S.get('files') or {}).get('robots', {}).get('blocksAll') and (S.get('schemaBiz') or {}).get('type') == 'LocalBusiness', 'what the files and the home schema say is kept with the audit')
        check('info@buffandbeyond.com' in (S['truth'].get('emails') or []) and 'iyzbheq0@robot.zapier.com' in (S['truth'].get('autoEmails') or []), 'Business Info keeps the automation address apart')
        grp = pg.evaluate("(cs) => cs.map(c => DudaAudit.groupOf({code: c}))", ['ROBOTS_BLOCKS_ALL', 'SCHEMA_REQUIRED', 'EMAIL_AUTOMATION', 'SCHEMA_PHONE'])
        check(grp == ['tech', 'tech', 'must', 'must'], f'robots/schema structure are Technical SEO; contact details stay audit items: {grp}')
        # Technical SEO tab
        pg.goto(f'http://localhost:{APORT}/#/site/s1/tech'); pg.wait_for_selector('.tech-head', timeout=15000); time.sleep(0.6)
        t = pg.inner_text('#tabBody')
        check('robots.txt' in t and 'Blocks every search engine' in t and 'sitemap.xml' in t and 'llms.txt' in t and 'Structured data' in t, 'the Technical SEO tab sums up schema, robots.txt, sitemap.xml and llms.txt')
        check(pg.locator('table.findings tr:has-text("robots.txt")').count() >= 1, 'and lists their items')
        pg.screenshot(path=os.path.join(OUT, 'techseo-tab.png'), full_page=False)
        # NAP tab
        pg.goto(f'http://localhost:{APORT}/#/site/s1/nap'); pg.wait_for_selector('.nap-t', timeout=15000); time.sleep(0.6)
        n = pg.inner_text('#tabBody').lower()
        check('business info' in n and 'schema' in n and 'llms.txt' in n and 'automation email in business info' in n, 'the NAP tab compares Business Info, the website, the schema and llms.txt')
        check(pg.locator('.nap-t .nap-bad').count() >= 1 and pg.locator('.nap-t .nap-ok').count() >= 1, 'with red where a value differs and green where it matches')
        pg.screenshot(path=os.path.join(OUT, 'nap-tab.png'), full_page=True)
        cellOf = lambda col: pg.evaluate('''(col) => { const hs = [...document.querySelectorAll('.nap-t thead th')].map(h => h.innerText.toLowerCase()); const i = hs.findIndex(h => h.startsWith(col)); const r = document.querySelectorAll('.nap-t tbody tr')[1]; return r && i >= 0 ? r.children[i].innerText : ''; }''', col)
        ig, fb = cellOf('instagram'), cellOf('facebook')
        print('  instagram address:', ig.replace('\n', ' '), '| facebook:', fb.replace('\n', ' '), flush=True)
        check('Not read by the search' in ig and 'Not there' not in ig, 'a profile detail the search did not bring back is "?", not "Not there"')
        check('≈' in fb and 'Suite D' in fb, 'an address written differently (Court / Ct, a suite) is marked ≈ with what differs')
        # ---- Apply check updates: an audit scanned before v37 ----
        S = site(pg)
        keep = next(f for f in S['findings'] if f['code'] == 'PLACEHOLDER' and not f.get('gone'))
        pg.evaluate("async (id) => fetch('/api/store', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({op:'patchFinding', siteId:'s1', findingIds:[id], changes:{status:'hold'}})})", keep['id'])
        raw = redis(['GET', 'dsa:site:s1'])[0]; d = unpack(raw)
        d['scan']['cv'] = 36
        d['findings'] = [f for f in d['findings'] if not (f['code'].startswith(('ROBOTS_', 'SITEMAP_', 'LLMS_', 'SCHEMA_INVALID', 'SCHEMA_REQ', 'SCHEMA_TYPE', 'SCHEMA_FAQ', 'SCHEMA_RECOMMENDED')) or f['code'] == 'EMAIL_AUTOMATION')]
        n_before = len([f for f in d['findings'] if not f.get('gone')])
        redis(['SET', 'dsa:site:s1', pack(d)])
        pg.goto(f'http://localhost:{APORT}/#/site/s1'); pg.reload(); pg.wait_for_selector('#ckApply', timeout=15000); time.sleep(0.5)
        plan = pg.inner_text('.upd-plan')
        print('  plan:', plan.replace('\n', ' | ')[:400], flush=True)
        check('What ⚡ Apply check updates will do' in plan and 'robots.txt' in plan and 'Left alone' in plan, 'the note says what Apply check updates will do and what it leaves alone')
        pg.screenshot(path=os.path.join(OUT, 'apply-plan.png'))
        calls.update({'ai': 0, 'capture': 0, 'check': 0, 'fetch': []})
        pg.click('#ckApply')
        for _ in range(120):
            time.sleep(1); S2 = site(pg)
            if (S2.get('scan') or {}).get('state') == 'complete' and int((S2.get('scan') or {}).get('cv') or 0) > 36: break
        F2 = [f for f in S2['findings'] if not f.get('gone')]
        c2 = {f['code'] for f in F2}
        print('  calls:', {k: v for k, v in calls.items() if k != 'fetch'}, 'fetches:', len(calls['fetch']), flush=True)
        check(int(S2['scan']['cv']) > 36 and S2['scan'].get('updAt'), 'afterwards the audit is up to date with the checks')
        check('ROBOTS_BLOCKS_ALL' in c2 and 'SCHEMA_REQUIRED' in c2 and 'LLMS_PHONE' in c2, 'the new checks added their items')
        k2 = next((f for f in S2['findings'] if f['id'] == keep['id']), {})
        check(k2.get('status') == 'hold' and not k2.get('gone'), 'an item from another check is left exactly as it was (On hold)')
        check(calls['ai'] == 0 and calls['capture'] == 0 and calls['check'] == 0, 'no AI, no contrast pictures and no link checks were run')
        lp = next((f for f in S2['findings'] if f['code'] == 'LLMS_PHONE' and not f.get('gone')), {})
        check('(469) 555-0199' in (lp.get('snippet') or '') and 'read on' in (lp.get('snippet') or ''), f"the llms.txt item shows the line it came from and when it was read: {lp.get('snippet')!r}")
        # The client fixes llms.txt (Duda rebuilds it on publish): read the files again, nothing else.
        FILES['/llms.txt'] = (200, '# Buff & Beyond Auto Detailing\n\n> Detailing.\n\nCall (214) 555-0100\n')
        cv0 = int(S2['scan']['cv'])
        pg.goto(f'http://localhost:{APORT}/#/site/s1/tech'); pg.reload(); pg.wait_for_selector('#techReread', timeout=15000)
        calls.update({'ai': 0, 'capture': 0, 'check': 0, 'fetch': []})
        pg.click('#techReread')
        for _ in range(90):
            time.sleep(1); S3 = site(pg)
            if (S3.get('scan') or {}).get('state') == 'complete' and not any(f['code'] == 'LLMS_PHONE' and not f.get('gone') for f in S3['findings']): break
        print('  reread fetches:', calls['fetch'], flush=True)
        check(not any(f['code'] == 'LLMS_PHONE' and not f.get('gone') for f in S3['findings']), 'after "Read the files again", the fixed llms.txt phone item closes')
        check(int(S3['scan']['cv']) == cv0 and calls['ai'] == 0, 'only the files were read: no AI, and the audit\'s check version is unchanged')
        check({x.replace('live:', '') for x in calls['fetch']} <= {'/', '/robots.txt', '/sitemap.xml', '/llms.txt'}, 'and only the home page was read besides the files')
        check(not errors, 'no script errors ' + ' | '.join(errors[:3]))
        br.close()
except Exception:
    import traceback; traceback.print_exc(); ok = False
finally:
    srv.terminate()
    for pat in ['[f]ixsite.mjs', '[f]akeredis.mjs', '[d]ev-server.js']: subprocess.run(['pkill', '-f', pat])
print('ALL PASS' if ok else 'SOME FAILED')
