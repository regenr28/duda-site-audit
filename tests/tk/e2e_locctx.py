"""Location check with page context (update 237). A stand-in AI answers like the one that wrote #1352
("New Britain … template text from another client", 92%). Checks: the page's title, H1, section and facility
sentences reach the AI; the cache asks again when only the page context changes; old answers that flagged a
town are asked again, old clean answers are reused without an AI call; and the audit items that come out.
Usage: python3 -I e2e_locctx.py <app> <tests>"""
import hashlib, json, os, re, subprocess, sys, threading, urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT, AIPORT = 3998, 8078, 8116
SEEN = {'calls': 0, 'users': []}
class AI(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get('content-length') or 0)) or b'{}')
        system = body.get('system') if isinstance(body.get('system'), str) else json.dumps(body.get('system'))
        user = ''.join(m['content'] if isinstance(m['content'], str) else ''.join(c.get('text', '') for c in m['content']) for m in body.get('messages', []))
        results = []
        if 'You proofread WEBSITE TEXT' in system:
            SEEN['calls'] += 1; SEEN['users'].append(user); SEEN['system'] = system
            for m in re.finditer(r'^\[(\d+)\] \([^)]*\) (.*)$', user, re.M):
                t = m.group(2)
                if 'New Britain' in t: results.append({'i': int(m.group(1)), 'type': 'wrong_location', 'quote': 'environmental conditions in New Britain, Pennsylvania', 'confidence': 0.92, 'reason': 'Template text from another client.', 'suggestion': "Replace 'New Britain, Pennsylvania' with 'Warminster, Pennsylvania'"})
                if 'Dallas' in t: results.append({'i': int(m.group(1)), 'type': 'wrong_location', 'quote': 'Visit our Dallas location', 'confidence': 0.92, 'reason': 'The business has no shop in Dallas.', 'suggestion': 'Visit our Warminster location'})
        out = json.dumps({'model': 'claude-haiku-4-5-20251001', 'content': [{'type': 'text', 'text': json.dumps({'results': results})}], 'usage': {'input_tokens': 900, 'output_tokens': 120}}).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(out)
    def log_message(self, *a): pass
threading.Thread(target=HTTPServer(('127.0.0.1', AIPORT), AI).serve_forever, daemon=True).start()
env = dict(os.environ, ANTHROPIC_API_KEY='sk-test', ANTHROPIC_API_BASE=f'http://127.0.0.1:{AIPORT}/v1', ANTHROPIC_MODEL='claude-haiku-4-5-20251001', AI_ORDER='anthropic')
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-locctx.log'), 'w'), text=True, env=env)
assert srv.stdout.readline().strip() == 'READY'
TOK = 'tokadmin1234567890abcdef'
def redis(*cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
def post(body):
    req = urllib.request.Request(f'http://localhost:{APORT}/api/ai', data=json.dumps(body).encode(), method='POST', headers={'Cookie': 'dsa_sess=' + TOK, 'Content-Type': 'application/json'})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())
sha = lambda s: hashlib.sha256(s.encode()).hexdigest()
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
BIZ = {'name': 'Shine Detailing', 'city': 'Warminster', 'region': 'PA'}
CK = 'dsa:aic:' + sha('|'.join([BIZ['name'], BIZ['city'], BIZ['region'], '0']))[:20]
P1 = 'A climate-controlled environment is crucial for safeguarding your vehicle against a range of environmental conditions in New Britain, Pennsylvania that could otherwise lead to its premature deterioration.'
CTX = {'title': 'Luxury Vehicle Storage | Shine Detailing', 'h1': 'Luxury Vehicle Storage in Warminster and New Britain through Car Heads Auto Group', 'sec': 'Secure, climate-controlled storage',
       'ctx': 'Our New Britain storage facility is run with our partner Car Heads Auto Group.'}
try:
    item = dict({'i': 0, 'text': P1, 'location': 'Body', 'page': '/service/luxury-vehicle-storage'}, **CTX)
    r = post({'op': 'text', 'business': BIZ, 'items': [item]})
    u = SEEN['users'][-1]
    check('page: SEO title "Luxury Vehicle Storage | Shine Detailing" · H1 "Luxury Vehicle Storage in Warminster and New Britain through Car Heads Auto Group" · section "Secure, climate-controlled storage"' in u, 'the AI gets the page\'s SEO title, H1 and section heading with the paragraph')
    check('also on this page: Our New Britain storage facility is run with our partner' in u, '…and the page\'s own facility/partner sentence')
    s = SEEN['system']
    check('MAIN address' in s and 'partner' in s and 'Confidence is not evidence' in s, 'the AI is told to tell the main address from other facilities and partners, and that confidence is not evidence')
    n0 = SEEN['calls']; post({'op': 'text', 'business': BIZ, 'items': [item]})
    check(SEEN['calls'] == n0, 'the same paragraph on the same page is answered from the cache')
    post({'op': 'text', 'business': BIZ, 'items': [dict(item, h1='Luxury Vehicle Storage in Warminster')]})
    check(SEEN['calls'] == n0 + 1, 'same paragraph, different page context (H1 changed): asked again')
    # Answers from before this update: a town flagged → asked again; a clean answer → reused, no AI call.
    P2, P3 = 'Our showroom team keeps every car spotless in Warminster.', 'Visit our Dallas location for a free quote today.'
    legacy = lambda t: 't' + sha('|'.join([t, '0', '', '']))[:18]
    redis(['HSET', CK, legacy(P2), '0', legacy(P3), json.dumps({'issues': [{'type': 'wrong_location', 'quote': 'Visit our Dallas location', 'confidence': 0.9, 'reason': 'old', 'suggestion': '', 'lv': 2}]})])
    n1 = SEEN['calls']
    r = post({'op': 'text', 'business': BIZ, 'items': [{'i': 0, 'text': P2, 'location': 'Body', 'page': '/'}]})
    check(SEEN['calls'] == n1 and r.get('cachedCount') == 1, 'an old clean answer is reused without asking the AI again')
    r = post({'op': 'text', 'business': BIZ, 'items': [{'i': 0, 'text': P3, 'location': 'Body', 'page': '/', 'title': 'Home | Shine Detailing', 'h1': 'Shine Detailing in Warminster, PA'}]})
    check(SEEN['calls'] == n1 + 1 and any(x.get('lv') == 3 for x in r['results']), 'an old answer that flagged a town is asked again under the new rules')
    check(not redis(['HGET', CK, legacy(P2)])[0] and not redis(['HGET', CK, legacy(P3)])[0], 'the old cache entries are removed, so a later page change is always asked again')
    # Unrelated caches untouched: a proofreading entry stays.
    redis(['HSET', CK, 'p2keep', '0']); post({'op': 'text', 'business': BIZ, 'items': [{'i': 0, 'text': P2, 'location': 'Body', 'page': '/'}]})
    check(redis(['HGET', CK, 'p2keep'])[0] == '0', 'other AI answers in the same cache are left alone')
    # The audit items (engine), from the stand-in's answers.
    js = r"""
      import '%s/public/engine.js';
      const A = globalThis.DudaAudit;
      const truth = { businessName: 'Shine Detailing', addresses: [{ city: 'Warminster', region: 'PA' }], serviceAreas: [] };
      const pages = [{ path: '/service/luxury-vehicle-storage', title: 'Luxury Vehicle Storage | Shine Detailing', h1: 'Luxury Vehicle Storage in Warminster and New Britain through Car Heads Auto Group' },
                     { path: '/service/ceramic-coating', title: 'Ceramic Coating | Shine Detailing', h1: 'Ceramic Coating in Warminster' },
                     { path: '/locations', title: 'Our Locations', h1: 'Our Locations' }];
      const B = (text, page, extra) => Object.assign({ text, selector: '#' + page.length + text.length, location: 'Body', pages: [page], devices: ['desktop'], visibleOn: ['desktop'], hiddenOn: [] }, extra || {});
      const texts = [
        B(%s, '/service/luxury-vehicle-storage'),
        B('Our New Britain storage facility is run with our partner Car Heads Auto Group.', '/service/luxury-vehicle-storage'),
        B('Protect your paint from the environmental conditions in New Britain, Pennsylvania with our coating.', '/service/ceramic-coating'),
        B('Visit our Dallas location for a free quote today.', '/locations'),
        B('Our second shop in Doylestown, PA is open daily.', '/locations'),
      ];
      const nb = { type: 'wrong_location', quote: 'environmental conditions in New Britain, Pennsylvania', confidence: 0.92, reason: 'Template text from another client.', suggestion: "Replace with 'Warminster'" };
      const issues = [Object.assign({ i: 0 }, nb), Object.assign({ i: 2 }, nb),
        { i: 3, type: 'wrong_location', quote: 'Visit our Dallas location', confidence: 0.92, reason: 'No shop in Dallas.', suggestion: 'Visit our Warminster location' },
        { i: 4, type: 'wrong_location', quote: 'second shop in Doylestown, PA', confidence: 0.9, reason: 'Not the address.', suggestion: '' }];
      const out = (t) => A.applyTextIssues([], texts, issues, t, [], pages).map((f) => ({ page: f.path, sev: f.severity, clarify: !!f.clarify, msg: f.message, exp: f.expected, sugg: f.ai.suggestion, reason: f.ai.reason }));
      console.log(JSON.stringify({ plain: out(truth), verified: out(Object.assign({}, truth, { addresses: truth.addresses.concat([{ city: 'Doylestown', region: 'PA' }]) })) }));
    """ % (APP, json.dumps(P1))
    o = subprocess.run(['node', '--input-type=module', '-e', js], capture_output=True, text=True)
    R = json.loads(o.stdout.strip() or '{}'); print('   ', o.stderr[:900])
    for f in R.get('plain', []): print('   ', f)
    pl = R.get('plain', [])
    st = next((f for f in pl if f['page'] == '/service/luxury-vehicle-storage'), {})
    check(st.get('sev') == 'warning' and st.get('clarify') and 'also describes New Britain' in st.get('msg', ''), '#1352: a town the page itself describes (H1, facility paragraph) is a warning For clarification, not critical')
    check(not st.get('sugg') and 'Confirm whether New Britain' in st.get('exp', '') and 'Warminster' not in st.get('exp', ''), '…asking to confirm, with no "replace it with the shop\'s town" suggestion')
    cc = next((f for f in pl if f['page'] == '/service/ceramic-coating'), {})
    check(cc.get('sev') == 'critical' and not cc.get('clarify'), 'the same town on a page that does not describe it stays critical (facility context is local to its page)')
    dl = next((f for f in pl if 'Dallas' in f.get('msg', '') or f['page'] == '/locations' and 'Dallas' in json.dumps(f)), None)
    check(any(f['page'] == '/locations' and f['sev'] == 'critical' for f in pl), 'a genuine contradiction ("Visit our Dallas location", nothing on the page about Dallas) stays critical')
    dy = next((f for f in pl if 'Doylestown' in f.get('msg', '')), {})
    check(dy.get('sev') == 'warning' and dy.get('clarify'), 'a paragraph presenting a second shop in another town (not in Business Info) is asked about, not called wrong')
    ver = R.get('verified', [])
    check(len([f for f in ver if f['page'] == '/locations']) == 1, 'a facility town that is in Business Info (a verified second address) is not reported')
finally:
    srv.terminate()
print('ALL PASS' if ok else 'SOME FAILED'); sys.exit(0 if ok else 1)
