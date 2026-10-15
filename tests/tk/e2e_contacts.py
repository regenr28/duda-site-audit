"""Contacts from form submissions (team and client), and the client Comments page.
Usage: python3 -I e2e_contacts.py <app> <tests>"""
import json, os, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT = 3998, 8078
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-ct.log'), 'w'), text=True)
assert srv.stdout.readline().strip() == 'READY'
def redis(*cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
print(subprocess.run(['node', os.path.join(OUT, 'seedleads.mjs'), APP], capture_output=True, text=True).stdout.strip())
# the team's own chat about the website (must never reach the client)…
redis(['HSET', 'dsa:cmt:s1', 'c1', json.dumps({'id': 'c1', 'siteId': 's1', 'target': 'site', 'by': 'dev@8bitcreative.com', 'byName': 'Dana Dev', 'text': 'Team only: this client is slow to reply', 'mentions': [], 'createdAt': '2026-10-01T10:00:00Z'})])
# …and the Duda editor conversations: one with the client, one the team left itself
redis(['HSET', 'dsa:conv:abc123', 't1', json.dumps({'u': 't1', 'num': 1, 'page': 'p1', 'status': 'open', 'at': '2026-10-02T10:00:00Z', 'comments': [{'by': 'owner@buffandbeyond.com', 'text': 'Please make the logo bigger', 'at': '2026-10-02T10:00:00Z'}, {'by': 'reymark@8bitcreative.com', 'text': 'Done, have a look!', 'at': '2026-10-02T12:00:00Z'}]}),
       't2', json.dumps({'u': 't2', 'num': 2, 'status': 'open', 'at': '2026-10-03T10:00:00Z', 'comments': [{'by': 'dev@8bitcreative.com', 'text': 'Note to self: swap hero image', 'at': '2026-10-03T10:00:00Z'}]})],
      ['HSET', 'dsa:pages:abc123', 'p1', 'Home'])
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
errors = []
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx = br.new_context(viewport={'width': 1440, 'height': 1000})
        ctx.add_cookies([{'name': 'dsa_sess', 'value': 'tokadmin1234567890abcdef', 'domain': 'localhost', 'path': '/'}])
        pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e))); pg.on('response', lambda r: print('   resp', r.status, r.url[:100]) if '/api/' in r.url and r.status >= 400 else None); pg.on('console', lambda m: print('   console', m.text[:200]) if m.type == 'error' else None)
        pg.goto(f'http://localhost:{APORT}/#/site/s1/profile/contacts'); pg.wait_for_selector('.ct-table', timeout=20000); time.sleep(0.5)
        t = pg.inner_text('#pfContactsBody')
        print('   ', t[:300].replace('\n', ' | '))
        check(pg.locator('.ct-row').count() == 2, 'four submissions become two contacts (same email, then same phone, joined)')
        maria = pg.locator('.ct-row', has_text='Santos').inner_text()
        check('3' in maria and 'returning' in maria and 'maria@example.com' in maria, 'Maria: 3 enquiries, marked returning, email tidied')
        pg.locator('.ct-row', has_text='Santos').click(); time.sleep(0.2)
        check('Calling about Saturday' in pg.inner_text('.ct-more'), 'clicking a contact shows their latest message and details')
        pg.fill('.ct-q', 'reyes'); time.sleep(0.3)
        check(pg.locator('.ct-row').count() == 1, 'contacts can be searched')
        with pg.expect_download() as dl: pg.fill('.ct-q', ''); time.sleep(0.2); pg.click('.ct-csv')
        csv = open(dl.value.path(), encoding='utf-8-sig').read()
        check('Maria Santos' in csv and 'John Reyes' in csv and 'Latest message' in csv, 'Export CSV downloads every contact')
        check('Rank Pro' not in csv, 'the export leaves out likely spam')
        bar = pg.inner_text('.ct-bar')
        check('Likely spam' in bar and 'People' in bar, 'Contacts splits People and Likely spam: ' + bar.replace('\n', ' '))
        pg.click('[data-ctv="spam"]'); time.sleep(0.3)
        check(pg.locator('.ct-row').count() == 1 and 'Rank Pro' in pg.inner_text('.ct-table'), 'the SEO pitch is under Likely spam')
        pg.locator('.ct-row', has_text='Rank Pro').click(); time.sleep(0.2)
        check('Why it looks like spam' in pg.inner_text('.ct-more') and 'seo services' in pg.inner_text('.ct-more').lower(), 'it says why')
        pg.screenshot(path=os.path.join(OUT, 'contacts-spam.png'), full_page=False)
        pg.click('[data-ctrule="real"]'); time.sleep(0.8)
        check(json.loads(json.dumps(redis(['HGET', 'dsa:ctv:abc123', 'sales@rankpro.io'])))[0] == 'real', 'Not spam is saved for the website')
        pg.click('[data-ctv="people"]'); time.sleep(0.3)
        check(pg.locator('.ct-row').count() == 3, 'and the contact moves back to People')
        pg.reload(); pg.wait_for_selector('.ct-table', timeout=20000); time.sleep(0.5)
        check(pg.locator('.ct-row').count() == 3, 'it stays a person after a reload')
        redis(['HDEL', 'dsa:ctv:abc123', 'sales@rankpro.io'])
        # Lead analysis says where enquiries are, even with no analysis database
        pg.goto(f'http://localhost:{APORT}/#/analysis'); pg.wait_for_selector('#anIn', timeout=15000)
        check('Read from the app' in pg.inner_text('#anBody'), 'Forms gone quiet works without the analysis database, and says where it reads from')
        pg.goto(f'http://localhost:{APORT}/#/analysis/junk'); pg.wait_for_selector('.an-status', timeout=15000)
        st = pg.inner_text('.an-status')
        check('Stored in the app' in st and 'Analysis database' in st and 'Not connected' in st and 'nothing is lost' in st.lower(), 'Lead analysis shows where enquiries are and what is connected')
        check('How to connect it' in st, 'the app owner sees how to connect the database')
        pg.screenshot(path=os.path.join(OUT, 'an-status.png'))
        pg.goto(f'http://localhost:{APORT}/#/site/s1/profile/contacts'); pg.wait_for_selector('.ct-table', timeout=20000); time.sleep(0.5)
        pg.screenshot(path=os.path.join(OUT, 'contacts.png'), full_page=True)
        # View as client: Comments page works, Contacts page exists, no editor address shown as their website
        pg.click('#sViewAs'); pg.wait_for_function("() => location.hash.startsWith('#/my/')", timeout=15000); time.sleep(1.5)
        pg.goto(f'http://localhost:{APORT}/#/my/s1/comments'); time.sleep(1.5)
        ct = pg.inner_text('#clMain'); print('   client comments:', ct[:400].replace('\n', ' | '))
        check('WRONGTYPE' not in ct and 'Please make the logo bigger' in ct and 'Done, have a look!' in ct and 'Your team' in ct and 'Home' in ct, 'client Comments page loads (no error): their conversation in the editor, with the team\'s reply as "Your team"')
        check('Team only' not in ct and 'Note to self' not in ct and 'reymark@' not in ct, 'never the team\'s own chat, a note the team left itself, or team emails')
        check('multiscreensite' not in pg.inner_text('body') and 'buffandbeyond.com' in pg.inner_text('body'), 'the client sees their own domain, not the editor address')
        pg.goto(f'http://localhost:{APORT}/#/my/s1/contacts'); pg.wait_for_selector('#clCt .ct-table', timeout=15000)
        check(pg.locator('#clCt .ct-row').count() == 2 and 'People' in pg.inner_text('.cp-subtabs'), 'the client has their contacts (Enquiries → People) with the same two people')
        pg.screenshot(path=os.path.join(OUT, 'contacts-client.png'), full_page=True)
        # a member without "contact details" sees no contacts, and the server refuses
        redis(['SET', 'dsa:user:dev@8bitcreative.com', json.dumps({'email': 'dev@8bitcreative.com', 'name': 'Dana Dev', 'role': 'member', 'status': 'active', 'revoke': ['leads.contacts'], 'createdAt': '2026-01-01T00:00:00Z'})], ['INCR', 'dsa:ver:access'])
        r = subprocess.run(['curl', '-s', f'http://localhost:{APORT}/api/leads?op=contacts&id=abc123', '-H', 'Cookie: dsa_sess=tokmember1234567890abcde'], capture_output=True, text=True).stdout
        check('contact details' in r, 'without "See enquirers\' contact details" the server refuses contacts')
        check(not errors, 'no script errors ' + ' | '.join(errors[:3]))
        br.close()
except Exception:
    import traceback; traceback.print_exc(); ok = False
finally:
    srv.terminate()
    for pat in ['[f]ixsite.mjs', '[f]akeredis.mjs', '[d]ev-server.js']: subprocess.run(['pkill', '-f', pat])
print('ALL PASS' if ok else 'SOME FAILED')
