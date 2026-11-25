"""Settings → Auto audits: the list (last run, last website, next run), one auto audit's settings (what it checks,
schedule, notifications and message format with a preview), saving, Send me a test, and the reading pass's own
rules (which checks are on, editorial photos found in a page). Usage: python3 -I e2e_autoaudits.py <app> <tests>"""
import json, os, re, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT = 3998, 8078
ADMIN, ADMIN_TOK, MEMBER_TOK = 'reymark@8bitcreative.com', 'tokadmin1234567890abcdef', 'tokmember1234567890abcde'
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-autoaudits.log'), 'w'), text=True)
assert srv.stdout.readline().strip() == 'READY'
def redis(*cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
def api(path, body=None, tok=ADMIN_TOK):
    req = urllib.request.Request(f'http://localhost:{APORT}{path}', data=json.dumps(body).encode() if body is not None else None, method='POST' if body is not None else 'GET', headers={'Cookie': 'dsa_sess=' + tok, 'Content-Type': 'application/json'})
    try: return 200, json.loads(urllib.request.urlopen(req, timeout=60).read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
errors = []
now = int(time.time() * 1000)
redis(['SET', 'dsa:cwlastrun', json.dumps({'at': now - 3600000, 'by': 'cron', 'done': 12})],
      ['LPUSH', 'dsa:cwrecent', json.dumps({'at': now - 3600000, 'id': 'd77', 'name': 'Velvet Auto Care', 'domain': 'velvet.com', 'n': 0, 'c': 0})],
      ['HSET', 'dsa:cwsum', 'd77', json.dumps({'v': 3, 'at': now - 3600000, 'n': 2, 'c': 1, 't': {'stock': 1}, 'sv': 1}), 'd78', json.dumps({'v': 3, 'at': now - 3600000, 'n': 1, 'c': 1, 't': {'phone': 1}})],
      ['HSET', 'dsa:domstat', 'd77', json.dumps({'domain': 'velvet.com', 'status': 'ok', 'checkedAt': now - 7200000})],
      ['SET', 'dsa:domsweep', time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime(time.time() - 7200))])
try:
    st, r = api('/api/watch?op=autoaudits')
    ids = [x['id'] for x in r.get('list', [])]
    print('   list:', [(x['id'], x['on'], x.get('summary')) for x in r['list']])
    check(st == 200 and ids == ['bizinfo', 'editorial', 'domains', 'quiet', 'presence', 'seo'], 'the six auto audits are listed: Business Info, editorial photos, domains, forms gone quiet, online presence, SEO websites')
    biz = r['list'][0]; ed = r['list'][1]
    check(biz['last'] and biz['last']['site']['name'] == 'Velvet Auto Care' and biz['next'] > now, 'each row has its last run, the last website it read and the next run')
    check('1 with editorial photos' in ed['summary'] and ed['on'], 'the editorial photo check is on, with how many websites have editorial photos')
    check(r['list'][2]['last'] and 'domains watched' in r['list'][2]['summary'], 'domain monitoring shows its last run and how many domains it watches')
    st, d = api('/api/watch?op=aa&id=bizinfo')
    keys = [c['k'] for g in d['def']['checks'] for c in g['kids']]
    check([f['k'] for f in d['def']['fields']].count('pace') == 1 and d['cfg']['fields']['pace'] == 'gentle', 'the reading speed is a setting, gentle by default')
    check(st == 200 and 'address.town' in keys and 'name.copyright' in keys and d['cfg']['notify']['on'], 'one auto audit has a tree of specific checks and its notification settings')
    st, _ = api('/api/watch', {'op': 'aaSave', 'id': 'bizinfo', 'cfg': {'on': True}}, MEMBER_TOK)
    check(st == 403, 'only admins change them')
    # Notification format: preview with the settings on screen
    st, p = api('/api/watch', {'op': 'aaPreview', 'id': 'bizinfo', 'notify': {'headline': 'Heads up: {websites} website(s) need fixing', 'line': '{name} ({domain}) -> {problems}', 'footer': 'Please check today.'}})
    print('   preview:', p.get('message'))
    msg = p['message']
    check(msg['headline'] == 'Heads up: 1 website(s) need fixing' and 'example-detail.com' in msg['sections'][0] and 'phone numbers incorrect' in msg['sections'][0] and msg['sections'][-1] == 'Please check today.', 'the message format is filled in from the templates (headline, each website, last line)')
    with sync_playwright() as pw:
        br = pw.chromium.launch(); ctx = br.new_context(viewport={'width': 1440, 'height': 1100})
        ctx.add_cookies([{'name': 'dsa_sess', 'value': ADMIN_TOK, 'domain': 'localhost', 'path': '/'}])
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        redis(['SET', 'dsa:cwwait', json.dumps({'until': int(time.time() * 1000) + 40 * 60000, 'why': 'Websites stopped answering us (could not be reached)'})], ['SET', 'dsa:cwstat', json.dumps({'pending': 575, 'v': 1, 'at': now})])
        pg.goto(f'http://localhost:{APORT}/#/settings/autoaudits'); pg.wait_for_selector('.aa-row', timeout=20000); time.sleep(0.6)
        ed_row = pg.inner_text('[data-aa="editorial"]')
        check('Taking a break until' in ed_row and 'could not be reached' in ed_row and '575' in ed_row and 'carries on by itself' in ed_row, 'the row says it is taking a break, why, until when, and how many are waiting: ' + ed_row.replace('\n', ' | ')[:300])
        redis(['DEL', 'dsa:cwwait'])
        rows = pg.locator('.aa-row').all_inner_texts()
        check(len(rows) == 6 and 'Last run' in rows[0] and 'Velvet Auto Care' in rows[0] and 'Next daily run' in rows[0], 'Settings → Auto audits shows a row each, with last run, last website and next run')
        pg.screenshot(path=os.path.join(OUT, 'autoaudits-list.png'))
        pg.click('[data-aa="bizinfo"]'); pg.wait_for_selector('.aa-tree', timeout=15000); time.sleep(0.8)
        check(pg.url.endswith('#/settings/autoaudits/bizinfo'), 'clicking a row opens its settings')
        check(pg.locator('[data-aak]').count() >= 10 and pg.locator('[data-day]').count() == 7, 'its settings: every specific check with a box, and the days it runs')
        pg.uncheck('[data-aak="address.town"]'); time.sleep(0.2)
        check(pg.evaluate("() => document.querySelector('[data-aag=\"contact\"]').indeterminate"), 'a group with one check off shows as part-ticked')
        pg.uncheck('[data-day="0"]')
        pg.fill('[data-field="recheckDays"]', '14')
        pg.check('[name=aaTo][value=people]'); time.sleep(0.2)
        check(pg.is_visible('.aa-people'), 'choosing "These people" lists the team to tick')
        pg.check(f'[data-person="{ADMIN}"]')
        pg.fill('#aaHead', '🚨 {websites} website(s) with wrong details')
        pg.click('#aaLine'); pg.fill('#aaLine', '*{name}*: '); pg.click('[data-var="problems"]'); time.sleep(1.2)
        check(pg.input_value('#aaLine').endswith('{problems}'), 'clicking a word adds it to the message where the cursor is')
        prev = pg.inner_text('#aaPrev')
        print('   preview:', prev.replace('\n', ' | '))
        check('1 website(s) with wrong details' in prev and 'Harker Heights Ceramic Coatings' in prev, 'the preview shows the message as it will be sent')
        pg.screenshot(path=os.path.join(OUT, 'autoaudits-detail.png'), full_page=True)
        pg.click('#aaSave'); time.sleep(1.5)
        st, d = api('/api/watch?op=aa&id=bizinfo')
        c = d['cfg']
        check(c['checks'].get('address.town') is False and 0 not in c['days'] and c['fields']['recheckDays'] == 14, 'Save keeps the checks, the days and the options')
        check(c['notify']['to'] == 'people' and c['notify']['people'] == [ADMIN] and c['notify']['headline'].startswith('🚨 {websites}'), 'and who is told and the message format')
        redis(['DEL', f'dsa:notif:{ADMIN}'])
        pg.wait_for_selector('#aaTest', timeout=10000); pg.click('#aaTest'); time.sleep(1.5)
        got = redis(['LRANGE', f'dsa:notif:{ADMIN}', 0, 5])[0] or []
        check(any('[Test]' in json.loads(x).get('headline', '') for x in got), 'Send me a test sends the message to me')
        # Editorial photos: switching it off and on again reads every website once more
        v0 = int(redis(['GET', 'dsa:stock:ver'])[0] or 1)
        api('/api/watch', {'op': 'aaSave', 'id': 'editorial', 'cfg': {'on': False}}); api('/api/watch', {'op': 'aaSave', 'id': 'editorial', 'cfg': {'on': True}})
        check(int(redis(['GET', 'dsa:stock:ver'])[0] or 1) > v0, 'switching the editorial photo check on queues every website for one more read')
        pg.goto(f'http://localhost:{APORT}/#/settings/autoaudits/presence'); pg.wait_for_selector('.aa-tree', timeout=15000); time.sleep(0.5)
        check('sends no messages' in pg.inner_text('#setBody') and pg.locator('[data-aak="pl.yelp"]').count() == 1, 'online presence: profiles to compare, and no message settings')
        ctx2 = br.new_context(); ctx2.add_cookies([{'name': 'dsa_sess', 'value': MEMBER_TOK, 'domain': 'localhost', 'path': '/'}])
        p2 = ctx2.new_page(); p2.on('pageerror', lambda e: errors.append(str(e)))
        p2.goto(f'http://localhost:{APORT}/#/settings/autoaudits/bizinfo'); time.sleep(3)
        check(p2.locator('#aaSave').count() == 0 and (p2.locator('[data-aak]').count() == 0 or p2.locator('[data-aak]:disabled').count() == p2.locator('[data-aak]').count()), 'a member sees the settings but cannot change them')
        br.close()
    # SEO websites wait their turn while websites are still waiting for the editorial / Business Info read.
    api('/api/watch', {'op': 'aaSave', 'id': 'seo', 'cfg': {'fields': {'priority': 'after'}}})
    redis(['SET', 'dsa:cwstat', json.dumps({'pending': 40, 'v': 1, 'at': now})], ['SET', 'dsa:aa:sinceSeo', '2'])
    st, r = api('/api/seo?op=due')
    check('waiting until the 40 websites' in r.get('held', ''), 'priority "wait": no SEO website while websites are still waiting to be read')
    api('/api/watch', {'op': 'aaSave', 'id': 'seo', 'cfg': {'fields': {'priority': 'interleave', 'everyN': 5}}})
    redis(['SET', 'dsa:cwstat', json.dumps({'pending': 40, 'v': 1, 'at': now})])
    st, r = api('/api/seo?op=due')
    check('2 of 5 websites read' in r.get('held', ''), 'priority "mix": one SEO website after every 5 read (2 so far): ' + json.dumps(r))
    redis(['SET', 'dsa:aa:sinceSeo', '5'])
    st, r = api('/api/seo?op=due')
    check('held' not in r, 'after 5 websites read, an SEO website may go next')
    api('/api/watch', {'op': 'aaSave', 'id': 'seo', 'cfg': {'fields': {'priority': 'first', 'delayH': 6}}})
    st, r = api('/api/seo?op=list')
    check(r.get('delayH') == 6, 'the hours after a publish come from Settings \u2192 Auto audits')
    st, d = api('/api/watch?op=aa&id=seo')
    check([f['k'] for f in d['def']['fields']] == ['delayH', 'priority', 'everyN'] and d['cfg']['fields']['priority'] == 'first', 'SEO websites: hours after publish, priority and how often, saved')
    # The Audits tab tells auto-audited audits from the ones scanned by hand.
    redis(['SET', 'dsa:site:s2', json.dumps({'id': 's2', 'siteId': 'zzz999', 'host': 'ed.multiscreensite.com', 'businessName': 'Other Co', 'findings': [], 'scans': [{'finishedAt': '2026-11-20T00:00:00Z', 'seoAuto': True}]})])
    redis(['HSET', 'dsa:index', 's2', json.dumps({'id': 's2', 'siteId': 'zzz999', 'businessName': 'Other Co'})])
    st, r = api('/api/store?op=list')
    by = {x['id']: x for x in r['sites']}
    check(by.get('s2', {}).get('auto') == 'seo' and not by.get('s1', {}).get('auto'), 'the list knows which audits an auto audit made')
    with sync_playwright() as pw:
        br = pw.chromium.launch(); ctx = br.new_context(viewport={'width': 1440, 'height': 1000})
        ctx.add_cookies([{'name': 'dsa_sess', 'value': ADMIN_TOK, 'domain': 'localhost', 'path': '/'}])
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(f'http://localhost:{APORT}/#/'); pg.wait_for_selector('#fby', timeout=20000); time.sleep(0.5)
        check('🤖 Auto audited' in pg.inner_text('tr[data-open="s2"]'), 'an auto-audited audit is tagged on the Audits tab')
        pg.select_option('#fby', 'auto'); time.sleep(0.4)
        check(pg.locator('tr[data-open="s2"]').count() == 1 and pg.locator('tr[data-open="s1"]').count() == 0, 'filter "Auto audited" shows only those')
        pg.select_option('#fby', 'hand'); time.sleep(0.4)
        check(pg.locator('tr[data-open="s1"]').count() == 1 and pg.locator('tr[data-open="s2"]').count() == 0, 'filter "By hand" shows the rest')
        pg.goto(f'http://localhost:{APORT}/#/settings/autoaudits/seo'); pg.wait_for_selector('.aa-tree', timeout=15000); time.sleep(0.5)
        check(pg.locator('select[data-field="priority"]').count() == 1 and pg.input_value('select[data-field="priority"]') == 'first', 'the SEO websites page has the priority choice')
        pg.screenshot(path=os.path.join(OUT, 'autoaudits-seo.png'), full_page=True)
        br.close()
    # The reading pass itself (no Duda here): which checks are on, editorial photos in a page.
    out = subprocess.run(['node', '-e', '''
      const W = await import(process.argv[1] + '/api/_watch.js');
      const st = { bizOn: true, edOn: true, biz: { checks: { 'address.town': false, 'social.video': false } }, ed: { checks: {} }, ids: new Set(['2639635421']), refs: [] };
      const kept = W.wanted([{ type: 'address', label: 'A town and ZIP that are not theirs' }, { type: 'address', label: 'Street address that is not theirs' }, { type: 'social', label: 'YouTube video: whose channel is it on?' }, { type: 'stock', how: 'name' }], st);
      const html = '<img src="https://irp.cdn-website.com/a/x/pexels-1.jpg"><span data-initial-props="%7B%22imgSrc%22%3A%22https%3A%2F%2Firp.cdn-website.com%2Fa%2Fx%2Fshutterstock_2639635421-1920w.jpg%22%7D"></span>';
      const urls = [...W.pictureUrls(html, true).keys()].map((u) => u.split('/').pop());
      const off = [...W.pictureUrls(html, false).keys()].map((u) => u.split('/').pop());
      const hand = { scans: [{ finishedAt: 'x' }] }, seo = { scans: [{ finishedAt: 'x', seoAuto: true }] };
      const to = [W.syncsTo(hand, 'auto'), W.syncsTo(seo, 'auto'), W.syncsTo(hand, 'all'), W.syncsTo(seo, 'none')];
      console.log(JSON.stringify({ kept: kept.map((x) => x.label || x.how), urls, off, to }));
    '''.replace('\n', ' '), APP], capture_output=True, text=True, input='')
    res = json.loads((out.stdout or '{}').strip().splitlines()[-1] if out.stdout.strip() else '{}')
    print('   pass:', res, out.stderr[-300:])
    check(res.get('kept') == ['Street address that is not theirs', 'name'], 'the reading pass keeps only the checks that are ticked')
    check(res.get('to') == [False, True, True, False], 'by default the auto audit adds items only to audits an auto audit made (SEO websites), never to one scanned by hand')
    check('shutterstock_2639635421-1920w.jpg' in res.get('urls', []) and 'shutterstock_2639635421-1920w.jpg' not in res.get('off', []), 'it finds an editorial photo kept in a slider’s data (and not when that check is unticked)')
finally:
    srv.terminate()
check(not errors, 'no page errors ' + '; '.join(errors[:3]))
print('ALL PASS' if ok else 'SOME FAILED'); sys.exit(0 if ok else 1)
