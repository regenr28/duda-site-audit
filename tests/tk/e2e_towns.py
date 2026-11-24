"""Service-area towns: a blog post may name a town the business serves (no "wrong location"), and a page
about one of those towns should link to that town's service pages. Usage: python3 -I e2e_towns.py <app> <tests>"""
import json, os, re, subprocess, sys, time, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, AIPORT = 3998, 8114
SEEN = {'areas_in_prompt': False}
class AI(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get('content-length') or 0)) or b'{}')
        system = body.get('system') if isinstance(body.get('system'), str) else json.dumps(body.get('system'))
        user = ''.join(m['content'] if isinstance(m['content'], str) else ''.join(c.get('text', '') for c in m['content']) for m in body.get('messages', []))
        results = []
        if 'You proofread WEBSITE TEXT' in system:
            if 'Towns this business serves' in user and 'Littleton' in user: SEEN['areas_in_prompt'] = True
            for m in re.finditer(r'^\[(\d+)\] \([^)]*\) (.*)$', user, re.M):
                if 'Littleton driver' in m.group(2): results.append({'i': int(m.group(1)), 'type': 'wrong_location', 'quote': 'A Littleton driver who mainly travels', 'confidence': 0.7, 'reason': 'Littleton is nearby but not the primary location', 'suggestion': 'local driver'})
                if 'Boulder' in m.group(2): results.append({'i': int(m.group(1)), 'type': 'wrong_location', 'quote': 'our Boulder shop', 'confidence': 0.9, 'reason': 'Boulder is not served', 'suggestion': 'our Englewood shop'})
        elif 'is about what its ADDRESS' in system:
            for m in re.finditer(r'^=== \[(\d+)\] (\S+)', user, re.M):
                if m.group(2) == '/tesla-window-tinting': results.append({'i': int(m.group(1)), 'type': 'wrong_city', 'part': 'h1', 'quote': 'PREMIER WINDOW TINTING FOR TESLAS IN DENVER, CO', 'confidence': 0.9, 'reason': "H1 says Denver, not the business's town (Englewood)", 'suggestion': 'PREMIER WINDOW TINTING FOR TESLAS'})
                if m.group(2) == '/ceramic-coatings': results.append({'i': int(m.group(1)), 'type': 'wrong_city', 'part': 'h1', 'quote': 'Ceramic Coating in Boulder, CO', 'confidence': 0.9, 'reason': 'Boulder', 'suggestion': 'Ceramic Coating'})
        elif 'You review image ALT TEXT' in system:
            for m in re.finditer(r'^(\d+) \| ', user, re.M): results.append({'i': int(m.group(1)), 'verdict': 'describes_image', 'confidence': 0.9, 'reason': 'photo', 'suggestion': ''})
        out = json.dumps({'model': 'claude-haiku-4-5-20251001', 'content': [{'type': 'text', 'text': json.dumps({'results': results})}], 'usage': {'input_tokens': 900, 'output_tokens': 120}}).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(out)
    def log_message(self, *a): pass
threading.Thread(target=HTTPServer(('127.0.0.1', AIPORT), AI).serve_forever, daemon=True).start()
env = dict(os.environ, ANTHROPIC_API_KEY='sk-test', ANTHROPIC_API_BASE=f'http://127.0.0.1:{AIPORT}/v1', ANTHROPIC_MODEL='claude-haiku-4-5-20251001', AI_ORDER='anthropic')
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-towns.log'), 'w'), text=True, env=env)
assert srv.stdout.readline().strip() == 'READY'
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
errors = []
def page(title, body): return f'<html><head><title>{title} | Denver Auto Shield</title><meta name="description" content="{title} by Denver Auto Shield in Englewood."></head><body><div id="dmcontent">{body}</div><div class="dmFooter" id="footer"><a href="/site/abc123/paint-protection-film-in-littleton-co">Littleton, CO</a></div></body></html>'
PAGES = {
    '/': page('Home', '<h1>Denver Auto Shield</h1><p>PPF, ceramic coating and tint in Englewood, CO.</p>'),
    '/paint-protection-film-in-littleton-co': page('Paint Protection Film in Littleton, CO', '<h1>Paint Protection Film in Littleton, CO</h1><p>PPF for Littleton drivers.</p>'),
    '/clear-bra': page('Paint Protection Film', '<h1>Paint Protection Film</h1><p>Our PPF stops rock chips.</p>'),
    '/ceramic-coatings': page('Ceramic Coating', '<h1>Ceramic Coating in Boulder, CO</h1><p>Our ceramic coating keeps paint glossy.</p>'),
    '/window-tint': page('Window Tint', '<h1>Professional Window Tint in Littleton, CO</h1><p>Tint for Littleton drivers.</p>'),
    '/tesla-window-tinting': page('Tesla Window Tinting', '<h1>PREMIER WINDOW TINTING FOR TESLAS IN DENVER, CO</h1><p>Tint for your Tesla.</p>'),
    '/does-ppf-thickness-matter': page('Does PPF Thickness Matter?', '<h1>Does PPF Thickness Matter?</h1>'
        '<p id="b1">A Littleton driver who mainly travels on neighborhood streets has different needs. Littleton roads are rough in winter.</p>'
        '<p id="b2">Ask about our <a id="l1" href="/site/abc123/clear-bra">paint protection film</a> and <a id="l2" href="/site/abc123/ceramic-coatings">ceramic coating</a> packages, or <a id="l3" href="/site/abc123/window-tint">window tint</a>.</p>'
        '<p id="b3">Stop by our Boulder shop, CO for a free quote today.</p>'),
}
META = {'host': 'ed.multiscreensite.com', 'siteId': 'abc123', 'site': {'site_business_info': {'business_name': 'Denver Auto Shield'}},
        'content': {'location_data': {'address': {'streetAddress': '4211 S Natches Ct', 'city': 'Englewood', 'region': 'CO', 'postalCode': '80110'}}},
        'pages': [{'path': p, 'title': p} for p in PAGES], 'errors': []}
def site_route(r):
    if 'light=1' in r.request.url: return r.fulfill(status=200, content_type='application/json', body=json.dumps({'siteId': 'abc123', 'publishStatus': 'NOT_PUBLISHED'}))
    return r.fulfill(status=200, content_type='application/json', body=json.dumps(META))
def fetch_route(r):
    import urllib.parse
    path = urllib.parse.parse_qs(urllib.parse.urlparse(r.request.url).query).get('path', ['/'])[0]
    return r.fulfill(status=200, content_type='application/json', body=json.dumps({'status': 200 if path in PAGES else 404, 'html': PAGES.get(path, '<html><body>404</body></html>'), 'url': 'https://ed.multiscreensite.com/site/abc123' + ('' if path == '/' else path)}))
try:
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(viewport={'width': 1440, 'height': 1000}); ctx.add_cookies([{'name': 'dsa_sess', 'value': 'tokadmin1234567890abcdef', 'domain': 'localhost', 'path': '/'}])
        ctx.route('**/api/site?*', site_route); ctx.route('**/api/fetch?*', fetch_route)
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('dialog', lambda d: d.accept())
        pg.goto(f'http://localhost:{APORT}/#/site/s1'); pg.wait_for_selector('#sRescan', timeout=20000); time.sleep(1)
        pg.click('#sRescan')
        S = {}
        for _ in range(150):
            time.sleep(1)
            S = pg.evaluate("async () => (await (await fetch('/api/store?op=site&id=s1')).json())")
            if (S.get('scan') or {}).get('state') == 'complete': break
        F = [f for f in S.get('findings') or [] if not f.get('gone')]
        loc = [f for f in F if f['code'] == 'AI_TEXT_LOCATION']
        tl = [f for f in F if f['code'] == 'LINK_TOWN_SERVICE']
        print('  location:', [f.get('found') for f in loc], flush=True)
        for f in tl: print('  town link:', f['found'], '|', f['expected'], flush=True)
        check(SEEN['areas_in_prompt'], 'the AI is told which towns the business serves')
        check(not any('Littleton' in (f.get('found') or '') for f in loc), 'a blog post naming a town the business serves is not "a location that doesn\'t match"')
        check(any('Boulder' in (f.get('found') or '') for f in loc), 'a town it does not serve still is')
        ppf = next((f for f in tl if '/clear-bra' in f['found']), None)
        cer = next((f for f in tl if '/ceramic-coatings' in f['found']), None)
        check(ppf and '/paint-protection-film-in-littleton-co' in ppf['expected'], 'a post about Littleton linking PPF to the general page is told to link the Littleton PPF page')
        check(ppf and ppf['severity'] == 'warning', '…as a warning (that page exists)')
        check(cer and cer['severity'] == 'info' and 'Optional' in cer['message'] and 'Littleton' in cer['expected'], 'where Littleton has no ceramic coating page and the general page does not mention Littleton, a town page is only an optional idea (Info)')
        check(not any('/window-tint' in f['found'] for f in tl), 'a link to a general page that already targets the town in its H1 ("Window Tint in Littleton") is fine, whatever its address')
        check(not any(f['path'] != '/does-ppf-thickness-matter' for f in tl), 'pages that are not about one town are left alone')
        city = [f for f in F if f['code'] == 'AI_PAGE_CITY']
        print('  page city:', [(f['path'], f.get('found')) for f in city], flush=True)
        check(not any(f['path'] == '/tesla-window-tinting' for f in city), 'a page with no town in its address may name the town in the business\'s own name ("Denver")')
        check(any(f['path'] == '/ceramic-coatings' for f in city), 'a town the business does not serve is still reported there')
        check(not errors, 'no script errors ' + ' | '.join(errors[:3]))
        br.close()
except Exception:
    import traceback; traceback.print_exc(); ok = False
finally:
    srv.terminate()
    for pat in ['[f]ixsite.mjs', '[f]akeredis.mjs', '[d]ev-server.js']: subprocess.run(['pkill', '-f', pat])
print('ALL PASS' if ok else 'SOME FAILED')
