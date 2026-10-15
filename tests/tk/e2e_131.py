"""Form pages worked out from the form's name; Lead analysis on the app's own storage; what this copy has.
Usage: python3 -I e2e_131.py <app> <tests>"""
import json, os, subprocess, sys, time, urllib.request, zlib, base64
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT = 3998, 8078
TOK = 'tokadmin1234567890abcdef'; ADMIN = 'reymark@8bitcreative.com'
env = dict(os.environ, APP_COPY='1')
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-131.log'), 'w'), text=True, env=env)
assert srv.stdout.readline().strip() == 'READY'
def redis(*cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
def api(path):
    req = urllib.request.Request(f'http://localhost:{APORT}{path}', headers={'Cookie': 'dsa_sess=' + TOK})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())
def pack(o):
    c = zlib.compressobj(9, zlib.DEFLATED, -15); return 'z1:' + base64.b64encode(c.compress(json.dumps(o).encode()) + c.flush()).decode()
now = time.time(); iso = lambda days: time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(now - days * 86400))
ym = time.strftime('%Y-%m', time.gmtime(now))
sites = [{'id': 'abc123', 'name': 'Buff & Beyond', 'domain': 'buffandbeyond.com', 'published': '2026-10-01T10:00:00Z', 'first': '2025-03-01T10:00:00Z', 'labels': []},
         {'id': 'q1', 'name': 'Quiet Car Spa', 'domain': 'quietcarspa.com', 'published': '2026-09-01T10:00:00Z', 'first': '2024-03-01T10:00:00Z', 'labels': []},
         {'id': 'slow1', 'name': 'Slow Detail', 'domain': 'slowdetail.com', 'published': '2026-09-01T10:00:00Z', 'first': '2024-03-01T10:00:00Z', 'labels': []}]
lead = lambda i, days, pg, fm: json.dumps({'id': 'L' + str(i), 'at': iso(days), 'n': 'Person %d' % i, 'e': 'p%d@example.com' % i, 'p': '', 'f': {'Message': 'Hello %d' % i}, 'sig': 's%d' % i, 'pg': pg, 'fm': fm, 'campaign': '', 'src': '', 'h': 'h%d' % i, 'via': 'duda' if not pg else 'hook'})
redis(['SET', 'dsa:dudasites', pack({'v': 2, 'at': int(now * 1000), 'count': 3, 'sites': sites, 'scope': 'published'})],
      ['SET', 'dsa:dudadrafts', pack({'v': 2, 'at': int(now * 1000), 'count': 0, 'sites': [], 'scope': 'unpublished'})],
      # q1: 60 a year, nothing for 40 days → quiet. slow1: 8 a year, 40 days → its usual gap. d0: unpublished.
      ['HSET', 'dsa:leadtot', 'abc123', '24', 'q1', '60', 'slow1', '8', 'd0', '40', 'tiny', '3'],
      ['HSET', 'dsa:leadlast', 'abc123', iso(1), 'q1', iso(40), 'slow1', iso(40), 'd0', iso(60), 'tiny', iso(200)],
      ['HSET', 'dsa:domstat', 'q1', json.dumps({'status': 'down', 'label': 'Not loading', 'checkedAt': int(now * 1000)})],
      ['SET', 'dsa:cw:q1', json.dumps({'at': int(now * 1000), 'issues': [], 'forms': {}})],
      # abc123: one live enquiry with its page, three from Duda's history without one
      ['RPUSH', f'dsa:lead:abc123:{ym}', lead(1, 1, 'Contact Us page', 'Contact Form'), lead(2, 2, '', 'Contact Form'), lead(3, 2, '', 'Quote Request'), lead(4, 2, '', '')],
      ['HSET', 'dsa:formhit:abc123', 'Quote Request', json.dumps({'at': iso(5), 'page': '/get-a-quote'})],
      ['SET', 'dsa:cw:abc123', json.dumps({'at': int(now * 1000), 'issues': [], 'forms': {'/contact-us': ['Contact Form'], '/get-a-quote': ['Quote Request']}})])
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
errors = []
try:
    d = api('/api/leads?op=list&id=abc123&months=12')
    pages = {p['k']: p['n'] for p in d['groups']['pages']}
    print('   by page:', pages)
    check(pages.get('Contact Us page') == 2, 'a history enquiry from the "Contact Form" gets the page its live enquiries came from')
    check(pages.get('/get-a-quote') == 1, 'a form Duda delivered live with its page fills in its history too')
    check(pages.get('') == 1 and len(pages) == 3, 'an enquiry with no form name and two pages with forms stays unknown (nothing guessed)')
    L = {l['id']: l for l in d['leads']}
    check(L['L2'].get('pgHow') == 'form' and not L['L1'].get('pgHow'), 'a worked-out page is marked as such')
    q = api('/api/analysis?op=quiet')
    ids = [r['site'] for r in q.get('sites', [])]
    print('   quiet:', q.get('sites'))
    check(q.get('ready') and q.get('kv') and ids == ['q1'], 'Forms gone quiet works without the analysis database: only the busy website that stopped')
    r = q['sites'][0]
    check(r['quiet_days'] == 40 and r['per_month'] == 5 and r['missed'] >= 6 and r['form'] is False and r['dom']['label'] == 'Not loading' and r['name'] == 'Quiet Car Spa', 'with how long, the usual rate, roughly how many were missed, and what to check')
    b = api('/api/analysis?op=benchmarks')
    print('   across:', b.get('overall'), b.get('bands'))
    check(b.get('kv') and b['overall']['sites'] == 3 and b['overall']['active30'] == 1 and b['top'][0]['name'] == 'Quiet Car Spa', 'Across all websites: counts, bands and the busiest websites from the app\'s own numbers')
    h = api('/api/health')
    keys = {x['key']: x for x in h.get('setup', [])}
    check('db' in keys and 'duda' in keys and 'ai:anthropic' in keys and 'maps' in keys and 'psi' in keys and 'gsa' in keys, 'System health lists every connection and key, set or not')
    check(h.get('copy') and any('Emails' in x for x in h['copy']['off']), 'on the copy it says what is switched off on purpose')
    # the daily alert: the first run only remembers, a new silence is reported once
    node = f"""process.env.KV_REST_API_URL='http://127.0.0.1:{RPORT}'; process.env.KV_REST_API_TOKEN='x';
      const m = await import('{os.path.join(APP, 'api/_leadkv.js')}');
      const a = await m.quietAlerts({{ force: false }}); const b = await m.quietAlerts({{ force: false }});
      console.log(JSON.stringify({{ a, b }}));"""
    outp = subprocess.run(['node', '--input-type=module', '-e', node], capture_output=True, text=True, env=dict(os.environ, SUGGESTIONS_OWNER=ADMIN))
    print('   alerts:', outp.stdout.strip(), outp.stderr[-300:])
    res = json.loads(outp.stdout.strip().splitlines()[-1])
    check(res['a'].get('first') and res['b'].get('skipped'), 'the first daily run only remembers what is quiet (no flood), and it runs once a day')
    redis(['HDEL', 'dsa:quietseen', 'q1'], ['HSET', 'dsa:quietseen', 'old', '2020-01-01'])
    node2 = node.replace("const a = await m.quietAlerts({ force: false }); const b = await m.quietAlerts({ force: false });", "const a = await m.quietAlerts({ force: true }); const b = await m.quietAlerts({ force: true });")
    outp = subprocess.run(['node', '--input-type=module', '-e', node2], capture_output=True, text=True)
    res = json.loads(outp.stdout.strip().splitlines()[-1])
    notes = [json.loads(x) for x in (redis(['LRANGE', 'dsa:notif:' + ADMIN, 0, 20])[0] or [])]
    qn = [n for n in notes if n.get('kind') == 'leads-quiet']
    check(res['a'].get('fresh') == 1 and res['b'].get('fresh') == 0 and len(qn) == 1 and 'Quiet Car Spa' in qn[0]['text'] and 'no contact form found' in qn[0]['text'], 'a website that has just gone quiet is reported to the admins once: ' + (qn[0]['text'] if qn else 'none'))
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(viewport={'width': 1400, 'height': 1000})
        ctx.add_cookies([{'name': 'dsa_sess', 'value': TOK, 'domain': 'localhost', 'path': '/'}])
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(f'http://localhost:{APORT}/#/dr/abc123/submissions'); pg.wait_for_selector('.ch-h', timeout=20000); time.sleep(0.6)
        t = pg.inner_text('#pfPaneLeads')
        check('Page not recorded' not in t and 'page not recorded' not in t and 'Contact form' in t and 'listed by form' in t, 'no "Page not recorded": the unknown one is shown as a contact form, with one plain line')
        check('by form' in t and 'Quote Request' not in t.split('By page')[0], 'a worked-out page says "by form" in the list')
        pg.screenshot(path=os.path.join(OUT, 'form-pages.png'))
        pg.goto(f'http://localhost:{APORT}/#/analysis/quiet'); pg.wait_for_selector('#anIn table', timeout=20000); time.sleep(0.4)
        t = pg.inner_text('#view')
        check('Forms gone quiet' in t and 'Quiet Car Spa' in t and 'No contact form found' in t and 'Not loading' in t, 'Lead analysis: the quiet website, with what to check')
        check('What this page is for' in t or 'Websites that usually get enquiries' in t, 'the page explains what each tab is for')
        pg.screenshot(path=os.path.join(OUT, 'an-quiet.png'), full_page=True)
        pg.goto(f'http://localhost:{APORT}/#/analysis/benchmarks'); pg.wait_for_selector('.an-top', timeout=20000); time.sleep(0.3)
        check('Busiest websites' in pg.inner_text('#view'), 'Across all websites shows the busiest websites')
        pg.goto(f'http://localhost:{APORT}/#/analysis/junk'); pg.wait_for_selector('.an-status', timeout=20000); time.sleep(0.3)
        check('Needed only for' in pg.inner_text('#view'), 'Junk and blasts says it needs the analysis database')
        pg.goto(f'http://localhost:{APORT}/#/health'); pg.wait_for_selector('.hx-copy', timeout=20000); time.sleep(0.4)
        t = pg.inner_text('#view')
        check('This is your copy of the app' in t and 'Switched off here on purpose' in t and 'Lyra' in t and 'connections and keys' in t.lower(), 'System health on the copy: what is different, its AI models, and every connection')
        pg.screenshot(path=os.path.join(OUT, 'health-copy.png'), full_page=True)
        mp = ctx.new_page(); mp.set_viewport_size({'width': 390, 'height': 850}); mp.on('pageerror', lambda e: errors.append(str(e)))
        for h in ['#/analysis/quiet', '#/health']:
            mp.goto(f'http://localhost:{APORT}/{h}'); time.sleep(2)
            check(mp.evaluate('document.documentElement.scrollWidth') <= 392, f'phone: {h} fits')
        check(not errors, 'no script errors ' + ' | '.join(errors[:3]))
        br.close()
except Exception:
    import traceback; traceback.print_exc(); ok = False
finally:
    srv.terminate()
    for pat in ['[f]ixsite.mjs', '[f]akeredis.mjs', '[d]ev-server.js']: subprocess.run(['pkill', '-f', pat])
print('ALL PASS' if ok else 'SOME FAILED')
