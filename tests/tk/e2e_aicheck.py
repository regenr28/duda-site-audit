"""Proofreading and "does this button open the right page?" — a full scan with a stand-in AI.
Usage: python3 -I e2e_aicheck.py <app> <tests>"""
import json, os, re, subprocess, sys, time, threading, urllib.request, urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT, AIPORT = 3998, 8078, 8112
SEEN = {'proof': [], 'links': [], 'calls': 0}
class AI(BaseHTTPRequestHandler):
    """A stand-in for Anthropic: answers proofreading and link questions from the prompt it is sent."""
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get('content-length') or 0)) or b'{}')
        system = body.get('system') if isinstance(body.get('system'), str) else json.dumps(body.get('system'))
        user = ''.join(m['content'] if isinstance(m['content'], str) else ''.join(c.get('text', '') for c in m['content']) for m in body.get('messages', []))
        SEEN['calls'] += 1
        SEEN.setdefault('log', []).append(system[:40] + ' :: ' + user[-160:].replace('\n', ' / '))
        results = []
        if 'You review image ALT TEXT' in system:
            for m in re.finditer(r'^(\d+) \| ', user, re.M): results.append({'i': int(m.group(1)), 'verdict': 'describes_image', 'confidence': 0.9, 'reason': 'photo', 'suggestion': ''})
        elif 'senior copy editor' in system:
            SEEN['verify'] = SEEN.get('verify', 0) + 1
            for m in re.finditer(r'^(\d+) \| (\w+) \| text: .*? \| flagged: "([^"]*)"', user, re.M):
                results.append({'i': int(m.group(1)), 'error': ('Their is' in m.group(3)) or ('today!!' in m.group(3)), 'confidence': 0.95})
        elif 'proofread the WEBSITE COPY' in system:
            for m in re.finditer(r'^\[(\d+)\] \([^)]*\) (.*)$', user, re.M):
                SEEN['proof'].append(m.group(2)[:200])
                if 'recieve' in m.group(2): results.append({'i': int(m.group(1)), 'type': 'spelling', 'quote': 'recieve', 'confidence': 0.95, 'reason': 'misspelled', 'suggestion': 'receive'})
                if 'Lorem ipsum' in m.group(2): results.append({'i': int(m.group(1)), 'type': 'incomplete', 'quote': 'Lorem ipsum dolor', 'confidence': 0.9, 'reason': 'placeholder', 'suggestion': 'Real copy'})
                if m.group(2).rstrip().endswith('with our'): results.append({'i': int(m.group(1)), 'type': 'incomplete', 'quote': 'paint enhancements with our', 'confidence': 0.9, 'reason': 'unfinished', 'suggestion': 'Complete the sentence'})
                if 'it is easy to end up with trapped air bubbles' in m.group(2): results.append({'i': int(m.group(1)), 'type': 'grammar', 'quote': 'it is easy to end up with trapped air bubbles', 'confidence': 0.85, 'reason': 'subject-verb disagreement', 'suggestion': 'it is easy to end up with trapped air bubbles, improper fit, and durability issues'})
                if 'Profesional' in m.group(2): results.append({'i': int(m.group(1)), 'type': 'spelling', 'quote': 'Profesional', 'confidence': 0.95, 'reason': 'misspelled', 'suggestion': 'Professional'})
                if 'today!!' in m.group(2): results.append({'i': int(m.group(1)), 'type': 'punctuation', 'quote': 'today!!', 'confidence': 0.92, 'reason': 'doubled', 'suggestion': 'today!'})
                if 'Their is no better' in m.group(2): results.append({'i': int(m.group(1)), 'type': 'grammar', 'quote': 'Their is no better', 'confidence': 0.95, 'reason': 'wrong word', 'suggestion': 'There is no better'})
                if 'Our team know' in m.group(2): results.append({'i': int(m.group(1)), 'type': 'grammar', 'quote': 'Our team know cars', 'confidence': 0.9, 'reason': 'agreement', 'suggestion': 'Our team knows cars'})
                if 'teh best' in m.group(2): results.append({'i': int(m.group(1)), 'type': 'spelling', 'quote': 'words that are not there', 'confidence': 0.95, 'reason': 'x', 'suggestion': 'y'})
        elif 'BUTTONS and LINKS' in system:
            for m in re.finditer(r'^(\d+) \| (\[button\] )?([^|]*) \| ([^|]*) \|[^|]*\|[^|]*\| (\S+) →', user, re.M):
                SEEN['links'].append((m.group(3).strip(), m.group(4).strip(), m.group(5)))
                if m.group(3).strip() == 'Contact us' and m.group(5) == '/': results.append({'i': int(m.group(1)), 'verdict': 'wrong_page', 'confidence': 0.92, 'reason': 'Contact us opens the home page', 'expected': '/contact'})
                if m.group(3).strip() == 'Read more' and m.group(4).strip() == 'Ceramic Coating' and m.group(5) == '/window-tint': results.append({'i': int(m.group(1)), 'verdict': 'wrong_page', 'confidence': 0.9, 'reason': 'Ceramic coating section opens window tint', 'expected': '/ceramic-coating'})
                if m.group(3).strip() == 'Gallery': results.append({'i': int(m.group(1)), 'verdict': 'wrong_page', 'confidence': 0.5, 'reason': 'unsure', 'expected': ''})
        out = json.dumps({'model': 'claude-haiku-4-5-20251001', 'content': [{'type': 'text', 'text': json.dumps({'results': results})}], 'usage': {'input_tokens': 900, 'output_tokens': 120}}).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(out)
    def log_message(self, *a): pass
threading.Thread(target=HTTPServer(('127.0.0.1', AIPORT), AI).serve_forever, daemon=True).start()
env = dict(os.environ, ANTHROPIC_API_KEY='sk-test', ANTHROPIC_API_BASE=f'http://127.0.0.1:{AIPORT}/v1', ANTHROPIC_MODEL='claude-haiku-4-5-20251001', AI_ORDER='anthropic')
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-aicheck.log'), 'w'), text=True, env=env)
assert srv.stdout.readline().strip() == 'READY'
TOK = 'tokadmin1234567890abcdef'; SITE = 'abc123'
def L(p): return '/site/' + SITE + ('' if p == '/' else p)
def page_html(path):
    nav = f'<div id="hcontainer" class="dmHeader"><a href="{L('/about')}">About</a> <a href="{L('/window-tint')}">Window Tint</a> <a href="{L('/ceramic-coating')}">Ceramic Coating</a></div>'
    body = {
        '/': f'<h1>Buff &amp; Beyond</h1><p>We help every customer recieve a showroom finish on every car we touch, inside and out.</p>'
             f'<p><span>This includes hydrophobic paint enhancements with our </span><a href="{L('/ceramic-coating')}">ceramic coatings</a><span>, top vehicle protection and window tinting!</span></p>'
             '<style>li.sc-iGgWBj{display:none}.dev{display:none}</style><div id="ssrWrap-1895033358"><ul class="faq"><li class="sc-iGgWBj"><div><h3>Lorem ipsum dolor sit amet, your question here</h3></div></li></ul></div>'
             '<div class="hidden-note"><p class="dev">Lorem ipsum dolor sit amet hidden by a designer</p></div>'
             '<div style="display:none"><p>Website designed by SneakyWebCo Studio</p><a href="https://sneakywebco.example/">SneakyWebCo</a></div>'
             '<p class="dev">Designed by HiddenDev Studio</p>'
             '<footer><p>Website by 8bit Creative</p></footer>'
             f'<a class="dmButtonLink" href="{L('/')}">Contact us</a>'
             f'<section><h2>Ceramic Coating</h2><p>Long-lasting protection for your paint that keeps the shine for years.</p><a class="dmButtonLink" href="{L('/window-tint')}">Read more</a></section>'
             f'<section><h2>Window Tint</h2><p>Keep the cabin cool and private with our premium films.</p><a class="dmButtonLink" href="{L('/window-tint')}">Read more</a></section>'
             f'<a href="{L('/ceramic-coating')}">Ceramic Coating</a> <a href="{L('/contact')}">Get a quote</a> <a href="{L('/about')}">Gallery</a>',
        '/contact': '<h1>Contact Buff &amp; Beyond</h1><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod.</p>',
        '/about': '<h1>About us</h1><p>We are teh best detailing shop in the whole of Delaware, family run.</p><p>Without the proper tools and experience, it is easy to end up with trapped air bubbles, an improper fit, and a tint that is not durable.</p><p>Their is no better place for your car in the county.</p><p>Book your detail with our friendly team today!! We will be glad to help you.</p><img src="https://img.example/a.jpg" alt="Profesional ceramic coating on a black Tesla"><p>Our team know cars inside and out, from paint to glass.</p>',
        '/window-tint': '<h1 style="display:none">Window Tint</h1><h2>Window Tint</h2><p>Premium films for every car, installed by certified technicians.</p>',
        '/ceramic-coating': '<h1>Ceramic Coating</h1><p>Professional coatings with a written warranty for every vehicle.</p>',
    }.get(path)
    if body is None: return {'status': 404, 'html': '<html><body data-page-alias="dmPageNotFound"></body></html>', 'url': ''}
    title = {'/': 'Home', '/contact': 'Contact', '/about': 'About', '/window-tint': 'Window Tint', '/ceramic-coating': 'Ceramic Coating'}[path]
    meta = '<meta name="description" content="Detailing in Schaumburg,IL with ceramic coating and tint.">' if path == '/about' else ''
    return {'status': 200, 'html': f'<html><head><title>{title} | Buff &amp; Beyond</title>{meta}</head><body>{nav}<div id="dmcontent">{body}</div></body></html>', 'url': f'https://ed.multiscreensite.com/site/{SITE}{path}'}
META = {'host': 'ed.multiscreensite.com', 'siteId': SITE, 'site': {'site_business_info': {'business_name': 'Buff & Beyond'}, 'site_domain': ''},
        'content': {'location_data': {'phones': [{'phoneNumber': '(302) 421-7788'}]}},
        'pages': [{'path': p, 'title': p, 'noIndex': False} for p in ['/', '/contact', '/about', '/window-tint', '/ceramic-coating']], 'errors': []}
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
try:
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(viewport={'width': 1440, 'height': 1000})
        ctx.add_cookies([{'name': 'dsa_sess', 'value': TOK, 'domain': 'localhost', 'path': '/'}])
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('dialog', lambda d: d.accept())
        pg.route('**/api/**', route)
        pg.goto(f'http://localhost:{APORT}/#/site/s1'); pg.wait_for_selector('#sRescan', timeout=20000); time.sleep(1.5)
        pg.click('#sRescan')
        S = None
        for _ in range(120):
            time.sleep(1)
            S = pg.evaluate("async () => (await fetch('/api/store?op=site&id=s1')).json()")
            if (S.get('scan') or {}).get('state') in ('complete', 'failed'): break
        check((S.get('scan') or {}).get('state') == 'complete', 'the scan finished')
        F = S.get('findings') or []
        for f in F: print(f"   #{f.get('num')} {f['code']:<20} {f.get('severity'):<8} {f.get('path')} · {f.get('found')} · {f.get('expected', '')}")
        sp = [f for f in F if f['code'] == 'TEXT_SPELLING' and 'recieve' in f['found']]
        check(len(sp) == 1 and sp[0]['found'] == '"recieve"' and 'receive' in sp[0]['expected'], 'a spelling mistake becomes an audit item with the correction')
        check(any(f['code'] == 'PLACEHOLDER' and f['path'] == '/contact' for f in F) and not any(f['code'] == 'TEXT_INCOMPLETE' for f in F), 'placeholder copy (Lorem ipsum) already caught by the rules is not raised twice by the AI')
        check(not any('words that are not there' in (f.get('found') or '') for f in F), 'an answer quoting words the page does not contain is dropped')
        check(any('with our ceramic coatings, top vehicle protection' in x for x in SEEN['proof']) and not any(x.rstrip().endswith('with our') for x in SEEN['proof']), 'proofreading is sent the whole paragraph, link words included, never the piece before a link')
        check(not any(f['code'] == 'TEXT_INCOMPLETE' and f['path'] == '/' for f in F), 'so a sentence with a link in it is not called unfinished')
        hid = [f for f in F if f['code'] == 'PLACEHOLDER' and f['path'] == '/']
        vis = [f for f in F if f['code'] == 'PLACEHOLDER' and f['path'] == '/contact']
        check(not any('your question here' in (f.get('found') or '') for f in hid), 'a Duda widget\'s own hidden template (inside ssrWrap) is not an audit item')
        kept = [f for f in hid if 'hidden by a designer' in (f.get('found') or '')]
        check(kept and kept[0].get('hiddenLive') and kept[0]['severity'] == 'critical', 'placeholder text hidden by the page\'s styles elsewhere is still an item, labelled hidden, and keeps its severity')
        dc = [f for f in F if f['code'] == 'DESIGNER_CREDIT']
        print('   credits:', [(f['found'], f['severity'], f.get('hiddenLive')) for f in dc])
        check(any('SneakyWebCo' in f['found'] and f['severity'] == 'critical' for f in dc), 'a credit hidden with display: none is critical (Google and SEO tools read it)')
        check(any('HiddenDev' in f['found'] and f['severity'] == 'critical' and f.get('hiddenLive') for f in dc), 'a credit hidden by the page\'s stylesheet is found when the page is drawn, and becomes critical')
        check(not any('8bit' in f['found'] for f in dc), 'our own agency\'s credit is expected and not reported')
        check(any(f['code'] == 'HIDDEN_LINK' and 'sneakywebco' in f['found'] for f in F), 'a hidden link to another website is reported')
        check(any(f['code'] == 'H1_HIDDEN' and f['path'] == '/window-tint' for f in F) and not any(f['code'] == 'H1_MISSING' and f['path'] == '/window-tint' for f in F), 'an H1 that exists but is hidden is said plainly, not "no H1"')
        check('hidden by the page' in ' '.join((S.get('scan') or {}).get('log') or []), 'the scan notes say what was left out and why')
        check(vis and vis[0]['severity'] == 'critical' and not vis[0].get('hiddenLive'), 'placeholder text visitors do see stays critical')
        alt = [f for f in F if f['code'] == 'TEXT_SPELLING' and 'Profesional' in f['found']]
        check(alt and 'alt text' in alt[0]['message'] and alt[0]['category'] == 'Images / Alt', 'alt text is proofread, and the item says the slip is in the alt text: ' + (alt[0]['message'] if alt else 'none'))
        check(any(f['code'] == 'TEXT_PUNCTUATION' and 'today!!' in f['found'] for f in F), 'a punctuation mistake confirmed by the second read is raised')
        check(any(f['code'] == 'TEXT_SPACING' and 'Schaumburg,IL' in f['found'] and 'meta description' in f['message'] for f in F), 'a spacing slip in the meta description is raised ("Schaumburg,IL")')
        gr = [f for f in F if f['code'] == 'TEXT_GRAMMAR']
        print('   grammar:', [(f['found'], f.get('expected')) for f in gr])
        check(not any('air bubbles' in f['found'] for f in gr), 'a "correction" that rewrites a correct sentence is not raised')
        check(any('Their is no better' in f['found'] and 'There is' in f.get('expected', '') for f in gr), 'a real grammar mistake confirmed by the second read is raised, with the smallest fix')
        check(not any('Our team know' in f['found'] for f in gr) and SEEN.get('verify', 0) >= 1, 'a grammar flag the second, stricter read does not confirm is dropped')
        wp = [f for f in F if f['code'] == 'LINK_WRONG_PAGE']
        cu = next((f for f in wp if 'Contact us' in f['found']), None)
        check(cu and cu['severity'] == 'critical' and '/contact' in cu.get('expected', ''), '"Contact us" opening the home page is critical, and says where it should go')
        rm = next((f for f in wp if 'Read more' in f['found']), None)
        check(rm and rm['severity'] == 'warning' and 'Ceramic Coating' in (rm.get('snippet') or ''), '"Read more" under Ceramic Coating opening Window Tint is raised, naming its section')
        check(not any('Gallery' in f['found'] for f in wp), 'an answer the AI is unsure of (50%) is not raised')
        sent = [x[0] for x in SEEN['links']]
        print('   links asked about:', SEEN['links'])
        check(('Read more', 'Window Tint', '/window-tint') not in SEEN['links'], '"Read more" under Window Tint opening the window tint page is plainly right and is not asked about')
        check('Ceramic Coating' not in sent and 'Get a quote' not in sent and 'About' not in sent and 'Window Tint' not in sent, 'links that plainly match their page (and menus) are not sent to the AI')
        check((S.get('scan') or {}).get('ai', {}).get('links', {}).get('flagged') == 2 and (S.get('scan') or {}).get('ai', {}).get('proof', {}).get('flagged') == 4, 'the scan notes count what was proofread and checked')
        pg.goto(f'http://localhost:{APORT}/#/site/s1'); pg.wait_for_selector('table.findings', timeout=15000); time.sleep(0.6)
        txt = pg.inner_text('#tabBody')
        check('Proofread' in txt and 'open the wrong page' in txt, 'the scan panel says what the AI proofread and checked')
        pr = (S.get('scan') or {}).get('ai', {}).get('proof', {})
        check(pr.get('blocks') == pr.get('of') and pr.get('blocks', 0) >= 5, f'proofreading reads every block of text ({pr.get("blocks")} of {pr.get("of")})')
        pg.screenshot(path=os.path.join(OUT, 'aicheck.png'))
        calls = SEEN['calls']
        pg.click('#sRescan')
        for _ in range(120):
            time.sleep(1)
            S2 = pg.evaluate("async () => (await fetch('/api/store?op=site&id=s1')).json()")
            if (S2.get('scan') or {}).get('finishedAt') != (S.get('scan') or {}).get('finishedAt') and (S2.get('scan') or {}).get('state') == 'complete': break
        if SEEN['calls'] != calls: print('   new calls:', SEEN['log'][calls:])
        check(SEEN['calls'] == calls, f'a rescan asks the AI nothing new: answers are remembered ({SEEN["calls"] - calls} new calls)')
        check(len([f for f in S2['findings'] if f['code'] in ('LINK_WRONG_PAGE', 'TEXT_SPELLING', 'TEXT_GRAMMAR', 'DESIGNER_CREDIT', 'HIDDEN_LINK', 'H1_HIDDEN', 'TEXT_PUNCTUATION', 'TEXT_SPACING')]) == len([f for f in F if f['code'] in ('LINK_WRONG_PAGE', 'TEXT_SPELLING', 'TEXT_GRAMMAR', 'DESIGNER_CREDIT', 'HIDDEN_LINK', 'H1_HIDDEN', 'TEXT_PUNCTUATION', 'TEXT_SPACING')]), '…and the items are still there, same as before')
        check(not errors, 'no script errors ' + ' | '.join(errors[:3]))
        br.close()
except Exception:
    import traceback; traceback.print_exc(); ok = False
finally:
    srv.terminate()
    for pat in ['[f]ixsite.mjs', '[f]akeredis.mjs', '[d]ev-server.js']: subprocess.run(['pkill', '-f', pat])
print('ALL PASS' if ok else 'SOME FAILED')
