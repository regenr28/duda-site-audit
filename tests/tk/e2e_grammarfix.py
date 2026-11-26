"""Grammar fixes: the smallest fix that keeps the meaning, judged in the whole corrected sentence; the real
problem named; a misused real word is its own "Wrong word" item; optional style improvements are Info.
Usage: python3 -I e2e_grammarfix.py <app> <tests>"""
import json, os, re, subprocess, sys, threading, urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT, AIPORT = 3998, 8078, 8113
SENT = 'We believe in treating your vehicle is treated with the utmost care, the best technology, and the right tools. You can rely on us for high-quality cartouches with lasting protection and unbeatable service.'
AWK = 'We offer the offering of mobile detailing for every car.'
SEEN = {'system': '', 'verify': ''}
class AI(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get('content-length') or 0)) or b'{}')
        system = body.get('system') if isinstance(body.get('system'), str) else json.dumps(body.get('system'))
        user = ''.join(m['content'] if isinstance(m['content'], str) else ''.join(c.get('text', '') for c in m['content']) for m in body.get('messages', []))
        results = []
        if 'senior copy editor' in system:
            SEEN['verify'] = user; SEEN['vsystem'] = system
            for m in re.finditer(r'^(\d+) \| (\w+) \| text: .*? \| flagged: "([^"]*)"', user, re.M):
                i, t, q = int(m.group(1)), m.group(2), m.group(3)
                if q == 'in treating your vehicle is treated':
                    results.append({'i': i, 'error': True, 'confidence': 0.95, 'fix_ok': False, 'better': 'in treating your vehicle', 'reason_ok': False, 'why': "Two sentence structures are mixed: 'believe in treating' and 'believe that … is treated'"})
                elif t == 'wordchoice': results.append({'i': i, 'error': True, 'confidence': 0.9, 'fix_ok': True, 'reason_ok': True})
                elif t == 'optional': results.append({'i': i, 'error': False, 'confidence': 0.9, 'optional_ok': True})
        elif 'proofread the WEBSITE COPY' in system:
            SEEN['system'] = system
            for m in re.finditer(r'^\[(\d+)\] \([^)]*\) (.*)$', user, re.M):
                i, t = int(m.group(1)), m.group(2)
                if 'is treated' in t:
                    results.append({'i': i, 'type': 'grammar', 'quote': 'in treating your vehicle is treated', 'confidence': 0.9, 'reason': 'Subject and verb are duplicated; phrase is ungrammatical.', 'suggestion': 'that your vehicle is treated'})
                    results.append({'i': i, 'type': 'wordchoice', 'quote': 'cartouches', 'confidence': 0.9, 'reason': 'A cartouche is a carved frame; coatings is meant.', 'suggestion': 'coatings'})
                if 'offering of' in t: results.append({'i': i, 'type': 'grammar', 'optional': True, 'quote': 'offer the offering of', 'confidence': 0.9, 'reason': 'Repetitive; reads awkwardly.', 'suggestion': 'offer'})
        out = json.dumps({'model': 'claude-haiku-4-5-20251001', 'content': [{'type': 'text', 'text': json.dumps({'results': results})}], 'usage': {'input_tokens': 900, 'output_tokens': 120}}).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(out)
    def log_message(self, *a): pass
threading.Thread(target=HTTPServer(('127.0.0.1', AIPORT), AI).serve_forever, daemon=True).start()
env = dict(os.environ, ANTHROPIC_API_KEY='sk-test', ANTHROPIC_API_BASE=f'http://127.0.0.1:{AIPORT}/v1', ANTHROPIC_MODEL='claude-haiku-4-5-20251001', AI_ORDER='anthropic')
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-grammarfix.log'), 'w'), text=True, env=env)
assert srv.stdout.readline().strip() == 'READY'
TOK = 'tokadmin1234567890abcdef'
def post(body):
    req = urllib.request.Request(f'http://localhost:{APORT}/api/ai', data=json.dumps(body).encode(), method='POST', headers={'Cookie': 'dsa_sess=' + TOK, 'Content-Type': 'application/json'})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
try:
    items = [{'i': 0, 'text': SENT, 'location': 'Body', 'page': '/service/vehicle-ceramic-coating'}, {'i': 1, 'text': AWK, 'location': 'Body', 'page': '/'}]
    r = post({'op': 'proof', 'business': {'name': 'Test Coatings'}, 'items': items})
    res = r['results']
    print('   ', json.dumps(res)[:900])
    s = SEEN['system']
    check('read the COMPLETE sentence' in s and 'SMALLEST correction' in s and 'Mixed constructions' in s and '"wordchoice"' in s and '"optional": true' in s, 'the proofreader is told: whole sentence, smallest fix, mixed constructions, wrong words, optional apart')
    check('corrected sentence: We believe that your vehicle is treated with the utmost care, the best technology, and the right tools.' in SEEN['verify'], 'the second reader gets the whole sentence with the fix applied')
    g = next((x for x in res if x['type'] == 'grammar' and not x.get('optional')), {})
    check(g.get('suggestion') == 'in treating your vehicle', 'the fix that changed the meaning is replaced by the smallest one ("in treating your vehicle")')
    check('Two sentence structures are mixed' in g.get('reason', '') and 'duplicated' not in g.get('reason', ''), 'the explanation names the real problem (mixed structures), not "duplicated"')
    w = next((x for x in res if x['type'] == 'wordchoice'), {})
    check(w.get('quote') == 'cartouches' and w.get('suggestion') == 'coatings', 'the misused word is its own result, separate from the grammar one')
    o = next((x for x in res if x.get('optional')), {})
    check(o.get('quote') == 'offer the offering of', 'an optional improvement is kept, marked optional')
    # Turned into audit items by the engine.
    js = f"""
      import '{APP}/public/engine.js';
      const A = globalThis.DudaAudit;
      const texts = [{{ text: {json.dumps(SENT)}, selector: '#a > p', location: 'Body', pages: ['/x'], devices: ['desktop'], visibleOn: ['desktop'], hiddenOn: [] }},
                     {{ text: {json.dumps(AWK)}, selector: '#b > p', location: 'Body', pages: ['/'], devices: ['desktop'], visibleOn: ['desktop'], hiddenOn: [] }}];
      const issues = {json.dumps(res)}.map((x) => Object.assign({{}}, x, {{ i: x.i }}));
      const f = A.applyProofIssues([], texts, issues);
      console.log(JSON.stringify(f.map((x) => [x.code, x.severity, x.message, x.found, x.expected])));
    """
    out = subprocess.run(['node', '--input-type=module', '-e', js], capture_output=True, text=True)
    print('   ', out.stdout.strip()[:900], out.stderr[-400:])
    F = json.loads(out.stdout.strip() or '[]')
    check(any(x[0] == 'TEXT_GRAMMAR' and x[1] == 'warning' and x[4] == 'Suggested: in treating your vehicle' for x in F), 'the grammar item suggests "in treating your vehicle"')
    check(any(x[0] == 'TEXT_WORD_CHOICE' and x[2] == 'Wrong word' and x[4] == 'Suggested: coatings' for x in F), 'a separate "Wrong word" item for cartouches')
    check(any(x[1] == 'info' and x[2].startswith('Optional style improvement') and x[4].startswith('Optional:') for x in F), 'the optional improvement is an Info item that says it is not a mistake')
finally:
    srv.terminate()
print('ALL PASS' if ok else 'SOME FAILED'); sys.exit(0 if ok else 1)
