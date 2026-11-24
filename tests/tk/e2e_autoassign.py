"""Whoever changes an item's status takes it: it is assigned to them, and the activity log says so.
Usage: python3 -I e2e_autoassign.py <app> <tests>"""
import json, os, subprocess, sys, urllib.request, urllib.error
APP, TESTS = sys.argv[1], sys.argv[2]
OUT = os.path.join(TESTS, 'tk'); APORT, RPORT = 3998, 8078
ADMIN, MEMBER = 'tokadmin1234567890abcdef', 'tokmember1234567890abcde'
srv = subprocess.Popen(['node', os.path.join(OUT, 'run.mjs'), APP, TESTS], stdout=subprocess.PIPE, stderr=open(os.path.join(OUT, 'srv-autoassign.log'), 'w'), text=True)
assert srv.stdout.readline().strip() == 'READY'
fails = []
def check(ok, what, extra=''):
    print(('PASS ' if ok else 'FAIL ') + what, extra if not ok else '', flush=True)
    if not ok: fails.append(what)
def redis(*cmds):
    req = urllib.request.Request(f'http://127.0.0.1:{RPORT}/pipeline', data=json.dumps(list(cmds)).encode(), method='POST')
    return [x.get('result') for x in json.loads(urllib.request.urlopen(req).read())]
def call(tok, path, body=None):
    req = urllib.request.Request(f'http://localhost:{APORT}{path}', data=json.dumps(body).encode() if body is not None else None, method='POST' if body is not None else 'GET',
                                 headers={'Cookie': 'dsa_sess=' + tok, 'Content-Type': 'application/json'})
    try: return 200, json.loads(urllib.request.urlopen(req, timeout=60).read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')
def F(i): return {'id': f'f{i}', 'num': i, 'code': 'TEXT_SPELLING', 'severity': 'warning', 'category': 'Content', 'message': 'Spelling mistake', 'path': '/', 'pages': ['/'], 'location': 'Body', 'selector': f'#x{i}', 'visibleOn': ['desktop'], 'found': 'teh'}
finds = [F(1), F(2), F(3)]
site = {'id': 's1', 'siteId': 'abc123', 'host': 'ed.multiscreensite.com', 'businessName': 'Velvet Auto Care', 'pages': [{'path': '/', 'title': 'Home'}], 'findings': finds, 'scan': {'state': 'complete', 'finishedAt': '2026-11-20T03:15:00Z', 'pages': 1}}
redis(['SET', 'dsa:site:s1', json.dumps(site)], ['HSET', 'dsa:fnum:s1', 'f1', '1', 'f2', '2', 'f3', '3'])
try:
    s, me = call(MEMBER, '/api/auth?op=me'); mem = (me.get('me') or me.get('user') or me).get('email', '')
    s, me = call(ADMIN, '/api/auth?op=me'); adm = (me.get('me') or me.get('user') or me).get('email', '')
    call(ADMIN, '/api/store', {'op': 'patchFinding', 'siteId': 's1', 'findingIds': ['f1', 'f3'], 'changes': {'assignee': adm}})
    s, b = call(MEMBER, '/api/store', {'op': 'patchFinding', 'siteId': 's1', 'findingIds': ['f1'], 'changes': {'status': 'done'}})
    check(s == 200, 'a member marks an item someone else has as Done', b)
    s, b = call(ADMIN, '/api/store?op=site&id=s1'); st = b.get('site') or b
    it = {f['id']: f for f in st['findings']}
    check(it['f1']['status'] == 'done' and it['f1']['assignee'] == mem, 'the item is now assigned to whoever changed it: ' + str(it['f1'].get('assignee')))
    acts = [a.get('text', '') for a in (st.get('activity') or [])]
    print('   activity:', acts[:3])
    check(any('#1' in a and 'Done' in a and 'now assigned to' in a for a in acts), 'the activity log says the status changed and who it is now assigned to')
    call(MEMBER, '/api/store', {'op': 'patchFinding', 'siteId': 's1', 'findingIds': ['f2'], 'changes': {'status': 'hold'}})
    s, b = call(ADMIN, '/api/store?op=site&id=s1'); st = b.get('site') or b; it = {f['id']: f for f in st['findings']}
    check(it['f2']['assignee'] == mem, 'an unassigned item is taken the same way')
    call(ADMIN, '/api/store', {'op': 'patchFinding', 'siteId': 's1', 'findingIds': ['f3'], 'changes': {'status': 'false', 'assignee': mem}})
    s, b = call(ADMIN, '/api/store?op=site&id=s1'); st = b.get('site') or b; it = {f['id']: f for f in st['findings']}
    check(it['f3']['assignee'] == mem, 'choosing an assignee in the same change wins over taking it')
finally:
    srv.terminate()
print('ALL PASS' if not fails else 'SOME FAILED'); sys.exit(1 if fails else 0)
