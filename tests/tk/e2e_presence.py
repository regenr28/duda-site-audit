"""Online presence: Google and Facebook compared with Business Info. Only what a cited page shows word for
word is kept; Google comes from Google directly once a Maps key is set; suggestions reach a customer only
when they are set to. Usage: python3 -I e2e_presence.py <app> <tests>"""
import json, os, subprocess, sys, time, threading, urllib.request, zlib, base64
from http.server import BaseHTTPRequestHandler, HTTPServer
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT, FPORT, XPORT = 3998, 8078, 8097, 8112
seen = {'ai': 0, 'places': 0, 'search_body': None}
FB = 'https://www.facebook.com/buffandbeyond'; GM = 'https://www.google.com/maps/place/Buff+%26+Beyond'
class X(BaseHTTPRequestHandler):
    def do_POST(self): self.answer()
    def do_GET(self): self.answer()
    def answer(self):
        body = self.rfile.read(int(self.headers.get('content-length') or 0))
        if self.path.startswith('/v1/messages'):
            seen['ai'] += 1; seen['search_body'] = json.loads(body or b'{}')
            out = {'model': 'claude-haiku-4-5-20251001', 'usage': {'input_tokens': 15000, 'output_tokens': 600, 'server_tool_use': {'web_search_requests': 2}}, 'content': [
                {'type': 'server_tool_use', 'id': 's1', 'name': 'web_search', 'input': {'query': 'Buff & Beyond Allentown PA'}},
                {'type': 'web_search_tool_result', 'tool_use_id': 's1', 'content': [
                    {'type': 'web_search_result', 'url': FB, 'title': 'Buff and Beyond | Allentown PA | Facebook', 'encrypted_content': 'x'},
                    {'type': 'web_search_result', 'url': GM, 'title': 'Buff & Beyond - Google Maps', 'encrypted_content': 'x'}]},
                {'type': 'text', 'text': 'Facebook shows the phone (610) 555-0100.', 'citations': [{'type': 'web_search_result_location', 'url': FB, 'title': 'Facebook', 'cited_text': 'Buff and Beyond. Auto detailing in Allentown. Call (610) 555-0100 · 12 Oak Ave, Allentown, PA 18101 · www.glossygarage.com'}]},
                {'type': 'text', 'text': 'Google lists the phone 610.555.0199.', 'citations': [{'type': 'web_search_result_location', 'url': GM, 'title': 'Google Maps', 'cited_text': 'Buff & Beyond · Car detailing · 610.555.0199 · Open now'}]},
                {'type': 'text', 'text': '```json\n' + json.dumps({'listings': [
                    {'platform': 'facebook', 'url': FB, 'name': 'Buff and Beyond', 'phone': '(610) 555-0100', 'address': '12 Oak Ave, Allentown, PA 18101', 'email': 'owner@buffandbeyond.com', 'website': 'www.glossygarage.com'},
                    {'platform': 'google', 'url': GM, 'name': 'Buff & Beyond', 'phone': '610.555.0199', 'address': '99 Made Up Rd, Allentown'},
                    {'platform': 'facebook', 'url': 'https://www.facebook.com/someoneelse', 'name': 'Other Shine', 'phone': '(215) 555-0000'}]}) + '\n```'}]}
        elif self.path.startswith('/places'):
            seen['places'] += 1
            place = {'id': 'pl1', 'displayName': {'text': 'Buff & Beyond Auto Detailing'}, 'formattedAddress': '12 Oak Ave, Allentown, PA 18101, USA', 'nationalPhoneNumber': '(610) 555-0100',
                     'websiteUri': f'http://localhost:{FPORT}/', 'googleMapsUri': 'https://maps.google.com/?cid=1', 'businessStatus': 'OPERATIONAL'}
            out = {'places': [{'id': 'nope', 'displayName': {'text': 'Buff & Beyond'}, 'formattedAddress': 'Somewhere else, TX 75000', 'nationalPhoneNumber': '(214) 555-1111'}, place]} if 'searchText' in self.path else place
        else:
            out = {}
        b = json.dumps(out).encode(); self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(b)
    def log_message(self, *a): pass
threading.Thread(target=HTTPServer(('127.0.0.1', XPORT), X).serve_forever, daemon=True).start()
fk = subprocess.Popen(['node', os.path.join(OUT, 'fakewatch.mjs'), str(FPORT)], stdout=subprocess.DEVNULL)
base_env = dict(os.environ, DUDA_API_BASE=f'http://127.0.0.1:{FPORT}/api', DUDA_API_USERNAME='u', DUDA_API_PASSWORD='p', WATCH_PROTOCOL='http',
                ANTHROPIC_API_KEY='sk-test', ANTHROPIC_API_BASE=f'http://127.0.0.1:{XPORT}/v1', ANTHROPIC_MODEL='claude-haiku-4-5-20251001', GOOGLE_PLACES_API_BASE=f'http://127.0.0.1:{XPORT}')
ADMIN, MEMBER, CLIENT = 'reymark@8bitcreative.com', 'dev@8bitcreative.com', 'owner@buffandbeyond.com'
TOK = {ADMIN: 'tokadmin1234567890abcdef', MEMBER: 'tokmember1234567890abcde', CLIENT: 'tokclient1234567890abcde'}
def start(env):
    p = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-pres.log'), 'a'), text=True, env=env)
    assert p.stdout.readline().strip() == 'READY'; return p
def redis(*cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
def api(as_, method, path, body=None):
    req = urllib.request.Request(f'http://localhost:{APORT}{path}', data=json.dumps(body).encode() if body is not None else None, method=method, headers={'Content-Type': 'application/json', 'Cookie': 'dsa_sess=' + TOK[as_]})
    try:
        r = urllib.request.urlopen(req, timeout=120); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')
def pack(o):
    c = zlib.compressobj(9, zlib.DEFLATED, -15); return 'z1:' + base64.b64encode(c.compress(json.dumps(o).encode()) + c.flush()).decode()
def seed():
    redis(['SET', 'dsa:dudasites', pack({'v': 2, 'at': int(time.time() * 1000), 'count': 1, 'scope': 'published', 'sites': [{'id': 'abc123', 'name': 'Buff & Beyond', 'domain': f'localhost:{FPORT}', 'published': '2026-10-01T10:00:00Z', 'first': '2025-03-01T10:00:00Z', 'labels': []}]})],
          ['SET', 'dsa:cwcfg', json.dumps({'off': True})])
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
srv = start(base_env)
try:
    seed()
    st, r = api(MEMBER, 'POST', '/api/watch', {'op': 'presence', 'id': 'abc123'})
    check(st == 403, 'a role without Live DR Sites cannot run it')
    st, r = api(ADMIN, 'POST', '/api/watch', {'op': 'presence', 'id': 'abc123'})
    check(st == 200 and r['result'] and not r['result'].get('error'), 'the check runs: %s' % str(r)[:160])
    res = r['result']; L = {x['platform']: x for x in res['listings']}
    fb, g = L.get('facebook', {}), L.get('google', {})
    check(seen['ai'] == 1 and any(t.get('type') == 'web_search_20250305' for t in seen['search_body'].get('tools', [])), 'one AI request with web search')
    check(fb.get('found') and fb.get('url') == FB and fb.get('phone') == '(610) 555-0100' and fb.get('address', '').startswith('12 Oak Ave'), 'Facebook: the details the cited page shows word for word')
    check('email' not in fb and 'email' in fb.get('unconfirmed', []), 'an email the page does not show is left out, not guessed')
    check(not any('someoneelse' in (x.get('url') or '') for x in res['listings']), 'a page that was never in the search results is not reported')
    fbn = ' | '.join(n['text'] for n in fb.get('notes', []))
    check(any(n['kind'] == 'phone' and n['level'] == 'format' for n in fb.get('notes', [])) and '610-555-0100' in fbn, 'same phone, different format from the website: a Format note: ' + fbn)
    check('as 610-555-0100' in fbn, 'the website\'s own format is read exactly (no stray digit): ' + fbn)
    check(any(n['kind'] == 'name' and n['level'] == 'format' for n in fb.get('notes', [])), '"Buff and Beyond" vs "Buff & Beyond": same business, written differently')
    wn = [n for n in fb.get('notes', []) if n['kind'] == 'website']
    check(fb.get('website') == 'www.glossygarage.com' and wn and wn[0]['level'] == 'check' and 'glossygarage.com' in wn[0]['text'], 'Facebook links to the wrong website (another business\'s domain): a Check: ' + (wn[0]['text'] if wn else 'none'))
    check(any('links to glossygarage.com' in t for t in res.get('recs', [])), 'and a suggestion to change it')
    gn = ' | '.join(n['text'] for n in g.get('notes', []))
    check(g.get('found') and g.get('source') == 'websearch' and any(n['kind'] == 'phone' and n['level'] == 'check' for n in g.get('notes', [])), 'Google (by web search for now): a phone not in Business Info is a Check: ' + gn)
    check('address' not in g and 'address' in g.get('unconfirmed', []), 'an address the cited page does not show is left out')
    check(res.get('recs') and any('same format' in t for t in res['recs']), 'suggestions for the client: ' + ' / '.join(res.get('recs', []))[:300])
    # usage counted
    for _ in range(3):   # a run's counts are written just after its answer is sent: give them a moment
        time.sleep(0.4); st, u = api(ADMIN, 'GET', '/api/health?op=usage')
        a = {x['action']: x for x in u['actions']}.get('watch.presence', {}).get('today', {})
        if a.get('searches'): break
    check(a.get('searches') == 2 and a.get('aiIn') == 15000 and a['cost']['usd'] > 0.02, 'its cost is on Usage & activity (2 searches, tokens): ' + json.dumps({k: a.get(k) for k in ('searches', 'aiIn', 'cost')}))
    # the customer sees it only when set to
    st, r = api(CLIENT, 'GET', '/api/client?op=site&id=s1')
    check(st == 200 and r.get('presence') is None, 'team only by default: the customer does not see the suggestions')
    st, r = api(MEMBER, 'POST', '/api/watch', {'op': 'presenceSettings', 'clientDefault': True})
    check(st == 403, 'only admins change the setting')
    st, r = api(ADMIN, 'POST', '/api/watch', {'op': 'presenceSettings', 'clientDefault': True})
    st, r = api(CLIENT, 'GET', '/api/client?op=site&id=s1')
    check(r.get('presence') and r['presence']['recs'], 'switched on for everyone: the customer sees them')
    api(ADMIN, 'POST', '/api/users', {'op': 'clientSave', 'email': CLIENT, 'name': 'Bob Owner', 'sites': ['s1'], 'showPresence': False})
    st, r = api(CLIENT, 'GET', '/api/client?op=site&id=s1')
    check(r.get('presence') is None, 'switched off on this customer\'s profile: hidden for them')
    api(ADMIN, 'POST', '/api/users', {'op': 'clientSave', 'email': CLIENT, 'name': 'Bob Owner', 'sites': ['s1'], 'showPresence': True})
    # automatic checks: off until switched on; then open tabs run them through the day, within the daily number
    st, p0 = api(ADMIN, 'POST', '/api/pulse', {'lastActive': '2026-10-14T00:00:00Z'})
    check(p0.get('wq') == 0, 'automatic checks off: open tabs are not asked to run anything')
    redis(['HDEL', 'dsa:presencesum', 'abc123'])
    ai_before = seen['ai']
    api(ADMIN, 'POST', '/api/watch', {'op': 'presenceSettings', 'auto': True, 'perDay': 1})
    st, p1 = api(ADMIN, 'POST', '/api/pulse', {'lastActive': '2026-10-14T00:00:00Z'})
    check(p1.get('wq', 0) >= 1, 'switched on: the heartbeat asks open tabs to help')
    st, d = api(ADMIN, 'POST', '/api/watch', {'op': 'drain'})
    check(d.get('presenceDone') == 1 and seen['ai'] == ai_before + 1, 'a tab\'s drain runs one check (the auto audit itself is paused here): ' + json.dumps({k: d.get(k) for k in ('presenceDone', 'pending', 'off')}))
    st, d2 = api(ADMIN, 'POST', '/api/watch', {'op': 'drain'})
    st, p2 = api(ADMIN, 'POST', '/api/pulse', {'lastActive': '2026-10-14T00:00:00Z'})
    check(not d2.get('presenceDone') and seen['ai'] == ai_before + 1 and p2.get('wq') == 0, 'the daily number (1) is respected, and the heartbeat stops asking')
    api(ADMIN, 'POST', '/api/watch', {'op': 'presenceSettings', 'auto': False})
    with sync_playwright() as pw:
        br = pw.chromium.launch(); ctx = br.new_context(viewport={'width': 1300, 'height': 1000})
        ctx.add_cookies([{'name': 'dsa_sess', 'value': TOK[ADMIN], 'domain': 'localhost', 'path': '/'}])
        pg = ctx.new_page(); errors = []; pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(f'http://localhost:{APORT}/#/dr/abc123'); pg.wait_for_selector('.pf-cards', timeout=20000); pg.wait_for_function("() => /to look at|matches Business Info/.test(document.querySelector('.pf-cards').textContent)", timeout=20000)
        pc = pg.locator('.pf-card', has_text='Online presence').inner_text()
        check('to look at' in pc and 'found' in pc and pg.locator('.pf-tab[data-pftab="presence"] .pf-tab-n').count() == 1, 'the Overview has an Online presence card and the tab shows how many notes: ' + pc.replace('\n', ' | '))
        pg.click('.pf-tab[data-pftab="presence"]'); pg.wait_for_selector('#pfPresence', timeout=20000); pg.wait_for_selector('.ps-item', timeout=20000); time.sleep(0.6)
        t = pg.inner_text('section:has(#pfPresence)')
        check('Facebook' in t and 'Google Business Profile' in t and 'Format' in t and 'Suggestions for the client' in t, 'the website profile shows each listing, its notes and the suggestions')
        pg.locator('#pfPresence').scroll_into_view_if_needed(); pg.screenshot(path=os.path.join(OUT, 'presence.png'))
        pg.goto(f'http://localhost:{APORT}/#/settings/presence'); pg.wait_for_selector('#psSave', timeout=20000)
        check(pg.is_checked('#psClient') and not pg.is_checked('#psAuto'), 'settings: shown to customers (as set), automatic checks off by default')
        pg.goto(f'http://localhost:{APORT}/#/customers'); pg.wait_for_selector('.cu-card:has-text("Bob Owner") [data-cuopen]', timeout=20000); pg.click('.cu-card:has-text("Bob Owner") [data-cuopen]'); pg.wait_for_selector('#ocPres .cu-pres', timeout=20000); time.sleep(0.5)
        check('same format' in pg.inner_text('#ocPres') and pg.is_checked('#ocShowPres'), 'the customer profile lists the suggestions with the switch')
        pg.screenshot(path=os.path.join(OUT, 'presence-customer.png'))
        cc = br.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        cc.add_cookies([{'name': 'dsa_sess', 'value': TOK[CLIENT], 'domain': 'localhost', 'path': '/'}])
        cp = cc.new_page(); cp.on('pageerror', lambda e: errors.append(str(e)))
        cp.goto(f'http://localhost:{APORT}/#/my/s1/overview'); cp.wait_for_selector('.cp-pres', timeout=20000); time.sleep(0.5)
        check('Increase your searchability' in cp.inner_text('.cp-pres'), 'the customer sees "Increase your searchability" in their portal')
        check(cp.evaluate('() => document.documentElement.scrollWidth') <= 392, 'fits a phone')
        cp.locator('.cp-pres').scroll_into_view_if_needed(); cp.screenshot(path=os.path.join(OUT, 'presence-client.png'))
        check(not errors, 'no script errors ' + ' | '.join(errors[:2]))
        br.close()
finally:
    srv.terminate()
# ---- with a Google Maps key: Google's own data, and only a listing that is clearly theirs ----
time.sleep(0.5)
srv = start(dict(base_env, GOOGLE_MAPS_API_KEY='gk-test'))
try:
    seed()
    st, r = api(ADMIN, 'POST', '/api/watch', {'op': 'presence', 'id': 'abc123'})
    g = {x['platform']: x for x in r['result']['listings']}.get('google', {})
    check(g.get('source') == 'places' and g.get('found') and g.get('phone') == '(610) 555-0100' and 'website is theirs' in g.get('why', ''), 'with the key, Google comes from Google, picking the listing that is clearly theirs (their website), not the first similar name: ' + json.dumps(g)[:200])
    check(any(n['kind'] == 'name' and n['level'] == 'format' for n in g.get('notes', [])), '"Buff & Beyond Auto Detailing" on Google: same business, written differently')
    check(not any(n['kind'] == 'website' for n in g.get('notes', [])), 'Google links to their own website: no note')
    check(redis(['GET', 'dsa:gbp:abc123'])[0] == 'pl1', 'the listing is remembered, so the next check is one lookup')
    st, u = api(ADMIN, 'GET', '/api/health?op=usage')
    lim = {l['key']: l for l in u['limits']}
    check(lim['places']['used'] == seen['places'] and lim['places']['limit'] == 1000, 'Google lookups used are shown against the free 1,000 a month: %s' % lim['places']['used'])
finally:
    srv.terminate(); fk.terminate()
print('ALL PASS' if ok else 'SOME FAILED')
