"""SEO Websites: websites with the Duda label "SEO Customer" are audited again after each publish,
and the audit lists the pages the SEO company created (Duda's Activity Log). Usage: python3 -I e2e_seo.py <app> <tests>"""
import json, os, re, subprocess, sys, time, threading, urllib.parse, urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT, DPORT = 3998, 8078, 8114
CALLS = []
class Duda(BaseHTTPRequestHandler):
    """Duda's Activity Log for the test website: two pages by the SEO company, one by someone else."""
    def do_GET(self):
        CALLS.append(self.path)
        if '/activities' in self.path:
            out = [{'activity': 'page_created', 'date': '2026-11-12T10:00:00Z', 'user': 'seo@8bitcreative.com', 'page_title': 'Brentwood PPF', 'page_url': '/brentwood-ppf'},
                   {'activity': 'page_created', 'date': '2026-11-12T11:00:00Z', 'user': 'SEO@8bitcreative.com', 'page_title': 'Tint Laws', 'page_url': '/blog/tint-laws'},
                   {'activity': 'page_created', 'date': '2026-10-01T09:00:00Z', 'user': 'reymark@8bitcreative.com', 'page_title': 'About', 'page_url': '/about'}]
            body = json.dumps({'results': out}).encode()
        else: body = b'{}'
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass
threading.Thread(target=HTTPServer(('127.0.0.1', DPORT), Duda).serve_forever, daemon=True).start()
env = dict(os.environ, DUDA_API_BASE=f'http://127.0.0.1:{DPORT}/api', DUDA_API_USERNAME='u', DUDA_API_PASSWORD='p')
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-seo.log'), 'w'), text=True, env=env)
assert srv.stdout.readline().strip() == 'READY'
def redis(*cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
iso = lambda h: time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() - h * 3600))
# abc123 (on Audits as s1) was published 6 hours ago; zzz999 an hour ago (not due yet); nnn777 has no label.
redis(['SET', 'dsa:dudasites', json.dumps({'at': int(time.time() * 1000), 'sites': [
    {'id': 'abc123', 'name': 'Buff & Beyond', 'domain': 'buffandbeyond.com', 'published': iso(6), 'labels': ['SEO Customer']},
    {'id': 'zzz999', 'name': 'Other Co', 'domain': 'otherco.com', 'published': iso(1), 'labels': ['Paid', 'seo customer']},
    {'id': 'nnn777', 'name': 'Not SEO', 'domain': 'notseo.com', 'published': iso(9), 'labels': ['Paid']}]})])
TOK = 'tokadmin1234567890abcdef'; SITE = 'abc123'
def L(p): return '/site/' + SITE + ('' if p == '/' else p)
PAGES = {'/': ('Buff & Beyond | Detailing in Dover', '<h1>Buff &amp; Beyond</h1><p>Detailing in Dover.</p>'),
         '/brentwood-ppf': ('Brentwood PPF | Buff & Beyond', '<h1>PPF in Brentwood</h1><p>Paint protection film for Brentwod drivers. [Writer: add the price here.]</p>'),
         '/about': ('About | Buff & Beyond', '<h1>About</h1><p>Family run since 2010.</p>')}
def page_html(path):
    nav = '<div id="hcontainer" class="dmHeader">' + ' '.join(f'<a href="{L(p)}">{p}</a>' for p in PAGES) + '</div>'
    if path not in PAGES: return {'status': 404, 'html': '<html><body data-page-alias="dmPageNotFound"></body></html>', 'url': ''}
    t, b = PAGES[path]
    return {'status': 200, 'html': f'<html><head><title>{t}</title></head><body>{nav}<div id="dmcontent">{b}</div></body></html>', 'url': f'https://ed.multiscreensite.com/site/{SITE}{path}'}
META = {'host': 'ed.multiscreensite.com', 'siteId': SITE, 'site': {'site_business_info': {'business_name': 'Buff & Beyond'}, 'site_domain': ''}, 'content': {'location_data': {'phones': [{'phoneNumber': '(302) 421-7788'}]}},
        'pages': [{'path': p, 'title': p, 'noIndex': False} for p in PAGES], 'errors': []}
def route(r):
    u = urllib.parse.urlparse(r.request.url); q = dict(urllib.parse.parse_qsl(u.query)); p = u.path
    if p == '/api/fetch': return r.fulfill(status=200, content_type='application/json', body=json.dumps(page_html(q.get('path'))))
    if p == '/api/site': return r.fulfill(status=200, content_type='application/json', body=json.dumps(META))
    if p in ('/api/social', '/api/check'): return r.fulfill(status=200, content_type='application/json', body='[]' if p == '/api/check' else '{}')
    if p == '/api/imghash': return r.fulfill(status=200, content_type='application/json', body=json.dumps({'hashes': {}}))
    if p == '/api/capture': return r.fulfill(status=200, content_type='application/json', body=json.dumps({'items': [], 'measured': 0, 'errors': []}))
    if p == '/api/ai': return r.fulfill(status=400, content_type='application/json', body=json.dumps({'error': 'AI is not set up yet.'}))
    return r.continue_()
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
errors = []
try:
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(viewport={'width': 1440, 'height': 1000})
        ctx.add_cookies([{'name': 'dsa_sess', 'value': TOK, 'domain': 'localhost', 'path': '/'}])
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('dialog', lambda d: d.accept())
        pg.add_init_script("try { localStorage.setItem('dsa-seo-auto', 'off'); } catch (e) {}")
        pg.route('**/api/**', route)
        pg.goto(f'http://localhost:{APORT}/#/live/seo'); pg.wait_for_selector('.seo-table', timeout=20000); time.sleep(0.5)
        t = pg.inner_text('.seo-table')
        check('SEO Websites' in pg.inner_text('.tabs') and 'Buff & Beyond' in t and 'Other Co' in t and 'Not SEO' not in t, 'DR Websites has an SEO Websites tab listing only the websites labelled "SEO Customer" (any capitals)')
        rows = pg.locator('.seo-table tbody tr')
        check('Due now' in rows.nth(1).inner_text() or 'Due now' in t, 'a website published more than 4 hours ago is due for its audit')
        check(re.search(r'Due in [0-9]h', pg.inner_text('.seo-table tbody tr:has-text("Other Co")')), 'one published an hour ago is due in about 3 hours')
        due = pg.evaluate("async () => (await fetch('/api/seo?op=due')).json()")
        check((due.get('site') or {}).get('id') == 'abc123', 'the server names the website to audit next')
        pg.click('.seo-table tbody tr:has-text("Buff & Beyond") [data-seorun]')
        for _ in range(120):
            time.sleep(1)
            if '✓ Audited' in pg.inner_text('.seo-table tbody tr:has-text("Buff & Beyond")'): break
        check('✓ Audited' in pg.inner_text('.seo-table tbody tr:has-text("Buff & Beyond")'), 'Audit now scans it and marks it audited')
        S = pg.evaluate("async () => (await fetch('/api/store?op=site&id=s1')).json()")
        last = (S.get('scans') or [{}])[-1]
        seo = last.get('seo') or {}
        check(len(seo.get('pages') or []) == 2 and all('seo@' in x['by'] for x in seo['pages']), f'the scan records the pages the SEO company created, from the activity log ({len(seo.get("pages") or [])}; another person\'s page left out)')
        check(any('activities' in c and 'page_created' in c for c in CALLS), 'the activity log is asked for page_created activities')
        check(any(f['code'] == 'PLACEHOLDER' and f['path'] == '/brentwood-ppf' for f in S['findings']), 'the audit finds problems on the SEO company\'s page (an editor note left in)')
        due2 = pg.evaluate("async () => (await fetch('/api/seo?op=due')).json()")
        check(not due2.get('site'), 'once audited, it is not due again until the next publish')
        pg.click('.seo-table tbody tr:has-text("Buff & Beyond") [data-seopg]'); time.sleep(1.5)
        check('2 pages' in pg.inner_text('.seo-table tbody tr:has-text("Buff & Beyond")'), 'the tab shows the pages the SEO company created')
        pg.screenshot(path=os.path.join(OUT, 'seo.png'))
        pg.goto(f'http://localhost:{APORT}/#/site/s1/dashboard'); pg.wait_for_selector('.db-table', timeout=15000); time.sleep(0.5)
        check('SEO auto audit · 2 pages by seo@8bitcreative.com' in pg.inner_text('.db-table'), 'the scan history marks it as an SEO auto audit with the pages')
        pg.click('[data-dbview] >> nth=-1'); pg.wait_for_selector('#repList', timeout=15000); time.sleep(0.4)
        rb = pg.inner_text('#repBody')
        check('Pages created by seo@8bitcreative.com (2)' in rb and 'Brentwood PPF' in rb and re.search(r'/brentwood-ppf\s+\d+ items? on this page', rb), 'its report lists the SEO company\'s pages with how many items each has')
        # Published again later: due again
        redis(['SET', 'dsa:dudasites', json.dumps({'at': int(time.time() * 1000), 'sites': [{'id': 'abc123', 'name': 'Buff & Beyond', 'domain': 'buffandbeyond.com', 'published': iso(4.2), 'labels': ['SEO Customer']}]})])
        redis(['HSET', 'dsa:seoauto', 'abc123', json.dumps({'at': iso(5), 'pub': iso(6), 'auditId': 's1'})])
        due3 = pg.evaluate("async () => (await fetch('/api/seo?op=due')).json()")
        check((due3.get('site') or {}).get('id') == 'abc123', 'a new publish makes it due again 4 hours later')
        check(not errors, 'no script errors ' + ' | '.join(errors[:3]))
        br.close()
except Exception:
    import traceback; traceback.print_exc(); ok = False
finally:
    srv.terminate()
    for pat in ['[f]ixsite.mjs', '[f]akeredis.mjs', '[d]ev-server.js']: subprocess.run(['pkill', '-f', pat])
print('ALL PASS' if ok else 'SOME FAILED')
