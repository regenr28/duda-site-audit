"""Live content check: reads published websites, lists details that are not theirs, alerts admins.
Usage: python3 -I e2e_watch.py <app> <tests>"""
import json, os, subprocess, sys, time, urllib.request, zlib, base64
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT, FPORT = 3998, 8078, 8097
fk = subprocess.Popen(['node', os.path.join(OUT, 'fakewatch.mjs'), str(FPORT)], stdout=subprocess.DEVNULL)
env = dict(os.environ, DUDA_API_BASE=f'http://127.0.0.1:{FPORT}/api', DUDA_API_USERNAME='u', DUDA_API_PASSWORD='p', WATCH_PROTOCOL='http')
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-w.log'), 'w'), text=True, env=env)
assert srv.stdout.readline().strip() == 'READY'
ADMIN, MEMBER = 'reymark@8bitcreative.com', 'dev@8bitcreative.com'
TOK = {ADMIN: 'tokadmin1234567890abcdef', MEMBER: 'tokmember1234567890abcde'}
def redis(*cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
def calls(): return json.loads(urllib.request.urlopen(f'http://127.0.0.1:{FPORT}/__calls').read())
def api(as_, method, path, body=None):
    req = urllib.request.Request(f'http://localhost:{APORT}{path}', data=json.dumps(body).encode() if body is not None else None, method=method,
                                 headers={'Content-Type': 'application/json', 'Cookie': 'dsa_sess=' + TOK[as_]})
    try:
        r = urllib.request.urlopen(req, timeout=120); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')
def pack(o):
    c = zlib.compressobj(9, zlib.DEFLATED, -15); return 'z1:' + base64.b64encode(c.compress(json.dumps(o).encode()) + c.flush()).decode()
now = int(time.time() * 1000)
sites = [{'id': 'abc123', 'name': 'Buff & Beyond', 'domain': f'localhost:{FPORT}', 'published': '2026-10-01T10:00:00Z', 'first': '2025-03-01T10:00:00Z', 'labels': []},
         {'id': 'clean1', 'name': 'Clean Car Co', 'domain': f'127.0.0.1:{FPORT}', 'published': '2026-10-05T10:00:00Z', 'first': '2026-09-01T10:00:00Z', 'labels': []}]
def set_list(s):
    redis(['SET', 'dsa:dudasites', pack({'v': 2, 'at': now, 'count': len(s), 'sites': s, 'scope': 'published'})])
set_list(sites)
redis(['SET', 'dsa:dudadrafts', pack({'v': 2, 'at': now, 'count': 0, 'sites': [], 'scope': 'unpublished'})],
      ['SET', 'dsa:thumb:abc123', json.dumps({'at': now, 'data': ''})], ['SET', 'dsa:thumb:clean1', json.dumps({'at': now, 'data': ''})],
      # The audit of Buff & Beyond already approved their partner's number as correct for the website.
      ['SET', 'dsa:site:s1', json.dumps({'id': 's1', 'siteId': 'abc123', 'host': 'ed.multiscreensite.com', 'businessName': 'Buff & Beyond', 'truth': {'domain': 'buffandbeyond.com'}, 'findings': [], 'scan': {'state': 'complete', 'finishedAt': '2026-09-30T00:00:00Z', 'pages': 3},
                                         'allow': [{'type': 'phone', 'value': '(484) 555-0111', 'key': 'phone:4845550111', 'mode': 'allow'}]})])
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
errors = []
try:
    # ---- the server side on its own ----
    st, L0 = api(ADMIN, 'GET', '/api/watch?op=live')
    check(st == 200 and L0.get('stat') and L0['stat']['pending'] == 2 and redis(['GET', 'dsa:cwdue'])[0] in ('2', 2), 'right after a deploy the live status works it out by itself (and that starts the reading)')
    st, s0 = api(MEMBER, 'GET', '/api/watch?op=status')
    check(st == 403, 'a member without Live DR Sites cannot see it')
    st, s0 = api(ADMIN, 'GET', '/api/watch?op=status')
    check(st == 200 and s0['total'] == 2 and s0['pending'] == 2 and s0['checked'] == 0 and s0['on'], 'status: two websites waiting ' + json.dumps({k: s0.get(k) for k in ('total', 'pending', 'checked')}))
    check(redis(['GET', 'dsa:cwdue'])[0] in ('2', 2), 'the waiting count is kept for the heartbeat')

    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx = br.new_context(viewport={'width': 1440, 'height': 1000})
        ctx.add_cookies([{'name': 'dsa_sess', 'value': TOK[ADMIN], 'domain': 'localhost', 'path': '/'}])
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        # Opening DR Websites starts the reading in this browser, in the background.
        pg.goto(f'http://localhost:{APORT}/#/live'); pg.wait_for_selector('.live-table', timeout=20000)
        pg.wait_for_selector('.ac-crit', timeout=40000); time.sleep(1)
        sums = redis(['HGETALL', 'dsa:cwsum'])[0]
        check(len(sums) == 4, 'both websites were read by the open browser')
        rec = json.loads(redis(['GET', 'dsa:cw:abc123'])[0])
        vals = {i['type'] + ':' + i['value']: i for i in rec['issues']}
        print('   found:', ' | '.join(sorted(vals)))
        check(any(k.startswith('phone:(469)') for k in vals), 'the copied blog post\'s phone is found')
        check('email:info@glossygarage.com' in vals, '…its email')
        check(any(k.startswith('address:') and 'Plano' in k and vals[k]['sev'] == 'critical' for k in vals), '…its street address (serious)')
        check(any(k.startswith('address:') and 'Bethlehem' in k and vals[k]['sev'] == 'warning' for k in vals), 'a town they serve is only a "check"')
        check(any(k.startswith('social:') and 'glossygaragetx' in k for k in vals), '…its Facebook page')
        check(any(k.startswith('name:') and 'Glossy Garage' in k for k in vals), '…and its business name')
        check(not any('484' in k for k in vals), 'the number approved on the audit is respected')
        check(not any('610' in k or 'buffandbeyond' in k.lower() or 'Allentown' in k for k in vals), 'their own details are never flagged')
        blogf = [i for i in rec['issues'] if i['type'] == 'email'][0]
        check(blogf['pages'] == ['/blog/ceramic-coating'], 'the finding says which page it is on')
        check(json.loads(redis(['GET', 'dsa:cw:clean1'])[0])['issues'] == [], 'the clean website has nothing')
        check(len(redis(['GET', 'dsa:cw:abc123'])[0]) < 6000, 'only the findings are stored, not the pages (%d bytes)' % len(redis(['GET', 'dsa:cw:abc123'])[0]))
        check(redis(['HLEN', 'dsa:cwnew'])[0] == 1, 'the new findings wait for the daily report (no instant alert on the first read)')
        notifs = [json.loads(x) for x in redis(['LRANGE', 'dsa:notif:' + ADMIN, 0, -1])[0]]
        check(not any(n['kind'].startswith('watch') for n in notifs), 'no alert on the first pass')
        txt = pg.inner_text('.live-table')
        pg.screenshot(path=os.path.join(OUT, 'wc-live.png'))
        print('   buff row:', pg.inner_text('.live-table tbody tr:has-text("Buff") .ac-td').replace('\n', ' | '))
        check('auto audit' in pg.inner_text('.live-table thead').lower() and 'Auto audit done' in txt and 'Super critical (contact info)' in txt and '1 phone' in txt and '1 email' in txt and 'No contact info problems' in txt,
              'DR Websites has an Auto audit column: done, when, and the super critical contact info by kind: ' + txt.replace('\n', ' | ')[:600])
        # ---- the audit of a website on Audits gets the findings as items ----
        rec1 = json.loads(zlib.decompress(base64.b64decode(redis(['GET', 'dsa:site:s1'])[0][3:]), -15))
        auto = [f for f in rec1['findings'] if f['code'] == 'AUTO_LIVE']
        check(len(auto) == 6 and all(f['autoLive']['at'] and f['category'] == 'Auto audit (live website)' for f in auto), 'the audit on Audits gets the auto audit findings as dated items (%d)' % len(auto))
        fnum = redis(['HGETALL', 'dsa:fnum:s1'])[0]
        check(len(fnum) == 12, 'each one is numbered like any audit item')
        idx = json.loads(redis(['HGET', 'dsa:index', 's1'])[0])
        check(idx.get('autoLive', {}).get('c') == 5 and idx['counts']['critical'] == 5, 'the Audits row knows when it was auto audited and counts the items ' + json.dumps(idx.get('autoLive')))
        check(redis(['EXISTS', 'dsa:site:clean1'])[0] == 0 and len(redis(['HKEYS', 'dsa:index'])[0]) == 2, 'websites are never added to Audits by the auto audit')
        pg.wait_for_function("() => /Idle/.test((document.querySelector('#acPanel') || {}).textContent || '')", timeout=30000)
        ap = pg.inner_text('#acPanel')
        check('Auto audit' in ap and 'Idle: every website has been tried' in ap and '2 read' in ap.replace('\n', ' ') and 'Latest' in ap, 'the status panel: idle, counts, latest result: ' + ap.replace('\n', ' | '))
        pg.select_option('#liveWc', 'issues'); time.sleep(0.4)
        check(pg.locator('.live-table tbody tr').count() == 1 and 'Buff' in pg.inner_text('.live-table tbody'), 'filter: details not theirs')
        pg.select_option('#liveWc', 'clean'); time.sleep(0.4)
        check(pg.locator('.live-table tbody tr').count() == 1 and 'Clean Car' in pg.inner_text('.live-table tbody'), 'filter: everything matches')
        pg.select_option('#liveWc', 'critical'); time.sleep(0.4)
        check(pg.locator('.live-table tbody tr').count() == 1, 'filter: super critical')
        pg.select_option('#liveWc', ''); time.sleep(0.3)
        # ---- the profile ----
        pg.click('.ac-crit'); pg.wait_for_selector('#pfWatch', timeout=20000); pg.wait_for_selector('.wc-item', timeout=20000); time.sleep(0.5)
        check('/site/s1/profile' in pg.url, 'the badge opens the website\'s profile')
        sec = pg.inner_text('section:has(#pfWatch)')
        check('glossygarage' in sec and 'Plano' in sec and 'Super critical' in sec and 'ceramic-coating' in sec, 'the profile lists each finding with its page')
        check(pg.url.endswith('/profile/auto-audit') and pg.locator('.pf-tab.on').get_attribute('data-pftab') == 'auto-audit', 'straight to the Auto audit tab: ' + pg.url)
        check(pg.locator('.pf-tab[data-pftab="auto-audit"] .pf-tab-n.bad').count() == 1, 'the tab shows the count in red when something is super critical')
        pg.click('.pf-tab[data-pftab="overview"]'); pg.wait_for_selector('.pf-cards', timeout=10000)
        check('Auto audit' in pg.inner_text('.pf-cards') and 'super critical' in pg.locator('.pf-card', has_text='Auto audit').inner_text(), 'an Auto audit card sits with the other cards')
        pg.click('.pf-tab[data-pftab="auto-audit"]'); pg.wait_for_selector('.wc-item', timeout=10000)
        check('On Audits too' in sec, 'the profile says the findings are on its audit too')
        pg.screenshot(path=os.path.join(OUT, 'wc-profile.png'), full_page=True)
        n_before = pg.locator('.wc-item').count()
        pg.locator('.wc-item', has_text='Bethlehem').locator('[data-wcok]').click(); time.sleep(1)
        check(pg.locator('.wc-item').count() == n_before - 1 and 'Bethlehem' not in pg.inner_text('.wc-list'), '"Not a problem" takes it off at once')
        check('address:18015' in (redis(['SMEMBERS', 'dsa:cwok:abc123'])[0] or []), '…and remembers it for this website')
        check('marked not a problem' in pg.inner_text('section:has(#pfWatch)'), 'the ruled-on values are listed with Undo')
        st1 = {k: json.loads(v) for k, v in zip(*[iter(redis(['HGETALL', 'dsa:fstate:s1'])[0])] * 2)}
        beth = [f for f in auto if 'Bethlehem' in f['found']][0]
        check(st1.get(beth['id'], {}).get('status') == 'false' and st1[beth['id']].get('auto') == 'live-ok', '…and its audit item becomes a False alarm')
        # an item marked False alarm on the audit tells the auto audit too
        emailf = [f for f in auto if f['liveType'] == 'email'][0]
        st, r = api(ADMIN, 'POST', '/api/store', {'op': 'patchFinding', 'siteId': 's1', 'findingIds': [emailf['id']], 'changes': {'status': 'false'}})
        check(st == 200 and 'email:info@glossygarage.com' in (redis(['SMEMBERS', 'dsa:cwok:abc123'])[0] or []), 'a False alarm on an auto audit item tells the auto audit it is not a problem')
        # ---- Audits: republished since the last scan, auto audited ----
        pg.goto(f'http://localhost:{APORT}/#/'); pg.reload(); pg.wait_for_selector('table.grid', timeout=20000); time.sleep(1.5)
        at = pg.inner_text('table.grid')
        check('Republished: rescan' in at and 'Auto audited' in at, 'Audits shows Republished: rescan and when it was auto audited: ' + at.replace('\n', ' | ')[:400])
        check(pg.locator('#frepub').count() == 1, 'with a Republished since scan filter')
        pg.goto(f'http://localhost:{APORT}/#/site/s1'); pg.wait_for_selector('#repubRescan', timeout=20000)
        check('Published again since the last scan' in pg.inner_text('#view'), 'the audit page says it was published again and offers Rescan now')
        check('Auto audit (live website)' in pg.inner_text('#view'), 'the auto audit items are listed on the audit')
        pg.screenshot(path=os.path.join(OUT, 'wc-audit.png'))
        pg.goto(f'http://localhost:{APORT}/#/site/s1/item/' + str(int(dict(zip(*[iter(fnum)] * 2))[[f for f in auto if f['liveType'] == 'phone'][0]['id']])))
        pg.wait_for_selector('.auto-note', timeout=15000); time.sleep(0.5)
        check('Found by the auto audit' in pg.inner_text('.auto-note'), 'an auto audit item says when and where it was found')
        pg.screenshot(path=os.path.join(OUT, 'wc-item.png'))
        pg.goto(f'http://localhost:{APORT}/#/dr/abc123/auto-audit'); pg.reload(); pg.wait_for_selector('.wc-item', timeout=20000); time.sleep(0.5)
        n_before = pg.locator('.wc-item').count()
        c1 = calls()['pages']
        pg.click('#wcRun'); pg.wait_for_function("() => document.querySelector('#wcRun') && !document.querySelector('#wcRun').disabled", timeout=60000); time.sleep(0.6)
        check(calls()['pages'] > c1, 'Check now reads the website again')
        vals2 = ' '.join(pg.eval_on_selector_all('.wc-val', 'els => els.map(e => e.textContent)'))
        check('Bethlehem' not in vals2 and 'info@glossygarage.com' not in vals2 and pg.locator('.wc-item').count() == n_before, 'what was ruled fine stays fine after reading again: %d vs %d ' % (pg.locator('.wc-item').count(), n_before) + pg.inner_text('.wc-list').replace('\n', ' | ')[:300])
        # ---- republished with someone else's number: told at once ----
        urllib.request.urlopen(f'http://127.0.0.1:{FPORT}/__dirty').read()
        sites[1]['published'] = '2026-10-13T08:00:00Z'; set_list(sites)
        st, r = api(ADMIN, 'GET', '/api/watch?op=status')
        check(r['pending'] == 1, 'a website published since its last read is waiting again')
        st, r = api(ADMIN, 'POST', '/api/watch', {'op': 'drain'})
        check(st == 200 and [d['id'] for d in r['done']] == ['clean1'], 'only the republished website is read')
        notifs = [json.loads(x) for x in redis(['LRANGE', 'dsa:notif:' + ADMIN, 0, -1])[0]]
        al = [n for n in notifs if n['kind'] == 'watch-issue']
        check(len(al) == 1 and al[0]['dudaSite'] == 'clean1' and al[0]['lines'] == ['Clean Car Co: 1 phone number incorrect'] and 'CRITICAL ERRORS FOUND' in al[0]['headline']
              and 'Error found:' in al[0]['sections'][0] and '/#/dr/clean1/auto-audit|Auto audit findings>' in al[0]['sections'][0], 'admins are told at once: CRITICAL ERRORS FOUND! ' + json.dumps(al[0].get('sections')))
        check(not [n for n in [json.loads(x) for x in redis(['LRANGE', 'dsa:notif:' + MEMBER, 0, -1])[0]] if n['kind'].startswith('watch')], 'members are not')
        # ---- Duda says "slow down": nothing is marked unreadable, the check waits and carries on ----
        urllib.request.urlopen(f'http://127.0.0.1:{FPORT}/__limit?n=50').read()
        sites[1]['published'] = '2026-10-13T08:30:00Z'; set_list(sites)
        before = redis(['HGET', 'dsa:cwsum', 'clean1'])[0]
        st, r = api(ADMIN, 'POST', '/api/watch', {'op': 'drain'})
        check(r.get('wait', 0) >= 30 and not r['done'] and redis(['HGET', 'dsa:cwsum', 'clean1'])[0] == before, 'a Duda 429 pauses the check and records nothing against the website ' + json.dumps(r)[:160])
        st, r = api(ADMIN, 'POST', '/api/watch', {'op': 'drain'})
        check(r.get('wait', 0) > 0 and calls()['duda'] >= 1, 'it keeps waiting without asking Duda again')
        st, r = api(ADMIN, 'GET', '/api/watch?op=status')
        check(r.get('waitUntil', 0) > 0 and r['pending'] == 1, 'the status says it is waiting, the website is still queued')
        urllib.request.urlopen(f'http://127.0.0.1:{FPORT}/__limit?n=0').read(); redis(['DEL', 'dsa:cwwait'])
        st, r = api(ADMIN, 'POST', '/api/watch', {'op': 'drain'})
        check([d['id'] for d in r['done']] == ['clean1'] and not r['done'][0].get('err'), 'when Duda is ready again it carries on with the same website')
        # ---- the websites' servers refuse us: wait (with a timer), never "could not be read" ----
        urllib.request.urlopen(f'http://127.0.0.1:{FPORT}/__block?on=1').read()
        sites[1]['published'] = '2026-10-13T08:40:00Z'; set_list(sites)
        before = redis(['HGET', 'dsa:cwsum', 'clean1'])[0]
        st, r = api(ADMIN, 'POST', '/api/watch', {'op': 'drain'})
        check(r.get('wait', 0) >= 300 and redis(['HGET', 'dsa:cwsum', 'clean1'])[0] == before and 'stopped answering' in r.get('problem', ''), 'blocked by the websites: it waits 5 minutes and marks nothing ' + json.dumps(r)[:200])
        st, L = api(ADMIN, 'GET', '/api/watch?op=live')
        check(L.get('wait') and L['wait']['until'] > now and L['recent'][0].get('wait'), 'the live status shows the break, until when, and why')
        pg.goto(f'http://localhost:{APORT}/#/live'); pg.reload(); pg.wait_for_selector('#acPanel [data-acleft]', timeout=20000); time.sleep(1.2)
        t1 = pg.inner_text('#acPanel [data-acleft]'); time.sleep(2.2); t2 = pg.inner_text('#acPanel [data-acleft]')
        check(t1 != t2 and 'Taking a break' in pg.inner_text('#acPanel') and 'Carrying on at' in pg.inner_text('#acPanel'), 'the panel counts down: %s → %s' % (t1, t2))
        pg.screenshot(path=os.path.join(OUT, 'ac-panel-wait.png'), clip={'x': 0, 'y': 0, 'width': 1440, 'height': 520})
        urllib.request.urlopen(f'http://127.0.0.1:{FPORT}/__block?on=0').read(); redis(['DEL', 'dsa:cwwait'])
        st, r = api(ADMIN, 'POST', '/api/watch', {'op': 'drain'})
        check([d['id'] for d in r['done']] == ['clean1'] and not r['done'][0].get('err'), 'unblocked: it carries on with the same website')
        # one website that is really broken is recorded, with the reason, while the rest carry on
        urllib.request.urlopen(f'http://127.0.0.1:{FPORT}/__404?host=127.0.0.1').read()
        sites[1]['published'] = '2026-10-13T08:50:00Z'; set_list(sites)
        st, r = api(ADMIN, 'POST', '/api/watch', {'op': 'drain'})
        sm = json.loads(redis(['HGET', 'dsa:cwsum', 'clean1'])[0])
        check(sm.get('ek') == 'open' and '404' in sm.get('err', ''), 'a website that is really broken is recorded with the reason: ' + sm.get('err', ''))
        st, S = api(ADMIN, 'GET', '/api/watch?op=status')
        check(S['reasons'].get('open') == 1 and S['unreadable'] == 1, 'the status counts the reasons')
        urllib.request.urlopen(f'http://127.0.0.1:{FPORT}/__404?host=').read()
        st, r = api(ADMIN, 'POST', '/api/watch', {'op': 'retry'})
        check(r.get('retried') == 1 and r['live']['stat']['pending'] == 1, 'admins can retry everything that could not be read')
        st, r = api(ADMIN, 'POST', '/api/watch', {'op': 'drain'})
        check([d['id'] for d in r['done']] == ['clean1'] and not r['done'][0].get('err'), '…and it is read')
        # a failure recorded by the first version is tried again straight away
        redis(['HSET', 'dsa:cwsum', 'clean1', json.dumps({'at': now, 'pubAt': 0, 'n': 0, 'c': 0, 'err': 'Business Info could not be read from Duda'})])
        st, r = api(ADMIN, 'GET', '/api/watch?op=status')
        check(r['pending'] == 1 and r['unreadable'] == 1, 'old "could not read" results are queued again')
        st, r = api(ADMIN, 'POST', '/api/watch', {'op': 'drain'})
        check(json.loads(redis(['HGET', 'dsa:cwsum', 'clean1'])[0]).get('v') == 3 and not json.loads(redis(['HGET', 'dsa:cwsum', 'clean1'])[0]).get('err'), '…and read properly')
        # ---- the daily report ----
        st, r = api(ADMIN, 'GET', '/api/watch?op=cron')
        check(st == 200 and r.get('reported') == 2, 'the daily run sends one report covering both websites ' + json.dumps(r)[:200])
        notifs = [json.loads(x) for x in redis(['LRANGE', 'dsa:notif:' + ADMIN, 0, -1])[0]]
        dg = [n for n in notifs if n['kind'] == 'watch-digest']
        check(len(dg) == 1 and len(dg[0]['sections']) == 2, 'the report has one block per website')
        buff = [x for x in dg[0]['sections'] if 'Buff' in x][0]
        print('   slack block:', buff.replace('\n', ' / '))
        check('Error found:' in buff and 'and ' in buff and 'more!' in buff and '/#/site/s1/findings|Audit items>' in buff, 'each with what was found, "and N more!" and a link to its audit items')
        # ---- added to Audits: arrives with the auto audit's findings ----
        st, r = api(ADMIN, 'POST', '/api/store', {'op': 'create', 'siteId': 'clean1', 'host': 'ed.multiscreensite.com', 'editorUrl': 'https://ed.multiscreensite.com/home/site/clean1/home'})
        nid = r.get('id')
        recn = json.loads(zlib.decompress(base64.b64decode(redis(['GET', 'dsa:site:' + nid])[0][3:]), -15))
        an = [f for f in recn['findings'] if f['code'] == 'AUTO_LIVE']
        check(st == 200 and len(an) == 1 and '720' in an[0]['found'] and r.get('autoLive', {}).get('c') == 1, 'adding a website to Audits brings the auto audit findings in as items, dated')
        # fixed and published again: the item closes itself
        urllib.request.urlopen(f'http://127.0.0.1:{FPORT}/__clean').read()
        sites[1]['published'] = '2026-10-13T09:00:00Z'; set_list(sites)
        st, r = api(ADMIN, 'POST', '/api/watch', {'op': 'drain'})
        stn = json.loads(redis(['HGET', 'dsa:fstate:' + nid, an[0]['id']])[0] or '{}')
        check(stn.get('status') == 'done' and stn.get('auto') == 'live-gone', 'fixed on the live website and published: the audit item closes itself as Done')
        st, r = api(ADMIN, 'GET', '/api/watch?op=cron')
        check(r.get('skipped'), 'the daily run only runs once a day')
        # bell
        pg.goto(f'http://localhost:{APORT}/#/home'); pg.reload(); pg.wait_for_selector('.hm-card', timeout=20000); time.sleep(2.5)
        hm = pg.inner_text('#view')
        check('Super critical on live sites' in hm, 'Home has the Super critical card')
        pg.click('#btnBell'); pg.wait_for_selector('.notif-panel .np-item', timeout=15000); time.sleep(0.5)
        links = pg.eval_on_selector_all('.np-item', 'els => els.map(e => e.getAttribute("href"))')
        check('#/dr/clean1/auto-audit' in links and '#/live/content' in links, 'bell items open the website / the filtered list: ' + ', '.join(links[:4]))
        pg.reload(); pg.wait_for_selector('#view', timeout=20000); pg.goto(f'http://localhost:{APORT}/#/live/content'); pg.wait_for_selector('.live-table', timeout=20000); time.sleep(0.8)
        print('   rows:', pg.inner_text('.live-table tbody').replace('\n', ' ')[:200], pg.eval_on_selector('#liveWc', 'e => e.value'))
        check(pg.locator('.live-table tbody tr').count() == 1 and pg.eval_on_selector('#liveWc', 'e => e.value') == 'critical', 'the report link opens DR Websites filtered to the super critical ones')
        # ---- pause ----
        pg.click('#acPause'); time.sleep(1)
        check('Paused by Reymark' in pg.inner_text('#acPanel') and 'Resume' in pg.inner_text('#acPanel'), 'admins can pause it, and it says who paused it and when: ' + pg.inner_text('#acPanel').replace('\n', ' | ')[:200])
        st, r = api(ADMIN, 'POST', '/api/watch', {'op': 'drain'})
        check(r.get('off'), 'paused means nothing is read')
        pg.click('#acPause'); time.sleep(0.8)
        # ---- phone ----
        ph = br.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        ph.add_cookies([{'name': 'dsa_sess', 'value': TOK[ADMIN], 'domain': 'localhost', 'path': '/'}])
        pp = ph.new_page(); pp.on('pageerror', lambda e: errors.append(str(e)))
        pp.goto(f'http://localhost:{APORT}/#/dr/abc123/auto-audit'); pp.wait_for_selector('.wc-item', timeout=20000); time.sleep(0.6)
        sw = pp.evaluate('() => document.documentElement.scrollWidth')
        check(sw <= 392, 'the profile fits a phone (%d)' % sw)
        pp.locator('#pfWatch').scroll_into_view_if_needed(); pp.screenshot(path=os.path.join(OUT, 'wc-phone.png'))
        check(not errors, 'no script errors ' + ' | '.join(errors[:3]))
        br.close()
    # ---- the rules change: a re-read closes what the old rules got wrong as the app's mistake ----
    def unpack(v):
        if v and v.startswith('z1:'): return json.loads(zlib.decompress(base64.b64decode(v[3:]), -15))
        return json.loads(v)
    res = json.loads(redis(['GET', 'dsa:cw:abc123'])[0])
    fake = {'k': 'name:ceramic pro gold package', 'type': 'name', 'value': 'Ceramic Pro Gold Package', 'sev': 'critical', 'label': 'Google business data (schema) names a different business', 'ctx': 'AutoWash', 'pages': ['/ceramic'], 'n': 1}
    res['issues'].append(fake); redis(['SET', 'dsa:cw:abc123', json.dumps(res)])
    site = unpack(redis(['GET', 'dsa:site:s1'])[0])
    site['findings'].append({'id': 'live-cpgp', 'code': 'AUTO_LIVE', 'manual': True, 'liveKey': fake['k'], 'liveType': 'name', 'severity': 'critical', 'category': 'Auto audit (live website)',
                             'message': 'Business name that is not theirs: Ceramic Pro Gold Package', 'found': 'Ceramic Pro Gold Package', 'path': '/ceramic', 'pages': ['/ceramic'], 'autoLive': {'at': '2026-10-13T00:00:00Z'}, 'by': '', 'byName': 'Auto audit', 'at': '2026-10-13T00:00:00Z'})
    sm = json.loads(redis(['HGET', 'dsa:cwsum', 'abc123'])[0]); sm.update({'rv': 2, 'c': (sm.get('c') or 0) + 1})
    redis(['SET', 'dsa:site:s1', json.dumps(site)], ['HSET', 'dsa:fnum:s1', 'live-cpgp', '99'], ['HSET', 'dsa:fstate:s1', 'live-cpgp', json.dumps({'status': 'open'})],
          ['HSET', 'dsa:cwsum', 'abc123', json.dumps(sm)], ['DEL', 'dsa:cwfix:own-data-3'], ['DEL', 'dsa:cwwait'])
    api(ADMIN, 'GET', '/api/watch?op=live')
    rc = json.loads(redis(['HGET', 'dsa:cwrecheck', 'abc123'])[0] or 'null') or {}
    check(fake['k'] in rc.get('keys', []) and json.loads(redis(['HGET', 'dsa:cwsum', 'abc123'])[0]).get('relook'), 'websites the new rules may judge differently are lined up for a re-read: ' + json.dumps(rc)[:160])
    st, r = api(ADMIN, 'POST', '/api/watch', {'op': 'check', 'id': 'abc123'})
    check(st == 200, 'the re-read runs: %s %s' % (st, str(r)[:120]))
    fs = json.loads(redis(['HGET', 'dsa:fstate:s1', 'live-cpgp'])[0])
    check(fs.get('status') == 'false' and fs.get('auto') == 'app-fix', 'what the re-read no longer finds closes as False alarm, the app\'s mistake: ' + json.dumps(fs))
    check(not redis(['HGET', 'dsa:cwrecheck', 'abc123'])[0], 'and the re-read is done with')
    real = [f for f in unpack(redis(['GET', 'dsa:site:s1'])[0])['findings'] if f.get('code') == 'AUTO_LIVE' and f.get('liveType') == 'phone' and f.get('severity') == 'critical']
    fs2 = {k: json.loads(v) for k, v in zip(*[iter(redis(['HGETALL', 'dsa:fstate:s1'])[0])] * 2)}
    check(real and all(fs2.get(f['id'], {}).get('status', 'open') != 'false' for f in real), 'real findings stay as they were')
except Exception as e:
    import traceback; traceback.print_exc(); ok = False
finally:
    srv.terminate(); fk.terminate()
print('ALL PASS' if ok else 'SOME FAILED')
