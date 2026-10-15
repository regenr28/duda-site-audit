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
site = {'pages': [{'path': '/', 'title': 'Home'}, {'path': '/xpel-ppf', 'title': 'XPEL Paint Protection Film'}, {'path': '/xpel-tint', 'title': 'XPEL Window Tint'}, {'path': '/contact', 'title': 'Contact'}, {'path': '/about-us-team', 'title': 'Our team'}, {'path': '/gone', 'notFound': True}], 'id': 's1', 'siteId': 'abc123', 'host': 'ed.multiscreensite.com', 'businessName': 'Velvet Auto Care', 'people': ['dev@8bitcreative.com'], 'findings': finds, 'scan': {'state': 'complete', 'finishedAt': now, 'pages': 12}}
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
check(any('added an audit exception' in t and '/xpel-*' in t for t in act), "the audit's Activity says who added it", act[:2])
s, b = call(MEMBER, '/api/exempt', {'op': 'siteSave', 'site': 'abc123', 'rule': {'id': R1, 'pages': '/xpel-*', 'skip': ['contact', 'meta', 'content'], 'note': "XPEL's own page"}})
check(s == 200 and len(b['rule']['history']) == 2 and b['rule']['updatedByName'], 'changing it keeps a history and who changed it')
it = items()
check(it['f2']['status'] == 'exempt' and it['f3']['status'] == 'exempt', 'meta and spelling there are Exempt once ticked')
call(ADMIN, '/api/store', {'op': 'patchFinding', 'siteId': 's1', 'findingIds': ['f5'], 'changes': {'status': 'done'}})
s, b = call(MEMBER, '/api/exempt', {'op': 'siteSave', 'site': 'abc123', 'rule': {'pages': '', 'skip': ['contact'], 'note': 'x y z'}})
check(s == 400, 'a page is required')
s, b = call(MEMBER, '/api/exempt', {'op': 'siteSave', 'site': 'abc123', 'rule': {'pages': '/x', 'skip': ['contact']}})
check(s == 400 and 'reason' in b['error'], 'a reason is required')

# --- whole website: contact values fine anywhere on this website
s, b = call(MEMBER, '/api/exempt', {'op': 'siteSave', 'site': 'abc123', 'rule': {'scope': 'all', 'values': [{'type': 'phone', 'value': '555-000-1111'}], 'pages': ['/ignored'], 'note': 'Second location line'}})
check(s == 200 and b['rule']['scope'] == 'all' and b['rule']['pages'] == [] and len(b['rule']['values']) == 1, 'a whole-website exception keeps values only', b)
RALL = b['rule']['id']
it = items()
check(it['f5']['status'] == 'done', 'an item closed by hand is not touched by a whole-website exception')
s, b = call(MEMBER, '/api/exempt', {'op': 'siteSave', 'site': 'abc123', 'rule': {'scope': 'all', 'values': [], 'note': 'nothing'}})
check(s == 400, 'a whole-website exception needs a value')
call(MEMBER, '/api/exempt', {'op': 'siteRemove', 'site': 'abc123', 'id': RALL})

# --- every website: admins only
s, b = call(MEMBER, '/api/exempt', {'op': 'globalSave', 'set': {'name': 'XPEL Landing Page', 'pages': ['/about-us-*'], 'skip': ['contact']}})
check(s == 403, 'only admins change exception sets')
s, b = call(ADMIN, '/api/exempt', {'op': 'globalSave', 'set': {'name': 'XPEL Landing Page', 'note': 'XPEL pages on dealer websites', 'pages': ['/about-us-*'], 'skip': ['contact'], 'values': [{'type': 'phone', 'value': '(800) 447-9928'}, {'type': 'social', 'value': 'https://www.facebook.com/xpelinc'}]}})
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
check(any('removed the exception' in t for t in act), 'removal is in the Activity tab')
call(MEMBER, '/api/exempt', {'op': 'siteSave', 'site': 'abc123', 'rule': {'pages': '/xpel-ppf', 'skip': ['contact'], 'note': 'XPEL page'}})

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
        if tag != 'phone':
            pg.goto(f'http://localhost:{APORT}/#/site/s1/item/4'); pg.wait_for_selector('.ex-note', timeout=20000)
            check('XPEL Landing Page' in pg.inner_text('.ex-note'), f'{tag}: the item says which exception covers it')
        if tag == 'member':
            pg.goto(f'http://localhost:{APORT}/#/site/s1'); pg.wait_for_selector('.tabs a[href="#/site/s1/exceptions"]', timeout=20000)
            pg.click('#sMore'); pg.wait_for_selector('#sExempt')
            check('Audit exceptions' in pg.inner_text('.tabs') and 'Audit exceptions' in pg.inner_text('#sExempt'), 'the audit has an "Audit exceptions" tab and a shortcut in the ⋯ menu')
            pg.screenshot(path=os.path.join(OUT, 'head-more.png'))
            pg.click('#sExempt'); pg.wait_for_selector('#exAddPages', timeout=20000)
            check('XPEL Landing Page' in pg.inner_text('.ex-tab') and '/xpel-ppf' in pg.inner_text('.ex-tab'), 'the tab lists this website\'s exceptions and the sets')
            pg.screenshot(path=os.path.join(OUT, 'exempt-tab.png'), full_page=True)
            # the website's own pages, to tick or to match with a pattern
            pg.click('#exAddPages'); pg.wait_for_selector('#exPgList .ex-pg')
            check(pg.locator('#exPgList .ex-pg').count() == 5, 'the form lists the pages from the last scan (not the missing one)', pg.locator('#exPgList .ex-pg').count())
            pg.check('[data-pg="/contact"]')
            check(pg.locator('#exPages .chip', has_text='/contact').count() == 1, 'ticking a page adds it as a chip')
            pg.fill('#exPages .chip-in', '/xpel-*')
            check('Matches 2 pages' in pg.inner_text('#exPgHint'), 'typing a pattern shows which pages it matches', pg.inner_text('#exPgHint'))
            pg.press('#exPages .chip-in', 'Enter')
            check('2 pages' in pg.inner_text('#exPages .chips') and pg.is_disabled('[data-pg="/xpel-tint"]') and pg.is_checked('[data-pg="/xpel-tint"]'), 'the pattern chip says 2 pages; those pages show as covered')
            pg.fill('#exPgQ', 'tint')
            check(pg.locator('#exPgList .ex-pg').count() == 1, 'the page list can be filtered')
            pg.screenshot(path=os.path.join(OUT, 'exempt-pages.png'))
            pg.click('[data-close]')
            # specific pages, with chips and a preview first
            pg.click('#exAddPages'); pg.wait_for_selector('#exPages .chip-in')
            pg.fill('#exPages .chip-in', '/xpel-ppf'); pg.click('#exPages .chip-btn')
            check(pg.locator('#exPages .chip').count() == 1, 'a page added with + Add shows as a chip')
            pg.uncheck('[data-exk="contact"]'); pg.check('[data-exk="meta"]'); pg.fill('#exNote', 'Manufacturer page')
            check(pg.is_disabled('#exSave'), 'Exempt stays off until previewed')
            pg.click('#exPrev'); pg.wait_for_selector('#exOut .ex-tbl')
            t = pg.inner_text('#exOut')
            check(pg.locator('#exOut .ex-tbl tbody tr').count() == 1 and '#2' in t and 'Are you sure' in t and pg.locator('#exOut a[href="#/site/s1/item/2"]').count() == 1 and not pg.is_disabled('#exSave'), 'Preview lists the affected items with links, then Exempt is on', t[:160])
            pg.screenshot(path=os.path.join(OUT, 'exempt-preview.png'))
            pg.check('[data-exk="content"]')
            check(pg.is_disabled('#exSave') and 'preview again' in pg.inner_text('#exOut'), 'changing anything asks for a new preview')
            pg.click('#exPrev'); pg.wait_for_selector('#exOut .ex-tbl'); pg.click('#exSave'); pg.wait_for_selector('#exAddPages'); pg.wait_for_timeout(400)
            # whole website from an item
            pg.goto(f'http://localhost:{APORT}/#/site/s1/item/5'); pg.wait_for_selector('#drExemptV', timeout=20000)
            pg.click('#drExemptV'); pg.wait_for_selector('#exVals .chip')
            check(pg.is_checked('[name="exScope"][value="all"]') and 'Phone' in pg.inner_text('#exVals') and pg.is_hidden('#exPg'), 'Exempt this phone on the whole website… opens the whole-website form with the phone as a chip')
            pg.screenshot(path=os.path.join(OUT, 'exempt-whole.png'))
            pg.click('[data-close]')
            pg.goto(f'http://localhost:{APORT}/#/site/s1/exceptions'); pg.wait_for_selector('[data-exdel]', timeout=20000)
            pg.locator('[data-exdel]').first.click(); pg.wait_for_selector('#exGo')
            check('Remove this exception' in pg.inner_text('.modal'), 'removing asks first and lists what comes back')
            pg.screenshot(path=os.path.join(OUT, 'exempt-remove.png'))
            pg.click('[data-close]')
            pg.goto(f'http://localhost:{APORT}/#/settings'); pg.wait_for_selector('.set-nav')
            check(pg.locator('.set-nav a[href="#/settings/exceptions"]').count() == 0, 'members don\'t see the exception sets page')
        if tag == 'admin':
            pg.goto(f'http://localhost:{APORT}/#/settings/exceptions'); pg.wait_for_selector('#exsNew', timeout=20000)
            check('Audit exceptions' in pg.inner_text('.set-nav') and 'XPEL Landing Page' in pg.inner_text('#exsList') and 'facebook.com/xpelinc' in pg.inner_text('#exsList'), 'admin: Settings → Audit exceptions lists the set with chips')
            pg.click('[data-exsedit]'); pg.wait_for_selector('#exsName')
            check(pg.locator('#exsVals .chip').count() == 2 and pg.locator('#exsPages .chip').count() == 1, 'admin: the set opens with its pages and values as chips')
            pg.fill('#exsPages .chip-in', '/xpel-ppf'); pg.press('#exsPages .chip-in', 'Enter')
            pg.select_option('#exsVals .chip-type', 'city'); pg.fill('#exsVals .chip-in', 'Davie'); pg.click('#exsVals .chip-btn')
            check(pg.locator('#exsVals .chip').count() == 3 and 'City' in pg.inner_text('#exsVals'), 'admin: values are added with their kind')
            pg.locator('#exsVals .chip', has_text='447-9928').locator('button').click()
            check(pg.locator('#exsVals .chip').count() == 2, 'admin: ✕ removes a chip')
            pg.click('#exsPrev'); pg.wait_for_selector('#exsOut details.ex-site', timeout=20000)
            pg.click('#exsOut details.ex-site summary')
            t = pg.inner_text('#exsOut')
            check('Velvet Auto Care' in t and 'come back' in t and 'Are you sure' in t and pg.locator('#exsOut details.ex-site a[href="#/site/s1/item/4"]').count() == 1, 'admin: preview lists affected websites; opening one shows its items with links (the home-page phone comes back)', t[:300])
            pg.screenshot(path=os.path.join(OUT, 'exempt-set-preview.png'))
            pg.click('#exsSave'); pg.wait_for_selector('#exsNew'); pg.wait_for_timeout(400)
            pg.click('[data-exsdel]'); pg.wait_for_selector('#exsRm details.ex-site', timeout=20000)
            check('come back' in pg.inner_text('#exsRm'), 'admin: removing a set first lists what comes back')
            pg.screenshot(path=os.path.join(OUT, 'exempt-set-remove.png'))
        if tag == 'phone':
            pg.goto(f'http://localhost:{APORT}/#/site/s1/exceptions'); pg.wait_for_selector('#exAddAll', timeout=20000)
            pg.click('#exAddAll'); pg.wait_for_selector('#exVals .chip-in')
            check(pg.evaluate('document.documentElement.scrollWidth') <= w + 1, 'phone: fits')
            pg.screenshot(path=os.path.join(OUT, 'exempt-phone.png'))
        ctx.close()
    br.close()
check(not errs, 'no script errors', errs[:3])
srv.terminate()
print('ALL PASS' if not fails else 'SOME FAILED: ' + ', '.join(fails))
