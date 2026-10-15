"""Exceptions: page exceptions for one website, exception sets for every website, Exempt items.
Usage: python3 -I e2e_exempt.py <app> <tests>"""
import json, os, subprocess, sys, urllib.request, urllib.error
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT = 3998, 8078
ADMIN, MEMBER = 'tokadmin1234567890abcdef', 'tokmember1234567890abcde'
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-exempt.log'), 'w'), text=True)
assert srv.stdout.readline().strip() == 'READY'
fails = []
def check(ok, what, extra=''):
    print(('PASS ' if ok else 'FAIL ') + what, extra if not ok else '')
    if not ok: fails.append(what)
def redis(*cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
def call(tok, path, body=None):
    req = urllib.request.Request(f'http://localhost:{APORT}{path}', data=json.dumps(body).encode() if body is not None else None, method='POST' if body is not None else 'GET',
                                 headers={'Cookie': 'dsa_sess=' + tok, 'Content-Type': 'application/json'})
    try: return 200, json.loads(urllib.request.urlopen(req, timeout=60).read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')
def F(i, code, sev, cat, path, found='x'):
    return {'id': f'f{i}', 'num': i, 'code': code, 'severity': sev, 'category': cat, 'message': code + ' on ' + path, 'path': path, 'pages': [path], 'location': 'Body', 'selector': f'#x{i}', 'visibleOn': ['desktop'], 'found': found}
finds = [F(1, 'TEL_MISMATCH', 'critical', 'Contact info', '/xpel-ppf', '(800) 447-9928'),
         F(2, 'META_DESC_MISSING', 'warning', 'Meta / SEO', '/xpel-ppf'),
         F(3, 'TEXT_SPELLING', 'warning', 'Content', '/xpel-ppf', 'protecton'),
         F(4, 'TEL_MISMATCH', 'critical', 'Contact info', '/', '800-447-9928'),
         F(5, 'TEL_MISMATCH', 'critical', 'Contact info', '/contact', '(555) 000-1111'),
         F(6, 'MAILTO_MISMATCH', 'critical', 'Contact info', '/about-us-team', 'info@xpel.com'),
         F(7, 'DESIGNER_CREDIT', 'critical', 'Business name', '/xpel-ppf', 'Website by Someone Else')]
now = '2026-10-15T03:15:00Z'
site = {'id': 's1', 'siteId': 'abc123', 'host': 'ed.multiscreensite.com', 'businessName': 'Velvet Auto Care', 'people': ['dev@8bitcreative.com'], 'findings': finds, 'scan': {'state': 'complete', 'finishedAt': now, 'pages': 12}}
redis(['SET', 'dsa:site:s1', json.dumps(site)], ['HSET', 'dsa:fnum:s1', *sum([[f['id'], str(f['num'])] for f in finds], [])])
def items():
    s, b = call(ADMIN, '/api/store?op=site&id=s1')
    return {f['id']: f for f in (b.get('site') or b)['findings']}
def summ():
    s, b = call(ADMIN, '/api/store?op=list'); return [x for x in b['sites'] if x['id'] == 's1'][0]
call(ADMIN, '/api/store', {'op': 'scanState', 'id': 's1', 'scan': {'state': 'complete'}})
base = summ()['counts']

# --- one website: anyone on the team
s, b = call(MEMBER, '/api/exempt', {'op': 'siteSave', 'site': 'abc123', 'rule': {'pages': 'https://velvet.com/xpel-*/', 'skip': ['contact'], 'note': "XPEL's own page"}})
check(s == 200 and b['rule']['pages'] == ['/xpel-*'], 'a teammate exempts /xpel-* (link tidied to a path)', b)
R1 = b['rule']['id']
it = items()
check(it['f1']['status'] == 'exempt' and it['f1']['exempt']['kind'] == 'site', 'the contact item on that page is Exempt')
check(it['f2']['status'] == 'open' and it['f3']['status'] == 'open', 'meta and spelling on that page are still checked (not ticked)')
check(it['f7']['status'] == 'open', 'a designer credit is never exempted')
check(it['f5']['status'] == 'open', 'other pages are untouched')
c = summ()['counts']
check(c['closed'] == base['closed'] + 1 and c['exempt'] == 1 and c['critical'] == base['critical'] - 1, 'Exempt counts as closed', (base, c))
act = [json.loads(x)['text'] for x in redis(['LRANGE', 'dsa:act:s1', 0, 5])[0]]
check(any('added the page exception' in t and '/xpel-*' in t for t in act), "the audit's Activity says who added it", act[:2])
s, b = call(MEMBER, '/api/exempt', {'op': 'siteSave', 'site': 'abc123', 'rule': {'id': R1, 'pages': '/xpel-*', 'skip': ['contact', 'meta', 'content']}})
check(s == 200 and len(b['rule']['history']) == 2 and b['rule']['updatedByName'], 'changing it keeps a history and who changed it')
it = items()
check(it['f2']['status'] == 'exempt' and it['f3']['status'] == 'exempt', 'meta and spelling there are Exempt once ticked')
call(ADMIN, '/api/store', {'op': 'patchFinding', 'siteId': 's1', 'findingIds': ['f5'], 'changes': {'status': 'done'}})
s, b = call(MEMBER, '/api/exempt', {'op': 'siteSave', 'site': 'abc123', 'rule': {'pages': '', 'skip': ['contact']}})
check(s == 400, 'a page is required')

# --- every website: admins only
s, b = call(MEMBER, '/api/exempt', {'op': 'globalSave', 'set': {'name': 'XPEL Landing Page', 'pages': ['/about-us-*'], 'skip': ['contact']}})
check(s == 403, 'only admins change exception sets')
s, b = call(ADMIN, '/api/exempt', {'op': 'globalSave', 'set': {'name': 'XPEL Landing Page', 'pages': ['/about-us-*'], 'skip': ['contact'], 'values': [{'type': 'phone', 'value': '(800) 447-9928'}, {'type': 'social', 'value': 'https://www.facebook.com/xpelinc'}]}})
check(s == 200 and len(b['set']['values']) == 2, 'an admin adds the XPEL Landing Page set with pages and values', b)
G1 = b['set']['id']
it = items()
check(it['f4']['status'] == 'exempt' and it['f4']['exempt']['name'] == 'XPEL Landing Page', "XPEL's phone is fine anywhere (home page)", it['f4'].get('exempt'))
check(it['f6']['status'] == 'exempt', 'a wildcard page from the set (/about-us-*) is Exempt')
c = summ()
check(c['counts']['exempt'] == 5 and c.get('exv', 0) >= 1, 'the Audits list re-counts after a set changes', c['counts'])
ga = [json.loads(x) for x in redis(['LRANGE', 'dsa:gact', 0, 5])[0] or []]

# --- removing brings items back; a status set by hand wins
s, b = call(MEMBER, '/api/exempt', {'op': 'siteRemove', 'site': 'abc123', 'id': R1})
it = items()
check(s == 200 and it['f1']['status'] == 'exempt' and it['f2']['status'] == 'open', 'removing the page exception reopens its items (f1 stays Exempt by the XPEL phone value)', (it['f1']['status'], it['f2']['status']))
check(it['f5']['status'] == 'done', 'an item marked Done by hand stays Done')
act = [json.loads(x)['text'] for x in redis(['LRANGE', 'dsa:act:s1', 0, 5])[0]]
check(any('removed the page exception' in t for t in act), 'removal is in the Activity tab')
call(MEMBER, '/api/exempt', {'op': 'siteSave', 'site': 'abc123', 'rule': {'pages': '/xpel-ppf', 'skip': ['contact']}})

# --- previews before saving or removing a set
s, b = call(ADMIN, '/api/exempt', {'op': 'preview', 'set': {'id': G1, 'name': 'XPEL Landing Page', 'pages': ['/about-us-*', '/xpel-ppf'], 'skip': ['contact', 'content'], 'values': [{'type': 'phone', 'value': '(800) 447-9928'}]}})
row = [r for r in b.get('rows', []) if r['id'] == 's1']
check(s == 200 and row and row[0]['gain'] == 1 and row[0]['back'] == 0, 'set preview: per website, items that would become Exempt (spelling on /xpel-ppf)', b)
s, b = call(ADMIN, '/api/exempt', {'op': 'preview', 'remove': True, 'id': G1})
row = [r for r in b.get('rows', []) if r['id'] == 's1']
check(s == 200 and row and row[0]['back'] == 2, 'removal preview: items that would come back (home-page phone and /about-us-team email)', b)
s, b = call(MEMBER, '/api/exempt', {'op': 'preview', 'remove': True, 'id': G1})
check(s == 403, 'only admins preview set changes')

# --- the auto audit follows them too
out = subprocess.run(['node', '-e', '''
import(process.argv[1] + '/public/engine.js').then(() => { const A = globalThis.DudaAudit;
  const rules = [{ pages: ['/xpel-*'], skip: ['contact'] }, { values: [{ type: 'email', value: 'info@xpel.com' }] }];
  console.log(JSON.stringify([!!A.exemptIssueRule({ type: 'phone', value: '5550001111', path: '/xpel-tint' }, rules), !!A.exemptIssueRule({ type: 'email', value: 'info@xpel.com', path: '/blog/x' }, rules), !!A.exemptIssueRule({ type: 'phone', value: '5550001111', path: '/contact' }, rules)])); });''', APP], capture_output=True, text=True)
check(out.stdout.strip() == '[true,true,false]', 'auto audit: exempt pages and values are skipped, others are not', out.stdout + out.stderr)

errs = []
with sync_playwright() as p:
    br = p.chromium.launch()
    for tok, tag, w, h in [(MEMBER, 'member', 1300, 900), (ADMIN, 'admin', 1300, 900), (MEMBER, 'phone', 390, 844)]:
        ctx = br.new_context(viewport={'width': w, 'height': h}); ctx.add_cookies([{'name': 'dsa_sess', 'value': tok, 'url': f'http://localhost:{APORT}'}])
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(f'http://localhost:{APORT}/#/site/s1/item/4'); pg.wait_for_selector('.ex-note', timeout=20000)
        check('XPEL Landing Page' in pg.inner_text('.ex-note'), f'{tag}: the item says which exception covers it')
        pg.screenshot(path=os.path.join(OUT, f'exempt-item-{tag}.png'))
        if tag == 'member':
            pg.goto(f'http://localhost:{APORT}/#/site/s1/item/2'); pg.wait_for_selector('#drExempt', timeout=20000)
            pg.click('#drExempt'); pg.wait_for_selector('#exPages')
            check(pg.input_value('#exPages') == '/xpel-ppf' and pg.is_checked('[data-exk="meta"]') and not pg.is_checked('[data-exk="contact"]'), 'Exempt this page… is pre-filled with the page and the item\'s kind')
            pg.screenshot(path=os.path.join(OUT, 'exempt-form.png'))
            pg.click('#exNext'); pg.wait_for_selector('#exStep2 .ex-tbl')
            t = pg.inner_text('#exStep2')
            check(pg.locator('#exStep2 .ex-tbl tbody tr').count() == 1 and '#2' in t and 'Are you sure' in t and pg.locator('#exStep2 a[href="#/site/s1/item/2"]').count() == 1, 'before saving: a table of the items it affects, with links, then "are you sure"', t[:200])
            check('Yes, exempt 1 item' in pg.inner_text('#exSave'), 'the confirm button says how many')
            pg.screenshot(path=os.path.join(OUT, 'exempt-preview.png'))
            pg.click('#exBack'); check(pg.is_visible('#exPages'), 'Back returns to the form')
            pg.click('[data-close]')
            pg.goto(f'http://localhost:{APORT}/#/site/s1'); pg.wait_for_timeout(500)
            pg.click('#sExempt'); pg.wait_for_selector('#exAdd')
            check('XPEL Landing Page' in pg.inner_text('.modal') and '/xpel-ppf' in pg.inner_text('.modal'), 'the Exceptions window lists this website\'s and the sets')
            pg.screenshot(path=os.path.join(OUT, 'exempt-list.png'))
            pg.click('[data-exdel]'); pg.wait_for_selector('#exGo')
            check('checked normally again' in pg.inner_text('.modal') and 'No items on this audit come back' in pg.inner_text('.modal'), 'removing first says what comes back (here nothing: XPEL\'s phone in the set still covers it)', pg.inner_text('.modal')[:200])
            pg.screenshot(path=os.path.join(OUT, 'exempt-remove.png'))
            pg.click('#exBack'); pg.wait_for_selector('#exAdd')
            pg.goto(f'http://localhost:{APORT}/#/settings'); pg.wait_for_selector('.set-nav')
            check(pg.locator('.set-nav a[href="#/settings/exceptions"]').count() == 0, 'members don\'t see the exception sets page')
        if tag == 'admin':
            pg.goto(f'http://localhost:{APORT}/#/settings/exceptions'); pg.wait_for_selector('#exsNew', timeout=20000)
            check('XPEL Landing Page' in pg.inner_text('#exsList') and 'facebook.com/xpelinc' in pg.inner_text('#exsList'), 'admin: Settings → Exceptions lists the set')
            pg.click('[data-exsedit]'); pg.wait_for_selector('#exsName')
            check(pg.input_value('#exsName') == 'XPEL Landing Page' and '447-9928' in pg.input_value('[data-exv="phone"]'), 'admin: the set opens for editing')
            pg.screenshot(path=os.path.join(OUT, 'exempt-set.png'))
            pg.fill('#exsPages', '/about-us-*\n/xpel-ppf'); pg.check('[data-exk="content"]'); pg.click('#exsNext'); pg.wait_for_selector('#exsStep2 .ex-tbl', timeout=20000)
            t = pg.inner_text('#exsStep2')
            check('Velvet Auto Care' in t and 'Are you sure' in t, 'a set change first lists the affected websites with counts', t[:300])
            pg.screenshot(path=os.path.join(OUT, 'exempt-set-preview.png'))
            pg.click('#exsSave'); pg.wait_for_selector('#exsNew'); pg.wait_for_timeout(400)
            pg.click('[data-exsdel]'); pg.wait_for_selector('#exsRm .ex-tbl', timeout=20000)
            check('come back' in pg.inner_text('#exsRm') and 'Velvet Auto Care' in pg.inner_text('#exsRm'), 'removing a set first lists the websites whose items come back')
            pg.screenshot(path=os.path.join(OUT, 'exempt-set-remove.png'))
        if tag == 'phone':
            check(pg.evaluate('document.documentElement.scrollWidth') <= w + 1, 'phone: fits')
        ctx.close()
    br.close()
check(not errs, 'no script errors', errs[:3])
srv.terminate()
print('ALL PASS' if not fails else 'SOME FAILED: ' + ', '.join(fails))
