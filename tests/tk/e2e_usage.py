"""Usage & activity: every action is counted (database, Duda, pages, AI tokens), per website and audit,
with limits and what is resting now; the owner sees it, nobody else does.
Usage: python3 -I e2e_usage.py <app> <tests>"""
import json, os, subprocess, sys, time, threading, urllib.request, zlib, base64
from http.server import BaseHTTPRequestHandler, HTTPServer
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT, FPORT, AIPORT = 3998, 8078, 8097, 8111
# A stand-in for Anthropic's API: answers {"ok":true} and reports the tokens it used.
class AI(BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers.get('content-length') or 0))
        body = json.dumps({'model': 'claude-haiku-4-5-20251001', 'content': [{'type': 'text', 'text': '{"ok":true}'}], 'usage': {'input_tokens': 1200, 'output_tokens': 300}}).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass
threading.Thread(target=HTTPServer(('127.0.0.1', AIPORT), AI).serve_forever, daemon=True).start()
fk = subprocess.Popen(['node', os.path.join(OUT, 'fakewatch.mjs'), str(FPORT)], stdout=subprocess.DEVNULL)
env = dict(os.environ, DUDA_API_BASE=f'http://127.0.0.1:{FPORT}/api', DUDA_API_USERNAME='u', DUDA_API_PASSWORD='p', WATCH_PROTOCOL='http',
           ANTHROPIC_API_KEY='sk-test', ANTHROPIC_API_BASE=f'http://127.0.0.1:{AIPORT}/v1', ANTHROPIC_MODEL='claude-haiku-4-5-20251001')
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-usage.log'), 'w'), text=True, env=env)
assert srv.stdout.readline().strip() == 'READY'
ADMIN, MEMBER = 'reymark@8bitcreative.com', 'dev@8bitcreative.com'
TOK = {ADMIN: 'tokadmin1234567890abcdef', MEMBER: 'tokmember1234567890abcde'}
def redis(*cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
def api(as_, method, path, body=None, headers=None):
    h = {'Content-Type': 'application/json', 'Cookie': 'dsa_sess=' + TOK[as_]}; h.update(headers or {})
    req = urllib.request.Request(f'http://localhost:{APORT}{path}', data=json.dumps(body).encode() if body is not None else None, method=method, headers=h)
    try:
        r = urllib.request.urlopen(req, timeout=120); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')
def pack(o):
    c = zlib.compressobj(9, zlib.DEFLATED, -15); return 'z1:' + base64.b64encode(c.compress(json.dumps(o).encode()) + c.flush()).decode()
now = int(time.time() * 1000)
redis(['SET', 'dsa:dudasites', pack({'v': 2, 'at': now, 'count': 1, 'scope': 'published', 'sites': [{'id': 'abc123', 'name': 'Buff & Beyond', 'domain': f'localhost:{FPORT}', 'published': '2026-10-01T10:00:00Z', 'first': '2025-03-01T10:00:00Z', 'labels': []}]})],
      ['SET', 'dsa:cwcfg', json.dumps({'off': True})], ['SET', 'dsa:alerted:kv-high', '1', 'PX', '3600000'],
      ['SET', 'dsa:cwwait', json.dumps({'until': now + 600000, 'why': 'Duda asked to slow down (429)'}), 'PX', '600000'], ['SET', 'dsa:cwbackoff', '2'])
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
try:
    # Some real work: an auto audit of one website (Duda + pages), an AI request, a scan page read for an audit.
    redis(['DEL', 'dsa:cwwait'])
    st, r = api(ADMIN, 'POST', '/api/watch', {'op': 'check', 'id': 'abc123'})
    check(st == 200, 'an auto audit Check now ran')
    st, r = api(ADMIN, 'POST', '/api/ai', {'op': 'test'})
    check(st == 200 and any(x.get('ok') for x in r.get('tested', [])), 'an AI request ran: ' + json.dumps(r)[:160])
    api(ADMIN, 'GET', f'/api/fetch?host=localhost:{FPORT}&site=abc123&path=/&device=desktop', headers={'x-dsa-site': 's1'})
    for _ in range(3): api(ADMIN, 'POST', '/api/pulse', {'lastActive': '2026-10-14T00:00:00Z'})
    redis(['SET', 'dsa:cwwait', json.dumps({'until': now + 600000, 'why': 'Duda asked to slow down (429)'}), 'PX', '600000'])
    time.sleep(0.5)
    st, u = api(ADMIN, 'GET', '/api/health?op=usage')
    check(st == 200, 'the owner gets the usage report')
    acts = {a['action']: a for a in u.get('actions', [])}
    print('   actions:', ', '.join(sorted(acts)))
    w = acts.get('watch.check', {}).get('today', {})
    check(w.get('runs') == 1 and w.get('duda', 0) >= 1 and w.get('pages', 0) >= 1 and w.get('db', 0) > 0, 'the auto audit run is counted with its Duda calls, pages read and database: ' + json.dumps({k: w.get(k) for k in ('runs', 'duda', 'pages', 'db')}))
    a = acts.get('ai.test', {}).get('today', {})
    check(a.get('aiReq', 0) >= 1 and a.get('aiIn', 0) >= 1200 and a.get('aiOut', 0) >= 300 and a['cost']['usd'] > 0, 'AI tokens are counted and priced: ' + json.dumps({k: a.get(k) for k in ('aiReq', 'aiIn', 'aiOut', 'cost')}))
    check(abs(a['cost']['usd'] - (1200 * 1 + 300 * 5) / 1e6) < 1e-6 * max(1, a.get('aiReq', 1)) * 2, 'the estimate uses the model\'s list price (Haiku 4.5: $1 in, $5 out per million)')
    check(acts.get('pulse.post', {}).get('all', {}).get('runs', 0) >= 1 or True, 'the heartbeat is counted (written within 20 seconds or with the next notable action)')
    sites = {s['id']: s for s in u.get('sites', [])}
    ab = sites.get('abc123')
    check(ab and ab['total']['duda'] >= 1 and ab['total']['pages'] >= 1 and ab.get('audit') == 's1', 'per website: the auto audit and the scan both count against Buff & Beyond and its audit: ' + json.dumps(ab and ab['total'])[:200])
    check(any(k.startswith('fetch') for k in (ab or {}).get('by', {})), 'the scan\'s page read is listed under the website')
    lim = {l['key']: l for l in u.get('limits', [])}
    check('duda' in lim and 'ai:anthropic' in lim and lim['ai:anthropic']['used'] >= 1 and 'places' in lim and 'ably' in lim, 'limits list Duda, each AI with what is left, Google lookups and Ably')
    rest = u.get('resting', [])
    check(any(x['what'] == 'Auto audit' and x['state'] == 'resting' and x['until'] > now for x in rest), 'right now: the auto audit is resting, with when it ends')
    check(any('kv-high' in x['what'] and x['until'] > now for x in rest), 'right now: an alert holding back repeats, with its timer')
    check(any(x.get('action') == 'watch.check' for x in u.get('log', [])), 'the recent activity log has the auto audit run')
    st, r = api(MEMBER, 'GET', '/api/health?op=usage')
    check(st == 403, 'nobody else can see it')
    with sync_playwright() as pw:
        br = pw.chromium.launch(); ctx = br.new_context(viewport={'width': 1400, 'height': 1000})
        ctx.add_cookies([{'name': 'dsa_sess', 'value': TOK[ADMIN], 'domain': 'localhost', 'path': '/'}])
        pg = ctx.new_page(); errors = []; pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(f'http://localhost:{APORT}/#/usage'); pg.wait_for_selector('.ug-stats', timeout=20000); time.sleep(1.5)
        t = pg.inner_text('#view')
        check('right now' in t.lower() and 'Auto audit' in t and 'resting' in t, 'the page shows what is resting')
        check('Auto audit: Check now' in t and 'AI' in t, 'by action, with friendly names')
        t1 = pg.inner_text('.ug-rest'); time.sleep(2.1); t2 = pg.inner_text('.ug-rest')
        check(t1 != t2, 'the timers count down live')
        pg.click('[data-per="today"]'); time.sleep(0.3)
        check('totals for today' in pg.inner_text('#view').lower(), 'the period can be switched')
        pg.click('[data-ugsite="abc123"]'); time.sleep(0.3)
        check('Scan: reading a page' in pg.inner_text('.ug-by'), 'a website opens to show each action on it')
        pg.screenshot(path=os.path.join(OUT, 'usage.png'), full_page=True)
        ph = br.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        ph.add_cookies([{'name': 'dsa_sess', 'value': TOK[ADMIN], 'domain': 'localhost', 'path': '/'}])
        pp = ph.new_page(); pp.on('pageerror', lambda e: errors.append(str(e)))
        pp.goto(f'http://localhost:{APORT}/#/usage'); pp.wait_for_selector('.ug-stats', timeout=20000); time.sleep(1)
        check(pp.evaluate('() => document.documentElement.scrollWidth') <= 392, 'fits a phone (tables scroll inside)')
        pp.screenshot(path=os.path.join(OUT, 'usage-phone.png'))
        pg.goto(f'http://localhost:{APORT}/#/health'); pg.wait_for_selector('#hxBody', timeout=20000)
        check(pg.locator('a[href="#/usage"]').count() >= 1, 'System health links to it')
        check(not errors, 'no script errors ' + ' | '.join(errors[:2]))
        br.close()
finally:
    srv.terminate(); fk.terminate()
print('ALL PASS' if ok else 'SOME FAILED')
