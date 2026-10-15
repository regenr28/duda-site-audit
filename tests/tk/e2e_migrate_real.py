"""Moving the app, end to end: real work done in the OLD app (audit items, statuses, assignees, notes,
item comments, a hand-written item with a screenshot, Business Info exceptions, a customer with access to
one website, a Duda comment thread) arrives in a NEW app on an empty database, and works there.
Usage: python3 -I e2e_migrate_real.py <app> <tests>"""
import json, os, subprocess, sys, time, urllib.request, hashlib
from playwright.sync_api import sync_playwright
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); OLD, NEW, NEWDB = 3998, 3997, 8099
ADMIN, MEMBER, CLIENT = 'reymark@8bitcreative.com', 'dev@8bitcreative.com', 'owner@buffandbeyond.com'
TOK = {ADMIN: 'tokadmin1234567890abcdef', MEMBER: 'tokmember1234567890abcde', CLIENT: 'tokclient1234567890abcde'}
old = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-mr1.log'), 'w'), text=True)
assert old.stdout.readline().strip() == 'READY'
newdb = subprocess.Popen(['node', os.path.join(TESTS, 'fakeredis.mjs'), str(NEWDB)], stdout=subprocess.DEVNULL)
time.sleep(2.5 if os.environ.get('FAKE_PG') else 0.6)
DBENV = dict(SUPABASE_URL=f'http://127.0.0.1:{NEWDB}', SUPABASE_SECRET_KEY='sb_secret_test') if os.environ.get('FAKE_PG') else dict(KV_REST_API_URL=f'http://127.0.0.1:{NEWDB}', KV_REST_API_TOKEN='x')
env = dict(os.environ, **DBENV, PORT=str(NEW), ADMIN_EMAILS=ADMIN, SUGGESTIONS_OWNER=ADMIN,
           COPY_FROM_URL='http://127.0.0.1:8078', COPY_FROM_TOKEN='readonly', APP_COPY='1')
new = subprocess.Popen(['node', os.path.join(APP, 'dev-server.js')], env=env, stdout=subprocess.DEVNULL, stderr=open(os.path.join(OUT, 'srv-mr2.log'), 'w'))
time.sleep(1.2)
def rq(port, *cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{port}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
def api(port, who, method, path, body=None, headers=None):
    h = {'Content-Type': 'application/json', 'Cookie': 'dsa_sess=' + TOK[who]}; h.update(headers or {})
    req = urllib.request.Request(f'http://localhost:{port}{path}', data=json.dumps(body).encode() if body is not None else None, method=method, headers=h)
    try:
        r = urllib.request.urlopen(req, timeout=90); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')
ok = True
def check(c, label):
    global ok
    print(('PASS ' if c else 'FAIL ') + label, flush=True); ok = ok and bool(c)
try:
    # ---- real work in the OLD app ----
    findings = [{'id': 'f1', 'code': 'PHONE_MISMATCH', 'severity': 'critical', 'category': 'Business Info', 'message': 'Phone does not match', 'found': '(469) 555-0199', 'path': '/contact', 'pages': ['/contact']},
                {'id': 'f2', 'code': 'ALT_MISSING', 'severity': 'warning', 'category': 'Images', 'message': 'Image has no alt text', 'path': '/', 'pages': ['/']}]
    rq(8078, ['SET', 'dsa:site:s1', json.dumps({'id': 's1', 'siteId': 'abc123', 'host': 'ed.multiscreensite.com', 'businessName': 'Buff & Beyond', 'findings': findings,
                                               'allow': [{'type': 'phone', 'value': '(484) 555-0111', 'key': 'phone:4845550111', 'mode': 'allow', 'reason': 'Second shop line'}], 'status': 'In progress'})],
       ['HSET', 'dsa:fnum:s1', 'f1', '1', 'f2', '2'], ['SET', 'dsa:seq:s1', '2'],
       # a Duda comment conversation, as the webhook stores it
       ['HSET', 'dsa:convidx', 'conv1', json.dumps({'s': 'abc123', 'n': 2, 'tl': 'x'})], ['SET', 'dsa:conv:conv1', json.dumps({'id': 'conv1', 'site': 'abc123', 'comments': [{'text': 'Please change the hero photo', 'by': 'client'}]})])
    api(OLD, ADMIN, 'POST', '/api/store', {'op': 'patchFinding', 'siteId': 's1', 'findingIds': ['f1'], 'changes': {'status': 'clarification', 'assignee': MEMBER}})
    api(OLD, ADMIN, 'POST', '/api/store', {'op': 'patchFinding', 'siteId': 's1', 'findingIds': ['f2'], 'changes': {'status': 'done'}})
    st, r = api(OLD, ADMIN, 'POST', '/api/store', {'op': 'comment', 'siteId': 's1', 'target': 'f1', 'text': 'Is (469) their second location? Asking the client.'})
    check(st == 200, 'old app: a note on audit item #1')
    st, r = api(OLD, ADMIN, 'POST', '/api/store', {'op': 'addItem', 'siteId': 's1', 'message': 'Logo is stretched on mobile', 'severity': 'warning', 'path': '/', 'device': 'mobile',
                                                     'shot': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='})
    check(st == 200 and r.get('num') == 3, 'old app: a hand-written item #3 with a screenshot')
    st, before = api(OLD, ADMIN, 'GET', '/api/store?op=site&id=s1')
    st, cl_before = api(OLD, CLIENT, 'GET', '/api/client?op=me')
    # ---- the new app, empty: the owner signs up (first account = admin) ----
    st, r = api(NEW, ADMIN, 'GET', '/api/store?op=list')
    check(st == 401, 'the new app starts empty: nobody can sign in yet')
    rq(NEWDB, ['SADD', 'dsa:users', ADMIN], ['SET', 'dsa:user:' + ADMIN, json.dumps({'email': ADMIN, 'name': 'Reymark (new sign-up)', 'role': 'admin', 'status': 'active'})],
       ['SET', 'dsa:sess:' + hashlib.sha256(TOK[ADMIN].encode()).hexdigest(), ADMIN])
    # ---- move it ----
    st, r = api(NEW, ADMIN, 'POST', '/api/migrate', {'op': 'run'})
    while st == 200 and not r['state'].get('done'):
        st, r = api(NEW, ADMIN, 'POST', '/api/migrate', {'op': 'run'})
    check(st == 200 and r['state']['done'] and not r['state'].get('failed'), 'moved: %d records, none failed' % r['state'].get('copied', 0))
    # ---- check it in the NEW app ----
    st, after = api(NEW, ADMIN, 'GET', '/api/store?op=site&id=s1')
    check(st == 200, 'the audit opens in the new app')
    byn = {f.get('num'): f for f in after.get('site', after).get('findings', [])}
    f1, f2, f3 = byn.get(1, {}), byn.get(2, {}), byn.get(3, {})
    check(f1.get('status') == 'clarification' and f1.get('assignee') == MEMBER, 'item #1 keeps its status (For clarification) and its assignee')
    check(f2.get('status') == 'done', 'item #2 keeps Done')
    check(f3.get('manual') and f3.get('message') == 'Logo is stretched on mobile' and f3.get('shot', '').startswith('data:image/png'), 'the hand-written item #3 keeps its text and screenshot')
    notes = [c for c in after.get('comments', []) if c.get('target') == 'f1']
    check(notes and 'second location' in notes[0].get('text', ''), 'the note on item #1 is there, with who wrote it: ' + (notes[0].get('byName', '') if notes else ''))
    site = after.get('site', after)
    check(any(a.get('key') == 'phone:4845550111' and a.get('reason') == 'Second shop line' for a in site.get('allow', [])), 'Business Info exceptions and their reasons are there')
    check(json.dumps(after.get('site', after).get('findings', []), sort_keys=True) == json.dumps(before.get('site', before).get('findings', []), sort_keys=True), 'every audit item is exactly as it was')
    st, act = api(NEW, ADMIN, 'GET', '/api/store?op=activity&id=s1')
    st, cl_after = api(NEW, CLIENT, 'GET', '/api/client?op=me')
    check(st == 200 and json.dumps(cl_after, sort_keys=True) == json.dumps(cl_before, sort_keys=True), 'the customer keeps exactly the same access (same websites, same account)')
    st, r = api(NEW, CLIENT, 'GET', '/api/store?op=site&id=s1')
    check(st in (401, 403), 'and still cannot open the team side')
    st, r = api(NEW, MEMBER, 'POST', '/api/migrate', {'op': 'run'})
    check(st == 403, 'roles come across: a member is still not the owner')
    check(rq(NEWDB, ['GET', 'dsa:conv:conv1'])[0] and 'hero photo' in rq(NEWDB, ['GET', 'dsa:conv:conv1'])[0] and rq(NEWDB, ['HGET', 'dsa:convidx', 'conv1'])[0], 'the Duda comment conversations come across')
    u_old = json.loads(rq(8078, ['GET', 'dsa:user:' + CLIENT])[0]); u_new = json.loads(rq(NEWDB, ['GET', 'dsa:user:' + CLIENT])[0])
    check(u_old == u_new, 'accounts (passwords, roles, websites) are identical, so everyone signs in with the same password')
    with sync_playwright() as pw:
        br = pw.chromium.launch(); ctx = br.new_context(viewport={'width': 1280, 'height': 900})
        ctx.add_cookies([{'name': 'dsa_sess', 'value': TOK[ADMIN], 'domain': 'localhost', 'path': '/'}])
        pg = ctx.new_page(); errors = []; pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(f'http://localhost:{NEW}/#/site/s1'); pg.wait_for_selector('text=Logo is stretched on mobile', timeout=20000); time.sleep(0.8)
        t = pg.inner_text('#view')
        check('Phone does not match' in t and 'Logo is stretched on mobile' in t, 'the new app shows the audit items on screen')
        pg.screenshot(path=os.path.join(OUT, 'moved-audit.png'))
        check(not errors, 'no script errors ' + ' | '.join(errors[:2]))
        br.close()
finally:
    old.terminate(); new.terminate(); newdb.terminate()
print('ALL PASS' if ok else 'SOME FAILED')
