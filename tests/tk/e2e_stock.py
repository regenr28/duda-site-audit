"""Editorial stock photos: the list (seeded, add, remove, who may change it), Shutterstock lookups against a
stand-in, fingerprints from previews, and the Settings page. The matching itself is in stock_unit.mjs.
Usage: python3 -I e2e_stock.py <app> <tests>"""
import io, json, os, re, subprocess, sys, time, threading, urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT, SSPORT, AIPORT = 3998, 8078, 8114, 8115
ADMIN_TOK, MEMBER_TOK = 'tokadmin1234567890abcdef', 'tokmember1234567890abcde'

def picture(seed):
    im = Image.new('RGB', (400, 260), (30 + seed * 20 % 200, 60, 90))
    d = ImageDraw.Draw(im)
    for i in range(14):
        d.rectangle([(i * 37 + seed * 11) % 380, (i * 53) % 240, (i * 37 + seed * 11) % 380 + 40, (i * 53) % 240 + 30], fill=((i * 40 + seed * 30) % 255, (i * 90) % 255, (i * 15 + seed) % 255))
    b = io.BytesIO(); im.save(b, 'JPEG', quality=88); return b.getvalue()
def preview(seed):
    # Shutterstock's 260nw preview: the photo with a 20px white Shutterstock strip under it.
    ph = Image.open(io.BytesIO(picture(seed))); im = Image.new('RGB', (ph.width, ph.height + 20), (254, 254, 254)); im.paste(ph, (0, 0))
    ImageDraw.Draw(im).text((8, ph.height + 4), 'shutterstock \u00b7 123456', fill=(120, 120, 120))
    b = io.BytesIO(); im.save(b, 'JPEG', quality=88); return b.getvalue()
PICS = {'2669861029': picture(1), '2530975229': picture(2), '2777777777': picture(4), '2888888888': picture(5)}
SEEN = {'pages': [], 'ai': []}
class SS(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        m = re.match(r'^/image-photo/(\d+)$', self.path)
        if m:
            i = m.group(1); SEEN['pages'].append(i)
            slug = {'2669861029': 'vinnytsia-ukraine-august-04-2025-grey-2669861029', '2530975229': 'miami-usa-june-10-2024-white-car-2530975229',
                    '2685614241': 'black-sedan-isolated-on-white-2685614241', '9999999999': 'blocked'}.get(i)
            if not slug or slug == 'blocked':
                self.send_response(403); self.end_headers(); return
            self.send_response(301); self.send_header('Location', f'/image-photo/{slug}'); self.end_headers(); return
        m = re.match(r'^/image-photo/([a-z0-9-]+)-(\d+)$', self.path)
        if m:
            i = m.group(2)
            title = {'2669861029': 'Vinnytsia, Ukraine - August 04, 2025: grey car', '2530975229': 'Miami, USA - June 10, 2024: white car', '2685614241': 'Black sedan isolated on white'}[i]
            html = f'<html><head><meta property="og:title" content="{title}"><meta property="og:image" content="http://127.0.0.1:{SSPORT}/image-photo/{m.group(1)}-260nw-{i}.jpg"></head><body>Editorial use only</body></html>'
            self.send_response(200); self.send_header('Content-Type', 'text/html'); self.end_headers(); self.wfile.write(html.encode()); return
        m = re.match(r'^/image-photo/.*-260nw-(\d+)\.jpg$', self.path)
        if m and m.group(1) in PICS:
            seed = {'2669861029': 1, '2530975229': 2, '2777777777': 4, '2888888888': 5}[m.group(1)]
            self.send_response(200); self.send_header('Content-Type', 'image/jpeg'); self.end_headers(); self.wfile.write(preview(seed)); return
        self.send_response(404); self.end_headers()
ss = HTTPServer(('127.0.0.1', SSPORT), SS); threading.Thread(target=ss.serve_forever, daemon=True).start()
class AI(BaseHTTPRequestHandler):
    # Stand-in for the AI web search: finds the Shutterstock page of whatever ID it is asked about.
    def log_message(self, *a): pass
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get('content-length') or 0)) or b'{}')
        user = ''.join(m['content'] if isinstance(m['content'], str) else '' for m in body.get('messages', []))
        i = (re.search(r'(\d{5,12})', user) or [None, ''])[1]; SEEN['ai'].append(i)
        tools = body.get('tools') or []
        res = [{'type': 'web_search_result', 'url': 'https://www.shutterstock.com/image-photo/some-other-picture-1000000001', 'title': 'Other | Shutterstock'},
               {'type': 'web_search_result', 'url': f'https://www.shutterstock.com/image-photo/denver-usa-march-3-2025-blue-truck-{i}', 'title': 'Denver, USA - March 3, 2025: blue truck Stock Photo | Shutterstock'}]
        out = {'id': 'm', 'model': 'claude-haiku-4-5-20251001', 'usage': {'input_tokens': 10, 'output_tokens': 5, 'server_tool_use': {'web_search_requests': 1}},
               'content': [{'type': 'server_tool_use', 'id': 's1', 'name': 'web_search', 'input': {'query': i}}, {'type': 'web_search_tool_result', 'tool_use_id': 's1', 'content': res},
                           {'type': 'text', 'text': 'https://www.shutterstock.com/image-photo/a-made-up-address-' + i}]}
        check_tools = any(t.get('name') == 'web_search' for t in tools)
        b = json.dumps(out if check_tools else {'content': [{'type': 'text', 'text': '{}'}]}).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(b)
ais = HTTPServer(('127.0.0.1', AIPORT), AI); threading.Thread(target=ais.serve_forever, daemon=True).start()

env = dict(os.environ, SHUTTERSTOCK_BASE=f'http://127.0.0.1:{SSPORT}', ANTHROPIC_API_KEY='sk-test', ANTHROPIC_API_BASE=f'http://127.0.0.1:{AIPORT}/v1', ANTHROPIC_MODEL='claude-haiku-4-5-20251001', AI_ORDER='anthropic')
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-stock.log'), 'w'), text=True, env=env)
assert srv.stdout.readline().strip() == 'READY'
def api(body, tok=ADMIN_TOK):
    req = urllib.request.Request(f'http://localhost:{APORT}/api/imghash', data=json.dumps(body).encode(), method='POST', headers={'Cookie': 'dsa_sess=' + tok, 'Content-Type': 'application/json'})
    try: return 200, json.loads(urllib.request.urlopen(req, timeout=60).read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
errors = []
try:
    st, r = api({'stock': 'list'})
    ids = [x['id'] for x in r['items']]
    check(st == 200 and len(ids) == 67 and '2669861029' in ids and '2685614241' not in ids, f'the list starts with the 67 editorial downloads, not the 7 regular ones ({len(ids)})')
    check(all(x.get('h') and len(x['h']) == 64 and x.get('thumb') == f"/stock/{x['id']}.jpg" for x in r['items']), 'each one comes with its thumbnail (from the Downloads screenshots) and its fingerprint')
    th = urllib.request.urlopen(urllib.request.Request(f'http://localhost:{APORT}/stock/2669861029.jpg'), timeout=20)
    check(th.status == 200 and th.read()[:2] == b'\xff\xd8', 'the thumbnails are served with the app')
    check(r['canEdit'] is True, 'an admin may change it')
    st, r = api({'stock': 'list'}, MEMBER_TOK)
    check(st == 200 and r['canEdit'] is False and len(r['items']) == 67, 'a member sees it but may not change it')
    st, r = api({'stock': 'add', 'ids': ['1234567']}, MEMBER_TOK)
    check(st == 403, 'a member cannot add to it')
    st, r = api({'stock': 'remove', 'id': '2183357569'})
    st2, r2 = api({'stock': 'add', 'ids': ['1234567', 'not-an-id', '1234567']})
    st3, r3 = api({'stock': 'list'})
    ids = [x['id'] for x in r3['items']]
    check(st == 200 and r2['added'] == 1 and '2183357569' not in ids and '1234567' in ids and len(ids) == 67, 'remove one, add one (bad and repeated IDs ignored)')
    check(next(x for x in r3['items'] if x['id'] == '1234567')['by'] == 'Reymark R', 'it remembers who added it')
    # Lookups: an editorial ID joins the list; a regular one does not; a blocked page says "can't tell".
    st, r = api({'stock': 'lookup', 'ids': ['2685614241', '9999999999', '2669861029']})
    res = r['results']
    print('   lookup:', {k: v.get('editorial') for k, v in res.items()})
    check(res['2685614241']['editorial'] is False and res['9999999999']['editorial'] is None and res['2669861029']['editorial'] is True, 'Shutterstock’s page tells editorial (place and date in the title) from regular; a refused page is "can’t tell"')
    check(res['2669861029']['preview'].endswith('-260nw-2669861029.jpg'), 'and gives its preview picture')
    check(res['9999999999']['preview'].endswith('/image-photo/-260nw-9999999999.jpg') and res['9999999999']['file'] == 'shutterstock_9999999999.jpg', 'when Shutterstock refuses its page, the preview and file name are still built from the ID alone')
    api({'stock': 'remove', 'id': '2530975229'})
    n = len(SEEN['pages'])
    st, r = api({'stock': 'lookup', 'ids': ['2530975229', '2685614241']})
    st2, r2 = api({'stock': 'list'})
    ids = [x['id'] for x in r2['items']]
    check('2530975229' in ids and next(x for x in r2['items'] if x['id'] == '2530975229')['src'] == 'lookup' and '2685614241' not in ids, 'an editorial ID found by a scan joins the list; a regular one does not')
    check(len(SEEN['pages']) == n + 1, 'an ID already asked about is not asked again (remembered)')
    st, r = api({'stock': 'hash', 'id': '1234567', 'h': '0' * 63 + '1'}, MEMBER_TOK)
    st2, r2 = api({'stock': 'hash', 'id': '1234567', 'h': '1' * 64}, MEMBER_TOK)
    api({'stock': 'remove', 'id': '1234567'}); api({'stock': 'add', 'ids': ['1234567']})
    check(st == 200 and st2 == 403, 'anyone scanning may fill in a missing fingerprint, but not replace one')
    st, r = api({'stock': 'hash', 'id': '2669861029', 'h': 'abc'})
    check(st == 400, 'a malformed fingerprint is refused')
    # The image proxy lets Shutterstock previews through (the stand-in here), and nothing else new.
    q = urllib.parse.quote(f'http://127.0.0.1:{SSPORT}/image-photo/x-260nw-2669861029.jpg', safe='')
    rq = urllib.request.Request(f'http://localhost:{APORT}/api/imghash?url={q}', headers={'Cookie': 'dsa_sess=' + ADMIN_TOK})
    resp = urllib.request.urlopen(rq, timeout=30)
    check(resp.status == 200 and resp.headers.get('content-type') == 'image/jpeg', 'a Shutterstock preview can be read through the app (for the fingerprint)')
    q2 = urllib.parse.quote(f'http://127.0.0.1:{SSPORT}/image-photo/1234', safe='')
    try: urllib.request.urlopen(urllib.request.Request(f'http://localhost:{APORT}/api/imghash?url={q2}', headers={'Cookie': 'dsa_sess=' + ADMIN_TOK}), timeout=30); bad = 200
    except urllib.error.HTTPError as e: bad = e.code
    check(bad == 400, 'but a Shutterstock page that is not a picture file is refused')
    # Shutterstock's page refuses: adding one by hand falls back to an AI web search, trusting only the result addresses.
    st, r = api({'stock': 'lookup', 'ids': ['2777777777'], 'ai': True})
    v = r['results']['2777777777']
    print('   ai lookup:', v)
    check(v.get('via') == 'ai' and v.get('editorial') is True and 'denver-usa-march-3-2025-blue-truck-2777777777' in v.get('url', ''), 'when Shutterstock’s page refuses, the AI web search finds the image’s page (and its place-and-date title says editorial)')
    check(v.get('preview', '').endswith('/image-photo/denver-usa-march-3-2025-blue-truck-260nw-2777777777.jpg') and v.get('file') == 'shutterstock_2777777777.jpg', 'the preview address and the file name are built from the ID and the page address')
    check('made-up' not in json.dumps(v), 'the AI’s own words are never used, only the addresses its search returned')
    st, r = api({'stock': 'list'})
    check('2777777777' not in [x['id'] for x in r['items']], 'looking one up to add it does not put it on the list by itself')
    # Settings page
    api({'stock': 'remove', 'id': '2669861029'}); api({'stock': 'add', 'ids': ['2669861029']})
    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx = br.new_context(viewport={'width': 1440, 'height': 1000})
        ctx.add_cookies([{'name': 'dsa_sess', 'value': ADMIN_TOK, 'domain': 'localhost', 'path': '/'}])
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(f'http://localhost:{APORT}/#/settings/stock'); pg.wait_for_selector('.st-tbl', timeout=20000); time.sleep(0.5)
        txt = pg.inner_text('#setBody')
        check('Editorial stock photos' in txt and '67 images on the list' in txt, 'Settings → Editorial stock photos shows the list: ' + re.sub(r'\s+', ' ', txt)[:160])
        check(pg.locator('.st-tbl tbody tr').count() == 67 and pg.locator('[data-strm]').count() == 67, 'one row per image, each with Remove (admin)')
        pg.evaluate("() => document.querySelectorAll('.st-tbl img.st-thumb').forEach((i) => i.scrollIntoView())"); time.sleep(2); pg.evaluate("() => window.scrollTo(0, 0)")
        shown = pg.evaluate("() => [...document.querySelectorAll('.st-tbl img.st-thumb')].filter((i) => i.complete && i.naturalWidth > 0).length")
        check(shown >= 64, f'the list shows the thumbnails ({shown})')
        check('file name and look' in pg.inner_text('tr[data-st="2626541375"]'), 'and they are recognised by look without fetching anything')
        pg.click('#stPrev')
        pg.wait_for_function("() => /\\d+ can also be recognised by how they look/.test(document.querySelector('#setBody').innerText) && !document.querySelector('#stPrev').disabled || /without a preview/.test(document.querySelector('#stOut') ? document.querySelector('#stOut').innerText : '')", timeout=180000)
        time.sleep(1)
        txt = pg.inner_text('#setBody')
        m = re.search(r'(\d+) can also be recognised by how they look', txt)
        print('   after previews:', m and m.group(0), '|', pg.inner_text('#stOut'))
        row = pg.inner_text('tr[data-st="2669861029"]')
        check('file name and look' in row, 'Get previews made the fingerprint from Shutterstock’s preview: ' + row.replace('\n', ' | '))
        check(m and int(m.group(1)) >= 2, 'the ones Shutterstock gave a preview for are fingerprinted')
        check('did not give a preview' in pg.inner_text('#stOut'), 'and it says which ones still need a copy uploaded')
        # + New → Editorial photo: type the ID, the app finds the rest
        pg.click('#btnNew'); pg.wait_for_selector('[data-new="editorial"]', timeout=5000)
        pg.click('[data-new="editorial"]'); pg.wait_for_selector('#saId', timeout=5000)
        pg.fill('#saId', 'https://www.shutterstock.com/image-photo/2888888888'); pg.click('#saFind')
        pg.wait_for_selector('.st-card', timeout=60000); time.sleep(1.5)
        card = pg.inner_text('.st-card')
        print('   card:', card.replace('\n', ' | '))
        check('Denver, USA - March 3, 2025: blue truck' in card and 'shutterstock_2888888888.jpg' in card and 'denver-usa-march-3-2025-blue-truck-2888888888' in card and 'Editorial use only' in card, 'the Add box shows the title, page link, file name and licence for the ID')
        check(pg.evaluate("() => { const i = document.querySelector('.st-card img.st-thumb'); return !!i && i.naturalWidth > 0; }"), 'and the thumbnail preview')
        pg.screenshot(path=os.path.join(OUT, 'stock-add.png'))
        pg.click('#saGo'); pg.wait_for_selector('tr[data-st="2888888888"]', timeout=20000); time.sleep(1.5)
        row = pg.inner_text('tr[data-st="2888888888"]')
        check('file name and look' in row and 'shutterstock_2888888888.jpg' in row and 'Added by Reymark R' in row, 'Add puts it on the list, fingerprinted from its preview: ' + row.replace('\n', ' | '))
        check(pg.evaluate("() => { const i = document.querySelector('tr[data-st=\"2888888888\"] img.st-thumb'); return !!i && i.complete && i.naturalWidth > 0; }"), 'its row shows the thumbnail')
        check(pg.locator('#stNew').count() == 1, 'the page has its own + Add editorial photo button')
        import base64
        clean = pg.evaluate("(s) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(window.DudaAudit.measureImage(i).hash); i.src = s; })", 'data:image/jpeg;base64,' + base64.b64encode(picture(5)).decode())
        saved = next(x for x in api({'stock': 'list'})[1]['items'] if x['id'] == '2888888888')['h']
        dd = sum(a != b for a, b in zip(clean, saved))
        check(dd <= 3, f'the fingerprint made from Shutterstock\u2019s preview (white strip cut off) matches the photo itself ({dd} bits apart)')
        # Upload a copy for one without a preview
        tmp = os.path.join(OUT, 'stock-upload.jpg'); open(tmp, 'wb').write(picture(3))
        pg.set_input_files('[data-stup="1234567"]', tmp); time.sleep(2)
        check('file name and look' in pg.inner_text('tr[data-st="1234567"]'), 'uploading a copy makes the fingerprint')
        pg.screenshot(path=os.path.join(OUT, 'stock-settings.png'))
        ctx2 = br.new_context(viewport={'width': 1440, 'height': 1000})
        ctx2.add_cookies([{'name': 'dsa_sess', 'value': MEMBER_TOK, 'domain': 'localhost', 'path': '/'}])
        pg2 = ctx2.new_page(); pg2.on('pageerror', lambda e: errors.append(str(e)))
        pg2.goto(f'http://localhost:{APORT}/#/settings/stock'); pg2.wait_for_selector('.st-tbl', timeout=20000); time.sleep(0.4)
        check(pg2.locator('[data-strm]').count() == 0 and pg2.locator('#stAdd').count() == 0 and 'Only people who manage exception sets' in pg2.inner_text('#setBody'), 'a member sees the list without Add or Remove')
        br.close()
    # A list made before the thumbnails existed (update 220–222): they are filled in once; removed images stay removed.
    def redis(*cmds):
        req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
        return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
    redis(['DEL', 'dsa:stock:seeded2'], ['HSET', 'dsa:stock:ed', '2626541375', json.dumps({'id': '2626541375', 'src': 'list', 'by': 'x', 'at': '2026-11-25T00:00:00Z'})])
    st, r = api({'stock': 'list'})
    it = {x['id']: x for x in r['items']}
    check(it['2626541375'].get('h') and it['2626541375'].get('thumb') == '/stock/2626541375.jpg', 'an existing list gets the thumbnails and fingerprints on its next load')
    check('2183357569' not in it, 'an image taken off the list is not put back')
    check(it['1234567'].get('by') == 'Reymark R' and not it['1234567'].get('thumb'), 'images added by hand are left as they are')
finally:
    srv.terminate(); ss.shutdown(); ais.shutdown()
check(not errors, 'no page errors ' + '; '.join(errors[:3]))
print('ALL PASS' if ok else 'SOME FAILED'); sys.exit(0 if ok else 1)
