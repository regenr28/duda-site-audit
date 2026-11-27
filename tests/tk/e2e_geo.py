"""Town pages judged by geography, not mention counts (update 238). A full scan with a stand-in AI that
answers the geography questions. #2162 is the model: a Chester County page about West Chester.
The place names are test data only; nothing in the app knows them. Usage: python3 -I e2e_geo.py <app> <tests>"""
import json, os, re, subprocess, sys, time, threading, urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, AIPORT = 3998, 8117
GEO = {('west chester', 'chester county'): True, ('willow grove', 'montgomery county'): True, ('ambler', 'montgomery county'): True,
       ('cherry hill', 'bucks county'): False, ('kennett square', 'delaware county'): None, ('west chester', 'chester'): False}
SEEN = {'towns': {}, 'ai_on': True}
class AI(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get('content-length') or 0)) or b'{}')
        system = body.get('system') if isinstance(body.get('system'), str) else json.dumps(body.get('system'))
        user = ''.join(m['content'] if isinstance(m['content'], str) else ''.join(c.get('text', '') for c in m['content']) for m in body.get('messages', []))
        results = []
        if 'is about what its ADDRESS' in system and SEEN['ai_on']:
            SEEN['fitsystem'] = system
            for blk in re.split(r'^=== ', user, flags=re.M)[1:]:
                m = re.match(r'\[(\d+)\] (\S+)', blk); i, path = int(m.group(1)), m.group(2)
                town = re.search(r'town = ([^\n]+)', blk).group(1).strip()
                kind = re.search(r'Page type: ([^\n]+)', blk); SEEN.setdefault('kinds', {})[path] = kind.group(1) if kind else ''
                if path == '/ppf-warminster-for-luxury-car':
                    results.append({'i': i, 'type': 'wrong_city', 'part': 'h1', 'quote': 'Why Luxury Car Owners in Bucks County Choose Paint Protection Film', 'confidence': 0.95, 'reason': 'Address names Warminster; H1 says Bucks County.', 'suggestion': 'Why Luxury Car Owners in Warminster Choose Paint Protection Film', 'relation': 'contains', 'contradiction': ''})
                if path == '/ppf-doylestown':
                    results.append({'i': i, 'type': 'wrong_city', 'part': 'h1', 'quote': 'PPF in Phoenix, AZ', 'confidence': 0.9, 'reason': 'Phoenix is in Arizona.', 'suggestion': 'PPF in Doylestown', 'relation': 'unrelated', 'contradiction': 'The Doylestown page H1 names Phoenix, AZ, 2,000 miles away.'})
                if path == '/ppf-newtown':
                    results.append({'i': i, 'type': 'wrong_city', 'part': 'h1', 'quote': 'PPF in Langhorne', 'confidence': 0.9, 'reason': 'Different town.', 'suggestion': 'PPF in Newtown', 'relation': 'unknown', 'contradiction': ''})
                o = re.search(r'Other places named on it \(answer "geo" for each\): ([^\n]+)', blk)
                if o:
                    SEEN['towns'][path] = o.group(1)
                    for t in [x.strip() for x in o.group(1).split(',')]:
                        inside = GEO.get((t.lower(), town.lower()))
                        results.append({'i': i, 'type': 'geo', 'town': t, 'area': town, 'inside': inside, 'confidence': 0.95, 'reason': 'stand-in geography'})
        elif 'You proofread WEBSITE TEXT' in system:
            for m in re.finditer(r'^\[(\d+)\] \([^)]*\) (.*)$', user, re.M):
                if 'Visit our West Chester shop' in m.group(2): results.append({'i': int(m.group(1)), 'type': 'wrong_location', 'quote': 'Visit our West Chester shop', 'confidence': 0.9, 'reason': 'The shop is in Warminster.', 'suggestion': 'Visit our Warminster shop', 'relation': 'inside', 'physical': True, 'contradiction': 'The business is in Warminster; it has no West Chester shop.'})
                if 'drivers across Bucks County' in m.group(2): results.append({'i': int(m.group(1)), 'type': 'wrong_location', 'quote': 'drivers across Bucks County', 'confidence': 0.9, 'reason': 'County.', 'suggestion': '', 'relation': 'contains', 'physical': False, 'contradiction': ''})
        elif 'You review image ALT TEXT' in system:
            for m in re.finditer(r'^(\d+) \| ', user, re.M): results.append({'i': int(m.group(1)), 'verdict': 'describes_image', 'confidence': 0.9, 'reason': 'photo', 'suggestion': ''})
        out = json.dumps({'model': 'claude-haiku-4-5-20251001', 'content': [{'type': 'text', 'text': json.dumps({'results': results})}], 'usage': {'input_tokens': 900, 'output_tokens': 120}}).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(out)
    def log_message(self, *a): pass
threading.Thread(target=HTTPServer(('127.0.0.1', AIPORT), AI).serve_forever, daemon=True).start()
env = dict(os.environ, ANTHROPIC_API_KEY='sk-test', ANTHROPIC_API_BASE=f'http://127.0.0.1:{AIPORT}/v1', ANTHROPIC_MODEL='claude-haiku-4-5-20251001', AI_ORDER='anthropic')
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-geo.log'), 'w'), text=True, env=env)
assert srv.stdout.readline().strip() == 'READY'
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
errors = []
def page(title, h1, body): return f'<html><head><title>{title} | Shine Detailing</title></head><body><div id="dmcontent"><h1>{h1}</h1>{body}</div></body></html>'
P = lambda *xs: ''.join(f'<p>{x}</p>' for x in xs)
PAGES = {
    '/': page('Home', 'Shine Detailing', P('Ceramic coating in Warminster, PA.')),
    # #2162: a Chester County page whose title, H1 and copy are about West Chester (which is in Chester County).
    '/ceramic-coating-chester-county-pa': page('Ceramic Coating West Chester, PA', 'Ceramic Coating in West Chester', P(
        'West Chester drivers trust our ceramic coating.', 'Roads around West Chester are hard on paint.', 'West Chester winters bring salt.',
        'Many West Chester owners choose a full coating.', 'From West Chester to Downingtown, we protect cars.', 'West Chester weather changes fast.',
        'Book your West Chester appointment today.', 'We serve all of Chester County.', 'Chester County drivers love the gloss.',
        'Visit our West Chester shop for a free quote.')),
    '/ceramic-coating-montgomery-county-pa': page('Ceramic Coating Montgomery County, PA', 'Ceramic Coating in Montgomery County', P(
        'Willow Grove drivers love it.', 'Willow Grove roads are rough.', 'Willow Grove owners book early.', 'Ambler drivers too.', 'Ambler streets are narrow.', 'Ambler owners ask about warranty.')),
    '/ceramic-coating-bucks-county-pa': page('Ceramic Coating Bucks County, PA', 'Ceramic Coating in Cherry Hill', P(
        'Cherry Hill drivers trust us.', 'Cherry Hill roads are rough.', 'Cherry Hill owners book early.', 'Cherry Hill weather is wet.')),
    '/ceramic-coating-delaware-county-pa': page('Ceramic Coating Delaware County, PA', 'Ceramic Coating in Kennett Square', P('Kennett Square drivers trust us.')),
    # #2163: a Warminster-named blog post whose H1 speaks to Bucks County (Warminster is in Bucks County).
    '/ppf-warminster-for-luxury-car': page('PPF for Luxury Cars in Warminster', 'Why Luxury Car Owners in Bucks County Choose Paint Protection Film', P('We protect cars for drivers across Bucks County, from our Warminster shop.')),
    '/ppf-doylestown': page('PPF Doylestown', 'PPF in Phoenix, AZ', P('Paint protection film for every car.')),
    '/ppf-newtown': page('PPF Newtown', 'PPF in Langhorne', P('Paint protection film for every car.')),
    '/window-tint-chester-pa': page('Window Tint Chester, PA', 'Window Tint in Chester', P(
        'West Chester drivers trust us.', 'West Chester roads are sunny.', 'West Chester owners book early.', 'West Chester summers are hot.', 'Chester drivers too.')),
}
for town in ['west-chester-pa', 'willow-grove-pa', 'ambler-pa', 'cherry-hill-nj', 'kennett-square-pa']:
    PAGES['/ceramic-coating-' + town] = page('Ceramic Coating ' + town.replace('-', ' ').title(), 'Ceramic Coating in ' + town[:-3].replace('-', ' ').title(), P('Local coating.'))
META = {'host': 'ed.multiscreensite.com', 'siteId': 'abc123', 'site': {'site_business_info': {'business_name': 'Shine Detailing'}},
        'content': {'location_data': {'address': {'streetAddress': '1 Main St', 'city': 'Warminster', 'region': 'PA', 'postalCode': '18974'}}},
        'pages': [{'path': p, 'title': p} for p in PAGES], 'errors': []}
def site_route(r):
    if 'light=1' in r.request.url: return r.fulfill(status=200, content_type='application/json', body=json.dumps({'siteId': 'abc123', 'publishStatus': 'NOT_PUBLISHED'}))
    return r.fulfill(status=200, content_type='application/json', body=json.dumps(META))
def fetch_route(r):
    path = urllib.parse.parse_qs(urllib.parse.urlparse(r.request.url).query).get('path', ['/'])[0]
    return r.fulfill(status=200, content_type='application/json', body=json.dumps({'status': 200 if path in PAGES else 404, 'html': PAGES.get(path, '<html><body data-page-alias="dmPageNotFound">404</body></html>'), 'url': 'https://ed.multiscreensite.com/site/abc123' + ('' if path == '/' else path)}))
def scan(pg):
    pg.goto(f'http://localhost:{APORT}/#/site/s1'); pg.wait_for_selector('#sRescan', timeout=20000); time.sleep(1)
    pg.click('#sRescan'); S = {}
    for _ in range(180):
        time.sleep(1)
        S = pg.evaluate("async () => (await (await fetch('/api/store?op=site&id=s1')).json())")
        if (S.get('scan') or {}).get('state') == 'complete': break
    time.sleep(1.5)
    S = pg.evaluate("async () => (await (await fetch('/api/store?op=site&id=s1')).json())")
    return [f for f in S.get('findings') or [] if not f.get('gone')]
try:
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(viewport={'width': 1440, 'height': 1000}); ctx.add_cookies([{'name': 'dsa_sess', 'value': 'tokadmin1234567890abcdef', 'domain': 'localhost', 'path': '/'}])
        ctx.route('**/api/site?*', site_route); ctx.route('**/api/fetch?*', fetch_route)
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('dialog', lambda d: d.accept())
        F = scan(pg)
        G = [f for f in F if re.match(r'^(PAGE_WRONG_CITY|AI_PAGE_CITY|AI_TEXT_LOCATION)', f['code'])]
        for f in G: print('  ', f['code'], f['severity'], f.get('status'), '|', f['path'], '|', f['message'][:120], '|', f.get('found'))
        on = lambda path, code=None: [f for f in G if f['path'] == path and (code is None or f['code'] == code)]
        cc = on('/ceramic-coating-chester-county-pa')
        check('West Chester' in SEEN['towns'].get('/ceramic-coating-chester-county-pa', ''), '#2162: the AI is asked whether West Chester is in Chester County')
        check(all(f['severity'] == 'info' for f in cc if f['code'].startswith('PAGE_WRONG_CITY')) and cc, '#2162: West Chester on the Chester County page is only an optional targeting review (Info), never critical')
        check(any(f['code'] == 'PAGE_WRONG_CITY' and 'Optional targeting review' in f['message'] for f in cc), '…the title/H1 focusing on West Chester is an optional targeting review')
        shop = [f for f in cc if f['code'] == 'AI_TEXT_LOCATION' and 'West Chester shop' in (f.get('found') or '')]
        check(shop, 'a "Visit our West Chester shop" claim on that county page is still reported (the county does not approve a shop claim)')
        mc = on('/ceramic-coating-montgomery-county-pa')
        check(all(f['severity'] == 'info' for f in mc), 'several towns inside the county on its page: no mismatch (at most an Info review)')
        bc = on('/ceramic-coating-bucks-county-pa', 'PAGE_WRONG_CITY')
        check(bc and bc[0]['severity'] == 'critical' and 'not in Bucks County' in bc[0]['message'], 'a town outside the county (Cherry Hill on the Bucks County page): still a critical mismatch, by its geography')
        bb = on('/ceramic-coating-bucks-county-pa', 'PAGE_WRONG_CITY_BODY')
        check(bb and bb[0]['severity'] == 'warning', '…and its copy dominated by that town is a warning')
        dc = on('/ceramic-coating-delaware-county-pa', 'PAGE_WRONG_CITY')
        check(dc and dc[0]['severity'] == 'warning' and dc[0].get('status') == 'clarification', 'geography unknown (the AI could not say): a warning For clarification asking whether the town is in the county')
        ch = on('/window-tint-chester-pa', 'PAGE_WRONG_CITY_BODY')
        check(ch and int(re.search(r'· Chester: (\d+)', ch[0]['found']).group(1)) < 4 and ch[0]['severity'] == 'warning', 'similar names: "West Chester" is not counted as "Chester", and West Chester (not in Chester) dominating the Chester page is a warning')
        check('Never decide from similar names' in SEEN.get('fitsystem', '') and '"relation"' in SEEN.get('fitsystem', '') and 'Bucks County' in SEEN.get('fitsystem', ''), 'the AI is told to judge by how places relate (either direction), never by similar names, and to state the contradiction')
        allF = [f for f in F if f['path'] == '/ppf-warminster-for-luxury-car' and re.match(r'^(AI_PAGE_CITY|AI_TEXT_LOCATION|PAGE_WRONG_CITY)', f['code'])]
        check(not allF, '#2163: a Warminster page whose H1 speaks to Bucks County (which contains Warminster): no location item')
        check(SEEN.get('kinds', {}).get('/ppf-warminster-for-luxury-car') and SEEN['kinds'].get('/ceramic-coating-chester-county-pa', '').startswith('location'), 'the AI is told what kind of page it is reading')
        ph = on('/ppf-doylestown', 'AI_PAGE_CITY')
        check(ph and ph[0]['severity'] == 'critical', 'a genuine contradiction with a stated reason (Phoenix, AZ on the Doylestown page): critical')
        lg = on('/ppf-newtown', 'AI_PAGE_CITY')
        check(lg and lg[0]['severity'] == 'warning' and lg[0].get('status') == 'clarification', 'a town the AI could not relate (no stated contradiction): For clarification, not critical')
        check(shop and shop[0]['severity'] == 'critical', 'a physical shop claim contradicting the business\'s address stays critical, even with the town in the county and in the page title')
        br.close()
    # Without any AI answer: the rules alone give candidates, never a Critical.
    js = r'''
      import '%s/public/engine.js';
      const A = globalThis.DudaAudit;
      const truth = { businessName: 'Shine Detailing', addresses: [{ city: 'Warminster', region: 'PA' }] };
      const pg = (path, title, h1, body) => ({ path, title, description: '', h1: [{ text: h1, selector: 'h1' }], heads: [], body });
      const pages = [pg('/ceramic-coating-bucks-county-pa', 'Ceramic Coating Bucks County', 'Ceramic Coating in Cherry Hill', 'Cherry Hill drivers. Cherry Hill roads. Cherry Hill owners. Cherry Hill rain.'),
        pg('/ceramic-coating-cherry-hill-nj', 'Cherry Hill', 'Cherry Hill', 'x'), pg('/locations/temple-tx', 'Temple', 'Copperas Cove top provider', 'x'), pg('/locations/copperas-cove-tx', 'Copperas Cove', 'Copperas Cove', 'x')];
      const T = (text, path) => ({ text, selector: '#' + text.length, location: 'Body', pages: [path], devices: ['desktop'], visibleOn: ['desktop'], hiddenOn: [] });
      const texts = [T('Visit our Dallas location for a quote.', '/about'), T('Visit our Austin location for a quote.', '/about'), T('Drivers across Bucks County trust us.', '/about')];
      const iss = [{ i: 0, type: 'wrong_location', quote: 'Visit our Dallas location', confidence: 0.95, reason: 'x', suggestion: '', lv: 4, relation: 'unrelated', physical: true, contradiction: 'The business is only in Warminster, PA.' },
        { i: 1, type: 'wrong_location', quote: 'Visit our Austin location', confidence: 0.95, reason: 'x', suggestion: '', lv: 4, relation: 'unrelated', physical: true, contradiction: '' },
        { i: 2, type: 'wrong_location', quote: 'across Bucks County', confidence: 0.95, reason: 'x', suggestion: '', lv: 4, relation: 'contains', physical: false, contradiction: '' }];
      const tx = A.applyTextIssues([], texts, iss, truth, [], [{ path: '/about', title: 'About', h1: 'About us' }]).map((f) => [f.found, f.severity, !!f.clarify]);
      console.log(JSON.stringify({ fit: A.pageFitFindings(pages, truth).map((f) => [f.code, f.severity, !!f.clarify, f.path]), tx }));
    ''' % APP
    o = subprocess.run(['node', '--input-type=module', '-e', js], capture_output=True, text=True)
    RR = json.loads(o.stdout.strip() or '{}'); R = RR.get('fit', []); TX = RR.get('tx', []); print('   rules only:', RR, o.stderr[-300:])
    check(R and not any(x[1] == 'critical' for x in R), 'without the AI, no town candidate is Critical')
    check(any(x[0] == 'PAGE_WRONG_CITY' and x[1] == 'warning' and x[2] for x in R), '…a title/H1 naming another place stays For clarification (unresolved, not dropped)')
    check(any(x[0] == 'PAGE_WRONG_CITY_BODY' and x[1] == 'info' for x in R), '…and mention counts are only an Info review')
    check(any('Dallas' in x[0] and x[1] == 'critical' for x in TX), 'text: a physical claim with a stated contradiction is critical')
    check(any('Austin' in x[0] and x[1] == 'warning' and x[2] for x in TX), 'text: the same claim with no stated contradiction is For clarification (AI confidence is not evidence)')
    check(not any('Bucks' in x[0] for x in TX), 'text: the county around the business\'s town, not a physical claim: no item')
finally:
    srv.terminate()
check(not errors, 'no script errors ' + ' | '.join(errors[:3]))
print('ALL PASS' if ok else 'SOME FAILED'); sys.exit(0 if ok else 1)
