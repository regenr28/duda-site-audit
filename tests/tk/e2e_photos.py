"""Photos that don't fit the page, phone watermarks, backgrounds and parallax; the URL redirects read from Duda.
Usage: python3 -I e2e_photos.py <app> <tests>"""
import base64, json, os, re, subprocess, sys, time, threading, urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, AIPORT = 3998, 8113
SEEN = {'photo_calls': 0, 'items': [], 'images': 0, 'jpeg': 0, 'full': 0, 'page': ''}
class AI(BaseHTTPRequestHandler):
    """A stand-in AI. For photos it decides by where the photo is (alt text and kind), and counts the pictures it was sent."""
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get('content-length') or 0)) or b'{}')
        system = body.get('system') if isinstance(body.get('system'), str) else json.dumps(body.get('system'))
        results = []
        if 'You review the PHOTOS' in system:
            SEEN['photo_calls'] += 1
            content = body['messages'][0]['content']
            text = ''.join(c.get('text', '') for c in content if c['type'] == 'text')
            for c in content:
                if c['type'] == 'image':
                    SEEN['images'] += 1
                    if base64.b64decode(c['source']['data'][:12])[:2] == b'\xff\xd8': SEEN['jpeg'] += 1
            SEEN['full'] += text.count('whole file:')
            SEEN['page'] = text
            for m in re.finditer(r'\[(\d+)\] (image|background of a column/section|parallax background)(?: · alt "([^"]*)")? · section heading: "([^"]*)"', text):
                i, kind, alt, head = int(m.group(1)), m.group(2), m.group(3) or '', m.group(4)
                SEEN['items'].append((kind, alt, head))
                v = {'i': i, 'subject': 'photo', 'fits_page': True, 'fits_section': True, 'watermark': '', 'confidence': 0.9, 'reason': 'fits', 'suggestion': ''}
                if alt == 'RV detailing': v.update(subject='the inside of a passenger car', fits_page=False, reason='A sedan interior on the RV detailing page', suggestion='A motorhome being washed or polished')
                if alt == 'Before and after': v.update(subject='a polished hood', watermark='Shot on iPhone 15 Pro', reason='Phone camera watermark in the bottom-left corner')
                results.append(v)
        out = json.dumps({'model': 'claude-haiku-4-5-20251001', 'content': [{'type': 'text', 'text': json.dumps({'results': results})}], 'usage': {'input_tokens': 900, 'output_tokens': 120}}).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(out)
    def log_message(self, *a): pass
threading.Thread(target=HTTPServer(('127.0.0.1', AIPORT), AI).serve_forever, daemon=True).start()
env = dict(os.environ, ANTHROPIC_API_KEY='sk-test', ANTHROPIC_API_BASE=f'http://127.0.0.1:{AIPORT}/v1', ANTHROPIC_MODEL='claude-haiku-4-5-20251001', AI_ORDER='anthropic')
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-photos.log'), 'w'), text=True, env=env)
assert srv.stdout.readline().strip() == 'READY'
TOK = 'tokadmin1234567890abcdef'; SITE = 'abc123'
def L(p): return '/site/' + SITE + ('' if p == '/' else p)
PAGES = {
    '/': ('Buff & Beyond | Car Detailing', '<h1>Buff &amp; Beyond</h1><p>Car and RV detailing in Wilmington.</p>'),
    '/rv-rentals': ('RV Detailing | Buff & Beyond', '<h1>RV Detailing in Wilmington</h1><p>We wash, polish and protect motorhomes.</p><img src="/photos/sedan-interior.png" alt="RV detailing">'),
}
def page_html(path):
    nav = '<div id="hcontainer" class="dmHeader">' + ' '.join(f'<a href="{L(p)}">{p}</a>' for p in PAGES) + '</div>'
    if path not in PAGES: return {'status': 404, 'html': '<html><body data-page-alias="dmPageNotFound"></body></html>', 'url': ''}
    title, body = PAGES[path]
    return {'status': 200, 'html': f'<html><head><title>{title}</title></head><body>{nav}<div id="dmcontent">{body}</div></body></html>', 'url': f'https://ed.multiscreensite.com/site/{SITE}{path}'}
META = {'host': 'ed.multiscreensite.com', 'siteId': SITE, 'site': {'site_business_info': {'business_name': 'Buff & Beyond'}, 'site_domain': ''},
        'content': {'business_data': {'name': 'Buff & Beyond'}, 'location_data': {'phones': [{'phoneNumber': '(302) 421-7788'}], 'address': {'city': 'Wilmington', 'region': 'DE', 'zip_code': '19801', 'street': '1 Main St'}}},
        'pages': [{'path': p, 'title': p, 'noIndex': False} for p in PAGES], 'errors': [],
        'redirects': [{'source': '/old-rv-page', 'target': '/rv-rental', 'code': 301}, {'source': '/rv', 'target': '/rv-rentals', 'code': 301}]}
def route(r):
    u = urllib.parse.urlparse(r.request.url); q = dict(urllib.parse.parse_qsl(u.query)); p = u.path
    if p == '/api/fetch': return r.fulfill(status=200, content_type='application/json', body=json.dumps(page_html(q.get('path'))))
    if p == '/api/site': return r.fulfill(status=200, content_type='application/json', body=json.dumps(META))
    if p in ('/api/social', '/api/check'): return r.fulfill(status=200, content_type='application/json', body='[]' if p == '/api/check' else '{}')
    if p == '/api/imghash': return r.fulfill(status=200, content_type='application/json', body=json.dumps({'hashes': {}}))
    return r.continue_()
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
errors = []
def scan(pg, before=None):
    pg.click('#sRescan')
    for _ in range(180):
        time.sleep(1)
        S = pg.evaluate("async () => (await fetch('/api/store?op=site&id=s1')).json()")
        sc = S.get('scan') or {}
        if sc.get('state') in ('complete', 'failed') and sc.get('finishedAt') != before: return S
    return S
try:
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(viewport={'width': 1440, 'height': 1000})
        ctx.add_cookies([{'name': 'dsa_sess', 'value': TOK, 'domain': 'localhost', 'path': '/'}])
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('dialog', lambda d: d.accept())
        pg.route('**/api/**', route)
        pg.goto(f'http://localhost:{APORT}/#/site/s1'); pg.wait_for_selector('#sRescan', timeout=20000); time.sleep(1.5)
        S = scan(pg)
        check((S.get('scan') or {}).get('state') == 'complete', 'the scan finished')
        F = S.get('findings') or []
        for f in F:
            if f['code'].startswith(('PHOTO_', 'REDIRECT_')): print(f"   {f['code']:<20} {f.get('severity'):<8} {f.get('path')} · {f['message'][:120]} | {(f.get('found') or '')[:60]}")
        print('   sent to the AI:', SEEN['items'], 'images', SEEN['images'], 'jpeg', SEEN['jpeg'], 'whole files', SEEN['full'])
        kinds = [k for k, a, h in SEEN['items']]
        check('image' in kinds and 'background of a column/section' in kinds and 'parallax background' in kinds, 'images, a column background and the parallax background are all sent to the AI')
        check(any(k == 'background of a column/section' and h == 'Our shop' for k, a, h in SEEN['items']), 'a column background is sent with the heading of the column it sits behind')
        check(('image', 'RV wash', 'Full RV wash') in SEEN['items'], 'a photo in a column is sent with the heading above it, not the heading of the column beside it')
        check(any(k == 'parallax background' and h == 'Ready for the road' for k, a, h in SEEN['items']), 'the parallax background is sent with the words that sit on it')
        check(SEEN['images'] >= len(SEEN['items']) and SEEN['jpeg'] == SEEN['images'], f'each photo is sent as a picture of how it looks on the page ({SEEN["images"]} JPEG pictures)')
        check(SEEN['full'] >= 3, f'…and its whole file, to read a watermark in a cropped corner ({SEEN["full"]})')
        check('RV Detailing in Wilmington' in SEEN['page'], 'the AI is told the page\'s main heading')
        wp = [f for f in F if f['code'] == 'PHOTO_WRONG_PAGE']
        check(len(wp) == 1 and wp[0]['path'] == '/rv-rentals' and 'passenger car' in (wp[0]['message'] + wp[0].get('found', '')) and wp[0]['severity'] == 'warning', 'the car interior on the RV page is raised as a photo that does not fit the page')
        wm = [f for f in F if f['code'] == 'PHOTO_WATERMARK']
        check(len(wm) == 1 and 'Shot on iPhone' in (wm[0]['message'] + wm[0].get('found', '')), 'the phone watermark is raised, quoting it')
        check(not [f for f in F if f['code'] == 'PHOTO_WRONG_SECTION'], 'photos that fit raise nothing')
        check(all(f.get('selector') for f in wp + wm), 'photo items point at the photo on the page')
        rb = [f for f in F if f['code'] == 'REDIRECT_BROKEN']
        check(rb and '/old-rv-page' in (rb[0]['message'] + rb[0].get('found', '')), 'a URL redirect pointing at a page that does not exist is raised')
        check(not [f for f in F if f['code'].startswith('REDIRECT_') and '/rv-rentals' == (f.get('found') or '')], 'a redirect to a real page is fine')
        check(not [f for f in F if f['code'].startswith('CONTRAST_') and 'Ready for the road' in (f.get('found') or '')], 'white text on a parallax photo is measured against the photo, not read as white on white')
        sc = (S.get('scan') or {}).get('contrast') or {}
        check(any(x.get('p') == '/rv-rentals' for x in (sc.get('list') or [])), f'the scan notes list the pages measured: {sc.get("list")}')
        pg.goto(f'http://localhost:{APORT}/#/site/s1'); pg.wait_for_selector('table.findings', timeout=15000); time.sleep(0.6)
        body = pg.inner_text('#tabBody')
        check('Colour contrast measured on' in pg.inner_text('body'), 'the scan panel says which pages the colour contrast was measured on')
        pg.screenshot(path=os.path.join(OUT, 'photos.png'))
        calls = SEEN['photo_calls']
        S2 = scan(pg, (S.get('scan') or {}).get('finishedAt'))
        check(SEEN['photo_calls'] == calls, f'a rescan asks the AI nothing new about the same photos ({SEEN["photo_calls"] - calls} new calls)')
        check(len([f for f in S2['findings'] if f['code'].startswith('PHOTO_')]) == 2, '…and the photo items are still there')
        br.close()
finally:
    srv.terminate()
check(not errors, 'no page errors ' + '; '.join(errors[:3]))
print('ALL PASS' if ok else 'SOME FAILED'); sys.exit(0 if ok else 1)
