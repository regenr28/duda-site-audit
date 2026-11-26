"""Links are judged by what they promise (update 232). A full scan of a made-up website with a stand-in AI
that calls EVERY link it is asked about wrong (the worst case): packages, brand, vehicle, complementary and
general service links, a same-page section button, redirected links and split phrases must come out clean,
while real problems (another service, a missing section, a broken link, a guessed page) are still reported.
The issue numbers in the comments are the reported cases; nothing in the app knows them.
Usage: python3 -I e2e_linkpromise.py <app> <tests>"""
import json, os, re, subprocess, sys, time, threading, urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, AIPORT = 3998, 8115
SEEN = {'links': []}
WRONG = {  # what the stand-in AI wrongly suggests for each link's words
    'VIEW PACKAGES': '/services-overview', 'CQuartz ceramic coatings': '/about-CARPRO-ceramic-coatings', 'STEK film options': '/about-stek-paint-protection-film',
    'window tint': '/service/window-tinting', 'farm gear': '/service/industrial-and-agricultural-coating', 'detailing tips': '/detailing-guide', 'aftercare tips': '/coating-care-guide',
}
class AI(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get('content-length') or 0)) or b'{}')
        system = body.get('system') if isinstance(body.get('system'), str) else json.dumps(body.get('system'))
        user = ''.join(m['content'] if isinstance(m['content'], str) else ''.join(c.get('text', '') for c in m['content']) for m in body.get('messages', []))
        results = []
        if 'BUTTONS and LINKS' in system:
            SEEN['system'] = system
            for m in re.finditer(r'^(\d+) \| (\[button\] )?([^|(]*?)( \(one phrase across \d+ links\))? \|(.*)$', user, re.M):
                words = m.group(3).strip(); SEEN['links'].append(m.group(0))
                results.append({'i': int(m.group(1)), 'verdict': 'wrong_page', 'confidence': 0.9, 'reason': 'stand-in says wrong', 'expected': WRONG.get(words, '/service/paint-protection-film-in-voorhees-nj')})
        elif 'You review image ALT TEXT' in system:
            for m in re.finditer(r'^(\d+) \| ', user, re.M): results.append({'i': int(m.group(1)), 'verdict': 'describes_image', 'confidence': 0.9, 'reason': 'photo', 'suggestion': ''})
        out = json.dumps({'model': 'claude-haiku-4-5-20251001', 'content': [{'type': 'text', 'text': json.dumps({'results': results})}], 'usage': {'input_tokens': 900, 'output_tokens': 120}}).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(out)
    def log_message(self, *a): pass
threading.Thread(target=HTTPServer(('127.0.0.1', AIPORT), AI).serve_forever, daemon=True).start()
env = dict(os.environ, ANTHROPIC_API_KEY='sk-test', ANTHROPIC_API_BASE=f'http://127.0.0.1:{AIPORT}/v1', ANTHROPIC_MODEL='claude-haiku-4-5-20251001', AI_ORDER='anthropic')
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-linkpromise.log'), 'w'), text=True, env=env)
assert srv.stdout.readline().strip() == 'READY'
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
errors = []
L = lambda p: '/site/abc123' + p
def page(title, body, h1=None): return f'<html><head><title>{title} | Shine Detailing</title></head><body><div id="dmcontent"><h1>{h1 or title}</h1>{body}</div></body></html>'
PKG = '<h2>Coverage packages</h2><p>Choose from our Partial Front, Full Front and Full Body packages with pricing for every car.</p>'
PAGES = {
    '/': page('Home', '<p>We are a Warminster, Pennsylvania detailing team: ceramic coating for street vehicles, boats and '
        f'<a href="{L("/service/industrial-and-agricultural-coating")}">machinery</a>, and tough finishes for '
        f'<a href="{L("/service/industrial-and-agricultural-coating")}">farm gear</a> too.</p>'),
    # #2256: SEO title targets Philadelphia; H1 and copy are about coatings for machinery.
    '/service/industrial-and-agricultural-coating': '<html><head><title>Industrial Coatings Philadelphia, PA | Shine Detailing</title></head><body><div id="dmcontent">'
        '<h1>Ceramic Coatings for Industrial and Agricultural Equipment</h1><p>Protective ceramic coatings for heavy machinery, tractors and plant equipment that resist chemicals and weather.</p></div></body></html>',
    '/service/paint-protection-film': page('Paint Protection Film', '<p>Our PPF stops rock chips on any car.</p>' + PKG),
    '/service/vehicle-ceramic-coating': page('Ceramic Coating', '<p>Ceramic coating keeps paint glossy.</p>' + PKG),
    '/service/window-tinting': page('Window Tinting', '<p>Window film for heat and privacy.</p>' + PKG),
    '/service/porsche-paint-protection-film': page('Porsche PPF', '<p>Porsche PPF packages for every model.</p>'),
    '/about-stek-paint-protection-film': page('About STEK Paint Protection Film', '<p>STEK DYNOshield film details and options.</p>'),
    '/about-llumar-window-tint': page('About LLumar Window Tint', '<p>LLumar film lines and options.</p>'),
    '/about-CARPRO-ceramic-coatings': page('About CARPRO Ceramic Coatings', '<p>CQuartz coatings by CARPRO.</p>'),
    '/coating-care-guide': page('Coating Care Guide', '<p>How to wash a coated car.</p>'),
    '/services-overview': page('Services Overview', '<p>All our services.</p>'),
    '/service/paint-protection-film-in-voorhees-nj': page('Paint Protection Film in Voorhees, NJ', '<p>PPF for Voorhees drivers.</p>'),
    '/service/auto-window-tinting-in-voorhees-nj': page('Window Tinting in Voorhees, NJ', '<p>Tint for Voorhees drivers.</p>'),
    '/service/ceramic-coating-in-voorhees-nj': page('Ceramic Coating in Voorhees, NJ', '<p>Coating for Voorhees drivers.</p>'),
    # #1429: VIEW PACKAGES scrolls to the packages section on its own page; SEE GALLERY points at a section that is not there.
    '/service/automotive-detailing': page('Automotive Detailing', '<p>Inside and out, done right.</p>'
        f'<a class="dmButtonLink" id="vp" href="{L("/service/automotive-detailing")}#FullVehicleDetailingPackages">VIEW PACKAGES</a>'
        f'<a class="dmButtonLink" id="sg" href="#MissingGallery">SEE GALLERY</a>'
        '<div class="dmRespRow" data-anchor="FullVehicleDetailingPackages"><h2>Full Vehicle Detailing Packages</h2><p>Gold, Platinum and Diamond packages with prices.</p></div>'),
    # The Voorhees article (#1426 … #1520).
    '/paint-protection-film-voorhees': page('Paint Protection Film Voorhees', ''.join([
        '<p>Voorhees drivers love PPF. Voorhees roads are rough. In Voorhees, chips happen.</p>',
        f'<p id="p1">Compare our <a href="{L("/service/paint-protection-film")}">PPF packages</a> for every budget.</p>',                      # #1426 packages
        f'<p id="p2">Ask about <a href="{L("/stek-paint-protection-film")}">STEK film options</a> and <a href="{L("/about-llumar-window-tint")}">LLumar film details</a>.</p>',  # #1495/#1497, #1427
        f'<p id="p3">We also offer <a href="{L("/service/porsche-paint-protection-film")}">Porsche PPF packages</a>.</p>',               # #1494
        f'<p id="p4">Many owners add <a href="{L("/service/vehicle-ceramic-coating")}">ceramic coating</a> over PPF for extra gloss.</p>',  # #1428
        f'<p id="p5">Keep the cabin cool with <a href="{L("/service/window-tinting")}">window tinting</a> too.</p>',                       # #1456
        f'<p id="p6">Our <a href="{L("/service/window-tinting")}">auto</a> <a href="{L("/service/window-tinting")}">window</a> <a href="{L("/service/window-tinting")}">tinting</a> keeps glare down.</p>',  # #1468 split
        f'<p id="p7">Read about <a href="{L("/service/paint-protection-film")}">paint protection film Voorhees</a> owners choose.</p>',     # #1493 town in the words
        f'<p id="p8">Finish with <a href="{L("/about-carpro-coatings")}">CQuartz ceramic coatings</a> from CARPRO.</p>',                  # #1457 redirect
        f'<p id="p9">For heat control see our <a href="{L("/service/vehicle-ceramic-coating")}">window tint</a> options.</p>',            # genuine: wrong service
        f'<p id="p10">More <a href="{L("/service/vehicle-ceramic-coating")}">detailing tips</a> from our team.</p>',                       # AI guesses a page that does not exist
        f'<p id="p11">Read our <a href="{L("/coating-care")}">aftercare tips</a> after the install.</p>',                              # redirect to the right page
        f'<p id="p12">See the <a href="{L("/old-page")}">old offer</a>.</p>',                                                              # genuine 404
    ]), h1='Paint Protection Film in Voorhees, NJ: is it worth it?'),
}
REDIRECTS = {'/stek-paint-protection-film': '/about-stek-paint-protection-film', '/about-carpro-coatings': '/about-CARPRO-ceramic-coatings', '/coating-care': '/coating-care-guide'}
META = {'host': 'ed.multiscreensite.com', 'siteId': 'abc123', 'site': {'site_business_info': {'business_name': 'Shine Detailing'}},
        'content': {'location_data': {'address': {'streetAddress': '1 Main St', 'city': 'Warminster', 'region': 'PA', 'postalCode': '18974'}}},
        'pages': [{'path': p, 'title': p} for p in PAGES], 'errors': []}
def site_route(r):
    if 'light=1' in r.request.url: return r.fulfill(status=200, content_type='application/json', body=json.dumps({'siteId': 'abc123', 'publishStatus': 'NOT_PUBLISHED'}))
    return r.fulfill(status=200, content_type='application/json', body=json.dumps(META))
def fetch_route(r):
    path = urllib.parse.parse_qs(urllib.parse.urlparse(r.request.url).query).get('path', ['/'])[0]
    base = 'https://ed.multiscreensite.com/site/abc123'
    if path in REDIRECTS:
        to = REDIRECTS[path]
        return r.fulfill(status=200, content_type='application/json', body=json.dumps({'status': 200, 'html': PAGES[to], 'url': base + path, 'finalUrl': base + to}))
    return r.fulfill(status=200, content_type='application/json', body=json.dumps({'status': 200 if path in PAGES else 404, 'html': PAGES.get(path, '<html><body data-page-alias="dmPageNotFound">404</body></html>'), 'url': base + ('' if path == '/' else path)}))
try:
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(viewport={'width': 1440, 'height': 1000}); ctx.add_cookies([{'name': 'dsa_sess', 'value': 'tokadmin1234567890abcdef', 'domain': 'localhost', 'path': '/'}])
        ctx.route('**/api/site?*', site_route); ctx.route('**/api/fetch?*', fetch_route)
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('dialog', lambda d: d.accept())
        pg.goto(f'http://localhost:{APORT}/#/site/s1'); pg.wait_for_selector('#sRescan', timeout=20000); time.sleep(1)
        pg.click('#sRescan')
        S = {}
        for _ in range(180):
            time.sleep(1)
            S = pg.evaluate("async () => (await (await fetch('/api/store?op=site&id=s1')).json())")
            if (S.get('scan') or {}).get('state') == 'complete': break
        F = [f for f in S.get('findings') or [] if not f.get('gone')]
        LF = [f for f in F if f['code'].startswith('LINK_')]
        for f in LF: print('  ', f['code'], f['severity'], '|', f.get('found'), '|', f.get('expected'), '| clarify' if f.get('clarify') else '', flush=True)
        for l in SEEN['links']: print('   sent:', l[:900])
        sent = '\n'.join(l.split(' | ')[1] for l in SEEN['links'])
        has = lambda code, txt: [f for f in LF if f['code'] == code and txt in (f.get('found') or '')]
        anyfor = lambda txt: [f for f in LF if txt in (f.get('found') or '')]
        # Kept as they are (not even asked about): packages, brand, vehicle, a section that is there.
        check('PPF packages' not in sent and not anyfor('"PPF packages"'), '#1426: "PPF packages" opening the PPF page that shows packages: no item, not asked')
        check('STEK film options' not in sent and 'LLumar film details' not in sent and not anyfor('STEK film options') and not anyfor('LLumar film details'), '#1427/#1495/#1497: STEK and LLumar links keep their brand pages (no town page, no item)')
        check('Porsche PPF packages' not in sent and not anyfor('Porsche PPF'), '#1494: "Porsche PPF packages" keeps the Porsche page')
        check('VIEW PACKAGES' not in sent and not anyfor('VIEW PACKAGES'), '#1429: "VIEW PACKAGES" scrolling to its packages section: no item, never /services-overview')
        check(not any('/services-overview' in (f.get('expected') or '') for f in LF), '…and /services-overview is suggested nowhere')
        # The AI calls them wrong; the app keeps them because the link's own words name the page's service.
        check(not anyfor('"ceramic coating" ') and not anyfor('"window tinting"'), '#1428/#1456: general ceramic coating and window tinting links on a Voorhees page: no item')
        check('auto window tinting (one phrase across 3 links)' in sent, '#1468: the split link is read as one phrase, "auto window tinting"')
        check(not anyfor('"auto'), '…and kept (it names the page\'s service)')
        town = [f for f in LF if f['code'] == 'LINK_TOWN_SERVICE']
        check(len(town) == 1 and 'paint protection film Voorhees' in town[0]['found'] and town[0]['severity'] == 'info' and town[0]['expected'].startswith('Optional') and '/service/paint-protection-film-in-voorhees-nj' in town[0]['expected'], '#1493: only the link whose words name Voorhees gets the Voorhees page, as an optional Info idea')
        check(not has('LINK_WRONG_PAGE', 'paint protection film Voorhees'), '…not a wrong-page item')
        # Redirects
        check('/about-carpro-coatings (redirects to /about-CARPRO-ceramic-coatings)' in sent or 'CQuartz' not in sent, '#1457: the AI (if asked) sees where the redirect lands')
        check(not has('LINK_WRONG_PAGE', 'CQuartz') and not any('exist' in (f.get('message') or '') for f in anyfor('CQuartz')), '#1457: the redirected CARPRO link is not "wrong" or "non-existent"')
        check(any('aftercare tips' in l and '(redirects to /coating-care-guide)' in l for l in SEEN['links']), 'the AI is shown where a redirected link lands')
        via = has('LINK_VIA_REDIRECT', 'aftercare tips')
        check(via and via[0]['severity'] == 'info' and via[0]['expected'].startswith('Optional: link straight to /coating-care-guide'), 'a link reaching the right page through a redirect: optional tidy-up (Info)')
        # Real problems are still reported.
        wp = has('LINK_WRONG_PAGE', '"window tint"')
        check(wp and wp[0]['severity'] == 'warning' and '/service/window-tinting' in wp[0]['expected'], 'a "window tint" link opening the ceramic coating page is still wrong, with a page the scan found working')
        g = has('LINK_WRONG_PAGE', 'detailing tips')
        check(g and '/detailing-guide' not in (g[0].get('expected') or '') and g[0].get('clarify'), 'a page the AI guessed (that does not exist) is never suggested; the item asks to be confirmed')
        am = has('LINK_ANCHOR_MISSING', 'SEE GALLERY')
        check(am and am[0].get('clarify') and '#MissingGallery' in am[0]['found'], 'a button scrolling to a section that is not on the page: its own item, for clarification')
        check([f for f in LF if f['code'] == 'LINK_BROKEN_INTERNAL' and '/old-page' in (f.get('found') or '')], 'a link to a page that does not exist is still a broken link')
        check('PROMISE' in SEEN.get('system', '') and 'redirects to' in SEEN.get('system', ''), 'the AI is told to judge links by their promise, sections and redirects')
        # #2256: a town in the destination's SEO title is not a wrong page, and a "fix" equal to the page is refused.
        check('machinery' not in sent and not anyfor('"machinery"'), '#2256: "machinery" opening the industrial coatings page (its heading and copy are about machinery): no item, not asked')
        check(any('farm gear' in l and 'says: ' in l and 'Protective ceramic coatings for heavy machinery' in l for l in SEEN['links']), 'the AI reads the destination\'s copy, not only its SEO title')
        check(not anyfor('"farm gear"'), 'an AI answer whose "fix" is the page the link already opens is refused (no item)')
        check(not any((f.get('found') or '').split(' \u2192 ')[-1].split(' (')[0] == (f.get('expected') or '').replace('Should open ', '').split(' (')[0] for f in LF if f['code'] == 'LINK_WRONG_PAGE'), 'no wrong-page item suggests the page it already opens')
        check('SEO title' in SEEN.get('system', '') and 'Philadelphia' in SEEN.get('system', ''), 'the AI is told a town in the destination\'s title is not a wrong page')
        # One answer per link.
        by = {}
        for f in LF:
            if f['code'] in ('LINK_WRONG_PAGE', 'LINK_TOWN_SERVICE', 'LINK_VIA_REDIRECT'): by.setdefault((f['selector'], f['path']), []).append(f['code'])
        check(all(len(v) == 1 for v in by.values()), 'one recommendation per link')
        check(not errors, 'no script errors ' + ' | '.join(errors[:3]))
        br.close()
finally:
    srv.terminate()
print('ALL PASS' if ok else 'SOME FAILED'); sys.exit(0 if ok else 1)
