import { start, stop, call, redis, ADMIN, MEMBER, CLIENT, CLIENT2 } from './harness.mjs';
let ok = true; const check = (c, l) => { console.log((c ? 'PASS ' : 'FAIL ') + l); ok = ok && !!c; };
await start();
try {
  // picture of the home page, as the client
  let r = await call(CLIENT, 'GET', '/api/capture?op=latest&site=s1&device=desktop&path=/');
  check(r.status === 200 && r.body.cap === null, 'no fresh picture yet');
  const t0 = Date.now();
  r = await call(CLIENT, 'POST', '/api/capture', { op: 'shoot', site: 's1', device: 'desktop', path: '/' });
  check(r.status === 200 && r.body.cap && r.body.cap.slices.length >= 3, 'client takes a picture: ' + JSON.stringify({ s: r.status, slices: r.body.cap && r.body.cap.slices.length, h: r.body.cap && r.body.cap.h, ms: Date.now() - t0, err: r.body.error }));
  const cap = r.body.cap;
  check(cap.links.some((l) => l.p === '/about'), 'page picker learned /about from the menu');
  r = await call(CLIENT, 'POST', '/api/capture', { op: 'shoot', site: 's1', device: 'desktop', path: '/' });
  check(r.body.reused && r.body.cap.id === cap.id, 'second open reuses the fresh picture');
  r = await call(CLIENT, 'GET', `/api/capture?op=slice&cap=${cap.id}&i=0`);
  check(r.status === 200 && /webp/.test(r.ct) && r.body.length > 5000, 'slice served as image');
  r = await call(CLIENT, 'GET', `/api/capture?op=map&cap=${cap.id}`);
  const els = r.body.els || [];
  const hours = els.find((e) => e.t === 'We open at 9am every weekday.');
  check(hours && hours.s === '#txt2', 'element map has the opening hours text with its address');
  // other client cannot see it
  r = await call(CLIENT2, 'GET', `/api/capture?op=slice&cap=${cap.id}&i=0`);
  check(r.status === 404, 'another client cannot see this picture');
  r = await call(CLIENT2, 'POST', '/api/capture', { op: 'shoot', site: 's1', device: 'desktop', path: '/' });
  check(r.status === 404, 'another client cannot photograph this website');
  r = await call(CLIENT, 'POST', '/api/capture', { op: 'shoot', site: 's1', device: 'desktop', path: '/../etc' });
  check(r.status === 400, 'bad path refused');

  // limit: 3 a day
  r = await call(ADMIN, 'POST', '/api/tickets', { op: 'settings', settings: { daily: 3, over: {}, notify: [] } });
  check(r.status === 200 && r.body.settings.daily === 3, 'admin sets daily limit to 3');
  r = await call(MEMBER, 'POST', '/api/tickets', { op: 'settings', settings: { daily: 50 } });
  check(r.status === 403, 'member cannot change settings');

  const crop = { type: 'image/webp', data: Buffer.from('RIFF0000WEBPVP8 fake').toString('base64') };
  const mk = (i, extra) => Object.assign({ op: 'create', site: 's1', cid: 'cid-test-000' + i, cap: cap.id, kind: 'highlight', geo: { x: hours.r[0], y: hours.r[1], w: hours.r[2], h: hours.r[3] },
    text: 'Change to 8am please #' + i, el: { s: hours.s, t: hours.t, k: 'text', r: hours.r }, sel: hours.t, crop }, extra || {});
  r = await call(CLIENT, 'POST', '/api/tickets', mk(1));
  check(r.status === 200 && r.body.ticket.num === 1 && r.body.quota.used === 1 && r.body.quota.left === 2, 'ticket #1 sent, 2 left today');
  const t1 = r.body.ticket;
  r = await call(CLIENT, 'POST', '/api/tickets', mk(1));
  check(r.status === 200 && r.body.again && r.body.ticket.id === t1.id && r.body.quota.used === 1, 'a retry of the same request is not a second request');
  r = await call(CLIENT, 'POST', '/api/tickets', mk(2, { kind: 'arrow', geo: { x1: 100, y1: 100, x2: 400, y2: 300 } }));
  check(r.status === 200, 'arrow ticket');
  r = await call(CLIENT, 'POST', '/api/tickets', mk(3, { text: '   ' }));
  check(r.status === 400, 'empty comment refused (and not counted)');
  r = await call(CLIENT, 'POST', '/api/tickets', mk(4));
  check(r.status === 200 && r.body.quota.left === 0, 'third request uses up the day');
  r = await call(CLIENT, 'POST', '/api/tickets', mk(5));
  check(r.status === 429 && r.body.limited && r.body.quota.used === 3, 'fourth refused: daily limit (' + (r.body.error || '') + ')');
  r = await call(CLIENT, 'POST', '/api/tickets', mk(5));
  check(r.status === 429, 'retry after the limit is still refused, not stuck as pending');
  // previewing as client cannot send
  r = await call(ADMIN, 'POST', '/api/tickets', mk(6), { 'x-view-as-client': '1', 'x-view-site': 's1' });
  check(r.status === 403 && r.body.preview, 'previewing as client cannot send');

  // notifications reached the team
  const [nA, nM] = await redis(['LRANGE', 'dsa:notif:' + ADMIN, 0, 9], ['LRANGE', 'dsa:notif:' + MEMBER, 0, 9]);
  check((nA || []).filter((x) => /ticket-new/.test(x)).length === 3 && (nM || []).filter((x) => /ticket-new/.test(x)).length === 3, 'admin and member each told about all 3 requests');

  // team side
  r = await call(MEMBER, 'GET', '/api/tickets?op=count');
  check(r.body.new === 3, 'top bar count = 3 new');
  r = await call(MEMBER, 'GET', '/api/tickets?op=list');
  check(r.status === 200 && r.body.tickets.length === 3 && r.body.tickets[0].num === 3, 'team list newest first');
  r = await call(CLIENT, 'GET', '/api/tickets?op=list');
  check(r.status === 400, 'client cannot use the team list');
  r = await call(MEMBER, 'POST', '/api/tickets', { op: 'note', id: t1.id, text: 'internal: check with designer' });
  check(r.status === 200, 'team note');
  r = await call(MEMBER, 'POST', '/api/tickets', { op: 'reply', id: t1.id, text: 'Done — changed to 8am.', status: 'done' });
  check(r.status === 200 && r.body.ticket.status === 'done', 'team replies and marks done');
  r = await call(CLIENT, 'GET', '/api/tickets?op=mine&site=s1');
  const mine = r.body.tickets.find((t) => t.id === t1.id);
  check(mine && mine.status === 'done' && mine.unread && mine.replies.length === 1 && !('notes' in mine) && !JSON.stringify(r.body).includes('designer'), 'client sees reply + Done, never the team note');
  r = await call(CLIENT, 'POST', '/api/tickets', { op: 'creply', id: t1.id, text: 'Hmm it still says 9am on mobile' });
  check(r.status === 200 && r.body.ticket.status === 'open', 'client reply reopens it');
  r = await call(CLIENT, 'POST', '/api/tickets', { op: 'seen', site: 's1' });
  check(r.body.ok, 'seen');
  r = await call(MEMBER, 'POST', '/api/tickets', { op: 'status', ids: [t1.id], status: 'progress' });
  check(r.status === 200, 'bulk status');
  r = await call(MEMBER, 'GET', '/api/tickets?op=count');
  check(r.body.new === 2, 'count drops when one is picked up');
  r = await call(CLIENT, 'GET', `/api/tickets?op=img&id=${t1.id}`);
  check(r.status === 200 && /webp/.test(r.ct), 'client can load the crop');
  r = await call(CLIENT2, 'GET', `/api/tickets?op=img&id=${t1.id}`);
  check(r.status === 404, 'other client cannot load the crop');
  const [ttl] = await redis(['TTL', 'dsa:cap:' + cap.id]);
  check(ttl > 50 * 86400, 'picture kept for two months once a request points at it');

  // own screenshot upload
  r = await call(CLIENT, 'POST', '/api/capture', { op: 'upload', site: 's1', type: 'image/png', data: Buffer.from('x'.repeat(100)).toString('base64'), w: 1179, h: 2556, device: 'mobile' });
  check(r.status === 200 && r.body.cap.kind === 'upload' && r.body.cap.slices.length === 1, 'own screenshot becomes a page');
  // mobile capture
  r = await call(CLIENT, 'POST', '/api/capture', { op: 'shoot', site: 's1', device: 'mobile', path: '/about' });
  check(r.status === 200 && r.body.cap.w === 390 && r.body.cap.dsf === 2, 'phone picture of /about: ' + JSON.stringify({ e: r.body.error, h: r.body.cap && r.body.cap.h }));
  r = await call(ADMIN, 'POST', '/api/capture', { op: 'test' });
  check(r.status === 200 && r.body.ok, 'admin test capture: ' + JSON.stringify({ ms: r.body.ms, err: r.body.error }));
} catch (e) { console.error(e); ok = false; }
stop();
console.log(ok ? 'ALL PASS' : 'SOME FAILED');
process.exit(ok ? 0 : 1);
