// Outside addresses never reach the server's own network. Usage: node net_unit.mjs <app>
const N = await import(process.argv[2] + '/api/_net.js');
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
for (const u of ['http://localhost/', 'http://127.0.0.1:8080/', 'http://169.254.169.254/latest/meta-data', 'http://10.1.2.3/', 'http://[::1]/', 'http://172.20.0.1/', 'http://192.168.1.1/', 'http://user:pw@example.com/', 'ftp://example.com/', 'http://2130706433/', 'http://metadata.google.internal/'])
  ok(!(await N.publicAddress(u)), 'refused: ' + u);
ok(await N.publicAddress('https://8.8.8.8/'), 'a public address is allowed');
console.log(fail ? 'SOME FAILED' : 'ALL PASS'); process.exit(fail ? 1 : 0);
