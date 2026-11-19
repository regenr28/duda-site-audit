"""Duda's "Button" labels (a gallery keeps a hidden one per picture) never reach the AI, and an AI item about
them is never kept: the default-label rule alone judges them. A real note left in the copy is still reported.
Usage: python3 -I e2e_labelai.py <app> <tests>"""
import json, os, re, subprocess, sys, time, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, AIPORT = 3998, 8113
SEEN = {'button_in_prompt': 0, 'calls': 0}
class AI(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get('content-length') or 0)) or b'{}')
        system = body.get('system') if isinstance(body.get('system'), str) else json.dumps(body.get('system'))
        user = ''.join(m['content'] if isinstance(m['content'], str) else ''.join(c.get('text', '') for c in m['content']) for m in body.get('messages', []))
        SEEN['calls'] += 1
        results = []
        if 'is about what its ADDRESS' in system:
            if re.search(r'\bButton\b', user): SEEN['button_in_prompt'] += 1
            for m in re.finditer(r'^=== \[(\d+)\] (\S+)', user, re.M):
                i = int(m.group(1))
                # What a model does when it sees the labels: calls them a note left in the text.
                results.append({'i': i, 'type': 'editor_note', 'part': 'body', 'quote': 'Button Button A properly applied ceramic coating', 'confidence': 0.95, 'reason': "Stray 'Button' labels appear in the copy, likely from a template editor.", 'suggestion': "Remove the 'Button Button' text"})
                results.append({'i': i, 'type': 'editor_note', 'part': 'desc', 'quote': 'Do not alter page until legal confirmation.', 'confidence': 0.99, 'reason': 'Editor instruction left in meta description', 'suggestion': 'A real description'})
        elif 'You review image ALT TEXT' in system:
            for m in re.finditer(r'^(\d+) \| ', user, re.M): results.append({'i': int(m.group(1)), 'verdict': 'describes_image', 'confidence': 0.9, 'reason': 'photo', 'suggestion': ''})
        elif re.search(r'\bButton Button\b', user): SEEN['button_in_prompt'] += 1
        out = json.dumps({'model': 'claude-haiku-4-5-20251001', 'content': [{'type': 'text', 'text': json.dumps({'results': results})}], 'usage': {'input_tokens': 900, 'output_tokens': 120}}).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(out)
    def log_message(self, *a): pass
threading.Thread(target=HTTPServer(('127.0.0.1', AIPORT), AI).serve_forever, daemon=True).start()
env = dict(os.environ, ANTHROPIC_API_KEY='sk-test', ANTHROPIC_API_BASE=f'http://127.0.0.1:{AIPORT}/v1', ANTHROPIC_MODEL='claude-haiku-4-5-20251001', AI_ORDER='anthropic')
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-labelai.log'), 'w'), text=True, env=env)
assert srv.stdout.readline().strip() == 'READY'
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
errors = []
GAL = '<div class="photoGallery"><div class="caption-container"><a class="caption-button"><span class="text">Button</span></a></div><div class="caption-container"><a class="caption-button"><span class="text">Button</span></a></div></div>'
PAGE = f'''<html><head><title>Ceramic Coating | Buff & Beyond</title><meta name="description" content="Do not alter page until legal confirmation."><style>.caption-button {{ visibility: hidden; }}</style></head><body><div id="dmcontent"><h1>Is ceramic coating worth it?</h1>
<div class="dmNewParagraph">{GAL}<p>A properly applied ceramic coating keeps your paint glossy and makes washing easier for years.</p></div></div></body></html>'''
META = {'host': 'ed.multiscreensite.com', 'siteId': 'abc123', 'site': {'site_business_info': {'business_name': 'Buff & Beyond'}}, 'content': {}, 'pages': [{'path': '/', 'title': 'Home'}], 'errors': []}
def site_route(r):
    if 'light=1' in r.request.url: return r.fulfill(status=200, content_type='application/json', body=json.dumps({'siteId': 'abc123', 'publishStatus': 'NOT_PUBLISHED'}))
    return r.fulfill(status=200, content_type='application/json', body=json.dumps(META))
try:
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(viewport={'width': 1440, 'height': 1000}); ctx.add_cookies([{'name': 'dsa_sess', 'value': 'tokadmin1234567890abcdef', 'domain': 'localhost', 'path': '/'}])
        ctx.route('**/api/site?*', site_route)
        ctx.route('**/api/fetch?*', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps({'status': 200, 'html': PAGE, 'url': 'https://x/site/abc123/'})))
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('dialog', lambda d: d.accept())
        pg.goto(f'http://localhost:{APORT}/#/site/s1'); pg.wait_for_selector('#sRescan', timeout=20000); time.sleep(1)
        pg.click('#sRescan')
        S = {}
        for _ in range(150):
            time.sleep(1)
            S = pg.evaluate("async () => (await (await fetch('/api/store?op=site&id=s1')).json())")
            if (S.get('scan') or {}).get('state') == 'complete': break
        F = [f for f in S.get('findings') or [] if not f.get('gone')]
        notes = [f for f in F if f['code'] == 'AI_PAGE_NOTE']
        print('  AI calls:', SEEN, ' notes:', [f.get('found') for f in notes], flush=True)
        check(SEEN['calls'] > 0, 'the AI was asked')
        check(SEEN['button_in_prompt'] == 0, 'the page text sent to the AI carries no "Button" labels')
        check(not any('Button' in (f.get('found') or '') for f in F if f['code'].startswith(('AI_', 'TEXT_'))), 'no AI item about a "Button" label is kept')
        check(any('legal confirmation' in (f.get('found') or '') for f in notes), 'a real note left in the meta description is still reported')
        check(not any(f['code'] == 'PLACEHOLDER' and f.get('found') == 'Button' for f in F), 'the hidden gallery labels are not reported by the default-label rule either')
        check(not errors, 'no script errors ' + ' | '.join(errors[:3]))
        br.close()
except Exception:
    import traceback; traceback.print_exc(); ok = False
finally:
    srv.terminate()
    for pat in ['[f]ixsite.mjs', '[f]akeredis.mjs', '[d]ev-server.js']: subprocess.run(['pkill', '-f', pat])
print('ALL PASS' if ok else 'SOME FAILED')
